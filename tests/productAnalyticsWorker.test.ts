import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import type { D1Database, ScheduledController } from '@cloudflare/workers-types';
import worker from '../worker/index';
import { resolveWorkerProductAnalyticsConfig } from '../worker/productAnalytics';
import { D1WorkspaceRepository } from '../worker/repository';
import { ProductAnalyticsRepository } from '../worker/productAnalyticsRepository';

type Env = Parameters<typeof worker.fetch>[1];
type Context = Parameters<typeof worker.fetch>[2];
const canary = 'SYNTHETIC-PRIVATE-COOKIE-IP-CLASSROOM-TOKEN';
const request = (headers: Record<string, string> = {}) => new Request('https://example.test/api/v1/product-analytics', {
  method: 'POST', headers: { origin: 'https://example.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
    cookie: canary, authorization: canary, ...headers }, body: JSON.stringify({ schema_version: 2, kind: 'usage', name: 'boss_started' }),
});
const context = (pending: Promise<unknown>[]) => ({ waitUntil(task: Promise<unknown>) { pending.push(task); } }) as Context;
const env = (): Env => ({ DB: {} as D1Database, ASSETS: { fetch: async () => new Response('fixture') },
  MONITORING_ENVIRONMENT: 'staging', PRODUCT_ANALYTICS_ENABLED: 'true', PRODUCT_ANALYTICS_ENVIRONMENT: 'staging',
  PRODUCT_ANALYTICS_COHORT_START: '2026-11-01' });

test('Worker config requires exact opt-in, environment match, isolated binding and valid UTC cutoff', () => {
  const configured = { ...env(), ANALYTICS_DB: {} as D1Database };
  const now = Date.UTC(2026, 10, 2);
  const valid = resolveWorkerProductAnalyticsConfig(configured, now);
  assert.equal(valid.collector.environment, 'staging'); assert.ok(valid.onboarding);
  for (const value of ['TRUE', '1', 'yes', undefined]) {
    assert.equal(resolveWorkerProductAnalyticsConfig({ ...configured, PRODUCT_ANALYTICS_ENABLED: value }, now).collector.enabled, false);
  }
  for (const change of [{ PRODUCT_ANALYTICS_ENVIRONMENT: 'production' }, { MONITORING_ENVIRONMENT: undefined },
    { PRODUCT_ANALYTICS_ENVIRONMENT: canary }, { ANALYTICS_DB: undefined }, { ANALYTICS_DB: configured.DB }]) {
    assert.equal(resolveWorkerProductAnalyticsConfig({ ...configured, ...change }, now).onboarding, undefined);
  }
  for (const cutoff of [undefined, '2026-02-30', '2026-11-01T00:00:00+08:00', '2026-11-01T01:00:00.000Z', '2026-11-03', canary]) {
    assert.equal(resolveWorkerProductAnalyticsConfig({ ...configured, PRODUCT_ANALYTICS_COHORT_START: cutoff }, now).onboarding, undefined);
  }
  assert.ok(resolveWorkerProductAnalyticsConfig({ ...configured, PRODUCT_ANALYTICS_COHORT_START: '2026-11-01T00:00:00.000Z' }, now).onboarding);
});

