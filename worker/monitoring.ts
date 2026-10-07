import { CloudflareClient, Scope } from '@sentry/cloudflare';
import {
  MONITORING_TIMEOUT_MS, resolveMonitoringConfig, scrubErrorReport,
  type MonitoringReporter, type MonitoringSource,
} from '../shared/observability/policy';
import { safeSentryEvent, scrubSentryEvent, createPrivateSentryTransport } from '../shared/observability/sentry';
import { PRIVATE_SENTRY_OPTIONS } from '../shared/observability/sdkOptions';

export type MonitoringEnv = {
  MONITORING_ENVIRONMENT?: string;
  SENTRY_DSN?: string;
  SENTRY_FRONTEND_DSN?: string;
  SENTRY_RELEASE?: string;
};
type BackgroundContext = { waitUntil(task: Promise<unknown>): void };

/** An independent client/scope per report: no isolate-global client, env or request context. */
export const createWorkerReporter = (
  env: MonitoringEnv, context: BackgroundContext, source: MonitoringSource = 'worker',
  sendFetch: typeof fetch = fetch,
): MonitoringReporter => {
  const config = resolveMonitoringConfig(
    env.MONITORING_ENVIRONMENT, source === 'worker' ? env.SENTRY_DSN : env.SENTRY_FRONTEND_DSN,
    source, env.SENTRY_RELEASE,
  );
  let count = 0;
  return (input) => {
    if (!config || ++count > 20) return;
    let client: CloudflareClient | undefined;
    try {
      const report = scrubErrorReport(input, source);
      if (!report) return;
      client = new CloudflareClient({
        ...PRIVATE_SENTRY_OPTIONS, dsn: config.dsn, environment: config.environment, release: config.release,
        cacheClient: false, enableOpenTelemetrySetup: false, stackParser: () => [],
        beforeSend: (event) => scrubSentryEvent(event, config),
        transport: (options) => createPrivateSentryTransport(options, config, sendFetch),
      });
      client.init();
      client.captureEvent(safeSentryEvent(report, config), {}, new Scope());
      const reportingClient = client;
      context.waitUntil(reportingClient.flush(MONITORING_TIMEOUT_MS)
        .catch(() => false).finally(() => reportingClient.dispose()));
    } catch {
      try { client?.dispose(); } catch { /* Fail closed, including SDK cleanup failures. */ }
    }
  };
};
