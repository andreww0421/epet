import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStagingUrl } from '../../scripts/staging-target.mjs';
import { createStagingRouteHandler, turnstileOrigin } from './network-policy.mjs';

const syntheticStagingOrigin = 'https://epet-staging.school-account.workers.dev';

test('staging target accepts only the dedicated HTTPS Worker root', () => {
  const origin = 'https://epet-staging.school-account.workers.dev';
  assert.equal(validateStagingUrl(origin), origin);
  assert.equal(validateStagingUrl(`${origin}/`), origin);
});

test('staging target rejects production, arbitrary origins, and ambiguous URL metadata', () => {
  for (const invalid of [
    undefined,
    '',
    ' https://epet-staging.school-account.workers.dev',
    'https://epet-production.school-account.workers.dev',
    'https://epet-staging.school-account.workers.dev.attacker.invalid',
    'https://epet-staging.nested.school-account.workers.dev',
    'https://epet-staging.-invalid.workers.dev',
    'https://epet-staging.invalid-.workers.dev',
    'https://epet-staging.school_account.workers.dev',
    'https://localhost',
    'https://staging.example.com',
    'http://epet-staging.school-account.workers.dev',
    'https://epet-staging.school-account.workers.dev:8443',
    'https://epet-staging.school-account.workers.dev:443',
    'https://EPET-STAGING.school-account.workers.dev',
    'https://epet-staging.school-account%2Eworkers.dev',
    'https://epet-staging.school-account.workers.dev\\',
    `https://epet-staging.${'a'.repeat(64)}.workers.dev`,
    'https://user:secret@epet-staging.school-account.workers.dev',
    'https://epet-staging.school-account.workers.dev/login',
    'https://epet-staging.school-account.workers.dev?secret=hidden',
    'https://epet-staging.school-account.workers.dev#fragment',
    'https://epet-staging.school-account.workers.dev?',
    'https://epet-staging.school-account.workers.dev#',
    'https://@epet-staging.school-account.workers.dev',
    'https://epet-staging.school-account.workers.dev/path/../',
  ]) {
    assert.throws(() => validateStagingUrl(invalid), /STAGING_BASE_URL/);
  }
});

const mainFrame = {};
const childFrame = {};
const routeHandler = createStagingRouteHandler({
  stagingOrigin: syntheticStagingOrigin,
  getMainFrame: () => mainFrame,
});

// These stubs never open a browser or issue a request. Events show whether the
// handler attempted to fetch, abort, or deliver the injected response.
const routeFixture = ({
  url = `${syntheticStagingOrigin}/assets/synthetic.js`,
  method = 'GET', navigation = false, frame = childFrame, status = 200,
} = {}) => {
  const events = [];
  const response = { status: () => status };
  const route = {
    request: () => ({
      url: () => url,
      method: () => method,
      isNavigationRequest: () => navigation,
      frame: () => frame,
    }),
    fetch: async (options) => {
      events.push(['fetch', options]);
      return response;
    },
    abort: async (reason) => { events.push(['abort', reason]); },
    fulfill: async (options) => { events.push(['fulfill', options]); },
  };
  return { route, events, response };
};

test('browser policy permits only GET and HEAD on staging, including its document navigation', async () => {
  for (const method of ['GET', 'HEAD']) {
    for (const navigation of [false, true]) {
      const fixture = routeFixture({ method, navigation, frame: mainFrame });
      await routeHandler(fixture.route);
      assert.deepEqual(fixture.events, [
        ['fetch', { maxRedirects: 0 }],
        ['fulfill', { response: fixture.response }],
      ]);
    }
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const fixture = routeFixture({ method });
    await routeHandler(fixture.route);
    assert.deepEqual(fixture.events, [['abort', 'blockedbyclient']], method);
  }
});

test('browser policy blocks production and unrelated origins before any fetch', async () => {
  for (const url of [
    'https://epet-api.school-account.workers.dev/',
    'https://epet-production.school-account.workers.dev/',
    'https://epet-staging.other-account.workers.dev/',
    'https://epet-staging.school-account.workers.dev.attacker.invalid/',
    'https://arbitrary.invalid/asset.js',
    'http://epet-staging.school-account.workers.dev/',
    'data:text/html,synthetic',
  ]) {
    for (const navigation of [false, true]) {
      const fixture = routeFixture({ url, navigation, frame: mainFrame });
      await routeHandler(fixture.route);
      assert.deepEqual(fixture.events, [['abort', 'blockedbyclient']]);
    }
  }
});

