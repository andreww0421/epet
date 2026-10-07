import { expect } from '@playwright/test';
import { browserApiRequest, loadBrowserState, performSyncedAction, selectDashboardTab, selectTeacherDestination } from '../e2e/support/fixtures';
import { scanAccessibility, STUDENT_NAME, test } from './fixtures';

test('Login: labels, errors, semantics and contrast', async ({ page }, info) => {
  await page.goto('/#/login');
  await expect(page.getByRole('button', { name: '登入並繼續帶班' })).toBeVisible();
  await scanAccessibility(page, info, 'login');
  await page.getByRole('button', { name: '登入並繼續帶班' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await scanAccessibility(page, info, 'login-validation');
});

test('Teacher Activities: populated pet cards and controls', async ({ teacherPage: page }, info) => {
  // Gameplay is retained in the teacher console, not on the public display.
  await selectTeacherDestination(page, 'Activities', '寵物');
  const hatch = page.getByRole('button', { name: /扭蛋/ });
  await expect(hatch).toBeVisible();
  await scanAccessibility(page, info, 'classroom-before-hatching');
  await hatch.focus();
  await expect(hatch).toBeFocused();
  await performSyncedAction(page, () => page.keyboard.press('Enter'));
  const petCard = page.getByRole('article').first();
  await expect(petCard).toHaveAccessibleName(/\*+/);
  await expect(petCard.getByRole('heading', { level: 2 })).toBeVisible();
  await expect(petCard.getByRole('progressbar', {
    name: '寵物飽食度',
  })).toHaveAttribute('aria-valuenow', '80');
  await expect(petCard.getByRole('progressbar', {
    name: '心情',
  })).toHaveAttribute('aria-valuenow', '80');
  await expect(page.getByRole('button', { name: /作業完成|補簽|不是上課日/ }).first()).toBeVisible();
  await scanAccessibility(page, info, 'classroom-with-pet');

  const teamAction = petCard.getByRole('button', { name: '建立隊伍' });
  await teamAction.focus();
  await expect(teamAction).toBeFocused();
  await page.keyboard.press('Enter');
  const teamDialog = page.getByRole('dialog', { name: '管理隊伍' });
  await expect(teamDialog).toBeVisible();
  await scanAccessibility(page, info, 'classroom-team-dialog');
  await teamDialog.getByRole('button', { name: '取消' }).click();

  await selectTeacherDestination(page, 'Activities', '對戰');
  const battleAction = petCard.getByRole('button', { name: '對戰', exact: true });
  await battleAction.focus();
  await expect(battleAction).toBeFocused();
  await page.keyboard.press('Enter');
  const battleDialog = page.getByRole('dialog', { name: '選擇對戰對手' });
  await expect(battleDialog).toBeVisible();
  await scanAccessibility(page, info, 'classroom-battle-dialog');
  await battleDialog.getByRole('button', { name: '取消' }).click();
});

test('Classroom presentation: read-only content and guarded keyboard exit', async ({ teacherPage: page }, info) => {
  // Deliberate policy choices in an isolated synthetic owner workspace cover
  // opt-in states too; real authentication, Origin and CSRF remain enforced.
  const response = await browserApiRequest(page.context(), '/api/v1/auth/session');
  expect(response.status()).toBe(200);
  const auth = await response.json() as { session: { activeWorkspaceId: string | null } };
  const workspaceId = auth.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Synthetic workspace is missing');
  const snapshot = await loadBrowserState(page.context(), workspaceId);
  if (!snapshot.data) throw new Error('Synthetic data is missing');
  const saved = await browserApiRequest(page.context(), '/api/v1/state', { method: 'PUT', workspaceId,
    body: { baseRevision: snapshot.revision, data: { ...snapshot.data,
      settings: { ...snapshot.data.settings!, inclusiveMode: false, publicNameMode: 'full', publicLeaderboardMode: 'rank' },
      classes: snapshot.data.classes.map((classData) => ({ ...classData, activeBoss: { id: 'synthetic-boss', name: 'Synthetic private title', isActive: true, maxHp: 100, currentHp: 80, contributions: {}, rewardTiers: [] } })),
    } },
  });
  expect(saved.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '展示大廳', exact: true }).click();
  await expect(page.getByRole('heading', { name: '寵物展示大廳' })).toBeVisible();
  await expect(page.getByRole('article').first()).toHaveAccessibleName(/\*+/);
  await expect(page.getByRole('button', { name: /扭蛋/ })).toHaveCount(0);
  await scanAccessibility(page, info, 'classroom-presentation');
  await page.getByRole('button', { name: '包容性排行榜', exact: true }).click();
  await scanAccessibility(page, info, 'presentation-inclusive-leaderboard');
  await page.getByRole('checkbox', { name: '包容性排行榜', exact: true }).uncheck();
  await expect(page.getByRole('table')).toBeVisible();
  await scanAccessibility(page, info, 'presentation-ranked-leaderboard');
  await page.getByRole('checkbox', { name: '包容性排行榜', exact: true }).check();
  await page.getByRole('checkbox', { name: '遮罩學生姓名', exact: true }).click();
  const names = page.getByRole('dialog', { name: '顯示完整學生姓名？' });
  await expect(names.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await scanAccessibility(page, info, 'presentation-name-confirmation');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('checkbox', { name: '遮罩學生姓名' })).toBeChecked();
  await page.setViewportSize({ width: 320, height: 812 });
  await scanAccessibility(page, info, 'classroom-presentation-mobile');
  const exit = page.getByRole('button', { name: '結束投影', exact: true });
  await exit.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '返回教師控制台？' });
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await scanAccessibility(page, info, 'presentation-exit-dialog');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '已停止投影，返回控制台' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(exit).toBeFocused();
  await expect(page.locator('[data-presentation-mode]')).toBeVisible();
});

