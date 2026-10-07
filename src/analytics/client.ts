import {
  analyticsEnvironment, sanitizeAnalyticsEvent,
  type AnalyticsEnvironment, type AnalyticsEvent, type AnalyticsEventName, type AnalyticsMetadata,
} from './schema';

/** Only rebuilt, frozen events cross the adapter boundary. No identify/page/autocapture APIs. */
export type AnalyticsSink = (event: AnalyticsEvent) => void | Promise<void>;
export type AnalyticsConfiguration = { enabled: boolean; environment: AnalyticsEnvironment; sink: AnalyticsSink };

const browserOptOut = (): boolean => {
  try {
    const signals = globalThis.navigator as (Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string }) | undefined;
    return signals?.globalPrivacyControl === true || signals?.doNotTrack === '1' || signals?.doNotTrack === 'yes';
  } catch { return true; }
};

/** No network, browser identifiers, storage, queue, console logging or Sentry dependency. */
export const createAnalyticsClient = (privacyOptOut: () => boolean = browserOptOut) => {
  let active: AnalyticsConfiguration | undefined;
  let delivering = false;
  let pending = 0;
  return {
    configure(configuration: AnalyticsConfiguration): () => void {
      // Explicit opt-in AND a reviewed sink are required; no production fallback.
      active = undefined;
      try {
        const environment = analyticsEnvironment(configuration.environment);
        if (configuration.enabled !== true || !environment || typeof configuration.sink !== 'function' || privacyOptOut()) return () => undefined;
        const current = { enabled: true, environment, sink: configuration.sink };
        active = current;
        return () => { if (active === current) active = undefined; };
      } catch { return () => undefined; }
    },
    track<Name extends AnalyticsEventName>(name: Name, metadata: AnalyticsMetadata[Name]): void {
      try {
        const configuration = active;
        if (!configuration || delivering || pending >= 16 || privacyOptOut()) return;
        const safe = sanitizeAnalyticsEvent({ name, metadata }, configuration.environment);
        if (!safe) return;
        delivering = true;
        try {
          const result = configuration.sink(safe);
          pending += 1;
          void Promise.resolve(result).catch(() => undefined).finally(() => { pending -= 1; });
        } finally { delivering = false; }
      } catch { /* Analytics cannot change a product outcome, even on adapter failure. */ }
    },
  };
};
