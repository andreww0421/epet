import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { type TestContext } from 'node:test';
import {
  acknowledgeProductWorkflow, beginProductWorkflow, cancelProductWorkflow, clearProductWorkflows,
  completeLocalProductWorkflow, configureProductWorkflows, isProductWorkflowPending,
  rejectProductWorkflow, setProductWorkflowScope, subscribeProductWorkflowScopeVerified,
} from '../src/analytics/workflows';
import { captureProductWorkflowSave } from '../src/services/productWorkflowPersistence';
import { clearAuthentication, getProductOnboardingState, saveBackendState, setActiveWorkspaceId,
  updateProductOnboarding } from '../src/services/backendApi';
import { resetStoreForSession, useStore } from '../src/store/useStore';
import { normalizeAppData } from '../src/store/utils';
import type { ExamRecord } from '../src/store/types';
import type { ProductAnalyticsWorkflowEvent } from '../shared/productAnalytics/schema';

const PRIVATE = 'SYNTHETIC-PRIVATE-TEACHER-WORKSPACE-STUDENT-SCORE-CONTENT';
const initial = () => normalizeAppData({ currentClassId: `${PRIVATE}-class`, classes: [{
  id: `${PRIVATE}-class`, name: PRIVATE,
  students: [{ id: `${PRIVATE}-student`, name: PRIVATE, points: 100,
    pet: { type: 'dog', fullness: 100, happiness: 100, level: 1 } }],
  examRecords: [], learningEvidenceRecords: [],
}], settings: { pointGuardrailsEnabled: false, participationSupportEnabled: false } });
const originalToast = useStore.getState().showToast;
const setup = (t: TestContext, privacyOptOut?: () => boolean, inspect?: (event: ProductAnalyticsWorkflowEvent) => unknown) => {
  resetStoreForSession();
  useStore.setState({ data: initial(), showToast: () => undefined });
  const events: ProductAnalyticsWorkflowEvent[] = [];
  const stop = configureProductWorkflows({ enabled: true, privacyOptOut,
    emit: (event) => { events.push(event); return inspect?.(event); } });
  setProductWorkflowScope(PRIVATE);
  t.after(() => { stop(); resetStoreForSession(); useStore.setState({ showToast: originalToast }); });
  return events;
};
const stages = (events: ProductAnalyticsWorkflowEvent[]) => events.map((event) => event.stage);
const completed = (events: ProductAnalyticsWorkflowEvent[]) => events.filter((event) => event.stage === 'local_completed');
const acknowledged = (events: ProductAnalyticsWorkflowEvent[]) => events.filter((event) => event.stage === 'backend_acknowledged');

test('default/unset scope is disabled; started, local and acknowledgement transitions are deduplicated and allowlisted', (t) => {
  const events = setup(t);
  setProductWorkflowScope(null);
  assert.equal(beginProductWorkflow('class_create'), null);
  assert.deepEqual(events, []);
  setProductWorkflowScope(PRIVATE);
  const token = beginProductWorkflow('class_create')!;
  assert.equal(beginProductWorkflow('class_create'), token);
  acknowledgeProductWorkflow(token);
  completeLocalProductWorkflow(token);
  completeLocalProductWorkflow(token);
  acknowledgeProductWorkflow(token);
  acknowledgeProductWorkflow(token);
  assert.deepEqual(stages(events), ['started', 'local_completed', 'backend_acknowledged']);
  assert.ok(events.every(Object.isFrozen));
  assert.match(token.attempt, /^[0-9a-f-]{36}$/i);
  for (const event of events) assert.deepEqual(Object.keys(event).sort(),
    ['attempt', 'class_context', 'flow', 'kind', 'schema_version', 'stage'].sort());
  assert.ok(!JSON.stringify(events).includes(PRIVATE));
  assert.equal(events[0].class_context, 'first');
  const next = beginProductWorkflow('class_create')!;
  rejectProductWorkflow(next);
  assert.equal(events.at(-1)?.class_context, 'subsequent');
  const stopped = beginProductWorkflow('roster_import')!;
  cancelProductWorkflow(stopped);
  cancelProductWorkflow(stopped);
  assert.deepEqual(stages(events).slice(-4), ['started', 'rejected', 'started', 'cancelled']);
});

