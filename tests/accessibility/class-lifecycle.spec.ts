import { expect, type Page } from '@playwright/test';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import {
  E2eApiSession,
  openConsoleWithApiSession,
  selectDashboardTab,
  testAccount,
  waitForBackendSync,
} from '../e2e/support/fixtures';
import { scanAccessibility, test } from './fixtures';

let owner: E2eApiSession;
const className = 'A11Y lifecycle history';

const seedWorkspace = async () => {
  const created = await owner.createWorkspace('Synthetic accessible class lifecycle');
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Synthetic accessibility workspace missing');
  const snapshot = await owner.loadState(workspaceId);
  if (!snapshot.data?.classes[0]) throw new Error('Synthetic accessibility class missing');
  const source = snapshot.data.classes[0];
  const now = Date.now();
  await owner.saveState({
    ...snapshot.data,
    settings: { ...snapshot.data.settings!, decayAmount: 0 },
    classes: [{
      ...source,
      name: className,
      students: [createEnrolledStudent({ id: 'a11y-lifecycle-learner', name: 'A11Y retained learner' })],
      learningEvidenceRecords: [{
        id: 'a11y-lifecycle-evidence', classId: source.id, studentId: 'a11y-lifecycle-learner',
        title: 'A11Y retained evidence', note: 'A11Y retained teaching note',
        competency: 'growth', level: 'progressing', evidenceType: 'observation',
        actor: 'mentor', source: 'manual', rubricVersion: 'v1', revision: 1, createdAt: now,
      }],
      examRecords: [{
        id: 'a11y-lifecycle-exam', title: 'A11Y retained assessment', examDate: '2026-10-14',
        items: [{ id: 'item', name: 'Synthetic assessment item', maxScore: 100 }],
        results: [{ studentId: 'a11y-lifecycle-learner', scores: { item: 85 },
          mentorComment: 'A11Y retained exam feedback', updatedAt: now }],
        createdAt: now, updatedAt: now,
      }],
    }, { ...source, id: 'a11y-lifecycle-active', name: 'A11Y remaining active class', students: [] }],
    currentClassId: source.id,
  }, snapshot.revision, workspaceId);
  return workspaceId;
};

const openLifecycle = async (page: Page) => {
  await selectDashboardTab(page, '資料治理');
  await page.getByRole('tab', { name: '工作區資料', exact: true }).click();
};

test.beforeAll(async () => { owner = await E2eApiSession.register(testAccount('a11y-lifecycle-owner')); });
test.afterAll(async () => { await owner.dispose(); });

