import { PRODUCT_ANALYTICS_FLOWS, productAnalyticsEnvironment, type ProductAnalyticsFlow, type ProductAnalyticsEnvironment } from './schema';
import { ANALYTICS_EVENT_NAMES } from '../../src/analytics/schema';
import { CONSOLE_DESTINATIONS } from '../../src/features/teacher-console/model/navigation';

export const PRODUCT_ANALYTICS_DEFAULT_K = 10;
export type WorkflowCounts = {
  attempts: number; local_completed: number; backend_acknowledged: number;
  cancelled: number; rejected: number; unconfirmed: number; abandoned: number; orphans: number;
};
export type OpenCounts = { open: number; started: number; local_completed: number; backend_acknowledged: number; orphans: number };
export type WorkflowAggregateRow = WorkflowCounts & { day: string; flow: ProductAnalyticsFlow; class_context: string };
export type OpenAggregateRow = OpenCounts & { day: string; flow: ProductAnalyticsFlow; class_context: string };
export type UsageAggregateRow = { day: string; name: string; feature: string; count: number };
export type ProductAnalyticsReportInput = { startDay: string; endDay: string; k?: number };
export const validProductAnalyticsDay = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) &&
  new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value;
export const validateProductAnalyticsReportInput = (input: ProductAnalyticsReportInput) => {
  if (!validProductAnalyticsDay(input.startDay) || !validProductAnalyticsDay(input.endDay) || input.startDay > input.endDay ||
      Date.parse(input.endDay) - Date.parse(input.startDay) > 30 * 86_400_000) throw new Error('Invalid analytics report range');
  // An operator may raise k, but cannot bypass the privacy floor.
  if (input.k !== undefined && (!Number.isInteger(input.k) || input.k < PRODUCT_ANALYTICS_DEFAULT_K || input.k > 1000)) {
    throw new Error('Invalid analytics suppression threshold');
  }
};
const suppress = <T extends Record<string, number>>(counts: T, k: number): { suppressed: boolean; counts: T | null } => {
  const suppressed = Object.values(counts).some((count) => !Number.isSafeInteger(count) || count < 0 || (count > 0 && count < k));
  return { suppressed, counts: suppressed ? null : counts };
};
const workflowFields = ['attempts', 'local_completed', 'backend_acknowledged', 'cancelled', 'rejected', 'unconfirmed', 'abandoned', 'orphans'] as const;
const openFields = ['open', 'started', 'local_completed', 'backend_acknowledged', 'orphans'] as const;
const pickCounts = <K extends string>(row: Record<K, number> | undefined, keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((key) => [key, row?.[key] ?? 0])) as Record<K, number>;

