import { createTransport, type BaseTransportOptions, type Envelope, type ErrorEvent, type Transport } from '@sentry/core';
import {
  MONITORING_TIMEOUT_MS, reportsFromEnvelope, reportFromSdkEvent, scrubErrorReport,
  monitoringRelease,
  type ErrorReport, type MonitoringConfig, type MonitoringContext,
} from './policy';

/** No incoming event id, message, exception, frame, context or timestamp is retained. */
export const safeSentryEvent = (report: ErrorReport, context: MonitoringContext): ErrorEvent => {
  const safe = scrubErrorReport(report, context.source);
  if (!safe) throw new Error('Invalid monitoring category');
  const message = `Epet ${safe.category}`;
  const release = monitoringRelease(context.release);
  return {
    type: undefined,
    event_id: crypto.randomUUID().replaceAll('-', ''),
    timestamp: Date.now() / 1_000,
    platform: 'javascript', environment: context.environment,
    ...(release ? { release } : {}),
    message,
    level: safe.category.endsWith('.network') || safe.category.endsWith('.timeout') ? 'warning' : 'error',
    exception: { values: [{ type: 'EpetOperationalError', value: message }] },
    fingerprint: ['epet', context.source, safe.category, safe.route, safe.method, String(safe.status ?? 'none')],
    tags: {
      'epet.source': context.source, 'epet.category': safe.category,
      'epet.route': safe.route, 'epet.method': safe.method,
      ...(safe.status ? { 'epet.status': safe.status } : {}),
    },
  };
};

export const scrubSentryEvent = (event: unknown, context: MonitoringContext): ErrorEvent =>
  safeSentryEvent(reportFromSdkEvent(event, context.source), context);

/** The final guard runs AFTER SDK event processors and envelope construction. */
export const createPrivateSentryTransport = (
  options: BaseTransportOptions,
  config: MonitoringConfig,
  sendFetch: typeof fetch = fetch,
): Transport => {
  const transport = createTransport({ ...options, bufferSize: 16 }, async (request) => {
    try {
      const response = await sendFetch(config.endpoint, {
        method: 'POST', body: request.body, headers: { 'content-type': 'application/x-sentry-envelope' },
        credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual',
        signal: AbortSignal.timeout(MONITORING_TIMEOUT_MS),
      });
      await response.body?.cancel();
      // Workers does not implement redirect:'error'. Manual means no second
      // request is ever made to a provider-supplied redirect destination.
      if (response.status >= 300 && response.status < 400) return { statusCode: 503 };
      return {
        statusCode: response.status,
        headers: { 'x-sentry-rate-limits': response.headers.get('x-sentry-rate-limits'), 'retry-after': response.headers.get('retry-after') },
      };
    } catch { return { statusCode: 503 }; }
  });
  return {
    async send(envelope) {
      let result = {};
      for (const report of reportsFromEnvelope(envelope, config.source)) {
        const event = safeSentryEvent(report, config);
        const safeEnvelope: Envelope = [
          { event_id: event.event_id, sent_at: new Date().toISOString() },
          [[{ type: 'event' }, event]],
        ];
        result = await transport.send(safeEnvelope);
      }
      return result;
    },
    flush: (timeout) => transport.flush(timeout),
  };
};