test('reports complete when prepared and never manufacture backend acknowledgements', (t) => {
  const events = setup(t);
  const token = beginProductWorkflow('report_exam')!;
  completeLocalProductWorkflow(token);
  acknowledgeProductWorkflow(token);
  assert.deepEqual(stages(events), ['started', 'local_completed']);
  assert.equal(isProductWorkflowPending(token), false);
});

test('scope changes and session resets clear attempts and private persistence receipts without replay', (t) => {
  const events = setup(t);
  const scopeChanges: boolean[] = [];
  const stop = subscribeProductWorkflowScopeVerified((active) => scopeChanges.push(active));
  t.after(stop);
  useStore.getState().addClass(PRIVATE);
  const oldData = useStore.getState().data;
  const inFlight = captureProductWorkflowSave(oldData);
  assert.equal(inFlight.classCreateIntent, true);
  setProductWorkflowScope(`${PRIVATE}-next-principal`);
  inFlight.acknowledge();
  assert.equal(acknowledged(events).length, 0);
  const token = beginProductWorkflow('class_create')!;
  assert.equal(events.at(-1)?.class_context, 'first');
  resetStoreForSession();
  completeLocalProductWorkflow(token);
  useStore.setState({ data: oldData });
  setProductWorkflowScope(PRIVATE);
  captureProductWorkflowSave(oldData).acknowledge();
  assert.equal(acknowledged(events).length, 0);
  assert.equal(captureProductWorkflowSave(oldData).classCreateIntent, false);
  assert.deepEqual(scopeChanges, [true, true, false, true]);
  assert.ok(!JSON.stringify(events).includes(PRIVATE));
});

test('dynamic opt-out, DNT and GPC discard old attempts and witnesses and do not replay after opt-in', (t) => {
  let optedOut = false;
  const events = setup(t, () => optedOut);
  useStore.getState().addClass(PRIVATE);
  const save = captureProductWorkflowSave(useStore.getState().data);
  optedOut = true;
  assert.equal(save.classCreateIntent, false);
  save.acknowledge();
  optedOut = false;
  save.acknowledge();
  assert.equal(acknowledged(events).length, 0);
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => { if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator'); });
  for (const signals of [{ doNotTrack: '1' }, { doNotTrack: 'yes' }, { globalPrivacyControl: true }]) {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: signals });
    assert.equal(beginProductWorkflow('point_increase'), null);
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  captureProductWorkflowSave(useStore.getState().data).acknowledge();
  assert.equal(acknowledged(events).length, 0);
  assert.ok(beginProductWorkflow('point_increase'));
});

test('memory attempts expire and cap at sixteen without storing or leaking clock values', (t) => {
  let now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const events = setup(t);
  const expired = beginProductWorkflow('point_increase')!;
  completeLocalProductWorkflow(expired);
  now += 15 * 60_000;
  assert.equal(isProductWorkflowPending(expired), false);
  assert.equal(events.at(-1)?.stage, 'unconfirmed');
  const tokens = [];
  for (let index = 0; index < 17; index += 1) {
    const token = beginProductWorkflow('point_increase')!;
    tokens.push(token); completeLocalProductWorkflow(token);
  }
  assert.equal(isProductWorkflowPending(tokens[0]), false);
  assert.equal(tokens.slice(1).filter(isProductWorkflowPending).length, 16);
  assert.equal(events.filter((event) => event.stage === 'unconfirmed').length, 2);
  assert.ok(!JSON.stringify(events).includes(String(now)));
});

