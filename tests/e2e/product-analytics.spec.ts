import { expect, test, type Page } from '@playwright/test';
import type { AnalyticsEvent, AnalyticsEventName } from '../../src/analytics';
import type { ProductAnalyticsFlow, ProductAnalyticsWorkflowEvent } from '../../shared/productAnalytics/schema';
import {
  E2eApiSession,
  addClassViaUi,
  addStudentViaUi,
  loadBrowserState,
  openConsoleWithApiSession,
  performSyncedAction,
  selectDashboardTab,
  selectTeacherDestination,
  testAccount,
} from './support/fixtures';

type AnalyticsTestWindow = Window & { __epetTestAnalytics?: AnalyticsEvent[];
  __epetTestWorkflowAnalytics?: ProductAnalyticsWorkflowEvent[] };
let analyticsOwner: E2eApiSession;

// The local harness supplies a synthetic development sink. Only its already
// scrubbed events are retained here; this collector never ships in the app.
const installCollector = async (page: Page) => {
  await page.addInitScript(() => {
    const target = window as AnalyticsTestWindow;
    target.__epetTestAnalytics = [];
    target.__epetTestWorkflowAnalytics = [];
    window.addEventListener('epet-test-product-analytics', (event) => {
      if (event instanceof CustomEvent) {
        target.__epetTestAnalytics?.push(event.detail as AnalyticsEvent);
      }
    });
    window.addEventListener('epet-test-workflow-analytics', (event) => {
      if (event instanceof CustomEvent) target.__epetTestWorkflowAnalytics?.push(event.detail as ProductAnalyticsWorkflowEvent);
    });
  });
};
const collected = (page: Page) => page.evaluate(() =>
  (window as AnalyticsTestWindow).__epetTestAnalytics ?? []);
const clearCollected = (page: Page) => page.evaluate(() => {
  (window as AnalyticsTestWindow).__epetTestAnalytics = [];
});
const eventsNamed = async (page: Page, name: AnalyticsEventName) =>
  (await collected(page)).filter((event) => event.name === name);
const workflows = (page: Page, flow?: ProductAnalyticsFlow) => page.evaluate((selected) =>
  ((window as AnalyticsTestWindow).__epetTestWorkflowAnalytics ?? []).filter((event) => !selected || event.flow === selected), flow);
const assertWorkflowPayloads = (events: ProductAnalyticsWorkflowEvent[], forbidden: string[]) => {
  expect(events.length).toBeGreaterThan(0);
  for (const event of events) {
    expect(Object.keys(event).sort()).toEqual([
      'attempt', ...(event.flow === 'class_create' ? ['class_context'] : []), 'flow', 'kind', 'schema_version', 'stage',
    ].sort());
    expect(event.schema_version).toBe(2);
    expect(event.kind).toBe('workflow');
    expect(event.attempt).toMatch(/^[0-9a-f-]{36}$/i);
  }
  const serialized = JSON.stringify(events);
  for (const value of forbidden.filter(Boolean)) expect(serialized.includes(value)).toBe(false);
};

const openIsolatedConsole = async (page: Page, name: string) => {
  const created = await analyticsOwner.createWorkspace(name);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Workspace is missing');
  // Reuse the legitimately issued session, just like other feature suites.
  // Authentication suites retain real login coverage and production quotas.
  await openConsoleWithApiSession(page, analyticsOwner);
  // Initial Today navigation must not be repeated by StrictMode effect replay.
  expect(await eventsNamed(page, 'feature_opened')).toEqual([{
    name: 'feature_opened', metadata: { feature: 'today' },
    environment: 'development', schema_version: 1,
  }]);
  // API creation selects this workspace on the same issued session. Waiting
  // for a redundant switch's GET would hang: the app correctly ignores it.
  await expect(page.getByRole('combobox', { name: '工作區', exact: true }))
    .toHaveValue(workspaceId);
  await clearCollected(page);
  return workspaceId;
};

