import { expect, test, type Page } from '@playwright/test';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import {
  E2eApiSession, inviteAccount, openConsoleWithApiSession, performSyncedAction,
  selectTeacherDestination, testAccount,
} from './support/fixtures';

let owner: E2eApiSession;
const hub = async (page: Page) => {
  await page.getByRole('button', { name: '寵物活動', exact: true }).click();
  await expect(page.getByRole('heading', { name: '寵物活動', exact: true })).toBeVisible();
};
const seed = async (name: string, count = 50) => {
  const created = await owner.createWorkspace(name);
  const workspaceId = created.session.activeWorkspaceId!;
  const snapshot = await owner.loadState(workspaceId);
  if (!snapshot.data) throw new Error('Synthetic workspace missing');
  const first = snapshot.data.classes[0];
  const students = Array.from({ length: count }, (_, index) => ({
    ...createEnrolledStudent({ id: `synthetic-${index}`, name: `Synthetic Learner ${String(index + 1).padStart(3, '0')}` }),
    points: 400,
    pet: { type: 'cat', level: 3, fullness: 80, happiness: 80 },
  }));
  const second = { ...structuredClone(first), id: `${first.id}-other`, name: 'Other Class', students: [{
    ...createEnrolledStudent({ id: 'synthetic-0', name: 'UNAUTHORIZED_CLASS_B_CANARY' }),
    points: 555, pet: { type: 'dog', level: 5, fullness: 90, happiness: 90 },
  }] };
  await owner.saveState({ ...snapshot.data,
    // The synthetic owner explicitly opts into full names so scope canaries are
    // observable. Inclusive mode otherwise correctly forces masked names.
    settings: { ...snapshot.data.settings!, inclusiveMode: false, publicNameMode: 'full', decayAmount: 0,
      gameFeatures: { pets: true, battles: true, bosses: true, leaderboards: true }, battleMode: 'both' },
    classes: [{ ...first, students }, second], currentClassId: first.id,
  }, snapshot.revision, workspaceId);
  return { workspaceId, classId: first.id, secondId: second.id };
};

