import { expect, test, type Browser, type Page, type Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AppData } from '../../src/store/types';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import {
  E2E_BASE_URL,
  E2eApiSession,
  addStudentViaUi,
  inviteAccount,
  loadBrowserState,
  loginViaUi,
  openConsoleWithApiSession,
  selectDashboardTab,
  selectTeacherDestination,
  switchWorkspaceViaUi,
  testAccount,
  waitForBackendSync,
} from './support/fixtures';

type ObservedWindow = Window & {
  __epetTestStore: { getData: () => AppData; changes: AppData[] };
  __epetConflictDomLeaks?: string[];
  __epetRestoreDraftRemoval?: () => void;
};

let owner: E2eApiSession;
test.beforeAll(async () => {
  owner = await E2eApiSession.register(testAccount('conflict-recovery-owner'));
});
test.afterAll(async () => { await owner.dispose(); });

const fixture = async (label: string, withPrivateClass = false) => {
  const created = await owner.createWorkspace(`Synthetic conflict ${label}`);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Synthetic conflict workspace is missing');
  const initial = await owner.loadState(workspaceId);
  const template = initial.data?.classes[0];
  if (!initial.data || !template) throw new Error('Synthetic class template is missing');
  const classAId = template.id;
  const classBId = `${workspaceId}-private-class-b`;
  const classBSecret = `PRIVATE-BOB-${label}`;
  const classA = {
    ...structuredClone(template), id: classAId, name: 'Synthetic Class A',
    students: [createEnrolledStudent({ id: '100', name: `Alice-${label}` })],
    learningEvidenceRecords: [], examRecords: [], classGoals: [], activeBoss: undefined,
  };
  const classB = {
    ...structuredClone(template), id: classBId, name: `PRIVATE-CLASS-B-${label}`,
    students: [{ ...createEnrolledStudent({ id: '100', name: classBSecret }), points: 73 }],
    learningEvidenceRecords: [], examRecords: [], classGoals: [], activeBoss: undefined,
  };
  const saved = await owner.saveState({
    ...initial.data, currentClassId: classAId,
    classes: withPrivateClass ? [classA, classB] : [classA],
  }, initial.revision, workspaceId);
  return { workspaceId, classAId, classBId, classBSecret, saved };
};
type ConflictFixture = Awaited<ReturnType<typeof fixture>>;

const findDraft = (page: Page, canary: string) => page.evaluate((name) => {
  for (const [key, raw] of Object.entries(sessionStorage)) {
    if (key.startsWith('epet-unsynced-workspace-') && raw.includes(name)) {
      return { key, value: JSON.parse(raw) as Record<string, unknown> };
    }
  }
  return null;
}, canary);

const readStore = (page: Page) => page.evaluate(() =>
  (window as unknown as ObservedWindow).__epetTestStore.getData());

const openWorkspace = async (page: Page, session: E2eApiSession, workspaceId: string) => {
  await openConsoleWithApiSession(page, session);
  const select = page.getByRole('combobox', { name: '工作區', exact: true });
  if (await select.count()) {
    if (await select.inputValue() !== workspaceId) await switchWorkspaceViaUi(page, workspaceId);
  } else {
    expect(session.session.activeWorkspaceId).toBe(workspaceId);
  }
};

const addWithoutWaitingForSave = async (page: Page, name: string) => {
  await selectDashboardTab(page, '學生');
  const panel = page.getByRole('heading', { name: '新增學生' }).locator('..');
  await panel.getByLabel('學生姓名').fill(name);
  await panel.getByRole('button', { name: '新增', exact: true }).click();
};

