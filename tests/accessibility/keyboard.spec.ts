import { expect } from '@playwright/test';
import { scanAccessibility, test } from './fixtures';

test('Dashboard tabs: one tab stop, arrows, Home/End and associated panel', async ({ teacherPage: page }) => {
  const students = page.getByRole('tab', { name: '學生', exact: true });
  const rewards = page.getByRole('tab', { name: '獎勵', exact: true });
  const governance = page.getByRole('tab', { name: '資料治理', exact: true });
  await students.focus();
  await expect(page.getByRole('tablist').locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(rewards).toBeFocused();
  await expect(rewards).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: '獎勵', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: '獎勵', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(rewards).toBeFocused();
  await page.keyboard.press('End');
  await expect(governance).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(students).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(governance).toBeFocused();
  await page.keyboard.press('Home');
  await expect(students).toBeFocused();
  await expect(students).toHaveAttribute('aria-selected', 'true');
});

test('Small viewport: dialog fits viewport and keyboard focus is visible', async ({ teacherPage: page }, info) => {
  await page.setViewportSize({ width: 375, height: 667 });
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
