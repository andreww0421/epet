import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BackendApiError, BackendAuthRequired, BackendForbidden, BackendRevisionConflict,
  clearAuthentication, loadAuthSession, loadBackendPublicConfig, loadBackendState,
  loginAccount, saveBackendState, setActiveWorkspaceId,
} from '../src/services/backendApi';
import { initializeFrontendMonitoring } from '../src/services/monitoring';
import type { ErrorReport } from '../shared/observability/policy';

const sensitive = 'SYNTHETIC-STUDENT-COMMENT-EXAM-PASSWORD-SESSION-CSRF';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('API seam preserves auth/conflict/error contracts while reporting only unexpected failures once', async (t) => {
  const target = new EventTarget();
  const received: ErrorReport[] = [];
  const stop = initializeFrontendMonitoring({ enabled: 'true', environment: 'staging' }, target as unknown as Window, async (_url, init) => {
    received.push(JSON.parse(String(init?.body)) as ErrorReport);
    return new Response(null, { status: 202 });
  });
  t.after(() => { stop(); clearAuthentication(); });
  let status = 400;
  let body: unknown = { error: sensitive };
  t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));
  setActiveWorkspaceId('ws_synthetic_identifier');
  for (const expected of [400, 401, 403, 404, 409, 429]) {
    status = expected;
    await assert.rejects(loadBackendPublicConfig(), (error: unknown) => expected === 401
      ? error instanceof BackendAuthRequired
      : error instanceof BackendApiError && error.status === expected && error.code === sensitive);
  }
  status = 403;
  await assert.rejects(loadBackendState(), BackendForbidden);
  status = 409;
  const current = { revision: 7, updatedAt: 123, data: { students: sensitive, comments: sensitive, exams: sensitive } };
  body = { current };
  await assert.rejects(loadBackendState(), (error: unknown) => {
    if (!(error instanceof BackendRevisionConflict)) return false;
    assert.deepEqual(error.current, current);
    return true;
  });
  await tick();
  assert.equal(received.length, 0);

  status = 503;
  body = { error: sensitive };
  let reportedError: unknown;
  try { await loadBackendState(); } catch (error) { reportedError = error; }
  assert.ok(reportedError instanceof BackendApiError);
  assert.equal(reportedError.code, sensitive);
  await tick();
  assert.deepEqual(received, [{ category: 'frontend.api.http', route: 'workspace', method: 'GET', status: 503 }]);
  target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: reportedError }));
  await tick();
  assert.equal(received.length, 1);

  const originalNetworkError = new Error(sensitive);
  t.mock.method(globalThis, 'fetch', async () => { throw originalNetworkError; });
  await assert.rejects(loadBackendPublicConfig(), (error: unknown) => error === originalNetworkError);
  target.dispatchEvent(Object.assign(new Event('error'), { error: originalNetworkError, message: sensitive }));
  await tick();
  assert.deepEqual(received[1], { category: 'frontend.api.network', route: 'health', method: 'GET' });
  assert.equal(received.length, 2);
  assert.ok(!JSON.stringify(received).includes(sensitive));
});

test('API telemetry does not change csrf clearing or same-origin credential behavior', async (t) => {
  t.after(clearAuthentication);
  const calls: RequestInit[] = [];
  let status = 200;
  let body: unknown = { csrfToken: sensitive, session: { workspaces: [{ id: 'ws_synthetic' }] } };
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    calls.push(init!); return Response.json(body, { status });
  });
  await loginAccount({ email: 'synthetic@example.test', password: sensitive });
  assert.equal(calls[0].credentials, 'same-origin');
  await saveBackendState({ classes: [] } as Parameters<typeof saveBackendState>[0], 0);
  assert.equal(new Headers(calls[1].headers).get('x-csrf-token'), sensitive);
  status = 401;
  body = { error: 'INVALID_SESSION' };
  assert.equal(await loadAuthSession(), null);
  status = 200;
  body = {};
  await saveBackendState({ classes: [] } as Parameters<typeof saveBackendState>[0], 0);
  assert.equal(new Headers(calls[3].headers).get('x-csrf-token'), null);
});

test('malformed successful response still returns the existing empty-object fallback and a safe response failure', async (t) => {
  const target = new EventTarget();
  const received: unknown[] = [];
  const stop = initializeFrontendMonitoring({ enabled: 'true', environment: 'development' }, target as unknown as Window, async (_url, init) => {
    received.push(JSON.parse(String(init?.body))); return new Response(null, { status: 202 });
  });
  t.after(stop);
  t.mock.method(globalThis, 'fetch', async () => new Response('{', { status: 200 }));
  assert.deepEqual(await loadBackendPublicConfig(), {});
  await tick();
  assert.deepEqual(received, [{ category: 'frontend.api.response', route: 'health', method: 'GET' }]);
});

test('disabled/invalid environment initialization does not register global handlers or send events', async () => {
  const target = new EventTarget();
  let calls = 0;
  const fakeFetch: typeof fetch = async () => { calls++; return new Response(null, { status: 202 }); };
  initializeFrontendMonitoring({ enabled: 'false', environment: 'production' }, target as unknown as Window, fakeFetch);
  initializeFrontendMonitoring({ enabled: 'true', environment: 'unknown' }, target as unknown as Window, fakeFetch);
  target.dispatchEvent(Object.assign(new Event('error'), { error: new Error(sensitive) }));
  target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: sensitive }));
  await tick();
  assert.equal(calls, 0);
});
