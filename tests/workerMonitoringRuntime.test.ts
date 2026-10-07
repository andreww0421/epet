import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { before, after, test } from 'node:test';
import { Miniflare } from 'miniflare';

const execute = promisify(execFile);
const canary = 'SYNTHETIC-PRIVATE-STUDENT-EXAM-COMMENT-EVIDENCE-PASSWORD-SESSION-CSRF';
let directory: string;
let bundlePath: string;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'epet-monitoring-workerd-'));
  const assets = join(directory, 'assets');
  await mkdir(assets);
  await writeFile(join(assets, 'index.html'), '<!doctype html><html lang="zh-Hant"><title>Synthetic monitoring fixture</title></html>');
  const config = join(directory, 'wrangler.json');
  await writeFile(config, JSON.stringify({
    name: 'epet-monitoring-test', main: resolve('worker/index.ts'),
    compatibility_date: '2026-07-29',
    // This adapter uses explicit clients/scopes, not ALS or automatic instrumentation.
    assets: { directory: assets, binding: 'ASSETS' },
    d1_databases: [{ binding: 'DB', database_name: 'epet-monitoring-test', database_id: '11111111-1111-4111-8111-111111111111' }],
  }));
  const childEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(directory, 'wrangler.log') };
  for (const key of Object.keys(childEnv)) {
    if (/^(?:CF_|CLOUDFLARE_|STAGING_|SENTRY_)/.test(key)) delete childEnv[key];
  }
  await execute(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run', '--config', config, '--outdir', join(directory, 'bundle')], {
    cwd: process.cwd(), env: childEnv, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
  });
  bundlePath = join(directory, 'bundle', 'index.js');
});
after(async () => {
  if (directory) {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('actual Worker bundle starts with no Node compatibility flags and sends only sanitized events', async () => {
  const bundle = await readFile(bundlePath, 'utf8');
  assert.doesNotMatch(bundle, /^import\s.+['"]node:/m);
  const sent: Array<{ url: string; body: string; headers: Headers }> = [];
  const runtime = new Miniflare({
    modules: true, script: bundle, compatibilityDate: '2026-07-29',
    d1Databases: ['DB'],
    bindings: {
      MONITORING_ENVIRONMENT: 'staging',
      SENTRY_DSN: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@o0.ingest.sentry.io/2',
      SENTRY_FRONTEND_DSN: 'https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@o0.ingest.sentry.io/1',
    },
    outboundService: async (request) => {
      sent.push({ url: request.url, body: await request.text(), headers: request.headers });
      return new Response(null, { status: 200 });
    },
  });
  try {
    const response = await runtime.dispatchFetch('https://example.test/api/v1/monitoring', {
      method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json', cookie: canary, 'x-csrf-token': canary },
      body: JSON.stringify({ category: 'frontend.react', route: 'unknown', method: 'unknown', password: canary, student: canary, comments: canary, request: { url: canary } }),
    });
    assert.equal(response.status, 202);
    const failedLogin = await runtime.dispatchFetch('https://example.test/api/v1/auth/login', {
      method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'synthetic@example.test', password: canary }),
    });
    // The synthetic D1 intentionally has no tables; this exercises the actual API catch.
    assert.equal(failedLogin.status, 500);
    assert.deepEqual(await failedLogin.json(), { error: 'INTERNAL_ERROR' });
    for (let attempt = 0; sent.length < 2 && attempt < 100; attempt++) await new Promise<void>((resolve) => setTimeout(resolve, 10));
    assert.equal(sent.length, 2, 'Both relayed and handled Worker errors must be delivered in workerd');
    assert.deepEqual(new Set(sent.map((delivery) => new URL(delivery.url).pathname)), new Set(['/api/1/envelope/', '/api/2/envelope/']));
    for (const delivery of sent) {
      assert.ok(!delivery.body.includes(canary));
      const event = JSON.parse(delivery.body.split('\n')[2]);
      assert.equal(event.environment, 'staging');
      assert.equal(event.request, undefined);
      assert.equal(event.user, undefined);
      assert.equal(event.breadcrumbs, undefined);
      assert.equal(event.contexts, undefined);
      assert.equal(event.sdk, undefined);
      assert.equal(event.exception.values[0].stacktrace, undefined);
      for (const name of ['cookie', 'authorization', 'x-csrf-token', 'cf-connecting-ip', 'referer', 'baggage', 'sentry-trace']) assert.equal(delivery.headers.get(name), null);
    }
  } finally { await runtime.dispose(); }
});

test('actual Worker without DSNs remains healthy and makes no monitoring network calls', async () => {
  let sent = 0;
  const runtime = new Miniflare({
    modules: true, script: await readFile(bundlePath, 'utf8'), compatibilityDate: '2026-07-29', d1Databases: ['DB'],
    bindings: { MONITORING_ENVIRONMENT: 'development' },
    outboundService: async () => { sent++; return new Response(null, { status: 200 }); },
  });
  try {
    assert.equal((await runtime.dispatchFetch('https://example.test/api/v1/health')).status, 200);
    assert.equal((await runtime.dispatchFetch('https://example.test/api/v1/monitoring')).status, 404);
    assert.equal(sent, 0);
  } finally { await runtime.dispose(); }
});
