import {
  monitoringEnvironment,
  monitoringRelease,
  type MonitoringEnvironment,
} from './policy';

export type ScheduledProjectionSummary = {
  checked: number;
  verified: number;
  mismatched: number;
  missing: number;
  repaired: number;
  truncated: boolean;
};

export type ScheduledOperationsReport = {
  schemaVersion: 1;
  kind: 'scheduled-maintenance';
  environment: MonitoringEnvironment;
  release?: string;
  outcome: 'completed' | 'failed';
  scheduledMinute: number;
  completedMinute: number;
  durationBucket: 'lt-1s' | '1s-10s' | '10s-60s' | 'gte-60s';
  projection?: ScheduledProjectionSummary;
  coverage: 'complete' | 'incomplete' | 'unknown';
  health: 'ok' | 'degraded' | 'failed';
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;

const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const counter = (value: unknown): value is number =>
  timestamp(value) && value <= 1_000_000;

const projectionSummary = (input: unknown): ScheduledProjectionSummary | undefined => {
  const source = record(input);
  if (!source) return undefined;
  // Fixed-field reads and fixed-size output: an untrusted count never drives an
  // allocation, loop, object spread, or traversal of business/provider content.
  const checked = source.checked;
  const verified = source.verified;
  const mismatched = source.mismatched;
  const missing = source.missing;
  const repaired = source.repaired;
  const truncated = source.truncated;
  if (!counter(checked) || !counter(verified) || !counter(mismatched) ||
      !counter(missing) || !counter(repaired) || typeof truncated !== 'boolean' ||
      verified + mismatched + missing !== checked || repaired > checked) {
    return undefined;
  }
  return { checked, verified, mismatched, missing, repaired, truncated };
};

/**
 * Rebuild a global maintenance summary, never redact a raw result or exception.
 * This is a pure local report contract, not telemetry delivery or proof that a
 * scheduled invocation happened. There are no identifiers or cleanup counts.
 */
export const buildScheduledOperationsReport = (
  input: unknown,
): ScheduledOperationsReport | undefined => {
  try {
    const source = record(input);
    if (!source) return undefined;
    const environment = monitoringEnvironment(source.environment);
    const release = monitoringRelease(source.release);
    const scheduledTime = source.scheduledTime;
    const startedAt = source.startedAt;
    const completedAt = source.completedAt;
    const outcome = source.outcome;
    if (!environment || !timestamp(scheduledTime) || !timestamp(startedAt) ||
        !timestamp(completedAt) || scheduledTime > startedAt || startedAt > completedAt ||
        (outcome !== 'completed' && outcome !== 'failed')) {
      return undefined;
    }
    const rawProjection = source.projection;
    const projection = rawProjection === undefined
      ? undefined : projectionSummary(rawProjection);
    if ((rawProjection !== undefined && !projection) ||
        (outcome === 'completed' && !projection)) {
      return undefined;
    }
    const duration = completedAt - startedAt;
    return {
      schemaVersion: 1,
      kind: 'scheduled-maintenance',
      environment,
      ...(release ? { release } : {}),
      outcome,
      scheduledMinute: Math.floor(scheduledTime / 60_000),
      completedMinute: Math.floor(completedAt / 60_000),
      durationBucket: duration < 1_000 ? 'lt-1s'
        : duration < 10_000 ? '1s-10s'
          : duration < 60_000 ? '10s-60s' : 'gte-60s',
      ...(projection ? { projection } : {}),
      coverage: outcome === 'failed' ? 'unknown'
        : projection!.truncated ? 'incomplete' : 'complete',
      health: outcome === 'failed' ? 'failed'
        : projection!.mismatched > 0 || projection!.missing > 0 ||
            projection!.repaired > 0 || projection!.truncated ? 'degraded' : 'ok',
    };
  } catch {
    // In particular, never invoke/serialize an exception or throwing getter to
    // explain malformed operational input.
    return undefined;
  }
};
