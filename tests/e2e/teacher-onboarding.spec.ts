import { expect, test, type Page } from '@playwright/test';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import {
  E2eApiSession,
  addStudentViaUi,
  browserApiRequest,
  inviteAccount,
  loadBrowserState,
  loginViaUi,
  openConsoleWithApiSession,
  performSyncedAction,
  selectTeacherDestination,
  switchWorkspaceViaUi,
  testAccount,
  waitForBackendSync,
} from './support/fixtures';

let owner: E2eApiSession;
const guide = (page: Page) => page.getByRole('region', { name: '使用導覽', exact: true });
const activeHeading = (page: Page) => guide(page).getByRole('heading', { name: '從第一個班級開始', exact: true });
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Teacher Console', exact: true });

const watchStateWrites = (page: Page) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/state' && request.method() === 'PUT') {
      writes.push(request.headers()['x-epet-workspace']);
    }
  });
  return writes;
};

const openWorkspace = async (page: Page, name: string) => {
  // The isolation scenario intentionally revokes the browser owner's session.
  // Each scenario obtains independent, current API credentials afterwards.
  const account = owner.account;
  await owner.dispose();
  owner = await E2eApiSession.login(account);
  const created = await owner.createWorkspace(name);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Synthetic workspace is missing');
  await openConsoleWithApiSession(page, owner);
  return workspaceId;
};

const expectGames = async (page: Page, shown: boolean) => {
  const activities = navigation(page).getByRole('button', { name: '活動', exact: true });
  const presentation = page.getByRole('button', { name: '展示大廳', exact: true });
  const activityAction = page.getByRole('region', { name: '快速操作', exact: true })
    .getByRole('button', { name: '開始活動', exact: true });
  if (shown) {
    await expect(activities).toBeVisible();
    await expect(presentation).toBeVisible();
    await expect(activityAction).toBeVisible();
  } else {
    await expect(activities).toHaveCount(0);
    await expect(presentation).toHaveCount(0);
    await expect(activityAction).toHaveCount(0);
  }
};