test.describe('One private pet activity roster', () => {
  test.beforeAll(async () => { owner = await E2eApiSession.register(testAccount('pet-hub-owner')); });
  test.afterAll(async () => { await owner.dispose(); });

  test('Today does not mount hidden points rows and controlled selections survive navigation', async ({ page }) => {
    await seed('points-roster-on-demand', 2);
    await openConsoleWithApiSession(page, owner);
    await expect(page.locator('[id^="point-reason-"]')).toHaveCount(0);
    await selectTeacherDestination(page, 'Class', '加減分');
    const reason = page.locator('#point-reason-synthetic-0');
    const choice = await reason.locator('option').nth(1).getAttribute('value');
    if (!choice) throw new Error('Synthetic point reason is missing');
    await reason.selectOption(choice);
    const selection = page.getByRole('checkbox', { name: /Synthetic Learner 001/ });
    await selection.check();
    await selectTeacherDestination(page, 'Today');
    await expect(page.locator('[id^="point-reason-"]')).toHaveCount(0);
    await selectTeacherDestination(page, 'Class', '加減分');
    await expect(reason).toHaveValue(choice);
    await expect(selection).toBeChecked();
    const selectAll = page.getByRole('table').locator('thead input[type="checkbox"]');
    await expect(selectAll).toHaveAttribute('aria-checked', 'mixed');
    expect(await selectAll.evaluate((element: HTMLInputElement) => element.indeterminate)).toBe(true);
  });

  test('opening activities preserves an unfinished console editor without creating a student', async ({ page }) => {
    const { workspaceId, classId } = await seed('pet-hub-preserves-draft', 2);
    await openConsoleWithApiSession(page, owner);
    await selectTeacherDestination(page, 'Class', '學生');
    await page.locator('#studentName').fill('UNSAVED_SYNTHETIC_ROSTER_DRAFT');
    await hub(page);
    await page.getByRole('button', { name: '導師控制台', exact: true }).click();
    await expect(page.locator('#studentName')).toHaveValue('UNSAVED_SYNTHETIC_ROSTER_DRAFT');
    const snapshot = await owner.loadState(workspaceId);
    expect(snapshot.data?.classes.find((item) => item.id === classId)?.students).toHaveLength(2);
    expect(JSON.stringify(snapshot.data)).not.toContain('UNSAVED_SYNTHETIC_ROSTER_DRAFT');
  });

  test('console shortcuts and boss management do not duplicate cards; the hub retains every action and class', async ({ page }) => {
    const { classId, secondId } = await seed('single-pet-hub', 2);
    await openConsoleWithApiSession(page, owner);
    for (const tab of ['寵物', '對戰', '魔王管理']) {
      await selectTeacherDestination(page, 'Activities', tab);
      await expect(page.getByRole('article')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '開啟寵物活動', exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: '開啟寵物活動', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(2);
    const card = page.getByRole('article').first();
    for (const name of [/餵食/, /玩耍/, /^升級/, /^對戰$/, /建立隊伍/]) {
      await expect(card.getByRole('button', { name })).toBeVisible();
    }
    // Distinct IDs even though the draft-preserving console remains mounted.
    expect(await page.locator('[id]').evaluateAll((nodes) => {
      const ids = nodes.map((node) => node.id);
      return ids.length === new Set(ids).size;
    })).toBe(true);
    await performSyncedAction(page, () => page.locator('#pet-activity-class').selectOption(secondId));
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('article', { name: 'UNAUTHORIZED_CLASS_B_CANARY', exact: true })).toBeVisible();
    await performSyncedAction(page, () => page.locator('#pet-activity-class').selectOption(classId));
    await page.getByRole('button', { name: '導師控制台', exact: true }).click();
    await expect(page.getByRole('tab', { name: '魔王管理', exact: true })).toHaveAttribute('aria-selected', 'true');
    await selectTeacherDestination(page, 'Activities', '排行榜');
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '隊伍排行榜', exact: true })).toBeVisible();
  });

  test('pagination and search bound rendering, keep off-page opponents, persist a selected student and preserve the full roster', async ({ page }) => {
    const { workspaceId, classId } = await seed('paged-pet-hub');
    await openConsoleWithApiSession(page, owner);
    await hub(page);
    const roster = page.getByRole('region', { name: '班級寵物列表', exact: true });
    await expect(roster.getByRole('article')).toHaveCount(24);
    await expect(roster.getByRole('status')).toContainText('全班 50 位');
    const firstBattle = roster.getByRole('article').first().getByRole('button', { name: '對戰', exact: true });
    await firstBattle.click();
    const battle = page.getByRole('dialog', { name: '選擇對戰對手', exact: true });
    await expect(battle.getByRole('button', { name: /Synthetic Learner 050/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(firstBattle).toBeFocused();
    await page.getByRole('button', { name: '下一頁', exact: true }).click();
    await expect(roster.getByRole('heading', { name: '班級寵物列表', exact: true })).toBeFocused();
    await expect(roster.getByRole('article')).toHaveCount(24);
    await page.getByRole('button', { name: '下一頁', exact: true }).click();
    await expect(roster.getByRole('article')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '下一頁', exact: true })).toBeDisabled();
    const search = page.getByRole('searchbox', { name: '搜尋此班學生', exact: true });
    await search.fill('Learner 050');
    const chosen = roster.getByRole('article', { name: 'Synthetic Learner 050', exact: true });
    await expect(roster.getByRole('article')).toHaveCount(1);
    await performSyncedAction(page, () => chosen.getByRole('button', { name: /餵食/ }).click());
    const saved = await owner.loadState(workspaceId);
    expect(saved.data?.classes.find((item) => item.id === classId)?.students).toHaveLength(50);
    expect(saved.data?.classes.find((item) => item.id === classId)?.students[49].points).toBe(390);
    expect(saved.data?.classes[1].students[0].points).toBe(555);
    await page.reload();
    await hub(page);
    await expect(page.getByRole('region', { name: '班級寵物列表', exact: true }).getByRole('article')).toHaveCount(24);
    await search.fill('no-synthetic-match');
    await expect(page.getByRole('region', { name: '班級寵物列表', exact: true }).getByRole('article')).toHaveCount(0);
    await expect(page.getByText('找不到符合的學生，請嘗試其他姓名。', { exact: true })).toBeVisible();
  });

  test('a class-scoped teacher cannot find or mutate another class and a viewer has no interactive entry', async ({ page }) => {
    const { workspaceId, classId } = await seed('scoped-pet-hub', 2);
    const teacher = await inviteAccount(owner, workspaceId, testAccount('pet-hub-teacher'), 'teacher', [classId]);
    try {
      await openConsoleWithApiSession(page, teacher);
      await hub(page);
      await expect(page.locator('#pet-activity-class option')).toHaveCount(1);
      expect(await page.locator('body').innerHTML()).not.toContain('UNAUTHORIZED_CLASS_B_CANARY');
      await page.getByRole('searchbox').fill('UNAUTHORIZED_CLASS_B_CANARY');
      await expect(page.getByRole('article')).toHaveCount(0);
      await page.getByRole('searchbox').fill('');
      const writes: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/state') writes.push(request.postData() ?? '');
      });
      await performSyncedAction(page, () => page.getByRole('article').first().getByRole('button', { name: /餵食/ }).click());
      expect(writes.length).toBeGreaterThanOrEqual(1);
      for (const write of writes) {
        expect(JSON.parse(write).data.classes.map((item: { id: string }) => item.id)).toEqual([classId]);
        expect(write).not.toContain('UNAUTHORIZED_CLASS_B_CANARY');
      }
      expect((await teacher.loadState()).data?.classes.map((item) => item.id)).toEqual([classId]);
      expect((await owner.loadState(workspaceId)).data?.classes[1].students[0].points).toBe(555);
    } finally { await teacher.dispose(); }
    await page.context().clearCookies();
    const viewer = await inviteAccount(owner, workspaceId, testAccount('pet-hub-viewer'), 'viewer', [classId]);
    try {
      await openConsoleWithApiSession(page, viewer);
      await expect(page.getByRole('button', { name: '寵物活動', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /餵食|玩耍|升級|扭蛋/ })).toHaveCount(0);
      expect(await page.locator('body').innerHTML()).not.toContain('UNAUTHORIZED_CLASS_B_CANARY');
    } finally { await viewer.dispose(); }
  });

  test('the stable login layout stays inert until session and public protection policy have both loaded', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let posts = 0;
    page.on('request', (request) => { if (request.method() === 'POST') posts += 1; });
    await page.route('**/api/v1/health', async (route) => { await gate; await route.continue(); });
    try {
      await page.goto('/#/login');
      const form = page.locator('form');
      await expect(form).toHaveAttribute('inert', '');
      await expect(form.locator('button[type="submit"]')).toBeDisabled();
      const before = await page.locator('#auth-email').boundingBox();
      await form.evaluate((element) => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(posts).toBe(0);
      release();
      await expect(page.getByRole('button', { name: '登入並繼續帶班', exact: true })).toBeEnabled();
      await expect(form).not.toHaveAttribute('inert', '');
      const after = await page.locator('#auth-email').boundingBox();
      expect(after?.x).toBe(before?.x);
      expect(after?.y).toBe(before?.y);
    } finally { release(); }
  });
});