/** Aggregate-only boundary: this function never receives or emits an attempt nonce. */
export const buildProductAnalyticsReport = (
  input: ProductAnalyticsReportInput & { environment: ProductAnalyticsEnvironment; asOfDay: string },
  matureRows: readonly WorkflowAggregateRow[], openRows: readonly OpenAggregateRow[], usageRows: readonly UsageAggregateRow[],
) => {
  validateProductAnalyticsReportInput(input);
  if (!productAnalyticsEnvironment(input.environment) || !validProductAnalyticsDay(input.asOfDay)) throw new Error('Invalid analytics report configuration');
  const k = input.k ?? PRODUCT_ANALYTICS_DEFAULT_K;
  const validDimension = (row: WorkflowAggregateRow | OpenAggregateRow) =>
    validProductAnalyticsDay(row.day) && row.day >= input.startDay && row.day <= input.endDay &&
    PRODUCT_ANALYTICS_FLOWS.some((flow) => flow === row.flow) &&
    (row.flow === 'class_create' ? ['', 'first', 'subsequent'].includes(row.class_context) : row.class_context === '');
  const rows = new Map<string, { mature?: WorkflowAggregateRow; open?: OpenAggregateRow }>();
  for (const row of matureRows) if (validDimension(row)) rows.set(`${row.day}|${row.flow}|${row.class_context}`, { mature: row });
  for (const row of openRows) {
    if (!validDimension(row)) continue;
    const key = `${row.day}|${row.flow}|${row.class_context}`;
    rows.set(key, { ...rows.get(key), open: row });
  }
  const workflows = [...rows.values()].map(({ mature, open }) => {
    const dimension = mature ?? open!;
    const requiresBackend = dimension.flow !== 'report_weekly' && dimension.flow !== 'report_exam';
    const matureCounts = pickCounts(mature, workflowFields);
    if (!requiresBackend) matureCounts.backend_acknowledged = 0;
    const matureSuppression = suppress({ ...matureCounts,
      without_local_completion: matureCounts.attempts - matureCounts.local_completed,
      without_backend_acknowledgement: matureCounts.attempts - matureCounts.backend_acknowledged }, k);
    const finalized = { suppressed: matureSuppression.suppressed, counts: matureSuppression.suppressed ? null : matureCounts };
    const openCounts = pickCounts(open, openFields);
    if (!requiresBackend) openCounts.backend_acknowledged = 0;
    const openSuppression = suppress({ ...openCounts, started_without_local: openCounts.started - openCounts.local_completed,
      started_without_backend: openCounts.started - openCounts.backend_acknowledged }, k);
    const immature = { suppressed: openSuppression.suppressed, counts: openSuppression.suppressed ? null : openCounts };
    const counts = finalized.counts;
    // An absent/zero/suppressed denominator is never converted into a misleading zero rate.
    const denominator = counts?.attempts;
    return { day: dimension.day, flow: dimension.flow,
      ...(dimension.flow === 'class_create' && dimension.class_context ? { class_context: dimension.class_context } : {}),
      mature: { ...finalized, local_completion_rate: denominator ? counts!.local_completed / denominator : null,
        backend_acknowledgement_rate: requiresBackend && denominator ? counts!.backend_acknowledged / denominator : null }, immature };
  }).sort((a, b) => `${a.day}|${a.flow}|${a.class_context ?? ''}`.localeCompare(`${b.day}|${b.flow}|${b.class_context ?? ''}`));
  return {
    schema_version: 2 as const, environment: input.environment, start_day: input.startDay, end_day: input.endDay,
    as_of_day: input.asOfDay, suppression_k: k, attribution: 'anonymous_attempts' as const,
    acknowledgement: 'client_observed_backend_acknowledgement' as const,
    workflows, usage: usageRows.filter((row) => validProductAnalyticsDay(row.day) && row.day >= input.startDay && row.day <= input.endDay &&
      ANALYTICS_EVENT_NAMES.some((name) => name === row.name) &&
      (row.name === 'feature_opened' ? CONSOLE_DESTINATIONS.some(({ id }) => id === row.feature) : row.feature === ''))
      .map((row) => {
        const value = suppress({ count: row.count }, k);
        return { day: row.day, name: row.name, ...(row.feature ? { feature: row.feature } : {}),
          suppressed: value.suppressed, count: value.counts?.count ?? null };
      }),
  };
};
export type ProductAnalyticsReport = ReturnType<typeof buildProductAnalyticsReport>;

/** Structurally compatible with summarizeProductOnboarding; no account IDs enter this boundary. */
export type ProductOnboardingDailyCounts = {
  cohortDay: string; enrolled: number; started: number; localReported: number; backendPersisted: number;
};
export const buildProductOnboardingReport = (
  input: { fromDay: string; toDay: string; k?: number }, rows: readonly ProductOnboardingDailyCounts[],
) => {
  if (!validProductAnalyticsDay(input.fromDay) || !validProductAnalyticsDay(input.toDay) || input.fromDay > input.toDay ||
      Date.parse(input.toDay) - Date.parse(input.fromDay) > 90 * 86_400_000) throw new Error('Invalid onboarding report range');
  const k = input.k ?? PRODUCT_ANALYTICS_DEFAULT_K;
  if (!Number.isInteger(k) || k < PRODUCT_ANALYTICS_DEFAULT_K || k > 1000) throw new Error('Invalid onboarding suppression threshold');
  const days = rows.filter((row) => validProductAnalyticsDay(row.cohortDay) && row.cohortDay >= input.fromDay && row.cohortDay <= input.toDay)
    .map((row) => {
      const counts = { enrolled: row.enrolled, started: row.started, local_reported: row.localReported,
        backend_persisted: row.backendPersisted };
      // Suppress complementary cells too: 100 enrolled and 99 persisted would
      // otherwise disclose a one-account remainder. Local and backend reports
      // are independent indicators; neither is a denominator for the other.
      const inspected = suppress({ ...counts, not_started: row.enrolled - row.started,
        not_local_reported: row.enrolled - row.localReported, not_backend_persisted: row.enrolled - row.backendPersisted,
        started_without_local: row.started - row.localReported, started_without_backend: row.started - row.backendPersisted }, k);
      const available = !inspected.suppressed && row.enrolled > 0;
      return { cohort_day: row.cohortDay, suppressed: inspected.suppressed, counts: inspected.suppressed ? null : counts,
        started_rate: available ? row.started / row.enrolled : null,
        local_completion_rate: available ? row.localReported / row.enrolled : null,
        backend_persistence_rate: available ? row.backendPersisted / row.enrolled : null };
    }).sort((a, b) => a.cohort_day.localeCompare(b.cohort_day));
  return { schema_version: 2 as const, attribution: 'eligible_new_creator_accounts' as const,
    denominator: 'enrolled_eligible_new_creator_accounts' as const,
    from_day: input.fromDay, to_day: input.toDay, suppression_k: k, days };
};
export type ProductOnboardingReport = ReturnType<typeof buildProductOnboardingReport>;
