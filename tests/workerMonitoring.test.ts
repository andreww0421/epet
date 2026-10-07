import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApiHandler } from '../server/api';
import { JsonWorkspaceRepository } from '../server/repository';
import { createApiRuntime } from '../server/services/apiRuntime';
import type { ErrorReport } from '../shared/observability/policy';
import worker from '../worker/index';

const sensitive = 'SYNTHETIC-STUDENT-EXAM-COMMENT-EVIDENCE-PASSWORD-SESSION-CSRF';
const dsn = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@o0.ingest.sentry.io/1';
const loginRequest = () => new Request('https://example.test/api/v1/auth/login', {
  method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'synthetic@example.test', password: sensitive }),
});
type WorkerEnv = Parameters<typeof worker.fetch>[1];
type WorkerContext = Parameters<typeof worker.fetch>[2];
const workerContext = (pending: Promise<unknown>[]) => ({ waitUntil: (task: Promise<unknown>) => { pending.push(task); } } as WorkerContext);
const waitBackground = async (pending: Promise<unknown>[]) => {
  // A delivery catch may append a telemetry flush while existing waitUntil work drains.
  for (let i = 0; i < pending.length; i++) await pending[i];
};

test('shared API reports handled 500 safely and preserves body/status/cookies even if reporter throws', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-monitoring-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new JsonWorkspaceRepository(join(directory, 'state.json'));
  repository.findUserByNormalizedEmail = async () => { throw new Error(sensitive); };
  const events: ErrorReport[] = [];
  const logs: unknown[][] = [];
  t.mock.method(console, 'error', (...values: unknown[]) => { logs.push(values); });
  for (const failReporter of [false, true]) {
    const response = await createApiHandler(repository, { monitoringReporter: (event) => {
      events.push(event); if (failReporter) throw new Error(sensitive);
    } })(loginRequest());
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'INTERNAL_ERROR' });
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(events, Array.from({ length: 2 }, () => ({ category: 'worker.api.http', route: 'auth', method: 'POST', status: 500 })));
  assert.ok(!JSON.stringify({ events, logs }).includes(sensitive));
});

test('known auth failure is not reported; origin rejection and csrf remain product middleware responsibilities', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-monitoring-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new JsonWorkspaceRepository(join(directory, 'state.json'));
  const received: ErrorReport[] = [];
  const handler = createApiHandler(repository, { monitoringReporter: (event) => received.push(event) });
  const invalid = await handler(loginRequest());
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { error: 'INVALID_CREDENTIALS' });
  const badOrigin = await handler(new Request(loginRequest(), { headers: { origin: 'https://attacker.test' } }));
  assert.equal(badOrigin.status, 403);
  assert.deepEqual(await badOrigin.json(), { error: 'ORIGIN_NOT_ALLOWED' });
  assert.equal(received.length, 0);
});

test('direct service-unavailable responses report once without reading or changing the contract', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-monitoring-503-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new JsonWorkspaceRepository(join(directory, 'state.json'));
  const received: ErrorReport[] = [];
  const response = await createApiHandler(repository, {
    registrationEnabled: true, emailVerificationRequired: true,
    monitoringReporter: (event) => { received.push(event); throw new Error(sensitive); },
  })(new Request('https://example.test/api/v1/auth/register', {
    method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'synthetic@example.test', password: sensitive, displayName: sensitive }),
  }));
  assert.equal(response.status, 503);
  assert.equal(response.bodyUsed, false);
  assert.deepEqual(await response.json(), { error: 'REGISTRATION_CONFIGURATION_INCOMPLETE' });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(received, [{ category: 'worker.api.http', route: 'auth', method: 'POST', status: 503 }]);
  assert.ok(!JSON.stringify(received).includes(sensitive));
});

