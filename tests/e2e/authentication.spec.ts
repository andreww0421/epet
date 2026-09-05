import { expect, test } from '@playwright/test';
import {
  E2eApiSession,
  browserApiRequest,
  loginViaUi,
  testAccount,
} from './support/fixtures';

test.describe('Authentication', () => {
  test('login success establishes a secure browser session', async ({
    context,
    page,
  }) => {
    const account = testAccount('login-success');
    const setup = await E2eApiSession.register(account);
    await setup.dispose();

    await loginViaUi(page, account);

    const cookies = await context.cookies();
    const sessionCookie = cookies.find(
      (cookie) => cookie.name === '__Host-epet_session',
    );
    expect(sessionCookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });
  });

  test('login failure keeps the user unauthenticated', async ({ page }) => {
    const account = testAccount('login-failure');
    const setup = await E2eApiSession.register(account);
    await setup.dispose();

    await page.goto('/#/login');
    await page.locator('#auth-email').fill(account.email);
    await page.locator('#auth-password').fill(`${account.password}-wrong`);
    await page.getByRole('button', { name: '登入並繼續帶班' }).click();

    await expect(page.getByRole('alert')).toContainText(
      '電子信箱或密碼不正確',
    );
    await expect(page.getByRole('heading', {
      name: '回來把今天的成長記下來',
    })).toBeVisible();
  });

  test('logout clears the session and returns to login', async ({
    context,
    page,
  }) => {
    const account = testAccount('logout');
    const setup = await E2eApiSession.register(account);
    await setup.dispose();
    await loginViaUi(page, account);

    await page.getByRole('button', { name: '登出' }).click();

    await expect(page.getByRole('button', {
      name: '登入並繼續帶班',
    })).toBeVisible();
    await expect.poll(async () =>
      (await context.cookies()).some(
        (cookie) => cookie.name === '__Host-epet_session',
      )
    ).toBe(false);
  });

  test('invalid session is rejected on reload', async ({
    context,
    page,
  }) => {
    const account = testAccount('expired-session');
    const setup = await E2eApiSession.register(account);
    await setup.dispose();
    await loginViaUi(page, account);

    const sessionCookie = (await context.cookies()).find(
      (cookie) => cookie.name === '__Host-epet_session',
    );
    if (!sessionCookie) throw new Error('Authenticated session is missing');
    await context.addCookies([{
      ...sessionCookie,
      value: 'invalid-session-token-that-is-not-in-repository',
    }]);
    await page.reload();

    await expect(page.getByRole('button', {
      name: '登入並繼續帶班',
    })).toBeVisible();
  });

  test('expired browser session returns to login instead of showing cached data', async ({
    context,
    page,
  }) => {
    const account = testAccount('expired-browser-session');
    const setup = await E2eApiSession.register(account);
    const workspaceId = setup.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Workspace is missing');
    await setup.dispose();
    await loginViaUi(page, account);

    const sessionCookie = (await context.cookies()).find(
      (cookie) => cookie.name === '__Host-epet_session',
    );
    if (!sessionCookie) throw new Error('Authenticated session is missing');
    await context.addCookies([{
      ...sessionCookie,
      expires: Math.floor(Date.now() / 1_000) - 60,
    }]);
    await page.reload();
    await expect(page.getByRole('button', {
      name: '登入並繼續帶班',
    })).toBeVisible();
    await expect(page.getByRole('heading', { name: '導師控制台' })).toHaveCount(0);
    const rejected = await browserApiRequest(context, '/api/v1/state', { workspaceId });
    expect(rejected.status()).toBe(401);
  });
});