test('coalesced accepted point effects each get exactly one acknowledgement from their represented records', (t) => {
  const events = setup(t);
  useStore.getState().addPoints(`${PRIVATE}-student`, 5);
  useStore.getState().adjustPointsForStudents([`${PRIVATE}-student`], -2);
  useStore.getState().addStudentsByName([`${PRIVATE}-imported`]);
  assert.equal(completed(events).length, 3);
  const save = captureProductWorkflowSave(useStore.getState().data);
  assert.equal(save.classCreateIntent, false);
  save.acknowledge(); save.acknowledge();
  assert.equal(acknowledged(events).length, 3);
  assert.equal(new Set(acknowledged(events).map((event) => event.attempt)).size, 3);
  assert.ok(!JSON.stringify(events).includes(PRIVATE));
});

test('an older in-flight draft cannot acknowledge a command queued after its capture', (t) => {
  const events = setup(t);
  useStore.getState().addPoints(`${PRIVATE}-student`, 5);
  const oldSave = captureProductWorkflowSave(useStore.getState().data);
  const firstAttempt = completed(events)[0].attempt;
  useStore.getState().addPoints(`${PRIVATE}-student`, 6);
  useStore.getState().addClass(PRIVATE);
  const newAttempts = completed(events).slice(1).map((event) => event.attempt);
  assert.equal(oldSave.classCreateIntent, false);
  oldSave.acknowledge();
  assert.deepEqual(acknowledged(events).map((event) => event.attempt), [firstAttempt]);
  const newSave = captureProductWorkflowSave(useStore.getState().data);
  assert.equal(newSave.classCreateIntent, true);
  newSave.acknowledge();
  assert.deepEqual(acknowledged(events).slice(1).map((event) => event.attempt), newAttempts);
});

test('server normalization that omits a sent effect cannot become persistence proof', (t) => {
  const events = setup(t);
  const original = useStore.getState().data;
  useStore.getState().addPoints(`${PRIVATE}-student`, 5);
  const save = captureProductWorkflowSave(useStore.getState().data);
  save.acknowledge(original);
  assert.equal(acknowledged(events).length, 0);
  assert.equal(events.at(-1)?.stage, 'unconfirmed');
});

test('undo, learner deletion and exam deletion cannot falsely acknowledge effects absent from a coalesced draft', (t) => {
  const events = setup(t);
  useStore.getState().addPoints(`${PRIVATE}-student`, 5);
  useStore.getState().undoLastPointAdjustment();
  useStore.getState().addStudentsByName([`${PRIVATE}-imported`]);
  const added = useStore.getState().data.classes[0].students.find((student) => student.name.endsWith('-imported'))!;
  useStore.getState().deleteStudent(added.id);
  const exam: ExamRecord = { id: `${PRIVATE}-exam`, title: PRIVATE, examDate: '2026-11-01',
    items: [{ id: `${PRIVATE}-item`, name: PRIVATE, maxScore: 100 }], results: [], createdAt: 1, updatedAt: 1 };
  useStore.getState().saveExamRecord(exam);
  useStore.getState().saveExamRecord({ ...exam, title: `${PRIVATE}-edited` });
  assert.equal(events.filter((event) => event.flow === 'exam_create' && event.stage === 'started').length, 1);
  useStore.getState().deleteExamRecord(exam.id);
  captureProductWorkflowSave(useStore.getState().data).acknowledge();
  assert.equal(acknowledged(events).length, 0);
  assert.equal(events.filter((event) => event.stage === 'unconfirmed').length, 3);
});

test('deleted class intents and identical-409 equivalence are unconfirmed, never fresh write acknowledgements', (t) => {
  const events = setup(t);
  useStore.getState().addClass(PRIVATE);
  const classId = useStore.getState().data.currentClassId;
  useStore.getState().deleteClass(classId);
  const deletedSave = captureProductWorkflowSave(useStore.getState().data);
  assert.equal(deletedSave.classCreateIntent, false);
  deletedSave.acknowledge();
  useStore.getState().addPoints(`${PRIVATE}-student`, 5);
  const equivalentSave = captureProductWorkflowSave(useStore.getState().data);
  equivalentSave.unconfirmed(); equivalentSave.acknowledge();
  assert.equal(acknowledged(events).length, 0);
  assert.equal(events.filter((event) => event.stage === 'unconfirmed').length, 2);
});

