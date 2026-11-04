import { expect, test, type Page, type Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import type { AppData } from '../../src/store/types';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import {
  E2E_BASE_URL,
  E2eApiSession,
  addStudentViaUi,
  browserApiRequest,
  inviteAccount,
  loadBrowserState,
  loginViaUi,
  selectDashboardTab,
  selectTeacherDestination,
  switchWorkspaceViaUi,
  testAccount,
  waitForBackendSync,
  type TestAccount,
} from './support/fixtures';

type CapturedDraft = { key: string; value: Record<string, unknown> };
type StoreObserver = {
  getData: () => AppData;
  changes: AppData[];
  resetObservations: () => void;
};
type ObservedWindow = Window & {
  __epetTestStore: StoreObserver;
  __epetDraftDomLeaks: string[];
};

let owner: E2eApiSession;
test.beforeAll(async () => {
  owner = await E2eApiSession.register(testAccount('draft-recovery-owner'));
});
test.afterAll(async () => { await owner.dispose(); });

const fixture = async (label: string) => {
  const created = await owner.createWorkspace(`Synthetic draft ${label}`);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Synthetic workspace is missing');
  const initial = await owner.loadState(workspaceId);
  const template = initial.data?.classes[0];
  if (!initial.data || !template) throw new Error('Synthetic class template is missing');
  // Ordinary state saves preserve existing class identities; deleting the
  // template class requires the separate controlled lifecycle API.
  const classAId = template.id;
  const classBId = `${workspaceId}-class-b`;
  const classBSecret = `PRIVATE-B-${label}`;
  const data: AppData = {
    ...initial.data,
    currentClassId: classAId,
    classes: [
      { ...structuredClone(template), id: classAId, name: 'Synthetic Class A',
        students: [createEnrolledStudent({ id: '100', name: `Alice-${label}` })],
        learningEvidenceRecords: [], examRecords: [], classGoals: [], activeBoss: undefined },
      { ...structuredClone(template), id: classBId, name: 'Synthetic Class B',
        students: [createEnrolledStudent({ id: '100', name: classBSecret })],
        learningEvidenceRecords: [], examRecords: [], classGoals: [], activeBoss: undefined },
    ],
  };
  const saved = await owner.saveState(data, initial.revision, workspaceId);
  return { workspaceId, classAId, classBId, classBSecret, saved };
};

const openOwnerWorkspace = async (page: Page, workspaceId: string) => {
  await loginViaUi(page, owner.account);
  if (await page.getByRole('combobox', { name: '工作區', exact: true }).inputValue() !== workspaceId) {
    await switchWorkspaceViaUi(page, workspaceId);
  }
};

const findDraft = (page: Page, canary: string) => page.evaluate((name) => {
  for (const [key, raw] of Object.entries(sessionStorage)) {
    if (!key.startsWith('epet-unsynced-workspace-') || !raw.includes(name)) continue;
    return { key, value: JSON.parse(raw) };
  }
  return null;
}, canary) as Promise<CapturedDraft | null>;

const createUnsynchronizedDraft = async (page: Page, name: string) => {
  await page.route('**/api/v1/state', async (route) => {
    if (route.request().method() === 'PUT') return route.abort('failed');
    return route.continue();
  });
  await selectDashboardTab(page, '學生');
  const panel = page.getByRole('heading', { name: '新增學生' }).locator('..');
  await panel.getByLabel('學生姓名').fill(name);
  await panel.getByRole('button', { name: '新增', exact: true }).click();
  await expect(page.getByRole('heading', { name: '目前無法安全開啟工作區' })).toBeVisible();
  await expect.poll(async () => Boolean(await findDraft(page, name))).toBe(true);
  const draft = await findDraft(page, name);
  if (!draft) throw new Error('UI did not capture its unsynchronized draft');
  return draft;
};

const expireBrowserSession = async (page: Page) => {
  await page.context().clearCookies();
  const rejected = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/auth/session' && response.status() === 401);
  await page.reload();
  await rejected;
  await expect(page.getByRole('button', { name: '登入並繼續帶班' })).toBeVisible();
  await page.unroute('**/api/v1/state');
};

const loginFromExpiredScreen = async (page: Page, account: TestAccount) => {
  await page.locator('#auth-email').fill(account.email);
  await page.locator('#auth-password').fill(account.password);
  await page.getByRole('button', { name: '登入並繼續帶班' }).click();
  await expect(page.getByRole('button', { name: '登出', exact: true })).toBeVisible();
};

const returnToWorkspace = async (page: Page, workspaceId: string) => {
  // A new server session starts at the account's first workspace. Recovery
  // occurs only after its owner explicitly selects this draft's workspace.
  await waitForBackendSync(page);
  const select = page.getByRole('combobox', { name: '工作區', exact: true });
  if (await select.inputValue() !== workspaceId) {
    await switchWorkspaceViaUi(page, workspaceId);
  }
};

const waitForHydrationAttempt = (page: Page) => expect(page.getByRole('heading', {
  name: /^(導師控制台|目前無法安全開啟工作區|資料版本衝突)$/,
})).toBeVisible();

const observeIsolation = async (page: Page, forbidden: string[]) => {
  // Observe text inserted at any point, including transient unauthorized DOM.
  await page.evaluate((canaries) => {
    const target = window as unknown as ObservedWindow;
    target.__epetDraftDomLeaks = [];
    target.__epetTestStore.resetObservations();
    const inspect = () => {
      const text = document.documentElement.textContent ?? '';
      for (const canary of canaries) {
        if (text.includes(canary)) target.__epetDraftDomLeaks.push(canary);
      }
    };
    new MutationObserver(inspect).observe(document, {
      childList: true, characterData: true, subtree: true,
    });
    inspect();
  }, forbidden);
  const requests: string[] = [];
  const listener = (request: Request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      requests.push(`${request.url()}\n${request.postData() ?? ''}`);
    }
  };
  page.on('request', listener);
  return async () => {
    const observed = await page.evaluate(() => {
      const target = window as unknown as ObservedWindow;
      return {
        store: target.__epetTestStore.getData(),
        hydrations: target.__epetTestStore.changes,
        domLeaks: target.__epetDraftDomLeaks,
        dom: document.documentElement.textContent,
      };
    });
    for (const canary of forbidden) {
      expect(JSON.stringify(observed)).not.toContain(canary);
      expect(requests.join('\n')).not.toContain(canary);
    }
    await expect(page.getByRole('button', { name: '下載本機草稿', exact: true })).toHaveCount(0);
  };
};

