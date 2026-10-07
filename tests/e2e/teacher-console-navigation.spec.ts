import { expect, test, type Page } from '@playwright/test';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import { getPublicStudentName } from '../../src/studentPresentation';
import {
  E2eApiSession,
  E2E_BASE_URL,
  addStudentViaUi,
  browserApiRequest,
  inviteAccount,
  loadBrowserState,
  loginViaUi,
  openConsoleWithApiSession,
  performSyncedAction,
  selectTeacherDestination,
  testAccount,
} from './support/fixtures';

let consoleOwner: E2eApiSession;

const openOwnerConsole = async (page: Page, workspaceName: string) => {
  const created = await consoleOwner.createWorkspace(workspaceName);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Workspace is missing');
  await openConsoleWithApiSession(page, consoleOwner);
  return workspaceId;
};

const presentationNames = ['AlphaPrivateLearner', 'BetaPrivateLearner', 'GammaPrivateLearner'];
const privateDisplayCanaries = ['PRIVATE_MENTOR_NOTE', 'PRIVATE_REASON', 'PRIVATE_GOAL', 'PRIVATE_EVIDENCE', 'PRIVATE_EXAM', 'PRIVATE_EXAM_COMMENT', 'PRIVATE_BOSS_TITLE'];
const seedPresentationConsole = async (page: Page, hiddenLeaderboard = false) => {
  const workspaceId = await openOwnerConsole(page, 'PRIVATE_WORKSPACE_PRESENTATION');
  const snapshot = await consoleOwner.loadState(workspaceId);
  if (!snapshot.data) throw new Error('Workspace data is missing');
  const now = Date.now();
  const classData = snapshot.data.classes[0];
  const students = presentationNames.map((name, index) => ({
    ...createEnrolledStudent({ id: `presentation-${index}`, name }),
    points: 987,
    rankPoints: [10, 300, 20][index],
    warningPoints: 3,
    pet: { type: 'cat', level: index + 1, fullness: 80, happiness: 80 },
    penaltyStatus: { source: 'autoPenalty' as const, until: now + 60_000 },
    pointAdjustmentRecords: [{ id: `private-reason-${index}`, source: 'manual' as const, amount: -5, createdAt: now, reasonLabel: 'PRIVATE_REASON' }],
    dailyProgress: { streak: 0, reflections: [{ id: `private-note-${index}`, date: new Date(now).toISOString().slice(0, 10), createdAt: now, competency: 'growth' as const, author: 'mentor' as const, text: 'PRIVATE_MENTOR_NOTE' }] },
  }));
  await consoleOwner.saveState({ ...snapshot.data,
    settings: { ...snapshot.data.settings!, inclusiveMode: false, publicNameMode: 'full', publicLeaderboardMode: hiddenLeaderboard ? 'hidden' : 'rank' },
    classes: [{ ...classData, name: 'PRIVATE_CLASS_TITLE', students,
      classGoals: [{ id: 'private-goal', title: 'PRIVATE_GOAL', competency: 'growth', targetCount: 5, createdAt: now }],
      learningEvidenceRecords: [{ id: 'private-evidence', classId: classData.id, studentId: students[0].id, competency: 'growth', level: 'needsSupport', evidenceType: 'observation', title: 'PRIVATE_EVIDENCE', note: 'PRIVATE_MENTOR_NOTE', actor: 'mentor', source: 'manual', rubricVersion: 'v1', revision: 1, createdAt: now }],
      examRecords: [{ id: 'private-exam', title: 'PRIVATE_EXAM', examDate: new Date(now).toISOString().slice(0, 10), items: [{ id: 'item', name: 'PRIVATE_EXAM_ITEM', maxScore: 100 }], results: [{ studentId: students[0].id, scores: { item: 43 }, mentorComment: 'PRIVATE_EXAM_COMMENT', updatedAt: now }], createdAt: now, updatedAt: now }],
      activeBoss: { id: 'private-boss', name: 'PRIVATE_BOSS_TITLE', isActive: true, maxHp: 1000, currentHp: 800, rewardTiers: [], contributions: { [students[0].id]: 200 } },
    }],
  }, snapshot.revision, workspaceId);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  return workspaceId;
};

const enterPresentation = async (page: Page) => {
  await page.getByRole('button', { name: '展示大廳', exact: true }).click();
  await expect(page.getByRole('heading', { name: '寵物展示大廳', exact: true })).toBeVisible();
    await expect(page.locator('[data-presentation-mode="true"]')).toBeVisible();
};

