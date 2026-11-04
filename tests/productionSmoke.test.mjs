import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import {
  entryAssets, loadProductionSmokeInputs, PRODUCTION_ORIGIN, ProductionSmokeError,
  runProductionSmoke, SMOKE_LIMITS, validateProductionConfig,
} from '../scripts/production-smoke.mjs';
import worker from '../worker/index.ts';

const config = {
  name: 'epet-api', vars: {
    PUBLIC_APP_URL: `${PRODUCTION_ORIGIN}/`, MONITORING_ENVIRONMENT: 'production',
    REGISTRATION_ENABLED: 'false', EMAIL_VERIFICATION_REQUIRED: 'true', BOT_PROTECTION_REQUIRED: 'false',
  },
};
const contents = new Map([
  ['/assets/app-abc123.js', 'console.log("synthetic build");'],
  ['/assets/app-def456.css', 'body{color:black}'],
]);
const assets = [...contents].map(([path, bytes]) => ({
  path, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex'),
}));
const html = '<!doctype html><html><div id="root"></div>' +
  '<script type="module" src="/assets/app-abc123.js"></script>' +
  '<link rel="stylesheet" href="/assets/app-def456.css"></html>';
const health = {
  ok: true, service: 'epet-api', version: 1, authenticationEnabled: true,
  registrationEnabled: false, invitationEnabled: false, emailVerificationEnabled: true,
  lifecycleNotificationsEnabled: false, botProtectionEnabled: false,
};
const headers = (kind) => ({
  'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'referrer-policy': 'no-referrer', 'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cache-control': kind === 'document' ? 'no-cache' : kind === 'asset' ? 'public, max-age=31536000, immutable' : 'no-store',
  ...(kind === 'document' ? { 'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'" } : {}),
});
const fixtureResponse = (path) => {
  if (path === '/') return new Response(html, { headers: headers('document') });
  if (contents.has(path)) return new Response(contents.get(path), {
    headers: { ...headers('asset'), 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/css' },
  });
  if (path === '/api/v1/health') return new Response(JSON.stringify(health), {
    headers: { ...headers('api'), 'content-type': 'application/json' },
  });
  assert.ok(['/api/v1/auth/session', '/api/v1/state', '/api/v1/workspaces'].includes(path));
  return new Response(null, { status: 401, headers: headers('api') });
};
const fixture = (override = () => undefined) => {
  const requests = [];
  const sleeps = [];
  let clock = 0;
  return {
    requests, sleeps,
    options: {
      config, assets, now: () => clock,
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
      fetchImpl: async (url, options) => {
        assert.equal(new URL(url).origin, PRODUCTION_ORIGIN);
        requests.push({ url, options });
        return await override(new URL(url).pathname, options, requests.length) ?? fixtureResponse(new URL(url).pathname);
      },
    },
  };
};
const rejectsCode = (operation, code) => assert.rejects(operation, (error) => {
  assert.ok(error instanceof ProductionSmokeError);
  assert.equal(error.code, code);
  return true;
});

test('production smoke checks document/build assets/health/401 with GET only and no credentials', async () => {
  const f = fixture();
  const result = await runProductionSmoke(f.options);
  assert.deepEqual(result, { ok: true, checks: ['home', 'entry-assets', 'health', 'anonymous-rejection', 'security-headers'],
    assetCount: 2, requests: 7, retries: 0 });
  assert.equal(f.sleeps.length, 0);
  for (const { options } of f.requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.body, undefined);
    const requestHeaders = new Headers(options.headers);
    assert.equal(requestHeaders.get('authorization'), null);
    assert.equal(requestHeaders.get('cookie'), null);
  }
});

test('real Worker health and anonymous middleware pass without any D1 access or mail dispatch', async (t) => {
  let forbiddenOperations = 0;
  t.mock.method(globalThis, 'fetch', async () => { forbiddenOperations += 1; throw new Error('External requests forbidden'); });
  const env = {
    ...config.vars,
    RESEND_API_KEY: 'synthetic-not-a-real-provider-key', PASSWORD_RESET_FROM: 'synthetic@example.invalid',
    DB: new Proxy({}, { get: () => { forbiddenOperations += 1; throw new Error('D1 must not be accessed'); } }),
    ASSETS: { fetch: async (request) => fixtureResponse(new URL(request.url).pathname) },
  };
  const result = await runProductionSmoke({ config, assets,
    fetchImpl: (url, options) => worker.fetch(new Request(url, options), env, {
      waitUntil: () => { forbiddenOperations += 1; throw new Error('No background effects expected'); },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(forbiddenOperations, 0);
});

test('target configuration refuses alternate/credential-bearing URLs before a request', async () => {
  for (const value of [undefined, '', `${PRODUCTION_ORIGIN}:443`, `${PRODUCTION_ORIGIN}?secret=hidden`,
    `${PRODUCTION_ORIGIN}/path/..`, 'https://user:secret@epet-api.jtwen12345us.workers.dev',
    'https://epet-staging.synthetic.workers.dev', `${PRODUCTION_ORIGIN}.attacker.invalid`]) {
    const f = fixture();
    await rejectsCode(() => runProductionSmoke({ ...f.options,
      config: { ...config, vars: { ...config.vars, PUBLIC_APP_URL: value } },
    }), 'CONFIGURATION_INVALID');
    assert.equal(f.requests.length, 0);
  }
  for (const patch of [{ name: 'epet-staging' }, { vars: { ...config.vars, REGISTRATION_ENABLED: 'true' } },
    { vars: { ...config.vars, EMAIL_VERIFICATION_REQUIRED: 'false' } }]) {
    assert.throws(() => validateProductionConfig({ ...config, ...patch }), ProductionSmokeError);
  }
});

test('HTML extraction rejects arbitrary URLs, paths, base tags and unbounded entrypoints', () => {
  assert.deepEqual(entryAssets(html), assets.map((asset) => asset.path).sort());
  for (const value of [html.replace('/assets/app-abc123.js', 'https://attacker.invalid/asset.js'),
    html.replace('/assets/app-abc123.js', '//attacker.invalid/asset.js'),
    html.replace('/assets/app-abc123.js', '/api/v1/state?secret=hidden'),
    html.replace('/assets/app-abc123.js', '/assets/../state.js'),
    html.replace('/assets/app-abc123.js', '/assets/%2e%2e/state.js'),
    html.replace('/assets/app-abc123.js', '/assets/app-abc123.js?secret=hidden'),
    `<base href="https://attacker.invalid">${html}`, '<div id="root"></div>',
    html + 'x'.repeat(SMOKE_LIMITS.documentBytes),
    html + Array.from({ length: SMOKE_LIMITS.assets }, (_, i) => `<link rel="modulepreload" href="/assets/chunk-${i}.js">`).join('')]) {
    assert.throws(() => entryAssets(value), ProductionSmokeError);
  }
});

test('manifest and asset integrity refuse stale, missing or mismatched deployment assets', async () => {
  for (const [path, response, code] of [
    ['/', () => new Response(html.replaceAll('abc123', 'old123'), { headers: headers('document') }), 'ASSET_MANIFEST_MISMATCH'],
    [assets[0].path, () => new Response(null, { status: 404 }), 'ASSET_STATUS'],
    [assets[0].path, () => new Response('x'.repeat(assets[0].bytes), { headers: { ...headers('asset'), 'content-type': 'text/javascript' } }), 'ASSET_INTEGRITY'],
    [assets[0].path, () => new Response(html, { headers: { ...headers('asset'), 'content-type': 'text/html' } }), 'CONTENT_TYPE'],
  ]) {
    const f = fixture((target) => target === path ? response() : undefined);
    await rejectsCode(() => runProductionSmoke(f.options), code);
    assert.equal(f.sleeps.length, 0);
    assert.ok(f.requests.every((request) => !request.url.includes('old123')));
  }
});

test('redirects, terminal 4xx and weakened headers fail without retries or response dumps', async () => {
  for (const response of [
    () => new Response(null, { status: 302, headers: { location: 'https://user:secret@attacker.invalid/' } }),
    ...[400, 401, 403, 404, 413, 501].map((status) => () => new Response('private student fixture', { status })),
    () => new Response(html, { headers: { ...headers('document'), 'x-content-type-options': 'unsafe' } }),
    () => new Response(html, { headers: { ...headers('document'), 'content-security-policy': "default-src *" } }),
    () => new Response(html, { headers: { ...headers('document'), 'cache-control': 'public' } }),
  ]) {
    const f = fixture((path) => path === '/' ? response() : undefined);
    await assert.rejects(() => runProductionSmoke(f.options), (error) => {
      assert.ok(error instanceof ProductionSmokeError);
      assert.doesNotMatch(JSON.stringify(error), /secret|student|attacker/);
      return true;
    });
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.sleeps, []);
  }
});

test('health rejects malformed JSON, wrong identity and unsafe auth flags without echoing payload', async () => {
  for (const value of ['not json: private', null, [], { ...health, ok: false }, { ...health, service: 'another-service' },
    { ...health, authenticationEnabled: false }, { ...health, registrationEnabled: true },
    { ...health, emailVerificationEnabled: false }, { ...health, botProtectionEnabled: true },
    { ...health, workspace: { student: 'private synthetic name' } }]) {
    const f = fixture((path) => path === '/api/v1/health' ? new Response(typeof value === 'string' ? value : JSON.stringify(value),
      { headers: { ...headers('api'), 'content-type': 'application/json' } }) : undefined);
    await rejectsCode(() => runProductionSmoke(f.options), 'HEALTH_CONTRACT');
    assert.equal(f.sleeps.length, 0);
  }
});

test('Turnstile assertion follows reviewed config without enabling it or claiming key validity', async () => {
  const f = fixture((path) => path === '/api/v1/health' ? new Response(JSON.stringify({ ...health,
    botProtectionEnabled: true, turnstileSiteKey: 'synthetic-public-key',
  }), { headers: { ...headers('api'), 'content-type': 'application/json' } }) : undefined);
  assert.equal((await runProductionSmoke({ ...f.options,
    config: { ...config, vars: { ...config.vars, BOT_PROTECTION_REQUIRED: 'true' } },
  })).ok, true);
  // Health reports verifier availability, not whether it is mandatory. Existing
  // configured keys must not cause a false failure when mandatory is still off.
  assert.equal((await runProductionSmoke(f.options)).ok, true);
});

test('anonymous responses are never read, including unexpected success with private data', async () => {
  for (const status of [200, 401, 403]) {
    let readCount = 0;
    let cancelled = 0;
    const f = fixture((path) => path === '/api/v1/auth/session' ? {
      status, headers: new Headers(headers('api')),
      body: { cancel: async () => { cancelled += 1; }, getReader: () => { readCount += 1; throw new Error('sensitive body'); } },
    } : undefined);
    if (status === 401) assert.equal((await runProductionSmoke(f.options)).ok, true);
    else await rejectsCode(() => runProductionSmoke(f.options), 'ANONYMOUS_STATUS');
    assert.equal(readCount, 0);
    assert.equal(cancelled, 1);
  }
});

test('network and recoverable HTTP failures use at most three attempts and bounded backoff', async () => {
  for (const status of ['network', 408, 500, 502, 503, 504]) {
    let attempts = 0;
    const f = fixture((path) => {
      if (path !== '/' || ++attempts > 2) return undefined;
      if (status === 'network') throw new Error('https://user:secret@private.invalid');
      return new Response(null, { status });
    });
    assert.equal((await runProductionSmoke(f.options)).ok, true);
    assert.deepEqual(f.sleeps, [1_000, 2_000]);
    assert.equal(attempts, 3);
  }
  const f = fixture(() => new Response(null, { status: 503 }));
  await rejectsCode(() => runProductionSmoke(f.options), 'RETRY_EXHAUSTED');
  assert.equal(f.requests.length, 3);
});

test('429 Retry-After is honored, including dates, and never shortened to fit the deadline', async () => {
  for (const value of ['4', new Date(4_000).toUTCString()]) {
    const f = fixture((path, _, count) => path === '/' && count === 1 ?
      new Response(null, { status: 429, headers: { 'retry-after': value } }) : undefined);
    assert.equal((await runProductionSmoke(f.options)).ok, true);
    assert.deepEqual(f.sleeps, [4_000]);
  }
  const f = fixture(() => new Response(null, { status: 429, headers: { 'retry-after': '3600' } }));
  await rejectsCode(() => runProductionSmoke(f.options), 'RETRY_AFTER_EXCEEDS_BUDGET');
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.sleeps, []);
});

test('streamed and declared response size limits fail before accumulating large payloads', async () => {
  for (const response of [
    () => new Response('small', { headers: { ...headers('document'), 'content-length': String(SMOKE_LIMITS.documentBytes + 1) } }),
    () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(SMOKE_LIMITS.documentBytes)); controller.enqueue(new Uint8Array(1)); controller.close();
    } }), { headers: headers('document') }),
  ]) {
    const f = fixture((path) => path === '/' ? response() : undefined);
    await rejectsCode(() => runProductionSmoke(f.options), 'RESPONSE_TOO_LARGE');
    assert.equal(f.requests.length, 1);
  }
});

