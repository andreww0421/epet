import { expect } from '@playwright/test';
import { performSyncedAction, selectDashboardTab } from '../e2e/support/fixtures';
import { scanAccessibility, STUDENT_NAME, test } from './fixtures';

test('Add class dialog: semantics and labels', async ({ teacherPage: page }, info) => {
  const trigger = page.getByRole('button', { name: '新增班級' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('班級名稱')).toBeVisible();
  await expect(page.getByLabel('班級名稱')).toBeFocused();
  await scanAccessibility(page, info, 'add-class-dialog');
  const dialog = page.getByRole('dialog', { name: '新增班級' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('班級名稱').fill('鍵盤測試班級');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '新增', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('班級名稱')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  // Submitting with Enter must not activate the restored opener again.
  await page.keyboard.press('Enter');
  await page.getByLabel('班級名稱').fill('鍵盤儲存班級');
  await page.getByLabel('班級名稱').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(dialog).toBeVisible();
  await performSyncedAction(page, () => page.getByLabel('班級名稱').press('Enter'));
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.locator('#classSelect option:checked')).toHaveText('鍵盤儲存班級');
});

test('Point adjustment dialog: fields and open suggestions', async ({ teacherPage: page }, info) => {
  await selectDashboardTab(page, '獎勵');
  const trigger = page.getByRole('row', { name: new RegExp(STUDENT_NAME) }).getByTitle('手動加減分');
  await trigger.click();
  await expect(page.getByLabel('獎懲積分')).toBeFocused();
  await page.getByLabel('獎懲積分').fill('10');
  await scanAccessibility(page, info, 'point-dialog');
  await page.getByLabel('具體回饋原因（必填）').fill('課');
  await scanAccessibility(page, info, 'point-dialog-suggestions');
  await expect(page.getByRole('dialog')).toBeVisible();
  const reason = page.getByRole('combobox', { name: '具體回饋原因（必填）' });
  await reason.press('ArrowDown');
  const option = page.getByRole('listbox').getByRole('option', { selected: true });
  const optionId = await option.getAttribute('id');
  expect(optionId).toBeTruthy();
  await expect(reason).toHaveAttribute('aria-activedescendant', optionId!);
  const selectedLabel = await option.locator('span').first().innerText();
  await reason.press('Enter');
  await expect(reason).toHaveValue(selectedLabel);
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute('aria-expanded', 'false');
  // Escape dismisses the popup first, then the dialog. Unmatched text has no stale ARIA reference.
  await reason.fill('完全沒有相符的關鍵字');
  await expect(reason).toHaveAttribute('aria-expanded', 'false');
  await expect(reason).not.toHaveAttribute('aria-controls');
  await scanAccessibility(page, info, 'point-dialog-no-suggestions');
  await reason.fill('課');
  await reason.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(reason).toHaveAttribute('aria-expanded', 'false');
  await reason.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('Delete student dialog: accessible warning and cancellation', async ({ teacherPage: page }, info) => {
  await selectDashboardTab(page, '獎勵');
  const trigger = page.getByRole('row', { name: new RegExp(STUDENT_NAME) }).getByTitle('刪除學生');
  await trigger.click();
  await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: '確定刪除' })).toBeVisible();
  await scanAccessibility(page, info, 'delete-student-dialog');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '確定刪除' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('row', { name: new RegExp(STUDENT_NAME) })).toBeVisible();
});

test('Account deletion dialog: semantics and fields', async ({ teacherPage: page }, info) => {
  await selectDashboardTab(page, '資料治理');
  await page.getByRole('tab', { name: 'Revision 復原', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: '帳號生命週期', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: '帳號生命週期', exact: true })).toBeVisible();
  const trigger = page.getByRole('button', { name: '檢查永久刪除帳號', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '刪除帳號' });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: '關閉', exact: true });
  await expect(close).toBeFocused();
  await scanAccessibility(page, info, 'account-deletion-dialog');
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('目前密碼')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('輸入 DELETE')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
