import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirstPartyTransport, createProductOnboardingObserver,
  initializeFirstPartyProductAnalytics } from '../src/analytics/firstParty';
import { configureAnalytics, trackAnalytics } from '../src/analytics';

const event = { schema_version: 2, kind: 'workflow', attempt: '12345678-1234-4123-8123-123456789abc',
  flow: 'class_create', stage: 'started', class_context: 'first' } as const;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('first-party transport rebuilds payload and omits credentials, referrer, redirects and caller context', async () => {
  const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
  const transport = createFirstPartyTransport(async (url, init) => {
    calls.push([url, init]); return new Response(null, { status: 202 });
  }, () => false);
  await transport.emit({ ...event, studentName: 'PRIVATE', token: 'PRIVATE', workspace: 'PRIVATE',
    nested: { grade: 73 }, environment: 'attacker' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/v1/product-analytics');
  assert.deepEqual(JSON.parse(String(calls[0][1]?.body)), event);
  assert.equal(calls[0][1]?.credentials, 'omit');
  assert.equal(calls[0][1]?.referrerPolicy, 'no-referrer');
  assert.equal(calls[0][1]?.redirect, 'error');
  assert.deepEqual(calls[0][1]?.headers, { 'content-type': 'application/json' });
  transport.dispose();
});

test('transport failures are silent, never retried and bounded to 120 requests per minute', async () => {
  let calls = 0; let clock = 1000;
  const transport = createFirstPartyTransport(async () => { calls++; throw new Error('PRIVATE'); }, () => false, () => clock);
  for (let index = 0; index < 125; index++) await transport.emit(event);
  assert.equal(calls, 120);
  clock += 60_000;
  await transport.emit(event);
  assert.equal(calls, 121);
  transport.dispose(); await transport.emit(event);
  assert.equal(calls, 121);
});

test('dynamic privacy opt-out aborts pending sends and sends no later event', async () => {
  let optedOut = false; let calls = 0; const signals: AbortSignal[] = [];
  const transport = createFirstPartyTransport(async (_url, init) => {
    calls++; const signal = init!.signal!; signals.push(signal);
    return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  }, () => optedOut);
  const pending = Array.from({ length: 18 }, () => transport.emit(event));
  assert.equal(calls, 16);
  optedOut = true; await transport.emit(event);
  await Promise.all(pending);
  assert.ok(signals.every((signal) => signal.aborted));
  transport.dispose();
});

test('disabled/invalid bootstrap preserves an explicitly configured local adapter and performs no I/O', () => {
  const received: unknown[] = [];
  const stop = configureAnalytics({ enabled: true, environment: 'development', sink: (value) => { received.push(value); } });
  const send = async () => { throw new Error('must not send'); };
  initializeFirstPartyProductAnalytics({ enabled: 'false', environment: 'production' }, { send });
  initializeFirstPartyProductAnalytics({ enabled: 'true', environment: 'invalid' }, { send });
  trackAnalytics('class_created', {});
  assert.equal(received.length, 1); stop();
});

test('onboarding waits for enrollment, emits only two allowed stages and discards old authority callbacks', async () => {
  const calls: string[] = []; let resolveEnrollment!: (value: { eligible: boolean; state: null }) => void;
  const observer = createProductOnboardingObserver(async (stage) => {
    calls.push(stage);
    if (stage === 'enroll') return new Promise((resolve) => { resolveEnrollment = resolve; });
    return { eligible: true, state: null };
  }, () => false);
  observer.scope(true); observer.observe(event);
  observer.scope(false); resolveEnrollment({ eligible: true, state: null }); await tick();
  assert.deepEqual(calls, ['enroll']);
  observer.scope(true); observer.observe(event);
  observer.observe({ ...event, stage: 'local_completed' });
  observer.observe({ ...event, stage: 'backend_acknowledged' });
  resolveEnrollment({ eligible: true, state: null }); await tick();
  assert.deepEqual(calls, ['enroll', 'enroll', 'started', 'local_completed']);
  observer.dispose();
});

test('ineligible and opted-out onboarding never reports teacher progress', async () => {
  let calls = 0; let privacy = false;
  const observer = createProductOnboardingObserver(async () => { calls++; return { eligible: false, state: null }; }, () => privacy);
  observer.scope(true); observer.observe(event); await tick();
  assert.equal(calls, 1);
  privacy = true; observer.scope(true); observer.observe(event); await tick();
  assert.equal(calls, 1); observer.dispose();
});

test('onboarding serializes required stages and bounds duplicate observations across repeated class creations', async () => {
  const calls: string[] = [];
  let releaseStarted!: () => void;
  const startedPending = new Promise<void>((resolve) => { releaseStarted = resolve; });
  const state = { cohortDay: '2026-11-02', started: false, localReported: false, backendPersisted: false };
  const observer = createProductOnboardingObserver(async (stage) => {
    calls.push(stage);
    if (stage === 'started') { await startedPending; state.started = true; }
    if (stage === 'local_completed') { assert.equal(state.started, true); state.localReported = true; }
    return { eligible: true, state: { ...state } };
  }, () => false);
  observer.scope(true);
  for (let index = 0; index < 50; index++) {
    observer.observe(event); observer.observe({ ...event, stage: 'local_completed' });
  }
  await tick();
  assert.deepEqual(calls, ['enroll', 'started']);
  releaseStarted(); await tick();
  assert.deepEqual(calls, ['enroll', 'started', 'local_completed']);
  assert.equal(state.localReported, true); observer.dispose();
});

test('existing cross-login onboarding progress does not resend already recorded stages', async () => {
  const calls: string[] = [];
  const observer = createProductOnboardingObserver(async (stage) => {
    calls.push(stage);
    return { eligible: true, state: { cohortDay: '2026-11-02', started: true, localReported: true, backendPersisted: true } };
  }, () => false);
  observer.scope(true); observer.observe(event); observer.observe({ ...event, stage: 'local_completed' });
  await tick(); assert.deepEqual(calls, ['enroll']); observer.dispose();
});
