import { expect, test, type Page } from '@playwright/test';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import {
  E2eApiSession,
  openConsoleWithApiSession,
  selectDashboardTab,
  testAccount,
} from '../e2e/support/fixtures';
import { scanAccessibility } from './fixtures';

let owner: E2eApiSession;
const openPrivacy = async (page: Page) => {
  const created = await owner.createWorkspace('A11Y Privacy workspace');
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('A11Y workspace is missing');
  const snapshot = await owner.loadState(workspaceId);
  if (!snapshot.data?.classes[0]) throw new Error('A11Y class is missing');
  const original = snapshot.data.classes[0];
  await owner.saveState({ ...snapshot.data,
    classes: [{ ...original, students: [createEnrolledStudent({
      id: 'a11y-privacy-learner', name: 'A11Y Privacy learner',
    })] }, { ...structuredClone(original), id: 'a11y-archive-class', name: 'A11Y archive class', students: [] }],
  }, snapshot.revision, workspaceId);
  await openConsoleWithApiSession(page, owner);
  await selectDashboardTab(page, '資料治理');
  return workspaceId;
};

test.beforeAll(async () => { owner = await E2eApiSession.register(testAccount('a11y-privacy-owner')); });
test.afterAll(async () => { await owner.dispose(); });

test('Data and Privacy panels: headings, labels and tab relationships', async ({ page }, info) => {
  await openPrivacy(page);
  for (const [name, report] of [
    ['工作區資料', 'privacy-workspace'],
    ['學生資料', 'privacy-students'],
    ['隱私與保存', 'privacy-retention'],
  ]) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
    await scanAccessibility(page, info, report);
  }
});

test('Sensitive actions: accessible impact, keyboard containment and safe cancellation', async ({ page }, info) => {
  const workspaceId = await openPrivacy(page);
  const before = await owner.loadState(workspaceId);
  await page.getByRole('tab', { name: '學生資料', exact: true }).click();
  for (const [triggerName, title, finalName, report] of [
    ['檢查刪除學生資料', '刪除學生資料', '確認刪除', 'privacy-delete-dialog'],
    ['檢查匿名化學生', '匿名化學生', '確認匿名化', 'privacy-anonymize-dialog'],
  ]) {
    const trigger = page.getByRole('button', { name: triggerName, exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: finalName, exact: true })).toBeDisabled();
    await scanAccessibility(page, info, report);
    for (let press = 0; press < 5; press += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
  await page.getByRole('tab', { name: '工作區資料', exact: true }).click();
  const archive = page.getByRole('button', { name: '封存班級 A11Y archive class', exact: true });
  await archive.click();
  const dialog = page.getByRole('dialog', { name: '確認封存班級', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '確認封存', exact: true })).toBeDisabled();
  await scanAccessibility(page, info, 'privacy-archive-dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(archive).toBeFocused();
  expect(await owner.loadState(workspaceId)).toEqual(before);
});
