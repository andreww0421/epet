import assert from 'node:assert/strict';
import test from 'node:test';
import { buildScheduledOperationsReport } from '../shared/observability/operations';

const release = '0123456789abcdef0123456789abcdef01234567';
const projection = {
  checked: 4, verified: 4, mismatched: 0, missing: 0, repaired: 0, truncated: false,
};
const input = {
  environment: 'staging', release, scheduledTime: 120_001, startedAt: 120_100,
  completedAt: 121_100, outcome: 'completed', projection,
};

test('completed scheduled report has a fixed global contract and minute-granularity timestamps', () => {
  assert.deepEqual(buildScheduledOperationsReport(input), {
    schemaVersion: 1, kind: 'scheduled-maintenance', environment: 'staging', release,
    outcome: 'completed', scheduledMinute: 2, completedMinute: 2,
    durationBucket: '1s-10s', projection, coverage: 'complete', health: 'ok',
  });
  assert.deepEqual(buildScheduledOperationsReport({ ...input,
    projection: { checked: 0, verified: 0, mismatched: 0, missing: 0, repaired: 0, truncated: false },
  })?.health, 'ok');
});

test('repaired, missing, mismatched and truncated results remain visibly degraded', () => {
  for (const fixture of [
    { ...projection, repaired: 1 },
    { ...projection, verified: 3, missing: 1 },
    { ...projection, verified: 3, mismatched: 1 },
    { ...projection, truncated: true },
  ]) {
    const result = buildScheduledOperationsReport({ ...input, projection: fixture });
    assert.equal(result?.health, 'degraded');
    assert.equal(result?.coverage, fixture.truncated ? 'incomplete' : 'complete');
  }
});

test('failed reports require no projection and cannot claim completed coverage', () => {
  const result = buildScheduledOperationsReport({ ...input, outcome: 'failed', projection: undefined });
  assert.equal(result?.health, 'failed');
  assert.equal(result?.coverage, 'unknown');
  assert.equal(Object.hasOwn(result!, 'projection'), false);
  const partial = buildScheduledOperationsReport({ ...input, outcome: 'failed' });
  assert.equal(partial?.health, 'failed');
  assert.equal(partial?.coverage, 'unknown');
  assert.deepEqual(partial?.projection, projection);
  assert.equal(buildScheduledOperationsReport({ ...input, projection: undefined }), undefined);
});

test('duration buckets have exact finite boundaries and do not expose precise elapsed milliseconds', () => {
  for (const [duration, bucket] of [
    [0, 'lt-1s'], [999, 'lt-1s'], [1_000, '1s-10s'], [9_999, '1s-10s'],
    [10_000, '10s-60s'], [59_999, '10s-60s'], [60_000, 'gte-60s'],
    [1_000_000, 'gte-60s'],
  ] as const) {
    const result = buildScheduledOperationsReport({ ...input, completedAt: input.startedAt + duration });
    assert.equal(result?.durationBucket, bucket);
    assert.equal(Object.hasOwn(result!, 'duration'), false);
    assert.equal(Object.hasOwn(result!, 'startedAt'), false);
    assert.equal(Object.hasOwn(result!, 'completedAt'), false);
  }
});

test('only explicit environments and valid optional commit releases survive', () => {
  for (const environment of ['development', 'staging', 'production']) {
    assert.equal(buildScheduledOperationsReport({ ...input, environment })?.environment, environment);
  }
  for (const environment of [undefined, '', 'Production', 'preview', 'https://production.invalid', 1, {}]) {
    assert.equal(buildScheduledOperationsReport({ ...input, environment }), undefined);
  }
  for (const invalid of [undefined, null, '', release.toUpperCase(), 'secret-user@example.invalid', {}, 1]) {
    const result = buildScheduledOperationsReport({ ...input, release: invalid });
    assert.ok(result);
    assert.equal(Object.hasOwn(result, 'release'), false);
  }
});

test('malformed timestamps, outcomes and impossible time ordering fail closed', () => {
  for (const field of ['scheduledTime', 'startedAt', 'completedAt']) {
    for (const value of [undefined, null, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '120100', {}, []]) {
      assert.equal(buildScheduledOperationsReport({ ...input, [field]: value }), undefined, field);
    }
  }
  for (const outcome of [undefined, null, '', 'success', 'failure', true, 1]) {
    assert.equal(buildScheduledOperationsReport({ ...input, outcome }), undefined);
  }
  assert.equal(buildScheduledOperationsReport({ ...input, scheduledTime: input.startedAt + 1 }), undefined);
  assert.equal(buildScheduledOperationsReport({ ...input, completedAt: input.startedAt - 1 }), undefined);
  assert.ok(buildScheduledOperationsReport({ ...input, scheduledTime: 0, startedAt: 0, completedAt: 0 }));
});

