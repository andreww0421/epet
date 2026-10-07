import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { configureAnalytics, type AnalyticsEvent } from '../src/analytics';
import { runWorkspaceMutation } from '../src/auth/workspaceAccess';
import { createPointAdjustmentRecord } from '../src/gameRules';
import { resetStoreForSession, useStore } from '../src/store/useStore';
import { normalizeAppData } from '../src/store/utils';
import type { AppData, ExamRecord, LearningEvidenceInput } from '../src/store/types';

const sensitive = 'SYNTHETIC-STUDENT-NAME-ID-COMMENT-EVIDENCE-EMAIL-TOKEN';
const firstStudentId = `${sensitive}-first`;
const secondStudentId = `${sensitive}-second`;
const classId = `${sensitive}-class`;
const originalShowToast = useStore.getState().showToast;

const dataFixture = (settings: Partial<NonNullable<AppData['settings']>> = {}) => normalizeAppData({
  currentClassId: classId,
  classes: [{
    id: classId,
    name: sensitive,
    students: [
      { id: firstStudentId, name: sensitive, points: 100, pet: { type: 'dog', fullness: 100, happiness: 100, level: 1 } },
      { id: secondStudentId, name: `${sensitive}-second`, points: 500, pet: { type: 'cat', fullness: 100, happiness: 100, level: 1 } },
    ],
    learningEvidenceRecords: [],
    examRecords: [],
  }],
  settings: {
    language: 'en', maxPoints: 700, schoolTimeZone: 'Asia/Taipei',
    pointGuardrailsEnabled: false, participationSupportEnabled: false, ...settings,
  },
});

const collect = (t: TestContext, inspect?: (event: AnalyticsEvent) => void) => {
  resetStoreForSession();
  useStore.setState({ data: dataFixture(), showToast: () => undefined });
  const events: AnalyticsEvent[] = [];
  const stop = configureAnalytics({
    enabled: true,
    environment: 'development',
    sink: (event) => { inspect?.(event); events.push(event); },
  });
  t.after(() => {
    stop();
    resetStoreForSession();
    useStore.setState({ showToast: originalShowToast });
  });
  return events;
};

const evidence: LearningEvidenceInput = {
  competency: 'participation', level: 'progressing', evidenceType: 'observation',
  title: sensitive, note: sensitive, sourceId: sensitive,
};
const exam = (): ExamRecord => ({
  id: `${sensitive}-exam`, title: sensitive, examDate: '2026-10-07',
  items: [{ id: `${sensitive}-item`, name: sensitive, maxScore: 100 }],
  results: [{ studentId: firstStudentId, scores: { [`${sensitive}-item`]: 73 }, mentorComment: sensitive, updatedAt: 1 }],
  createdAt: 1, updatedAt: 1,
});

test('class and roster completion events are emitted only after the state is committed', (t) => {
  const events = collect(t, (event) => {
    const state = useStore.getState();
    if (event.name === 'class_created') assert.equal(state.data.classes.length, 2);
    if (event.name === 'student_import_completed') {
      assert.equal(state.data.classes.find((item) => item.id === classId)?.students.length, 3);
    }
  });
  useStore.getState().addClass(sensitive);
  useStore.getState().switchClass(classId);
  assert.equal(useStore.getState().addStudentsByName(['', sensitive, sensitive, `${sensitive}-imported`]), 1);
  assert.deepEqual(events, [
    { name: 'class_created', metadata: {}, environment: 'development', schema_version: 1 },
    { name: 'student_import_completed', metadata: { student_count: 1 }, environment: 'development', schema_version: 1 },
  ]);
  assert.ok(!JSON.stringify(events).includes(sensitive));
});

test('duplicate, invalid, denied and missing-class imports do not count as completed actions', (t) => {
  const events = collect(t);
  assert.equal(useStore.getState().addStudentsByName([' ', sensitive, 'x'.repeat(81)]), 0);
  assert.equal(runWorkspaceMutation(false, () => useStore.getState().addClass(sensitive)), undefined);
  assert.equal(runWorkspaceMutation(false, () => useStore.getState().addStudentsByName(['New synthetic learner'])), undefined);
  useStore.getState().switchClass('missing-class');
  assert.equal(useStore.getState().addStudentsByName(['New synthetic learner']), 0);
  assert.deepEqual(events, []);
});

