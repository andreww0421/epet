import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import type { AppData } from '../../src/store/types';
import {
  E2eApiSession,
  E2E_BASE_URL,
  browserApiRequest,
  inviteAccount,
  loadBrowserState,
  openConsoleWithApiSession,
  performSyncedAction,
  selectDashboardTab,
  testAccount,
  waitForBackendSync,
} from './support/fixtures';

let privacyOwner: E2eApiSession;
const names = ['PrivacyLearnerAlpha', 'PrivacyLearnerBeta', 'PrivacyLearnerKeeper'];

const seedWorkspace = async (name: string, withSecondClass = false) => {
  const created = await privacyOwner.createWorkspace(name);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Privacy test workspace is missing');
  const snapshot = await privacyOwner.loadState(workspaceId);
  if (!snapshot.data?.classes[0]) throw new Error('Privacy test class is missing');
  const now = Date.now();
  const original = snapshot.data.classes[0];
  const students = names.map((studentName, index) => ({
    ...createEnrolledStudent({ id: `privacy-student-${index}`, name: studentName }),
    pointAdjustmentRecords: [{
      id: `privacy-feedback-${index}`, source: 'manual' as const,
      amount: 5, reasonLabel: `PRIVATE_REASON_${index}`, createdAt: now,
    }],
  }));
  const classroom = {
    ...original,
    name: 'Privacy current class',
    students,
    learningEvidenceRecords: students.map((student, index) => ({
      id: `privacy-evidence-${index}`, classId: original.id, studentId: student.id,
      competency: 'growth' as const, level: 'progressing' as const,
      evidenceType: 'observation' as const, actor: 'mentor' as const,
      source: 'manual' as const, title: `PRIVATE_EVIDENCE_${index}`,
      note: `PRIVATE_NOTE_${index}`, rubricVersion: 'v1', revision: 1,
      createdAt: now,
    })),
    examRecords: [{
      id: 'privacy-exam', title: 'PRIVATE_EXAM_TITLE',
      examDate: new Date(now).toISOString().slice(0, 10),
      items: [{ id: 'item', name: 'PRIVATE_EXAM_ITEM', maxScore: 100 }],
      results: students.map((student, index) => ({
        studentId: student.id, scores: { item: 51 + index },
        mentorComment: `PRIVATE_EXAM_COMMENT_${index}`, updatedAt: now,
      })),
      createdAt: now, updatedAt: now,
    }],
  };
  const otherClass = { ...structuredClone(classroom), id: 'privacy-second-class',
    name: 'Privacy archive class',
    students: [createEnrolledStudent({ id: 'privacy-archived-learner', name: 'Privacy archived learner' })],
    learningEvidenceRecords: [], examRecords: [] };
  const data: AppData = {
    ...snapshot.data,
    settings: { ...snapshot.data.settings!, inclusiveMode: false,
      publicNameMode: 'full', publicLeaderboardMode: 'rank' },
    classes: withSecondClass ? [classroom, otherClass] : [classroom],
    currentClassId: classroom.id,
  };
  await privacyOwner.saveState(data, snapshot.revision, workspaceId);
  return { workspaceId, classId: classroom.id, otherClassId: otherClass.id, students };
};

const openPrivacy = async (page: Page, session = privacyOwner, tab = '學生資料') => {
  await openConsoleWithApiSession(page, session);
  await selectDashboardTab(page, '資料治理');
  await page.getByRole('tab', { name: tab, exact: true }).click();
};

const downloadJson = async (page: Page, button: string) => {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  if (!path) throw new Error('Privacy export download is missing');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
};

