import { expect, test, type Browser } from '@playwright/test';
import {
  E2eApiSession,
  E2E_BASE_URL,
  addIsolatedClass,
  addClassViaUi,
  addStudentViaUi,
  browserApiRequest,
  getBrowserCsrfToken,
  inviteAccount,
  loadBrowserState,
  loginViaUi,
  selectDashboardTab,
  testAccount,
} from './support/fixtures';

const newUserPage = async (browser: Browser) => {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    viewport: { width: 1440, height: 1000 },
  });
  return { context, page: await context.newPage() };
};

test.describe('Permissions', () => {
  test('viewer, teacher, admin, and owner capabilities stay separated', async ({
    browser,
  }) => {
    const ownerAccount = testAccount('permission-owner');
    const owner = await E2eApiSession.register(ownerAccount);
    const workspaceId = owner.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Owner workspace is missing');
    const snapshot = await owner.loadState(workspaceId);
    const allowedClass = snapshot.data?.classes[0];
    if (!allowedClass) throw new Error('Default class is missing');
    await addIsolatedClass(owner, workspaceId, 'E2E 管制班級');

    const teacherAccount = testAccount('permission-teacher');
    const viewerAccount = testAccount('permission-viewer');
    const adminAccount = testAccount('permission-admin');
    const teacher = await inviteAccount(
      owner,
      workspaceId,
      teacherAccount,
      'teacher',
      [allowedClass.id],
    );
    const viewer = await inviteAccount(
      owner,
      workspaceId,
      viewerAccount,
      'viewer',
      [allowedClass.id],
    );
    const admin = await inviteAccount(
      owner,
      workspaceId,
      adminAccount,
      'admin',
      [],
    );
    const teacherUserId = teacher.session.user.id;
    await Promise.all([
      teacher.dispose(),
      viewer.dispose(),
      admin.dispose(),
      owner.dispose(),
    ]);

    const viewerBrowser = await newUserPage(browser);
    await loginViaUi(viewerBrowser.page, viewerAccount);
    await expect(viewerBrowser.page.getByText('唯讀工作區')).toBeVisible();
    await expect(viewerBrowser.page.getByRole('tab', {
      name: '學生',
    })).toHaveCount(0);
    const viewerState = await loadBrowserState(
      viewerBrowser.context,
      workspaceId,
    );
    if (!viewerState.data) throw new Error('Viewer state is missing');
    const forbiddenViewerWrite = await browserApiRequest(
      viewerBrowser.context,
      '/api/v1/state',
      {
        method: 'PUT',
        workspaceId,
        body: {
          data: viewerState.data,
          baseRevision: viewerState.revision,
        },
      },
    );
    expect(forbiddenViewerWrite.status()).toBe(403);
    await viewerBrowser.context.close();

    const teacherBrowser = await newUserPage(browser);
    await loginViaUi(teacherBrowser.page, teacherAccount);
    await expect(teacherBrowser.page.locator('#classSelect option'))
      .toHaveCount(1);
    await expect(teacherBrowser.page.getByRole('tab', {
      name: '規則',
    })).toHaveCount(0);
    await addStudentViaUi(teacherBrowser.page, 'E2E 教師授權學生');
    const teacherState = await loadBrowserState(
      teacherBrowser.context,
      workspaceId,
    );
    expect(teacherState.data?.classes).toHaveLength(1);
    expect(teacherState.data?.classes[0]?.students.some(
      (student) => student.name === 'E2E 教師授權學生',
    )).toBe(true);
    await teacherBrowser.context.close();

    const adminBrowser = await newUserPage(browser);
    await loginViaUi(adminBrowser.page, adminAccount);
    await expect(adminBrowser.page.getByRole('tab', {
      name: '規則',
    })).toBeVisible();
    await expect(adminBrowser.page.getByRole('tab', {
      name: '資料治理',
    })).toBeVisible();
    await addClassViaUi(adminBrowser.page, 'E2E 管理員新增班級');
    const adminState = await loadBrowserState(adminBrowser.context, workspaceId);
    expect(adminState.data?.classes).toHaveLength(3);
    await selectDashboardTab(adminBrowser.page, '規則');
    await expect(adminBrowser.page.getByRole('heading', {
      name: '工作區權限',
    })).toBeVisible();
    await expect(adminBrowser.page.getByRole('button', {
      name: '永久刪除工作區',
    })).toHaveCount(0);
    const forbiddenTransfer = await browserApiRequest(
      adminBrowser.context,
      `/api/v1/members/${encodeURIComponent(teacherUserId)}/transfer-ownership`,
      { method: 'POST', workspaceId },
    );
    expect(forbiddenTransfer.status()).toBe(403);
    await adminBrowser.context.close();

    const ownerBrowser = await newUserPage(browser);
    await loginViaUi(ownerBrowser.page, ownerAccount);
    await selectDashboardTab(ownerBrowser.page, '規則');
    await expect(ownerBrowser.page.getByRole('button', {
      name: '永久刪除工作區',
    })).toBeVisible();
    await expect(ownerBrowser.page.getByRole('button', {
      name: '移轉所有權',
    }).first()).toBeVisible();
    const teacherMember = ownerBrowser.page.getByRole('article').filter({
      hasText: teacherAccount.email,
    });
    ownerBrowser.page.once('dialog', (dialog) => dialog.accept());
    const transferring = ownerBrowser.page.waitForResponse((response) =>
      response.url().endsWith(`/members/${teacherUserId}/transfer-ownership`) &&
      response.request().method() === 'POST',
    );
    await teacherMember.getByRole('button', { name: '移轉所有權' }).click();
    expect((await transferring).status()).toBe(200);
    await expect(ownerBrowser.page.getByRole('navigation')
      .getByText('admin', { exact: true })).toBeVisible();
    // Refreshing the session remounts the dashboard on its default tab.
    await selectDashboardTab(ownerBrowser.page, '規則');
    await expect(ownerBrowser.page.getByRole('heading', {
      name: '工作區權限',
    })).toBeVisible();
    await expect(ownerBrowser.page.getByRole('button', {
      name: '永久刪除工作區',
    })).toHaveCount(0);
    await expect(teacherMember.getByText('owner', { exact: true })).toBeVisible();
    await ownerBrowser.context.close();
  });

  test('authenticated mutations still require CSRF and an allowed Origin', async ({
    context,
    page,
  }) => {
    const account = testAccount('csrf-origin');
    const setup = await E2eApiSession.register(account);
    const workspaceId = setup.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Workspace is missing');
    await setup.dispose();
    await loginViaUi(page, account);
    const snapshot = await loadBrowserState(context, workspaceId);
    const cookie = (await context.cookies())
      .filter((entry) => entry.name.startsWith('__Host-epet_'))
      .map((entry) => `${entry.name}=${entry.value}`).join('; ');
    const headers = { cookie, origin: E2E_BASE_URL, 'x-epet-workspace': workspaceId };
    const data = { data: snapshot.data, baseRevision: snapshot.revision };
    const missingCsrf = await context.request.put(`${E2E_BASE_URL}/api/v1/state`, {
      headers, data,
    });
    expect(missingCsrf.status()).toBe(403);
    const untrustedOrigin = await context.request.put(`${E2E_BASE_URL}/api/v1/state`, {
      headers: {
        ...headers,
        origin: 'https://untrusted.example.test',
        'x-csrf-token': await getBrowserCsrfToken(context),
      },
      data,
    });
    expect(untrustedOrigin.status()).toBe(403);
    expect((await loadBrowserState(context, workspaceId)).revision).toBe(snapshot.revision);
  });
});
