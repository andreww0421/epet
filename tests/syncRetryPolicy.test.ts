import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { WorkspaceAccess } from '../shared/contracts/workspace';
import type { ErrorReport } from '../shared/observability/policy';
import {
  BackendApiError, BackendAuthRequired, BackendForbidden, BackendRevisionConflict,
  clearAuthentication, loadBackendState, parseRetryAfter, setActiveWorkspaceId,
} from '../src/services/backendApi';
import { initializeFrontendMonitoring } from '../src/services/monitoring';
import {
  classifySaveFailure, isDraftSyncState, isPausedSyncFailure,
  MAX_AUTOMATIC_SAVE_RETRIES, SAVE_RETRY_DELAYS_MS, type DraftSyncState,
} from '../src/services/syncRetryPolicy';
import {
  clearPendingDraft, DRAFT_TTL_MS, draftStorageKey, readPendingDraft,
  writePendingDraft, type PendingWorkspaceDraft,
} from '../src/services/workspaceDrafts';
import type { AppData } from '../src/store/types';

const NOW = Date.parse('2026-10-23T09:00:00Z');
const EXPIRES_AT = NOW + DRAFT_TTL_MS;
const PRIVATE_MARKER = 'SYNTHETIC-PRIVATE-STUDENT-COMMENT-SESSION';
const transientStatuses = [408, 425, 500, 502, 503, 504, 520, 521, 522, 523, 524];
const syntheticData = (): AppData => ({
  lastOpened: NOW, currentClassId: 'synthetic-retry-class',
  classes: [{ id: 'synthetic-retry-class', name: 'Synthetic retry class', students: [] }],
});
const access = (): WorkspaceAccess => ({
  userId: 'synthetic-retry-user', workspaceId: 'synthetic-retry-workspace',
  role: 'admin', classIds: null,
});
const draft = (): PendingWorkspaceDraft => ({
  version: 2, access: access(), baseRevision: 7, requestId: 'synthetic-retry-request',
  createdAt: NOW - 10_000, updatedAt: NOW, expiresAt: EXPIRES_AT, data: syntheticData(),
});

class MemorySessionStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const installStorage = (t: TestContext) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storage = new MemorySessionStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  t.after(() => {
    clearPendingDraft(access());
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  return storage;
};

const expectApiError = async (operation: Promise<unknown>) => {
  try { await operation; } catch (error) {
    assert.ok(error instanceof BackendApiError);
    return error;
  }
  assert.fail('The synthetic response must reject');
};

test('400 and 422 are terminal validation failures and 413 is terminal capacity failure', () => {
  for (const status of [400, 422, 413]) {
    const result = classifySaveFailure(new BackendApiError(status, 'SYNTHETIC_REJECTION'), 2, NOW, EXPIRES_AT);
    assert.deepEqual(result, { retries: 2, notBefore: 0,
      failure: { kind: status === 413 ? 'capacity' : 'validation', status } });
    assert.equal(isPausedSyncFailure(result.failure), true);
  }
});

test('other permanent client errors and unsupported server errors never enter automatic retry', () => {
  for (const status of [401, 403, 404, 405, 409, 410, 412, 414, 415, 418, 421, 423, 428, 431, 451, 501, 505]) {
    const result = classifySaveFailure(new BackendApiError(status, 'SYNTHETIC_PERMANENT', 60_000), 0, NOW, EXPIRES_AT);
    assert.deepEqual(result, { retries: 0, notBefore: 0, failure: { kind: 'permanent', status } });
    assert.equal(isPausedSyncFailure(result.failure), true, `status ${status}`);
  }
});

test('capacity recovery retains only the advertised limit contract', () => {
  for (const limitKind of ['workspace_snapshot', 'request_body'] as const) {
    const limitBytes = limitKind === 'workspace_snapshot' ? 900 * 1024 : 2 * 1024 * 1024;
    const result = classifySaveFailure(new BackendApiError(413, 'PAYLOAD_TOO_LARGE', undefined,
      { limitBytes, limitKind }), 0, NOW, EXPIRES_AT);
    assert.deepEqual(result.failure, { kind: 'capacity', status: 413, limitBytes, limitKind });
    assert.equal(isDraftSyncState(result), true);
  }
});

test('network failures and the selected transient HTTP failures remain retryable', () => {
  const errors = [new TypeError('Synthetic network failure'),
    new DOMException('Synthetic request timeout', 'AbortError'),
    ...transientStatuses.map((status) => new BackendApiError(status, 'SYNTHETIC_TRANSIENT'))];
  for (const error of errors) {
    const result = classifySaveFailure(error, 0, NOW, EXPIRES_AT);
    assert.equal(result.failure.kind, 'transient');
    assert.equal(isPausedSyncFailure(result.failure), false);
    assert.equal(result.retries, 1);
    assert.equal(result.notBefore, NOW + 1_000);
  }
});

test('each transient failure has five finite automatic retries and then pauses', () => {
  assert.equal(MAX_AUTOMATIC_SAVE_RETRIES, 5);
  assert.deepEqual(SAVE_RETRY_DELAYS_MS, [1_000, 2_000, 5_000, 10_000, 30_000]);
  const errors = [new TypeError('Synthetic network failure'),
    ...[429, ...transientStatuses].map((status) => new BackendApiError(status, 'SYNTHETIC_RETRY'))];
  for (const error of errors) {
    let retries = 0;
    let clock = NOW;
    for (const expectedDelay of SAVE_RETRY_DELAYS_MS) {
      const result = classifySaveFailure(error, retries, clock, EXPIRES_AT);
      assert.equal(isPausedSyncFailure(result.failure), false);
      assert.equal(result.retries, retries + 1);
      assert.equal(result.notBefore, clock + expectedDelay);
      retries = result.retries;
      clock = result.notBefore;
    }
    const exhausted = classifySaveFailure(error, retries, clock, EXPIRES_AT);
    assert.equal(exhausted.failure.kind, 'retry-exhausted');
    assert.equal(exhausted.retries, 5);
    assert.equal(exhausted.notBefore, 0);
    assert.equal(isPausedSyncFailure(exhausted.failure), true);
  }
});

test('429 uses the later server deadline and preserves it after retry exhaustion', () => {
  const error = new BackendApiError(429, 'RATE_LIMITED', 120_000);
  const retry = classifySaveFailure(error, 0, NOW, EXPIRES_AT);
  assert.deepEqual(retry, { retries: 1, notBefore: NOW + 120_000,
    failure: { kind: 'rate-limit', status: 429 } });
  const exhausted = classifySaveFailure(error, MAX_AUTOMATIC_SAVE_RETRIES, NOW, EXPIRES_AT);
  assert.deepEqual(exhausted, { retries: 5, notBefore: retry.notBefore,
    failure: { kind: 'retry-exhausted', status: 429 } });
  assert.ok(exhausted.notBefore > NOW, 'a retained server deadline also constrains a manual retry');
});

test('a short Retry-After cannot shorten backoff and a 503 deadline is respected too', () => {
  assert.equal(classifySaveFailure(new BackendApiError(429, 'RATE_LIMITED', 1_000), 4, NOW, EXPIRES_AT)
    .notBefore, NOW + 30_000);
  assert.equal(classifySaveFailure(new BackendApiError(503, 'SYNTHETIC_UNAVAILABLE', 90_000), 1, NOW, EXPIRES_AT)
    .notBefore, NOW + 90_000);
});

test('retry deadlines at or beyond the draft lifetime pause without extending its lifetime', () => {
  for (const remaining of [0, 999, 1_000]) {
    const result = classifySaveFailure(new TypeError('Synthetic network failure'), 0, NOW, NOW + remaining);
    assert.equal(result.failure.kind, 'retry-exhausted');
    assert.equal(result.retries, 0);
    assert.equal(result.notBefore, NOW + 1_000);
  }
  assert.equal(classifySaveFailure(new TypeError('Synthetic network failure'), 0, NOW, NOW + 1_001)
    .failure.kind, 'transient');
});

test('very long Retry-After values pause instead of overflowing a JavaScript timer', () => {
  for (const retryAfterMs of [2_147_483_648, Number.MAX_SAFE_INTEGER]) {
    const result = classifySaveFailure(new BackendApiError(429, 'RATE_LIMITED', retryAfterMs),
      0, NOW, Number.MAX_SAFE_INTEGER);
    assert.equal(result.failure.kind, 'retry-exhausted');
    assert.equal(result.retries, 0);
    assert.equal(result.notBefore, Math.min(Number.MAX_SAFE_INTEGER, NOW + retryAfterMs));
    assert.ok(Number.isSafeInteger(result.notBefore));
    assert.equal(isDraftSyncState(result), true);
  }
});

test('Retry-After parses seconds, zero, whitespace, and huge digit-only values safely', () => {
  assert.equal(parseRetryAfter('120', NOW), 120_000);
  assert.equal(parseRetryAfter(' 0002 ', NOW), 2_000);
  assert.equal(parseRetryAfter('0', NOW), 0);
  assert.equal(parseRetryAfter('9'.repeat(400), NOW), Number.MAX_SAFE_INTEGER);
});

test('Retry-After accepts HTTP dates and clamps past deadlines to zero', () => {
  assert.equal(parseRetryAfter(new Date(NOW + 90_000).toUTCString(), NOW), 90_000);
  assert.equal(parseRetryAfter(new Date(NOW - 1_000).toUTCString(), NOW), 0);
});

test('malformed Retry-After values do not supply a deadline', () => {
  for (const value of [null, '', ' ', '-1', '+1', '1.5', '1e3', 'NaN', 'Infinity',
    'Synthetic invalid date', '120, 240', '2026-10-23']) {
    assert.equal(parseRetryAfter(value, NOW), undefined, String(value));
  }
});

test('persisted policy accepts each supported failure and a complete capacity contract', () => {
  for (const [kind, status] of [['capacity', 413], ['validation', 400], ['permanent', 404],
    ['transient', 503], ['rate-limit', 429], ['retry-exhausted', 503]] as const) {
    const state: DraftSyncState = { retries: 3, notBefore: NOW + 30_000, failure: { kind, status } };
    assert.equal(isDraftSyncState(state), true, kind);
  }
  assert.equal(isDraftSyncState({ retries: 0, notBefore: 0,
    failure: { kind: 'capacity', status: 413, limitBytes: 900 * 1024, limitKind: 'workspace_snapshot' } }), true);
  assert.equal(isDraftSyncState({ retries: 5, notBefore: 0, failure: { kind: 'retry-exhausted' } }), true);
});

test('persisted policy rejects malformed budgets, deadlines, status, and partial limit metadata', () => {
  const valid = { retries: 1, notBefore: NOW, failure: { kind: 'transient', status: 503 } };
  const invalid: unknown[] = [null, false, [], {}, { ...valid, failure: null },
    ...[-1, 0.5, 6, Infinity, NaN, '1'].map((retries) => ({ ...valid, retries })),
    ...[-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '0'].map((notBefore) => ({ ...valid, notBefore })),
    ...['unknown', '', 1].map((kind) => ({ ...valid, failure: { kind } })),
    ...[0, 399, 600, 429.5, '429', null].map((status) => ({ ...valid, failure: { kind: 'transient', status } })),
    ...[
      { limitBytes: 1 }, { limitKind: 'workspace_snapshot' },
      { limitBytes: 0, limitKind: 'request_body' }, { limitBytes: -1, limitKind: 'request_body' },
      { limitBytes: 1.5, limitKind: 'request_body' }, { limitBytes: '1024', limitKind: 'request_body' },
      { limitBytes: Number.MAX_SAFE_INTEGER + 1, limitKind: 'request_body' },
      { limitBytes: 1024, limitKind: 'synthetic-private-limit' },
    ].map((metadata) => ({ ...valid, failure: { kind: 'capacity', status: 413, ...metadata } })),
  ];
  for (const value of invalid) assert.equal(isDraftSyncState(value), false, JSON.stringify(value));
});

test('existing version-two drafts without retry metadata remain recoverable', (t) => {
  const storage = installStorage(t);
  const original = draft();
  storage.setItem(draftStorageKey(original.access), JSON.stringify(original));
  assert.deepEqual(readPendingDraft(original.access, NOW), original);
  assert.equal(readPendingDraft(original.access, NOW)?.syncState, undefined);
});

test('paused draft state survives persistence without renewal and expires at the original TTL', (t) => {
  const storage = installStorage(t);
  const original = { ...draft(), syncState: classifySaveFailure(
    new BackendApiError(413, 'PAYLOAD_TOO_LARGE', undefined,
      { limitBytes: 900 * 1024, limitKind: 'workspace_snapshot' }), 0, NOW, EXPIRES_AT) };
  assert.equal(writePendingDraft(original), true);
  assert.deepEqual(readPendingDraft(original.access, NOW + 60_000), original);
  assert.equal(writePendingDraft(original), true);
  assert.deepEqual(readPendingDraft(original.access, EXPIRES_AT - 1), original);
  assert.equal(readPendingDraft(original.access, EXPIRES_AT), null);
  assert.equal(storage.getItem(draftStorageKey(original.access)), null);
});

test('invalid persisted retry metadata cannot silently reset a draft to a fresh retry budget', (t) => {
  const storage = installStorage(t);
  for (const syncState of [{ retries: 6, notBefore: NOW, failure: { kind: 'transient' } },
    { retries: 0, notBefore: -1, failure: { kind: 'rate-limit', status: 429 } }]) {
    const raw = JSON.stringify({ ...draft(), syncState });
    storage.setItem(draftStorageKey(access()), raw);
    assert.equal(readPendingDraft(access(), NOW), null);
    assert.equal(storage.getItem(draftStorageKey(access())), raw, 'an invalid draft is retained, never replayed');
  }
});

test('API errors read Retry-After seconds and HTTP dates without making external requests', async (t) => {
  t.after(clearAuthentication);
  t.mock.method(Date, 'now', () => NOW);
  let retryAfter = '120';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    calls += 1;
    assert.equal(new Headers(init?.headers).get('x-epet-workspace'), access().workspaceId);
    assert.equal(init?.credentials, 'same-origin');
    return Response.json({ error: 'RATE_LIMITED' }, { status: 429, headers: { 'retry-after': retryAfter } });
  });
  setActiveWorkspaceId(access().workspaceId);
  assert.equal((await expectApiError(loadBackendState())).retryAfterMs, 120_000);
  retryAfter = new Date(NOW + 90_000).toUTCString();
  assert.equal((await expectApiError(loadBackendState())).retryAfterMs, 90_000);
  retryAfter = '9'.repeat(400);
  assert.equal((await expectApiError(loadBackendState())).retryAfterMs, Number.MAX_SAFE_INTEGER);
  retryAfter = 'Synthetic invalid deadline';
  assert.equal((await expectApiError(loadBackendState())).retryAfterMs, undefined);
  assert.equal(calls, 4);
});

