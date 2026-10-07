import assert from 'node:assert/strict';
import test from 'node:test';
import type { Envelope } from '@sentry/core';
import {
  ERROR_CATEGORIES, MONITORING_PATH, monitoringEnvironment, monitoringRelease,
  monitoringRouteGroup, reportsFromEnvelope, resolveMonitoringConfig, safelyReport, scrubErrorReport,
} from '../shared/observability/policy';
import { createPrivateSentryTransport, safeSentryEvent, scrubSentryEvent } from '../shared/observability/sentry';
import { createFrontendRelayTransport } from '../src/services/monitoring';
import { createWorkerReporter } from '../worker/monitoring';
import { consumeMonitoringQuota, handleMonitoringRelay } from '../worker/monitoringRelay';

const dsn = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@o0.ingest.sentry.io/1';
const release = '0123456789abcdef0123456789abcdef01234567';
const context = { source: 'frontend' as const, environment: 'staging' as const, release };
const report = { category: 'frontend.api.http' as const, route: 'student' as const, method: 'GET' as const, status: 503 };
const canaries = ['SYNTHETIC-STUDENT-NAME', 'SYNTHETIC-TEACHER-COMMENT', 'SYNTHETIC-EVIDENCE-CONTENT', 'SYNTHETIC-PASSWORD', 'SYNTHETIC-SESSION-TOKEN', 'SYNTHETIC-CSRF-TOKEN', 'SYNTHETIC-EXAM-SCORE-97.25', 'SYNTHETIC-INVITATION-TOKEN'];
const sensitive = canaries.join(' ');
const unsafeEvent = {
  ...safeSentryEvent(report, context),
  event_id: sensitive, timestamp: sensitive, environment: sensitive, release: sensitive,
  message: sensitive, logentry: { message: sensitive, params: [sensitive] },
  exception: { values: [{ type: sensitive, value: sensitive, stacktrace: { frames: [{ filename: sensitive, function: sensitive, vars: { password: sensitive }, context_line: sensitive }] } }] },
  request: { url: `https://example.test/classes/${sensitive}?password=${sensitive}#${sensitive}`, headers: { cookie: sensitive, authorization: sensitive, 'x-csrf-token': sensitive }, data: sensitive },
  user: { id: sensitive, email: sensitive, username: sensitive, ip_address: sensitive },
  contexts: { state: { students: sensitive } }, extra: { current: { data: { students: sensitive, exams: sensitive } } },
  breadcrumbs: [{ category: 'ui.click', message: sensitive, data: { text: sensitive } }],
  transaction: sensitive, spans: [{ description: sensitive }], fingerprint: [sensitive],
  sdk: { name: sensitive, version: sensitive }, debug_meta: { images: [sensitive] },
  tags: { ...safeSentryEvent(report, context).tags, student: sensitive },
};
const unsafeEnvelope = [
  { event_id: sensitive, dsn: sensitive, trace: { transaction: sensitive }, sdk: { name: sensitive } },
  [[{ type: 'event', filename: sensitive }, unsafeEvent], ...['attachment', 'transaction', 'session', 'sessions', 'log', 'trace_metric', 'replay_event', 'replay_recording', 'feedback', 'profile', 'client_report', 'span', 'raw_security'].map((type) => [{ type, filename: sensitive }, sensitive])],
] as unknown as Envelope;
const assertPrivate = (value: unknown) => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const canary of canaries) assert.ok(!serialized.includes(canary), 'Sensitive synthetic canary crossed the monitoring boundary');
};
const transportOptions = { url: 'https://ignored.example.test/?secret=never-used', headers: { cookie: sensitive }, recordDroppedEvent: () => undefined };

test('scrubbing rebuilds a strict report/event instead of redacting nested data', () => {
  assert.deepEqual(scrubErrorReport({ ...report, password: sensitive, current: unsafeEvent }, 'frontend'), report);
  assertPrivate(scrubSentryEvent(unsafeEvent, context));
  const clean = scrubSentryEvent(unsafeEvent, context);
  assert.equal(clean.environment, 'staging');
  assert.equal(clean.release, release);
  assert.equal(clean.tags?.['epet.status'], 503);
  assert.deepEqual(Object.keys(clean).sort(), ['type', 'event_id', 'timestamp', 'platform', 'environment', 'release', 'message', 'level', 'exception', 'fingerprint', 'tags'].sort());
  assert.equal(clean.exception?.values?.[0]?.stacktrace, undefined);
  assert.notEqual(clean.event_id, unsafeEvent.event_id);
  assert.equal(safeSentryEvent(report, { ...context, release: sensitive }).release, undefined);
});

test('all categories survive safely; invalid fields, cross-tier categories and throwing getters fail closed', () => {
  for (const category of ERROR_CATEGORIES) {
    const source = category.startsWith('frontend.') ? 'frontend' : 'worker';
    const clean = scrubErrorReport({ category, route: sensitive, method: sensitive, status: 97.25 }, source);
    assert.deepEqual(clean, { category, route: 'unknown', method: 'unknown' });
    assertPrivate(clean);
  }
  assert.equal(scrubErrorReport(report, 'worker'), undefined);
  assert.equal(scrubErrorReport({ category: sensitive }, 'frontend'), undefined);
  assert.equal(scrubErrorReport({ get category() { throw new Error(sensitive); } }, 'frontend'), undefined);
  assert.equal(scrubSentryEvent({ tags: { 'epet.category': sensitive } }, context).tags?.['epet.category'], 'frontend.uncaught');
  assert.doesNotThrow(() => safelyReport(() => { throw new Error(sensitive); }, report));
});

