import { expect, test } from '@playwright/test';
import {
  E2eApiSession,
  addIsolatedClass,
  browserApiRequest,
  inviteAccount,
  loginViaUi,
  loadBrowserState,
  switchWorkspaceViaUi,
  testAccount,
  waitForBackendSync,
} from './support/fixtures';

test.describe('Workspace', () => {
  test('a user with no workspace can create one and switch workspaces', async ({
    page,
  }) => {
    const ownerAccount = testAccount('workspace-bootstrap-owner');
    const owner = await E2eApiSession.register(ownerAccount);
    const ownerWorkspaceId = owner.session.activeWorkspaceId;
    if (!ownerWorkspaceId) throw new Error('Owner workspace is missing');
    const ownerState = await owner.loadState(ownerWorkspaceId);
    const classId = ownerState.data?.classes[0]?.id;
    if (!classId) throw new Error('Default class is missing');

    const account = testAccount('workspace-create');
    const invited = await inviteAccount(
      owner,
      ownerWorkspaceId,
      account,
      'viewer',
      [classId],
    );
    await owner.removeMember(
      ownerWorkspaceId,
      invited.session.user.id,
    );
    await invited.dispose();
    await owner.dispose();

    await page.goto('/#/login');
    await page.locator('#auth-email').fill(account.email);
    await page.locator('#auth-password').fill(account.password);
    await page.getByRole('button', { name: '登入並繼續帶班' }).click();
    await expect(page.getByRole('heading', {
      name: '建立新工作區',
    })).toBeVisible();

    const firstWorkspaceName = 'E2E 第一工作區';
    await page.getByLabel('工作區名稱').fill(firstWorkspaceName);
    await page.getByRole('button', { name: '建立工作區' }).click();
    await page.getByRole('button', { name: '導師控制台', exact: true }).click();
    await expect(page.getByRole('heading', { name: '導師控制台' }))
      .toBeVisible();
    await waitForBackendSync(page);

    const api = await E2eApiSession.login(account);
    const firstWorkspace = api.session.workspaces.find(
      (workspace) => workspace.name === firstWorkspaceName,
    );
    expect(firstWorkspace).toBeTruthy();
    const secondWorkspaceName = 'E2E 第二工作區';
    const created = await api.createWorkspace(secondWorkspaceName);
    const secondWorkspace = created.session.workspaces.find(
      (workspace) => workspace.name === secondWorkspaceName,
    );
    expect(secondWorkspace).toBeTruthy();
    await api.dispose();

    await page.reload();
    await page.getByRole('button', { name: '導師控制台', exact: true }).click();
    await expect(page.getByRole('heading', { name: '導師控制台' }))
      .toBeVisible();
    const workspaceSelect = page.getByRole('combobox', { name: '工作區', exact: true });
    await expect(workspaceSelect.locator('option')).toHaveCount(2);
    if (!firstWorkspace || !secondWorkspace) throw new Error('Workspaces are missing');
    await switchWorkspaceViaUi(page, secondWorkspace.id);
    await expect(workspaceSelect.locator('option:checked'))
      .toHaveText(secondWorkspaceName);
    await switchWorkspaceViaUi(page, firstWorkspace.id);
    await expect(workspaceSelect.locator('option:checked'))
      .toHaveText(firstWorkspaceName);
  });

  test('class-scoped teacher cannot open an unassigned class', async ({
    context,
    page,
  }) => {
    const owner = await E2eApiSession.register(
      testAccount('workspace-restriction-owner'),
    );
    const workspaceId = owner.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Owner workspace is missing');
    const state = await owner.loadState(workspaceId);
    const allowedClass = state.data?.classes[0];
    if (!allowedClass) throw new Error('Default class is missing');
    const restrictedClass = await addIsolatedClass(
      owner,
      workspaceId,
      'E2E 未授權班級',
    );
    const otherWorkspace = await owner.createWorkspace('E2E 未授權工作區');
    const otherWorkspaceId = otherWorkspace.session.activeWorkspaceId;
    if (!otherWorkspaceId) throw new Error('Other workspace is missing');
    const teacherAccount = testAccount('workspace-restricted-teacher');
    const teacher = await inviteAccount(
      owner,
      workspaceId,
      teacherAccount,
      'teacher',
      [allowedClass.id],
    );
    await teacher.dispose();
    await owner.dispose();

    await loginViaUi(page, teacherAccount);
    const classSelect = page.locator('#classSelect');
    await expect(classSelect.locator('option')).toHaveCount(1);
    await expect(classSelect.locator('option')).toHaveText(allowedClass.name);
    await expect(page.getByText('E2E 未授權班級')).toHaveCount(0);

    const forbidden = await browserApiRequest(
      context,
      `/api/v1/classes/${encodeURIComponent(restrictedClass.id)}/analytics`,
      { workspaceId },
    );
    expect(forbidden.status()).toBe(403);
    const forbiddenWorkspace = await browserApiRequest(
      context, '/api/v1/state', { workspaceId: otherWorkspaceId },
    );
    expect(forbiddenWorkspace.status()).toBe(403);

    const teacherState = await loadBrowserState(context, workspaceId);
    if (!teacherState.data) throw new Error('Scoped state is missing');
    const forgedWrite = await browserApiRequest(context, '/api/v1/state', {
      method: 'PUT',
      workspaceId,
      body: {
        baseRevision: teacherState.revision,
        data: {
          ...teacherState.data,
          classes: [...teacherState.data.classes, restrictedClass],
        },
      },
    });
    expect(forgedWrite.status()).toBe(403);
  });
});