test('projection counters are bounded integers with consistent partitions and repair counts', () => {
  for (const field of ['checked', 'verified', 'mismatched', 'missing', 'repaired']) {
    for (const value of [undefined, null, -1, 0.5, NaN, Infinity, -Infinity, 1_000_001, Number.MAX_VALUE, '4', {}, []]) {
      assert.equal(buildScheduledOperationsReport({ ...input, projection: { ...projection, [field]: value } }), undefined, field);
    }
  }
  for (const truncated of [undefined, null, 0, 1, 'false', {}]) {
    assert.equal(buildScheduledOperationsReport({ ...input, projection: { ...projection, truncated } }), undefined);
  }
  for (const invalid of [null, [], 1, 'projection', {}, { ...projection, verified: 3 },
    { ...projection, mismatched: 1 }, { ...projection, repaired: 5 }]) {
    assert.equal(buildScheduledOperationsReport({ ...input, projection: invalid }), undefined);
    assert.equal(buildScheduledOperationsReport({ ...input, outcome: 'failed', projection: invalid }), undefined);
  }
  assert.ok(buildScheduledOperationsReport({ ...input, projection: {
    checked: 1_000_000, verified: 1_000_000, mismatched: 0, missing: 0, repaired: 1_000_000, truncated: false,
  } }));
});

test('sensitive extra data is discarded without spreading or traversing raw objects', () => {
  const canary = 'SYNTHETIC-STUDENT-NAME-SCORE-COMMENT-COOKIE-SESSION-TOKEN';
  let readExtra = false;
  const source = {
    ...input, studentId: canary, workspaceId: canary, classId: canary,
    cookie: canary, token: canary, exception: new Error(canary), body: { students: canary },
    cleanup: { sessions: 4, passwordResetTokens: canary },
    projection: { ...projection, studentName: canary,
      get providerPayload() { readExtra = true; throw new Error(canary); } },
    get rawProviderObject() { readExtra = true; throw new Error(canary); },
  };
  const result = buildScheduledOperationsReport(source);
  assert.ok(result);
  assert.equal(readExtra, false);
  assert.ok(!JSON.stringify(result).includes(canary));
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'kind', 'environment', 'release', 'outcome',
    'scheduledMinute', 'completedMinute', 'durationBucket', 'projection', 'coverage', 'health']);
  assert.deepEqual(Object.keys(result.projection!), ['checked', 'verified', 'mismatched', 'missing', 'repaired', 'truncated']);
});

test('throwing allowed-field getters and hostile objects fail without propagating exceptions', () => {
  const sensitive = 'SYNTHETIC-PRIVATE-EXCEPTION';
  for (const field of ['environment', 'release', 'scheduledTime', 'startedAt', 'completedAt', 'outcome', 'projection']) {
    const source = { ...input };
    Object.defineProperty(source, field, { get() { throw new Error(sensitive); } });
    assert.equal(buildScheduledOperationsReport(source), undefined, field);
  }
  for (const field of ['checked', 'verified', 'mismatched', 'missing', 'repaired', 'truncated']) {
    const hostile = { ...projection };
    Object.defineProperty(hostile, field, { get() { throw new Error(sensitive); } });
    assert.equal(buildScheduledOperationsReport({ ...input, projection: hostile }), undefined, field);
  }
  const hostile = new Proxy({}, { get() { throw new Error(sensitive); } });
  assert.equal(buildScheduledOperationsReport(hostile), undefined);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(buildScheduledOperationsReport(revoked.proxy), undefined);
  for (const value of [undefined, null, false, true, 1, 'raw error', []]) {
    assert.equal(buildScheduledOperationsReport(value), undefined);
  }
});

test('repeated report construction is deterministic, independent and does not mutate its input', () => {
  const frozenProjection = Object.freeze({ ...projection });
  const frozen = Object.freeze({ ...input, projection: frozenProjection });
  const first = buildScheduledOperationsReport(frozen)!;
  const second = buildScheduledOperationsReport(frozen)!;
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.projection, second.projection);
  first.projection!.verified = 0;
  assert.equal(second.projection!.verified, 4);
  assert.equal(frozenProjection.verified, 4);
});