const changeTeacherScope = async (
  workspaceId: string, userId: string, classIds: string[],
) => {
  const response = await owner.context.patch(`/api/v1/members/${encodeURIComponent(userId)}`, {
    headers: {
      cookie: owner.cookie,
      origin: E2E_BASE_URL,
      'x-csrf-token': owner.csrfToken,
      'x-epet-workspace': workspaceId,
    },
    data: { role: 'teacher', classIds },
  });
  expect(response.status()).toBe(200);
};

const assertScopedCsvExport = async (page: Page, allowedName: string, forbidden: string[]) => {
  await selectTeacherDestination(page, 'Learning', '每週回饋報告');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出 CSV', exact: true }).click();
  const path = await (await downloading).path();
  if (!path) throw new Error('Synthetic report download is missing');
  const csv = await readFile(path, 'utf8');
  expect(csv).toContain(allowedName);
  for (const canary of forbidden) expect(csv).not.toContain(canary);
};

const replaceBrowserSessionThroughApi = async (page: Page, account: TestAccount) => {
  const response = await page.context().request.post(`${E2E_BASE_URL}/api/v1/auth/login`, {
    headers: { origin: E2E_BASE_URL },
    data: { email: account.email, password: account.password },
  });
  expect(response.status()).toBe(200);
  // Apply the real issued cookies explicitly, matching fixtures.ts' loopback
  // Secure-cookie handling for Chromium and APIRequestContext on HTTP.
  const issued = response.headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .flatMap((header) => [...header.value.matchAll(/(__Host-epet_(?:session|csrf))=([A-Za-z0-9_-]+)/g)]);
  expect(issued).toHaveLength(2);
  await page.context().addCookies(issued.map((match) => ({
    name: match[1], value: match[2], domain: '127.0.0.1', path: '/',
    httpOnly: match[1] === '__Host-epet_session', secure: true, sameSite: 'Lax' as const,
  })));
  return (await page.context().cookies())
    .filter((cookie) => cookie.name === '__Host-epet_session' || cookie.name === '__Host-epet_csrf')
    .map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
};