test.describe('Optional teacher setup guide', () => {
  test.beforeAll(async () => {
    owner = await E2eApiSession.register(testAccount('teacher-setup-owner'));
  });
  test.afterAll(async () => { await owner.dispose(); });

  test('functional preferences are not read until a fresh authorized workspace has loaded', async ({ page }) => {
    await openWorkspace(page, 'teacher-setup-authority');
    await page.addInitScript(() => {
      const observations: string[] = [];
      (window as unknown as { setupReads: string[] }).setupReads = observations;
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        if (key.startsWith('epet-teacher-setup-')) observations.push(key);
        return original.call(this, key);
      };
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/v1/state', async (route) => {
      if (route.request().method() === 'GET') await gate;
      await route.continue();
    });
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: '正在安全載入工作區', exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { setupReads: string[] }).setupReads)).toEqual([]);
      await expect(guide(page)).toHaveCount(0);
      release();
      await expect(guide(page).getByRole('button', { name: '開始使用導覽', exact: true })).toBeVisible();
      expect((await page.evaluate(() => (window as unknown as { setupReads: string[] }).setupReads)).length).toBeGreaterThan(0);
    } finally { release(); }
  });

  test('a real registration opens the guide; pause, skip and resume survive reload without creating another class', async ({ context, page }, info) => {
    const account = testAccount('teacher-setup-registration');
    await page.goto('/#/register');
    await page.locator('#auth-display-name').fill(account.displayName);
    await page.locator('#auth-email').fill(account.email);
    await page.locator('#auth-password').fill(account.password);
    await page.locator('#auth-password-confirmation').fill(account.password);
    await page.getByRole('button', { name: '建立帳號，開始帶班', exact: true }).click();
    await expect(activeHeading(page)).toBeVisible();
    await waitForBackendSync(page);

    const authResponse = await browserApiRequest(context, '/api/v1/auth/session');
    expect(authResponse.status()).toBe(200);
    const auth = await authResponse.json() as { session: { activeWorkspaceId: string | null } };
    const workspaceId = auth.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Registered workspace is missing');
    const baseline = await loadBrowserState(context, workspaceId);
    expect(baseline.data?.classes).toHaveLength(1);
    const writes = watchStateWrites(page);
    await expect(guide(page)).toContainText('已有可用班級，直接使用即可，不需重複建立。');
    await expect(guide(page).getByRole('listitem').first()).toContainText('已完成');
    await expect(guide(page).getByRole('button', { name: '加入／匯入學生', exact: true })).toBeVisible();
    await expect(guide(page).getByRole('button', { name: '建立第一個班級', exact: true })).toHaveCount(0);

    await page.setViewportSize({ width: 320, height: 812 });
    const pause = guide(page).getByRole('button', { name: '稍後繼續', exact: true });
    await pause.focus();
    await page.keyboard.press('Enter');
    await expect(activeHeading(page)).toHaveCount(0);
    await page.reload();
    const resume = guide(page).getByRole('button', { name: '繼續使用導覽', exact: true });
    await expect(resume).toBeVisible();
    await resume.focus();
    await page.keyboard.press('Enter');
    await expect(activeHeading(page)).toBeVisible();
    await guide(page).getByRole('button', { name: '略過導覽', exact: true }).click();
    await page.reload();
    await expect(activeHeading(page)).toHaveCount(0);
    await guide(page).getByRole('button', { name: '繼續使用導覽', exact: true }).click();
    await expect(activeHeading(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const screenshot = info.outputPath('teacher-setup-mobile-zh.png');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach('Teacher setup Chinese mobile', { path: screenshot, contentType: 'image/png' });
    // Include the normal save debounce so a delayed accidental write is visible.
    await page.waitForTimeout(1_000);
    expect(writes).toEqual([]);
    expect(await loadBrowserState(context, workspaceId)).toEqual(baseline);
  });

  test('the guide uses real roster, point and review workflows, then hides and restores game entries without changing classroom data', async ({ context, page }) => {
    const workspaceId = await openWorkspace(page, 'teacher-setup-complete');
    await expect(activeHeading(page)).toHaveCount(0);
    await guide(page).getByRole('button', { name: '開始使用導覽', exact: true }).click();
    await guide(page).getByRole('button', { name: '加入／匯入學生', exact: true }).click();
    await expect(page.getByRole('tab', { name: '學生', exact: true })).toHaveAttribute('aria-selected', 'true');
    const studentName = 'E2E 導覽實際學生';
    await addStudentViaUi(page, studentName);
    await selectTeacherDestination(page, 'Today');
    await expect(guide(page)).toContainText('已完成 2 / 5 步');
    await guide(page).getByRole('button', { name: '完成第一次加減分', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '給予積分', exact: true });
    await expect(dialog.getByLabel('回饋原因與積分', { exact: true })).toBeFocused();
    await performSyncedAction(page, () => dialog.getByRole('group', { name: '套用至學生', exact: true })
      .getByRole('button', { name: studentName, exact: true }).click());
    await expect(dialog).not.toBeVisible();
    await expect(guide(page)).toContainText('已完成 3 / 5 步');
    const afterPoints = await loadBrowserState(context, workspaceId);
    expect(afterPoints.data?.classes).toHaveLength(1);
    expect(afterPoints.data?.classes[0]?.students[0]?.pointAdjustmentRecords?.some((record) =>
      record.source === 'quick' && record.amount > 0)).toBe(true);
    const writes = watchStateWrites(page);

    await guide(page).getByRole('button', { name: '查看學生狀態', exact: true }).click();
    await expect(page.getByRole('tab', { name: '個人分析', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: '個人分析', exact: true })).toBeVisible();
    await selectTeacherDestination(page, 'Today');
    await expect(guide(page)).toContainText('已完成 4 / 5 步');
    await guide(page).getByRole('button', { name: '先專注教學', exact: true }).click();
    await expect(guide(page).getByRole('heading', { name: '已完成使用導覽', exact: true })).toBeVisible();
    await expectGames(page, false);
    await page.reload();
    await expect(guide(page).getByRole('heading', { name: '已完成使用導覽', exact: true })).toBeVisible();
    await expectGames(page, false);
    await page.getByRole('button', { name: '開啟遊戲化介面', exact: true }).click();
    await expectGames(page, true);
    await page.reload();
    await expectGames(page, true);
    await page.waitForTimeout(1_000);
    expect(writes).toEqual([]);
    expect(await loadBrowserState(context, workspaceId)).toEqual(afterPoints);
  });

  test('existing users choose the guide and browser preferences stay isolated by workspace and account', async ({ context, page }) => {
    const firstWorkspaceId = await openWorkspace(page, 'teacher-setup-isolation-first');
    const firstState = await loadBrowserState(context, firstWorkspaceId);
    const second = await owner.createWorkspace('teacher-setup-isolation-second');
    const secondWorkspaceId = second.session.activeWorkspaceId;
    if (!secondWorkspaceId) throw new Error('Second workspace is missing');
    const secondState = await owner.loadState(secondWorkspaceId);
    await page.reload();
    await waitForBackendSync(page);
    const writes = watchStateWrites(page);
    await expect(activeHeading(page)).toHaveCount(0);
    await expect(guide(page).getByRole('button', { name: '開始使用導覽', exact: true })).toBeVisible();
    await switchWorkspaceViaUi(page, firstWorkspaceId);
    await guide(page).getByRole('button', { name: '開始使用導覽', exact: true }).click();
    await guide(page).getByRole('button', { name: '稍後繼續', exact: true }).click();
    await page.getByRole('button', { name: '隱藏遊戲化介面', exact: true }).click();
    await expectGames(page, false);

    await switchWorkspaceViaUi(page, secondWorkspaceId);
    await expect(guide(page).getByRole('button', { name: '開始使用導覽', exact: true })).toBeVisible();
    await expectGames(page, true);
    await switchWorkspaceViaUi(page, firstWorkspaceId);
    await expect(guide(page).getByRole('button', { name: '繼續使用導覽', exact: true })).toBeVisible();
    await expectGames(page, false);

    // The next teacher shares the workspace and browser storage, but not the
    // first account's optional guide or display preferences.
    const colleagueAccount = testAccount('teacher-setup-colleague');
    const colleague = await inviteAccount(owner, firstWorkspaceId, colleagueAccount, 'admin', []);
    await colleague.dispose();
    await page.getByRole('button', { name: '登出', exact: true }).click();
    await loginViaUi(page, colleagueAccount);
    await expect(guide(page).getByRole('button', { name: '開始使用導覽', exact: true })).toBeVisible();
    await expect(activeHeading(page)).toHaveCount(0);
    await expectGames(page, true);
    await page.getByRole('button', { name: '登出', exact: true }).click();
    await loginViaUi(page, owner.account);
    const selected = await page.getByRole('combobox', { name: '工作區', exact: true }).inputValue();
    if (selected !== firstWorkspaceId) await switchWorkspaceViaUi(page, firstWorkspaceId);
    await expect(guide(page).getByRole('button', { name: '繼續使用導覽', exact: true })).toBeVisible();
    await expectGames(page, false);
    await page.waitForTimeout(1_000);
    expect(writes).toEqual([]);
    expect(await loadBrowserState(context, firstWorkspaceId)).toEqual(firstState);
    expect(await loadBrowserState(context, secondWorkspaceId)).toEqual(secondState);
  });

  test('English guide and point direction support mobile keyboard operation and the show-games choice', async ({ context, page }, info) => {
    const workspaceId = await openWorkspace(page, 'teacher-setup-english');
    const baseline = await loadBrowserState(context, workspaceId);
    if (!baseline.data) throw new Error('Synthetic workspace data is missing');
    const student = createEnrolledStudent({ id: 'teacher-setup-english-student', name: 'E2E Setup learner' });
    const seeded = await owner.saveState({
      ...baseline.data,
      settings: { ...baseline.data.settings!, language: 'en' },
      classes: baseline.data.classes.map((classroom, index) => index === 0 ? {
        ...classroom,
        students: [{ ...student, pointAdjustmentRecords: [{ id: 'teacher-setup-points', source: 'manual', amount: 1, createdAt: Date.now(), reasonLabel: 'E2E setup feedback' }] }],
      } : classroom),
    }, baseline.revision, workspaceId);
    const writes = watchStateWrites(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    const englishGuide = page.getByRole('region', { name: 'Getting started', exact: true });
    const start = englishGuide.getByRole('button', { name: 'Start setup guide', exact: true });
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(englishGuide.getByRole('heading', { name: 'Start with your first class', exact: true })).toBeVisible();
    await expect(englishGuide).toContainText('3 / 5 steps complete');
    const quick = page.getByRole('region', { name: 'Quick actions', exact: true });
    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 812 });
      for (const name of ['Points', 'Record grades', 'Learning records', 'Start activity']) {
        const button = quick.getByRole('button', { name, exact: true });
        await button.focus();
        await expect(button).toBeFocused();
        await expect(button).toBeInViewport();
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 320, height: 812 });
    const points = quick.getByRole('button', { name: 'Points', exact: true });
    await points.focus();
    await page.keyboard.press('Enter');
    const giveDialog = page.getByRole('dialog', { name: 'Give points', exact: true });
    await expect(giveDialog).toBeInViewport();
    const direction = giveDialog.getByRole('group', { name: 'Point direction', exact: true });
    await direction.getByRole('radio', { name: 'Give points', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    const deductDialog = page.getByRole('dialog', { name: 'Deduct points', exact: true });
    await expect(deductDialog.getByRole('radio', { name: 'Deduct points', exact: true })).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(points).toBeFocused();
    const review = englishGuide.getByRole('button', { name: 'Review student status', exact: true });
    await review.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tabpanel', { name: 'Student analytics', exact: true })).toBeVisible();
    await selectTeacherDestination(page, 'Today');
    const show = englishGuide.getByRole('button', { name: 'Show gamification', exact: true });
    await show.focus();
    await page.keyboard.press('Enter');
    await expect(englishGuide.getByRole('heading', { name: 'Getting started completed', exact: true })).toBeVisible();
    await expect(navigation(page).getByRole('button', { name: 'Activities', exact: true })).toBeVisible();
    const screenshot = info.outputPath('teacher-setup-mobile-en.png');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach('Teacher setup English mobile', { path: screenshot, contentType: 'image/png' });
    await page.reload();
    await expect(englishGuide.getByRole('heading', { name: 'Getting started completed', exact: true })).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(writes).toEqual([]);
    expect(await loadBrowserState(context, workspaceId)).toEqual(seeded);
  });
});
