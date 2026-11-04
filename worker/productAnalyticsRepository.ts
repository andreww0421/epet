import type { D1Database } from '@cloudflare/workers-types';
import { productAnalyticsEnvironment, sanitizeProductAnalyticsEvent, type ProductAnalyticsEnvironment,
  type ProductAnalyticsEvent } from '../shared/productAnalytics/schema';
import { buildProductAnalyticsReport, validateProductAnalyticsReportInput, type ProductAnalyticsReportInput,
  type WorkflowAggregateRow, type OpenAggregateRow, type UsageAggregateRow } from '../shared/productAnalytics/report';

export const PRODUCT_ANALYTICS_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
const day = (now: number) => new Date(now).toISOString().slice(0, 10);
const validNow = (now: number) => {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new Error('Invalid analytics clock');
};
const stages = ['started', 'local_completed', 'backend_acknowledged', 'cancelled', 'rejected', 'unconfirmed'] as const;

/** Dedicated anonymous datastore. It has no account/workspace repository or request context. */
export class ProductAnalyticsRepository {
  private readonly environment: ProductAnalyticsEnvironment;
  constructor(private readonly database: D1Database, environment: unknown) {
    const resolved = productAnalyticsEnvironment(environment);
    if (!resolved) throw new Error('Invalid analytics environment');
    this.environment = resolved;
  }

  async ingest(input: ProductAnalyticsEvent, now = Date.now()): Promise<void> {
    validNow(now);
    const event = sanitizeProductAnalyticsEvent(input);
    if (!event) throw new Error('Invalid analytics event');
    if (event.kind === 'usage') {
      await this.database.prepare(`INSERT INTO product_analytics_usage_daily (environment, day, name, feature, count)
        VALUES (?, ?, ?, ?, 1) ON CONFLICT (environment, day, name, feature) DO UPDATE SET count = count + 1`)
        .bind(this.environment, day(now), event.name, event.name === 'feature_opened' ? event.feature : '').run();
      return;
    }
    // All flags are monotonic, independently observed facts. UPSERT never invents
    // a start/local completion from an acknowledgement and never extends the TTL.
    // A nonce cannot change flows/contexts, even under concurrent requests.
    await this.database.prepare(`INSERT INTO product_analytics_attempts
      (environment, attempt, flow, class_context, first_day, expires_at, ${stages.join(', ')})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (environment, attempt) DO UPDATE SET
      ${stages.map((stage) => `${stage} = MAX(${stage}, excluded.${stage})`).join(', ')}
      WHERE product_analytics_attempts.flow = excluded.flow
        AND product_analytics_attempts.class_context = excluded.class_context
        AND product_analytics_attempts.expires_at > ?`)
      .bind(this.environment, event.attempt, event.flow, event.flow === 'class_create' ? event.class_context ?? '' : '',
        day(now), now + PRODUCT_ANALYTICS_ATTEMPT_TTL_MS, ...stages.map((stage) => Number(event.stage === stage)), now).run();
  }

