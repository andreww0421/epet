import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAnalyticsClient, sanitizeAnalyticsEvent, type AnalyticsEvent } from '../src/analytics';
import { MAX_ANALYTICS_COUNT } from '../src/analytics/schema';

const privateText = 'SYNTHETIC-STUDENT-NAME-ID-SCORE-COMMENT-EVIDENCE-EMAIL-PASSWORD-SESSION-CSRF';
const cases = [
  { name: 'workspace_created', metadata: { creation_source: 'registration' } },
  { name: 'class_created', metadata: {} },
  { name: 'student_import_completed', metadata: { student_count: 25 } },
  { name: 'point_action_completed', metadata: { student_count: 25, action_source: 'manual', direction: 'increase' } },
  { name: 'learning_evidence_created', metadata: {} },
  { name: 'exam_created', metadata: {} },
  { name: 'report_generated', metadata: { report_type: 'weekly_feedback', format: 'csv' } },
  { name: 'report_generated', metadata: { report_type: 'exam_summary', format: 'print' } },
  { name: 'boss_started', metadata: {} },
  { name: 'feature_opened', metadata: { feature: 'student-insights' } },
] as const;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('all events rebuild an exact anonymous schema and drop nested content, context, identifiers and visitor environment', () => {
  for (const candidate of cases) {
    const safe = sanitizeAnalyticsEvent({
      ...candidate, environment: privateText, schema_version: privateText, student_id: privateText, user: privateText,
      url: privateText, timestamp: privateText, metadata: { ...candidate.metadata, student_name: privateText,
        student_id: privateText, exam_score: 98.25, teacher_comment: privateText, learning_evidence: privateText,
        email: privateText, session_token: privateText, csrf_token: privateText, nested: { data: privateText },
        toJSON: () => ({ password: privateText }) },
    }, 'staging');
    assert.deepEqual(safe, { ...candidate, environment: 'staging', schema_version: 1 });
    assert.ok(!JSON.stringify(safe).includes(privateText));
    assert.ok(Object.isFrozen(safe));
    assert.ok(Object.isFrozen(safe?.metadata));
  }
});

test('invalid names, dynamic feature values, scores-as-counts, report formats and environments fail closed', () => {
  for (const environment of [undefined, '', 'preview', privateText]) assert.equal(sanitizeAnalyticsEvent(cases[0], environment), undefined);
  for (const count of [0, -1, 25.5, NaN, Infinity, '25', privateText, MAX_ANALYTICS_COUNT + 1, Date.now()]) {
    assert.equal(sanitizeAnalyticsEvent({ name: 'student_import_completed', metadata: { student_count: count } }, 'production'), undefined);
  }
  for (const candidate of [
    { name: privateText, metadata: {} }, { name: 'exam_created', metadata: [] },
    { name: 'feature_opened', metadata: { feature: `/students/${privateText}` } },
    { name: 'report_generated', metadata: { report_type: 'weekly_feedback', format: 'print' } },
    { name: 'point_action_completed', metadata: { student_count: 25, action_source: 'dailyTask', direction: 'increase' } },
    { name: 'workspace_created', metadata: { creation_source: privateText } },
  ]) assert.equal(sanitizeAnalyticsEvent(candidate, 'production'), undefined);
});

test('getters, prototypes, arbitrary serializers and hostile proxies never cross the boundary', () => {
  let reads = 0;
  const secretGetter = { get student_count() { reads++; throw new Error(privateText); } };
  assert.equal(sanitizeAnalyticsEvent({ name: 'student_import_completed', metadata: secretGetter }, 'staging'), undefined);
  assert.equal(sanitizeAnalyticsEvent({ get name() { reads++; throw new Error(privateText); }, metadata: {} }, 'staging'), undefined);
  assert.equal(reads, 0);
  assert.equal(sanitizeAnalyticsEvent({ name: 'student_import_completed', metadata: Object.create({ student_count: 25 }) }, 'staging'), undefined);
  assert.equal(sanitizeAnalyticsEvent(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(privateText); } }), 'staging'), undefined);
});