test('environment and Sentry destinations are explicit, validated and never fall back to production', () => {
  for (const environment of ['development', 'staging', 'production']) {
    assert.equal(resolveMonitoringConfig(environment, dsn, 'worker', release)?.environment, environment);
  }
  for (const environment of [undefined, '', 'preview', sensitive]) assert.equal(resolveMonitoringConfig(environment, dsn, 'worker'), undefined);
  for (const invalid of ['', undefined, 'http://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@o0.ingest.sentry.io/1', dsn + '?password=secret', dsn + '#secret', dsn.replace('o0.ingest.sentry.io', 'o0.ingest.sentry.io.attacker.test'), dsn.replace('@', ':password@'), dsn.replace('/1', '/1/other')]) {
    assert.equal(resolveMonitoringConfig('production', invalid, 'worker'), undefined);
  }
  assert.equal(monitoringEnvironment('local'), undefined);
  assert.equal(monitoringRelease(sensitive), undefined);
});

test('dynamic identifiers, one-time token queries and fragments reduce to constant route groups', () => {
  assert.equal(monitoringRouteGroup(`/api/v1/classes/${sensitive}/students/${sensitive}/analytics?token=${sensitive}#${sensitive}`), 'analytics');
  assert.equal(monitoringRouteGroup(`/api/v1/invitations/${sensitive}`), 'administration');
  assert.equal(monitoringRouteGroup(`/api/v1/auth/login?password=${sensitive}`), 'auth');
  assert.equal(monitoringRouteGroup(`/api/v1/unknown/${sensitive}`), 'unknown');
});

test('envelope allowlist drops every non-error item and all envelope header metadata', () => {
  assert.deepEqual(reportsFromEnvelope(unsafeEnvelope, 'frontend'), [report]);
  assert.deepEqual(reportsFromEnvelope([{}, [[{ type: 'event' }, sensitive]]], 'frontend'), []);
  assert.deepEqual(reportsFromEnvelope([{}, [[{ type: 'attachment' }, unsafeEvent]]], 'frontend'), []);
});

test('final Worker Sentry transport reconstructs the actual wire payload and omits credentials/redirects', async () => {
  const config = resolveMonitoringConfig('staging', dsn, 'frontend', release)!;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport = createPrivateSentryTransport(transportOptions, config, async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response(null, { status: 200 });
  });
  await transport.send(unsafeEnvelope);
  await transport.flush(1_500);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, config.endpoint);
  assertPrivate(calls[0].init.body);
  assert.deepEqual(calls[0].init.headers, { 'content-type': 'application/x-sentry-envelope' });
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].init.redirect, 'manual');
  const lines = String(calls[0].init.body).split('\n');
  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ['event_id', 'sent_at']);
  assert.equal(JSON.parse(lines[2]).environment, 'staging');
  await transport.send([{}, [[{ type: 'session' }, {}]]] as unknown as Envelope);
  assert.equal(calls.length, 1);
});

test('frontend transport sends only categorical JSON to same origin and limits noise', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport = createFrontendRelayTransport(transportOptions, async (url, init) => {
    calls.push({ url: String(url), init: init! }); return new Response(null, { status: 202 });
  });
  for (let i = 0; i < 25; i++) await transport.send(unsafeEnvelope);
  assert.equal(calls.length, 20);
  assert.equal(await transport.flush(), true);
  for (const call of calls) {
    assert.equal(call.url, MONITORING_PATH);
    assert.deepEqual(JSON.parse(String(call.init.body)), report);
    assertPrivate(call.init);
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.referrerPolicy, 'no-referrer');
  }
});

test('provider redirects are rejected without a second outbound request', async () => {
  const config = resolveMonitoringConfig('staging', dsn, 'frontend')!;
  const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
  const transport = createPrivateSentryTransport(transportOptions, config, async (url, init) => {
    calls.push({ url: String(url), redirect: init?.redirect });
    return new Response(null, { status: 302, headers: { location: 'https://untrusted.example.test/' } });
  });
  assert.equal((await transport.send(unsafeEnvelope)).statusCode, 503);
  assert.equal(await transport.flush(1_500), true);
  assert.deepEqual(calls, [{ url: config.endpoint, redirect: 'manual' }]);
});

test('reporting transport failure is non-throwing and backs off without recursive reporting', async () => {
  let calls = 0;
  const transport = createFrontendRelayTransport(transportOptions, async () => { calls++; throw new Error(sensitive); });
  assert.equal((await transport.send(unsafeEnvelope)).statusCode, 503);
  await transport.send(unsafeEnvelope);
  assert.equal(calls, 1);
  const config = resolveMonitoringConfig('staging', dsn, 'frontend')!;
  await createPrivateSentryTransport(transportOptions, config, async () => { throw new Error(sensitive); }).send(unsafeEnvelope);
});