test('Archived class history: retained learning and assessment controls remain accessible', async ({ page }, info) => {
  await seedWorkspace();
  await openConsoleWithApiSession(page, owner);
  await openLifecycle(page);
  await page.getByRole('button', { name: `封存班級 ${className}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '確認封存班級', exact: true });
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await scanAccessibility(page, info, 'archive-class-dialog');
  await dialog.getByLabel('輸入 ARCHIVE CLASS', { exact: true }).fill('ARCHIVE CLASS');
  const archived = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/privacy/archive') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '確認封存', exact: true }).click();
  expect((await archived).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await waitForBackendSync(page);
  await openLifecycle(page);
  await page.getByRole('button', { name: `檢視封存歷史 ${className}`, exact: true }).click();
  const history = page.getByRole('region', { name: '封存班級歷史', exact: true });
  await expect(history).toContainText('A11Y retained evidence');
  await expect(history).toContainText('A11Y retained teaching note');
  const assessment = history.getByRole('combobox', { name: '選擇保留的考試', exact: true });
  await expect(assessment).toHaveValue('a11y-lifecycle-exam');
  const scoreTable = history.getByRole('region', { name: '封存考試成績表', exact: true });
  await expect(scoreTable.getByRole('table')).toBeVisible();
  await expect(history.getByRole('row', { name: /A11Y retained learner.*85%/ })).toBeVisible();
  await history.getByText('A11Y retained learner · 項目分析與教師評語', { exact: true }).click();
  await expect(history.getByText('A11Y retained exam feedback', { exact: false })).toBeVisible();
  await scanAccessibility(page, info, 'archived-class-history');
  const desktopScreenshot = info.outputPath('archived-class-history-desktop-detail.png');
  await history.screenshot({ path: desktopScreenshot });
  await info.attach('archived-class-history-desktop-detail', { path: desktopScreenshot, contentType: 'image/png' });
  await page.setViewportSize({ width: 375, height: 667 });
  await assessment.focus();
  await expect(assessment).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(scoreTable).toBeFocused();
  expect(await scoreTable.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await scanAccessibility(page, info, 'archived-class-history-mobile');
  const historyScreenshot = info.outputPath('archived-class-history-mobile-detail.png');
  await history.screenshot({ path: historyScreenshot });
  await info.attach('archived-class-history-mobile-detail', { path: historyScreenshot, contentType: 'image/png' });
});

for (const entry of ['workspace', 'legacy'] as const) {
  test(`Permanent class deletion (${entry}): keyboard containment and safe Escape`, async ({ page }, info) => {
    const workspaceId = await seedWorkspace();
    await openConsoleWithApiSession(page, owner);
    if (entry === 'workspace') await openLifecycle(page);
    else await selectDashboardTab(page, '學生');
    const trigger = page.getByRole('button', {
      name: entry === 'workspace' ? `永久刪除班級 ${className}` : '刪除班級', exact: true,
    });
    const before = await owner.loadState(workspaceId);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '永久刪除班級', exact: true });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const cancel = dialog.getByRole('button', { name: '取消', exact: true });
    const confirm = dialog.getByRole('button', { name: '確認永久刪除', exact: true });
    const acknowledge = dialog.getByRole('checkbox', {
      name: '我了解所有班級資料將永久刪除，且無法透過 revision 復原', exact: true,
    });
    const phrase = dialog.getByRole('textbox', { name: '輸入 DELETE CLASS', exact: true });
    await expect(cancel).toBeFocused();
    await expect(confirm).toBeDisabled();
    await scanAccessibility(page, info, `class-deletion-${entry}`);
    await page.keyboard.press('Tab');
    await expect(acknowledge).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(cancel).toBeFocused();
    await phrase.fill('DELETE CLASS');
    await expect(confirm).toBeDisabled();
    await acknowledge.focus();
    await page.keyboard.press('Space');
    await expect(confirm).toBeEnabled();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(acknowledge).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(phrase).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await owner.loadState(workspaceId)).toEqual(before);
  });
}

test('Full workspace backup review: double confirmation and safe keyboard cancellation', async ({ page }, info) => {
  const workspaceId = await seedWorkspace();
  await openConsoleWithApiSession(page, owner);
  await openLifecycle(page);
  const before = await owner.loadState(workspaceId);
  const trigger = page.getByRole('button', { name: '匯入 JSON', exact: true });
  const choosing = page.waitForEvent('filechooser');
  await trigger.click();
  await (await choosing).setFiles({
    name: 'synthetic-accessible-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(before.data)),
  });
  const dialog = page.getByRole('dialog', { name: '檢查工作區匯入', exact: true });
  const cancel = dialog.getByRole('button', { name: '取消', exact: true });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(cancel).toBeFocused();
  await scanAccessibility(page, info, 'workspace-import-full-review');
  const confirm = dialog.getByRole('button', { name: '確認取代工作區', exact: true });
  const phrase = dialog.getByRole('textbox', { name: '輸入 IMPORT WORKSPACE', exact: true });
  await phrase.fill('IMPORT WORKSPACE');
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox', { name: '我了解目前工作區資料會被取代及清除', exact: true }).check();
  await expect(confirm).toBeEnabled();
  await confirm.focus();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await page.setViewportSize({ width: 375, height: 667 });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(375);
  expect(bounds!.height).toBeLessThanOrEqual(667);
  await scanAccessibility(page, info, 'workspace-import-full-review-mobile');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await owner.loadState(workspaceId)).toEqual(before);
});
