import type { D1Database } from '@cloudflare/workers-types';
import { productAnalyticsEnvironment, sanitizeProductAnalyticsEvent } from '../shared/productAnalytics/schema';
import { ProductAnalyticsRepository } from './productAnalyticsRepository';
import { validProductAnalyticsDay } from '../shared/productAnalytics/report';

export const PRODUCT_ANALYTICS_PATH = '/api/v1/product-analytics';
export const PRODUCT_ANALYTICS_BODY_LIMIT = 2048;
export const PRODUCT_ANALYTICS_BODY_TIMEOUT_MS = 1500;
export type ProductAnalyticsQuota = (identity: string | null) => Promise<boolean>;
export type ProductAnalyticsCollectorConfig = { enabled: boolean; environment: unknown; database?: D1Database };
export type WorkerProductAnalyticsEnvironment = {
  PRODUCT_ANALYTICS_ENABLED?: string; PRODUCT_ANALYTICS_ENVIRONMENT?: string; PRODUCT_ANALYTICS_COHORT_START?: string;
  MONITORING_ENVIRONMENT?: string; DB?: D1Database; ANALYTICS_DB?: D1Database;
};
/** No environment/database fallback. A binding alias is a configuration failure. */
export const resolveWorkerProductAnalyticsConfig = (env: WorkerProductAnalyticsEnvironment, now = Date.now()) => {
  const enabled = env.PRODUCT_ANALYTICS_ENABLED === 'true';
  const configuredEnvironment = productAnalyticsEnvironment(env.PRODUCT_ANALYTICS_ENVIRONMENT);
  const environment = configuredEnvironment === productAnalyticsEnvironment(env.MONITORING_ENVIRONMENT) ? configuredEnvironment : undefined;
  const database = env.ANALYTICS_DB && env.ANALYTICS_DB !== env.DB ? env.ANALYTICS_DB : undefined;
  const collector: ProductAnalyticsCollectorConfig = { enabled, environment, database };
  const cutoff = env.PRODUCT_ANALYTICS_COHORT_START;
  const cutoffDay = typeof cutoff === 'string' && /^\d{4}-\d{2}-\d{2}(?:T00:00:00\.000Z)?$/.test(cutoff) ? cutoff.slice(0, 10) : undefined;
  const cohortStart = cutoffDay && validProductAnalyticsDay(cutoffDay) ? Date.parse(cutoffDay + 'T00:00:00.000Z') : undefined;
  const onboarding = enabled && environment && database && cohortStart !== undefined && cohortStart >= 0 &&
    Number.isSafeInteger(now) && now >= cohortStart
    ? { enabled: true as const, environment, cohortStart } : undefined;
  return { collector, onboarding };
};
const response = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store',
  ...(status === 429 ? { 'retry-after': '60' } : {}) } });
let windowStart = 0;
let total = 0;
let salt: string | undefined;
const clients = new Map<string, number>();

/** Bounded, ephemeral isolate guard; raw IP and salted hashes never enter storage. */
export const consumeProductAnalyticsQuota: ProductAnalyticsQuota = async (identity) => {
  const now = Date.now();
  if (now - windowStart >= 60_000) { windowStart = now; total = 0; clients.clear(); salt = undefined; }
  if (++total > 1200) return false;
  // Generate lazily: workerd forbids randomness at module evaluation time.
  salt ??= crypto.randomUUID();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${identity?.slice(0, 64) ?? 'unknown'}`));
  const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (!clients.has(key) && clients.size >= 1200) return false;
  const count = (clients.get(key) ?? 0) + 1;
  clients.set(key, count);
  return count <= 120;
};

const limitedJson = async (request: Request): Promise<unknown> => {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid body');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const bytes = new Uint8Array(PRODUCT_ANALYTICS_BODY_LIMIT);
        let length = 0;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > bytes.length) throw new RangeError('Body limit');
          bytes.set(chunk.value, length - chunk.value.byteLength);
        }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))) as unknown;
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Body timeout')), PRODUCT_ANALYTICS_BODY_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
};

/** Public write-only intake. It performs no auth lookup, cookie read, logging or error reporting. */
export const handleProductAnalytics = async (
  request: Request, config: ProductAnalyticsCollectorConfig, quota: ProductAnalyticsQuota = consumeProductAnalyticsQuota,
): Promise<Response> => {
  if (config.enabled !== true) return response(404);
  const environment = productAnalyticsEnvironment(config.environment);
  if (!environment || !config.database) return response(503);
  // Respect explicit privacy signals before touching the body, quota or datastore.
  if (/^(?:1|yes)$/i.test(request.headers.get('dnt') ?? '') || request.headers.get('sec-gpc') === '1') return response(204);
  if (request.method !== 'POST') return response(400);
  const url = new URL(request.url);
  if (url.pathname !== PRODUCT_ANALYTICS_PATH || url.search || request.headers.get('origin') !== url.origin ||
      request.headers.get('sec-fetch-site') !== 'same-origin' ||
      request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return response(400);
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > PRODUCT_ANALYTICS_BODY_LIMIT)) return response(413);
  try {
    if (!await quota(request.headers.get('cf-connecting-ip'))) return response(429);
  } catch { return response(503); }
  let event;
  try { event = sanitizeProductAnalyticsEvent(await limitedJson(request)); }
  catch (error) { return response(error instanceof RangeError ? 413 : 400); }
  if (!event) return response(400);
  try { await new ProductAnalyticsRepository(config.database, environment).ingest(event); }
  catch { return response(503); }
  return response(202);
};
