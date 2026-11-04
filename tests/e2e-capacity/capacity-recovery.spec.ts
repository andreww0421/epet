import { expect, test, type Page, type Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AppData } from '../../src/store/types';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import { normalizeAppData } from '../../src/store/utils';
import { MAX_D1_STATE_BYTES } from '../../shared/domain/repositoryPolicy';
import {
  E2E_BASE_URL, E2eApiSession, inviteAccount,
  openConsoleWithApiSession, selectDashboardTab, switchWorkspaceViaUi, testAccount, waitForBackendSync,
} from '../e2e/support/fixtures';

let owner: E2eApiSession;
test.beforeAll(async () => { owner = await E2eApiSession.register(testAccount('capacity-owner')); });
test.afterAll(async () => { await owner.dispose(); });
const size = (data: AppData) => Buffer.byteLength(JSON.stringify(data), 'utf8');
const fixture = async (label: string, nearLimit = false, privateClass = false) => {
  const created = await owner.createWorkspace(`Synthetic capacity ${label}`);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Synthetic capacity workspace is missing');
  const initial = await owner.loadState(workspaceId);
  if (!initial.data?.classes[0]) throw new Error('Synthetic class template is missing');
  const classAId = initial.data.classes[0].id;
  const classBId = `${workspaceId}-private-b`;
  const timestamp = Date.now();
  const students = ['Alice', 'Bob'].map((name, studentIndex) => ({
    ...createEnrolledStudent({ id: String(100 + studentIndex), name: `${name}-${label}` }),
    pointAdjustmentRecords: nearLimit ? Array.from({ length: 110 }, (_, index) => ({
      id: `synthetic-point-${studentIndex}-${index}`, amount: 1, source: 'manual' as const,
      createdAt: timestamp, reasonLabel: '',
    })) : [],
  }));
  const classroom = { ...initial.data.classes[0], name: 'Synthetic Class A', students,
    learningEvidenceRecords: [], examRecords: [], classGoals: [], activeBoss: undefined };
  const otherClass = { ...structuredClone(classroom), id: classBId, name: `PRIVATE-CLASS-B-${label}`,
    students: [{ ...createEnrolledStudent({ id: '100', name: `PRIVATE-BOB-${label}` }), points: 73 }] };
  const data = normalizeAppData({ ...initial.data, currentClassId: classAId,
    classes: privateClass ? [classroom, otherClass] : [classroom] }, timestamp);
  if (nearLimit) {
    // All padding is legitimate retained point-history text, each field within
    // the 4096-character schema bound. No huge object, dropped extension or
    // direct Store injection is used to manufacture the actual D1 rejection.
    let remaining = MAX_D1_STATE_BYTES - 200 - size(data);
    for (const student of data.classes[0].students) {
      for (const record of student.pointAdjustmentRecords ?? []) {
        const length = Math.min(4_096, remaining);
        record.reasonLabel = 'x'.repeat(length);
        remaining -= length;
      }
    }
    expect(remaining).toBe(0);
    expect(size(data)).toBe(MAX_D1_STATE_BYTES - 200);
  }
  const saved = await owner.saveState(data, initial.revision, workspaceId);
  expect(size(saved.data!)).toBe(size(data));
  return { workspaceId, classAId, classBId, saved };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;
const openWorkspace = async (page: Page, setup: Fixture, principal = owner) => {
  await openConsoleWithApiSession(page, principal);
  const select = page.getByRole('combobox', { name: '工作區', exact: true });
  if (await select.count() && await select.inputValue() !== setup.workspaceId) {
    await switchWorkspaceViaUi(page, setup.workspaceId);
  }
};
const findDraft = (page: Page, canary: string) => page.evaluate((name) =>
  Object.entries(sessionStorage).find(([key, value]) =>
    key.startsWith('epet-unsynced-workspace-v2:') && value.includes(name)) ?? null, canary);
const readStore = (page: Page) => page.evaluate(() =>
  (window as unknown as { __epetTestStore: { getData: () => AppData } }).__epetTestStore.getData());
const addUnsaved = async (page: Page, name: string) => {
  await selectDashboardTab(page, '學生');
  const panel = page.getByRole('heading', { name: '新增學生' }).locator('..');
  await panel.getByLabel('學生姓名').fill(name);
  await panel.getByRole('button', { name: '新增', exact: true }).click();
};
const freezeClock = async (page: Page) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now + 1_000);
};
const confirm = async (page: Page, action: () => Promise<unknown>, accept = true) => {
  const presented = page.waitForEvent('dialog');
  const initiated = action();
  const dialog = await presented;
  expect(dialog.type()).toBe('confirm');
  if (accept) await dialog.accept(); else await dialog.dismiss();
  await initiated;
};
const adoptRemote = async (page: Page) => {
  await confirm(page, () => page.getByRole('button', { name: '採用雲端最新版本', exact: true }).click());
  await waitForBackendSync(page);
};
const stateWrites = (page: Page) => {
  const writes: Request[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/state' && request.method() === 'PUT') writes.push(request);
  });
  return writes;
};
const addAndSave = async (page: Page, name: string) => {
  const saved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/state' && response.request().method() === 'PUT');
  await addUnsaved(page, name);
  expect((await saved).status()).toBe(200);
  await waitForBackendSync(page);
};
const capacityFailure = async (page: Page, setup: Fixture, canary: string, principal = owner) => {
  await openWorkspace(page, setup, principal);
  await freezeClock(page);
  const response = page.waitForResponse((result) =>
    new URL(result.url()).pathname === '/api/v1/state' && result.request().method() === 'PUT');
  await addUnsaved(page, canary);
  await page.clock.runFor(1_000);
  const rejected = await response;
  expect(rejected.status()).toBe(413);
  const body = await rejected.json();
  expect(body.error).toBe('PAYLOAD_TOO_LARGE');
  expect(body.limitBytes).toBe(MAX_D1_STATE_BYTES);
  expect(body).not.toHaveProperty('data');
  expect(body).not.toHaveProperty('dataSizeBytes');
  await expect(page.getByRole('heading', { name: '工作區容量已達上限', exact: true })).toBeVisible();
  await expect(page.getByText(/900\s*KiB/)).toBeVisible();
  expect(await findDraft(page, canary)).not.toBeNull();
  expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
  return body;
};