test('Teacher Dashboard: students and rewards', async ({ teacherPage: page }, info) => {
  await scanAccessibility(page, info, 'dashboard-students');
  await selectDashboardTab(page, '獎勵');
  await expect(page.getByRole('row', { name: new RegExp(STUDENT_NAME) })).toBeVisible();
  await scanAccessibility(page, info, 'dashboard-rewards');
});

test('Teacher Console: Today overview and class/learning insights', async ({ teacherPage: page }, info) => {
  await selectTeacherDestination(page, 'Today');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await scanAccessibility(page, info, 'teacher-today');
  for (const name of ['給予積分', '扣除積分']) {
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog.getByLabel('回饋原因與積分', { exact: true })).toBeFocused();
    await scanAccessibility(page, info, name === '給予積分' ? 'today-give-preset' : 'today-deduct-preset');
    await dialog.getByRole('button', { name: '自訂積分', exact: true }).click();
    await scanAccessibility(page, info, name === '給予積分' ? 'today-give-custom' : 'today-deduct-custom');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
  }
  await selectTeacherDestination(page, 'Insights', '班級分析');
  await scanAccessibility(page, info, 'teacher-class-insights');
  await selectTeacherDestination(page, 'Insights', '學習趨勢');
  await scanAccessibility(page, info, 'teacher-learning-trends');
});

test('Student analytics: evidence form and populated records', async ({ teacherPage: page }, info) => {
  await selectTeacherDestination(page, 'Learning', '學習證據');
  const form = page.getByRole('heading', { name: '新增學習證據' }).locator('..');
  await form.getByLabel('證據摘要').fill('A11Y 已完成學習任務');
  await performSyncedAction(page, () => form.getByRole('button', { name: '儲存學習證據' }).click());
  await scanAccessibility(page, info, 'learning-evidence');
  await selectDashboardTab(page, '個人分析');
  await scanAccessibility(page, info, 'student-analytics');
});

test('Exam view: editor and saved exam', async ({ teacherPage: page }, info) => {
  await selectTeacherDestination(page, 'Learning', '考試分析');
  await page.getByLabel('考試名稱').fill('A11Y 測試考試');
  await page.locator('input[data-score-row="0"][data-score-column="0"]').fill('85');
  await scanAccessibility(page, info, 'exam-editor');
  await performSyncedAction(page, () => page.getByRole('button', { name: '保存考試' }).click());
  await scanAccessibility(page, info, 'exam-saved');
});

test('Settings: rules, calendar and workspace permissions', async ({ teacherPage: page }, info) => {
  await selectDashboardTab(page, '規則');
  await scanAccessibility(page, info, 'settings-rules');
  await selectTeacherDestination(page, 'Settings', '獎勵設定');
  await scanAccessibility(page, info, 'settings-rewards');
  await selectTeacherDestination(page, 'Settings', '工作區與使用者');
  await expect(page.getByRole('heading', { name: '工作區權限' })).toBeVisible();
  await scanAccessibility(page, info, 'settings');
});