test('point actions report one aggregate event per action and count each accepted learner once', (t) => {
  const events = collect(t);
  useStore.getState().addPoints(firstStudentId, 5, 'quick', { id: sensitive, label: sensitive });
  useStore.getState().adjustPointsForStudents([firstStudentId, secondStudentId, firstStudentId, 'missing'], -3, 'manual', { label: sensitive });
  useStore.getState().airdropPoints(2, sensitive, 'collaboration');
  assert.deepEqual(events.map(({ name, metadata }) => ({ name, metadata })), [
    { name: 'point_action_completed', metadata: { student_count: 1, action_source: 'quick', direction: 'increase' } },
    { name: 'point_action_completed', metadata: { student_count: 2, action_source: 'manual', direction: 'decrease' } },
    { name: 'point_action_completed', metadata: { student_count: 2, action_source: 'airdrop', direction: 'increase' } },
  ]);
  assert.deepEqual(useStore.getState().data.classes[0].students.map(({ points }) => points), [104, 499]);
  assert.ok(!JSON.stringify(events).includes(sensitive));
});

test('guardrail-blocked, zero and missing-target point actions emit no completed event', (t) => {
  const events = collect(t);
  const now = Date.now();
  const data = dataFixture({ pointGuardrailsEnabled: true, dailyPositivePointLimit: 200 });
  data.classes[0].students[0].pointAdjustmentRecords = [createPointAdjustmentRecord(200, 'quick', undefined, now)];
  useStore.setState({ data });
  useStore.getState().addPoints(firstStudentId, 10);
  useStore.getState().adjustPointsForStudents([firstStudentId], 10);
  useStore.getState().addPoints(secondStudentId, 0);
  useStore.getState().addPoints(secondStudentId, Number.NaN);
  useStore.getState().addPoints('missing', 10);
  useStore.getState().adjustPointsForStudents([], 10);
  useStore.getState().adjustPointsForStudents(['missing'], 10);
  assert.deepEqual(events, []);
  assert.equal(useStore.getState().data.classes[0].students[0].points, 100);
  useStore.getState().airdropPoints(5, sensitive);
  assert.deepEqual(events.map(({ metadata }) => metadata), [
    { student_count: 1, action_source: 'airdrop', direction: 'increase' },
  ]);
  useStore.getState().switchClass('missing');
  useStore.getState().addPoints(firstStudentId, 10);
  useStore.getState().adjustPointsForStudents([firstStudentId], 10);
  useStore.getState().airdropPoints(10);
  assert.equal(events.length, 1);
});

test('participation support and undo do not duplicate the teacher point completion', (t) => {
  const events = collect(t);
  useStore.setState({ data: dataFixture({
    participationSupportEnabled: true, minimumDailyParticipationPoints: 20,
    catchUpGapThreshold: 100, dailyCatchUpBonus: 10,
  }) });
  useStore.getState().addPoints(firstStudentId, 5, 'manual', { label: sensitive, competency: 'participation' });
  assert.equal(useStore.getState().data.classes[0].students[0].points, 130);
  assert.equal(useStore.getState().undoAction?.entries.length, 3);
  assert.deepEqual(events.map(({ metadata }) => metadata), [
    { student_count: 1, action_source: 'manual', direction: 'increase' },
  ]);
  useStore.getState().undoLastPointAdjustment();
  assert.equal(useStore.getState().data.classes[0].students[0].points, 100);
  assert.equal(events.length, 1);
});

test('automated points, hydration, backup restoration and reflection evidence are not teacher events', (t) => {
  const events = collect(t);
  useStore.getState().addPoints(firstStudentId, 1, 'dailyTask');
  useStore.getState().adjustPointsForStudents([firstStudentId], 1, 'participationTopUp');
  useStore.getState().addPoints(firstStudentId, 1, 'catchUpBonus');
  useStore.getState().saveMentorDailyFeedback(firstStudentId, {
    competency: 'participation', assessment: 'progressing', text: sensitive,
  });
  assert.equal(useStore.getState().data.classes[0].learningEvidenceRecords?.length, 1);
  useStore.setState({ data: dataFixture() });
  useStore.getState().importData(dataFixture());
  resetStoreForSession();
  assert.deepEqual(events, []);
});

