import { expect, test } from '@playwright/test';
import { validateStagingUrl } from '../../scripts/staging-target.mjs';

const stagingOrigin = validateStagingUrl(process.env.STAGING_BASE_URL);
const turnstileOrigin = 'https://challenges.cloudflare.com';

test.describe('Dedicated staging deployment smoke', () => {
  test('public health exposes working authenticated API configuration', async ({ request }) => {
    const response = await request.get('/api/v1/health', { maxRedirects: 0 });
    expect(response.status(), 'Staging health must return 200 without redirecting.').toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');

    const body: unknown = await response.json();
    const health = typeof body === 'object' && body !== null
      ? body as Record<string, unknown>
      : {};
    // Compare only booleans so a malformed response cannot print its payload.
    expect(health.ok === true, 'Health must report a working API.').toBe(true);
    expect(health.service === 'epet-api' && health.version === 1,
      'Health must identify the expected API contract.').toBe(true);
    expect(health.authenticationEnabled === true,
      'Remote staging must enforce authentication.').toBe(true);
    expect(health.botProtectionEnabled === true,
      'Staging must keep Turnstile protection enabled.').toBe(true);
    expect(health.emailVerificationEnabled === true,
      'Staging must retain email verification.').toBe(true);
    expect(health.registrationEnabled === false,
      'Staging must not enable public registration for smoke tests.').toBe(true);
    if (health.botProtectionEnabled === true) {
      expect(typeof health.turnstileSiteKey === 'string' && health.turnstileSiteKey.length > 0,
        'Enabled Turnstile must have its public site key.').toBe(true);
    }
  });

  test('anonymous callers cannot access sessions or workspace data', async ({ request }) => {
    for (const path of ['/api/v1/auth/session', '/api/v1/state', '/api/v1/workspaces']) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), `${path} must reject an anonymous caller.`).toBe(401);
      expect(response.headers()['cache-control']).toBe('no-store');
      // Do not read or attach the response body: the protection itself is tested.
    }
  });

  test('deployed application assets render the login interface securely', async ({ context, page }) => {
    // A mistaken staging redirect must never navigate this browser to production.
    // Only the dedicated staging origin and the existing Turnstile dependency may
    // load. No login attempt, registration, or data-changing API request is made.
    await context.route('**/*', async (route) => {
      const request = route.request();
      const origin = new URL(request.url()).origin;
      const isTopLevelNavigation = request.isNavigationRequest() &&
        request.frame() === page.mainFrame();
      const allowed = origin === stagingOrigin ||
        (origin === turnstileOrigin && !isTopLevelNavigation);
      const readOnlyStagingRequest = origin !== stagingOrigin ||
        ['GET', 'HEAD'].includes(request.method());
      if (!allowed || !readOnlyStagingRequest) {
        await route.abort('blockedbyclient');
        return;
      }
      // Routing alone only sees the first URL of a redirect chain. Fetch with
      // redirects disabled and reject 3xx before the browser can follow one.
      const remoteResponse = await route.fetch({ maxRedirects: 0 });
      if (remoteResponse.status() >= 300 && remoteResponse.status() < 400) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.fulfill({ response: remoteResponse });
    });

    const response = await page.goto('/#/login');
    expect(response?.status(), 'The staging application document must load.').toBe(200);
    expect(new URL(page.url()).origin === stagingOrigin,
      'Login must remain on the staging origin.').toBe(true);
    const headers = response?.headers() ?? {};
    expect(headers['cache-control']).toBe('no-cache');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain(turnstileOrigin);
    expect(headers['strict-transport-security']).toContain('max-age=');

    await expect(page.getByRole('heading', { name: '回來把今天的成長記下來' })).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.locator('#auth-password')).toBeVisible();
    await expect(page.getByRole('button', { name: '登入並繼續帶班' })).toBeVisible();
    await expect(page.getByRole('button', { name: '登出', exact: true })).toHaveCount(0);
  });
});
