import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { sanitizeProductAnalyticsEvent, type ProductAnalyticsWorkflowEvent } from '../shared/productAnalytics/schema';
import { buildProductAnalyticsReport, buildProductOnboardingReport } from '../shared/productAnalytics/report';
import { handleProductAnalytics, consumeProductAnalyticsQuota, PRODUCT_ANALYTICS_BODY_LIMIT } from '../worker/productAnalytics';
import { ProductAnalyticsRepository, PRODUCT_ANALYTICS_ATTEMPT_TTL_MS } from '../worker/productAnalyticsRepository';

const canary = 'SYNTHETIC-PRIVATE-STUDENT-SCORE-EMAIL-COOKIE-TOKEN';
const now = Date.UTC(2026, 10, 1, 12);
const event = (stage: ProductAnalyticsWorkflowEvent['stage'] = 'started', attempt: string = crypto.randomUUID()): ProductAnalyticsWorkflowEvent =>
  ({ schema_version: 2, kind: 'workflow', attempt, flow: 'class_create', class_context: 'first', stage });
const request = (body: unknown = event(), headers: Record<string, string> = {}, url = 'https://example.test/api/v1/product-analytics') =>
  new Request(url, { method: 'POST', headers: { origin: 'https://example.test', 'sec-fetch-site': 'same-origin',
    'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const fixture = async () => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response(null); } }',
    compatibilityDate: '2026-07-29', d1Databases: ['ANALYTICS_DB'] });
  try {
    const db = await runtime.getD1Database('ANALYTICS_DB') as unknown as D1Database;
    const sql = await readFile('analytics-migrations/0001_product_analytics.sql', 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
    return { runtime, db, repository: new ProductAnalyticsRepository(db, 'staging') };
  } catch (error) { await runtime.dispose(); throw error; }
};

test('v2 boundary rebuilds only fixed anonymous fields without executing getters or serializers', () => {
  let getterReads = 0;
  const raw = { ...event(), student_count: 37, score: 99, teacher: canary, user_id: canary, url: canary,
    timestamp: canary, nested: { private: canary }, toJSON() { throw new Error(canary); } };
  assert.deepEqual(sanitizeProductAnalyticsEvent(raw), event('started', raw.attempt));
  assert.ok(Object.isFrozen(sanitizeProductAnalyticsEvent(raw)));
  assert.deepEqual(sanitizeProductAnalyticsEvent({ schema_version: 2, kind: 'usage', name: 'exam_created',
    feature: canary, metadata: { student_count: 30 }, attempt: canary }), { schema_version: 2, kind: 'usage', name: 'exam_created' });
  assert.deepEqual(sanitizeProductAnalyticsEvent({ ...raw, flow: 'exam_create', class_context: 'first' }),
    { schema_version: 2, kind: 'workflow', attempt: raw.attempt, flow: 'exam_create', stage: 'started' });
  for (const invalid of [null, [], { ...raw, schema_version: 1 }, { ...raw, attempt: canary }, { ...raw, stage: canary },
    { ...raw, flow: canary }, { ...raw, class_context: canary },
    { schema_version: 2, kind: 'usage', name: 'feature_opened', feature: canary },
    { ...raw, get stage() { getterReads++; throw new Error(canary); } },
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(canary); } })]) {
    assert.equal(sanitizeProductAnalyticsEvent(invalid), undefined);
  }
  assert.equal(getterReads, 0);
  assert.equal(JSON.stringify(sanitizeProductAnalyticsEvent(raw)).includes(canary), false);
});