test('browser policy permits Turnstile dependencies and subframes but blocks its top-level navigation', async () => {
  for (const options of [
    { method: 'GET' },
    { method: 'POST' },
    { navigation: true, frame: childFrame },
  ]) {
    const fixture = routeFixture({ url: `${turnstileOrigin}/synthetic`, ...options });
    await routeHandler(fixture.route);
    assert.deepEqual(fixture.events, [
      ['fetch', { maxRedirects: 0 }],
      ['fulfill', { response: fixture.response }],
    ]);
  }
  const topLevel = routeFixture({
    url: `${turnstileOrigin}/synthetic`, navigation: true, frame: mainFrame,
  });
  await routeHandler(topLevel.route);
  assert.deepEqual(topLevel.events, [['abort', 'blockedbyclient']]);
});

test('browser policy rejects redirects from both allowed origins without following or delivering them', async () => {
  for (const origin of [syntheticStagingOrigin, turnstileOrigin]) {
    for (const status of [300, 301, 302, 303, 304, 307, 308, 399]) {
      const fixture = routeFixture({ url: `${origin}/synthetic`, status });
      await routeHandler(fixture.route);
      assert.deepEqual(fixture.events, [
        ['fetch', { maxRedirects: 0 }],
        ['abort', 'blockedbyclient'],
      ], `${origin}: ${status}`);
    }
  }
});

test('browser policy fails closed on malformed targets and invalid staging configuration', async () => {
  for (const url of ['', '/relative', 'https://[invalid', 'invalid-sensitive-value']) {
    const fixture = routeFixture({ url });
    await routeHandler(fixture.route);
    assert.deepEqual(fixture.events, [['abort', 'blockedbyclient']]);
  }
  assert.throws(() => createStagingRouteHandler({
    stagingOrigin: 'https://epet-api.school-account.workers.dev',
    getMainFrame: () => mainFrame,
  }), /STAGING_BASE_URL/);
});

test('actual staging Playwright config excludes local fixtures, credentials, and retained browser artifacts', async () => {
  const originalBaseUrl = process.env.STAGING_BASE_URL;
  process.env.STAGING_BASE_URL = syntheticStagingOrigin;
  try {
    const { default: config } = await import('../../playwright.staging.config.ts');
    assert.equal(config.testDir, './tests/staging');
    assert.equal(config.testMatch, '**/*.spec.ts');
    for (const name of ['webServer', 'globalSetup', 'globalTeardown', 'projects']) {
      assert.equal(config[name], undefined, name);
    }
    for (const name of ['storageState', 'httpCredentials', 'extraHTTPHeaders']) {
      assert.equal(config.use[name], undefined, name);
    }
    assert.equal(config.use.baseURL, syntheticStagingOrigin);
    assert.equal(config.use.ignoreHTTPSErrors, false);
    assert.equal(config.use.serviceWorkers, 'block');
    for (const name of ['trace', 'screenshot', 'video']) {
      assert.equal(config.use[name], 'off', name);
    }
    assert.equal(config.preserveOutput, 'never');
    assert.equal(config.reporter, 'dot');
    assert.equal(config.workers, 1);
    assert.equal(config.fullyParallel, false);
  } finally {
    if (originalBaseUrl === undefined) delete process.env.STAGING_BASE_URL;
    else process.env.STAGING_BASE_URL = originalBaseUrl;
  }
});

test('invalid URL errors do not expose credentials or query values', () => {
  for (const value of [
    'https://sensitive-user:sensitive-password@epet-staging.school-account.workers.dev',
    'https://epet-staging.school-account.workers.dev?secret=sensitive-value',
    'invalid-sensitive-value',
  ]) {
    assert.throws(() => validateStagingUrl(value), (error) =>
      error instanceof Error && !error.message.includes('sensitive'));
  }
});