test('validation failures reject attempts; throwing and rejected emitters never change store results', async (t) => {
  const events = setup(t, undefined, () => { throw new Error(PRIVATE); });
  assert.doesNotThrow(() => useStore.getState().addPoints('missing-student', 10));
  assert.doesNotThrow(() => useStore.getState().addPoints(`${PRIVATE}-student`, 0));
  assert.equal(useStore.getState().addStudentsByName([' ']), 0);
  assert.deepEqual(stages(events), ['started', 'rejected', 'started', 'rejected', 'started', 'rejected']);
  const stop = configureProductWorkflows({ enabled: true, emit: () => Promise.reject(new Error(PRIVATE)) });
  t.after(stop);
  assert.equal(useStore.getState().addStudentsByName([`${PRIVATE}-new`]), 1);
  assert.equal(useStore.getState().data.classes[0].students.length, 2);
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test('first-party progress helpers and explicit class intent use the authenticated API without changing snapshot bodies', async (t) => {
  t.after(clearAuthentication);
  const requests: Array<{ path: string; init: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    requests.push({ path, init });
    return Response.json({ eligible: true, state: null, revision: 2 });
  });
  setActiveWorkspaceId('ws_synthetic');
  assert.deepEqual(await getProductOnboardingState(), { eligible: true, state: null, revision: 2 });
  await updateProductOnboarding('started');
  const data = initial();
  await saveBackendState(data, 1, undefined, undefined, undefined, false);
  await saveBackendState(data, 1, undefined, undefined, undefined, true);
  assert.deepEqual(requests.slice(0, 2).map((item) => item.path), ['/api/v1/product-onboarding', '/api/v1/product-onboarding']);
  assert.equal(requests[0].init.credentials, 'same-origin');
  assert.equal(new Headers(requests[0].init.headers).get('x-epet-workspace'), 'ws_synthetic');
  assert.deepEqual(JSON.parse(String(requests[1].init.body)), { stage: 'started' });
  assert.equal(new Headers(requests[2].init.headers).get('x-epet-class-create-intent'), null);
  assert.equal(new Headers(requests[3].init.headers).get('x-epet-class-create-intent'), '1');
  assert.deepEqual(JSON.parse(String(requests[3].init.body)), JSON.parse(JSON.stringify({ data, baseRevision: 1 })));
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => { if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator'); });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { globalPrivacyControl: true } });
  await saveBackendState(data, 1, undefined, undefined, undefined, true);
  assert.equal(new Headers(requests[4].init.headers).get('x-epet-class-create-intent'), null);
});

test('sync acknowledges only checked current responses, distinguishes equivalence, and keeps receipts out of persisted drafts', async () => {
  const source = await readFile(new URL('../src/hooks/useBackendSync.ts', import.meta.url), 'utf8');
  assert.ok(source.indexOf('const workflowSave = captureProductWorkflowSave(draft.data)') < source.indexOf('const saved = await saveBackendState'));
  assert.match(source, /const saved = await saveBackendState\([\s\S]*?if \(!isCurrent\(\)\) return false;[\s\S]*?workflowSave\.acknowledge\(saved\.data\)/);
  assert.match(source, /sameWorkspaceData\(error\.current\.data, draft\.data\)[\s\S]*?workflowSave\.unconfirmed\(\)/);
  const drafts = await readFile(new URL('../src/services/workspaceDrafts.ts', import.meta.url), 'utf8');
  assert.ok(!drafts.includes('ProductWorkflow'));
  const workflow = await readFile(new URL('../src/analytics/workflows.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /localStorage|sessionStorage|fetch\(|console\.|reportFrontendError/);
  clearProductWorkflows();
});