// Both browser pages load the real authorized snapshot. Hold only Tab B's
// outgoing PUT, let Tab A commit through its actual UI, then forward B's stale
// request to the real API. No response or conflict status is fabricated.
// Separate browser contexts avoid a focus/session refresh replacing B's base
// revision while the test deliberately constructs the concurrent edit.
const createRealConflict = async (
  browser: Browser, pageB: Page, setup: ConflictFixture,
  label: string, principal = owner,
) => {
  const contextA = await browser.newContext({ baseURL: E2E_BASE_URL, locale: 'zh-TW' });
  const pageA = await contextA.newPage();
  let releasePut = () => {};
  const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
  let observePut = () => {};
  const putObserved = new Promise<void>((resolve) => { observePut = resolve; });
  let intercepted = false;
  try {
    await openWorkspace(pageA, principal, setup.workspaceId);
    await openWorkspace(pageB, principal, setup.workspaceId);
    const before = await owner.loadState(setup.workspaceId);
    await pageB.route('**/api/v1/state', async (route) => {
      if (!intercepted && route.request().method() === 'PUT') {
        intercepted = true;
        observePut();
        await putGate;
      }
      await route.continue();
    });
    const localStudent = `LOCAL-UNSAVED-${label}`;
    const remoteStudent = `REMOTE-WINNER-${label}`;
    await addWithoutWaitingForSave(pageB, localStudent);
    await putObserved;
    await addStudentViaUi(pageA, remoteStudent);
    const remote = await owner.loadState(setup.workspaceId);
    expect(remote.revision).toBe(before.revision + 1);
    expect(JSON.stringify(remote.data)).toContain(remoteStudent);
    expect(JSON.stringify(remote.data)).not.toContain(localStudent);
    const staleResponse = pageB.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/state' &&
      response.request().method() === 'PUT');
    releasePut();
    const rejected = await staleResponse;
    expect(rejected.status()).toBe(409);
    const conflictBody = await rejected.json();
    expect(conflictBody.error).toBe('REVISION_CONFLICT');
    await expect(pageB.getByRole('heading', { name: '資料版本衝突', exact: true })).toBeVisible();
    await expect.poll(async () => Boolean(await findDraft(pageB, localStudent))).toBe(true);
    await expect(pageB.getByRole('button', { name: '加減分', exact: true })).toHaveCount(0);
    return { contextA, before, remote, localStudent, remoteStudent, conflictBody };
  } catch (error) {
    releasePut();
    await contextA.close();
    throw error;
  }
};

const confirmAction = async (
  page: Page, action: () => Promise<unknown>, accept: boolean, kind: 'adopt' | 'preserve',
) => {
  const presented = page.waitForEvent('dialog');
  const initiated = action();
  const dialog = await presented;
  expect(dialog.type()).toBe('confirm');
  expect(dialog.message()).toMatch(kind === 'adopt' ? /(丟棄|捨棄|放棄)/ : /(保留|草稿)/);
  if (kind === 'adopt') expect(dialog.message()).toMatch(/(本機|修改)/);
  if (accept) await dialog.accept(); else await dialog.dismiss();
  await initiated;
};

const chooseRemote = (page: Page, accept = true) => confirmAction(page, () =>
  page.getByRole('button', { name: '採用雲端最新版本', exact: true }).click(), accept, 'adopt');

const adoptAndAssert = async (page: Page, setup: ConflictFixture, localStudent: string) => {
  const current = await owner.loadState(setup.workspaceId);
  const loaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/state' &&
    response.request().method() === 'GET' &&
    response.request().headers()['x-epet-workspace'] === setup.workspaceId);
  await chooseRemote(page);
  expect((await loaded).status()).toBe(200);
  await waitForBackendSync(page);
  await expect(page.getByRole('heading', { name: '資料版本衝突', exact: true })).toHaveCount(0);
  expect(await findDraft(page, localStudent)).toBeNull();
  expect(JSON.stringify(await readStore(page))).not.toContain(localStudent);
  expect(await owner.loadState(setup.workspaceId)).toEqual(current);
  return current;
};

