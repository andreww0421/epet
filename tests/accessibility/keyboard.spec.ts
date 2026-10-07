import { expect } from '@playwright/test';
import { selectTeacherDestination } from '../e2e/support/fixtures';
import { scanAccessibility, test } from './fixtures';

test('Teacher Console destinations: one tab stop, arrows, Home/End and associated panel', async ({ teacherPage: page }) => {
  await selectTeacherDestination(page, 'Class', '學生');
  const students = page.getByRole('tab', { name: '學生', exact: true });
  const groups = page.getByRole('tab', { name: '分組', exact: true });
  const records = page.getByRole('tab', { name: '紀錄', exact: true });
  await students.focus();
  await expect(page.getByRole('tablist').locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(groups).toBeFocused();
  await expect(groups).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: '分組', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: '分組', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(groups).toBeFocused();
  await page.keyboard.press('End');
  await expect(records).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(students).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(records).toBeFocused();
  await page.keyboard.press('Home');
  await expect(students).toBeFocused();
  await expect(students).toHaveAttribute('aria-selected', 'true');
});

test('Small viewport: dialog fits viewport and keyboard focus is visible', async ({ teacherPage: page }, info) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await selectTeacherDestination(page, 'Class', '學生');
  await page.getByRole('button', { name: '新增班級' }).click();
  const dialog = page.getByRole('dialog', { name: '新增班級' });
  await scanAccessibility(page, info, 'add-class-mobile');
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(667);
  await page.keyboard.press('Tab');
  const cancel = dialog.getByRole('button', { name: '取消', exact: true });
  await expect(cancel).toBeFocused();
  await expect(cancel).toBeInViewport();
  const outline = await cancel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
