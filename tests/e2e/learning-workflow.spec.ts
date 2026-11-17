import { mkdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import { getActiveLearningEvidence } from '../../shared/education';
import type { AppData, ClassData } from '../../src/store/types';
import {
  E2eApiSession,
  browserApiRequest,
  inviteAccount,
  loginViaUi,
  loadBrowserState,
  openConsoleWithApiSession,
  performSyncedAction,
  selectTeacherDestination,
  switchWorkspaceViaUi,
  testAccount,
  waitForBackendSync,
} from './support/fixtures';

let owner: E2eApiSession;
const steps = ['1. 記錄學習表現', '2. 查看學習進度', '3. 產生回饋報告'] as const;
const cloudSaved = '工作區變更已確認保存至雲端';
const classBSecrets = ['PRIVATE OTHER CLASS BOB', 'PRIVATE_B_EVIDENCE', 'PRIVATE_B_EXAM'];

const flow = (page: Page) => page.getByRole('navigation', { name: '學習流程', exact: true });
const go = (page: Page, index: 0 | 1 | 2) => flow(page).getByRole('button', { name: steps[index], exact: true }).click();
const evidenceForm = (page: Page) => page.getByRole('heading', { name: '新增學習證據', exact: true }).locator('..');
const comments = (page: Page) => page.locator('section').filter({
  has: page.getByRole('heading', { name: '導師每日評語', exact: true }),
});

const seedWorkspace = async (name: string) => {
  const created = await owner.createWorkspace(name);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Synthetic workspace is missing');
  const snapshot = await owner.loadState(workspaceId);
  const base = snapshot.data?.classes[0];
  if (!snapshot.data || !base) throw new Error('Synthetic class is missing');
  const now = Date.now();
  const classA: ClassData = {
    ...structuredClone(base), name: 'Learning Flow Class A',
    students: [
      createEnrolledStudent({ id: '100', name: 'Flow Alice' }),
      createEnrolledStudent({ id: '102', name: 'Flow Bea' }),
    ],
    learningEvidenceRecords: [], classGoals: [], activeBoss: undefined,
    examRecords: [{
      id: 'flow-existing-assessment', title: 'Flow persisted assessment',
      examDate: new Date(now).toISOString().slice(0, 10),
      items: [{ id: 'reading', name: '閱讀理解', maxScore: 100 }],
      results: [
        { studentId: '100', scores: { reading: 63 }, mentorComment: 'Alice historical comment', updatedAt: now },
        { studentId: '102', scores: { reading: 87.5 }, mentorComment: 'Bea <specific> feedback', updatedAt: now },
      ], createdAt: now, updatedAt: now,
    }],
  };
  const classB: ClassData = {
    ...structuredClone(base), id: `other-${base.id}`, name: 'Learning Flow Class B',
    students: [createEnrolledStudent({ id: '100', name: classBSecrets[0] })],
    learningEvidenceRecords: [{
      id: 'private-b-evidence', classId: `other-${base.id}`, studentId: '100',
      competency: 'growth', level: 'needsSupport', evidenceType: 'observation',
      title: classBSecrets[1], note: 'PRIVATE_B_NOTE', actor: 'mentor', source: 'manual',
      rubricVersion: 'v1', revision: 1, createdAt: now,
    }],
    examRecords: [{
      id: 'private-b-exam', title: classBSecrets[2], examDate: new Date(now).toISOString().slice(0, 10),
      items: [{ id: 'b-reading', name: 'PRIVATE_B_ITEM', maxScore: 100 }],
      results: [{ studentId: '100', scores: { 'b-reading': 24 }, mentorComment: 'PRIVATE_B_COMMENT', updatedAt: now }],
      createdAt: now, updatedAt: now,
    }], classGoals: [], activeBoss: undefined,
  };
  const data: AppData = { ...snapshot.data, currentClassId: classA.id, classes: [classA, classB] };
  const saved = await owner.saveState(data, snapshot.revision, workspaceId);
  return { workspaceId, classA, classB, saved };
};

const openEvidence = async (page: Page) => {
  await openConsoleWithApiSession(page, owner);
  await selectTeacherDestination(page, 'Learning', '學習證據');
  await expect(flow(page)).toBeVisible();
};

const downloadWeeklyCsv = async (page: Page) => {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出 CSV', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^epet-weekly-feedback-.*\.csv$/);
  const path = await download.path();
  if (!path) throw new Error('Synthetic CSV download is missing');
  return readFile(path, 'utf8');
};

test.describe('Continuous learning workflow', () => {
  test.beforeAll(async () => { owner = await E2eApiSession.register(testAccount('learning-flow-owner')); });
  test.afterAll(async () => { await owner.dispose(); });

  test('one evidence entry carries its learner through progress, a whole-class CSV and the existing individual A4 report', async ({ page, context }) => {
    const setup = await seedWorkspace('learning-flow-continuous');
    await openEvidence(page);
    await page.getByRole('combobox', { name: '選擇學生', exact: true }).selectOption('102');
    await expect(page.getByText('目前學生：Flow Bea', { exact: true })).toBeVisible();
    await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill('Explained the reading strategy with evidence');
    await performSyncedAction(page, () => evidenceForm(page).getByRole('button', { name: '儲存學習證據', exact: true }).click());
    const afterEvidence = await loadBrowserState(context, setup.workspaceId);
    expect(afterEvidence.data?.classes[0].learningEvidenceRecords).toHaveLength(1);
    expect(afterEvidence.data?.classes[0].learningEvidenceRecords?.[0].studentId).toBe('102');
    expect(afterEvidence.data?.classes[0].students.map(({ points, pet }) => ({ points, pet })))
      .toEqual(setup.saved.data?.classes[0].students.map(({ points, pet }) => ({ points, pet })));
    const unexpectedWrites: string[] = [];
    const observeWrite = (request: import('@playwright/test').Request) => {
      if (new URL(request.url()).pathname === '/api/v1/state' && request.method() === 'PUT') unexpectedWrites.push(request.url());
    };
    page.on('request', observeWrite);
    await go(page, 1);
    await expect(page.getByText('目前學生：Flow Bea', { exact: true })).toBeVisible();
    await go(page, 2);
    await expect(page.getByText('班級週報涵蓋全班', { exact: false })).toBeVisible();
    const csv = await downloadWeeklyCsv(page);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('1 / 2 (50%)');
    expect(csv).toContain('Flow Alice'); // The unselected learner is still in the class report.
    for (const secret of classBSecrets) expect(csv).not.toContain(secret);
    expect(unexpectedWrites).toEqual([]);
    expect(await loadBrowserState(context, setup.workspaceId)).toEqual(afterEvidence);
    page.off('request', observeWrite);

    await page.getByRole('button', { name: '考試個別報告', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '目前學生', exact: true })).toHaveValue('102');
    // Capture only prepared report HTML; never claim an OS print/PDF dialog completed.
    await page.evaluate(() => {
      const target = window as Window & { __learningReportHtml?: string };
      window.open = () => ({
        opener: null,
        document: { open() {}, write(html: string) { target.__learningReportHtml = html; }, close() {} },
        focus() {}, setTimeout() { return 0; },
      } as unknown as Window);
    });
    await performSyncedAction(page, () => page.getByRole('button', { name: '產生個別 A4 PDF', exact: true }).click());
    const html = await page.evaluate(() => (window as Window & { __learningReportHtml?: string }).__learningReportHtml ?? '');
    expect(html).toContain('Flow Bea');
    expect(html).toContain('87.5');
    expect(html).toContain('Bea &lt;specific&gt; feedback');
    expect(html).toContain('@page { size: A4 portrait;');
    expect(html).not.toContain('Flow Alice');
    for (const secret of classBSecrets) expect(html).not.toContain(secret);
    const afterPrint = await loadBrowserState(context, setup.workspaceId);
    expect(afterPrint.data?.classes[0].examRecords).toHaveLength(1);
    expect(afterPrint.data?.classes[0].examRecords?.[0].results.map(result => result.scores.reading)).toEqual([63, 87.5]);
    expect(afterPrint.data?.classes[1]).toEqual(setup.saved.data?.classes[1]);
    await page.reload();
    expect((await loadBrowserState(context, setup.workspaceId)).data?.classes[0].learningEvidenceRecords).toHaveLength(1);
  });

  test('one daily comment keeps one active evidence source while updates retain immutable revision history', async ({ page, context }) => {
    const setup = await seedWorkspace('learning-flow-daily-comment');
    await openEvidence(page);
    await page.getByRole('combobox', { name: '選擇學生', exact: true }).selectOption('102');
    await page.getByRole('button', { name: '記錄每日評語', exact: true }).click();
    await expect(comments(page).getByRole('combobox', { name: '學生', exact: true })).toHaveValue('102');
    await comments(page).getByRole('textbox', { name: '每日評語（必填）', exact: true }).fill('Explained the next step independently');
    await performSyncedAction(page, () => comments(page).getByRole('button', { name: '儲存每日評語', exact: true }).click());
    const first = (await loadBrowserState(context, setup.workspaceId)).data?.classes[0];
    const reflections = first?.students[1].dailyProgress?.reflections ?? [];
    expect(reflections).toHaveLength(1);
    expect(first?.learningEvidenceRecords).toHaveLength(1);
    expect(first?.learningEvidenceRecords?.[0].sourceId).toBe(reflections[0].id);
    await go(page, 1);
    await go(page, 2);
    await page.getByRole('button', { name: '記錄每日評語', exact: true }).click();
    await expect(comments(page).getByRole('textbox', { name: '每日評語（必填）', exact: true })).toHaveValue('Explained the next step independently');
    await comments(page).getByRole('textbox', { name: '每日評語（必填）', exact: true }).fill('Explained the next step and checked the result');
    await performSyncedAction(page, () => comments(page).getByRole('button', { name: '更新今日評語', exact: true }).click());
    const updated = (await loadBrowserState(context, setup.workspaceId)).data?.classes[0];
    expect(updated?.students[1].dailyProgress?.reflections).toHaveLength(1);
    expect(updated?.students[1].dailyProgress?.reflections?.[0].id).toBe(reflections[0].id);
    expect(updated?.learningEvidenceRecords).toHaveLength(2);
    expect(updated?.learningEvidenceRecords?.map(record => record.revision)).toEqual([2, 1]);
    expect(updated?.learningEvidenceRecords?.every(record => record.source === 'mentorDailyFeedback' && record.sourceId === reflections[0].id)).toBe(true);
    expect(updated?.learningEvidenceRecords?.[1]).toEqual(first?.learningEvidenceRecords?.[0]);
    expect(updated?.learningEvidenceRecords?.[0].id).not.toBe(first?.learningEvidenceRecords?.[0].id);
    expect(getActiveLearningEvidence(updated?.learningEvidenceRecords ?? [])).toHaveLength(1);
    expect(updated?.learningEvidenceRecords?.[0].title).toBe('Explained the next step and checked the result');
    expect(updated?.students[0]).toEqual(setup.saved.data?.classes[0].students[0]);
    expect(updated?.examRecords).toEqual(setup.saved.data?.classes[0].examRecords);
  });

  test('unsaved evidence is retained per learner and class even when two classes use student ID 100', async ({ page, context }) => {
    const setup = await seedWorkspace('learning-flow-draft-identity');
    await openEvidence(page);
    await page.getByRole('combobox', { name: '選擇學生', exact: true }).selectOption('100');
    await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill('ALICE_UNSAVED_A');
    await page.getByRole('combobox', { name: '選擇學生', exact: true }).selectOption('102');
    await expect(evidenceForm(page).getByLabel('證據摘要', { exact: true })).toHaveValue('');
    await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill('BEA_UNSAVED_A');
    await page.getByRole('combobox', { name: '選擇學生', exact: true }).selectOption('100');
    await expect(evidenceForm(page).getByLabel('證據摘要', { exact: true })).toHaveValue('ALICE_UNSAVED_A');
    await performSyncedAction(page, () => page.getByRole('combobox', { name: '目前班級', exact: true }).selectOption(setup.classB.id));
    await expect(page.getByText(`目前學生：${classBSecrets[0]}`, { exact: true })).toBeVisible();
    await expect(evidenceForm(page).getByLabel('證據摘要', { exact: true })).toHaveValue('');
    await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill('BOB_UNSAVED_B');
    await go(page, 1);
    await go(page, 0);
    await expect(evidenceForm(page).getByLabel('證據摘要', { exact: true })).toHaveValue('BOB_UNSAVED_B');
    await performSyncedAction(page, () => page.getByRole('combobox', { name: '目前班級', exact: true }).selectOption(setup.classA.id));
    await page.getByRole('combobox', { name: '選擇學生', exact: true }).selectOption('100');
    await expect(evidenceForm(page).getByLabel('證據摘要', { exact: true })).toHaveValue('ALICE_UNSAVED_A');
    await page.getByRole('combobox', { name: '選擇學生', exact: true }).selectOption('102');
    await expect(evidenceForm(page).getByLabel('證據摘要', { exact: true })).toHaveValue('BEA_UNSAVED_A');
    expect((await loadBrowserState(context, setup.workspaceId)).data?.classes).toEqual(setup.saved.data?.classes);
  });

  test('cloud confirmation waits for the actual pending PUT acknowledgement and never claims unsaved form input is durable', async ({ page, context }) => {
    const setup = await seedWorkspace('learning-flow-cloud-ack');
    await openEvidence(page);
    await expect(page.getByText('尚在表單中的內容，請先按各表單的保存按鈕。', { exact: true })).toBeVisible();
    await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill('WAIT_FOR_REAL_PUT_ACK');
    let releaseSave = () => {};
    let observeSave = () => {};
    const gate = new Promise<void>(resolve => { releaseSave = resolve; });
    const observed = new Promise<void>(resolve => { observeSave = resolve; });
    let held = false;
    await page.route('**/api/v1/state', async route => {
      if (!held && route.request().method() === 'PUT') {
        held = true;
        observeSave();
        await gate;
      }
      await route.continue();
    });
    try {
      await evidenceForm(page).getByRole('button', { name: '儲存學習證據', exact: true }).click();
      await observed;
      await page.getByRole('button', { name: '確認雲端保存', exact: true }).click();
      await expect(page.getByText('正在確認雲端保存', { exact: true })).toBeVisible();
      await expect(page.getByText(cloudSaved, { exact: true })).toHaveCount(0);
      expect((await owner.loadState(setup.workspaceId)).data?.classes[0].learningEvidenceRecords).toHaveLength(0);
      const committed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/state' && response.request().method() === 'PUT');
      releaseSave();
      expect((await committed).status()).toBe(200);
      await expect(page.getByRole('status').filter({ hasText: cloudSaved })).toBeVisible();
      expect((await loadBrowserState(context, setup.workspaceId)).data?.classes[0].learningEvidenceRecords).toHaveLength(1);
    } finally {
      releaseSave();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });

  test('a transient failed write unmounts the console without losing unsubmitted evidence, daily comment or assessment drafts', async ({ page, context }) => {
    const setup = await seedWorkspace('learning-flow-transient-offline');
    await openEvidence(page);
    await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill('ALICE_EVIDENCE_NOT_SUBMITTED');
    await page.getByRole('button', { name: '記錄每日評語', exact: true }).click();
    await comments(page).getByRole('textbox', { name: '每日評語（必填）', exact: true }).fill('ALICE_DAILY_COMMENT_NOT_SUBMITTED');
    await page.getByRole('button', { name: '考試個別報告', exact: true }).click();
    await page.getByLabel('考試名稱', { exact: true }).fill('ASSESSMENT_NOT_SUBMITTED');
    await page.locator('input[data-score-row="0"][data-score-column="0"]').fill('71');
    await page.getByRole('region', { name: '報表內容範圍', exact: true }).locator('textarea').fill('EXAM_COMMENT_NOT_SUBMITTED');
    await go(page, 0);
    await page.getByRole('combobox', { name: '選擇學生', exact: true }).selectOption('102');
    await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill('BEA_EXPLICITLY_SUBMITTED_ONCE');

    // Keep the genuine retry deadline; the browser clock only makes it deterministic.
    const now = Date.now();
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now + 1_000);
    let failing = true;
    let failedWrites = 0;
    await page.route('**/api/v1/state', async route => {
      if (failing && route.request().method() === 'PUT') {
        failedWrites += 1;
        await route.abort('failed');
      } else await route.continue();
    });
    try {
      await evidenceForm(page).getByRole('button', { name: '儲存學習證據', exact: true }).click();
      await page.clock.runFor(1_000);
      await expect.poll(() => failedWrites).toBe(1);
      await expect(page.getByRole('heading', { name: '目前無法安全開啟工作區', exact: true })).toBeVisible();
      // Explicitly prove the editors were unmounted, rather than merely hidden by a modal.
      await expect(page.getByRole('heading', { name: '新增學習證據', exact: true })).toHaveCount(0);
      await expect(flow(page)).toHaveCount(0);
      expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);

      failing = false;
      const retried = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/state' && response.request().method() === 'PUT');
      await page.clock.runFor(2_000);
      expect((await retried).status()).toBe(200);
      await page.clock.resume();
      await waitForBackendSync(page);
      await selectTeacherDestination(page, 'Learning', '學習證據');
      await expect(evidenceForm(page).getByLabel('證據摘要', { exact: true })).toHaveValue('ALICE_EVIDENCE_NOT_SUBMITTED');
      await page.getByRole('button', { name: '記錄每日評語', exact: true }).click();
      await expect(comments(page).getByRole('textbox', { name: '每日評語（必填）', exact: true })).toHaveValue('ALICE_DAILY_COMMENT_NOT_SUBMITTED');
      await page.getByRole('button', { name: '考試個別報告', exact: true }).click();
      await expect(page.getByLabel('考試名稱', { exact: true })).toHaveValue('ASSESSMENT_NOT_SUBMITTED');
      await expect(page.locator('input[data-score-row="0"][data-score-column="0"]')).toHaveValue('71');
      await expect(page.getByRole('region', { name: '報表內容範圍', exact: true }).locator('textarea')).toHaveValue('EXAM_COMMENT_NOT_SUBMITTED');

      const saved = await loadBrowserState(context, setup.workspaceId);
      const persisted = saved.data?.classes[0];
      expect(persisted?.learningEvidenceRecords).toHaveLength(1);
      expect(persisted?.learningEvidenceRecords?.[0].title).toBe('BEA_EXPLICITLY_SUBMITTED_ONCE');
      expect(persisted?.learningEvidenceRecords?.[0].studentId).toBe('102');
      expect(persisted?.examRecords).toEqual(setup.saved.data?.classes[0].examRecords);
      expect(persisted?.students).toEqual(setup.saved.data?.classes[0].students);
      expect(saved.data?.classes[1]).toEqual(setup.saved.data?.classes[1]);
      for (const unsubmitted of ['ALICE_EVIDENCE_NOT_SUBMITTED', 'ALICE_DAILY_COMMENT_NOT_SUBMITTED', 'ASSESSMENT_NOT_SUBMITTED', 'EXAM_COMMENT_NOT_SUBMITTED']) {
        expect(JSON.stringify(saved.data)).not.toContain(unsubmitted);
      }
    } finally {
      await page.clock.resume();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });

  test('dirty assessment changes survive class round-trips and require explicit discard before changing history or creating a new assessment', async ({ page, context }) => {
    const setup = await seedWorkspace('learning-flow-assessment-drafts');
    const data = structuredClone(setup.saved.data!);
    const currentExam = data.classes[0].examRecords![0];
    const previousExam = {
      ...structuredClone(currentExam), id: 'flow-older-assessment', title: 'Earlier historical assessment',
      examDate: '2026-01-01', createdAt: currentExam.createdAt - 86_400_000, updatedAt: currentExam.updatedAt - 86_400_000,
    };
    data.classes[0].examRecords = [currentExam, previousExam];
    const seeded = await owner.saveState(data, setup.saved.revision, setup.workspaceId);
    await openConsoleWithApiSession(page, owner);
    await selectTeacherDestination(page, 'Learning', '考試分析');
    const title = page.getByLabel('考試名稱', { exact: true });
    const firstScore = page.locator('input[data-score-row="0"][data-score-column="0"]');
    await title.fill('CLASS_A_UNSUBMITTED_ASSESSMENT');
    await firstScore.fill('71');
    await performSyncedAction(page, () => page.getByRole('combobox', { name: '目前班級', exact: true }).selectOption(setup.classB.id));
    await expect(title).toHaveValue(classBSecrets[2]);
    await expect(firstScore).toHaveValue('24');
    await title.fill('CLASS_B_UNSUBMITTED_ASSESSMENT');
    await firstScore.fill('31');
    await performSyncedAction(page, () => page.getByRole('combobox', { name: '目前班級', exact: true }).selectOption(setup.classA.id));
    await expect(title).toHaveValue('CLASS_A_UNSUBMITTED_ASSESSMENT');
    await expect(firstScore).toHaveValue('71');

    page.once('dialog', async dialog => { expect(dialog.type()).toBe('confirm'); await dialog.dismiss(); });
    await page.getByRole('combobox', { name: '考試紀錄', exact: true }).selectOption(previousExam.id);
    await expect(title).toHaveValue('CLASS_A_UNSUBMITTED_ASSESSMENT');
    await expect(firstScore).toHaveValue('71');
    await expect(page.getByRole('combobox', { name: '考試紀錄', exact: true })).toHaveValue(currentExam.id);
    page.once('dialog', async dialog => { expect(dialog.type()).toBe('confirm'); await dialog.accept(); });
    await page.getByRole('combobox', { name: '考試紀錄', exact: true }).selectOption(previousExam.id);
    await expect(title).toHaveValue(previousExam.title);
    await expect(firstScore).toHaveValue('63');

    await title.fill('OLDER_UNSUBMITTED_ASSESSMENT');
    page.once('dialog', async dialog => { expect(dialog.type()).toBe('confirm'); await dialog.dismiss(); });
    await page.getByRole('button', { name: '新增考試', exact: true }).click();
    await expect(title).toHaveValue('OLDER_UNSUBMITTED_ASSESSMENT');
    page.once('dialog', async dialog => { expect(dialog.type()).toBe('confirm'); await dialog.accept(); });
    await page.getByRole('button', { name: '新增考試', exact: true }).click();
    await expect(title).toHaveValue('第 3 次考試');
    await expect(firstScore).toHaveValue('');
    const after = await loadBrowserState(context, setup.workspaceId);
    expect(after.data?.classes).toEqual(seeded.data?.classes);
  });

  test('a Class A teacher can complete the flow without Class B data and a viewer can review without mutation', async ({ browser, page, context }) => {
    const setup = await seedWorkspace('learning-flow-role-scope');
    const teacher = await inviteAccount(owner, setup.workspaceId, testAccount('learning-flow-teacher'), 'teacher', [setup.classA.id]);
    try {
      await openConsoleWithApiSession(page, teacher);
      await selectTeacherDestination(page, 'Learning', '學習證據');
      await expect(page.getByRole('combobox', { name: '目前班級', exact: true }).locator('option')).toHaveCount(1);
      await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill('AUTHORIZED_CLASS_A_EVIDENCE');
      await performSyncedAction(page, () => evidenceForm(page).getByRole('button', { name: '儲存學習證據', exact: true }).click());
      await go(page, 1);
      await go(page, 2);
      const csv = await downloadWeeklyCsv(page);
      for (const secret of classBSecrets) {
        await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
        expect(csv).not.toContain(secret);
      }
      const scoped = await loadBrowserState(context, setup.workspaceId);
      expect(scoped.data?.classes).toHaveLength(1);
      expect(JSON.stringify(scoped)).not.toContain(classBSecrets[0]);
      expect((await owner.loadState(setup.workspaceId)).data?.classes[1]).toEqual(setup.saved.data?.classes[1]);
    } finally { await teacher.dispose(); }

    const viewer = await inviteAccount(owner, setup.workspaceId, testAccount('learning-flow-viewer'), 'viewer', [setup.classA.id]);
    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    try {
      await openConsoleWithApiSession(viewerPage, viewer);
      await selectTeacherDestination(viewerPage, 'Learning', '學習趨勢');
      await expect(flow(viewerPage)).toBeVisible();
      await go(viewerPage, 2);
      await expect(viewerPage.getByRole('button', { name: '儲存學習證據', exact: true })).toHaveCount(0);
      await expect(viewerPage.getByRole('button', { name: '儲存每日評語', exact: true })).toHaveCount(0);
      const before = await loadBrowserState(viewerContext, setup.workspaceId);
      const denied = await browserApiRequest(viewerContext, '/api/v1/state', {
        method: 'PUT', workspaceId: setup.workspaceId,
        body: { data: before.data, baseRevision: before.revision },
      });
      expect(denied.status()).toBe(403);
      expect(await loadBrowserState(viewerContext, setup.workspaceId)).toEqual(before);
      const viewerCsv = await downloadWeeklyCsv(viewerPage);
      for (const secret of classBSecrets) expect(viewerCsv).not.toContain(secret);
    } finally {
      await viewerContext.close();
      await viewer.dispose();
    }
  });

  test('the three native workflow actions remain keyboard operable without page overflow at phone and tablet widths', async ({ page }) => {
    await seedWorkspace('learning-flow-responsive');
    await openEvidence(page);
    await page.getByRole('combobox', { name: '選擇學生', exact: true }).selectOption('102');
    await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill('RESPONSIVE_RETAINED_DRAFT');
    await mkdir('output/learning-flow', { recursive: true });
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const index of [1, 2, 0] as const) {
        const action = flow(page).getByRole('button', { name: steps[index], exact: true });
        await action.focus();
        await expect(action).toBeFocused();
        await action.press('Enter');
        await expect(page.getByText('目前學生：Flow Bea', { exact: true })).toBeVisible();
        await expect(action).toBeInViewport();
        const bounds = await action.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      }
      await expect(evidenceForm(page).getByLabel('證據摘要', { exact: true })).toHaveValue('RESPONSIVE_RETAINED_DRAFT');
      await page.getByRole('button', { name: '考試個別報告', exact: true }).click();
      const report = page.getByRole('region', { name: '報表內容範圍', exact: true });
      await expect(report).toBeFocused();
      await expect(report).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const comparison = page.getByRole('region', { name: '評量項目比較', exact: true });
      await comparison.scrollIntoViewIfNeeded();
      await comparison.focus();
      await expect(comparison).toBeFocused();
      expect(await comparison.evaluate(element => getComputedStyle(element).overflowX)).toBe('auto');
      if (width === 375) {
        expect(await comparison.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        await comparison.press('ArrowRight');
        await expect.poll(() => comparison.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: `output/learning-flow/after-${width}.png`, fullPage: true });
      await go(page, 0);
      await expect(evidenceForm(page).getByLabel('證據摘要', { exact: true })).toHaveValue('RESPONSIVE_RETAINED_DRAFT');
    }
  });

  test('fresh same-scope revalidation follows saved daily comments while retaining an unsaved local comment after another tab updates it', async ({ page, context }) => {
    const setup = await seedWorkspace('learning-flow-comment-refresh');
    await openEvidence(page);
    await page.getByRole('button', { name: '記錄每日評語', exact: true }).click();
    const text = () => comments(page).getByRole('textbox', { name: '每日評語（必填）', exact: true });
    await expect(text()).toHaveValue('');
    const peer = await context.newPage();
    const refresh = async () => {
      const verified = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/session' && response.request().method() === 'GET');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      expect((await verified).status()).toBe(200);
      await waitForBackendSync(page);
      await selectTeacherDestination(page, 'Class', '每日評語');
    };
    try {
      await openConsoleWithApiSession(peer, owner);
      await selectTeacherDestination(peer, 'Class', '每日評語');
      const peerText = comments(peer).getByRole('textbox', { name: '每日評語（必填）', exact: true });
      await peerText.fill('PEER_FIRST_SAVED_COMMENT');
      await performSyncedAction(peer, () => comments(peer).getByRole('button', { name: '儲存每日評語', exact: true }).click());
      await refresh();
      await expect(text()).toHaveValue('PEER_FIRST_SAVED_COMMENT');
      await text().fill('LOCAL_UNSUBMITTED_REVIEW');
      await peerText.fill('PEER_SECOND_SAVED_COMMENT');
      await performSyncedAction(peer, () => comments(peer).getByRole('button', { name: '更新今日評語', exact: true }).click());
      await refresh();
      await expect(text()).toHaveValue('LOCAL_UNSUBMITTED_REVIEW');
      await expect(page.getByText('工作區中的今日評語已更新。尚未保存的輸入仍保留，請核對後再保存。', { exact: true })).toBeVisible();
      const saved = await owner.loadState(setup.workspaceId);
      const records = saved.data?.classes[0].students[0].dailyProgress?.reflections;
      expect(records).toHaveLength(1);
      expect(records?.[0].text).toBe('PEER_SECOND_SAVED_COMMENT');
      expect(saved.data?.classes[0].learningEvidenceRecords).toHaveLength(2);
      expect(saved.data?.classes[0].learningEvidenceRecords?.map(record => record.revision)).toEqual([2, 1]);
      expect(getActiveLearningEvidence(saved.data?.classes[0].learningEvidenceRecords ?? [])).toHaveLength(1);
      expect(JSON.stringify(saved.data)).not.toContain('LOCAL_UNSUBMITTED_REVIEW');
    } finally { await peer.close(); }
  });

  test('logout and a scoped teacher login in the same document clear all owner-only form drafts before another account can use the same learner IDs', async ({ page, context }) => {
    const setup = await seedWorkspace('learning-flow-same-document-account-switch');
    const teacherAccount = testAccount('learning-flow-same-document-teacher');
    const teacher = await inviteAccount(owner, setup.workspaceId, teacherAccount, 'teacher', [setup.classA.id]);
    // Logging out this independent browser session must not revoke the shared fixture owner's API session.
    const browserOwner = await E2eApiSession.login(owner.account);
    const canaries = ['OWNER_ONLY_UNSUBMITTED_EVIDENCE', 'OWNER_ONLY_UNSUBMITTED_DAILY', 'OWNER_ONLY_UNSUBMITTED_EXAM', 'OWNER_ONLY_UNSUBMITTED_EXAM_COMMENT'];
    const leakedRequests: { path: string; canary: string }[] = [];
    const observeCanary = (request: import('@playwright/test').Request) => {
      const path = new URL(request.url()).pathname;
      if (!path.startsWith('/api/')) return;
      // Retain only a failed-isolation indicator, never cookies or raw request bodies.
      const body = request.postData() ?? '';
      for (const canary of canaries) if (body.includes(canary)) leakedRequests.push({ path, canary });
    };
    const assertNoOwnerDraftInDom = async () => {
      const rendered = await page.evaluate(() => JSON.stringify({
        text: document.body.textContent,
        fields: Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')).map(field => field.value),
      }));
      for (const canary of canaries) expect(rendered).not.toContain(canary);
      expect(leakedRequests).toEqual([]);
    };
    try {
      await openConsoleWithApiSession(page, browserOwner);
      if (await page.getByRole('combobox', { name: '工作區', exact: true }).inputValue() !== setup.workspaceId) {
        await switchWorkspaceViaUi(page, setup.workspaceId);
      }
      await selectTeacherDestination(page, 'Learning', '學習證據');
      await page.getByRole('combobox', { name: '選擇學生', exact: true }).selectOption('100');
      await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill(canaries[0]);
      await page.getByRole('button', { name: '記錄每日評語', exact: true }).click();
      await comments(page).getByRole('textbox', { name: '每日評語（必填）', exact: true }).fill(canaries[1]);
      await page.getByRole('button', { name: '考試個別報告', exact: true }).click();
      await page.getByLabel('考試名稱', { exact: true }).fill(canaries[2]);
      await page.getByRole('region', { name: '報表內容範圍', exact: true }).locator('textarea').fill(canaries[3]);
      await page.locator('input[data-score-row="0"][data-score-column="0"]').fill('79');
      expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
      await page.evaluate(() => {
        (window as Window & { __learningSameDocument?: string }).__learningSameDocument = 'SAME_DOCUMENT_ACCOUNT_SWITCH';
      });
      await page.getByRole('button', { name: '登出', exact: true }).click();
      await expect(page.getByRole('button', { name: '登入並繼續帶班', exact: true })).toBeVisible();
      page.on('request', observeCanary);
      await loginViaUi(page, teacherAccount);
      expect(await page.evaluate(() => (window as Window & { __learningSameDocument?: string }).__learningSameDocument)).toBe('SAME_DOCUMENT_ACCOUNT_SWITCH');
      await expect(page.getByRole('combobox', { name: '目前班級', exact: true }).locator('option')).toHaveCount(1);
      await assertNoOwnerDraftInDom();

      await selectTeacherDestination(page, 'Learning', '學習證據');
      await expect(page.getByRole('combobox', { name: '選擇學生', exact: true })).toHaveValue('100');
      await expect(evidenceForm(page).getByLabel('證據摘要', { exact: true })).toHaveValue('');
      await assertNoOwnerDraftInDom();
      await page.getByRole('button', { name: '記錄每日評語', exact: true }).click();
      await expect(comments(page).getByRole('textbox', { name: '每日評語（必填）', exact: true })).toHaveValue('');
      await assertNoOwnerDraftInDom();
      await page.getByRole('button', { name: '考試個別報告', exact: true }).click();
      await expect(page.getByLabel('考試名稱', { exact: true })).toHaveValue('Flow persisted assessment');
      await expect(page.locator('input[data-score-row="0"][data-score-column="0"]')).toHaveValue('63');
      await expect(page.getByRole('region', { name: '報表內容範圍', exact: true }).locator('textarea')).toHaveValue('Alice historical comment');
      await assertNoOwnerDraftInDom();

      await go(page, 0);
      await evidenceForm(page).getByLabel('證據摘要', { exact: true }).fill('TEACHER_AUTHORIZED_FRESH_EVIDENCE');
      await performSyncedAction(page, () => evidenceForm(page).getByRole('button', { name: '儲存學習證據', exact: true }).click());
      await assertNoOwnerDraftInDom();
      const scoped = await loadBrowserState(context, setup.workspaceId);
      expect(scoped.data?.classes).toHaveLength(1);
      expect(scoped.data?.classes[0].learningEvidenceRecords).toHaveLength(1);
      expect(scoped.data?.classes[0].learningEvidenceRecords?.[0].title).toBe('TEACHER_AUTHORIZED_FRESH_EVIDENCE');
      const saved = await owner.loadState(setup.workspaceId);
      expect(saved.data?.classes[0].examRecords).toEqual(setup.saved.data?.classes[0].examRecords);
      expect(saved.data?.classes[0].students).toEqual(setup.saved.data?.classes[0].students);
      expect(saved.data?.classes[1]).toEqual(setup.saved.data?.classes[1]);
      for (const canary of canaries) expect(JSON.stringify(saved.data)).not.toContain(canary);
    } finally {
      page.off('request', observeCanary);
      await teacher.dispose();
      await browserOwner.dispose();
    }
  });
});
