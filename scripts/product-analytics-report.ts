import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import type { D1Database } from '@cloudflare/workers-types';
import { ProductAnalyticsRepository } from '../worker/productAnalyticsRepository';
import { PRODUCT_ANALYTICS_FLOWS } from '../shared/productAnalytics/schema';
import { buildProductOnboardingReport } from '../shared/productAnalytics/report';

// No configurable target, credentials, SQL inputs or remote mode. Never reads business data.
if (process.argv.length !== 2) throw new Error('This synthetic report accepts no arguments.');
const instance = new Miniflare({ modules: true, script: 'export default { fetch(){return new Response(null,{status:404})} }',
  compatibilityDate: '2026-07-29', d1Databases: ['ANALYTICS_DB'] });
try {
  const database = await instance.getD1Database('ANALYTICS_DB') as unknown as D1Database;
  const sql = await readFile('analytics-migrations/0001_product_analytics.sql', 'utf8');
  await database.batch(unstable_splitSqlQuery(sql).map((statement) => database.prepare(statement)));
  const repository = new ProductAnalyticsRepository(database, 'staging');
  const now = Date.parse('2026-11-01T12:00:00.000Z');
  for (const flow of PRODUCT_ANALYTICS_FLOWS) {
    for (let index = 0; index < 20; index++) {
      const attempt = randomUUID();
      for (const stage of ['started', 'local_completed', 'backend_acknowledged'] as const) {
        if (stage === 'backend_acknowledged' && flow.startsWith('report_')) continue;
        const base = { schema_version: 2 as const, kind: 'workflow' as const, attempt, stage };
        if (flow === 'class_create') await repository.ingest({ ...base, flow, class_context: 'first' }, now);
        else await repository.ingest({ ...base, flow }, now);
      }
    }
  }
  const workflows = await repository.readReport({ startDay: '2026-11-01', endDay: '2026-11-01' }, now + 86_400_001);
  assert.equal(workflows.workflows.length, 7);
  assert.ok(workflows.workflows.every((row) => row.mature.local_completion_rate === 1));
  // Account-cohort fixture uses aggregate-only inputs. Real Node/D1 cohort persistence is tested separately.
  const onboarding = buildProductOnboardingReport({ fromDay: '2026-11-01', toDay: '2026-11-01' },
    [{ cohortDay: '2026-11-01', enrolled: 40, started: 40, localReported: 20, backendPersisted: 20 }]);
  const report = { synthetic: true, generated_from: 'isolated_in_memory_D1_and_fixed_cohort_counts', workflows, onboarding };
  const serialized = JSON.stringify(report, null, 2) + '\n';
  assert.ok(!serialized.includes('"attempt"') && !serialized.includes('user_id'));
  await mkdir('output/product-analytics', { recursive: true });
  await writeFile('output/product-analytics/synthetic-report.json', serialized);
  console.log('Synthetic aggregate report: output/product-analytics/synthetic-report.json (no remote data).');
} finally { await instance.dispose(); }