test.describe('Teacher Console information architecture', () => {
  test.beforeAll(async () => {
    consoleOwner = await E2eApiSession.register(testAccount('console-feature-owner'));
  });
  test.afterAll(async () => { await consoleOwner.dispose(); });
  test('task areas are primary, Settings is secondary, and Today retains class context', async ({ context, page }, info) => {
    const workspaceId = await openOwnerConsole(page, 'console-primary');
    const navigation = page.getByRole('navigation', { name: 'Teacher Console', exact: true });
    const areas = ['Today', 'Class', 'Learning', 'Activities', 'Insights', 'Settings'];
    await expect(navigation.getByRole('button')).toHaveCount(6);
    for (const area of areas) {
      await expect(navigation.getByRole('button', { name: area, exact: true })).toBeVisible();
    }
    await expect(navigation.getByRole('button', { name: 'Today', exact: true }))
      .toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    const snapshot = await loadBrowserState(context, workspaceId);
    await expect(page.locator('#classSelect')).toHaveValue(snapshot.data?.currentClassId ?? '');
    const quickActions = page.getByRole('region', { name: '快速操作', exact: true });
    await expect(quickActions).toBeVisible();
    const desktopScreenshot = info.outputPath('teacher-console-desktop.png');
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    await info.attach('Teacher Console desktop', { path: desktopScreenshot, contentType: 'image/png' });
    for (const label of ['給予積分', '扣除積分', '新增評語', '新增學習證據', '建立／匯入考試', '開始課堂活動']) {
      const button = quickActions.getByRole('button', { name: label, exact: true });
      await expect(button).toBeVisible();
      if (label !== '開始課堂活動') await expect(button).toBeDisabled();
    }
    const destinations = [
      ['Class', '學生'],
      ['Learning', '學習證據'],
      ['Activities', '魔王管理'],
      ['Insights', '個人分析'],
      ['Settings', '規則'],
    ] as const;
    for (const [area, destination] of destinations) {
      await selectTeacherDestination(page, area, destination);
      await expect(navigation.getByRole('button', { name: area, exact: true }))
        .toHaveAttribute('aria-current', 'page');
      await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(page.getByRole('tab', { name: destination, exact: true }))
        .toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel', { name: destination, exact: true })).toBeVisible();
      await expect(page.locator('#classSelect')).toHaveValue(snapshot.data?.currentClassId ?? '');
      if (area === 'Class' || area === 'Activities' || area === 'Settings') {
        const screenshot = info.outputPath(`teacher-console-${area.toLowerCase()}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        await info.attach(`Teacher Console ${area}`, { path: screenshot, contentType: 'image/png' });
      }
    }
  });

  test('navigation fits a mobile viewport and supports keyboard activation', async ({ page }, info) => {
    await openOwnerConsole(page, 'console-mobile');
    await page.setViewportSize({ width: 375, height: 812 });
    const navigation = page.getByRole('navigation', { name: 'Teacher Console', exact: true });
    for (const area of ['Today', 'Class', 'Learning', 'Activities', 'Insights', 'Settings']) {
      const button = navigation.getByRole('button', { name: area, exact: true });
      await button.focus();
      await expect(button).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-current', 'page');
      await expect(button).toBeInViewport();
      const bounds = await navigation.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    }
    await selectTeacherDestination(page, 'Class', '學生');
    const students = page.getByRole('tab', { name: '學生', exact: true });
    await students.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: '分組', exact: true })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: '紀錄', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(students).toBeFocused();
    await expect(page.getByRole('tablist').locator('[tabindex="0"]')).toHaveCount(1);
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await selectTeacherDestination(page, 'Today');
    const mobileScreenshot = info.outputPath('teacher-console-mobile.png');
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    await info.attach('Teacher Console mobile', { path: mobileScreenshot, contentType: 'image/png' });
    await page.setViewportSize({ width: 320, height: 812 });
    for (const area of ['Today', 'Class', 'Learning', 'Activities', 'Insights', 'Settings']) {
      const button = navigation.getByRole('button', { name: area, exact: true });
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-current', 'page');
      await expect(button).toBeInViewport();
      const bounds = await navigation.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
  });

  test('evidence, assessment, goal and settings drafts survive destination changes without a write', async ({ context, page }) => {
    const workspaceId = await openOwnerConsole(page, 'console-drafts');
    await addStudentViaUi(page, 'E2E 導師導航學生');
    const baseline = await loadBrowserState(context, workspaceId);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/v1/state') && request.method() === 'PUT') {
        writes.push(request.headers()['x-epet-workspace']);
      }
    });
    await selectTeacherDestination(page, 'Learning', '學習證據');
    await page.getByLabel('證據摘要').fill('E2E 保留證據草稿');
    await selectTeacherDestination(page, 'Learning', '考試分析');
    await page.getByLabel('考試名稱').fill('E2E 保留考試草稿');
    await selectTeacherDestination(page, 'Learning', '本週學習目標');
    await page.getByLabel('目標名稱').fill('E2E 保留目標草稿');
    await selectTeacherDestination(page, 'Settings', '規則');
    await page.getByLabel('總積分上限').fill('850');
    await selectTeacherDestination(page, 'Today');
    await selectTeacherDestination(page, 'Learning', '學習證據');
    await expect(page.getByLabel('證據摘要')).toHaveValue('E2E 保留證據草稿');
    await selectTeacherDestination(page, 'Learning', '考試分析');
    await expect(page.getByLabel('考試名稱')).toHaveValue('E2E 保留考試草稿');
    await selectTeacherDestination(page, 'Learning', '本週學習目標');
    await expect(page.getByLabel('目標名稱')).toHaveValue('E2E 保留目標草稿');
    await selectTeacherDestination(page, 'Settings', '規則');
    await expect(page.getByLabel('總積分上限')).toHaveValue('850');
    expect(writes).toEqual([]);
    expect(await loadBrowserState(context, workspaceId)).toEqual(baseline);
  });

  test('reward configuration and full-data export remain available through secondary Settings', async ({ context, page }) => {
    const workspaceId = await openOwnerConsole(page, 'console-settings');
    await expect(page.getByRole('button', { name: '匯出 JSON', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toHaveCount(0);
    await selectTeacherDestination(page, 'Settings', '獎勵設定');
    await page.getByLabel('每生每日正向積分上限', { exact: true }).fill('45');
    await performSyncedAction(page, () => page.getByRole('button', {
      name: '儲存設定', exact: true,
    }).click());
    const snapshot = await loadBrowserState(context, workspaceId);
    expect(snapshot.data?.settings?.dailyPositivePointLimit).toBe(45);
    await selectTeacherDestination(page, 'Settings', '資料治理');
    await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeVisible();
    const exported = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/privacy/export' &&
      response.request().method() === 'GET',
    );
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '匯出 JSON', exact: true }).click();
    expect((await exported).status()).toBe(200);
    expect((await downloaded).suggestedFilename()).toMatch(/^epet_workspace_export_.*\.json$/);
    expect(await loadBrowserState(context, workspaceId)).toEqual(snapshot);
  });

  test('Class groups and embedded pet, battle and leaderboard activities reuse existing game interactions', async ({ context, page }) => {
    const workspaceId = await openOwnerConsole(page, 'console-game-interactions');
    const names = ['甲組隊學生', '乙組隊學生', '丙對戰學生'];
    for (const name of names) await addStudentViaUi(page, name);
    await selectTeacherDestination(page, 'Class', '分組');
    const groupButton = page.getByRole('button', { name: `管理隊伍：${names[0]}`, exact: true });
    await groupButton.focus();
    await page.keyboard.press('Enter');
    const teamDialog = page.getByRole('dialog', { name: '管理隊伍', exact: true });
    await expect(teamDialog).toBeVisible();
    await teamDialog.getByRole('button', { name: new RegExp(names[1]) }).click();
    await performSyncedAction(page, () => teamDialog.getByRole('button', { name: '儲存隊伍', exact: true }).click());
    await expect(teamDialog).not.toBeVisible();
    await expect(groupButton).toBeFocused();
    let snapshot = await loadBrowserState(context, workspaceId);
    let students = snapshot.data?.classes[0]?.students ?? [];
    const first = students.find((student) => student.name === names[0]);
    const second = students.find((student) => student.name === names[1]);
    expect(first?.teamId).toBeTruthy();
    expect(second?.teamId).toBe(first?.teamId);

    await selectTeacherDestination(page, 'Activities', '寵物');
    for (let index = 0; index < names.length; index += 1) {
      await performSyncedAction(page, () => page.getByRole('button', { name: '扭蛋 (-200)', exact: true }).first().click());
    }
    await expect(page.getByRole('article')).toHaveCount(3);
    await expect(page.getByRole('article').first()).toHaveAccessibleName(/\*/);
    snapshot = await loadBrowserState(context, workspaceId);
    students = snapshot.data?.classes[0]?.students ?? [];
    expect(students.every((student) => student.pet.type !== 'egg')).toBe(true);

    await selectTeacherDestination(page, 'Activities', '對戰');
    await page.getByRole('article').first().getByRole('button', { name: '對戰', exact: true }).click();
    const battleDialog = page.getByRole('dialog', { name: '選擇對戰對手', exact: true });
    await expect(battleDialog).toBeVisible();
    const opponents = battleDialog.getByRole('button').and(battleDialog.locator('[aria-pressed]'));
    await expect(opponents).toHaveCount(1);
    await opponents.click();
    await expect(opponents).toHaveAttribute('aria-pressed', 'true');
    await performSyncedAction(page, () => battleDialog.getByRole('button', { name: '開始對戰', exact: true }).click());
    await expect(battleDialog).not.toBeVisible();
    const afterBattle = await loadBrowserState(context, workspaceId);
    const updatedStudents = afterBattle.data?.classes[0]?.students ?? [];
    const participants = [names[0], names[2]].map((name) => {
      const before = students.find((student) => student.name === name);
      const after = updatedStudents.find((student) => student.name === name);
      if (!before || !after) throw new Error('Battle participant is missing');
      expect(after.pet.fullness).toBe(before.pet.fullness - 50);
      return {
        wins: (after.stats?.wins ?? 0) - (before.stats?.wins ?? 0),
        losses: (after.stats?.losses ?? 0) - (before.stats?.losses ?? 0),
      };
    });
    // Equal random rolls are an existing valid draw: resources are consumed,
    // but wins/losses stay unchanged for both participants.
    expect([
      [{ wins: 0, losses: 0 }, { wins: 0, losses: 0 }],
      [{ wins: 1, losses: 0 }, { wins: 0, losses: 1 }],
      [{ wins: 0, losses: 1 }, { wins: 1, losses: 0 }],
    ]).toContainEqual(participants);
    expect(updatedStudents.find((student) => student.name === names[1])?.pet.fullness)
      .toBe(students.find((student) => student.name === names[1])?.pet.fullness);
    await selectTeacherDestination(page, 'Activities', '排行榜');
    await expect(page.getByText('目前隱私設定已隱藏個人排行榜。', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '近 7 日學習證據', exact: true })).toHaveCount(0);
    await page.getByRole('navigation', { name: '排行榜檢視', exact: true })
      .getByRole('button', { name: '隊伍排行榜', exact: true }).click();
    await expect(page.getByRole('heading', { name: '隊伍排行榜', exact: true })).toBeVisible();

    // Opt in through the existing settings UI; never relax the default privacy
    // policy merely to make a leaderboard assertion pass.
    await selectTeacherDestination(page, 'Settings', '規則');
    await page.getByRole('switch', { name: '包容性模式', exact: true }).click();
    await selectTeacherDestination(page, 'Settings', '資料治理');
    await page.getByLabel('公開榮譽榜', { exact: true }).selectOption('growth');
    await performSyncedAction(page, () => page.getByRole('button', { name: '儲存設定', exact: true }).click());
    expect((await loadBrowserState(context, workspaceId)).data?.settings?.publicLeaderboardMode).toBe('growth');
    expect((await loadBrowserState(context, workspaceId)).data?.settings?.publicNameMode).toBe('masked');
    await selectTeacherDestination(page, 'Activities', '排行榜');
    await page.getByRole('navigation', { name: '排行榜檢視', exact: true })
      .getByRole('button', { name: '近 7 日學習證據', exact: true }).click();
    await expect(page.getByRole('heading', { name: '近 7 日學習證據', exact: true })).toBeVisible();
    const learningLeaderboard = page.locator('section').filter({
      has: page.getByRole('heading', { name: '近 7 日學習證據', exact: true }),
    });
    await expect(learningLeaderboard.getByRole('table').getByRole('row')).toHaveCount(4);
    await page.getByRole('navigation', { name: '排行榜檢視', exact: true })
      .getByRole('button', { name: '隊伍排行榜', exact: true }).click();
    await expect(page.getByRole('heading', { name: '隊伍排行榜', exact: true })).toBeVisible();
  });

  test('Today opens the canonical give/deduct dialog in one action and preserves required reasons and focus', async ({ context, page }) => {
    const workspaceId = await openOwnerConsole(page, 'today-points');
    const studentName = 'E2E Today 積分學生';
    await addStudentViaUi(page, studentName);
    await selectTeacherDestination(page, 'Today');
    const quick = page.getByRole('region', { name: '快速操作', exact: true });
    for (const [label, amount, signedAmount] of [['給予積分', '8', 8], ['扣除積分', '3', -3]] as const) {
      const trigger = quick.getByRole('button', { name: label, exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: label, exact: true });
      await dialog.getByRole('button', { name: '自訂積分', exact: true }).click();
      await expect(dialog.getByLabel('選擇學生', { exact: true })).toBeFocused();
      await expect(dialog.getByRole('button', { name: '確認調整', exact: true })).toBeDisabled();
      await dialog.getByLabel('選擇學生', { exact: true }).selectOption({ label: studentName });
      await dialog.getByLabel('積分數量', { exact: true }).fill(amount);
      await expect(dialog.getByRole('button', { name: '確認調整', exact: true })).toBeDisabled();
      await dialog.getByLabel('具體回饋原因（必填）').fill(`E2E Today ${label}`);
      await performSyncedAction(page, () => dialog.getByRole('button', { name: '確認調整', exact: true }).click());
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
      const snapshot = await loadBrowserState(context, workspaceId);
      const student = snapshot.data?.classes[0]?.students.find((item) => item.name === studentName);
      const manualRecord = student?.pointAdjustmentRecords?.find((record) => record.reasonLabel === `E2E Today ${label}`);
      expect(manualRecord?.amount).toBe(signedAmount);
      expect(manualRecord?.source).toBe('manual');
    }
    const finalState = await loadBrowserState(context, workspaceId);
    const adjustedStudent = finalState.data?.classes[0]?.students[0];
    expect(adjustedStudent?.pointAdjustmentRecords?.some((record) => record.source === 'participationTopUp')).toBe(true);
    expect(adjustedStudent?.points).toBe(200 + (adjustedStudent?.pointAdjustmentRecords ?? []).reduce((total, record) => total + record.amount, 0));
    // Default configured shortcuts take exactly two clicks, retaining reason, competency and guardrails.
    for (const label of ['給予積分', '扣除積分']) {
      await quick.getByRole('button', { name: label, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: label, exact: true });
      const presetId = await dialog.getByLabel('回饋原因與積分', { exact: true }).inputValue();
      await performSyncedAction(page, () => dialog.getByRole('group', { name: '套用至學生', exact: true }).getByRole('button', { name: studentName, exact: true }).click());
      await expect(dialog).not.toBeVisible();
      const updated = await loadBrowserState(context, workspaceId);
      const record = updated.data?.classes[0]?.students[0]?.pointAdjustmentRecords?.find((record) => record.reasonId === presetId && record.source === 'quick');
      expect(record?.source).toBe('quick');
      expect(record?.reasonId).toBe(presetId);
      expect(record?.amount && Math.sign(record.amount)).toBe(label === '給予積分' ? 1 : -1);
      await expect(page.getByRole('region', { name: '最近活動', exact: true }).getByRole('button', { name: '積分變更', exact: true })).toHaveCount(label === '給予積分' ? 4 : 5);
    }
  });

  test('Today learning, comment, exam and activity actions reach existing editors with current class context', async ({ context, page }) => {
    const workspaceId = await openOwnerConsole(page, 'today-learning');
    const studentName = 'E2E Today 學習學生';
    await addStudentViaUi(page, studentName);
    await selectTeacherDestination(page, 'Today');
    await expect(page.getByText('目前工作區', { exact: true }).locator('..').getByText('today-learning', { exact: true })).toBeVisible();
    await page.getByRole('region', { name: '快速操作', exact: true }).getByRole('button', { name: '新增評語', exact: true }).click();
    await expect(page.getByRole('tab', { name: '每日評語', exact: true })).toHaveAttribute('aria-selected', 'true');
    const comments = page.locator('section').filter({ has: page.getByRole('heading', { name: '導師每日評語', exact: true }) });
    await comments.getByLabel('學生').selectOption({ label: studentName });
    await comments.getByLabel('每日評語（必填）').fill('E2E Today 課堂追蹤');
    await performSyncedAction(page, () => comments.getByRole('button', { name: '儲存每日評語', exact: true }).click());

    await selectTeacherDestination(page, 'Today');
    await page.getByRole('region', { name: '快速操作', exact: true }).getByRole('button', { name: '新增學習證據', exact: true }).click();
    await expect(page.getByRole('tab', { name: '學習證據', exact: true })).toHaveAttribute('aria-selected', 'true');
    const evidenceForm = page.getByRole('heading', { name: '新增學習證據', exact: true }).locator('..');
    await evidenceForm.getByLabel('證據層級').selectOption('needsSupport');
    await evidenceForm.getByLabel('證據摘要').fill('E2E Today 需追蹤的觀察');
    await performSyncedAction(page, () => evidenceForm.getByRole('button', { name: '儲存學習證據', exact: true }).click());

    await selectTeacherDestination(page, 'Today');
    await page.getByRole('region', { name: '快速操作', exact: true }).getByRole('button', { name: '建立／匯入考試', exact: true }).click();
    await expect(page.getByRole('tab', { name: '考試分析', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('考試名稱').fill('E2E Today 評量');
    await page.locator('input[data-score-row="0"][data-score-column="0"]').fill('85');
    await performSyncedAction(page, () => page.getByRole('button', { name: '保存考試', exact: true }).click());

    await selectTeacherDestination(page, 'Today');
    const summary = page.getByRole('region', { name: '今日摘要', exact: true });
    await expect(summary.getByText('學生人數', { exact: true }).locator('..').locator('dd')).toHaveText('1');
    await expect(summary.getByText('需要關注的學生', { exact: true }).locator('..').locator('dd')).toHaveText('1');
    await expect(summary.getByText('今日學習證據', { exact: true }).locator('..').locator('dd')).toHaveText('2');
    await expect(summary.getByText('今日考試活動', { exact: true }).locator('..').locator('dd')).toHaveText('1');
    await expect(summary.getByText('待補導師評語', { exact: true }).locator('..').locator('dd')).toHaveText('0');
    const recent = page.getByRole('region', { name: '最近活動', exact: true });
    for (const name of ['每日評語', '學習證據', '考試更新']) await expect(recent.getByRole('button', { name, exact: true })).toHaveCount(name === '學習證據' ? 2 : 1);
    await page.getByRole('region', { name: '快速操作', exact: true }).getByRole('button', { name: '開始課堂活動', exact: true }).click();
    await expect(page.getByRole('tab', { name: '寵物', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: '扭蛋 (-200)', exact: true })).toBeVisible();
    const snapshot = await loadBrowserState(context, workspaceId);
    expect(snapshot.data?.classes[0]?.examRecords?.[0]?.title).toBe('E2E Today 評量');
  });

  test('Today concentration and attention reminders are actionable, responsive and keyboard accessible', async ({ page }, info) => {
    await openOwnerConsole(page, 'today-attention');
    const studentName = 'E2E Today 追蹤學生';
    await addStudentViaUi(page, studentName);
    await selectTeacherDestination(page, 'Today');
    for (let index = 0; index < 3; index += 1) {
      await page.getByRole('button', { name: '扣除積分', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '扣除積分', exact: true });
      await dialog.getByRole('button', { name: '自訂積分', exact: true }).click();
      await dialog.getByLabel('選擇學生', { exact: true }).selectOption({ label: studentName });
      await dialog.getByLabel('積分數量', { exact: true }).fill('1');
      await dialog.getByLabel('具體回饋原因（必填）').fill(`E2E Today 追蹤 ${index + 1}`);
      await performSyncedAction(page, () => dialog.getByRole('button', { name: '確認調整', exact: true }).click());
    }
    await expect(page.getByRole('heading', { name: '負向回饋集中提醒', exact: true })).toBeVisible();
    const alerts = page.getByRole('region', { name: '需要留意', exact: true });
    await expect(alerts).toContainText('今日只有負向積分回饋');
    await expect(alerts.getByText(studentName, { exact: true })).toBeVisible();
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const give = page.getByRole('button', { name: '給予積分', exact: true });
      await give.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '給予積分', exact: true });
      await expect(dialog).toBeInViewport();
      await expect(dialog.getByLabel('回饋原因與積分', { exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(give).toBeFocused();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const screenshot = info.outputPath('teacher-today-populated.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach('Teacher Today populated', { path: screenshot, contentType: 'image/png' });
    await alerts.getByRole('button', { name: '檢視積分紀錄', exact: true }).click();
    await expect(page.getByRole('tab', { name: '紀錄', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: '加減分記錄', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('read-only role sees review destinations but no mutation areas or settings', async ({ browser }) => {
    const owner = consoleOwner;
    const created = await owner.createWorkspace('console-viewer-reports');
    const workspaceId = created.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Workspace is missing');
    const state = await owner.loadState(workspaceId);
    const classId = state.data?.classes[0]?.id;
    if (!classId) throw new Error('Class is missing');
    const ownerContext = await browser.newContext({ baseURL: E2E_BASE_URL });
    const ownerPage = await ownerContext.newPage();
    try {
      await openConsoleWithApiSession(ownerPage, owner);
      await addStudentViaUi(ownerPage, 'E2E 唯讀報告學生');
      await selectTeacherDestination(ownerPage, 'Learning', '考試分析');
      await ownerPage.getByLabel('考試名稱').fill('E2E 已保存唯讀考試');
      await ownerPage.locator('input[data-score-row="0"][data-score-column="0"]').fill('85');
      await performSyncedAction(ownerPage, () => ownerPage.getByRole('button', { name: '保存考試', exact: true }).click());
    } finally {
      await ownerContext.close();
    }
    const viewerAccount = testAccount('console-viewer');
    const viewer = await inviteAccount(owner, workspaceId, viewerAccount, 'viewer', [classId]);
    await viewer.dispose();
    const context = await browser.newContext({ baseURL: E2E_BASE_URL });
    const page = await context.newPage();
    try {
      await loginViaUi(page, viewerAccount);
      await expect(page.getByRole('region', { name: '快速操作', exact: true }).getByRole('button')).toHaveCount(3);
      await expect(page.getByRole('button', { name: '給予積分', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '扣除積分', exact: true })).toHaveCount(0);
      const navigation = page.getByRole('navigation', { name: 'Teacher Console', exact: true });
      for (const area of ['Today', 'Class', 'Learning', 'Insights']) {
        await expect(navigation.getByRole('button', { name: area, exact: true })).toBeVisible();
      }
      await expect(navigation.getByRole('button', { name: 'Activities', exact: true })).toHaveCount(0);
      await expect(navigation.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
      await selectTeacherDestination(page, 'Class', '紀錄');
      await expect(page.getByRole('tab', { name: '學生', exact: true })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: '獎勵', exact: true })).toHaveCount(0);
      await selectTeacherDestination(page, 'Learning', '每週回饋報告');
      await expect(page.getByRole('button', { name: '保存考試', exact: true })).toHaveCount(0);
      await selectTeacherDestination(page, 'Learning', '考試分析');
      await expect(page.getByRole('heading', { name: '考試趨勢與個別報告', exact: true })).toBeVisible();
      await expect(page.getByLabel('考試名稱')).toHaveValue('E2E 已保存唯讀考試');
      await expect(page.getByLabel('考試名稱')).toHaveJSProperty('readOnly', true);
      await expect(page.locator('input[data-score-row="0"][data-score-column="0"]')).toHaveValue('85');
      await expect(page.locator('input[data-score-row="0"][data-score-column="0"]')).toHaveJSProperty('readOnly', true);
      await expect(page.getByRole('button', { name: '保存考試', exact: true })).toHaveCount(0);
      const snapshot = await loadBrowserState(context, workspaceId);
      const denied = await browserApiRequest(context, '/api/v1/state', {
        method: 'PUT', workspaceId,
        body: { data: snapshot.data, baseRevision: snapshot.revision },
      });
      expect(denied.status()).toBe(403);
      expect(await loadBrowserState(context, workspaceId)).toEqual(snapshot);
    } finally {
      await context.close();
    }
  });

  test('presentation allowlist excludes private records, raw names, overlays and teacher navigation without mutating game data', async ({ page, context }) => {
    const workspaceId = await seedPresentationConsole(page);
    // Leave a real teacher-generated raw-name toast active when switching.
    await addStudentViaUi(page, 'DeltaPrivateLearner');
    const before = await loadBrowserState(context, workspaceId);
    await enterPresentation(page);
    await expect(page.getByText('投影模式', { exact: true })).toBeFocused();
    const rendered = await page.locator('body').innerHTML();
    for (const canary of [...privateDisplayCanaries, ...presentationNames, 'DeltaPrivateLearner', 'PRIVATE_WORKSPACE_PRESENTATION', 'PRIVATE_CLASS_TITLE', consoleOwner.account.displayName]) {
      expect(rendered).not.toContain(canary);
    }
    await expect(page.getByRole('article')).toHaveCount(4);
    await expect(page.getByRole('article').first()).toHaveAccessibleName(getPublicStudentName(presentationNames[0]));
    await expect(page.getByRole('navigation', { name: 'Teacher Console', exact: true })).toHaveCount(0);
    for (const name of ['教師控制台', '登出', '下载本機草稿', '下載本機草稿', '扭蛋 (-200)', '對戰', '建立隊伍']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: '遮罩學生姓名' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: '包容性排行榜' })).toBeChecked();
    await page.getByRole('button', { name: '包容性排行榜', exact: true }).click();
    const inclusive = page.getByRole('region', { name: '包容性排行榜', exact: true });
    await expect(inclusive.getByRole('listitem')).toHaveCount(4);
    const displayedNames = await inclusive.locator('li p:first-child').allTextContents();
    expect(displayedNames).toEqual([...presentationNames, 'DeltaPrivateLearner'].map((name) => getPublicStudentName(name)));
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText(/RP/)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await loadBrowserState(context, workspaceId)).toEqual(before);
    // Guard stores only a constant flag, not identities or display preferences.
    expect(await page.evaluate(() => sessionStorage.getItem('epet.presentation.active'))).toBe('1');
  });

  test('presentation options respect workspace privacy; full names need confirmation and reset on reload', async ({ page }) => {
    await seedPresentationConsole(page, true);
    await enterPresentation(page);
    await expect(page.getByRole('button', { name: '包容性排行榜', exact: true })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: '包容性排行榜' })).toBeDisabled();
    const mask = page.getByRole('checkbox', { name: '遮罩學生姓名' });
    await mask.click();
    const namesDialog = page.getByRole('dialog', { name: '顯示完整學生姓名？' });
    await expect(namesDialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    expect(await page.locator('body').innerHTML()).not.toContain(presentationNames[0]);
    await page.keyboard.press('Escape');
    await expect(mask).toBeChecked();
    await expect(mask).toBeFocused();
    await mask.click();
    await namesDialog.getByRole('button', { name: '確認顯示完整姓名' }).click();
    await expect(page.getByRole('article').first()).toHaveAccessibleName(presentationNames[0]);
    await page.reload();
    await expect(page.getByRole('heading', { name: '寵物展示大廳' })).toBeVisible();
    await expect(mask).toBeChecked();
    await expect(page.getByRole('article').first()).toHaveAccessibleName(getPublicStudentName(presentationNames[0]));
    await page.setViewportSize({ width: 320, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('fullscreen rejection, fullscreen exit, hash navigation and Escape never open private pages; exit requires confirmation', async ({ page }) => {
    await seedPresentationConsole(page);
    await enterPresentation(page);
    // Rejection is deterministic and must not disable the privacy guard.
    await page.evaluate(() => { document.querySelector<HTMLElement>('[data-presentation-mode]')!.requestFullscreen = () => Promise.reject(new Error('Synthetic fullscreen rejection')); });
    await page.getByRole('button', { name: '全螢幕投影', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('仍保持投影模式');
    await expect(page.getByRole('navigation', { name: 'Teacher Console' })).toHaveCount(0);
    await page.evaluate(() => { delete (document.querySelector<HTMLElement>('[data-presentation-mode]')! as Partial<HTMLElement>).requestFullscreen; });
    await page.getByRole('button', { name: '全螢幕投影', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.evaluate(() => { document.exitFullscreen = () => Promise.reject(new Error('Synthetic fullscreen exit rejection')); });
    await page.getByRole('button', { name: '結束投影', exact: true }).click();
    const fullscreenExitDialog = page.getByRole('dialog', { name: '返回教師控制台？' });
    await fullscreenExitDialog.getByRole('button', { name: '已停止投影，返回控制台' }).click();
    await expect(fullscreenExitDialog).toBeVisible();
    await expect(fullscreenExitDialog.getByRole('alert')).toContainText('仍保持投影模式');
    await expect(page.getByRole('navigation', { name: 'Teacher Console' })).toHaveCount(0);
    await page.evaluate(() => { delete (document as Partial<Document>).exitFullscreen; });
    await fullscreenExitDialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '離開全螢幕', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.location.hash = '#/login'; });
    await expect(page.locator('[data-presentation-mode]')).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: '寵物展示大廳' })).toBeVisible();
    const exit = page.getByRole('button', { name: '結束投影', exact: true });
    await exit.click();
    const exitDialog = page.getByRole('dialog', { name: '返回教師控制台？' });
    await expect(exitDialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(exit).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Teacher Console' })).toHaveCount(0);
    await exit.click();
    await exitDialog.getByRole('button', { name: '已停止投影，返回控制台' }).click();
    await expect(page.getByRole('navigation', { name: 'Teacher Console' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('epet.presentation.active'))).toBeNull();
  });

  test('presentation URL guard survives reload and back navigation when browser session storage is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => { throw new Error('Synthetic storage denial'); } });
    });
    await seedPresentationConsole(page);
    await enterPresentation(page);
    await page.evaluate(() => { location.hash = '#/login'; });
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/presentation');
    await page.reload();
    await expect(page.getByRole('heading', { name: '寵物展示大廳' })).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-presentation-mode]')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Teacher Console' })).toHaveCount(0);
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  });

  test('lost authentication or workspace access pauses projection instead of showing cached student data or sign-in forms', async ({ page, context }) => {
    await seedPresentationConsole(page);
    await enterPresentation(page);
    await page.route('**/api/v1/state', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Forbidden' }) }));
    await page.reload();
    await expect(page.getByRole('heading', { name: '投影已暫停' })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '下載本機草稿' })).toHaveCount(0);
    await page.unroute('**/api/v1/state');
    await context.clearCookies();
    await page.reload();
    await expect(page.getByRole('heading', { name: '投影已暫停' })).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Teacher Console' })).toHaveCount(0);
    await page.getByRole('button', { name: '結束投影', exact: true }).click();
    await page.getByRole('button', { name: '已停止投影，返回控制台' }).click();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  });
});
