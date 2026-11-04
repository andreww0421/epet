import { ANALYTICS_EVENT_NAMES, type AnalyticsEventName } from '../../src/analytics/schema';
import { CONSOLE_DESTINATIONS, type ConsoleDestination } from '../../src/features/teacher-console/model/navigation';

export type ProductAnalyticsEnvironment = 'development' | 'staging' | 'production';
export const PRODUCT_ANALYTICS_FLOWS = ['class_create', 'roster_import', 'point_increase', 'point_decrease',
  'exam_create', 'report_weekly', 'report_exam'] as const;
export const PRODUCT_ANALYTICS_STAGES = ['started', 'local_completed', 'backend_acknowledged',
  'cancelled', 'rejected', 'unconfirmed'] as const;
export type ProductAnalyticsFlow = typeof PRODUCT_ANALYTICS_FLOWS[number];
export type ProductAnalyticsStage = typeof PRODUCT_ANALYTICS_STAGES[number];
export type ProductAnalyticsWorkflowEvent = Readonly<{
  schema_version: 2; kind: 'workflow'; attempt: string; stage: ProductAnalyticsStage;
} & ({ flow: 'class_create'; class_context?: 'first' | 'subsequent' } |
  { flow: Exclude<ProductAnalyticsFlow, 'class_create'>; class_context?: never })>;
export type ProductAnalyticsUsageEvent = Readonly<{ schema_version: 2; kind: 'usage' } & (
  { name: Exclude<AnalyticsEventName, 'feature_opened'>; feature?: never } |
  { name: 'feature_opened'; feature: ConsoleDestination }
)>;
export type ProductAnalyticsEvent = ProductAnalyticsWorkflowEvent | ProductAnalyticsUsageEvent;

export const productAnalyticsEnvironment = (value: unknown): ProductAnalyticsEnvironment | undefined =>
  value === 'development' || value === 'staging' || value === 'production' ? value : undefined;
const flows = new Set<string>(PRODUCT_ANALYTICS_FLOWS);
const stages = new Set<string>(PRODUCT_ANALYTICS_STAGES);
const names = new Set<string>(ANALYTICS_EVENT_NAMES);
const features = new Set<string>(CONSOLE_DESTINATIONS.map(({ id }) => id));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ownData = (input: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};

/** Rebuild the closed wire schema. No getters, serializers, nested data or caller context are read. */
export const sanitizeProductAnalyticsEvent = (input: unknown): ProductAnalyticsEvent | undefined => {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input) || ownData(input, 'schema_version') !== 2) return undefined;
    const kind = ownData(input, 'kind');
    if (kind === 'workflow') {
      const attempt = ownData(input, 'attempt');
      const flow = ownData(input, 'flow');
      const stage = ownData(input, 'stage');
      if (typeof attempt !== 'string' || !uuid.test(attempt) || typeof flow !== 'string' || !flows.has(flow) ||
          typeof stage !== 'string' || !stages.has(stage)) return undefined;
      const classContext = ownData(input, 'class_context');
      if (flow === 'class_create' && classContext !== undefined && classContext !== 'first' && classContext !== 'subsequent') return undefined;
      return Object.freeze({ schema_version: 2, kind, attempt, flow, stage,
        ...(flow === 'class_create' && classContext !== undefined ? { class_context: classContext } : {}) }) as ProductAnalyticsWorkflowEvent;
    }
    if (kind === 'usage') {
      const name = ownData(input, 'name');
      if (typeof name !== 'string' || !names.has(name)) return undefined;
      if (name === 'feature_opened') {
        const feature = ownData(input, 'feature');
        if (typeof feature !== 'string' || !features.has(feature)) return undefined;
        return Object.freeze({ schema_version: 2, kind, name, feature }) as ProductAnalyticsUsageEvent;
      }
      return Object.freeze({ schema_version: 2, kind, name }) as ProductAnalyticsUsageEvent;
    }
    return undefined;
  } catch { return undefined; }
};