test('Cloudflare SDK uses independent per-report clients and preserves environment/project separation', async () => {
  const pending: Promise<unknown>[] = [];
  const calls: Array<{ url: string; body: string }> = [];
  const send: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body) }); return new Response(null, { status: 200 });
  };
  const workerDsn = dsn.replace('/1', '/2');
  const stage = createWorkerReporter({ MONITORING_ENVIRONMENT: 'staging', SENTRY_FRONTEND_DSN: dsn, SENTRY_RELEASE: release }, { waitUntil: (task) => { pending.push(task); } }, 'frontend', send);
  const prod = createWorkerReporter({ MONITORING_ENVIRONMENT: 'production', SENTRY_DSN: workerDsn }, { waitUntil: (task) => { pending.push(task); } }, 'worker', send);
  stage({ ...report, secret: sensitive } as typeof report);
  prod({ category: 'worker.unhandled', route: 'unknown', method: 'GET' });
  await Promise.all(pending);
  assert.equal(calls.length, 2);
  const events = calls.map((call) => JSON.parse(call.body.split('\n')[2]));
  assert.deepEqual(new Set(events.map((event) => event.environment)), new Set(['staging', 'production']));
  assert.ok(calls.find((call) => call.url.includes('/api/1/')));
  assert.ok(calls.find((call) => call.url.includes('/api/2/')));
  assertPrivate(calls);
  const disabled = createWorkerReporter({ MONITORING_ENVIRONMENT: 'production' }, { waitUntil: (task) => { pending.push(task); } }, 'worker', send);
  disabled({ category: 'worker.unhandled', route: 'unknown', method: 'GET' });
  assert.equal(calls.length, 2);
});

const relayRequest = (body: unknown = report, headers: Record<string, string> = {}) => new Request(`https://example.test${MONITORING_PATH}`, {
  method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json', cookie: sensitive, ...headers }, body: JSON.stringify(body),
});

test('relay accepts pre-auth failures but never forwards cookies, tokens, user fields or original payload', async () => {
  const received: unknown[] = [];
  const response = await handleMonitoringRelay(relayRequest({ ...report, password: sensitive, current: { data: sensitive } }), true, (value) => received.push(value), async () => true);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(received, [report]);
  assertPrivate(received);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('relay rejects disabled, wrong-origin, cross-site, non-JSON, oversized, malformed, unknown and rate-limited input', async () => {
  const received: unknown[] = [];
  const send = (value: unknown) => received.push(value);
  const allowed = async () => true;
  assert.equal((await handleMonitoringRelay(relayRequest(), false, send, allowed)).status, 404);
  assert.equal((await handleMonitoringRelay(new Request(`https://example.test${MONITORING_PATH}`), true, send, allowed)).status, 405);
  assert.equal((await handleMonitoringRelay(relayRequest(report, { origin: 'https://attacker.test' }), true, send, allowed)).status, 403);
  assert.equal((await handleMonitoringRelay(relayRequest(report, { origin: '' }), true, send, allowed)).status, 403);
  assert.equal((await handleMonitoringRelay(relayRequest(report, { 'sec-fetch-site': 'cross-site' }), true, send, allowed)).status, 403);
  assert.equal((await handleMonitoringRelay(relayRequest(report, { 'content-type': 'text/plain' }), true, send, allowed)).status, 400);
  assert.equal((await handleMonitoringRelay(relayRequest(report, { 'content-length': '2049' }), true, send, allowed)).status, 413);
  assert.equal((await handleMonitoringRelay(relayRequest({ ...report, secret: 'x'.repeat(3_000) }), true, send, allowed)).status, 413);
  assert.equal((await handleMonitoringRelay(relayRequest({ category: sensitive }), true, send, allowed)).status, 400);
  assert.equal((await handleMonitoringRelay(relayRequest({ category: 'worker.unhandled' }), true, send, allowed)).status, 400);
  assert.equal((await handleMonitoringRelay(relayRequest(), true, send, async () => false)).status, 429);
  const malformed = new Request(`https://example.test${MONITORING_PATH}`, { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: '{' });
  assert.equal((await handleMonitoringRelay(malformed, true, send, allowed)).status, 400);
  assert.equal(received.length, 0);
});

test('relay bounded reader times out stalled streams without affecting product APIs', async () => {
  let cancelled = false;
  const request = new Request(`https://example.test${MONITORING_PATH}`, {
    method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
    body: new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }),
    ...{ duplex: 'half' },
  } as RequestInit);
  const response = await handleMonitoringRelay(request, true, () => assert.fail('Timed-out body must not be sent'), async () => true);
  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
});

test('relay per-client quota is bounded and does not let one client consume another quota', async () => {
  for (let i = 0; i < 20; i++) assert.equal(await consumeMonitoringQuota('192.0.2.1'), true);
  assert.equal(await consumeMonitoringQuota('192.0.2.1'), false);
  assert.equal(await consumeMonitoringQuota('192.0.2.2'), true);
});