test.describe('Real revision conflict recovery', () => {
  test('two tabs preserve a real conflict across refresh, require discard confirmation, then resume autosave', async ({ browser, page }) => {
    const setup = await fixture('adopt');
    const conflict = await createRealConflict(browser, page, setup, 'adopt');
    try {
      await expect(page.getByRole('button', { name: '下載本機草稿', exact: true })).toBeVisible();
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: '下載本機草稿', exact: true }).click();
      const path = await (await downloading).path();
      if (!path) throw new Error('Authorized local draft download is missing');
      const downloaded = await readFile(path, 'utf8');
      expect(downloaded).toContain(conflict.localStudent);
      expect(downloaded).not.toContain(conflict.remoteStudent);
      const captured = await findDraft(page, conflict.localStudent);
      expect(captured?.value.baseRevision).toBe(conflict.before.revision);

      await chooseRemote(page, false);
      await expect(page.getByRole('heading', { name: '資料版本衝突', exact: true })).toBeVisible();
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      expect(await owner.loadState(setup.workspaceId)).toEqual(conflict.remote);

      const writes: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/v1/state' && request.method() === 'PUT') {
          writes.push(request.postData() ?? '');
        }
      });
      // The user's ordinary refresh retains its bound draft instead of silently
      // discarding it or replaying a stale PUT in the background.
      await page.reload();
      await expect(page.getByRole('heading', { name: '資料版本衝突', exact: true })).toBeVisible();
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      const adopted = await adoptAndAssert(page, setup, conflict.localStudent);
      expect(writes).toEqual([]);
      expect(JSON.stringify(await readStore(page))).toContain(conflict.remoteStudent);
      await addStudentViaUi(page, 'AFTER-RECOVERY-AUTOSAVE');
      const saved = await owner.loadState(setup.workspaceId);
      expect(saved.revision).toBe(adopted.revision + 1);
      expect(JSON.stringify(saved.data)).toContain('AFTER-RECOVERY-AUTOSAVE');
      expect(JSON.stringify(saved.data)).toContain(conflict.remoteStudent);
      expect(JSON.stringify(saved.data)).not.toContain(conflict.localStudent);
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0]).baseRevision).toBe(adopted.revision);
      await page.reload();
      await waitForBackendSync(page);
      expect(await loadBrowserState(page.context(), setup.workspaceId)).toEqual(saved);
      expect(await findDraft(page, conflict.localStudent)).toBeNull();
    } finally {
      await conflict.contextA.close();
    }
  });

  test('logout can be cancelled or preserve the exact-bound conflict draft for the same user login', async ({ browser, page }) => {
    const setup = await fixture('logout');
    // Logout must revoke a genuine browser session without revoking the
    // independent setup/inspection session used to assert remote durability.
    const browserSession = await E2eApiSession.login(owner.account);
    const conflict = await createRealConflict(browser, page, setup, 'logout', browserSession);
    try {
      const captured = await findDraft(page, conflict.localStudent);
      await confirmAction(page, () => page.getByRole('button', { name: '登出', exact: true }).click(), false, 'preserve');
      await expect(page.getByRole('heading', { name: '資料版本衝突', exact: true })).toBeVisible();
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      await confirmAction(page, () => page.getByRole('button', { name: '保留草稿並登出', exact: true }).click(), true, 'preserve');
      await expect(page.getByRole('button', { name: '登入並繼續帶班', exact: true })).toBeVisible();
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      expect(JSON.stringify(await readStore(page))).not.toContain(conflict.localStudent);
      expect(await owner.loadState(setup.workspaceId)).toEqual(conflict.remote);
      await loginViaUi(page, owner.account);
      await page.getByRole('combobox', { name: '工作區', exact: true }).selectOption(setup.workspaceId);
      await expect(page.getByRole('heading', { name: '資料版本衝突', exact: true })).toBeVisible();
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      await adoptAndAssert(page, setup, conflict.localStudent);
      await addStudentViaUi(page, 'AFTER-CONFLICT-RELOGIN');
      expect(JSON.stringify((await owner.loadState(setup.workspaceId)).data)).toContain('AFTER-CONFLICT-RELOGIN');
    } finally {
      await conflict.contextA.close();
      await browserSession.dispose();
    }
  });

  test('workspace switching confirms preservation and recovers only the original workspace draft', async ({ browser, page }) => {
    const setup = await fixture('switch-source');
    const target = await fixture('switch-target');
    const conflict = await createRealConflict(browser, page, setup, 'switch');
    try {
      const captured = await findDraft(page, conflict.localStudent);
      const select = page.getByRole('combobox', { name: '工作區', exact: true });
      await confirmAction(page, () => select.selectOption(target.workspaceId), false, 'preserve');
      await expect(select).toHaveValue(setup.workspaceId);
      await expect(page.getByRole('heading', { name: '資料版本衝突', exact: true })).toBeVisible();
      const targetLoaded = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/v1/state' &&
        response.request().method() === 'GET' &&
        response.request().headers()['x-epet-workspace'] === target.workspaceId);
      await confirmAction(page, () => select.selectOption(target.workspaceId), true, 'preserve');
      expect((await targetLoaded).status()).toBe(200);
      await waitForBackendSync(page);
      await expect(select).toHaveValue(target.workspaceId);
      expect(JSON.stringify(await readStore(page))).not.toContain(conflict.localStudent);
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      expect(await owner.loadState(target.workspaceId)).toEqual(target.saved);
      await select.selectOption(setup.workspaceId);
      await expect(page.getByRole('heading', { name: '資料版本衝突', exact: true })).toBeVisible();
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      await adoptAndAssert(page, setup, conflict.localStudent);
      await addStudentViaUi(page, 'AFTER-CONFLICT-WORKSPACE-ROUNDTRIP');
      expect(await owner.loadState(target.workspaceId)).toEqual(target.saved);
    } finally {
      await conflict.contextA.close();
    }
  });

  test('a transient remote-load failure during adoption preserves the draft and supports a safe retry', async ({ browser, page }) => {
    const setup = await fixture('network');
    const conflict = await createRealConflict(browser, page, setup, 'network');
    try {
      const captured = await findDraft(page, conflict.localStudent);
      let failedReads = 0;
      let blockReads = true;
      const writes: string[] = [];
      await page.route('**/api/v1/state', async (route) => {
        const request = route.request();
        if (request.method() === 'PUT') writes.push(request.postData() ?? '');
        if (blockReads && request.method() === 'GET') {
          failedReads += 1;
          await route.abort('failed');
          return;
        }
        await route.continue();
      });
      await chooseRemote(page);
      await expect.poll(() => failedReads).toBeGreaterThan(0);
      await expect(page.getByRole('button', { name: '採用雲端最新版本', exact: true })).toBeEnabled();
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      expect(JSON.stringify(await readStore(page))).toContain(conflict.localStudent);
      expect(await owner.loadState(setup.workspaceId)).toEqual(conflict.remote);
      expect(writes).toEqual([]);
      blockReads = false;
      await adoptAndAssert(page, setup, conflict.localStudent);
      await addStudentViaUi(page, 'AFTER-NETWORK-RECOVERY');
      const saved = await owner.loadState(setup.workspaceId);
      expect(saved.revision).toBe(conflict.remote.revision + 1);
      expect(JSON.stringify(saved.data)).toContain(conflict.remoteStudent);
      expect(JSON.stringify(saved.data)).not.toContain(conflict.localStudent);
      expect(writes).toHaveLength(1);
    } finally {
      await conflict.contextA.close();
    }
  });

  test('a limited Class A teacher cannot download or transmit Class B during conflict recovery', async ({ browser, page }) => {
    const setup = await fixture('teacher-scope', true);
    const account = testAccount('conflict-class-a-teacher');
    const teacher = await inviteAccount(owner, setup.workspaceId, account, 'teacher', [setup.classAId]);
    const forbidden = [setup.classBId, setup.classBSecret, 'PRIVATE-CLASS-B-teacher-scope'];
    const requests: string[] = [];
    const listener = (request: Request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) {
        requests.push(`${request.url()}\n${request.postData() ?? ''}`);
      }
    };
    page.on('request', listener);
    await page.addInitScript((canaries) => {
      const target = window as unknown as ObservedWindow;
      target.__epetConflictDomLeaks = [];
      const inspect = () => {
        for (const name of canaries) {
          if ((document.documentElement?.textContent ?? '').includes(name)) {
            target.__epetConflictDomLeaks?.push(name);
          }
        }
      };
      new MutationObserver(inspect).observe(document, { childList: true, characterData: true, subtree: true });
    }, forbidden);
    let conflict: Awaited<ReturnType<typeof createRealConflict>> | undefined;
    try {
      conflict = await createRealConflict(browser, page, setup, 'teacher-scope', teacher);
      await expect(page.getByRole('button', { name: '下載本機草稿', exact: true })).toHaveCount(0);
      const captured = await findDraft(page, conflict.localStudent);
      expect(captured).not.toBeNull();
      for (const name of forbidden) {
        expect(JSON.stringify(captured)).not.toContain(name);
        expect(JSON.stringify(conflict.conflictBody)).not.toContain(name);
      }
      await page.reload();
      await expect(page.getByRole('heading', { name: '資料版本衝突', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '下載本機草稿', exact: true })).toHaveCount(0);
      await adoptAndAssert(page, setup, conflict.localStudent);
      await addStudentViaUi(page, 'AFTER-TEACHER-CONFLICT');
      await selectTeacherDestination(page, 'Learning', '每週回饋報告');
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: '匯出 CSV', exact: true }).click();
      const path = await (await downloading).path();
      if (!path) throw new Error('Authorized Class A CSV is missing');
      const exported = await readFile(path, 'utf8');
      expect(exported).toContain('Alice-teacher-scope');
      const observed = await page.evaluate(() => {
        const target = window as unknown as ObservedWindow;
        return { current: target.__epetTestStore.getData(), changes: target.__epetTestStore.changes,
          leaks: target.__epetConflictDomLeaks, dom: document.documentElement.textContent };
      });
      for (const name of forbidden) {
        expect(exported).not.toContain(name);
        expect(JSON.stringify(observed)).not.toContain(name);
        expect(requests.join('\n')).not.toContain(name);
      }
      const saved = await owner.loadState(setup.workspaceId);
      expect(saved.data?.classes.find((classroom) => classroom.id === setup.classBId))
        .toEqual(setup.saved.data?.classes.find((classroom) => classroom.id === setup.classBId));
      expect(JSON.stringify(saved.data)).toContain(conflict.remoteStudent);
      expect(JSON.stringify(saved.data)).toContain('AFTER-TEACHER-CONFLICT');
      expect(JSON.stringify(saved.data)).not.toContain(conflict.localStudent);
    } finally {
      await conflict?.contextA.close();
      await teacher.dispose();
    }
  });

  test('a failed draft removal prevents adoption without losing memory or replaying the stale queue', async ({ browser, page }) => {
    const setup = await fixture('storage-removal');
    const conflict = await createRealConflict(browser, page, setup, 'storage-removal');
    try {
      const captured = await findDraft(page, conflict.localStudent);
      if (!captured) throw new Error('The conflicted draft is missing');
      const previousStore = await readStore(page);
      const writes: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/v1/state' && request.method() === 'PUT') {
          writes.push(request.postData() ?? '');
        }
      });
      await page.evaluate((draftKey) => {
        const remove = Storage.prototype.removeItem;
        const target = window as unknown as ObservedWindow;
        target.__epetRestoreDraftRemoval = () => { Storage.prototype.removeItem = remove; };
        Storage.prototype.removeItem = function (key: string) {
          if (this === window.sessionStorage && key === draftKey) {
            throw new DOMException('Synthetic draft removal denial', 'SecurityError');
          }
          return remove.call(this, key);
        };
      }, captured.key);
      await chooseRemote(page);
      await expect(page.getByText(
        '尚未採用雲端版本，草稿仍保留。請確認網路連線及瀏覽器儲存權限後再試。',
        { exact: true },
      )).toBeVisible();
      await expect(page.getByRole('heading', { name: '資料版本衝突', exact: true })).toBeVisible();
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      expect(await readStore(page)).toEqual(previousStore);
      expect(await owner.loadState(setup.workspaceId)).toEqual(conflict.remote);
      expect(writes).toEqual([]);
      await page.evaluate(() => {
        (window as unknown as ObservedWindow).__epetRestoreDraftRemoval?.();
      });
      const adopted = await adoptAndAssert(page, setup, conflict.localStudent);
      expect(writes).toEqual([]);
      await addStudentViaUi(page, 'AFTER-STORAGE-REMOVAL-RECOVERY');
      const saved = await owner.loadState(setup.workspaceId);
      expect(saved.revision).toBe(adopted.revision + 1);
      expect(JSON.stringify(saved.data)).toContain(conflict.remoteStudent);
      expect(JSON.stringify(saved.data)).not.toContain(conflict.localStudent);
      expect(writes).toHaveLength(1);
    } finally {
      await page.evaluate(() => {
        (window as unknown as ObservedWindow).__epetRestoreDraftRemoval?.();
      });
      await conflict.contextA.close();
    }
  });

  test('adoption revalidates an admin downgraded to Class A and keeps its old full-scope draft isolated', async ({ browser, page }) => {
    const setup = await fixture('adoption-scope-change', true);
    const account = testAccount('conflict-downgraded-admin');
    const admin = await inviteAccount(owner, setup.workspaceId, account, 'admin', []);
    const conflict = await createRealConflict(browser, page, setup, 'adoption-scope-change', admin);
    try {
      const captured = await findDraft(page, conflict.localStudent);
      expect(captured?.value.access).toMatchObject({ role: 'admin' });
      expect(JSON.stringify(captured)).toContain(setup.classBSecret);
      const changed = await owner.context.patch(`/api/v1/members/${encodeURIComponent(admin.session.user.id)}`, {
        headers: {
          cookie: owner.cookie, origin: E2E_BASE_URL,
          'x-csrf-token': owner.csrfToken, 'x-epet-workspace': setup.workspaceId,
        },
        data: { role: 'teacher', classIds: [setup.classAId] },
      });
      expect(changed.status()).toBe(200);
      const requests: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/')) {
          requests.push(`${request.method()} ${request.url()}\n${request.postData() ?? ''}`);
        }
      });
      const downloads: string[] = [];
      page.on('download', (download) => { downloads.push(download.suggestedFilename()); });
      const revalidated = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/v1/state' &&
        response.request().method() === 'GET' &&
        response.request().headers()['x-epet-workspace'] === setup.workspaceId);
      await chooseRemote(page);
      const response = await revalidated;
      expect(response.status()).toBe(200);
      const authorized = await response.json();
      expect(authorized.access.role).toBe('teacher');
      expect(authorized.access.classIds).toEqual([setup.classAId]);
      expect(JSON.stringify(authorized)).not.toContain(setup.classBSecret);
      await expect(page.getByRole('button', { name: '登入並繼續帶班', exact: true })).toBeVisible();
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      expect(JSON.stringify(await readStore(page))).not.toContain(setup.classBSecret);
      expect(JSON.stringify(await readStore(page))).not.toContain(conflict.localStudent);
      await expect(page.getByRole('button', { name: '下載本機草稿', exact: true })).toHaveCount(0);
      expect(await owner.loadState(setup.workspaceId)).toEqual(conflict.remote);
      await loginViaUi(page, account);
      await selectDashboardTab(page, '學生');
      await expect(page.getByRole('combobox', { name: '目前班級', exact: true }).locator('option')).toHaveCount(1);
      expect(await findDraft(page, conflict.localStudent)).toEqual(captured);
      expect(JSON.stringify(await readStore(page))).not.toContain(setup.classBSecret);
      expect(JSON.stringify(await readStore(page))).not.toContain(setup.classBId);
      expect(JSON.stringify(await readStore(page))).not.toContain(conflict.localStudent);
      await addStudentViaUi(page, 'AFTER-AUTHORIZED-CLASS-A-LOGIN');
      expect(downloads).toEqual([]);
      for (const name of [setup.classBId, setup.classBSecret, conflict.localStudent]) {
        expect(requests.join('\n')).not.toContain(name);
        expect(await page.locator('body').innerText()).not.toContain(name);
      }
      const saved = await owner.loadState(setup.workspaceId);
      expect(saved.data?.classes.find((classroom) => classroom.id === setup.classBId))
        .toEqual(setup.saved.data?.classes.find((classroom) => classroom.id === setup.classBId));
      expect(JSON.stringify(saved.data)).toContain(conflict.remoteStudent);
      expect(JSON.stringify(saved.data)).not.toContain(conflict.localStudent);
    } finally {
      await conflict.contextA.close();
      await admin.dispose();
    }
  });

  test('a late failed draft download cannot put an adopted workspace back offline', async ({ browser, page }) => {
    const setup = await fixture('late-download-failure');
    const conflict = await createRealConflict(browser, page, setup, 'late-download-failure');
    let releaseRead = () => {};
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let heldRequest: Request | undefined;
    const downloads: string[] = [];
    const writes: string[] = [];
    page.on('download', (download) => { downloads.push(download.suggestedFilename()); });
    try {
      await page.route('**/api/v1/state', async (route) => {
        const request = route.request();
        if (request.method() === 'PUT') writes.push(request.postData() ?? '');
        // Hold exactly the download's first authorization read. Adoption and
        // subsequent autosave preflights must reach the genuine API normally.
        if (!heldRequest && request.method() === 'GET') {
          heldRequest = request;
          await readGate;
          await route.abort('failed');
          return;
        }
        await route.continue();
      });
      await page.getByRole('button', { name: '下載本機草稿', exact: true }).click();
      await expect.poll(() => Boolean(heldRequest), { timeout: 10_000 }).toBe(true);
      await expect(page.getByRole('heading', { name: '資料版本衝突', exact: true })).toBeVisible();
      const adopted = await adoptAndAssert(page, setup, conflict.localStudent);
      const adoptedStore = await readStore(page);
      expect(JSON.stringify(adoptedStore)).toContain(conflict.remoteStudent);
      expect(writes).toEqual([]);
      const failed = page.waitForEvent('requestfailed', {
        predicate: (request) => request === heldRequest,
        timeout: 10_000,
      });
      releaseRead();
      expect((await failed).failure()?.errorText).toMatch(/ERR_FAILED|failed/i);
      // Settle the rejected fetch's promise handlers and the following React
      // paint before checking that the stale error did not change sync state.
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      await waitForBackendSync(page);
      expect(downloads).toEqual([]);
      expect(await readStore(page)).toEqual(adoptedStore);
      expect(await findDraft(page, conflict.localStudent)).toBeNull();
      expect(await owner.loadState(setup.workspaceId)).toEqual(adopted);
      await addStudentViaUi(page, 'AFTER-LATE-DOWNLOAD-FAILURE');
      const saved = await owner.loadState(setup.workspaceId);
      expect(saved.revision).toBe(adopted.revision + 1);
      expect(JSON.stringify(saved.data)).toContain(conflict.remoteStudent);
      expect(JSON.stringify(saved.data)).toContain('AFTER-LATE-DOWNLOAD-FAILURE');
      expect(JSON.stringify(saved.data)).not.toContain(conflict.localStudent);
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0]).baseRevision).toBe(adopted.revision);
      expect(downloads).toEqual([]);
    } finally {
      releaseRead();
      await conflict.contextA.close();
    }
  });
});