test.describe('Authenticated workspace draft recovery', () => {
  test('A: a Class A teacher cannot hydrate, export, or replay an expired admin draft', async ({ page }) => {
    const setup = await fixture('account-isolation');
    const teacherAccount = testAccount('draft-class-a-teacher');
    const teacher = await inviteAccount(owner, setup.workspaceId, teacherAccount, 'teacher', [setup.classAId]);
    await teacher.dispose();
    await openOwnerWorkspace(page, setup.workspaceId);
    const privateDraft = 'PRIVATE-ADMIN-UNSYNCED-STUDENT';
    await createUnsynchronizedDraft(page, privateDraft);
    await expireBrowserSession(page);
    const assertIsolated = await observeIsolation(page, [privateDraft, setup.classBSecret, setup.classBId]);
    await loginFromExpiredScreen(page, teacherAccount);
    await waitForHydrationAttempt(page);
    await assertIsolated();
    await waitForBackendSync(page);
    await selectDashboardTab(page, '學生');
    await expect(page.getByRole('combobox', { name: '目前班級', exact: true }).locator('option')).toHaveCount(1);
    await assertIsolated();
    // Keeping the owner-bound draft avoids destroying its unsaved work.
    expect(await findDraft(page, privateDraft)).not.toBeNull();
    expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
    await assertScopedCsvExport(page, 'Alice-account-isolation', [privateDraft, setup.classBSecret, setup.classBId]);
    await addStudentViaUi(page, 'Teacher-authorized-Class-A-edit');
    await assertIsolated();
    const saved = await owner.loadState(setup.workspaceId);
    expect(saved.data?.classes.find((classroom) => classroom.id === setup.classBId))
      .toEqual(setup.saved.data?.classes.find((classroom) => classroom.id === setup.classBId));
  });

  test('B: a teacher downgraded from A+B to A cannot hydrate or transmit Class B from its old draft', async ({ page }) => {
    const setup = await fixture('scope-downgrade');
    const teacherAccount = testAccount('draft-ab-teacher');
    const teacher = await inviteAccount(owner, setup.workspaceId, teacherAccount, 'teacher', [setup.classAId, setup.classBId]);
    const teacherId = teacher.session.user.id;
    await teacher.dispose();
    await loginViaUi(page, teacherAccount);
    const privateDraft = 'UNSYNCED-OLD-AB-SCOPE';
    await createUnsynchronizedDraft(page, privateDraft);
    await expireBrowserSession(page);
    await changeTeacherScope(setup.workspaceId, teacherId, [setup.classAId]);
    const assertIsolated = await observeIsolation(page, [privateDraft, setup.classBSecret, setup.classBId]);
    await loginFromExpiredScreen(page, teacherAccount);
    await waitForHydrationAttempt(page);
    await assertIsolated();
    await waitForBackendSync(page);
    await selectDashboardTab(page, '學生');
    await expect(page.getByRole('combobox', { name: '目前班級', exact: true }).locator('option')).toHaveCount(1);
    await assertIsolated();
    expect(await findDraft(page, privateDraft)).not.toBeNull();
    expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
    await assertScopedCsvExport(page, 'Alice-scope-downgrade', [privateDraft, setup.classBSecret, setup.classBId]);
    await addStudentViaUi(page, 'Teacher-current-A-scope-edit');
    await assertIsolated();
    const saved = await owner.loadState(setup.workspaceId);
    expect(saved.data?.classes.find((classroom) => classroom.id === setup.classBId))
      .toEqual(setup.saved.data?.classes.find((classroom) => classroom.id === setup.classBId));
  });

  test('C: the same user with unchanged scope safely restores its unsynchronized work after a fresh login', async ({ page }) => {
    const setup = await fixture('same-user');
    await openOwnerWorkspace(page, setup.workspaceId);
    const canary = 'RECOVER-SAME-USER-UNSYNCED';
    const captured = await createUnsynchronizedDraft(page, canary);
    await expireBrowserSession(page);
    expect(await findDraft(page, canary)).toEqual(captured);
    const replay = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/state' &&
      response.request().method() === 'PUT' &&
      (response.request().postData() ?? '').includes(canary));
    await loginFromExpiredScreen(page, owner.account);
    await returnToWorkspace(page, setup.workspaceId);
    expect((await replay).status()).toBe(200);
    await waitForBackendSync(page);
    await selectDashboardTab(page, '獎勵');
    await expect(page.getByRole('row', { name: new RegExp(canary) })).toBeVisible();
    const saved = await owner.loadState(setup.workspaceId);
    expect(JSON.stringify(saved.data)).toContain(canary);
    expect(saved.revision).toBe(setup.saved.revision + 1);
    expect(await findDraft(page, canary)).toBeNull();
    await page.reload();
    await waitForBackendSync(page);
    expect(await loadBrowserState(page.context(), setup.workspaceId)).toEqual(saved);
  });

  test('expired drafts remain unavailable even to the same user and scope', async ({ page }) => {
    const setup = await fixture('ttl');
    await openOwnerWorkspace(page, setup.workspaceId);
    const canary = 'EXPIRED-UNSYNCED-DRAFT';
    const captured = await createUnsynchronizedDraft(page, canary);
    await expireBrowserSession(page);
    await page.evaluate(({ key, value }) => {
      const old = Date.now() - 25 * 60 * 60 * 1_000;
      sessionStorage.setItem(key, JSON.stringify({
        ...value, createdAt: old, updatedAt: old, expiresAt: old + 24 * 60 * 60 * 1_000,
      }));
    }, captured);
    const assertIsolated = await observeIsolation(page, [canary]);
    await loginFromExpiredScreen(page, owner.account);
    await returnToWorkspace(page, setup.workspaceId);
    await assertIsolated();
    expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
  });

  test('an unbound legacy draft is retained but cannot be trusted or replayed by login', async ({ page }) => {
    const setup = await fixture('legacy');
    await openOwnerWorkspace(page, setup.workspaceId);
    const canary = 'LEGACY-UNBOUND-UNSYNCED';
    const captured = await createUnsynchronizedDraft(page, canary);
    await expireBrowserSession(page);
    await page.evaluate(({ workspaceId, captured }) => {
      sessionStorage.removeItem(captured.key);
      // Match the old persisted contract exactly: no user, role, or scope.
      const { data, baseRevision, requestId, updatedAt } = captured.value;
      sessionStorage.setItem(`epet-unsynced-workspace-v1:${workspaceId}`, JSON.stringify({
        workspaceId, data, baseRevision, requestId, updatedAt,
      }));
    }, { workspaceId: setup.workspaceId, captured });
    const assertIsolated = await observeIsolation(page, [canary]);
    await loginFromExpiredScreen(page, owner.account);
    await returnToWorkspace(page, setup.workspaceId);
    await assertIsolated();
    expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
    expect(await findDraft(page, canary)).not.toBeNull();
  });

  test('a recovered draft stays in its workspace across normal workspace switching', async ({ page }) => {
    const setup = await fixture('switch-source');
    const other = await fixture('switch-target');
    await openOwnerWorkspace(page, setup.workspaceId);
    const canary = 'RECOVER-WORKSPACE-ONLY';
    await createUnsynchronizedDraft(page, canary);
    await expireBrowserSession(page);
    await loginFromExpiredScreen(page, owner.account);
    await returnToWorkspace(page, setup.workspaceId);
    expect(JSON.stringify((await owner.loadState(setup.workspaceId)).data)).toContain(canary);
    await switchWorkspaceViaUi(page, other.workspaceId);
    expect(JSON.stringify(await page.evaluate(() =>
      (window as unknown as ObservedWindow).__epetTestStore.getData()))).not.toContain(canary);
    expect(await owner.loadState(other.workspaceId)).toEqual(other.saved);
    await switchWorkspaceViaUi(page, setup.workspaceId);
    expect(JSON.stringify(await page.evaluate(() =>
      (window as unknown as ObservedWindow).__epetTestStore.getData()))).toContain(canary);
    expect(await browserApiRequest(page.context(), '/api/v1/state', { workspaceId: other.workspaceId })
      .then((response) => response.status())).toBe(200);
  });

  test('a cookie principal changed after session verification cannot authorize the first draft hydration', async ({ page }) => {
    const setup = await fixture('cookie-load-race');
    const teacherAccount = testAccount('draft-cookie-load-teacher');
    const teacher = await inviteAccount(owner, setup.workspaceId, teacherAccount, 'teacher', [setup.classAId]);
    await teacher.dispose();
    await openOwnerWorkspace(page, setup.workspaceId);
    const privateDraft = 'PRIVATE-OWNER-COOKIE-LOAD-DRAFT';
    const captured = await createUnsynchronizedDraft(page, privateDraft);

    let assertIsolated: (() => Promise<void>) | undefined;
    let rejectedStateStatus: number | undefined;
    let intercepted = false;
    await page.route('**/api/v1/state', async (route) => {
      const request = route.request();
      if (request.method() === 'PUT') return route.abort('failed');
      if (intercepted || request.method() !== 'GET' ||
          request.headers()['x-epet-workspace'] !== setup.workspaceId) return route.continue();
      intercepted = true;
      expect(request.headers()['x-epet-sync-user']).toBe(owner.session.user.id);
      assertIsolated = await observeIsolation(page, [privateDraft, setup.classBSecret, setup.classBId]);
      const cookie = await replaceBrowserSessionThroughApi(page, teacherAccount);
      // Send the paused browser GET with its original expected-principal
      // header and the browser's newly issued real cookie. Explicit forwarding
      // avoids an interceptor retaining the request's old Cookie header.
      const response = await route.fetch({ headers: { ...request.headers(), cookie } });
      rejectedStateStatus = response.status();
      await route.fulfill({ response });
    });
    const verifiedSession = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/auth/session' && response.status() === 200);
    await page.reload();
    const verified = (await (await verifiedSession).json()).session;
    expect(verified.user.id).toBe(owner.session.user.id);
    expect(verified.activeWorkspaceId).toBe(setup.workspaceId);
    await expect(page.getByRole('button', { name: '登入並繼續帶班' })).toBeVisible();
    expect(intercepted).toBe(true);
    expect(rejectedStateStatus).toBe(403);
    if (!assertIsolated) throw new Error('The first authorized state load was not observed');
    await assertIsolated();
    expect(await findDraft(page, privateDraft)).toEqual(captured);
    expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
  });

  test('a stale admin download control revalidates the cookie principal before creating a draft file', async ({ page }) => {
    const setup = await fixture('cookie-download-race');
    // Use a distinct full-scope principal so this security suite exercises the
    // real login quota without exhausting the shared setup owner's allowance.
    const adminAccount = testAccount('draft-cookie-download-admin');
    const admin = await inviteAccount(owner, setup.workspaceId, adminAccount, 'admin', []);
    await admin.dispose();
    const teacherAccount = testAccount('draft-cookie-download-teacher');
    const teacher = await inviteAccount(owner, setup.workspaceId, teacherAccount, 'teacher', [setup.classAId]);
    await teacher.dispose();
    await loginViaUi(page, adminAccount);
    const privateDraft = 'PRIVATE-ADMIN-COOKIE-DOWNLOAD-DRAFT';
    const captured = await createUnsynchronizedDraft(page, privateDraft);
    const downloadButton = page.getByRole('button', { name: '下載本機草稿', exact: true });
    await expect(downloadButton).toBeVisible();
    await replaceBrowserSessionThroughApi(page, teacherAccount);
    const assertIsolated = await observeIsolation(page, [privateDraft, setup.classBSecret, setup.classBId]);
    const downloads: string[] = [];
    page.on('download', (download) => { downloads.push(download.suggestedFilename()); });
    const rejected = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/state' && response.request().method() === 'GET');
    await downloadButton.click();
    expect((await rejected).status()).toBe(403);
    await expect(page.getByRole('button', { name: '登入並繼續帶班' })).toBeVisible();
    await assertIsolated();
    expect(downloads).toEqual([]);
    expect(await findDraft(page, privateDraft)).toEqual(captured);
    expect(await owner.loadState(setup.workspaceId)).toEqual(setup.saved);
  });

  test('normal admin logout revokes the issued session after clearing its client view', async ({ page }) => {
    const setup = await fixture('normal-logout');
    const account = testAccount('draft-normal-logout-admin');
    const admin = await inviteAccount(owner, setup.workspaceId, account, 'admin', []);
    await admin.dispose();
    await loginViaUi(page, account);
    const oldCookie = (await page.context().cookies())
      .filter((cookie) => cookie.name === '__Host-epet_session' || cookie.name === '__Host-epet_csrf')
      .map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    expect(oldCookie).toContain('__Host-epet_session=');
    const loggedOut = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/auth/logout' && response.request().method() === 'POST');
    await page.getByRole('button', { name: '登出', exact: true }).click();
    expect((await loggedOut).status()).toBe(204);
    await expect(page.getByRole('button', { name: '登入並繼續帶班' })).toBeVisible();
    expect((await page.context().cookies()).some((cookie) => cookie.name === '__Host-epet_session')).toBe(false);
    const revoked = await owner.context.get('/api/v1/auth/session', {
      headers: { origin: E2E_BASE_URL, cookie: oldCookie },
    });
    expect(revoked.status()).toBe(401);
    await page.reload();
    await expect(page.getByRole('button', { name: '登入並繼續帶班' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '導師控制台' })).toHaveCount(0);
  });

  test('a focus refresh recognizes an in-flight write that already committed without replay or false conflict', async ({ page }, testInfo) => {
    const setup = await fixture('focus-inflight-commit');
    const account = testAccount('draft-focus-refresh-admin');
    const admin = await inviteAccount(owner, setup.workspaceId, account, 'admin', []);
    await admin.dispose();
    await loginViaUi(page, account);
    const canary = 'FOCUS-REFRESH-COMMITTED-STUDENT';
    let releaseResponse = () => {};
    let notifyCommitted = () => {};
    let writeCount = 0;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    const committed = new Promise<void>((resolve) => { notifyCommitted = resolve; });
    await page.route('**/api/v1/state', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      writeCount += 1;
      const response = await route.fetch();
      if (writeCount === 1) {
        expect(response.status()).toBe(200);
        notifyCommitted();
        await responseGate;
      }
      await route.fulfill({ response });
    });
    try {
      await selectDashboardTab(page, '學生');
      const panel = page.getByRole('heading', { name: '新增學生' }).locator('..');
      await panel.getByLabel('學生姓名').fill(canary);
      await panel.getByRole('button', { name: '新增', exact: true }).click();
      await committed;
      const firstResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/v1/state' && response.request().method() === 'PUT');
      // A failed hydration assertion still releases the gate in finally. Mark
      // teardown rejection handled while preserving the normal await below.
      void firstResponse.catch(() => undefined);
      const refreshedSession = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/v1/auth/session' && response.status() === 200);
      const refreshedState = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/v1/state' && response.request().method() === 'GET' &&
        response.request().headers()['x-epet-workspace'] === setup.workspaceId);
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
      await refreshedSession;
      expect((await refreshedState).status()).toBe(200);
      try {
        await waitForBackendSync(page);
      } catch (error) {
        const local = await page.evaluate((name) => ({
          drafts: Object.entries(sessionStorage)
            .filter(([key, raw]) => key.startsWith('epet-unsynced-workspace-') && raw.includes(name))
            .map(([key, raw]) => ({ key, value: JSON.parse(raw) as Record<string, unknown> })),
          store: (window as unknown as ObservedWindow).__epetTestStore.getData(),
        }), canary);
        const remote = await owner.loadState(setup.workspaceId);
        const comparisons = local.drafts.flatMap((draft) => ['data', 'uncertainData'].map((field) => {
          const candidate = draft.value[field];
          let assertionDiff: string | null = null;
          try { assert.deepStrictEqual(candidate, remote.data); } catch (comparisonError) {
            assertionDiff = comparisonError instanceof Error ? comparisonError.message : String(comparisonError);
          }
          const keyOrderDifferences: string[] = [];
          const inspectOrder = (left: unknown, right: unknown, path: string) => {
            if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return;
            const leftKeys = Object.keys(left);
            const rightKeys = Object.keys(right);
            if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) {
              keyOrderDifferences.push(`${path}: ${JSON.stringify(leftKeys)} versus ${JSON.stringify(rightKeys)}`);
            }
            for (const key of leftKeys) {
              if (Object.hasOwn(right, key)) inspectOrder(left[key], right[key], `${path}.${key}`);
            }
          };
          inspectOrder(candidate, remote.data, '$');
          return { key: draft.key, field, jsonEqual: JSON.stringify(candidate) === JSON.stringify(remote.data),
            deepEqual: assertionDiff === null, assertionDiff, keyOrderDifferences };
        }));
        await testInfo.attach('synthetic-focus-refresh-comparison', {
          body: JSON.stringify({ local, remote, comparisons }, null, 2),
          contentType: 'application/json',
        });
        throw error;
      }
      expect(await findDraft(page, canary)).toBeNull();
      await expect(page.getByRole('alert', { name: '同步或權限警示', exact: true })).toHaveCount(0);
      expect(JSON.stringify(await page.evaluate(() =>
        (window as unknown as ObservedWindow).__epetTestStore.getData()))).toContain(canary);
      releaseResponse();
      expect((await firstResponse).status()).toBe(200);
      // Observe one complete autosave debounce interval after the late response,
      // so a duplicated save cannot escape an immediate counter assertion.
      const duplicateWrite = await page.waitForRequest((request) =>
        new URL(request.url()).pathname === '/api/v1/state' && request.method() === 'PUT',
      { timeout: 1_000 }).then(() => true, (error: unknown) => {
        if (error instanceof Error && error.name === 'TimeoutError') return false;
        throw error;
      });
      expect(duplicateWrite).toBe(false);
      expect(writeCount).toBe(1);
      await waitForBackendSync(page);
      const saved = await owner.loadState(setup.workspaceId);
      expect(saved.revision).toBe(setup.saved.revision + 1);
      expect(saved.data?.classes.flatMap((classroom) => classroom.students)
        .filter((student) => student.name === canary)).toHaveLength(1);
      expect(await findDraft(page, canary)).toBeNull();
    } finally {
      releaseResponse();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
});
