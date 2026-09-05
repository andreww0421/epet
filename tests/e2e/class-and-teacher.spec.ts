import { expect, test } from '@playwright/test';
import {
  E2eApiSession,
  addClassViaUi,
  addStudentViaUi,
  loadBrowserState,
  loginViaUi,
  performSyncedAction,
  selectDashboardTab,
  testAccount,
} from './support/fixtures';

test.describe('Class management', () => {
  test('create class, create/import students, and delete a student', async ({
    context,
    page,
  }) => {
    const account = testAccount('class-management');
    const setup = await E2eApiSession.register(account);
    const workspaceId = setup.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Workspace is missing');
    await setup.dispose();
    await loginViaUi(page, account);

    const className = 'E2E 測試班';
    await addClassViaUi(page, className);
    await addStudentViaUi(page, 'E2E 手動學生');

    const rosterSection = page.locator(
      'section[aria-labelledby="roster-import-title"]',
    );
    await rosterSection.locator('input[type="file"]').setInputFiles({
      name: 'e2e-roster.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        '\uFEFF學生姓名\r\nE2E 匯入學生甲\r\nE2E 匯入學生乙\r\n',
        'utf8',
      ),
    });
    await expect(rosterSection).toContainText('新增 2 位');
    await performSyncedAction(page, () => rosterSection.getByRole('button', {
      name: '新增 2 位學生',
    }).click());

    await selectDashboardTab(page, '獎勵');
    await expect(page.getByRole('row', {
      name: /E2E 手動學生/,
    })).toBeVisible();
    await expect(page.getByRole('row', {
      name: /E2E 匯入學生甲/,
    })).toBeVisible();
    const deletedRow = page.getByRole('row', {
      name: /E2E 匯入學生乙/,
    });
    await deletedRow.getByTitle('刪除學生').click();
    await performSyncedAction(page, () =>
      page.getByRole('button', { name: '確定刪除' }).click());
    await expect(deletedRow).toHaveCount(0);

    const state = await loadBrowserState(context, workspaceId);
    const classroom = state.data?.classes.find(
      (candidate) => candidate.name === className,
    );
    expect(classroom?.students.map((student) => student.name).sort()).toEqual([
      'E2E 匯入學生甲',
      'E2E 手動學生',
    ]);
  });
});

test.describe('Teacher operations', () => {
  test('add/deduct points and record teacher feedback and evidence', async ({
    context,
    page,
  }) => {
    const account = testAccount('teacher-operations');
    const setup = await E2eApiSession.register(account);
    const workspaceId = setup.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Workspace is missing');
    await setup.dispose();
    await loginViaUi(page, account);

    const studentName = 'E2E 教師操作學生';
    await addStudentViaUi(page, studentName);
    await selectDashboardTab(page, '獎勵');

    let studentRow = page.getByRole('row', {
      name: new RegExp(studentName),
    });
    await studentRow.getByTitle('手動加減分').click();
    await page.getByLabel('獎懲積分').fill('20');
    await page.getByLabel('具體回饋原因（必填）').fill('E2E 主動協助同學');
    await performSyncedAction(page, () =>
      page.getByRole('button', { name: '確認調整' }).click());
    await expect(studentRow).toContainText('220 / 700');

    await studentRow.getByTitle('手動加減分').click();
    await page.getByLabel('獎懲積分').fill('-10');
    await page.getByLabel('具體回饋原因（必填）').fill('E2E 未完成約定');
    await performSyncedAction(page, () =>
      page.getByRole('button', { name: '確認調整' }).click());
    studentRow = page.getByRole('row', { name: new RegExp(studentName) });
    await expect(studentRow).toContainText('210 / 700');

    await selectDashboardTab(page, '紀錄');
    const feedbackSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: '導師每日評語' }),
    });
    await feedbackSection.getByLabel('學生').selectOption({
      label: studentName,
    });
    await feedbackSection.getByLabel('每日評語（必填）').fill(
      'E2E 今天能清楚說明解題策略。',
    );
    await performSyncedAction(page, () => feedbackSection.getByRole('button', {
      name: '儲存每日評語',
    }).click());
    await expect(page.getByText('已儲存今日導師評語')).toBeVisible();

    await selectDashboardTab(page, '個人分析');
    await page.getByLabel('選擇學生').selectOption({ label: studentName });
    const evidenceForm = page.getByRole('heading', {
      name: '新增學習證據',
    }).locator('..');
    await evidenceForm.getByLabel('證據摘要').fill('E2E 能獨立完成題組');
    await evidenceForm.getByLabel('觀察細節').fill('E2E 課堂觀察紀錄');
    await performSyncedAction(page, () => evidenceForm.getByRole('button', {
      name: '儲存學習證據',
    }).click());
    await expect(page.getByText('學習證據已儲存。')).toBeVisible();

    const state = await loadBrowserState(context, workspaceId);
    const student = state.data?.classes[0]?.students.find(
      (candidate) => candidate.name === studentName,
    );
    expect(student?.points).toBe(210);
    expect(student?.dailyProgress.reflections.some(
      (record) => record.author === 'mentor' &&
        record.text === 'E2E 今天能清楚說明解題策略。',
    )).toBe(true);
    const evidence = state.data?.classes[0]?.learningEvidenceRecords ?? [];
    expect(evidence.some(
      (record) => record.title === 'E2E 能獨立完成題組',
    )).toBe(true);
  });
});
