import { expect } from '@playwright/test';
import { performSyncedAction, selectDashboardTab } from '../e2e/support/fixtures';
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

test('Classroom: populated pet cards and controls', async ({ teacherPage: page }, info) => {
  await page.getByRole('button', { name: '展示大廳', exact: true }).click();
  await expect(page.getByRole('heading', { name: '寵物展示大廳' })).toBeVisible();
  // Public classroom names remain masked; never change privacy settings for a scan.
  const hatch = page.getByRole('button', { name: /扭蛋/ });
  await expect(hatch).toBeVisible();
  await scanAccessibility(page, info, 'classroom-before-hatching');
  await performSyncedAction(page, () => hatch.click());
  await expect(page.getByRole('button', { name: /作業完成|補簽|不是上課日/ }).first()).toBeVisible();
  await scanAccessibility(page, info, 'classroom-with-pet');
});

test('Teacher Dashboard: students and rewards', async ({ teacherPage: page }, info) => {
  await scanAccessibility(page, info, 'dashboard-students');
  await selectDashboardTab(page, '獎勵');
  await expect(page.getByRole('row', { name: new RegExp(STUDENT_NAME) })).toBeVisible();
  await scanAccessibility(page, info, 'dashboard-rewards');
});

test('Student analytics: evidence form and populated records', async ({ teacherPage: page }, info) => {
  await selectDashboardTab(page, '個人分析');
  const form = page.getByRole('heading', { name: '新增學習證據' }).locator('..');
  await form.getByLabel('證據摘要').fill('A11Y 已完成學習任務');
  await performSyncedAction(page, () => form.getByRole('button', { name: '儲存學習證據' }).click());
  await scanAccessibility(page, info, 'student-analytics');
});

test('Exam view: editor and saved exam', async ({ teacherPage: page }, info) => {
  await selectDashboardTab(page, '個人分析');
  await page.getByLabel('考試名稱').fill('A11Y 測試考試');
  await page.locator('input[data-score-row="0"][data-score-column="0"]').fill('85');
  await scanAccessibility(page, info, 'exam-editor');
  await performSyncedAction(page, () => page.getByRole('button', { name: '保存考試' }).click());
  await scanAccessibility(page, info, 'exam-saved');
});

test('Settings: rules, calendar and workspace permissions', async ({ teacherPage: page }, info) => {
  await selectDashboardTab(page, '規則');
  await expect(page.getByRole('heading', { name: '工作區權限' })).toBeVisible();
  await scanAccessibility(page, info, 'settings');
});
