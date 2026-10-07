import { CONSOLE_DESTINATIONS, type ConsoleDestination } from '../features/teacher-console/model/navigation';

export type AnalyticsEnvironment = 'development' | 'staging' | 'production';
type EmptyMetadata = Readonly<Record<string, never>>;
export type AnalyticsMetadata = {
  workspace_created: { creation_source: 'registration' | 'explicit' };
  class_created: EmptyMetadata;
  student_import_completed: { student_count: number };
  point_action_completed: { student_count: number; action_source: 'quick' | 'manual' | 'airdrop'; direction: 'increase' | 'decrease' };
  learning_evidence_created: EmptyMetadata;
  exam_created: EmptyMetadata;
  report_generated: { report_type: 'weekly_feedback' | 'exam_summary'; format: 'csv' | 'print' };
  boss_started: EmptyMetadata;
  feature_opened: { feature: ConsoleDestination };
};
export type AnalyticsEventName = keyof AnalyticsMetadata;
export type AnalyticsEventFor<Name extends AnalyticsEventName> = Readonly<{
  name: Name;
  metadata: Readonly<AnalyticsMetadata[Name]>;
  environment: AnalyticsEnvironment;
  schema_version: 1;
}>;
export type AnalyticsEvent = { [Name in AnalyticsEventName]: AnalyticsEventFor<Name> }[AnalyticsEventName];
export const ANALYTICS_EVENT_NAMES = [
  'workspace_created', 'class_created', 'student_import_completed', 'point_action_completed',
  'learning_evidence_created', 'exam_created', 'report_generated', 'boss_started', 'feature_opened',
] as const satisfies readonly AnalyticsEventName[];
export const MAX_ANALYTICS_COUNT = 100_000;
const featureNames = new Set<string>(CONSOLE_DESTINATIONS.map(({ id }) => id));

export const analyticsEnvironment = (value: unknown): AnalyticsEnvironment | undefined =>
  value === 'development' || value === 'staging' || value === 'production' ? value : undefined;

// Read only own data properties: never invoke user-object getters/toJSON or walk
// arbitrary payloads. Rebuilding drops IDs, nested objects and all free-form text.
const dataProperty = (value: unknown, key: string): unknown => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};
const isMetadata = (value: unknown): boolean => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_ANALYTICS_COUNT;
const event = <Name extends AnalyticsEventName>(
  name: Name, metadata: AnalyticsMetadata[Name], environment: AnalyticsEnvironment,
): AnalyticsEventFor<Name> => Object.freeze({ name, metadata: Object.freeze(metadata), environment, schema_version: 1 });

/** Pure final boundary; caller environment/version/context is never trusted. */
export const sanitizeAnalyticsEvent = (input: unknown, trustedEnvironment: unknown): AnalyticsEvent | undefined => {
  try {
    const environment = analyticsEnvironment(trustedEnvironment);
    const name = dataProperty(input, 'name');
    const metadata = dataProperty(input, 'metadata');
    if (!environment || !isMetadata(metadata)) return undefined;
    switch (name) {
      case 'workspace_created': {
        const creation_source = dataProperty(metadata, 'creation_source');
        return creation_source === 'registration' || creation_source === 'explicit'
          ? event(name, { creation_source }, environment) : undefined;
      }
      case 'class_created': case 'learning_evidence_created': case 'exam_created': case 'boss_started':
        return event(name, {}, environment);
      case 'student_import_completed': {
        const student_count = dataProperty(metadata, 'student_count');
        return isCount(student_count) ? event(name, { student_count }, environment) : undefined;
      }
      case 'point_action_completed': {
        const student_count = dataProperty(metadata, 'student_count');
        const action_source = dataProperty(metadata, 'action_source');
        const direction = dataProperty(metadata, 'direction');
        return isCount(student_count) && (action_source === 'quick' || action_source === 'manual' || action_source === 'airdrop') &&
          (direction === 'increase' || direction === 'decrease')
          ? event(name, { student_count, action_source, direction }, environment) : undefined;
      }
      case 'report_generated': {
        const report_type = dataProperty(metadata, 'report_type');
        const format = dataProperty(metadata, 'format');
        if (report_type === 'weekly_feedback' && format === 'csv') return event(name, { report_type, format }, environment);
        if (report_type === 'exam_summary' && format === 'print') return event(name, { report_type, format }, environment);
        return undefined;
      }
      case 'feature_opened': {
        const feature = dataProperty(metadata, 'feature');
        return typeof feature === 'string' && featureNames.has(feature)
          ? event(name, { feature: feature as ConsoleDestination }, environment) : undefined;
      }
      default: return undefined;
    }
  } catch { return undefined; }
};
