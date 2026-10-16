import { expect, test, type Page } from '@playwright/test';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import { STORAGE_KEY } from '../../src/store/constants';
import {
  E2eApiSession,
  browserApiRequest,
  openConsoleWithApiSession,
  selectDashboardTab,
  testAccount,
  waitForBackendSync,
} from './support/fixtures';

let owner: E2eApiSession;
const seed = async (name: string) => {
  const created = await owner.createWorkspace(name);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Synthetic lifecycle workspace missing');
  const snapshot = await owner.loadState(workspaceId);
  if (!snapshot.data?.classes[0]) throw new Error('Synthetic lifecycle class missing');
  const now = Date.now();
  const classroom = { ...snapshot.data.classes[0], name: 'Lifecycle historical class',
    students: [createEnrolledStudent({ id: 'lifecycle-learner', name: 'Lifecycle learner' })],
    learningEvidenceRecords: [{ id: 'lifecycle-evidence', classId: snapshot.data.classes[0].id,
      studentId: 'lifecycle-learner', title: 'Retained lifecycle evidence', note: 'Retained teaching note',
      competency: 'growth' as const, level: 'progressing' as const, evidenceType: 'observation' as const,
      actor: 'mentor' as const, source: 'manual' as const, rubricVersion: 'v1', revision: 1, createdAt: now }],
    examRecords: [{ id: 'lifecycle-exam', title: 'Retained lifecycle exam', examDate: '2026-10-14',
      items: [{ id: 'item', name: 'Synthetic item', maxScore: 100 }],
      results: [{ studentId: 'lifecycle-learner', scores: { item: 85 }, mentorComment: 'Retained exam feedback', updatedAt: now }],
      createdAt: now, updatedAt: now }],
  };
  await owner.saveState({ ...snapshot.data,
    settings: { ...snapshot.data.settings!, decayAmount: 0 },
    classes: [classroom, { ...snapshot.data.classes[0], id: 'lifecycle-active-class', name: 'Lifecycle active class', students: [] }],
    currentClassId: classroom.id,
  }, snapshot.revision, workspaceId);
  return { workspaceId, classId: classroom.id };
};
const openLifecycle = async (page: Page) => {
  await selectDashboardTab(page, '資料治理');
  await page.getByRole('tab', { name: '工作區資料', exact: true }).click();
};
const confirmArchive = async (page: Page, kind: 'archive' | 'reopen') => {
  const dialog = page.getByRole('dialog', { name: kind === 'archive' ? '確認封存班級' : '確認重新開啟班級', exact: true });
  await dialog.getByLabel(kind === 'archive' ? '輸入 ARCHIVE CLASS' : '輸入 REOPEN CLASS', { exact: true })
    .fill(kind === 'archive' ? 'ARCHIVE CLASS' : 'REOPEN CLASS');
  const response = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/privacy/${kind}`) && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: kind === 'archive' ? '確認封存' : '確認重新開啟', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await waitForBackendSync(page);
};
const confirmDeletion = async (page: Page) => {
  const dialog = page.getByRole('dialog', { name: '永久刪除班級', exact: true });
  const button = dialog.getByRole('button', { name: '確認永久刪除', exact: true });
  await expect(button).toBeDisabled();
  await expect(dialog).toContainText('無法使用應用程式 revision 復原');
  await dialog.getByLabel('輸入 DELETE CLASS', { exact: true }).fill('DELETE CLASS');
  await expect(button).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(button).toBeEnabled();
  const response = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/privacy/delete') && r.request().method() === 'POST');
  await button.click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await waitForBackendSync(page);
};

test.beforeAll(async () => { owner = await E2eApiSession.register(testAccount('lifecycle-owner')); });
test.afterAll(async () => { await owner.dispose(); });

test('archived classes leave teaching, preserve read-only learning/exam history and restore intact', async ({ page }) => {
  const { workspaceId, classId } = await seed('Synthetic archive history');
  await openConsoleWithApiSession(page, owner);
  const before = await owner.loadState(workspaceId);
  const original = before.data!.classes.find((item) => item.id === classId)!;
  await openLifecycle(page);
  await page.getByRole('button', { name: '封存班級 Lifecycle historical class', exact: true }).click();
  await confirmArchive(page, 'archive');
  await expect(page.locator('#classSelect option')).toHaveCount(1);
  const archived = await owner.loadState(workspaceId);
  expect(archived.data!.classes.find((item) => item.id === classId)).toEqual({ ...original, archivedAt: expect.any(Number) });
  await openLifecycle(page);
  await page.getByRole('button', { name: '檢視封存歷史 Lifecycle historical class', exact: true }).click();
  const history = page.getByRole('region', { name: '封存班級歷史', exact: true });
  await expect(history).toContainText('Retained lifecycle evidence');
  await expect(history).toContainText('Retained teaching note');
  await expect(history).toContainText('Retained lifecycle exam');
  await expect(history).toContainText('85%');
  await history.getByText('Lifecycle learner · 項目分析與教師評語', { exact: true }).click();
  await expect(history).toContainText('Retained exam feedback');
  await expect(history.getByRole('button')).toHaveCount(1);
  await expect(history.getByRole('button', { name: '關閉歷史檢視', exact: true })).toBeVisible();
  await expect(history.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: '重新開啟班級 Lifecycle historical class', exact: true }).click();
  await confirmArchive(page, 'reopen');
  await expect(page.locator('#classSelect option')).toHaveCount(2);
  expect((await owner.loadState(workspaceId)).data!.classes.find((item) => item.id === classId)).toEqual(original);
});

test('archive deletion requires higher-risk confirmation, keeps audit and purges retained revisions', async ({ context, page }) => {
  const { workspaceId, classId } = await seed('Synthetic archive deletion');
  await openConsoleWithApiSession(page, owner);
  await openLifecycle(page);
  await page.getByRole('button', { name: '封存班級 Lifecycle historical class', exact: true }).click();
  await confirmArchive(page, 'archive');
  await openLifecycle(page);
  const before = await owner.loadState(workspaceId);
  await page.getByRole('button', { name: '永久刪除班級 Lifecycle historical class', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(await owner.loadState(workspaceId)).toEqual(before);
  await page.getByRole('button', { name: '永久刪除班級 Lifecycle historical class', exact: true }).click();
  await confirmDeletion(page);
  expect((await owner.loadState(workspaceId)).data!.classes.some((item) => item.id === classId)).toBe(false);
  const revisions = await browserApiRequest(context, '/api/v1/revisions', { workspaceId });
  expect(revisions.status()).toBe(200);
  const listed = await revisions.json() as { revisions: Array<{ revision: number }> };
  expect(listed.revisions.length).toBeGreaterThan(0);
  for (const { revision } of listed.revisions) {
    const response = await browserApiRequest(context, `/api/v1/revisions/${revision}`, { workspaceId });
    expect(response.status()).toBe(200);
    const snapshot = await response.json() as { snapshot: { data: { classes: Array<{ id: string }> } } };
    expect(snapshot.snapshot.data.classes.some((item) => item.id === classId)).toBe(false);
  }
  await openLifecycle(page);
  await page.getByRole('tab', { name: '稽核軌跡', exact: true }).click();
  await expect(page.getByText('class.privacy.delete', { exact: true })).toBeVisible();
  await expect(page.getByText('privacy.class.purge', { exact: true })).toBeVisible();
});

test('legacy class management deletion uses the same authorized high-risk server lifecycle', async ({ page }) => {
  const { workspaceId, classId } = await seed('Synthetic legacy class deletion');
  await openConsoleWithApiSession(page, owner);
  await selectDashboardTab(page, '學生');
  await page.getByRole('button', { name: '刪除班級', exact: true }).click();
  await confirmDeletion(page);
  const state = await owner.loadState(workspaceId);
  expect(state.data!.classes.some((item) => item.id === classId)).toBe(false);
  expect(state.data!.currentClassId).toBe('lifecycle-active-class');
});

test('full JSON backup recovery requires reviewed replacement and restores archived history through the server', async ({ page }) => {
  const { workspaceId, classId } = await seed('Synthetic full backup recovery');
  await openConsoleWithApiSession(page, owner);
  await openLifecycle(page);
  const before = await owner.loadState(workspaceId);
  const historical = before.data!.classes.find((item) => item.id === classId)!;
  const active = before.data!.classes.find((item) => item.id === 'lifecycle-active-class')!;
  const backup = {
    ...before.data!,
    classes: [
      { ...historical, archivedAt: Date.now() - 1_000 },
      { ...active, id: 'lifecycle-backup-active', name: 'Restored backup active class' },
    ],
    currentClassId: 'lifecycle-backup-active',
  };
  const uploadBackup = async () => {
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '匯入 JSON', exact: true }).click();
    await (await choosing).setFiles({
      name: 'synthetic-class-backup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  };
  await uploadBackup();
  const review = page.getByRole('dialog', { name: '檢查工作區匯入', exact: true });
  await expect(review).toContainText('備份資料：2 個班級（1 個已封存）');
  await review.getByRole('button', { name: '取消', exact: true }).click();
  expect(await owner.loadState(workspaceId)).toEqual(before);

  await uploadBackup();
  await expect(review).toContainText('無法依靠 revision 復原');
  const confirm = review.getByRole('button', { name: '確認取代工作區', exact: true });
  await expect(confirm).toBeDisabled();
  await review.getByLabel('輸入 IMPORT WORKSPACE', { exact: true }).fill('IMPORT WORKSPACE');
  await expect(confirm).toBeDisabled();
  await review.getByRole('checkbox', { name: '我了解目前工作區資料會被取代及清除', exact: true }).check();
  await expect(confirm).toBeEnabled();
  const imported = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/workspace/import' && response.request().method() === 'POST');
  await confirm.click();
  const response = await imported;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({
    confirmation: 'IMPORT WORKSPACE', acknowledgeReplacement: true,
    expectedRevision: before.revision,
  });
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await waitForBackendSync(page);
  const restored = await owner.loadState(workspaceId);
  expect(restored.data!.classes).toEqual(backup.classes);
  expect(restored.data!.settings).toEqual(backup.settings);
  expect(restored.data!.currentClassId).toBe(backup.currentClassId);
  await expect(page.locator('#classSelect option')).toHaveCount(1);
  await expect(page.locator('#classSelect option:checked')).toHaveText('Restored backup active class');
  await openLifecycle(page);
  await page.getByRole('button', { name: '檢視封存歷史 Lifecycle historical class', exact: true }).click();
  const history = page.getByRole('region', { name: '封存班級歷史', exact: true });
  await expect(history).toContainText('Retained lifecycle evidence');
  await expect(history).toContainText('Retained lifecycle exam');
  await history.getByText('Lifecycle learner · 項目分析與教師評語', { exact: true }).click();
  await expect(history).toContainText('Retained exam feedback');
  await page.getByRole('tab', { name: '稽核軌跡', exact: true }).click();
  await expect(page.getByText('workspace.privacy.import', { exact: true })).toBeVisible();
});

test('full backup review rejects a newer revision even when class and record counts are unchanged', async ({ page }) => {
  const { workspaceId, classId } = await seed('Synthetic stale backup review');
  await openConsoleWithApiSession(page, owner);
  await openLifecycle(page);
  const before = await owner.loadState(workspaceId);
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '匯入 JSON', exact: true }).click();
  await (await choosing).setFiles({
    name: 'synthetic-stale-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(before.data)),
  });
  const review = page.getByRole('dialog', { name: '檢查工作區匯入', exact: true });
  await expect(review).toBeVisible();
  const winning = await owner.saveState({
    ...before.data!,
    classes: before.data!.classes.map((classroom) => classroom.id === classId ? {
      ...classroom,
      students: classroom.students.map((student) => ({ ...student, points: student.points + 7 })),
    } : classroom),
  }, before.revision, workspaceId);
  const importRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/workspace/import' && request.method() === 'POST') {
      importRequests.push(request.url());
    }
  });
  await review.getByLabel('輸入 IMPORT WORKSPACE', { exact: true }).fill('IMPORT WORKSPACE');
  await review.getByRole('checkbox', { name: '我了解目前工作區資料會被取代及清除', exact: true }).check();
  await review.getByRole('button', { name: '確認取代工作區', exact: true }).click();
  await expect(review.getByRole('alert')).toHaveText('所選資料已變更。請取消、重新載入並再次檢查對象。');
  expect(importRequests).toEqual([]);
  expect(await owner.loadState(workspaceId)).toEqual(winning);
  await review.getByRole('button', { name: '取消', exact: true }).click();
  expect(await owner.loadState(workspaceId)).toEqual(winning);
});

test('legacy local backup review waits for an in-flight settings save and imports through the server', async ({ page }) => {
  const created = await owner.createWorkspace('Synthetic legacy backup pending save');
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Synthetic legacy migration workspace missing');
  const initial = await owner.loadState(workspaceId);
  if (!initial.data?.classes[0]) throw new Error('Synthetic legacy migration class missing');
  const legacyData = {
    ...initial.data,
    settings: { ...initial.data.settings!, decayAmount: 0 },
    classes: [{
      ...initial.data.classes[0], id: 'legacy-backup-class', name: 'Legacy restored classroom',
      students: [createEnrolledStudent({ id: 'legacy-backup-learner', name: 'Legacy restored learner' })],
    }],
    currentClassId: 'legacy-backup-class',
  };
  await page.addInitScript(({ key, data }) => {
    localStorage.setItem(key, JSON.stringify({ state: { data } }));
  }, { key: STORAGE_KEY, data: legacyData });
  await openConsoleWithApiSession(page, owner);
  const migration = page.getByRole('region', { name: '找到這台裝置上的舊版班級資料', exact: true });
  await expect(migration.getByRole('button', { name: '匯入目前帳號', exact: true })).toBeEnabled();
  let releaseSave = () => {};
  let observeSave = () => {};
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const saveObserved = new Promise<void>((resolve) => { observeSave = resolve; });
  let holdSave = true;
  await page.route('**/api/v1/state', async (route) => {
    if (route.request().method() === 'PUT' && holdSave) {
      holdSave = false;
      observeSave();
      await saveGate;
    }
    await route.continue();
  });
  try {
    await selectDashboardTab(page, '規則');
    const pendingMaxPoints = (initial.data.settings?.maxPoints ?? 500) + 1;
    await page.getByLabel('總積分上限', { exact: true }).fill(String(pendingMaxPoints));
    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/state' && response.request().method() === 'PUT');
    await page.getByRole('button', { name: '儲存設定', exact: true }).click();
    await saveObserved;
    await migration.getByRole('button', { name: '匯入目前帳號', exact: true }).click();
    const review = page.getByRole('dialog', { name: '檢查工作區匯入', exact: true });
    await expect(review).not.toBeVisible();
    releaseSave();
    expect((await saved).status()).toBe(200);
    await expect(review).toBeVisible();
    const synchronized = await owner.loadState(workspaceId);
    expect(synchronized.data!.settings!.maxPoints).toBe(pendingMaxPoints);
    await review.getByLabel('輸入 IMPORT WORKSPACE', { exact: true }).fill('IMPORT WORKSPACE');
    await review.getByRole('checkbox', { name: '我了解目前工作區資料會被取代及清除', exact: true }).check();
    const imported = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/workspace/import' && response.request().method() === 'POST');
    await review.getByRole('button', { name: '確認取代工作區', exact: true }).click();
    const response = await imported;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ expectedRevision: synchronized.revision });
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await waitForBackendSync(page);
    const restored = await owner.loadState(workspaceId);
    expect(restored.data!.classes.map((classroom) => classroom.id)).toEqual(['legacy-backup-class']);
    expect(restored.data!.classes[0].students.map((student) => student.name)).toEqual(['Legacy restored learner']);
    expect(restored.data!.settings!.maxPoints).toBe(legacyData.settings.maxPoints);
  } finally {
    releaseSave();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
