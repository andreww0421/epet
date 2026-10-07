import { expect, test, type Page } from '@playwright/test';
import {
  E2eApiSession,
  addStudentViaUi,
  loadBrowserState,
  loginViaUi,
  performSyncedAction,
  selectDashboardTab,
  selectTeacherDestination,
  switchWorkspaceViaUi,
  testAccount,
} from './support/fixtures';

let featureOwner: E2eApiSession;

const openOwnerDashboard = async (page: Page, workspaceName: string) => {
  const created = await featureOwner.createWorkspace(workspaceName);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Workspace is missing');
  await loginViaUi(page, featureOwner.account);
  await switchWorkspaceViaUi(page, workspaceId);
  // Session/workspace switches start at Today; the Console button is a safe no-op here.
  await page.getByRole('button', { name: '導師控制台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '導師控制台' })).toBeVisible();
  return workspaceId;
};

test.describe('Dashboard feature wiring', () => {
  // Keep each test's data isolated without increasing production registration
  // quotas to accommodate the larger regression suite.
  test.beforeAll(async () => {
    featureOwner = await E2eApiSession.register(testAccount('dashboard-feature-owner'));
  });
  test.afterAll(async () => { await featureOwner.dispose(); });
  test('weekly goal, settings, and boss creation persist across feature tabs', async ({
    context,
    page,
  }) => {
    const workspaceId = await openOwnerDashboard(page, 'dashboard-features');
    const goalTitle = 'E2E 每週合作目標';
    const bossName = 'E2E 協作魔王';

    await selectDashboardTab(page, '活動');
    const goalSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: '班級學習目標' }),
    });
    await goalSection.getByLabel('目標名稱').fill(goalTitle);
    await goalSection.getByLabel('聚焦能力').selectOption('collaboration');
    await goalSection.getByLabel('目標回饋次數').fill('4');
    await performSyncedAction(page, () => goalSection.getByRole('button', {
      name: '新增目標',
    }).click());
    await expect(goalSection.getByText(goalTitle, { exact: true })).toBeVisible();

    await selectDashboardTab(page, '規則');
    await page.getByLabel('總積分上限').fill('850');
    await performSyncedAction(page, () => page.getByRole('button', {
      name: '儲存設定',
    }).click());
    await expect(page.getByText('設定已儲存', { exact: true })).toBeVisible();

    await selectDashboardTab(page, '活動');
    await expect(goalSection.getByText(goalTitle, { exact: true })).toBeVisible();
    await selectTeacherDestination(page, 'Activities', '魔王管理');
    const bossSection = page.getByRole('heading', {
      name: '魔王副本管理',
    }).locator('..');
    await bossSection.getByText('魔王名稱', { exact: true })
      .locator('..').locator('input').fill(bossName);
    await bossSection.getByText('血量 (Max HP)', { exact: true })
      .locator('..').locator('input').fill('321');
    await performSyncedAction(page, () => bossSection.getByRole('button', {
      name: '召喚魔王',
    }).click());
    await expect(bossSection.getByRole('heading', {
      name: bossName,
      exact: true,
    })).toBeVisible();

    const saved = await loadBrowserState(context, workspaceId);
    const currentClass = saved.data?.classes.find(
      (classroom) => classroom.id === saved.data?.currentClassId,
    );
    expect(saved.data?.settings?.maxPoints).toBe(850);
    expect(currentClass?.classGoals).toContainEqual(expect.objectContaining({
      title: goalTitle,
      competency: 'collaboration',
      targetCount: 4,
    }));
    expect(currentClass?.activeBoss).toEqual(expect.objectContaining({
      name: bossName,
      maxHp: 321,
      currentHp: 321,
      isActive: true,
    }));

    await page.getByRole('button', { name: '展示大廳', exact: true }).click();
    // Freeform educational/boss titles remain private; only game health is projected.
    await expect(page.getByText(goalTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: bossName, exact: true })).toHaveCount(0);
    await expect(page.getByRole('progressbar', { name: '魔王生命值' })).toHaveAttribute('aria-valuenow', '321');
    await expect(page.getByRole('progressbar', { name: '魔王生命值' })).toHaveAttribute('aria-valuemax', '321');
    await page.getByRole('button', { name: '結束投影', exact: true }).click();
    await page.getByRole('button', { name: '已停止投影，返回控制台' }).click();
    await selectDashboardTab(page, '活動');
    await expect(goalSection.getByText(goalTitle, { exact: true })).toBeVisible();
  });

  test('class point adjustment reaches every student and can be undone', async ({
    context,
    page,
  }) => {
    const workspaceId = await openOwnerDashboard(page, 'dashboard-airdrop');
    const studentNames = ['甲空投學生', '乙空投學生'];
    for (const studentName of studentNames) {
      await addStudentViaUi(page, studentName);
    }

    await selectDashboardTab(page, '獎勵');
    await page.getByRole('button', { name: '全體空投' }).click();
    const dialog = page.getByRole('dialog', { name: '全體積分空投' });
    await dialog.getByLabel('獎懲積分').fill('25');
    await dialog.getByLabel('具體回饋原因（必填）').fill('E2E 全班完成合作任務');
    await performSyncedAction(page, () => dialog.getByRole('button', {
      name: '確認發放',
    }).click());

    for (const studentName of studentNames) {
      await expect(page.getByRole('row', {
        name: new RegExp(studentName),
      })).toContainText('225 / 700');
    }

    let saved = await loadBrowserState(context, workspaceId);
    let adjustedStudents = saved.data?.classes[0]?.students.filter(
      (student) => studentNames.includes(student.name),
    ) ?? [];
    expect(adjustedStudents).toHaveLength(2);
    expect(adjustedStudents.every((student) => student.points === 225)).toBe(true);
    expect(adjustedStudents.every((student) => student.pointAdjustmentRecords?.some(
      (record) => record.source === 'airdrop' &&
        record.amount === 25 &&
        record.reasonLabel === 'E2E 全班完成合作任務',
    ))).toBe(true);

    await expect(page.getByText('已完成全班積分空投', { exact: true })).toBeVisible();
    await performSyncedAction(page, () => page.getByRole('button', {
      name: '復原',
      exact: true,
    }).click());

    saved = await loadBrowserState(context, workspaceId);
    adjustedStudents = saved.data?.classes[0]?.students.filter(
      (student) => studentNames.includes(student.name),
    ) ?? [];
    expect(adjustedStudents.every((student) => student.points === 200)).toBe(true);

    // The same gameplay assertions now run in the explicitly private Activities area.
    await selectTeacherDestination(page, 'Activities', '寵物');
    await expect(page.getByRole('tab', { name: '寵物', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('甲***', { exact: true }).first()).toBeVisible();

    for (let index = 0; index < studentNames.length; index += 1) {
      const hatch = page.getByRole('button', { name: /扭蛋/ }).first();
      await performSyncedAction(page, () => hatch.click());
    }

    const firstPetCard = page.getByRole('article', { name: '甲***' });
    await expect(firstPetCard.getByRole('heading', {
      name: '甲***',
      level: 2,
    })).toBeVisible();
    await expect(firstPetCard.getByRole('progressbar', {
      name: '寵物飽食度',
    })).toHaveAttribute('aria-valuenow', '80');
    await expect(firstPetCard.getByRole('progressbar', {
      name: '心情',
    })).toHaveAttribute('aria-valuenow', '80');

    await firstPetCard.getByRole('button', { name: '對戰', exact: true }).click();
    const battleDialog = page.getByRole('dialog', { name: '選擇對戰對手' });
    await battleDialog.getByRole('button', { name: /乙\*\*\*/ }).click();
    await performSyncedAction(page, () =>
      battleDialog.getByRole('button', { name: '開始對戰' }).click());

    await firstPetCard.getByRole('button', { name: '建立隊伍' }).click();
    const teamDialog = page.getByRole('dialog', { name: '管理隊伍' });
    await teamDialog.getByRole('button', { name: /乙\*\*\*/ }).click();
    await performSyncedAction(page, () =>
      teamDialog.getByRole('button', { name: '儲存隊伍' }).click());

    saved = await loadBrowserState(context, workspaceId);
    adjustedStudents = saved.data?.classes[0]?.students.filter(
      (student) => studentNames.includes(student.name),
    ) ?? [];
    expect(adjustedStudents).toHaveLength(2);
    const battleCounts = adjustedStudents.map((student) =>
      (student.stats?.wins ?? 0) + (student.stats?.losses ?? 0));
    expect(new Set(battleCounts).size).toBe(1);
    expect([0, 1]).toContain(battleCounts[0]);
    expect(adjustedStudents.every((student) => student.pet.fullness === 30)).toBe(true);
    if (battleCounts[0] === 0) {
      // Equal random rolls are a valid draw: resources change, but win/loss stats do not.
      expect(adjustedStudents.every((student) => student.pet.happiness === 75)).toBe(true);
    } else {
      expect(adjustedStudents.reduce(
        (total, student) => total + (student.stats?.wins ?? 0),
        0,
      )).toBe(1);
      expect(adjustedStudents.reduce(
        (total, student) => total + (student.stats?.losses ?? 0),
        0,
      )).toBe(1);
    }
    expect(adjustedStudents[0]?.teamId).toBeTruthy();
    expect(adjustedStudents[1]?.teamId).toBe(adjustedStudents[0]?.teamId);

    await selectTeacherDestination(page, 'Activities', '排行榜');
    const teamLeaderboardButton = page.getByRole('button', { name: '隊伍排行榜', exact: true });
    await teamLeaderboardButton.click();
    await expect(teamLeaderboardButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('row', { name: /甲\*\*\* \/ 乙\*\*\*/ })).toBeVisible();
  });
});