const confirmStudentAction = async (
  page: Page,
  action: 'delete' | 'anonymize',
) => {
  const dialog = page.getByRole('dialog', {
    name: action === 'delete' ? '刪除學生資料' : '匿名化學生', exact: true,
  });
  const final = dialog.getByRole('button', {
    name: action === 'delete' ? '確認刪除' : '確認匿名化', exact: true,
  });
  await expect(final).toBeDisabled();
  await dialog.getByLabel('我已了解此操作的影響', { exact: true }).check();
  await expect(final).toBeDisabled();
  await dialog.getByLabel('輸入確認文字', { exact: true }).fill(
    action === 'delete' ? 'DELETE STUDENT' : 'ANONYMIZE STUDENT',
  );
  await expect(final).toBeEnabled();
  const completed = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(`/privacy/${action}`) &&
    response.request().method() === 'POST');
  await final.click();
  expect((await completed).status()).toBe(200);
  // The server response becomes the next authoritative browser state; no stale
  // optimistic draft may resurrect data after a sensitive operation.
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await waitForBackendSync(page);
};

const newSessionPage = async (browser: Browser, session: E2eApiSession) => {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  await openConsoleWithApiSession(page, session);
  return { context, page };
};

test.describe('Data and Privacy management', () => {
  test.beforeAll(async () => {
    privacyOwner = await E2eApiSession.register(testAccount('privacy-owner'));
  });
  test.afterAll(async () => { await privacyOwner.dispose(); });

  test('owner workspace exports, retention details and reversible class archival are accountable', async ({ context, page }) => {
    const { workspaceId, otherClassId } = await seedWorkspace('Privacy workspace lifecycle', true);
    await openPrivacy(page, privacyOwner, '工作區資料');
    await expect(page.getByRole('heading', { name: '目前資料保存行為', exact: true })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: '工作區資料', exact: true }))
      .toContainText('不是 25 天');
    const exported = JSON.stringify(await downloadJson(page, '下載工作區隱私資料 JSON'));
    for (const expected of names) expect(exported.includes(expected)).toBe(true);
    const before = await loadBrowserState(context, workspaceId);
    const trigger = page.getByRole('button', { name: '封存班級 Privacy archive class', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '確認封存班級', exact: true });
    await expect(dialog.getByRole('button', { name: '確認封存', exact: true })).toBeDisabled();
    await expect(dialog).toContainText(/刪除|保留/);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(await loadBrowserState(context, workspaceId)).toEqual(before);
    await trigger.click();
    await page.getByRole('dialog', { name: '確認封存班級', exact: true })
      .getByLabel('輸入 ARCHIVE CLASS', { exact: true }).fill('ARCHIVE CLASS');
    const archived = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/privacy/archive') &&
      response.request().method() === 'POST');
    await page.getByRole('dialog', { name: '確認封存班級', exact: true })
      .getByRole('button', { name: '確認封存', exact: true }).click();
    expect((await archived).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await waitForBackendSync(page);
    await expect(page.locator('#classSelect option')).toHaveCount(1);
    const archivedState = await loadBrowserState(context, workspaceId);
    expect(archivedState.data?.classes.find((classroom) => classroom.id === otherClassId)?.archivedAt).toBeGreaterThan(0);
    expect(archivedState.data?.classes[0].students).toEqual(before.data?.classes[0].students);
    expect(archivedState.data?.classes.find((classroom) => classroom.id === otherClassId)?.students)
      .toEqual(before.data?.classes.find((classroom) => classroom.id === otherClassId)?.students);
    await selectDashboardTab(page, '資料治理');
    await page.getByRole('tab', { name: '工作區資料', exact: true }).click();
    await expect(page.getByRole('heading', { name: '封存班級', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重新開啟班級 Privacy archive class', exact: true }).click();
    const reopening = page.getByRole('dialog', { name: '確認重新開啟班級', exact: true });
    await expect(reopening.getByRole('button', { name: '確認重新開啟', exact: true })).toBeDisabled();
    await reopening.getByLabel('輸入 REOPEN CLASS', { exact: true }).fill('REOPEN CLASS');
    const reopened = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/privacy/reopen') &&
      response.request().method() === 'POST');
    await reopening.getByRole('button', { name: '確認重新開啟', exact: true }).click();
    expect((await reopened).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await waitForBackendSync(page);
    await expect(page.locator('#classSelect option')).toHaveCount(2);
    const reopenedState = await loadBrowserState(context, workspaceId);
    expect(reopenedState.data?.classes.find((classroom) => classroom.id === otherClassId)?.archivedAt).toBeUndefined();
    expect(reopenedState.data?.classes.find((classroom) => classroom.id === otherClassId)?.students)
      .toEqual(before.data?.classes.find((classroom) => classroom.id === otherClassId)?.students);
    await selectDashboardTab(page, '資料治理');
    await page.getByRole('tab', { name: '稽核軌跡', exact: true }).click();
    for (const action of ['workspace.privacy.export', 'class.privacy.archive', 'class.privacy.reopen']) {
      await expect(page.getByText(action, { exact: true })).toBeVisible();
    }
  });

  test('owner can export only one learner and exports are visible in the audit trail', async ({ page }) => {
    const { workspaceId, students } = await seedWorkspace('Privacy export workspace');
    await openPrivacy(page);
    const panel = page.getByRole('tabpanel', { name: '學生資料', exact: true });
    await panel.getByRole('combobox').last().selectOption(students[0].id);
    const exported = await downloadJson(page, '下載限縮 JSON');
    const serialized = JSON.stringify(exported);
    expect(serialized.includes(names[0])).toBe(true);
    expect(serialized.includes('PRIVATE_EVIDENCE_0')).toBe(true);
    expect(serialized.includes('PRIVATE_EXAM_COMMENT_0')).toBe(true);
    for (const forbidden of [names[1], names[2], students[1].id, students[2].id,
      'PRIVATE_EVIDENCE_1', 'PRIVATE_EXAM_COMMENT_2']) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
    await page.getByRole('tab', { name: '稽核軌跡', exact: true }).click();
    await page.getByRole('button', { name: '重新載入', exact: true }).click();
    await expect(page.getByText('student.privacy.export', { exact: true })).toBeVisible();
    const current = await privacyOwner.loadState(workspaceId);
    expect(current.data?.classes[0].students).toHaveLength(3);
  });

  test('admin destructive student actions require two confirmations and preserve other learners', async ({ browser }) => {
    const { workspaceId, classId, students } = await seedWorkspace('Privacy student lifecycle');
    const admin = await inviteAccount(privacyOwner, workspaceId,
      testAccount('privacy-admin'), 'admin', []);
    const { context, page } = await newSessionPage(browser, admin);
    try {
      await selectDashboardTab(page, '資料治理');
      await page.getByRole('tab', { name: '學生資料', exact: true }).click();
      const before = await loadBrowserState(context, workspaceId);
      const protectedStudent = before.data?.classes[0].students.find((student) => student.id === students[2].id);
      const protectedEvidence = before.data?.classes[0].learningEvidenceRecords?.find((record) => record.studentId === students[2].id);
      const protectedResult = before.data?.classes[0].examRecords?.[0].results.find((result) => result.studentId === students[2].id);
      const selector = page.getByRole('tabpanel', { name: '學生資料', exact: true })
        .getByRole('combobox').last();
      await selector.selectOption(students[0].id);
      const anonymousTrigger = page.getByRole('button', { name: '檢查匿名化學生', exact: true });
      await anonymousTrigger.click();
      const cancelled = page.getByRole('dialog', { name: '匿名化學生', exact: true });
      await expect(cancelled).toContainText(/教學|學習證據|評量/);
      await expect(cancelled.getByRole('button', { name: '確認匿名化', exact: true })).toBeDisabled();
      await cancelled.getByRole('button', { name: '取消', exact: true }).click();
      expect(await loadBrowserState(context, workspaceId)).toEqual(before);

      // A confirmation reviewed before another administrator's edit must not
      // silently apply to the changed target, even with a freshly read revision.
      await anonymousTrigger.click();
      const staleReview = page.getByRole('dialog', { name: '匿名化學生', exact: true });
      const remote = await privacyOwner.loadState(workspaceId);
      if (!remote.data) throw new Error('Remote privacy workspace is missing');
      await privacyOwner.saveState({
        ...remote.data,
        classes: remote.data.classes.map((classroom) => ({
          ...classroom,
          students: classroom.students.map((student) => student.id === students[0].id
            ? { ...student, name: 'PrivacyRenamedLearner' } : student),
        })),
      }, remote.revision, workspaceId);
      await staleReview.getByLabel('我已了解此操作的影響', { exact: true }).check();
      await staleReview.getByLabel('輸入確認文字', { exact: true }).fill('ANONYMIZE STUDENT');
      await staleReview.getByRole('button', { name: '確認匿名化', exact: true }).click();
      await expect(staleReview.getByRole('alert')).toContainText('所選資料已變更');
      const rejected = await privacyOwner.loadState(workspaceId);
      expect(rejected.revision).toBe(remote.revision + 1);
      expect(rejected.data?.classes[0].students).toHaveLength(3);
      expect(rejected.data?.classes[0].students.find((student) => student.id === students[0].id)?.name)
        .toBe('PrivacyRenamedLearner');
      expect(rejected.data?.classes[0].students.some((student) => student.name === 'Anonymous student')).toBe(false);
      await staleReview.getByRole('button', { name: '取消', exact: true }).click();
      if (!rejected.data) throw new Error('Reviewed privacy workspace is missing');
      await privacyOwner.saveState({
        ...rejected.data,
        classes: rejected.data.classes.map((classroom) => ({
          ...classroom,
          students: classroom.students.map((student) => student.id === students[0].id
            ? { ...student, name: names[0] } : student),
        })),
      }, rejected.revision, workspaceId);
      await page.reload();
      await waitForBackendSync(page);
      await selectDashboardTab(page, '資料治理');
      await page.getByRole('tab', { name: '學生資料', exact: true }).click();
      await anonymousTrigger.click();
      await confirmStudentAction(page, 'anonymize');
      const anonymous = await loadBrowserState(context, workspaceId);
      expect(anonymous.data?.classes[0].students.some((student) => student.id === students[0].id)).toBe(false);
      expect(anonymous.data?.classes[0].students.some((student) => student.name === 'Anonymous student')).toBe(true);
      expect(JSON.stringify(anonymous.data).includes(names[0])).toBe(false);
      expect(JSON.stringify(anonymous.data).includes('PRIVATE_EVIDENCE_0')).toBe(false);
      expect(anonymous.data?.classes[0].examRecords?.[0].results.some((result) => result.studentId === students[0].id)).toBe(false);

      await selectDashboardTab(page, '資料治理');
      await page.getByRole('tab', { name: '學生資料', exact: true }).click();
      await page.getByRole('tabpanel', { name: '學生資料', exact: true })
        .getByRole('combobox').last().selectOption(students[1].id);
      await page.getByRole('button', { name: '檢查刪除學生資料', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '刪除學生資料', exact: true }))
        .toContainText(/復原|永久/);
      await confirmStudentAction(page, 'delete');
      const deleted = await loadBrowserState(context, workspaceId);
      const remaining = deleted.data?.classes.find((classroom) => classroom.id === classId);
      expect(remaining?.students).toHaveLength(2);
      expect(remaining?.students.some((student) => student.id === students[1].id)).toBe(false);
      expect(remaining?.learningEvidenceRecords?.some((record) => record.studentId === students[1].id)).toBe(false);
      expect(remaining?.examRecords?.[0].results.some((result) => result.studentId === students[1].id)).toBe(false);
      expect(remaining?.students.find((student) => student.id === students[2].id)).toEqual(protectedStudent);
      expect(remaining?.learningEvidenceRecords?.find((record) => record.studentId === students[2].id)).toEqual(protectedEvidence);
      expect(remaining?.examRecords?.[0].results.find((result) => result.studentId === students[2].id)).toEqual(protectedResult);
      await selectDashboardTab(page, '資料治理');
      await page.getByRole('tab', { name: '稽核軌跡', exact: true }).click();
      await expect(page.getByText('student.privacy.anonymize', { exact: true })).toBeVisible();
      await expect(page.getByText('student.privacy.delete', { exact: true })).toBeVisible();
      await page.reload();
      await waitForBackendSync(page);
      expect((await loadBrowserState(context, workspaceId)).data).toEqual(deleted.data);
    } finally {
      await context.close();
      await admin.dispose();
    }
  });

  test('teacher and viewer cannot invoke privacy administration directly', async ({ browser }) => {
    const { workspaceId, classId, students } = await seedWorkspace('Privacy role enforcement', true);
    const before = await privacyOwner.loadState(workspaceId);
    for (const role of ['teacher', 'viewer'] as const) {
      const session = await inviteAccount(privacyOwner, workspaceId,
        testAccount(`privacy-${role}`), role, [classId]);
      const { context, page } = await newSessionPage(browser, session);
      try {
        await expect(page.getByRole('navigation', { name: 'Teacher Console', exact: true })
          .getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
        await expect(page.getByRole('tab', { name: '資料治理', exact: true })).toHaveCount(0);
        const studentBase = `/api/v1/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(students[0].id)}/privacy`;
        for (const path of [`${studentBase}/export`, '/api/v1/privacy/export', '/api/v1/audit']) {
          expect((await browserApiRequest(context, path, { workspaceId })).status()).toBe(403);
        }
        for (const [path, confirmation] of [
          [`${studentBase}/delete`, 'DELETE STUDENT'],
          [`${studentBase}/anonymize`, 'ANONYMIZE STUDENT'],
          [`/api/v1/classes/${encodeURIComponent(classId)}/privacy/archive`, 'ARCHIVE CLASS'],
        ]) {
          const response = await browserApiRequest(context, path, {
            workspaceId, method: 'POST',
            body: { expectedRevision: before.revision, confirmation },
          });
          expect(response.status()).toBe(403);
        }
        const visible = await loadBrowserState(context, workspaceId);
        if (!visible.data) throw new Error('Authorized class state is missing');
        const removal = await browserApiRequest(context, '/api/v1/state', {
          workspaceId, method: 'PUT',
          body: { baseRevision: visible.revision, data: {
            ...visible.data,
            classes: visible.data.classes.map((classroom) => ({
              ...classroom,
              students: classroom.students.filter((student) => student.id !== students[0].id),
            })),
          } },
        });
        // A teacher's ordinary edit contract must not become an alternative
        // privacy-delete API merely by submitting a smaller roster.
        expect(removal.status()).toBe(403);
      } finally {
        await context.close();
        await session.dispose();
      }
    }
    expect((await privacyOwner.loadState(workspaceId)).data).toEqual(before.data);
  });

  test('classroom privacy settings persist and cannot be bypassed in presentation mode', async ({ context, page }) => {
    const { workspaceId } = await seedWorkspace('Privacy public classroom');
    await openPrivacy(page, privacyOwner, '隱私與保存');
    await expect(page.getByRole('tabpanel', { name: '隱私與保存', exact: true }))
      .toContainText(/Cloudflare|D1/);
    await page.getByRole('button', { name: '管理學生顯示與隱私設定', exact: true }).click();
    // These existing workspace privacy controls remain part of Data governance;
    // the display reads their server-synchronized values rather than local flags.
    await page.getByLabel('公開姓名', { exact: true }).selectOption('masked');
    await page.getByLabel('公開榮譽榜', { exact: true }).selectOption('hidden');
    await performSyncedAction(page, () => page.getByRole('button', { name: '儲存設定', exact: true }).click());
    const saved = await loadBrowserState(context, workspaceId);
    expect(saved.data?.settings?.publicNameMode).toBe('masked');
    expect(saved.data?.settings?.publicLeaderboardMode).toBe('hidden');
    await page.getByRole('button', { name: '展示大廳', exact: true }).click();
    await expect(page.locator('[data-presentation-mode="true"]')).toBeVisible();
    const mask = page.getByRole('checkbox', { name: '遮罩學生姓名', exact: true });
    await expect(mask).toBeChecked();
    await expect(mask).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: '包容性排行榜', exact: true })).toBeDisabled();
    for (const forbidden of [...names, 'PRIVATE_EVIDENCE_0', 'PRIVATE_EXAM_COMMENT_0']) {
      await expect(page.getByText(forbidden, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('navigation', { name: 'Teacher Console', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '資料治理', exact: true })).toHaveCount(0);
  });
});
