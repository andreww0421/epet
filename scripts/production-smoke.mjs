import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// A URL/env/CLI override must not turn a deployment check into an arbitrary
// authenticated fetcher. A domain change requires a reviewed code/config change.
export const PRODUCTION_ORIGIN = 'https://epet-api.jtwen12345us.workers.dev';
export const SMOKE_LIMITS = Object.freeze({
  documentBytes: 256 * 1024, healthBytes: 16 * 1024,
  assetBytes: 8 * 1024 * 1024, totalAssetBytes: 32 * 1024 * 1024,
  assets: 16, requestMs: 10_000, totalMs: 90_000, attempts: 3,
});
const retryable = new Set([408, 429, 500, 502, 503, 504]);
const assetPath = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class ProductionSmokeError extends Error {
  constructor(code, check) {
    super(code);
    this.code = code;
    this.check = check;
  }
}
const fail = (code, check) => { throw new ProductionSmokeError(code, check); };
const cancelBody = (response) => { void response.body?.cancel().catch(() => {}); };

export const validateProductionConfig = (config) => {
  const vars = config?.vars;
  if (config?.name !== 'epet-api' ||
      ![PRODUCTION_ORIGIN, `${PRODUCTION_ORIGIN}/`].includes(vars?.PUBLIC_APP_URL) ||
      vars?.MONITORING_ENVIRONMENT !== 'production' ||
      vars?.REGISTRATION_ENABLED !== 'false' ||
      vars?.EMAIL_VERIFICATION_REQUIRED !== 'true' ||
      !['true', 'false'].includes(vars?.BOT_PROTECTION_REQUIRED)) {
    fail('CONFIGURATION_INVALID', 'configuration');
  }
  return { botProtectionRequired: vars.BOT_PROTECTION_REQUIRED === 'true' };
};

// Parse only the Vite entrypoint tags, never execute HTML/JS or follow URLs
// discovered in a remote document. Only locally built paths become requests.
export const entryAssets = (html) => {
  if (typeof html !== 'string' || Buffer.byteLength(html) > SMOKE_LIMITS.documentBytes ||
      !/<div\s+id=["']root["'][^>]*>/i.test(html) || /<base\b/i.test(html)) {
    fail('BUILD_INVALID', 'build');
  }
  const paths = [];
  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const attributes = Object.fromEntries([...match[2].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)]
      .map(([, name, , value]) => [name.toLowerCase(), value]));
    const script = match[1].toLowerCase() === 'script';
    const rel = attributes.rel?.toLowerCase();
    if (!script && !['stylesheet', 'modulepreload'].includes(rel)) continue;
    const path = attributes[script ? 'src' : 'href'];
    if (!assetPath.test(path ?? '') || (script && attributes.type !== 'module') ||
        (rel === 'stylesheet' && !path.endsWith('.css')) ||
        ((script || rel === 'modulepreload') && !path.endsWith('.js'))) {
      fail('BUILD_INVALID', 'build');
    }
    paths.push(path);
  }
  const unique = [...new Set(paths)].sort();
  if (!unique.some((path) => path.endsWith('.js')) ||
      !unique.some((path) => path.endsWith('.css')) || unique.length > SMOKE_LIMITS.assets) {
    fail('BUILD_INVALID', 'build');
  }
  return unique;
};

const readLocal = async (path, limit) => {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > limit) {
    fail('BUILD_INVALID', 'build');
  }
  return readFile(path);
};

export const loadProductionSmokeInputs = async (root = process.cwd()) => {
  const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
  validateProductionConfig(config);
  const document = await readLocal(join(root, 'dist', 'index.html'), SMOKE_LIMITS.documentBytes);
  const paths = entryAssets(document.toString('utf8'));
  const assets = [];
  let total = 0;
  for (const path of paths) {
    const bytes = await readLocal(join(root, 'dist', path.slice(1)), SMOKE_LIMITS.assetBytes);
    total += bytes.byteLength;
    if (total > SMOKE_LIMITS.totalAssetBytes) fail('BUILD_INVALID', 'build');
    assets.push({ path, bytes: bytes.byteLength, sha256: digest(bytes) });
  }
  return { config, assets };
};

const readBounded = async (response, limit, check) => {
  const declared = response.headers.get('content-length');
  // Fetch exposes decoded bytes but retains the encoded wire Content-Length.
  // Tiny gzip/brotli responses can be larger on the wire than the original.
  // Keep a wire cap and always enforce the stricter decoded streaming limit.
  const encoding = response.headers.get('content-encoding');
  const wireLimit = encoding && encoding.toLowerCase() !== 'identity' ? SMOKE_LIMITS.assetBytes : limit;
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > wireLimit)) {
    cancelBody(response);
    fail('RESPONSE_TOO_LARGE', check);
  }
  if (!response.body) fail('EMPTY_RESPONSE', check);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail('RESPONSE_TOO_LARGE', check);
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
};