test('manual evidence reports accepted creation without sending its learner or contents', (t) => {
  const events = collect(t, (event) => {
    if (event.name === 'learning_evidence_created') {
      assert.equal(useStore.getState().data.classes[0].learningEvidenceRecords?.length, 1);
    }
  });
  useStore.getState().addLearningEvidence(firstStudentId, { ...evidence, title: ' ' });
  useStore.getState().addLearningEvidence('missing', evidence);
  assert.equal(runWorkspaceMutation(false, () => useStore.getState().addLearningEvidence(firstStudentId, evidence)), undefined);
  useStore.getState().addLearningEvidence(firstStudentId, evidence);
  useStore.getState().switchClass('missing');
  useStore.getState().addLearningEvidence(firstStudentId, evidence);
  assert.deepEqual(events, [{ name: 'learning_evidence_created', metadata: {}, environment: 'development', schema_version: 1 }]);
  assert.equal(useStore.getState().data.classes[0].students[0].points, 100);
  assert.ok(!JSON.stringify(events).includes(sensitive));
});

test('exam completion counts a new normalized record once, not edits or invalid drafts', (t) => {
  const events = collect(t, (event) => {
    if (event.name === 'exam_created') assert.equal(useStore.getState().data.classes[0].examRecords?.length, 1);
  });
  useStore.getState().saveExamRecord({ ...exam(), items: [] });
  useStore.getState().saveExamRecord(exam());
  useStore.getState().saveExamRecord({ ...exam(), title: `${sensitive}-updated` });
  assert.equal(useStore.getState().data.classes[0].examRecords?.[0].title, `${sensitive}-updated`);
  useStore.getState().switchClass('missing');
  useStore.getState().saveExamRecord({ ...exam(), id: 'new-id' });
  assert.deepEqual(events, [{ name: 'exam_created', metadata: {}, environment: 'development', schema_version: 1 }]);
  assert.ok(!JSON.stringify(events).includes(sensitive));
});

test('boss completion follows normalization without changing empty-name gameplay behavior', (t) => {
  const events = collect(t, (event) => {
    if (event.name === 'boss_started') assert.ok(useStore.getState().data.classes[0].activeBoss?.isActive);
  });
  useStore.getState().summonBoss('', 0, []);
  const boss = useStore.getState().data.classes[0].activeBoss;
  assert.equal(boss?.name, 'Unknown Boss');
  assert.equal(boss?.maxHp, 1);
  useStore.getState().removeBoss();
  useStore.getState().switchClass('missing');
  useStore.getState().summonBoss(sensitive, 50, []);
  assert.deepEqual(events, [{ name: 'boss_started', metadata: {}, environment: 'development', schema_version: 1 }]);
});

test('a failed analytics sink cannot change action results, state or existing return types', (t) => {
  collect(t);
  const stop = configureAnalytics({ enabled: true, environment: 'development', sink: () => { throw new Error(sensitive); } });
  t.after(stop);
  assert.equal(useStore.getState().addStudentsByName([`${sensitive}-imported`]), 1);
  assert.equal(useStore.getState().addPoints(firstStudentId, 5), undefined);
  assert.equal(useStore.getState().addLearningEvidence(firstStudentId, evidence), undefined);
  assert.equal(useStore.getState().saveExamRecord(exam()), undefined);
  assert.equal(useStore.getState().summonBoss(sensitive, 50, []), undefined);
  assert.equal(useStore.getState().data.classes[0].students.length, 3);
  assert.equal(useStore.getState().data.classes[0].students[0].points, 105);
  assert.equal(useStore.getState().data.classes[0].learningEvidenceRecords?.length, 1);
  assert.equal(useStore.getState().data.classes[0].examRecords?.length, 1);
  assert.ok(useStore.getState().data.classes[0].activeBoss?.isActive);
  assert.equal(useStore.getState().addClass(sensitive), undefined);
  assert.equal(useStore.getState().data.classes.length, 2);
});