test('anonymous Worker route is secure, write-only and never falls back to classroom DB or reports intake errors', async (t) => {
  let businessReads = 0; let analyticsWrites = 0; let remoteCalls = 0;
  const logs: unknown[][] = [];
  t.mock.method(console, 'error', (...values: unknown[]) => { logs.push(values); });
  t.mock.method(globalThis, 'fetch', async () => { remoteCalls++; throw new Error(canary); });
  const business = { prepare() { businessReads++; throw new Error(canary); } } as unknown as D1Database;
  const database = { prepare() { analyticsWrites++; throw new Error(canary); } } as unknown as D1Database;
  const pending: Promise<unknown>[] = [];
  const configured = { ...env(), DB: business, ANALYTICS_DB: database,
    SENTRY_DSN: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@o0.ingest.sentry.io/1' };
  for (const [change, expected] of [[{ PRODUCT_ANALYTICS_ENABLED: 'false' }, 404],
    [{ ANALYTICS_DB: undefined }, 503], [{ ANALYTICS_DB: business }, 503],
    [{ PRODUCT_ANALYTICS_ENVIRONMENT: 'production' }, 503], [{}, 503]] as const) {
    const response = await worker.fetch(request(), { ...configured, ...change }, context(pending));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const privateRequest = request({ dnt: '1' });
  assert.equal((await worker.fetch(privateRequest, configured, context(pending))).status, 204);
  assert.equal(privateRequest.bodyUsed, false);
  assert.equal(analyticsWrites, 1); assert.equal(businessReads, 0); assert.equal(remoteCalls, 0);
  assert.equal(pending.length, 0); assert.deepEqual(logs, []);
});

test('optional scheduled analytics failures stay independent of successful classroom maintenance', async (t) => {
  const calls: string[] = [];
  t.mock.method(console, 'info', () => undefined);
  t.mock.method(console, 'warn', () => undefined);
  t.mock.method(D1WorkspaceRepository.prototype, 'cleanupExpiredAuthData', async () => { calls.push('auth'); });
  t.mock.method(D1WorkspaceRepository.prototype, 'reconcileWorkspaceProjections', async () => { calls.push('projection'); return {}; });
  t.mock.method(ProductAnalyticsRepository.prototype, 'finalizeExpired', async () => { calls.push('analytics'); throw new Error(canary); });
  const pending: Promise<unknown>[] = [];
  worker.scheduled({ scheduledTime: Date.UTC(2026, 10, 2) } as ScheduledController,
    { ...env(), ANALYTICS_DB: {} as D1Database }, context(pending));
  assert.equal(pending.length, 2);
  assert.ok((await Promise.allSettled(pending)).every((result) => result.status === 'fulfilled'));
  assert.deepEqual(new Set(calls), new Set(['auth', 'projection', 'analytics']));
  calls.length = 0; pending.length = 0;
  worker.scheduled({ scheduledTime: Date.UTC(2026, 10, 2) } as ScheduledController, env(), context(pending));
  await Promise.all(pending);
  assert.equal(calls.includes('analytics'), false);
});

test('Worker anonymous interception precedes reporter construction and business request context', async () => {
  const source = await readFile('worker/index.ts', 'utf8');
  const start = source.indexOf('async fetch(');
  assert.ok(source.indexOf('url.pathname === PRODUCT_ANALYTICS_PATH', start) < source.indexOf('const reporter = createWorkerReporter', start));
});

test('actual workerd bundle accepts privacy-safe events only into a dedicated synthetic D1', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-product-analytics-workerd-'));
  let runtime: Miniflare | undefined;
  try {
    const assets = join(directory, 'assets');
    await mkdir(assets);
    await writeFile(join(assets, 'index.html'), '<!doctype html><title>Synthetic analytics test</title>');
    const config = join(directory, 'wrangler.json');
    await writeFile(config, JSON.stringify({ name: 'epet-product-analytics-test', main: resolve('worker/index.ts'),
      compatibility_date: '2026-07-29', assets: { directory: assets, binding: 'ASSETS' } }));
    const childEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(directory, 'wrangler.log') };
    for (const key of Object.keys(childEnv)) if (/^(?:CF_|CLOUDFLARE_|STAGING_|SENTRY_)/.test(key)) delete childEnv[key];
    await promisify(execFile)(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'),
      'deploy', '--dry-run', '--config', config, '--outdir', join(directory, 'bundle')], {
      cwd: process.cwd(), env: childEnv, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
    });
    let external = 0;
    runtime = new Miniflare({ modules: true, script: await readFile(join(directory, 'bundle/index.js'), 'utf8'),
      compatibilityDate: '2026-07-29', d1Databases: ['DB', 'ANALYTICS_DB'],
      bindings: { PRODUCT_ANALYTICS_ENABLED: 'true', PRODUCT_ANALYTICS_ENVIRONMENT: 'staging', MONITORING_ENVIRONMENT: 'staging' },
      outboundService: async () => { external++; throw new Error('External requests are forbidden in synthetic intake'); } });
    const database = await runtime.getD1Database('ANALYTICS_DB');
    const sql = await readFile('analytics-migrations/0001_product_analytics.sql', 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map((part) => part.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
    const dispatch = async (input: Request) => runtime!.dispatchFetch(input.url, {
      method: input.method, headers: Object.fromEntries(input.headers), body: await input.text(),
    });
    const response = await dispatch(request());
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await database.prepare('SELECT count FROM product_analytics_usage_daily').first<{ count: number }>())?.count, 1);
    assert.equal((await dispatch(request({ 'sec-gpc': '1' }))).status, 204);
    assert.equal((await database.prepare('SELECT count FROM product_analytics_usage_daily').first<{ count: number }>())?.count, 1);
    const business = await runtime.getD1Database('DB');
    const tables = await business.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").all();
    assert.equal(tables.results.length, 0, 'Anonymous intake must not create or read business tables');
    assert.equal(external, 0);
  } finally {
    await runtime?.dispose();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    await rm(directory, { recursive: true, force: true });
  }
});