const assertHeaders = (headers, kind, check) => {
  if (headers.get('x-content-type-options') !== 'nosniff' ||
      headers.get('cross-origin-resource-policy') !== 'same-origin' ||
      !/^max-age=31536000; includeSubDomains$/i.test(headers.get('strict-transport-security') ?? '')) {
    fail('SECURITY_HEADERS', check);
  }
  const cache = headers.get('cache-control');
  if (kind === 'asset') {
    if (cache !== 'public, max-age=31536000, immutable') fail('CACHE_POLICY', check);
    return;
  }
  if (headers.get('referrer-policy') !== 'no-referrer' ||
      headers.get('cross-origin-opener-policy') !== 'same-origin' ||
      headers.get('permissions-policy') !== 'camera=(), microphone=(), geolocation=(), payment=(), usb=()') {
    fail('SECURITY_HEADERS', check);
  }
  if (cache !== (kind === 'document' ? 'no-cache' : 'no-store')) fail('CACHE_POLICY', check);
  if (kind === 'document') {
    const directives = (headers.get('content-security-policy') ?? '').split(';').map((value) => value.trim());
    for (const required of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"]) {
      if (!directives.includes(required)) fail('SECURITY_HEADERS', check);
    }
  }
};

const retryDelay = (response, attempt, now) => {
  const value = response?.headers.get('retry-after');
  if (value && value.length <= 128) {
    if (/^\d+$/.test(value)) return Math.max(1_000 * Number(value), 1_000 * attempt);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(date - now, 1_000 * attempt);
  }
  return 1_000 * attempt;
};

