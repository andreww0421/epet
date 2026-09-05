import { expect, test, type Locator } from '@playwright/test';
import {
  E2eApiSession,
  addStudentViaUi,
  loadBrowserState,
  loginViaUi,
  performSyncedAction,
  selectDashboardTab,
  testAccount,
} from './support/fixtures';

const pasteScores = async (target: Locator, scores: string) => {
  await target.evaluate((element, text) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    }));
  }, scores);
};

test.describe('Exam assessment', () => {
  test('imports valid scores and rejects invalid scores atomically', async ({
    context,
    page,
  }) => {
    const account = testAccount('exam-scores');
    const setup = await E2eApiSession.register(account);
    const workspaceId = setup.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Workspace is missing');
    await setup.dispose();
    await loginViaUi(page, account);

    await addStudentViaUi(page, 'E2E 成績學生甲');
    await addStudentViaUi(page, 'E2E 成績學生乙');
    await selectDashboardTab(page, '個人分析');
    await expect(page.getByRole('heading', {
      name: '考試趨勢與個別報告',
    })).toBeVisible();

    await page.getByLabel('考試名稱').fill('E2E 期中考');
    const firstScore = page.locator(
      'input[data-score-row="0"][data-score-column="0"]',
    );
    const secondScore = page.locator(
      'input[data-score-row="1"][data-score-column="0"]',
    );
    await pasteScores(firstScore, '80\n90');
    const validPreview = page.locator('[aria-label="成績貼上預覽"]');
    await expect(validPreview).toContainText('0 個錯誤');
    await validPreview.getByRole('button', { name: '套用至草稿' }).click();
    await expect(firstScore).toHaveValue('80');
    await expect(secondScore).toHaveValue('90');
    await performSyncedAction(page, () =>
      page.getByRole('button', { name: '保存考試' }).click());
    await expect(page.getByText('已保存', { exact: true })).toBeVisible();

    await pasteScores(firstScore, '101\n90');
    const invalidPreview = page.locator('[aria-label="成績貼上預覽"]');
    await expect(invalidPreview).toContainText('1 個錯誤');
    await expect(invalidPreview).toContainText('成績超過該項目的滿分');
    await expect(invalidPreview.getByRole('button', {
      name: '套用至草稿',
    })).toBeDisabled();
    await expect(firstScore).toHaveValue('80');

    const state = await loadBrowserState(context, workspaceId);
    const exam = state.data?.classes[0]?.examRecords?.find(
      (candidate) => candidate.title === 'E2E 期中考',
    );
    expect(exam).toBeTruthy();
    const itemId = exam?.items[0]?.id;
    if (!itemId) throw new Error('Saved exam item is missing');
    expect(exam?.results.map((result) => result.scores[itemId]).sort())
      .toEqual([80, 90]);
  });
});
