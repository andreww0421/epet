import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  E2eApiSession,
  addStudentViaUi,
  loadBrowserState,
  loginViaUi,
  performSyncedAction,
  switchWorkspaceViaUi,
  testAccount,
  waitForBackendSync,
} from './support/fixtures';

test.describe('Data safety', () => {
  test('workspace round-trip preserves already synchronized students', async ({
    context,
    page,
  }) => {
    const account = testAccount('workspace-round-trip');
    const setup = await E2eApiSession.register(account);
    const firstWorkspaceId = setup.session.activeWorkspaceId;
    const created = await setup.createWorkspace('E2E 往返工作區');
    const secondWorkspaceId = created.session.activeWorkspaceId;
    if (!firstWorkspaceId || !secondWorkspaceId) throw new Error('Workspaces are missing');
    await setup.dispose();
    await loginViaUi(page, account);

    const select = page.getByRole('combobox', { name: '工作區', exact: true });
    const originalWorkspaceId = await select.inputValue();
    const targetWorkspaceId = originalWorkspaceId === firstWorkspaceId
      ? secondWorkspaceId : firstWorkspaceId;
    const studentName = 'E2E 工作區往返學生';
    await addStudentViaUi(page, studentName);
    const beforeSwitch = await loadBrowserState(context, originalWorkspaceId);
    expect(beforeSwitch.data?.classes[0]?.students.some(
      (student) => student.name === studentName,
    )).toBe(true);

    await switchWorkspaceViaUi(page, targetWorkspaceId);
    await page.getByRole('button', { name: '導師控制台', exact: true }).click();
    await addStudentViaUi(page, 'E2E 另一工作區學生');
    const targetBeforeSwitch = await loadBrowserState(context, targetWorkspaceId);

    const switchWrites: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/v1/state') && request.method() === 'PUT') {
        switchWrites.push(request.headers()['x-epet-workspace']);
      }
    });
    // Multiple round trips must only load data, never create reset drafts.
    for (let round = 0; round < 2; round += 1) {
      await switchWorkspaceViaUi(page, originalWorkspaceId);
      await switchWorkspaceViaUi(page, targetWorkspaceId);
    }
    await switchWorkspaceViaUi(page, originalWorkspaceId);
    await page.getByRole('button', { name: '導師控制台', exact: true }).click();
    await page.getByRole('tab', { name: '獎勵', exact: true }).click();
    await expect.soft(page.getByRole('row', { name: new RegExp(studentName) })).toBeVisible();
    const afterSwitch = await loadBrowserState(context, originalWorkspaceId);
    expect(afterSwitch.data?.classes[0]?.students.some(
      (student) => student.name === studentName,
    )).toBe(true);
    expect(afterSwitch).toEqual(beforeSwitch);
    expect(await loadBrowserState(context, targetWorkspaceId)).toEqual(targetBeforeSwitch);
    expect(switchWrites).toEqual([]);
    expect(await page.evaluate((workspaceIds) => workspaceIds.map((id) =>
      sessionStorage.getItem(`epet-unsynced-workspace-v1:${id}`)
    ), [originalWorkspaceId, targetWorkspaceId])).toEqual([null, null]);
  });

  test('switching waits for an in-flight save and keeps it in the original workspace', async ({
    context,
    page,
  }) => {
    const account = testAccount('switch-during-save');
    const setup = await E2eApiSession.register(account);
    const created = await setup.createWorkspace('E2E 儲存中切換');
    await setup.dispose();
    await loginViaUi(page, account);
    const select = page.getByRole('combobox', { name: '工作區', exact: true });
    const originalId = await select.inputValue();
    const targetId = created.session.workspaces.find((workspace) => workspace.id !== originalId)?.id;
    if (!targetId) throw new Error('Target workspace is missing');
    const targetBefore = await loadBrowserState(context, targetId);
    const targetReads: string[] = [];
    const writes: string[] = [];
    let releaseSave = () => {};
    let observeSave = () => {};
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const saveObserved = new Promise<void>((resolve) => { observeSave = resolve; });
    let holdSave = true;
    await page.route('**/api/v1/state', async (route) => {
      const request = route.request();
      const workspaceId = request.headers()['x-epet-workspace'];
      if (request.method() === 'GET' && workspaceId === targetId) targetReads.push(workspaceId);
      if (request.method() === 'PUT') {
        writes.push(workspaceId);
        if (holdSave) {
          holdSave = false;
          observeSave();
          await saveGate;
        }
      }
      await route.continue();
    });
    try {
      await page.getByRole('tab', { name: '學生', exact: true }).click();
      const panel = page.getByRole('heading', { name: '新增學生' }).locator('..');
      await panel.getByLabel('學生姓名').fill('E2E 儲存中學生');
      await panel.getByRole('button', { name: '新增', exact: true }).click();
      await saveObserved;
      await select.selectOption(targetId);
      await expect(select).toBeDisabled();
      await expect(select).toHaveValue(originalId);
      expect(targetReads).toEqual([]);
      const targetLoaded = page.waitForResponse((response) =>
        response.url().endsWith('/api/v1/state') &&
        response.request().method() === 'GET' &&
        response.request().headers()['x-epet-workspace'] === targetId);
      releaseSave();
      expect((await targetLoaded).status()).toBe(200);
      await waitForBackendSync(page);
      await expect(select).toHaveValue(targetId);
      await switchWorkspaceViaUi(page, originalId);
      const saved = await loadBrowserState(context, originalId);
      expect(saved.data?.classes.some((classroom) => classroom.students.some(
        (student) => student.name === 'E2E 儲存中學生',
      ))).toBe(true);
      expect(await loadBrowserState(context, targetId)).toEqual(targetBefore);
      expect(writes).toEqual([originalId]);
    } finally {
      releaseSave();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });

  test('a delayed workspace load hides old data and blocks edits and repeat switching', async ({
    context,
    page,
  }) => {
    const account = testAccount('delayed-workspace-load');
    const setup = await E2eApiSession.register(account);
    const created = await setup.createWorkspace('E2E 載入中工作區');
    await setup.dispose();
    await loginViaUi(page, account);
    await addStudentViaUi(page, 'E2E 舊工作區學生');
    const select = page.getByRole('combobox', { name: '工作區', exact: true });
    const originalId = await select.inputValue();
    const targetId = created.session.workspaces.find((workspace) => workspace.id !== originalId)?.id;
    if (!targetId) throw new Error('Target workspace is missing');
    const originalBefore = await loadBrowserState(context, originalId);
    const targetBefore = await loadBrowserState(context, targetId);
    let releaseLoad = () => {};
    let observeLoad = () => {};
    const loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; });
    const loadObserved = new Promise<void>((resolve) => { observeLoad = resolve; });
    let holdLoad = true;
    await page.route('**/api/v1/state', async (route) => {
      if (holdLoad && route.request().method() === 'GET' &&
          route.request().headers()['x-epet-workspace'] === targetId) {
        holdLoad = false;
        const response = await route.fetch();
        observeLoad();
        await loadGate;
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });
    try {
      await select.selectOption(targetId);
      await loadObserved;
      await expect(select).toHaveValue(targetId);
      await expect(select).toBeDisabled();
      await expect(page.getByRole('heading', { name: '正在安全載入工作區' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '導師控制台' })).toHaveCount(0);
      await expect(page.getByText('E2E 舊工作區學生', { exact: true })).toHaveCount(0);
      await expect(page.getByLabel('學生姓名')).toHaveCount(0);
      releaseLoad();
      await waitForBackendSync(page);
      await expect(select).toBeEnabled();
      await switchWorkspaceViaUi(page, originalId);
      expect(await loadBrowserState(context, originalId)).toEqual(originalBefore);
      expect(await loadBrowserState(context, targetId)).toEqual(targetBefore);
    } finally {
      releaseLoad();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });

  test('logout and login do not replay a session reset as an empty draft', async ({ context, page }) => {
    const account = testAccount('logout-data-safety');
    const setup = await E2eApiSession.register(account);
    const workspaceId = setup.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Workspace is missing');
    await setup.dispose();
    await loginViaUi(page, account);
    await addStudentViaUi(page, 'E2E 重新登入學生');
    const beforeLogout = await loadBrowserState(context, workspaceId);
    await page.getByRole('button', { name: '登出', exact: true }).click();
    await expect(page.getByRole('button', { name: '登入並繼續帶班' })).toBeVisible();
    expect(await page.evaluate((id) =>
      sessionStorage.getItem(`epet-unsynced-workspace-v1:${id}`), workspaceId)).toBeNull();
    await loginViaUi(page, account);
    expect(await loadBrowserState(context, workspaceId)).toEqual(beforeLogout);
  });

  test('a sync conflict preserves the unsaved draft and does not overwrite remote data', async ({
    page,
  }) => {
    const account = testAccount('sync-conflict');
    const setup = await E2eApiSession.register(account);
    const workspaceId = setup.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Workspace is missing');
    await setup.dispose();
    await loginViaUi(page, account);

    let markPutObserved: (() => void) | undefined;
    let releasePut: (() => void) | undefined;
    const putObserved = new Promise<void>((resolve) => {
      markPutObserved = resolve;
    });
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    let shouldBlock = true;
    await page.route('**/api/v1/state', async (route) => {
      if (route.request().method() === 'PUT' && shouldBlock) {
        shouldBlock = false;
        markPutObserved?.();
        await putGate;
      }
      await route.continue();
    });

    const localStudent = 'E2E 未同步衝突學生';
    await page.getByRole('tab', { name: '學生', exact: true }).click();
    const addPanel = page.getByRole('heading', {
      name: '新增學生',
    }).locator('..');
    await addPanel.getByLabel('學生姓名').fill(localStudent);
    await addPanel.getByRole('button', { name: '新增', exact: true }).click();
    await putObserved;

    const remote = await E2eApiSession.login(account);
    const remoteState = await remote.loadState(workspaceId);
    if (!remoteState.data) throw new Error('Remote state is missing');
    await remote.saveState({
      ...remoteState.data,
      settings: {
        ...remoteState.data.settings,
        maxPoints: Math.max(1, (remoteState.data.settings?.maxPoints ?? 700) - 1),
      },
    }, remoteState.revision, workspaceId);
    releasePut?.();

    await expect(page.getByText(
      '雲端已有較新的工作區版本，請重新整理後再繼續操作。',
    )).toBeVisible();
    await expect(page.getByRole('button', {
      name: '下載本機草稿',
    })).toBeVisible();
    const draftPreserved = await page.evaluate((studentName) =>
      Object.entries(sessionStorage).some(([key, value]) =>
        key.startsWith('epet-unsynced-workspace-v1:') &&
        value.includes(studentName)
      ), localStudent);
    expect(draftPreserved).toBe(true);

    const committed = await remote.loadState(workspaceId);
    expect(committed.data?.classes.some((classroom) =>
      classroom.students.some((student) => student.name === localStudent)
    )).toBe(false);
    await remote.dispose();
  });

  test('workspace switching is blocked while local changes cannot sync', async ({
    context,
    page,
  }) => {
    const account = testAccount('workspace-switch-safety');
    const setup = await E2eApiSession.register(account);
    const firstWorkspaceId = setup.session.activeWorkspaceId;
    if (!firstWorkspaceId) throw new Error('First workspace is missing');
    const secondWorkspaceName = 'E2E 切換目標工作區';
    const created = await setup.createWorkspace(secondWorkspaceName);
    const secondWorkspace = created.session.workspaces.find(
      (workspace) => workspace.name === secondWorkspaceName,
    );
    if (!secondWorkspace) throw new Error('Second workspace is missing');
    await setup.dispose();
    await loginViaUi(page, account);

    const workspaceSelect = page.getByRole('combobox', { name: '工作區', exact: true });
    const originalWorkspaceId = await workspaceSelect.inputValue();
    const targetWorkspaceId = originalWorkspaceId === secondWorkspace.id
      ? firstWorkspaceId
      : secondWorkspace.id;

    await page.route('**/api/v1/state', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.getByRole('tab', { name: '學生', exact: true }).click();
    const addPanel = page.getByRole('heading', {
      name: '新增學生',
    }).locator('..');
    await addPanel.getByLabel('學生姓名').fill('E2E 尚未同步學生');
    await addPanel.getByRole('button', { name: '新增', exact: true }).click();
    await workspaceSelect.selectOption(targetWorkspaceId);

    await expect(page.getByText(
      '目前工作區尚未同步完成，暫時無法切換。',
    )).toBeVisible();
    await expect(workspaceSelect).toHaveValue(originalWorkspaceId);
    await expect(page.getByRole('heading', {
      name: '目前無法安全開啟工作區',
    })).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '下載本機草稿' }).click();
    const download = await downloading;
    const draftPath = await download.path();
    if (!draftPath) throw new Error('Local draft download is missing');
    expect(await readFile(draftPath, 'utf8')).toContain('E2E 尚未同步學生');

    await page.unroute('**/api/v1/state');
    await performSyncedAction(page, () => page.reload());
    const recovered = await loadBrowserState(context, originalWorkspaceId);
    expect(recovered.data?.classes.some((classroom) =>
      classroom.students.some((student) => student.name === 'E2E 尚未同步學生')
    )).toBe(true);
    const otherWorkspace = await loadBrowserState(context, targetWorkspaceId);
    expect(otherWorkspace.data?.classes.some((classroom) =>
      classroom.students.some((student) => student.name === 'E2E 尚未同步學生')
    )).toBe(false);
  });
});