/** No login, cookies, request bodies, D1 calls, response dumps or external URLs. */
export const runProductionSmoke = async ({ config, assets, fetchImpl = fetch, sleep = delay, now = Date.now }) => {
  const expected = validateProductionConfig(config);
  if (!Array.isArray(assets) || assets.length < 2 || assets.length > SMOKE_LIMITS.assets ||
      assets.some((asset) => !asset || typeof asset.path !== 'string') ||
      new Set(assets.map((asset) => asset.path)).size !== assets.length ||
      !assets.some((asset) => asset.path.endsWith('.js')) || !assets.some((asset) => asset.path.endsWith('.css')) ||
      assets.some((asset) => !assetPath.test(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > SMOKE_LIMITS.assetBytes) ||
      assets.reduce((total, asset) => total + asset.bytes, 0) > SMOKE_LIMITS.totalAssetBytes) {
    fail('BUILD_INVALID', 'build');
  }
  const started = now();
  const overall = AbortSignal.timeout(SMOKE_LIMITS.totalMs);
  const counts = { requests: 0, retries: 0 };
  const checkTime = (check) => {
    if (overall.aborted || now() - started >= SMOKE_LIMITS.totalMs) fail('TIME_BUDGET_EXCEEDED', check);
  };
  const request = async (path, check, inspect) => {
    for (let attempt = 1; attempt <= SMOKE_LIMITS.attempts; attempt += 1) {
      checkTime(check);
      const signal = AbortSignal.any([overall, AbortSignal.timeout(SMOKE_LIMITS.requestMs)]);
      let response;
      let abortListener;
      try {
        counts.requests += 1;
        // Race covers both headers and a stalled body; native fetch is aborted.
        const operation = (async () => {
          response = await fetchImpl(`${PRODUCTION_ORIGIN}${path}`, {
            method: 'GET', redirect: 'manual', credentials: 'omit', signal,
            headers: { accept: check === 'home' ? 'text/html' : check === 'asset' ? '*/*' : 'application/json',
              'cache-control': 'no-cache' },
          });
          if (response.redirected || (response.url && response.url !== `${PRODUCTION_ORIGIN}${path}`)) {
            fail('UNEXPECTED_REDIRECT', check);
          }
          if (retryable.has(response.status)) return undefined;
          return { result: await inspect(response) };
        })();
        const aborted = new Promise((_, reject) => {
          abortListener = () => reject(new Error('timeout'));
          signal.addEventListener('abort', abortListener, { once: true });
          if (signal.aborted) abortListener();
        });
        const result = await Promise.race([operation, aborted]);
        if (result) { checkTime(check); return result.result; }
      } catch (error) {
        if (error instanceof ProductionSmokeError) throw error;
        checkTime(check);
        if (attempt === SMOKE_LIMITS.attempts) fail('NETWORK_FAILURE', check);
      } finally {
        if (abortListener) signal.removeEventListener('abort', abortListener);
        if (response?.body && !response.body.locked) cancelBody(response);
      }
      if (attempt === SMOKE_LIMITS.attempts) fail('RETRY_EXHAUSTED', check);
      const wait = retryDelay(response, attempt, now());
      if (!Number.isFinite(wait) || wait + now() - started >= SMOKE_LIMITS.totalMs) {
        fail('RETRY_AFTER_EXCEEDS_BUDGET', check);
      }
      counts.retries += 1;
      await sleep(wait, undefined, { signal: overall });
    }
  };

  await request('/', 'home', async (response) => {
    if (response.status !== 200) fail('HOME_STATUS', 'home');
    assertHeaders(response.headers, 'document', 'home');
    if (!/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) fail('CONTENT_TYPE', 'home');
    const remote = entryAssets((await readBounded(response, SMOKE_LIMITS.documentBytes, 'home')).toString('utf8'));
    if (JSON.stringify(remote) !== JSON.stringify(assets.map((asset) => asset.path).sort())) fail('ASSET_MANIFEST_MISMATCH', 'home');
  });
  for (const asset of assets) {
    await request(asset.path, 'asset', async (response) => {
      if (response.status !== 200) fail('ASSET_STATUS', 'asset');
      assertHeaders(response.headers, 'asset', 'asset');
      const type = response.headers.get('content-type') ?? '';
      if (!(asset.path.endsWith('.css') ? /^text\/css(?:;|$)/i : /^(?:text|application)\/javascript(?:;|$)/i).test(type)) fail('CONTENT_TYPE', 'asset');
      const bytes = await readBounded(response, asset.bytes, 'asset');
      if (bytes.byteLength !== asset.bytes || digest(bytes) !== asset.sha256) fail('ASSET_INTEGRITY', 'asset');
    });
  }
  await request('/api/v1/health', 'health', async (response) => {
    if (response.status !== 200) fail('HEALTH_STATUS', 'health');
    assertHeaders(response.headers, 'api', 'health');
    if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) fail('CONTENT_TYPE', 'health');
    let body;
    try { body = JSON.parse((await readBounded(response, SMOKE_LIMITS.healthBytes, 'health')).toString('utf8')); }
    catch (error) { if (error instanceof ProductionSmokeError) throw error; fail('HEALTH_CONTRACT', 'health'); }
    const allowed = ['ok', 'service', 'version', 'authenticationEnabled', 'registrationEnabled', 'invitationEnabled',
      'emailVerificationEnabled', 'lifecycleNotificationsEnabled', 'botProtectionEnabled', 'turnstileSiteKey'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key)) ||
        body.ok !== true || body.service !== 'epet-api' || body.version !== 1 || body.authenticationEnabled !== true ||
        body.registrationEnabled !== false || body.emailVerificationEnabled !== true ||
        typeof body.invitationEnabled !== 'boolean' || typeof body.lifecycleNotificationsEnabled !== 'boolean' ||
        typeof body.botProtectionEnabled !== 'boolean' ||
        (expected.botProtectionRequired && !body.botProtectionEnabled) ||
        (body.botProtectionEnabled && (typeof body.turnstileSiteKey !== 'string' || !body.turnstileSiteKey || body.turnstileSiteKey.length > 256))) {
      fail('HEALTH_CONTRACT', 'health');
    }
  });
  for (const path of ['/api/v1/auth/session', '/api/v1/state', '/api/v1/workspaces']) {
    await request(path, 'anonymous', async (response) => {
      // Never consume these bodies, even on an unexpected 200 with private data.
      if (response.status !== 401) fail('ANONYMOUS_STATUS', 'anonymous');
      assertHeaders(response.headers, 'api', 'anonymous');
    });
  }
  return { ok: true, checks: ['home', 'entry-assets', 'health', 'anonymous-rejection', 'security-headers'], assetCount: assets.length, ...counts };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) fail('NO_ARGUMENTS_ALLOWED', 'configuration');
    console.log(JSON.stringify(await runProductionSmoke(await loadProductionSmokeInputs())));
  } catch (error) {
    console.error(JSON.stringify(error instanceof ProductionSmokeError
      ? { ok: false, error: error.code, check: error.check }
      : { ok: false, error: 'SMOKE_FAILED', check: 'setup-or-network' }));
    process.exitCode = 1;
  }
}