test('413 API errors retain safe limit metadata and drop actual sizes and private response fields', async (t) => {
  t.after(clearAuthentication);
  const limit = { limitBytes: 900 * 1024, limitKind: 'workspace_snapshot' };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'PAYLOAD_TOO_LARGE', ...limit,
    actualBytes: 1_000_000, dataSizeBytes: 1_000_000, workspaceId: PRIVATE_MARKER,
    data: PRIVATE_MARKER, student: PRIVATE_MARKER, diagnostic: PRIVATE_MARKER,
  }, { status: 413 }));
  setActiveWorkspaceId(access().workspaceId);
  const error = await expectApiError(loadBackendState());
  assert.equal(error.status, 413);
  assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
  assert.deepEqual(error.capacityLimit, limit);
  assert.ok(!JSON.stringify(error).includes(PRIVATE_MARKER));
  assert.ok(!JSON.stringify(error).includes('actualBytes'));
  assert.ok(!JSON.stringify(error).includes('dataSizeBytes'));
});

test('API errors reject malformed capacity metadata and ignore limits on non-413 responses', async (t) => {
  t.after(clearAuthentication);
  let status = 413;
  let metadata: Record<string, unknown> = {};
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'SYNTHETIC_REJECTION', ...metadata }, { status }));
  setActiveWorkspaceId(access().workspaceId);
  for (metadata of [
    { limitBytes: 1024 }, { limitKind: 'request_body' },
    { limitBytes: '1024', limitKind: 'request_body' }, { limitBytes: -1, limitKind: 'request_body' },
    { limitBytes: 0, limitKind: 'request_body' }, { limitBytes: 1.5, limitKind: 'request_body' },
    { limitBytes: Number.MAX_SAFE_INTEGER + 1, limitKind: 'request_body' },
    { limitBytes: 1024, limitKind: PRIVATE_MARKER },
  ]) assert.equal((await expectApiError(loadBackendState())).capacityLimit, undefined);
  status = 422;
  metadata = { limitBytes: 1024, limitKind: 'request_body' };
  assert.equal((await expectApiError(loadBackendState())).capacityLimit, undefined);
});