const assertAnonymousPayloads = (events: AnalyticsEvent[], forbidden: string[]) => {
  const metadataKeys: Record<AnalyticsEventName, readonly string[]> = {
    workspace_created: ['creation_source'],
    class_created: [],
    student_import_completed: ['student_count'],
    point_action_completed: ['action_source', 'direction', 'student_count'],
    learning_evidence_created: [],
    exam_created: [],
    report_generated: ['format', 'report_type'],
    boss_started: [],
    feature_opened: ['feature'],
  };
  expect(events.length).toBeGreaterThan(0);
  for (const event of events) {
    expect(Object.keys(event).sort()).toEqual([
      'environment', 'metadata', 'name', 'schema_version',
    ]);
    expect(Object.keys(event.metadata).sort()).toEqual(metadataKeys[event.name]);
    expect(event.environment).toBe('development');
    expect(event.schema_version).toBe(1);
  }
  const serialized = JSON.stringify(events);
  // Boolean assertions avoid echoing even synthetic cookie/token values into
  // assertion output if an accidental context leak is introduced later.
  for (const value of forbidden.filter(Boolean)) {
    expect(serialized.includes(value)).toBe(false);
  }
};

test.describe('Anonymous teacher product analytics', () => {
  test.beforeAll(async () => {
    analyticsOwner = await E2eApiSession.register(testAccount('analytics-owner'));
  });
  test.afterAll(async () => { await analyticsOwner.dispose(); });
  test.beforeEach(async ({ page }) => { await installCollector(page); });

  test('successful teacher commands send only fixed enums and aggregate counts', async ({ context, page }) => {
    test.setTimeout(120_000);
    const workspaceName = 'AnalyticsPrivateWorkspaceCanary';
    const workspaceId = await openIsolatedConsole(page, workspaceName);
    const className = 'AnalyticsPrivateClassCanary';
    const studentNames = ['AnalyticsPrivateLearnerAlpha', 'AnalyticsPrivateLearnerBeta'];
    const pointReason = 'AnalyticsPrivatePointReasonCanary';
    const evidenceTitle = 'AnalyticsPrivateEvidenceTitleCanary';
    const evidenceContent = 'AnalyticsPrivateEvidenceContentCanary';
    const examTitle = 'AnalyticsPrivateExamTitleCanary';
    const bossName = 'AnalyticsPrivateBossTitleCanary';

    await addClassViaUi(page, className);
    const roster = page.locator('section[aria-labelledby="roster-import-title"]');
    await roster.locator('input[type="file"]').setInputFiles({
      name: 'private-roster-canary.csv', mimeType: 'text/csv',
      buffer: Buffer.from(`\uFEFF學生姓名\r\n${studentNames.join('\r\n')}\r\n`, 'utf8'),
    });
    await expect(roster).toContainText('新增 2 位');
    await performSyncedAction(page, () => roster.getByRole('button', { name: '新增 2 位學生' }).click());
    expect(await eventsNamed(page, 'class_created')).toHaveLength(1);
    expect(await eventsNamed(page, 'student_import_completed')).toEqual([{
      name: 'student_import_completed', metadata: { student_count: 2 },
      environment: 'development', schema_version: 1,
    }]);

    await selectDashboardTab(page, '獎勵');
    await page.getByRole('row', { name: new RegExp(studentNames[0]) }).getByTitle('手動加減分').click();
    await page.getByLabel('獎懲積分').fill('17');
    await page.getByLabel('具體回饋原因（必填）').fill(pointReason);
    await performSyncedAction(page, () => page.getByRole('button', { name: '確認調整' }).click());
    await page.getByRole('button', { name: '全體空投' }).click();
    const pointsDialog = page.getByRole('dialog', { name: '全體積分空投' });
    await pointsDialog.getByLabel('獎懲積分').fill('9');
    await pointsDialog.getByLabel('具體回饋原因（必填）').fill(pointReason);
    await performSyncedAction(page, () => pointsDialog.getByRole('button', { name: '確認發放' }).click());
    expect((await eventsNamed(page, 'point_action_completed')).map(({ metadata }) => metadata)).toEqual([
      { student_count: 1, action_source: 'manual', direction: 'increase' },
      { student_count: 2, action_source: 'airdrop', direction: 'increase' },
    ]);

    await selectTeacherDestination(page, 'Learning', '學習證據');
    await page.getByLabel('選擇學生').selectOption({ label: studentNames[0] });
    const evidenceForm = page.getByRole('heading', { name: '新增學習證據' }).locator('..');
    await evidenceForm.getByLabel('證據摘要').fill(evidenceTitle);
    await evidenceForm.getByLabel('觀察細節').fill(evidenceContent);
    await performSyncedAction(page, () => evidenceForm.getByRole('button', { name: '儲存學習證據' }).click());
    expect(await eventsNamed(page, 'learning_evidence_created')).toHaveLength(1);

    await selectTeacherDestination(page, 'Learning', '考試分析');
    await page.getByLabel('考試名稱').fill(examTitle);
    await page.locator('input[data-score-row="0"][data-score-column="0"]').fill('73.5');
    await performSyncedAction(page, () => page.getByRole('button', { name: '保存考試', exact: true }).click());
    expect(await eventsNamed(page, 'exam_created')).toHaveLength(1);

    await selectTeacherDestination(page, 'Activities', '魔王管理');
    const bossSection = page.getByRole('heading', { name: '魔王副本管理' }).locator('..');
    await bossSection.getByText('魔王名稱', { exact: true }).locator('..').locator('input').fill(bossName);
    await bossSection.getByText('血量 (Max HP)', { exact: true }).locator('..').locator('input').fill('321');
    await performSyncedAction(page, () => bossSection.getByRole('button', { name: '召喚魔王' }).click());
    expect(await eventsNamed(page, 'boss_started')).toHaveLength(1);

    const state = await loadBrowserState(context, workspaceId);
    const classroom = state.data?.classes.find(({ name }) => name === className);
    // Preserve the existing first-participation minimum of 20: the manual
    // action tops up 17 to 20, and the second learner's first airdrop does too.
    // Those automated support entries do not create extra teacher events.
    expect(classroom?.students.map(({ points }) => points)).toEqual([229, 220]);
    const cookies = await context.cookies();
    const events = await collected(page);
    assertAnonymousPayloads(events, [
      workspaceName, workspaceId, className, ...studentNames, pointReason,
      evidenceTitle, evidenceContent, examTitle, bossName, '73.5',
      analyticsOwner.account.email, analyticsOwner.account.password,
      analyticsOwner.account.displayName, analyticsOwner.session.user.id,
      classroom?.id ?? '', ...(classroom?.students.map(({ id }) => id) ?? []),
      ...(classroom?.examRecords?.map(({ id }) => id) ?? []),
      ...cookies.filter(({ name }) => /epet_(session|csrf)/.test(name)).map(({ value }) => value),
    ]);
    const lifecycle = await workflows(page);
    for (const flow of ['class_create', 'roster_import', 'point_increase', 'exam_create'] as const) {
      const perFlow = lifecycle.filter((event) => event.flow === flow);
      const attempts = [...new Set(perFlow.map((event) => event.attempt))];
      expect(attempts).toHaveLength(flow === 'point_increase' ? 2 : 1);
      for (const attempt of attempts) expect(perFlow.filter((event) => event.attempt === attempt).map((event) => event.stage))
        .toEqual(['started', 'local_completed', 'backend_acknowledged']);
    }
    assertWorkflowPayloads(lifecycle, [workspaceName, workspaceId, className, ...studentNames, pointReason,
      evidenceTitle, evidenceContent, examTitle, bossName, '73.5', analyticsOwner.account.email,
      analyticsOwner.session.user.id, classroom?.id ?? '', ...(classroom?.students.map(({ id }) => id) ?? []),
      ...cookies.filter(({ name }) => /epet_(session|csrf)/.test(name)).map(({ value }) => value)]);
    // Hydrating an already saved workspace emits navigation, not completions.
    await page.reload();
    await expect(page.getByRole('heading', { name: '首頁', exact: true })).toBeVisible();
    await expect.poll(async () => (await collected(page)).map(({ name }) => name)).toEqual(['feature_opened']);
    expect(await workflows(page)).toEqual([]);
  });

  test('repeated teacher navigation is deduplicated and presentation is not tracked', async ({ page }) => {
    await openIsolatedConsole(page, 'AnalyticsPrivateNavigationWorkspace');
    await selectTeacherDestination(page, 'Class', '學生');
    await selectTeacherDestination(page, 'Class', '學生');
    await selectTeacherDestination(page, 'Class', '加減分');
    await selectTeacherDestination(page, 'Class', '加減分');
    expect((await eventsNamed(page, 'feature_opened')).map(({ metadata }) => metadata)).toEqual([
      { feature: 'students' }, { feature: 'points' },
    ]);
    const beforePresentation = await collected(page);
    await page.getByRole('button', { name: '展示大廳', exact: true }).click();
    await expect(page.getByRole('heading', { name: '寵物展示大廳', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { location.hash = '#/login'; });
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/presentation');
    await expect(page.getByRole('navigation', { name: 'Teacher Console' })).toHaveCount(0);
    expect(await collected(page)).toEqual(beforePresentation);
    await page.getByRole('button', { name: '結束投影', exact: true }).click();
    await page.getByRole('button', { name: '已停止投影，返回控制台' }).click();
    await expect(page.getByRole('heading', { name: '首頁', exact: true })).toBeVisible();
    // A genuinely new console lifetime may open Today once again.
    expect((await eventsNamed(page, 'feature_opened')).map(({ metadata }) => metadata)).toEqual([
      { feature: 'students' }, { feature: 'points' }, { feature: 'today' },
    ]);
  });

  test('reports count preparation, not popup failures, filters, edits, or score templates', async ({ context, page }) => {
    const workspaceId = await openIsolatedConsole(page, 'AnalyticsPrivateReportWorkspace');
    const studentName = 'AnalyticsPrivateReportLearner';
    const examTitle = 'AnalyticsPrivateReportAssessment';
    const teacherComment = 'AnalyticsPrivateReportComment';
    await addStudentViaUi(page, studentName);
    await selectTeacherDestination(page, 'Learning', '考試分析');
    await page.getByLabel('考試名稱').fill(examTitle);
    await page.locator('input[data-score-row="0"][data-score-column="0"]').fill('87.5');
    await page.getByRole('heading', { name: '導師評語', exact: true })
      .locator('..').locator('textarea').fill(teacherComment);
    await performSyncedAction(page, () => page.getByRole('button', { name: '保存考試', exact: true }).click());
    expect(await eventsNamed(page, 'exam_created')).toHaveLength(1);
    const scoreTemplate = page.waitForEvent('download');
    await page.getByRole('button', { name: '下載成績 CSV 範本', exact: true }).click();
    await scoreTemplate;
    expect(await eventsNamed(page, 'report_generated')).toHaveLength(0);

    await page.evaluate(() => {
      const target = window as Window & { __epetTestOriginalOpen?: typeof window.open };
      target.__epetTestOriginalOpen = window.open;
      window.open = () => null;
    });
    await page.getByRole('button', { name: '產生個別 A4 PDF', exact: true }).click();
    await expect(page.getByText('報告視窗遭瀏覽器阻擋，請允許彈出式視窗後重試。')).toBeVisible();
    expect(await eventsNamed(page, 'report_generated')).toHaveLength(0);
    expect((await workflows(page, 'report_exam')).map((event) => event.stage)).toEqual(['started', 'rejected']);
    await page.evaluate(() => {
      const target = window as Window & { __epetTestOriginalOpen?: typeof window.open };
      if (!target.__epetTestOriginalOpen) throw new Error('Synthetic popup override is missing');
      window.open = target.__epetTestOriginalOpen;
      delete target.__epetTestOriginalOpen;
    });
    // Headless tests verify HTML preparation, never completion of a print dialog.
    await context.addInitScript(() => { window.print = () => {}; });
    const popupOpened = page.waitForEvent('popup');
    await performSyncedAction(page, () => page.getByRole('button', { name: '產生個別 A4 PDF', exact: true }).click());
    const popup = await popupOpened;
    await expect(popup.getByRole('heading', { name: studentName, exact: true, level: 1 })).toBeVisible();
    await popup.close();
    expect((await eventsNamed(page, 'report_generated')).map(({ metadata }) => metadata)).toEqual([
      { report_type: 'exam_summary', format: 'print' },
    ]);
    expect(await eventsNamed(page, 'exam_created')).toHaveLength(1);
    await page.locator('input[data-score-row="0"][data-score-column="0"]').fill('88.5');
    await performSyncedAction(page, () => page.getByRole('button', { name: '保存考試', exact: true }).click());
    expect(await eventsNamed(page, 'exam_created')).toHaveLength(1);

    await selectTeacherDestination(page, 'Learning', '每週回饋報告');
    // The wrapping label also contains the select's option text.
    await page.getByLabel('報告週次').selectOption({ index: 1 });
    expect(await eventsNamed(page, 'report_generated')).toHaveLength(1);
    const reportDownloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '匯出 CSV', exact: true }).click();
    await reportDownloaded;
    expect((await eventsNamed(page, 'report_generated')).map(({ metadata }) => metadata)).toEqual([
      { report_type: 'exam_summary', format: 'print' },
      { report_type: 'weekly_feedback', format: 'csv' },
    ]);
    const state = await loadBrowserState(context, workspaceId);
    const studentId = state.data?.classes[0]?.students[0]?.id ?? '';
    assertAnonymousPayloads(await collected(page), [
      workspaceId, studentName, studentId, examTitle, teacherComment, '87.5', '88.5',
      analyticsOwner.account.email, analyticsOwner.account.password,
    ]);
    expect((await workflows(page, 'report_exam')).map((event) => event.stage))
      .toEqual(['started', 'rejected', 'started', 'local_completed']);
    expect((await workflows(page, 'report_weekly')).map((event) => event.stage)).toEqual(['started', 'local_completed']);
    expect((await workflows(page, 'exam_create')).filter((event) => event.stage === 'started')).toHaveLength(1);
  });

  test('browser privacy opt-out disables analytics without disabling teacher actions', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        configurable: true, value: true,
      });
    });
    const created = await analyticsOwner.createWorkspace('AnalyticsPrivacyOptOutWorkspace');
    const workspaceId = created.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('Workspace is missing');
    await openConsoleWithApiSession(page, analyticsOwner);
    await expect(page.getByRole('combobox', { name: '工作區', exact: true }))
      .toHaveValue(workspaceId);
    await addClassViaUi(page, 'AnalyticsPrivacyOptOutClass');
    await selectTeacherDestination(page, 'Learning', '學習證據');
    await expect(page.getByRole('tab', { name: '學習證據', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await collected(page)).toEqual([]);
    expect(await workflows(page)).toEqual([]);
  });

  test('class dialog cancellation is distinct from local completion and backend persistence', async ({ page }) => {
    await openIsolatedConsole(page, 'AnalyticsCancellationWorkspace');
    await selectDashboardTab(page, '學生');
    await page.getByRole('button', { name: '新增班級' }).click();
    await page.getByRole('dialog', { name: '新增班級' }).getByRole('button', { name: '取消', exact: true }).click();
    expect((await workflows(page, 'class_create')).map((event) => event.stage)).toEqual(['started', 'cancelled']);
    await addClassViaUi(page, 'AnalyticsAcceptedAfterCancel');
    const events = await workflows(page, 'class_create');
    expect(events.map((event) => event.stage)).toEqual(['started', 'cancelled', 'started', 'local_completed', 'backend_acknowledged']);
    expect(events[0].class_context).toBe('first');
    expect(events[2].class_context).toBe('subsequent');
  });

  test('identical 409 remote equivalence never claims a fresh backend acknowledgement', async ({ page }) => {
    await openIsolatedConsole(page, 'AnalyticsEquivalentConflictWorkspace');
    await page.route('**/api/v1/state', async (route) => {
      const request = route.request();
      if (request.method() !== 'PUT') { await route.continue(); return; }
      // Commit the actual business write, then model a lost response followed by
      // the existing identical-remote 409 recovery contract.
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const current = await response.json();
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'REVISION_CONFLICT', current }) });
    });
    await selectDashboardTab(page, '學生');
    await page.getByRole('button', { name: '新增班級' }).click();
    await page.getByLabel('班級名稱').fill('AnalyticsEquivalentClass');
    const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/state' && response.request().method() === 'PUT');
    await page.getByLabel('班級名稱').press('Enter');
    expect((await saved).status()).toBe(409);
    await expect(page.locator('[title="後端已同步"]')).toBeVisible();
    await expect.poll(async () => (await workflows(page, 'class_create')).map((event) => event.stage))
      .toEqual(['started', 'local_completed', 'unconfirmed']);
    expect((await workflows(page)).some((event) => event.stage === 'backend_acknowledged')).toBe(false);
  });

  test('dynamic DNT drops an in-flight acknowledgement and later teacher actions still save', async ({ page }) => {
    await openIsolatedConsole(page, 'AnalyticsDynamicDntWorkspace');
    let entered!: () => void;
    const intercepted = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/v1/state', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      const response = await route.fetch();
      entered();
      await released;
      await route.fulfill({ response });
    });
    await selectDashboardTab(page, '學生');
    await page.getByRole('button', { name: '新增班級' }).click();
    await page.getByLabel('班級名稱').fill('AnalyticsDynamicDntClass');
    await page.getByLabel('班級名稱').press('Enter');
    await intercepted;
    await page.evaluate(() => Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' }));
    release();
    await expect(page.locator('[title="後端已同步"]')).toBeVisible();
    expect((await workflows(page, 'class_create')).map((event) => event.stage)).toEqual(['started', 'local_completed']);
    await page.unroute('**/api/v1/state');
    await addStudentViaUi(page, 'AnalyticsStillFunctionalWithDnt');
    expect((await workflows(page)).some((event) => event.stage === 'backend_acknowledged')).toBe(false);
  });
});