test('collector fails closed, respects privacy before body/quota/storage, and enforces same-origin and size', async () => {
  let writes = 0;
  let quotaReads = 0;
  const db = { prepare() { writes++; throw new Error(canary); } } as unknown as D1Database;
  const config = { enabled: true, environment: 'staging', database: db };
  const quota = async () => { quotaReads++; return true; };
  assert.equal((await handleProductAnalytics(request(), { ...config, enabled: false }, quota)).status, 404);
  assert.equal((await handleProductAnalytics(request(), { ...config, environment: canary }, quota)).status, 503);
  assert.equal((await handleProductAnalytics(request(), { enabled: true, environment: 'staging' }, quota)).status, 503);
  for (const signal of [{ dnt: '1' }, { dnt: 'yes' }, { 'sec-gpc': '1' }]) {
    const input = request('malformed-private-body', signal);
    assert.equal((await handleProductAnalytics(input, config, quota)).status, 204);
    assert.equal(input.bodyUsed, false);
  }
  assert.equal(writes, 0); assert.equal(quotaReads, 0);
  for (const input of [request(event(), { origin: 'https://evil.test' }), request(event(), { 'sec-fetch-site': 'cross-site' }),
    request(event(), { 'sec-fetch-site': '' }), request(event(), { 'content-type': 'text/plain' }),
    request(event(), {}, 'https://example.test/api/v1/product-analytics?private=' + canary),
    new Request('https://example.test/api/v1/product-analytics', { method: 'GET' })]) {
    assert.equal((await handleProductAnalytics(input, config, quota)).status, 400);
  }
  assert.equal((await handleProductAnalytics(request(event(), { 'content-length': '2049' }), config, quota)).status, 413);
  assert.equal((await handleProductAnalytics(request('x'.repeat(PRODUCT_ANALYTICS_BODY_LIMIT + 1)), config, quota)).status, 413);
  assert.equal((await handleProductAnalytics(request('not-json'), config, quota)).status, 400);
  assert.equal((await handleProductAnalytics(request(), config, async () => false)).status, 429);
  assert.equal((await handleProductAnalytics(request(), config, async () => { throw new Error(canary); })).status, 503);
  assert.equal((await handleProductAnalytics(request(), config, quota)).status, 503);
  assert.equal(writes, 1);
});

test('stream byte limit, invalid UTF-8 and timeout stop intake without writes', async () => {
  let writes = 0;
  const config = { enabled: true, environment: 'staging', database: { prepare() { writes++; throw new Error('unexpected'); } } as unknown as D1Database };
  const streamed = (body: ReadableStream<Uint8Array>) => new Request('https://example.test/api/v1/product-analytics',
    { method: 'POST', headers: { origin: 'https://example.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body, duplex: 'half' } as RequestInit);
  const tooBig = streamed(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024));
    controller.enqueue(new Uint8Array(1025)); controller.close(); } }));
  assert.equal((await handleProductAnalytics(tooBig, config, async () => true)).status, 413);
  const invalid = streamed(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close(); } }));
  assert.equal((await handleProductAnalytics(invalid, config, async () => true)).status, 400);
  let cancelled = false;
  const stalled = streamed(new ReadableStream({ cancel() { cancelled = true; } }));
  assert.equal((await handleProductAnalytics(stalled, config, async () => true)).status, 400);
  assert.equal(cancelled, true);
  assert.equal(writes, 0);
});

test('ephemeral quota bounds client and isolate load without persistent identifiers', async () => {
  for (let index = 0; index < 120; index++) assert.equal(await consumeProductAnalyticsQuota('synthetic-client-one'), true);
  assert.equal(await consumeProductAnalyticsQuota('synthetic-client-one'), false);
  for (let index = 0; index < 1079; index++) assert.equal(await consumeProductAnalyticsQuota(`synthetic-client-${index + 2}`), true);
  assert.equal(await consumeProductAnalyticsQuota('synthetic-client-over-global-limit'), false);
});

test('fresh synthetic D1 stores no payload and deduplicates concurrent stages without extending TTL', async () => {
  const { runtime, db, repository } = await fixture();
  try {
    const start = event();
    await Promise.all(Array.from({ length: 12 }, (_, index) => repository.ingest({ ...start,
      stage: index % 3 === 0 ? 'started' : index % 3 === 1 ? 'local_completed' : 'backend_acknowledged' }, now)));
    await repository.ingest({ ...start, stage: 'started' }, now + 500);
    const row = await db.prepare('SELECT * FROM product_analytics_attempts').first<Record<string, unknown>>();
    assert.ok(row);
    assert.equal(row.started, 1); assert.equal(row.local_completed, 1); assert.equal(row.backend_acknowledged, 1);
    assert.equal(row.expires_at, now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS);
    assert.deepEqual(Object.keys(row).sort(), ['environment', 'attempt', 'flow', 'class_context', 'first_day', 'expires_at',
      'started', 'local_completed', 'backend_acknowledged', 'cancelled', 'rejected', 'unconfirmed'].sort());
    await repository.ingest({ schema_version: 2, kind: 'workflow', attempt: start.attempt, flow: 'exam_create', stage: 'cancelled' }, now + 20);
    assert.equal((await db.prepare('SELECT cancelled FROM product_analytics_attempts').first<{ cancelled: number }>())?.cancelled, 0);
    assert.equal(await repository.finalizeExpired(now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS - 1), 0);
    await Promise.all([repository.finalizeExpired(now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS + 100),
      repository.finalizeExpired(now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS + 100)]);
    const aggregate = await db.prepare('SELECT * FROM product_analytics_workflow_daily').first<Record<string, unknown>>();
    assert.equal(aggregate?.attempts, 1); assert.equal(aggregate?.backend_acknowledged, 1);
    assert.equal(await db.prepare('SELECT attempt FROM product_analytics_attempts').first(), null);
    const report = await repository.readReport({ startDay: '2026-11-01', endDay: '2026-11-02' }, now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS + 200);
    assert.equal(report.workflows[0].mature.counts, null);
    assert.equal(report.workflows[0].mature.backend_acknowledgement_rate, null);
    assert.equal(JSON.stringify(report).includes(start.attempt), false);
    const intake = await handleProductAnalytics(request({ schema_version: 2, kind: 'usage', name: 'exam_created',
      user: canary, score: 100 }, { cookie: canary, authorization: canary }),
    { enabled: true, environment: 'staging', database: db }, async () => true);
    assert.equal(intake.status, 202);
    assert.equal(JSON.stringify(await db.prepare('SELECT * FROM product_analytics_usage_daily').all()).includes(canary), false);
  } finally { await runtime.dispose(); }
});