test('default, disabled and invalid configurations deliver nothing without buffering or production fallback', async () => {
  const received: AnalyticsEvent[] = [];
  const client = createAnalyticsClient(() => false);
  client.track('class_created', {});
  client.configure({ enabled: false, environment: 'production', sink: (event) => { received.push(event); } });
  client.track('class_created', {});
  client.configure({ enabled: true, environment: 'preview' as 'staging', sink: (event) => { received.push(event); } });
  client.track('class_created', {});
  client.configure({ enabled: true, environment: 'staging', sink: (event) => { received.push(event); } });
  await tick();
  assert.equal(received.length, 0, 'Dropped events must never replay on enablement');
  client.track('class_created', {});
  assert.deepEqual(received, [{ name: 'class_created', metadata: {}, environment: 'staging', schema_version: 1 }]);
});

test('explicit environment separation and stale cleanup cannot disable a replacement adapter', () => {
  const received: AnalyticsEvent[] = [];
  const client = createAnalyticsClient(() => false);
  const stopFirst = client.configure({ enabled: true, environment: 'staging', sink: (event) => { received.push(event); } });
  client.track('class_created', {});
  const stopSecond = client.configure({ enabled: true, environment: 'production', sink: (event) => { received.push(event); } });
  stopFirst();
  client.track('class_created', {});
  stopSecond();
  client.track('class_created', {});
  assert.deepEqual(received.map(({ environment }) => environment), ['staging', 'production']);
});

test('synchronous and asynchronous adapter failures are silent and do not change later product events', async (t) => {
  const logs: unknown[] = [];
  t.mock.method(console, 'error', (...values: unknown[]) => logs.push(values));
  const client = createAnalyticsClient(() => false);
  client.configure({ enabled: true, environment: 'development', sink: () => { throw new Error(privateText); } });
  assert.doesNotThrow(() => client.track('class_created', {}));
  client.configure({ enabled: true, environment: 'development', sink: () => Promise.reject(new Error(privateText)) });
  assert.doesNotThrow(() => client.track('class_created', {}));
  await tick();
  const received: AnalyticsEvent[] = [];
  client.configure({ enabled: true, environment: 'development', sink: (event) => { received.push(event); } });
  client.track('class_created', {});
  assert.equal(received.length, 1);
  assert.deepEqual(logs, []);
});

test('privacy opt-out applies at initialization and immediately on later events', () => {
  let optedOut = true;
  const received: AnalyticsEvent[] = [];
  const client = createAnalyticsClient(() => optedOut);
  const configuration = { enabled: true, environment: 'staging' as const, sink: (event: AnalyticsEvent) => { received.push(event); } };
  client.configure(configuration);
  client.track('class_created', {});
  optedOut = false;
  client.configure(configuration);
  client.track('class_created', {});
  optedOut = true;
  client.track('class_created', {});
  assert.equal(received.length, 1);
});

test('delivery is reentrancy-safe, bounded and retains no retry queue', async () => {
  const client = createAnalyticsClient(() => false);
  let calls = 0;
  let release: () => void;
  const outstanding = new Promise<void>((resolve) => { release = resolve; });
  client.configure({ enabled: true, environment: 'development', sink: () => {
    calls++;
    client.track('class_created', {});
    return outstanding;
  } });
  for (let count = 0; count < 30; count++) client.track('class_created', {});
  assert.equal(calls, 16);
  release!();
  await tick();
  assert.equal(calls, 16);
  client.track('class_created', {});
  assert.equal(calls, 17);
});

test('core imports no React, Zustand, vendor SDK, network, storage, identity or error-monitoring APIs', async () => {
  for (const file of ['index.ts', 'client.ts', 'schema.ts', 'actions.ts']) {
    const source = await readFile(new URL(`../src/analytics/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"](?:react|zustand|@sentry|posthog|mixpanel|@segment|firebase)/);
    assert.doesNotMatch(source, /\b(?:fetch|sendBeacon|localStorage|sessionStorage|console\.log|console\.error|captureException)\s*[.(]/);
  }
});
