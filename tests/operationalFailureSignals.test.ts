import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CloudflareClient } from '@sentry/cloudflare';
import { getClient } from '@sentry/react';
import { createApiHandler } from '../server/api';
import { AuthService } from '../server/auth';
import { JsonWorkspaceRepository } from '../server/repository';
import type { ErrorReport } from '../shared/observability/policy';
import { initializeFrontendMonitoring, reportFrontendError } from '../src/services/monitoring';
import { createStagingConfig, assertStagingConfig } from '../scripts/staging-policy.mjs';
import worker from '../worker/index';
import { createWorkerReporter, monitorMailDelivery } from '../worker/monitoring';
import { handleMonitoringRelay } from '../worker/monitoringRelay';
import { D1WorkspaceRepository } from '../worker/repository';

const canary = 'SYNTHETIC-STUDENT-GRADE-COMMENT-EMAIL-COOKIE-TOKEN-SQL';
const dsn = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@o0.ingest.sentry.io/1';
type Env = Parameters<typeof worker.fetch>[1];
type Context = Parameters<typeof worker.fetch>[2];
const context = (tasks: Promise<unknown>[]) => ({ waitUntil: (task: Promise<unknown>) => { tasks.push(task); } } as Context);
const drain = async (tasks: Promise<unknown>[]) => {
  for (let index = 0; index < tasks.length; index++) await tasks[index];
};
const projection = { checked: 1, verified: 1, mismatched: 0, missing: 0, repaired: 0, truncated: false };

test('Worker SDK flush and dispose failures never escape waitUntil or report their raw errors', async (t) => {
  for (const mode of ['flush-sync', 'flush-async', 'dispose-sync', 'dispose-async']) {
    const tasks: Promise<unknown>[] = [];
    const sent: string[] = [];
    const flush = t.mock.method(CloudflareClient.prototype, 'flush', mode.startsWith('flush')
      ? () => { if (mode === 'flush-sync') throw new Error(canary); return Promise.reject(new Error(canary)); }
      : async () => true);
    const dispose = t.mock.method(CloudflareClient.prototype, 'dispose', () => {
      if (mode === 'dispose-sync') throw new Error(canary);
      if (mode === 'dispose-async') return Promise.reject(new Error(canary));
    });
    try {
      const reporter = createWorkerReporter({ MONITORING_ENVIRONMENT: 'staging', SENTRY_DSN: dsn },
        context(tasks), 'worker', async (_url, init) => { sent.push(String(init?.body)); return new Response(null); });
      assert.doesNotThrow(() => reporter({ category: 'worker.database', route: 'workspace', method: 'GET' }));
      await drain(tasks);
      assert.ok(!JSON.stringify(sent).includes(canary));
    } finally { flush.mock.restore(); dispose.mock.restore(); }
  }
});