test('maturity, orphans, missing confirmations, environments, bounded finalization and retention stay distinct', async () => {
  const { runtime, db, repository } = await fixture();
  try {
    const live = event();
    for (let index = 0; index < 10; index++) {
      const started = event();
      await repository.ingest(started, now);
      await repository.ingest({ ...started, stage: 'local_completed' }, now + 1);
      await repository.ingest({ ...started, stage: 'backend_acknowledged' }, now + 2);
      await repository.ingest(event('backend_acknowledged'), now);
      const unconfirmed = event();
      await repository.ingest(unconfirmed, now);
      await repository.ingest({ ...unconfirmed, stage: 'local_completed' }, now + 1);
    }
    await repository.ingest(live, now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS - 100);
    assert.equal(await repository.finalizeExpired(now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS + 10, 5), 5);
    const report = await repository.readReport({ startDay: '2026-11-01', endDay: '2026-11-02' }, now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS + 10);
    const cell = report.workflows[0];
    assert.equal(cell.mature.counts?.attempts, 20); assert.equal(cell.mature.counts?.orphans, 10);
    assert.equal(cell.mature.counts?.unconfirmed, 10); assert.equal(cell.mature.backend_acknowledgement_rate, 0.5);
    assert.equal(report.workflows.find((entry) => entry.day === '2026-11-02')?.immature.suppressed, true);
    const other = new ProductAnalyticsRepository(db, 'production');
    assert.equal((await other.readReport({ startDay: '2026-11-01', endDay: '2026-11-02' }, now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS + 10)).workflows.length, 0);
    await repository.finalizeExpired(now + 31 * PRODUCT_ANALYTICS_ATTEMPT_TTL_MS);
    assert.equal((await db.prepare('SELECT * FROM product_analytics_workflow_daily').all()).results.length, 0);
    assert.equal((await db.prepare('SELECT * FROM product_analytics_attempts').all()).results.length, 0);
  } finally { await runtime.dispose(); }
});