test('retry metadata preserves the existing 401, 403, and both 409 API contracts', async (t) => {
  t.after(clearAuthentication);
  let status = 401;
  let body: unknown = { error: 'SYNTHETIC_AUTH' };
  t.mock.method(globalThis, 'fetch', async () => Response.json(body,
    { status, headers: { 'retry-after': '120' } }));
  setActiveWorkspaceId(access().workspaceId);
  await assert.rejects(loadBackendState(), BackendAuthRequired);
  status = 403;
  await assert.rejects(loadBackendState(), BackendForbidden);
  status = 409;
  const current = { revision: 8, updatedAt: NOW, data: syntheticData() };
  body = { error: 'REVISION_CONFLICT', current };
  await assert.rejects(loadBackendState(), (error: unknown) => {
    assert.ok(error instanceof BackendRevisionConflict);
    assert.deepEqual(error.current, current);
    return true;
  });
  body = { error: 'REVISION_CONFLICT', revision: 8, updatedAt: NOW };
  const error = await expectApiError(loadBackendState());
  assert.equal(error.status, 409);
  assert.equal(error.code, 'REVISION_CONFLICT');
});

test('retry and capacity metadata never enter frontend telemetry or duplicate HTTP reports', async (t) => {
  const target = new EventTarget();
  const reports: ErrorReport[] = [];
  const stop = initializeFrontendMonitoring({ enabled: 'true', environment: 'staging' },
    target as unknown as Window, async (_url, init) => {
      reports.push(JSON.parse(String(init?.body)) as ErrorReport);
      return new Response(null, { status: 202 });
    });
  t.after(() => { stop(); clearAuthentication(); });
  let status = 413;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: PRIVATE_MARKER,
    limitBytes: 900 * 1024, limitKind: 'workspace_snapshot', actualBytes: 1_000_000,
    data: PRIVATE_MARKER,
  }, { status, headers: { 'retry-after': '120' } }));
  setActiveWorkspaceId(access().workspaceId);
  for (status of [400, 413, 422, 429]) await expectApiError(loadBackendState());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(reports, []);
  status = 503;
  const reportedError = await expectApiError(loadBackendState());
  target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: reportedError }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(reports, [{ category: 'frontend.api.http', route: 'workspace', method: 'GET', status: 503 }]);
  assert.ok(!JSON.stringify(reports).includes(PRIVATE_MARKER));
  assert.ok(!JSON.stringify(reports).includes('limitBytes'));
  assert.ok(!JSON.stringify(reports).includes('retryAfter'));
  assert.ok(!JSON.stringify(reports).includes('actualBytes'));
});