  /** Each D1 batch atomically rolls up and deletes the same bounded expired set. */
  async finalizeExpired(now = Date.now(), limit = 500): Promise<number> {
    validNow(now);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid analytics finalization limit');
    const selected = `SELECT attempt FROM product_analytics_attempts WHERE environment = ? AND expires_at <= ?
      ORDER BY expires_at, attempt LIMIT ?`;
    const result = await this.database.batch([
      this.database.prepare(`INSERT INTO product_analytics_workflow_daily
        (environment, day, flow, class_context, attempts, local_completed, backend_acknowledged, cancelled,
         rejected, unconfirmed, abandoned, orphans)
        SELECT environment, first_day, flow, class_context, SUM(started),
          SUM(CASE WHEN started = 1 AND local_completed = 1 THEN 1 ELSE 0 END),
          SUM(CASE WHEN started = 1 AND local_completed = 1 AND backend_acknowledged = 1
            AND flow NOT IN ('report_weekly', 'report_exam')
            AND cancelled = 0 AND rejected = 0 AND unconfirmed = 0 THEN 1 ELSE 0 END),
          SUM(CASE WHEN started = 1 AND cancelled = 1 THEN 1 ELSE 0 END),
          SUM(CASE WHEN started = 1 AND rejected = 1 THEN 1 ELSE 0 END),
          SUM(CASE WHEN started = 1 AND (unconfirmed = 1
            OR (flow NOT IN ('report_weekly', 'report_exam') AND
              ((backend_acknowledged = 1 AND (local_completed = 0 OR cancelled = 1 OR rejected = 1))
              OR (local_completed = 1 AND backend_acknowledged = 0 AND cancelled = 0 AND rejected = 0)))) THEN 1 ELSE 0 END),
          SUM(CASE WHEN started = 1 AND local_completed = 0
            AND (backend_acknowledged = 0 OR flow IN ('report_weekly', 'report_exam'))
            AND cancelled = 0 AND rejected = 0 AND unconfirmed = 0 THEN 1 ELSE 0 END),
          SUM(CASE WHEN started = 0 THEN 1 ELSE 0 END)
        FROM product_analytics_attempts WHERE environment = ? AND attempt IN (${selected})
        GROUP BY environment, first_day, flow, class_context
        ON CONFLICT (environment, day, flow, class_context) DO UPDATE SET
          attempts = attempts + excluded.attempts,
          local_completed = local_completed + excluded.local_completed,
          backend_acknowledged = backend_acknowledged + excluded.backend_acknowledged,
          cancelled = cancelled + excluded.cancelled, rejected = rejected + excluded.rejected,
          unconfirmed = unconfirmed + excluded.unconfirmed, abandoned = abandoned + excluded.abandoned,
          orphans = orphans + excluded.orphans`)
        .bind(this.environment, this.environment, now, limit),
      this.database.prepare(`DELETE FROM product_analytics_attempts WHERE environment = ? AND attempt IN (${selected})`)
        .bind(this.environment, this.environment, now, limit),
      this.database.prepare('DELETE FROM product_analytics_workflow_daily WHERE environment = ? AND day < ?')
        .bind(this.environment, day(now - 29 * 86_400_000)),
      this.database.prepare('DELETE FROM product_analytics_usage_daily WHERE environment = ? AND day < ?')
        .bind(this.environment, day(now - 29 * 86_400_000)),
    ]);
    return result[1].meta.changes;
  }

  async readReport(input: ProductAnalyticsReportInput, now = Date.now()) {
    validNow(now);
    validateProductAnalyticsReportInput(input);
    // Bounded work: remaining expired rows are not exposed as mature or immature.
    await this.finalizeExpired(now);
    const results = await this.database.batch([
      this.database.prepare(`SELECT day, flow, class_context, attempts, local_completed, backend_acknowledged,
        cancelled, rejected, unconfirmed, abandoned, orphans FROM product_analytics_workflow_daily
        WHERE environment = ? AND day BETWEEN ? AND ? ORDER BY day, flow, class_context`)
        .bind(this.environment, input.startDay, input.endDay),
      this.database.prepare(`SELECT first_day AS day, flow, class_context, COUNT(*) AS open, SUM(started) AS started,
        SUM(CASE WHEN started = 1 AND local_completed = 1 THEN 1 ELSE 0 END) AS local_completed,
        SUM(CASE WHEN started = 1 AND local_completed = 1 AND backend_acknowledged = 1
          AND flow NOT IN ('report_weekly', 'report_exam')
          AND cancelled = 0 AND rejected = 0 AND unconfirmed = 0 THEN 1 ELSE 0 END) AS backend_acknowledged,
        SUM(CASE WHEN started = 0 THEN 1 ELSE 0 END) AS orphans
        FROM product_analytics_attempts WHERE environment = ? AND first_day BETWEEN ? AND ? AND expires_at > ?
        GROUP BY first_day, flow, class_context ORDER BY first_day, flow, class_context`)
        .bind(this.environment, input.startDay, input.endDay, now),
      this.database.prepare(`SELECT day, name, feature, count FROM product_analytics_usage_daily
        WHERE environment = ? AND day BETWEEN ? AND ? ORDER BY day, name, feature`)
        .bind(this.environment, input.startDay, input.endDay),
      this.database.prepare(`SELECT COUNT(*) AS count FROM product_analytics_attempts
        WHERE environment = ? AND expires_at <= ?`).bind(this.environment, now),
    ]);
    const pending = (results[3].results[0] as { count: number }).count;
    return { ...buildProductAnalyticsReport({ ...input, environment: this.environment, asOfDay: day(now) },
      results[0].results as unknown as WorkflowAggregateRow[], results[1].results as unknown as OpenAggregateRow[],
      results[2].results as unknown as UsageAggregateRow[]), finalization_pending: pending > 0 };
  }
}