test('throwing waitUntil and disabled or invalid monitoring configurations cannot affect the caller', async (t) => {
  const sent: string[] = [];
  const send: typeof fetch = async (_url, init) => { sent.push(String(init?.body)); return new Response(null); };
  for (const env of [{}, { MONITORING_ENVIRONMENT: 'invalid', SENTRY_DSN: dsn },
    { MONITORING_ENVIRONMENT: 'production', SENTRY_DSN: `https://user:${canary}@private.invalid/1` }]) {
    const reporter = createWorkerReporter(env, { waitUntil: () => { throw new Error(canary); } }, 'worker', send);
    assert.doesNotThrow(() => reporter({ category: 'worker.configuration', route: 'unknown', method: 'unknown' }));
  }
  assert.equal(sent.length, 0);
  t.mock.method(CloudflareClient.prototype, 'flush', async () => true);
  t.mock.method(CloudflareClient.prototype, 'dispose', () => { throw new Error(canary); });
  const enabled = createWorkerReporter({ MONITORING_ENVIRONMENT: 'staging', SENTRY_DSN: dsn },
    { waitUntil: () => { throw new Error(canary); } }, 'worker', send);
  assert.doesNotThrow(() => enabled({ category: 'worker.configuration', route: 'unknown', method: 'unknown' }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(!JSON.stringify(sent).includes(canary));
});

test('frontend cleanup isolates synchronous and asynchronous SDK close failures', async (t) => {
  let calls = 0;
  const send: typeof fetch = async () => { calls++; return new Response(null); };
  const target = new EventTarget() as unknown as Window;
  for (const asynchronous of [false, true]) {
    const cleanup = initializeFrontendMonitoring({ enabled: 'true', environment: 'development' }, target, send);
    const client = getClient();
    assert.ok(client);
    const close = t.mock.method(client, 'close', () => {
      if (asynchronous) return Promise.reject(new Error(canary));
      throw new Error(canary);
    });
    try { assert.doesNotThrow(cleanup); }
    finally { close.mock.restore(); }
    reportFrontendError({ category: 'frontend.uncaught', route: 'unknown', method: 'unknown' });
  }
  initializeFrontendMonitoring({ enabled: 'true', environment: canary }, target, send)();
  initializeFrontendMonitoring({ enabled: 'false', environment: 'production' }, target, send)();
  await Promise.resolve();
  assert.equal(calls, 0);
});

test('mail wrapper preserves original delivery outcomes while reporting only a fixed failure category', async () => {
  const received: ErrorReport[] = [];
  const delivery = { email: canary, token: canary, displayName: canary, content: canary };
  assert.equal(monitorMailDelivery(undefined, () => {}, 'auth'), undefined);
  let delivered: unknown;
  await monitorMailDelivery(async (value) => { delivered = value; }, (event) => received.push(event), 'auth')!(delivery);
  assert.equal(delivered, delivery);
  assert.equal(received.length, 0);
  for (const route of ['auth', 'administration'] as const) {
    const error = new Error(canary);
    await assert.rejects(monitorMailDelivery(async () => { throw error; }, (event) => {
      received.push(event); throw new Error(canary);
    }, route)!(delivery), (caught) => caught === error);
  }
  assert.deepEqual(received, ['auth', 'administration'].map((route) => ({ category: 'worker.email', route, method: 'unknown' })));
  assert.ok(!JSON.stringify(received).includes(canary));
});

test('missing password-reset provider is observable without account enumeration or changing the 202 contract', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-monitor-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new JsonWorkspaceRepository(join(directory, 'state.json'));
  await new AuthService(repository).register({ email: 'known@example.invalid', password: canary, displayName: canary,
    workspaceName: 'Synthetic Operations', initialWorkspaceData: { lastOpened: 1_800_000_000_000,
      currentClassId: 'synthetic-class', classes: [{ id: 'synthetic-class', name: 'Synthetic Class', students: [] }] } });
  const received: ErrorReport[] = [];
  const tasks: Promise<void>[] = [];
  const handler = createApiHandler(repository, { forgotResponseFloorMs: 0,
    deferBackgroundTask: (task) => { tasks.push(task); }, monitoringReporter: (event) => received.push(event) });
  for (const email of ['known@example.invalid', 'unknown@example.invalid']) {
    const response = await handler(new Request('https://example.test/api/v1/auth/password/forgot', {
      method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }));
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
  }
  await Promise.all(tasks);
  assert.deepEqual(received, Array.from({ length: 2 }, () => ({ category: 'worker.configuration', route: 'auth', method: 'POST' })));
  assert.ok(!JSON.stringify(received).includes(canary));
});

test('Cron emits only rebuilt operational state; repairs, partial scans and mismatches remain degraded', async (t) => {
  const logs: unknown[][] = [];
  const events: unknown[] = [];
  t.mock.method(console, 'info', (...args) => { logs.push(args); });
  t.mock.method(console, 'warn', (...args) => { logs.push(args); });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    events.push(JSON.parse(String(init?.body).split('\n')[2])); return new Response(null);
  });
  t.mock.method(D1WorkspaceRepository.prototype, 'cleanupExpiredAuthData', async () => ({ raw: canary } as never));
  for (const patch of [{}, { repaired: 1 }, { missing: 1, verified: 0 }, { mismatched: 1, verified: 0 }, { truncated: true }, { checked: NaN }]) {
    const reconcile = t.mock.method(D1WorkspaceRepository.prototype, 'reconcileWorkspaceProjections', async () => ({
      ...projection, ...patch, workspaceId: canary, raw: canary,
    }));
    try {
      const tasks: Promise<unknown>[] = [];
      worker.scheduled({ scheduledTime: Date.now() - 1_000 } as never,
        { DB: {} as Env['DB'], MONITORING_ENVIRONMENT: 'staging', SENTRY_DSN: dsn } as Env, context(tasks));
      await drain(tasks);
    } finally { reconcile.mock.restore(); }
  }
  assert.equal(logs.length, 6);
  const reports = logs.slice(0, 5).map((args) => args[1] as { health: string; coverage: string });
  assert.deepEqual(reports.map((report) => report.health), ['ok', 'degraded', 'degraded', 'degraded', 'degraded']);
  assert.equal(reports.at(-1)?.coverage, 'incomplete');
  assert.equal(events.length, 5);
  assert.deepEqual(logs.at(-1), ['Epet operational status unavailable']);
  assert.equal((events.at(-1) as { tags: Record<string, unknown> }).tags['epet.category'], 'worker.configuration');
  const reconcile = t.mock.method(D1WorkspaceRepository.prototype, 'reconcileWorkspaceProjections', async () => projection);
  try {
    const tasks: Promise<unknown>[] = [];
    worker.scheduled({ scheduledTime: Date.now() - 1_000 } as never,
      { DB: {} as Env['DB'], MONITORING_ENVIRONMENT: canary, SENTRY_DSN: dsn } as Env, context(tasks));
    await drain(tasks);
    assert.deepEqual(logs.at(-1), ['Epet operational status unavailable']);
    assert.equal(events.length, 5, 'Invalid environments must not fall back to a production Sentry destination');
  } finally { reconcile.mock.restore(); }
  assert.ok(!JSON.stringify({ logs, events }).includes(canary));
});

