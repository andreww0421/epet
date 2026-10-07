/** The only domain information permitted to cross the monitoring boundary. */
export const ERROR_CATEGORIES = [
  'frontend.uncaught', 'frontend.rejection', 'frontend.react',
  'frontend.api.http', 'frontend.api.network', 'frontend.api.timeout',
  'frontend.api.response', 'worker.unhandled', 'worker.api.http',
  'worker.background', 'worker.scheduled',
] as const;
export const ROUTE_GROUPS = [
  'auth', 'workspace', 'student', 'learning', 'analytics', 'boss',
  'administration', 'health', 'assets', 'unknown',
] as const;
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'unknown'] as const;
export type ErrorCategory = typeof ERROR_CATEGORIES[number];
export type RouteGroup = typeof ROUTE_GROUPS[number];
export type HttpMethod = typeof HTTP_METHODS[number];
export type MonitoringEnvironment = 'development' | 'staging' | 'production';
export type MonitoringSource = 'frontend' | 'worker';
export type ErrorReport = {
  category: ErrorCategory;
  route: RouteGroup;
  method: HttpMethod;
  status?: number;
};
export type MonitoringReporter = (report: ErrorReport) => void;
export type MonitoringContext = {
  environment: MonitoringEnvironment;
  source: MonitoringSource;
  release?: string;
};
export type MonitoringConfig = MonitoringContext & { dsn: string; endpoint: string };
export const MONITORING_PATH = '/api/v1/monitoring';
export const MONITORING_TIMEOUT_MS = 1_500;
export const MONITORING_BODY_LIMIT = 2_048;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
const member = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T);

export const monitoringEnvironment = (value: unknown): MonitoringEnvironment | undefined =>
  value === 'development' || value === 'staging' || value === 'production' ? value : undefined;
export const monitoringRelease = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : undefined;

/** Fail closed: no cross-environment fallback, arbitrary URL, DSN path, or auth secret. */
export const resolveMonitoringConfig = (
  environment: unknown, dsn: unknown, source: MonitoringSource, release?: unknown,
): MonitoringConfig | undefined => {
  const resolvedEnvironment = monitoringEnvironment(environment);
  if (!resolvedEnvironment || typeof dsn !== 'string' || !dsn) return undefined;
  try {
    const url = new URL(dsn);
    if (url.protocol !== 'https:' || url.port || url.password || url.search || url.hash ||
        !/^o\d+\.ingest(?:\.(?:us|eu|de))?\.sentry\.io$/.test(url.hostname) ||
        !/^[a-f0-9]{32}$/.test(url.username) || !/^\/\d{1,20}$/.test(url.pathname)) return undefined;
    return {
      environment: resolvedEnvironment, source, release: monitoringRelease(release),
      dsn: url.toString(),
      endpoint: `${url.origin}/api${url.pathname}/envelope/?sentry_key=${url.username}&sentry_version=7`,
    };
  } catch { return undefined; }
};

/** Rebuild, never redact. Unknown fields and every free-form string are discarded. */
export const scrubErrorReport = (input: unknown, source: MonitoringSource): ErrorReport | undefined => {
  try {
    const candidate = record(input);
    if (!candidate || !member(ERROR_CATEGORIES, candidate.category) ||
        !candidate.category.startsWith(`${source}.`)) return undefined;
    const report: ErrorReport = {
      category: candidate.category,
      route: member(ROUTE_GROUPS, candidate.route) ? candidate.route : 'unknown',
      method: member(HTTP_METHODS, candidate.method) ? candidate.method : 'unknown',
    };
    if (report.category.endsWith('.http') && typeof candidate.status === 'number' &&
        Number.isInteger(candidate.status) && candidate.status >= 500 && candidate.status <= 599) {
      report.status = candidate.status;
    }
    return report;
  } catch { return undefined; }
};

/** This returns a constant group, not a URL/template containing identifiers. */
export const monitoringRouteGroup = (path: string): RouteGroup => {
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname === '/api/v1/health') return 'health';
  if (pathname.startsWith('/api/v1/auth/')) return 'auth';
  if (pathname.includes('/analytics') && pathname.startsWith('/api/v1/classes/')) return 'analytics';
  if (pathname.startsWith('/api/v1/classes/') && pathname.includes('/students/')) return 'student';
  if (pathname.startsWith('/api/v1/learning/') || pathname.startsWith('/api/v1/exams/')) return 'learning';
  if (pathname.startsWith('/api/v1/boss/')) return 'boss';
  if (/^\/api\/v1\/(?:audit|members|invitations|account|privacy)(?:\/|$)/.test(pathname)) return 'administration';
  if (/^\/api\/v1\/(?:state|revisions|workspaces?|classes)(?:\/|$)/.test(pathname)) return 'workspace';
  if (!pathname.startsWith('/api/')) return 'assets';
  return 'unknown';
};
export const monitoringMethod = (method: string): HttpMethod =>
  member(HTTP_METHODS, method.toUpperCase()) ? method.toUpperCase() as HttpMethod : 'unknown';

/** Monitoring must never replace a product error or interrupt an authenticated request. */
export const safelyReport = (reporter: MonitoringReporter | undefined, report: ErrorReport): void => {
  try { reporter?.(report); } catch { /* Fail silent; do not log the error being monitored. */ }
};

export const reportFromSdkEvent = (input: unknown, source: MonitoringSource): ErrorReport => {
  try {
    const tags = record(record(input)?.tags);
    const status = tags?.['epet.status'];
    const report = scrubErrorReport({
      category: tags?.['epet.category'], route: tags?.['epet.route'],
      method: tags?.['epet.method'], status: typeof status === 'string' && /^5\d\d$/.test(status) ? Number(status) : status,
    }, source);
    if (report) return report;
  } catch { /* No getters/normalizers from an arbitrary exception are trusted. */ }
  return { category: source === 'frontend' ? 'frontend.uncaught' : 'worker.unhandled', route: 'unknown', method: 'unknown' };
};

/** Drop every non-error channel, item/header metadata, attachment and serialized payload. */
export const reportsFromEnvelope = (input: unknown, source: MonitoringSource): ErrorReport[] => {
  try {
    if (!Array.isArray(input) || !Array.isArray(input[1])) return [];
    return input[1].slice(0, 20).flatMap((item: unknown) => {
      if (!Array.isArray(item) || record(item[0])?.type !== 'event' || !record(item[1])) return [];
      return [reportFromSdkEvent(item[1], source)];
    });
  } catch { return []; }
};