test('background delivery errors report a fixed category and never log provider error or recipient data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-monitoring-mail-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new JsonWorkspaceRepository(join(directory, 'state.json'));
  const received: ErrorReport[] = [];
  const pending: Promise<void>[] = [];
  const logs: unknown[][] = [];
  t.mock.method(console, 'error', (...values: unknown[]) => { logs.push(values); });
  const runtime = createApiRuntime(repository, {
    monitoringReporter: (event) => received.push(event),
    deferBackgroundTask: (task) => { pending.push(task); },
  });
  runtime.scheduleBackgroundDelivery(Promise.reject(new Error(sensitive)), sensitive);
  await Promise.all(pending);
  assert.deepEqual(received, [{ category: 'worker.background', route: 'auth', method: 'unknown' }]);
  assert.deepEqual(logs, [['Background delivery failed']]);
});

test('Worker unhandled asset exception is reported without raw exception/URL and rethrows the original instance', async (t) => {
  const error = new Error(sensitive);
  const sent: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body).split('\n')[2])); return new Response(null, { status: 200 });
  });
  const env: WorkerEnv = {
    DB: {} as WorkerEnv['DB'], ASSETS: { fetch: async () => { throw error; } },
    MONITORING_ENVIRONMENT: 'staging', SENTRY_DSN: dsn,
  };
  await assert.rejects(worker.fetch(new Request(`https://example.test/${sensitive}?token=${sensitive}`), env, workerContext(pending)), (caught: unknown) => caught === error);
  await waitBackground(pending);
  assert.equal(sent.length, 1);
  assert.equal((sent[0] as { environment: string }).environment, 'staging');
  assert.equal((sent[0] as { tags: Record<string, unknown> }).tags['epet.category'], 'worker.unhandled');
  assert.ok(!JSON.stringify(sent).includes(sensitive));
});

test('Worker handled API exception reports exactly once with existing 500 and security/cache headers', async (t) => {
  const sent: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  t.mock.method(console, 'error', () => undefined);
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body).split('\n')[2])); return new Response(null, { status: 200 });
  });
  const env: WorkerEnv = {
    DB: { prepare() { throw new Error(sensitive); } } as unknown as WorkerEnv['DB'],
    ASSETS: { fetch: async () => new Response('fixture') },
    MONITORING_ENVIRONMENT: 'production', SENTRY_DSN: dsn,
  };
  const response = await worker.fetch(loginRequest(), env, workerContext(pending));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'INTERNAL_ERROR' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  await waitBackground(pending);
  assert.equal(sent.length, 1);
  assert.equal((sent[0] as { tags: Record<string, unknown> }).tags['epet.category'], 'worker.api.http');
  assert.ok(!JSON.stringify(sent).includes(sensitive));
});

test('Worker direct 503 configuration error reaches the SDK exactly once with no sensitive content', async (t) => {
  const sent: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body).split('\n')[2])); return new Response(null, { status: 200 });
  });
  const env: WorkerEnv = {
    DB: {} as WorkerEnv['DB'], ASSETS: { fetch: async () => new Response('fixture') },
    MONITORING_ENVIRONMENT: 'staging', SENTRY_DSN: dsn,
    REGISTRATION_ENABLED: 'true', EMAIL_VERIFICATION_REQUIRED: 'true',
  };
  const response = await worker.fetch(new Request('https://example.test/api/v1/auth/register', {
    method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'synthetic@example.test', password: sensitive, displayName: sensitive }),
  }), env, workerContext(pending));
  assert.equal(response.status, 503);
  assert.equal(response.bodyUsed, false);
  assert.deepEqual(await response.json(), { error: 'REGISTRATION_CONFIGURATION_INCOMPLETE' });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  await waitBackground(pending);
  assert.equal(sent.length, 1);
  assert.equal((sent[0] as { tags: Record<string, unknown> }).tags['epet.category'], 'worker.api.http');
  assert.equal((sent[0] as { tags: Record<string, unknown> }).tags['epet.status'], 503);
  assert.ok(!JSON.stringify(sent).includes(sensitive));
});

test('Worker relay failures are isolated from product auth and responses remain secured', async () => {
  const env: WorkerEnv = { DB: {} as WorkerEnv['DB'], ASSETS: { fetch: async () => new Response('fixture') }, MONITORING_ENVIRONMENT: 'production' };
  const pending: Promise<unknown>[] = [];
  const response = await worker.fetch(new Request('https://example.test/api/v1/monitoring'), env, workerContext(pending));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(pending.length, 0);
});