test('compressed wire length does not reject valid small decoded assets or bypass decoded limits', async () => {
  const f = fixture((path) => contents.has(path) ? new Response(contents.get(path), { headers: {
    ...headers('asset'), 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/css',
    'content-encoding': 'gzip', 'content-length': String(Buffer.byteLength(contents.get(path)) + 20),
  } }) : undefined);
  assert.equal((await runProductionSmoke(f.options)).ok, true);
  const oversized = fixture((path) => path === assets[0].path ? new Response('x'.repeat(assets[0].bytes + 1), {
    headers: { ...headers('asset'), 'content-type': 'text/javascript', 'content-encoding': 'gzip', 'content-length': '1' },
  }) : undefined);
  await rejectsCode(() => runProductionSmoke(oversized.options), 'RESPONSE_TOO_LARGE');
});

test('native fetch decodes a local gzip mock while preserving wire headers; no production requests', async () => {
  const server = createServer(async (request, response) => {
    const fixture = fixtureResponse(request.url);
    const bytes = Buffer.from(await fixture.arrayBuffer());
    const compressed = contents.has(request.url);
    const body = compressed ? gzipSync(bytes) : bytes;
    response.writeHead(fixture.status, {
      ...Object.fromEntries(fixture.headers), 'content-length': String(body.byteLength),
      ...(compressed ? { 'content-encoding': 'gzip' } : {}),
    });
    response.end(body);
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const { port } = server.address();
    let requests = 0;
    const result = await runProductionSmoke({ config, assets, fetchImpl: async (url, options) => {
      assert.equal(new URL(url).origin, PRODUCTION_ORIGIN);
      requests += 1;
      const local = await fetch(`http://127.0.0.1:${port}${new URL(url).pathname}`, options);
      // Inject the local transport as a mock; preserve native decoded stream and
      // encoded headers while avoiding pretending localhost is a production URL.
      return new Response(local.body, local);
    } });
    assert.equal(result.ok, true);
    assert.equal(requests, 7);
    for (const bytes of contents.values()) assert.ok(gzipSync(bytes).byteLength > Buffer.byteLength(bytes));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('global budget prevents additional requests after a slow response', async () => {
  let elapsed = 0;
  const f = fixture((path) => { if (path === '/') elapsed = SMOKE_LIMITS.totalMs; });
  await rejectsCode(() => runProductionSmoke({ ...f.options, now: () => elapsed }), 'TIME_BUDGET_EXCEEDED');
  assert.equal(f.requests.length, 1);
});

test('per-request deadline also bounds a transport that stalls and ignores its abort signal', async (t) => {
  const original = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', (ms) => ms === SMOKE_LIMITS.requestMs ? AbortSignal.abort() : original(ms));
  const f = fixture(() => new Promise(() => {}));
  await rejectsCode(() => runProductionSmoke(f.options), 'NETWORK_FAILURE');
  assert.equal(f.requests.length, SMOKE_LIMITS.attempts);
  assert.deepEqual(f.sleeps, [1_000, 2_000]);
});

test('real abort events bound stalled response headers and bodies without exposing transport errors', async (t) => {
  const original = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    if (ms !== SMOKE_LIMITS.requestMs) return original(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('private transport detail')), 5);
    return controller.signal;
  });
  for (const bodyStalls of [false, true]) {
    const f = fixture((_, options) => bodyStalls
      ? new Response(new ReadableStream({ start(controller) {
        options.signal.addEventListener('abort', () => controller.error(new Error('private body detail')), { once: true });
      } }), { headers: headers('document') })
      : new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })));
    await rejectsCode(() => runProductionSmoke(f.options), 'NETWORK_FAILURE');
    assert.equal(f.requests.length, SMOKE_LIMITS.attempts);
  }
});