test('failed finalization rolls back both counters and deletion, and retries do not overcount', async () => {
  const { runtime, db, repository } = await fixture();
  try {
    const started = event();
    await repository.ingest(started, now);
    let failed = false;
    const failingDatabase = new Proxy(db, { get(target, key) {
      if (key === 'batch') return (statements: D1PreparedStatement[]) => {
        failed = true;
        return target.batch([...statements.slice(0, 1), target.prepare('INSERT INTO missing_analytics_table VALUES (1)'), ...statements.slice(1)]);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(new ProductAnalyticsRepository(failingDatabase, 'staging').finalizeExpired(now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS), /no such table/);
    assert.equal(failed, true);
    assert.equal((await db.prepare('SELECT attempt FROM product_analytics_attempts').all()).results.length, 1);
    assert.equal((await db.prepare('SELECT * FROM product_analytics_workflow_daily').all()).results.length, 0);
    assert.equal(await repository.finalizeExpired(now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS), 1);
    assert.equal(await repository.finalizeExpired(now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS), 0);
    assert.equal((await db.prepare('SELECT attempts FROM product_analytics_workflow_daily').first<{ attempts: number }>())?.attempts, 1);
  } finally { await runtime.dispose(); }
});

test('local-only report workflows mature without a fabricated backend denominator or unconfirmed failure', async () => {
  const { runtime, repository } = await fixture();
  try {
    for (let index = 0; index < 20; index++) {
      const started = { schema_version: 2 as const, kind: 'workflow' as const, flow: 'report_weekly' as const,
        attempt: crypto.randomUUID(), stage: 'started' as const };
      await repository.ingest(started, now);
      await repository.ingest({ ...started, stage: 'local_completed' }, now + 1);
      if (index < 10) await repository.ingest({ ...started, stage: 'backend_acknowledged' }, now + 2);
    }
    const report = await repository.readReport({ startDay: '2026-11-01', endDay: '2026-11-02' }, now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS + 100);
    assert.equal(report.workflows[0].mature.counts?.attempts, 20);
    assert.equal(report.workflows[0].mature.counts?.local_completed, 20);
    assert.equal(report.workflows[0].mature.counts?.backend_acknowledged, 0);
    assert.equal(report.workflows[0].mature.counts?.unconfirmed, 0);
    assert.equal(report.workflows[0].mature.local_completion_rate, 1);
    assert.equal(report.workflows[0].mature.backend_acknowledgement_rate, null);
  } finally { await runtime.dispose(); }
});

test('pure aggregate report suppresses complementary small cells and zero/missing denominators', () => {
  const base = { day: '2026-11-01', flow: 'class_create' as const, class_context: 'first', attempts: 20,
    local_completed: 20, backend_acknowledged: 19, cancelled: 0, rejected: 0, unconfirmed: 1, abandoned: 0, orphans: 0 };
  const report = buildProductAnalyticsReport({ startDay: base.day, endDay: base.day, environment: 'staging', asOfDay: base.day },
    [base], [], [{ day: base.day, name: 'exam_created', feature: '', count: 9 }]);
  assert.equal(report.workflows[0].mature.suppressed, true);
  assert.equal(report.workflows[0].mature.backend_acknowledgement_rate, null);
  assert.equal(report.usage[0].count, null);
  const complementary = buildProductAnalyticsReport({ startDay: base.day, endDay: base.day, environment: 'staging', asOfDay: base.day },
    [{ ...base, local_completed: 19, backend_acknowledged: 19, unconfirmed: 0 }], [], []);
  assert.equal(complementary.workflows[0].mature.counts, null);
  const orphan = buildProductAnalyticsReport({ startDay: base.day, endDay: base.day, environment: 'staging', asOfDay: base.day },
    [{ ...base, attempts: 0, local_completed: 0, backend_acknowledged: 0, unconfirmed: 0, orphans: 10 }], [], []);
  assert.equal(orphan.workflows[0].mature.backend_acknowledgement_rate, null);
  assert.throws(() => buildProductAnalyticsReport({ startDay: base.day, endDay: base.day, environment: 'staging', asOfDay: base.day, k: 1 }, [], [], []));
});

test('onboarding reports use enrolled eligible creator cohorts and suppress complementary small account cells', () => {
  const input = { fromDay: '2026-11-01', toDay: '2026-11-04' };
  const report = buildProductOnboardingReport(input, [
    { cohortDay: '2026-11-01', enrolled: 100, started: 100, localReported: 100, backendPersisted: 99 },
    { cohortDay: '2026-11-02', enrolled: 100, started: 80, localReported: 50, backendPersisted: 60 },
    { cohortDay: '2026-11-03', enrolled: 0, started: 0, localReported: 0, backendPersisted: 0 },
  ]);
  assert.equal(report.attribution, 'eligible_new_creator_accounts');
  assert.equal(report.denominator, 'enrolled_eligible_new_creator_accounts');
  assert.equal(report.days[0].counts, null); assert.equal(report.days[0].backend_persistence_rate, null);
  assert.equal(report.days[1].local_completion_rate, 0.5); assert.equal(report.days[1].backend_persistence_rate, 0.6);
  assert.equal(report.days[2].started_rate, null); assert.equal(report.days[2].local_completion_rate, null);
  assert.equal(report.days.some((row) => row.cohort_day === '2026-11-04'), false, 'missing cohorts must stay unavailable');
  assert.throws(() => buildProductOnboardingReport({ ...input, k: 1 }, []));
  const noIds = buildProductOnboardingReport(input, [{ cohortDay: '2026-11-01', enrolled: 20, started: 20,
    localReported: 20, backendPersisted: 20, account: canary } as never]);
  assert.equal(JSON.stringify(noIds).includes(canary), false);
});
