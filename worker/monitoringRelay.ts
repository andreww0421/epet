import {
  MONITORING_BODY_LIMIT, MONITORING_TIMEOUT_MS, scrubErrorReport, safelyReport,
  type MonitoringReporter,
} from '../shared/observability/policy';

const json = (status: number, error: string) => new Response(JSON.stringify({ error }), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const windowMs = 60_000;
let windowStart = 0;
let total = 0;
const clients = new Map<string, number>();
let quotaSalt: string | undefined;

/** Bounded isolate-local abuse guard. No raw IP is retained, logged or sent to Sentry. */
export const consumeMonitoringQuota = async (identity: string | null): Promise<boolean> => {
  if (Date.now() - windowStart >= windowMs) { windowStart = Date.now(); total = 0; clients.clear(); }
  if (++total > 200) return false;
  // Workerd forbids generating random values while evaluating a module.
  quotaSalt ??= crypto.randomUUID();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${quotaSalt}:${identity?.slice(0, 64) ?? 'unknown'}`));
  const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const attempts = (clients.get(key) ?? 0) + 1;
  clients.set(key, attempts);
  return attempts <= 20;
};

const readLimitedJson = async (request: Request): Promise<unknown> => {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout>;
  try {
    const reading = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MONITORING_BODY_LIMIT) throw new RangeError('Monitoring body too large');
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    })();
    return await Promise.race([
      reading,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Monitoring body timeout')), MONITORING_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer!);
    void reader.cancel().catch(() => undefined);
  }
};

/** This write-only public intake cannot access auth, a repository, cookies or request context. */
export const handleMonitoringRelay = async (
  request: Request, enabled: boolean, reporter: MonitoringReporter,
  quota: (identity: string | null) => Promise<boolean> = consumeMonitoringQuota,
): Promise<Response> => {
  if (!enabled) return json(404, 'NOT_FOUND');
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin ||
      (request.headers.has('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) return json(403, 'ORIGIN_NOT_ALLOWED');
  if (url.search || request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json(400, 'INVALID_MONITORING_REQUEST');
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MONITORING_BODY_LIMIT)) return json(413, 'PAYLOAD_TOO_LARGE');
  if (!await quota(request.headers.get('cf-connecting-ip'))) return new Response(null, { status: 429, headers: { 'retry-after': '60', 'cache-control': 'no-store' } });
  try {
    const report = scrubErrorReport(await readLimitedJson(request), 'frontend');
    if (!report) return json(400, 'INVALID_MONITORING_REQUEST');
    safelyReport(reporter, report);
    return new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return json(error instanceof RangeError ? 413 : 400, 'INVALID_MONITORING_REQUEST');
  }
};