test.describe('D1 capacity and bounded sync recovery', () => {
  test('real 413 pauses the same draft across refresh, downloads safely and resumes after explicit adoption', async ({ page }) => {
    const setup = await fixture('adopt', true);
    const canary = 'LOCAL-CAPACITY-UNSAVED';
    const writes = stateWrites(page);
    await capacityFailure(page, setup, canary);
    expect(writes).toHaveLength(1);
    const captured = await findDraft(page, canary);
    await page.clock.runFor(120_000);
    expect(writes).toHaveLength(1);
    expect(await findDraft(page, canary)).toEqual(captured);
    await page.reload();
    await expect(page.getByRole('heading', { name: '工作區容量已達上限', exact: true })).toBeVisible();
    await page.clock.runFor(120_000);
    expect(writes).toHaveLength(1);
    expect(await findDraft(page, canary)).toEqual(captured);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '下載本機草稿', exact: true }).click();
    const path = await (await downloading).path();
    if (!path) throw new Error('Authorized synthetic draft download is missing');
    const exported = JSON.parse(await readFile(path, 'utf8')) as AppData;
    expect(JSON.stringify(exported)).toContain(canary);
    expect(size(exported)).toBeGreaterThan(MAX_D1_STATE_BYTES);
    await confirm(page, () => page.getByRole('button', { name: '採用雲端最新版本', exact: true }).click(), false);
    expect(await findDraft(page, canary)).toEqual(captured);
    await adoptRemote(page);
    expect(await findDraft(page, canary)).toBeNull();
    expect(JSON.stringify(await readStore(page))).not.toContain(canary);
    expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
    // Adopting does not send the discarded payload. A small legitimate rules
    // edit changes the snapshot without adding a student beyond its capacity.
    await page.clock.resume();
    await selectDashboardTab(page, '規則');
    const saved = page.waitForResponse((result) => new URL(result.url()).pathname === '/api/v1/state' && result.request().method() === 'PUT');
    const maximum = page.locator('#maxPoints');
    await maximum.fill('699');
    await page.getByRole('button', { name: '儲存設定', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await waitForBackendSync(page);
    const current = await owner.loadState(setup.workspaceId);
    expect(current.revision).toBe(setup.saved.revision + 1);
    expect(current.data?.settings?.maxPoints).toBe(699);
    expect(JSON.stringify(current.data)).not.toContain(canary);
  });

  test('a terminal capacity draft can be preserved while switching workspace and signing out', async ({ page }) => {
    const setup = await fixture('preserve', true);
    const target = await fixture('preserve-target');
    const canary = 'PRESERVE-CAPACITY-LOCAL';
    const writes = stateWrites(page);
    const browserSession = await E2eApiSession.login(owner.account);
    try {
      await capacityFailure(page, setup, canary, browserSession);
      const captured = await findDraft(page, canary);
      await confirm(page, () => page.getByRole('combobox', { name: '工作區', exact: true }).selectOption(target.workspaceId));
      await waitForBackendSync(page);
      expect(await findDraft(page, canary)).toEqual(captured);
      expect(JSON.stringify(await readStore(page))).not.toContain(canary);
      await page.getByRole('combobox', { name: '工作區', exact: true }).selectOption(setup.workspaceId);
      await expect(page.getByRole('heading', { name: '工作區容量已達上限', exact: true })).toBeVisible();
      await confirm(page, () => page.getByRole('button', { name: '保留草稿並登出', exact: true }).click());
      await expect(page.getByRole('button', { name: '登入並繼續帶班', exact: true })).toBeVisible();
      expect(await findDraft(page, canary)).toEqual(captured);
      expect(writes).toHaveLength(1);
      expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
      expect(await owner.loadState(target.workspaceId)).toEqual(target.saved);
    } finally { await browserSession.dispose(); }
  });

  test('an explicit cleaned import keeps the new student and lets autosave continue without silent history loss', async ({ page }) => {
    const setup = await fixture('cleanup', true);
    const canary = 'KEEP-THIS-UNSAVED-STUDENT';
    await capacityFailure(page, setup, canary);
    const local = await readStore(page);
    expect(JSON.stringify(local)).toContain(canary);
    // The owner explicitly selects a smaller synthetic text-only replacement;
    // no history entry is dropped to evade the limit. The real import route
    // enforces admin authority, confirmation, acknowledgement and Revision CAS.
    const cleaned = structuredClone(local);
    for (const student of cleaned.classes[0].students) {
      for (const record of student.pointAdjustmentRecords ?? []) record.reasonLabel = 'Owner-reviewed concise synthetic reason';
    }
    const originalRecordCount = setup.saved.data!.classes[0].students.reduce(
      (count, student) => count + (student.pointAdjustmentRecords?.length ?? 0), 0);
    const cleanedRecordCount = cleaned.classes[0].students.reduce(
      (count, student) => count + (student.pointAdjustmentRecords?.length ?? 0), 0);
    expect(cleanedRecordCount).toBe(originalRecordCount);
    expect(size(cleaned)).toBeLessThan(MAX_D1_STATE_BYTES);
    const imported = await owner.context.post('/api/v1/workspace/import', {
      headers: { cookie: owner.cookie, origin: E2E_BASE_URL, 'x-csrf-token': owner.csrfToken,
        'x-epet-workspace': setup.workspaceId },
      data: { data: cleaned, expectedRevision: setup.saved.revision,
        confirmation: 'IMPORT WORKSPACE', acknowledgeReplacement: true },
    });
    expect(imported.status()).toBe(200);
    const committed = await imported.json();
    expect(committed.revision).toBe(setup.saved.revision + 1);
    expect(JSON.stringify(committed.data)).toContain(canary);
    expect(committed.data.classes[0].students.reduce(
      (count: number, student: { pointAdjustmentRecords?: unknown[] }) =>
        count + (student.pointAdjustmentRecords?.length ?? 0), 0)).toBe(originalRecordCount);
    expect(await findDraft(page, canary)).not.toBeNull();
    await adoptRemote(page);
    expect(await findDraft(page, canary)).toBeNull();
    expect(JSON.stringify(await readStore(page))).toContain(canary);
    await page.clock.resume();
    await addAndSave(page, 'AFTER-EXPLICIT-CLEANUP');
    const saved = await owner.loadState(setup.workspaceId);
    expect(saved.revision).toBe(committed.revision + 1);
    expect(JSON.stringify(saved.data)).toContain(canary);
    expect(JSON.stringify(saved.data)).toContain('AFTER-EXPLICIT-CLEANUP');
    expect(saved.data!.classes[0].students.reduce(
      (count, student) => count + (student.pointAdjustmentRecords?.length ?? 0), 0)).toBe(originalRecordCount);
  });

  test('400 validation is terminal through timers, refresh and navigation flush', async ({ page }) => {
    const setup = await fixture('validation');
    await openWorkspace(page, setup);
    await freezeClock(page);
    const writes = stateWrites(page);
    await page.route('**/api/v1/state', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'INVALID_APP_DATA' }) });
      } else await route.continue();
    });
    const canary = 'INVALID-DRAFT-NOT-LOST';
    await addUnsaved(page, canary);
    await page.clock.runFor(1_000);
    await expect(page.getByRole('heading', { name: '資料驗證未通過', exact: true })).toBeVisible();
    await page.clock.runFor(120_000);
    expect(writes).toHaveLength(1);
    const captured = await findDraft(page, canary);
    expect(captured).not.toBeNull();
    await page.reload();
    await expect(page.getByRole('heading', { name: '資料驗證未通過', exact: true })).toBeVisible();
    await page.clock.runFor(120_000);
    expect(writes).toHaveLength(1);
    await confirm(page, () => page.getByRole('button', { name: '登出', exact: true }).click(), false);
    expect(writes).toHaveLength(1);
    expect(await findDraft(page, canary)).toEqual(captured);
    await page.unrouteAll({ behavior: 'wait' });
    await adoptRemote(page);
    await page.clock.resume();
    await addAndSave(page, 'AFTER-VALIDATION-RECOVERY');
    const saved = await owner.loadState(setup.workspaceId);
    expect(JSON.stringify(saved.data)).toContain('AFTER-VALIDATION-RECOVERY');
    expect(JSON.stringify(saved.data)).not.toContain(canary);
  });

  test('429 honors Retry-After for automatic and manual retry', async ({ page }) => {
    const setup = await fixture('rate-limit');
    await openWorkspace(page, setup);
    await freezeClock(page);
    const writes = stateWrites(page);
    let first = true;
    await page.route('**/api/v1/state', async (route) => {
      if (first && route.request().method() === 'PUT') {
        first = false;
        await route.fulfill({ status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' },
          body: JSON.stringify({ error: 'RATE_LIMITED' }) });
      } else await route.continue();
    });
    await addUnsaved(page, 'RETRY-AFTER-STUDENT');
    await page.clock.runFor(1_000);
    await expect.poll(() => writes.length).toBe(1);
    const retry = page.getByRole('button', { name: '重試同步', exact: true });
    if (await retry.isEnabled()) await retry.click();
    await page.clock.runFor(28_000);
    expect(writes).toHaveLength(1);
    await page.clock.runFor(2_000);
    await expect.poll(() => writes.length).toBe(2);
    await waitForBackendSync(page);
    const saved = await owner.loadState(setup.workspaceId);
    expect(saved.revision).toBe(setup.saved.revision + 1);
    expect(JSON.stringify(saved.data)).toContain('RETRY-AFTER-STUDENT');
  });

  test('refresh after a lost committed response retains the newer draft Retry-After deadline', async ({ page }) => {
    const setup = await fixture('uncertain-rate-limit');
    await openWorkspace(page, setup);
    await freezeClock(page);
    const writes = stateWrites(page);
    let committed!: () => void;
    const firstCommitted = new Promise<void>((resolve) => { committed = resolve; });
    let release!: () => void;
    const releaseFirst = new Promise<void>((resolve) => { release = resolve; });
    let attempts = 0;
    await page.route('**/api/v1/state', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      attempts += 1;
      if (attempts === 1) {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committed();
        await releaseFirst;
        await route.abort('failed');
      } else if (attempts === 2) {
        await route.fulfill({ status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' },
          body: JSON.stringify({ error: 'RATE_LIMITED' }) });
      } else await route.continue();
    });
    await addUnsaved(page, 'COMMITTED-RESPONSE-LOST');
    await page.clock.runFor(1_000);
    await firstCommitted;
    await addUnsaved(page, 'QUEUED-RATE-LIMITED');
    release();
    const draftState = async () => {
      const stored = await findDraft(page, 'QUEUED-RATE-LIMITED');
      return stored ? JSON.parse(stored[1]) : null;
    };
    await expect.poll(async () => (await draftState())?.syncState?.failure.kind).toBe('transient');
    await page.clock.runFor(1_000);
    await expect.poll(async () => (await draftState())?.syncState?.failure.kind).toBe('rate-limit');
    const before = await draftState();
    expect(before.syncState.retries).toBe(2);
    expect(JSON.stringify(before.uncertainData)).toContain('COMMITTED-RESPONSE-LOST');
    expect(JSON.stringify(before.uncertainData)).not.toContain('QUEUED-RATE-LIMITED');
    await page.reload();
    await expect.poll(async () => JSON.stringify(await readStore(page))).toContain('QUEUED-RATE-LIMITED');
    await expect(page.getByText('伺服器暫時限制請求，系統會等待指定時間後再重試。', { exact: true })).toBeVisible();
    expect((await draftState()).syncState).toEqual(before.syncState);
    expect(writes).toHaveLength(2);
    await page.getByRole('button', { name: '重試同步', exact: true }).click();
    await page.clock.runFor(28_000);
    expect(writes).toHaveLength(2);
    await page.clock.runFor(2_000);
    await expect.poll(() => writes.length).toBe(3);
    await waitForBackendSync(page);
    const saved = await owner.loadState(setup.workspaceId);
    expect(saved.revision).toBe(setup.saved.revision + 2);
    expect(JSON.stringify(saved.data)).toContain('COMMITTED-RESPONSE-LOST');
    expect(JSON.stringify(saved.data)).toContain('QUEUED-RATE-LIMITED');
    expect(await findDraft(page, 'QUEUED-RATE-LIMITED')).toBeNull();
  });

  for (const failure of ['network', '500'] as const) {
    test(`${failure} retries are bounded, keep the draft and can be explicitly resumed`, async ({ page }) => {
      const setup = await fixture(`retry-${failure}`);
      await openWorkspace(page, setup);
      await freezeClock(page);
      const writes = stateWrites(page);
      let failing = true;
      await page.route('**/api/v1/state', async (route) => {
        if (failing && route.request().method() === 'PUT') {
          if (failure === 'network') await route.abort('failed');
          else await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'INTERNAL_SERVER_ERROR' }) });
        } else await route.continue();
      });
      const canary = `BOUNDED-${failure}-DRAFT`;
      await addUnsaved(page, canary);
      await page.clock.runFor(1_000);
      await expect.poll(() => writes.length).toBe(1);
      for (const [index, delay] of [1_000, 2_000, 5_000, 10_000, 30_000].entries()) {
        await page.clock.runFor(delay);
        await expect.poll(() => writes.length).toBe(index + 2);
      }
      await expect(page.getByRole('heading', { name: '同步已暫停重試', exact: true })).toBeVisible();
      await page.clock.runFor(120_000);
      expect(writes).toHaveLength(6);
      expect(await findDraft(page, canary)).not.toBeNull();
      expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
      failing = false;
      await page.getByRole('button', { name: '重試同步', exact: true }).click();
      await waitForBackendSync(page);
      expect(writes).toHaveLength(7);
      const saved = await owner.loadState(setup.workspaceId);
      expect(saved.revision).toBe(setup.saved.revision + 1);
      expect(JSON.stringify(saved.data)).toContain(canary);
      expect(await findDraft(page, canary)).toBeNull();
    });
  }

  test('a Class A teacher sees safe capacity metadata but cannot download Class B', async ({ page }) => {
    const setup = await fixture('teacher-scope', true, true);
    const teacher = await inviteAccount(owner, setup.workspaceId, testAccount('capacity-class-a-teacher'), 'teacher', [setup.classAId]);
    const forbidden = [setup.classBId, 'PRIVATE-BOB-teacher-scope', 'PRIVATE-CLASS-B-teacher-scope'];
    const requests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(`${request.url()}\n${request.postData() ?? ''}`);
    });
    try {
      const body = await capacityFailure(page, setup, 'TEACHER-CAPACITY-UNSAVED', teacher);
      await expect(page.getByRole('button', { name: '下載本機草稿', exact: true })).toHaveCount(0);
      for (const canary of forbidden) {
        expect(JSON.stringify(body)).not.toContain(canary);
        expect(JSON.stringify(await readStore(page))).not.toContain(canary);
        expect(await page.locator('body').innerText()).not.toContain(canary);
        expect(requests.join('\n')).not.toContain(canary);
        expect(JSON.stringify(await findDraft(page, 'TEACHER-CAPACITY-UNSAVED'))).not.toContain(canary);
      }
      await adoptRemote(page);
      await page.clock.resume();
      await selectDashboardTab(page, '學生');
      // Adoption remains read-scoped; it must not fetch or write a full snapshot.
      for (const canary of forbidden) {
        expect(JSON.stringify(await readStore(page))).not.toContain(canary);
        expect(requests.join('\n')).not.toContain(canary);
      }
      const saved = await owner.loadState(setup.workspaceId);
      expect(saved).toEqual(setup.saved);
    } finally { await teacher.dispose(); }
  });
});