test('Cron failure remains rejected with a constant error and no original error cause', async (t) => {
  const logs: unknown[][] = [];
  t.mock.method(console, 'info', (...args) => { logs.push(args); });
  t.mock.method(D1WorkspaceRepository.prototype, 'cleanupExpiredAuthData', async () => { throw new Error(canary); });
  const tasks: Promise<unknown>[] = [];
  worker.scheduled({ scheduledTime: Date.now() - 1_000 } as never,
    { DB: {} as Env['DB'], MONITORING_ENVIRONMENT: 'production' } as Env, context(tasks));
  await assert.rejects(tasks[0], (error: Error) => {
    assert.equal(error.message, 'EPET_SCHEDULED_MAINTENANCE_FAILED');
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal((logs[0][1] as { health: string }).health, 'failed');
  assert.ok(!JSON.stringify(logs).includes(canary));
});

test('relay quota infrastructure failure is generic, nonrecursive and never reads the submitted body', async () => {
  let reads = 0;
  let reports = 0;
  const request = new Request('https://example.test/api/v1/monitoring', { method: 'POST',
    headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: canary });
  Object.defineProperty(request, 'body', { get: () => { reads++; throw new Error(canary); } });
  const response = await handleMonitoringRelay(request, true, () => { reports++; }, async () => { throw new Error(canary); });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'MONITORING_UNAVAILABLE' });
  assert.equal(reads, 0);
  assert.equal(reports, 0);
});

test('checked-in and generated staging policies prohibit automatic invocation metadata, traces and extra log destinations', async () => {
  const production = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const template = JSON.parse(await readFile('wrangler.staging.jsonc', 'utf8'));
  const expected = { enabled: true, logs: { enabled: true, invocation_logs: false }, traces: { enabled: false } };
  assert.deepEqual(production.observability, expected);
  assert.deepEqual(template.observability, expected);
  for (const change of [
    (config) => { config.observability.logs.invocation_logs = true; },
    (config) => { config.observability.traces.enabled = true; },
    (config) => { config.observability.logs.destinations = [canary]; },
    (config) => { delete config.observability.logs; },
  ]) {
    const config = createStagingConfig({ production, template, dryRun: true });
    change(config);
    assert.throws(() => assertStagingConfig({ production, config }));
  }
});
