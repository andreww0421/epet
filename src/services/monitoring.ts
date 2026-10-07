import { init, Scope } from '@sentry/react';
import type { BaseTransportOptions, Transport, TransportMakeRequestResponse } from '@sentry/core';
import {
  MONITORING_PATH, MONITORING_TIMEOUT_MS, monitoringEnvironment, monitoringRelease,
  reportsFromEnvelope, safelyReport, scrubErrorReport,
  type ErrorReport, type MonitoringContext, type MonitoringReporter,
} from '../../shared/observability/policy';
import { safeSentryEvent, scrubSentryEvent } from '../../shared/observability/sentry';
import { PRIVATE_SENTRY_OPTIONS } from '../../shared/observability/sdkOptions';

// Routing identifier only. Its transport NEVER contacts this DSN; the real project
// destinations are isolated Worker secrets, not browser input or envelope headers.
const RELAY_ROUTING_DSN = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@o0.ingest.sentry.io/1';
let reporter: MonitoringReporter | undefined;
const reportedApiErrors = new WeakSet<object>();
export const markReportedApiError = (error: unknown) => {
  if (error !== null && (typeof error === 'object' || typeof error === 'function')) reportedApiErrors.add(error);
};
const alreadyReported = (error: unknown) =>
  error !== null && (typeof error === 'object' || typeof error === 'function') && reportedApiErrors.has(error);
export const reportFrontendError = (report: ErrorReport) => safelyReport(reporter, report);

export const createFrontendRelayTransport = (
  _options: BaseTransportOptions, sendFetch: typeof fetch = fetch,
): Transport => {
  let count = 0;
  let windowStart = Date.now();
  let pauseUntil = 0;
  const pending = new Set<Promise<TransportMakeRequestResponse>>();
  // The SDK's serialized envelope is NEVER used as a relay request body.
  return {
    async send(envelope) {
      const reports = reportsFromEnvelope(envelope, 'frontend');
      if (Date.now() - windowStart >= 60_000) { count = 0; windowStart = Date.now(); }
      let result = {};
      for (const report of reports) {
        if (++count > 20 || pending.size >= 16 || Date.now() < pauseUntil) break;
        const task = sendReport(report);
        pending.add(task);
        try { result = await task; } finally { pending.delete(task); }
      }
      return result;
    },
    async flush(timeout = MONITORING_TIMEOUT_MS) {
      let timer: ReturnType<typeof setTimeout>;
      try {
        return await Promise.race([
          Promise.all([...pending]).then(() => true),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeout); }),
        ]);
      } finally { clearTimeout(timer!); }
    },
  };

  async function sendReport(report: ErrorReport) {
    try {
      const response = await sendFetch(MONITORING_PATH, {
        method: 'POST', body: JSON.stringify(scrubErrorReport(report, 'frontend')),
        credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
        headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(MONITORING_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (response.status === 429 || response.status >= 500) pauseUntil = Date.now() + 60_000;
      return { statusCode: response.status };
    } catch { pauseUntil = Date.now() + 60_000; return { statusCode: 503 }; }
  }
};

export const initializeFrontendMonitoring = (
  input: { enabled?: string; environment?: string; release?: string },
  target: Window = window,
  sendFetch: typeof fetch = fetch,
) => {
  const environment = monitoringEnvironment(input.environment);
  if (input.enabled !== 'true' || !environment) return () => undefined;
  try {
    const context: MonitoringContext = { environment, source: 'frontend', release: monitoringRelease(input.release) };
    const client = init({
      ...PRIVATE_SENTRY_OPTIONS, dsn: RELAY_ROUTING_DSN, environment, release: context.release,
      beforeSend: (event) => scrubSentryEvent(event, context),
      transport: (options) => createFrontendRelayTransport(options, sendFetch),
    });
    if (!client) return () => undefined;
    const scope = new Scope();
    reporter = (report) => client.captureEvent(safeSentryEvent(report, context), {}, scope);
    const uncaught = (event: ErrorEvent) => {
      if (!alreadyReported(event.error)) reportFrontendError({ category: 'frontend.uncaught', route: 'unknown', method: 'unknown' });
    };
    const rejected = (event: PromiseRejectionEvent) => {
      if (!alreadyReported(event.reason)) reportFrontendError({ category: 'frontend.rejection', route: 'unknown', method: 'unknown' });
    };
    target.addEventListener('error', uncaught);
    target.addEventListener('unhandledrejection', rejected);
    return () => {
      target.removeEventListener('error', uncaught);
      target.removeEventListener('unhandledrejection', rejected);
      reporter = undefined;
      void Promise.resolve(client.close(MONITORING_TIMEOUT_MS)).catch(() => undefined);
    };
  } catch { return () => undefined; }
};
