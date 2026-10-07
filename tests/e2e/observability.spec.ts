import { expect, test, type Page } from '@playwright/test';
import { E2eApiSession, testAccount } from './support/fixtures';

const canaries = ['SYNTHETIC-STUDENT-NAME', 'SYNTHETIC-EXAM-SCORE-98.25', 'SYNTHETIC-TEACHER-COMMENT', 'SYNTHETIC-LEARNING-EVIDENCE', 'SYNTHETIC-PASSWORD', 'SYNTHETIC-SESSION-TOKEN', 'SYNTHETIC-CSRF-TOKEN'];
const sensitive = canaries.join(' ');
const interceptMonitoring = async (page: Page) => {
  const received: Array<{ category: string; route: string; method: string; status?: number }> = [];
  await page.route('**/api/v1/monitoring', async (route) => {
    const request = route.request();
    const headers = await request.allHeaders();
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers['x-csrf-token']).toBeUndefined();
    expect(headers.referer).toBeUndefined();
    const body = request.postData() ?? '';
    for (const canary of canaries) expect(body).not.toContain(canary);
    expect(body).not.toContain('sentry.io');
    const report = JSON.parse(body) as typeof received[number];
    expect(Object.keys(report).sort()).toEqual((report.status ? ['category', 'route', 'method', 'status'] : ['category', 'route', 'method']).sort());
    received.push(report);
    await route.fulfill({ status: 202, body: '' });
  });
  return received;
};

test('uncaught/rejected errors never send input, token-bearing URL, request context or browser credentials', async ({ page }) => {
  const received = await interceptMonitoring(page);
  await page.goto(`/?synthetic=${encodeURIComponent(sensitive)}#/login`);
  await expect(page.locator('#auth-email')).toBeVisible();
  await page.locator('#auth-email').fill('synthetic-monitoring@example.test');
  await page.locator('#auth-password').fill(sensitive);
  await page.evaluate((privateText) => {
    window.dispatchEvent(new ErrorEvent('error', { error: new Error(privateText), message: privateText, filename: location.href }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(), reason: { password: privateText, student: privateText, comment: privateText, current: { evidence: privateText } },
    }));
  }, sensitive);
  await expect.poll(() => received.length).toBe(2);
  expect(received).toEqual([
    { category: 'frontend.uncaught', route: 'unknown', method: 'unknown' },
    { category: 'frontend.rejection', route: 'unknown', method: 'unknown' },
  ]);
  await expect(page.getByRole('button', { name: '登入並繼續帶班' })).toBeVisible();
});

test('API 5xx failure reports safe metadata while expected auth failures retain existing UX', async ({ page }) => {
  const received = await interceptMonitoring(page);
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: sensitive }) }));
  await page.goto('/#/login');
  await page.locator('#auth-email').fill('synthetic-monitoring@example.test');
  await page.locator('#auth-password').fill(sensitive);
  await page.getByRole('button', { name: '登入並繼續帶班' }).click();
  await expect.poll(() => received.length).toBe(1);
  expect(received[0]).toEqual({ category: 'frontend.api.http', route: 'auth', method: 'POST', status: 503 });
  await expect(page.getByRole('button', { name: '登入並繼續帶班' })).toBeVisible();
  await page.unroute('**/api/v1/auth/login');
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"INVALID_CREDENTIALS"}' }));
  await page.getByRole('button', { name: '登入並繼續帶班' }).click();
  await expect(page.getByRole('alert')).toContainText('電子信箱或密碼不正確');
  expect(received).toHaveLength(1);
});

test('React lazy/render failure shows only the fixed projection-safe fallback and reports once', async ({ page }) => {
  const received = await interceptMonitoring(page);
  const account = testAccount('monitoring-render');
  const session = await E2eApiSession.register(account);
  await session.dispose();
  // Fault injection stays in Playwright: no production test switch or debug endpoint.
  await page.route(/\/assets\/DashboardView-[^/]+\.js$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nthrow new Error(${JSON.stringify(sensitive)});` });
  });
  await page.goto('/#/login');
  await page.locator('#auth-email').fill(account.email);
  await page.locator('#auth-password').fill(account.password);
  await page.getByRole('button', { name: '登入並繼續帶班' }).click();
  await expect(page.getByRole('heading', { name: '頁面暫時無法顯示' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新載入' })).toBeVisible();
  for (const canary of canaries) await expect(page.locator('body')).not.toContainText(canary);
  await expect.poll(() => received.length).toBe(1);
  expect(received[0]).toEqual({ category: 'frontend.react', route: 'unknown', method: 'unknown' });
});