test('local build loader hashes only bounded built assets; CLI refuses all target overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-smoke-fixture-'));
  try {
    await mkdir(join(directory, 'dist', 'assets'), { recursive: true });
    await writeFile(join(directory, 'wrangler.jsonc'), JSON.stringify(config));
    await writeFile(join(directory, 'dist', 'index.html'), html);
    for (const [path, value] of contents) await writeFile(join(directory, 'dist', path.slice(1)), value);
    assert.deepEqual(await loadProductionSmokeInputs(directory), { config, assets });
    // Preload must install the mock before the CLI main module is imported.
    // Importing the main module from a preload would run its entrypoint early.
    const bootstrap = join(directory, 'mock-bootstrap.mjs');
    const routes = [
      ['/', html, 200, headers('document')],
      ...[...contents].map(([path, bytes]) => [path, bytes, 200,
        { ...headers('asset'), 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/css' }]),
      ['/api/v1/health', JSON.stringify(health), 200, { ...headers('api'), 'content-type': 'application/json' }],
      ...['/api/v1/auth/session', '/api/v1/state', '/api/v1/workspaces'].map((path) => [path, null, 401, headers('api')]),
    ];
    await writeFile(bootstrap, `import assert from 'node:assert/strict';
      const routes = new Map(${JSON.stringify(routes)}.map(([path, body, status, headers]) => [path, {body,status,headers}]));
      let calls=0;
      globalThis.fetch=async (url,options)=>{
        assert.equal(new URL(url).origin,${JSON.stringify(PRODUCTION_ORIGIN)});
        assert.equal(options.method,'GET'); assert.equal(options.credentials,'omit');
        const route=routes.get(new URL(url).pathname); assert.ok(route); calls++;
        return new Response(route.body,{status:route.status,headers:route.headers});
      };
      process.on('beforeExit',()=>assert.equal(calls,7));`);
    const mockedCli = spawnSync(process.execPath, ['--import', pathToFileURL(bootstrap).href,
      fileURLToPath(new URL('../scripts/production-smoke.mjs', import.meta.url))], {
      cwd: directory, encoding: 'utf8', timeout: 5_000,
    });
    assert.equal(mockedCli.status, 0, mockedCli.stderr);
    assert.equal(JSON.parse(mockedCli.stdout).ok, true);
    assert.equal(JSON.parse(mockedCli.stdout).requests, 7);
    await writeFile(join(directory, 'dist', 'assets', 'app-abc123.js'), '');
    await rejectsCode(() => loadProductionSmokeInputs(directory), 'BUILD_INVALID');
  } finally {
    // This exact fixture directory is newly allocated by this test.
    await rm(directory, { recursive: true, force: true });
  }
  const child = spawnSync(process.execPath, ['scripts/production-smoke.mjs', '--url=https://user:secret@attacker.invalid'], {
    encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.deepEqual(JSON.parse(child.stderr), { ok: false, error: 'NO_ARGUMENTS_ALLOWED', check: 'configuration' });
});
