import { expect, test, type Page } from '@playwright/test';
import { cloneGameFeaturePreset, type GameFeatures } from '../../shared/gameFeatures';
import { createEconomyEventRecord } from '../../src/domain/game/economyRules';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import { getPublicStudentName } from '../../src/studentPresentation';
import type { AppData } from '../../src/store/types';
import { scanAccessibility } from '../accessibility/fixtures';
import {
  E2eApiSession, addStudentViaUi, loadBrowserState, openConsoleWithApiSession, performSyncedAction,
  selectTeacherDestination, testAccount, waitForBackendSync,
} from './support/fixtures';

let owner: E2eApiSession;
const labels = ['寵物養成與照顧', '個人與隊伍對戰', '魔王副本', '排行榜'] as const;
const policy = (page: Page) => page.getByRole('region', { name: '遊戲化活動入口', exact: true });
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Teacher Console', exact: true });
const flags = (preset: 'simple' | 'full' | 'teaching') => cloneGameFeaturePreset(preset);

const seed = async (name: string, features: GameFeatures | 'legacy' = flags('simple')) => {
  const created = await owner.createWorkspace(name);
  const workspaceId = created.session.activeWorkspaceId;
  if (!workspaceId) throw new Error('Synthetic game workspace is missing');
  const state = await owner.loadState(workspaceId);
  if (!state.data?.classes[0]) throw new Error('Synthetic class is missing');
  const now = Date.now();
  const settings = { ...state.data.settings!, gameFeatures: features === 'legacy' ? undefined : features };
  if (features === 'legacy') delete settings.gameFeatures;
  const students = ['Synthetic Alice', 'Synthetic Bob'].map((name, index) => ({
    ...createEnrolledStudent({ id: `game-student-${index}`, name }),
    points: 420 + index * 10, rankPoints: 50 + index * 7, teamId: 'synthetic-existing-team',
    pet: { type: 'cat', level: 3 + index, fullness: 90, happiness: 88 },
    stats: { wins: 3 + index, losses: 1 }, badges: ['badgeFirstWin'],
    pointAdjustmentRecords: [{ id: `point-history-${index}`, source: 'manual' as const,
      amount: 10, reasonLabel: 'PRIVATE_GAME_POINT_REASON', createdAt: now }],
    economyEventRecords: [createEconomyEventRecord('spend', 'feed', -10, now)],
    dailyProgress: { streak: 4, reflections: [{ id: `private-reflection-${index}`,
      date: new Date(now).toISOString().slice(0, 10), text: 'PRIVATE_GAME_MENTOR_NOTE',
      competency: 'growth' as const, author: 'mentor' as const, createdAt: now }] },
  }));
  const classroom = { ...state.data.classes[0], name: 'Synthetic Game Class', students,
    learningEvidenceRecords: [{ id: 'synthetic-game-evidence', classId: state.data.classes[0].id,
      studentId: students[0].id, competency: 'growth' as const, level: 'mastered' as const,
      evidenceType: 'observation' as const, title: 'PRIVATE_GAME_LEARNING_EVIDENCE',
      note: 'PRIVATE_GAME_LEARNING_NOTE', actor: 'mentor' as const, source: 'manual' as const,
      rubricVersion: 'v1' as const, revision: 1, createdAt: now }],
    examRecords: [{ id: 'synthetic-game-exam', title: 'PRIVATE_GAME_EXAM',
      examDate: new Date(now).toISOString().slice(0, 10),
      items: [{ id: 'reading', name: 'Reading', maxScore: 100 }],
      results: [{ studentId: students[0].id, scores: { reading: 73 },
        mentorComment: 'PRIVATE_GAME_EXAM_COMMENT', updatedAt: now }], createdAt: now, updatedAt: now }],
    activeBoss: { id: 'synthetic-active-boss', name: 'PRIVATE_GAME_BOSS_TITLE',
      isActive: true, maxHp: 1000, currentHp: 750, rewardTiers: [],
      contributions: { [students[0].id]: 250 }, attackCounts: { [students[0].id]: 3 } },
  };
  const saved = await owner.saveState({ ...state.data, settings,
    currentClassId: classroom.id, classes: [classroom] }, state.revision, workspaceId);
  return { workspaceId, saved };
};

const preservedData = (data: AppData | null) => {
  if (!data) throw new Error('Persisted synthetic data is missing');
  const copy = structuredClone(data);
  delete copy.settings!.gameFeatures;
  // Normal workspace activity can update this clock independently of policy.
  return { ...copy, lastOpened: 0 };
};

const savePolicy = async (page: Page) => {
  await performSyncedAction(page, () => policy(page).getByRole('button', {
    name: '儲存活動入口', exact: true,
  }).click());
};

const refreshVerifiedState = async (page: Page) => {
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/state' &&
    response.request().method() === 'GET' && response.status() === 200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await loaded;
  await waitForBackendSync(page);
};

test.describe('Workspace gamification availability', () => {
  test.beforeAll(async () => { owner = await E2eApiSession.register(testAccount('game-features-owner')); });
  test.afterAll(async () => { await owner.dispose(); });

  test('a newly created workspace starts with pets only and keeps daily teaching available', async ({ page }) => {
    const created = await owner.createWorkspace('new-game-features-default');
    const workspaceId = created.session.activeWorkspaceId;
    if (!workspaceId) throw new Error('New workspace is missing');
    expect((await owner.loadState(workspaceId)).data?.settings?.gameFeatures).toEqual(flags('simple'));
    await openConsoleWithApiSession(page, owner);
    await selectTeacherDestination(page, 'Activities', '寵物');
    for (const name of ['對戰', '魔王管理', '排行榜', '遊戲獎勵']) {
      await expect(page.getByRole('tab', { name, exact: true })).toHaveCount(0);
    }
    await addStudentViaUi(page, 'Synthetic new teacher learner');
    await selectTeacherDestination(page, 'Class', '加減分');
    await expect(page.getByRole('tabpanel', { name: '加減分', exact: true })).toBeVisible();
    await selectTeacherDestination(page, 'Learning', '學習證據');
    await expect(page.getByRole('heading', { name: '新增學習證據', exact: true })).toBeVisible();
  });

  test('a legacy snapshot without flags retains its activities and numeric rules stay behind advanced disclosure', async ({ page, context }) => {
    const { workspaceId, saved } = await seed('legacy-game-features', 'legacy');
    expect(saved.data?.settings?.gameFeatures).toBeUndefined();
    await openConsoleWithApiSession(page, owner);
    await selectTeacherDestination(page, 'Activities');
    for (const name of ['寵物', '對戰', '魔王管理', '排行榜', '遊戲獎勵']) {
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
    }
    await selectTeacherDestination(page, 'Settings', '規則');
    for (const name of labels) await expect(policy(page).getByRole('checkbox', { name, exact: true })).toBeChecked();
    const summary = page.locator('summary').filter({ hasText: /^進階遊戲參數$/ });
    const details = summary.locator('..');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(page.locator('#feedCost')).not.toBeVisible();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await expect(page.locator('#feedCost')).toHaveValue(String(saved.data?.settings?.feedCost));
    expect(await loadBrowserState(context, workspaceId)).toEqual(saved);
  });

  test('visibility presets survive save and reload without changing progress, economy, assessments or numeric settings', async ({ page, context }) => {
    const { workspaceId, saved } = await seed('game-presets-preserve-history', flags('full'));
    await openConsoleWithApiSession(page, owner);
    for (const [label, preset] of [['簡約養成（建議）', 'simple'], ['專注教學', 'teaching'], ['完整活動', 'full']] as const) {
      await selectTeacherDestination(page, 'Settings', '規則');
      // An unsaved numeric edit must not be committed by the separate policy save.
      const summary = page.locator('summary').filter({ hasText: /^進階遊戲參數$/ });
      await summary.click();
      await page.locator('#feedCost').fill('99');
      await policy(page).getByRole('button', { name: label, exact: true }).click();
      await savePolicy(page);
      const after = await loadBrowserState(context, workspaceId);
      expect(after.data?.settings?.gameFeatures).toEqual(flags(preset));
      expect(preservedData(after.data)).toEqual(preservedData(saved.data));
      await page.reload();
      await waitForBackendSync(page);
      if (preset === 'teaching') await expect(navigation(page).locator('#console-area-activities')).toHaveCount(0);
      else await expect(navigation(page).locator('#console-area-activities')).toBeVisible();
      await selectTeacherDestination(page, 'Settings', '規則');
      const expected = flags(preset);
      for (const [index, key] of (['pets', 'battles', 'bosses', 'leaderboards'] as const).entries()) {
        await expect(policy(page).getByRole('checkbox', { name: labels[index], exact: true }))
          .toBeChecked({ checked: expected[key] });
      }
    }
  });

  test('selective availability and the personal show preference cannot reopen an administrator-hidden activity', async ({ page, context }) => {
    const { workspaceId, saved } = await seed('game-selective-personal-preference');
    await openConsoleWithApiSession(page, owner);
    await selectTeacherDestination(page, 'Settings', '規則');
    await policy(page).getByRole('checkbox', { name: '魔王副本', exact: true }).check();
    await savePolicy(page);
    await selectTeacherDestination(page, 'Activities');
    await expect(page.getByRole('tab', { name: '寵物', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: '魔王管理', exact: true })).toBeVisible();
    for (const name of ['對戰', '排行榜']) await expect(page.getByRole('tab', { name, exact: true })).toHaveCount(0);
    const card = page.getByRole('article').first();
    await expect(card.getByRole('button', { name: '對戰', exact: true })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /建立隊伍|管理隊伍/ })).toHaveCount(0);
    await selectTeacherDestination(page, 'Today');
    await page.getByRole('button', { name: '隱藏遊戲化介面', exact: true }).click();
    await expect(navigation(page).locator('#console-area-activities')).toHaveCount(0);
    await page.getByRole('button', { name: '開啟遊戲化介面', exact: true }).click();
    await selectTeacherDestination(page, 'Activities');
    await expect(page.getByRole('tab', { name: '對戰', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '排行榜', exact: true })).toHaveCount(0);
    const after = await loadBrowserState(context, workspaceId);
    expect(after.data?.settings?.gameFeatures).toEqual({ pets: true, battles: false, bosses: true, leaderboards: false });
    expect(preservedData(after.data)).toEqual(preservedData(saved.data));
  });

  test('a verified policy refresh closes a current battle dialog and does not resurrect it when the activity is restored', async ({ page, context }) => {
    const { workspaceId, saved } = await seed('game-policy-refresh-dialog', flags('full'));
    await openConsoleWithApiSession(page, owner);
    await selectTeacherDestination(page, 'Activities', '對戰');
    await page.getByRole('article').first().getByRole('button', { name: '對戰', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '選擇對戰對手', exact: true })).toBeVisible();
    const current = await owner.loadState(workspaceId);
    if (!current.data) throw new Error('Workspace is missing');
    await owner.saveState({ ...current.data, settings: { ...current.data.settings!, gameFeatures: flags('teaching') } }, current.revision, workspaceId);
    await refreshVerifiedState(page);
    await expect(page.getByRole('dialog', { name: '選擇對戰對手', exact: true })).toHaveCount(0);
    await expect(navigation(page).locator('#console-area-activities')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '首頁', exact: true })).toBeVisible();
    const disabled = await owner.loadState(workspaceId);
    if (!disabled.data) throw new Error('Workspace is missing');
    await owner.saveState({ ...disabled.data, settings: { ...disabled.data.settings!, gameFeatures: flags('full') } }, disabled.revision, workspaceId);
    await refreshVerifiedState(page);
    await selectTeacherDestination(page, 'Activities', '對戰');
    await expect(page.getByRole('dialog', { name: '選擇對戰對手', exact: true })).toHaveCount(0);
    expect(preservedData((await loadBrowserState(context, workspaceId)).data)).toEqual(preservedData(saved.data));
  });

  test('a boss-only workspace starts its available activity directly without exposing hidden pet care', async ({ page, context }) => {
    const { workspaceId, saved } = await seed('game-boss-only', { pets: false, battles: false, bosses: true, leaderboards: false });
    await openConsoleWithApiSession(page, owner);
    await page.getByRole('region', { name: '快速操作', exact: true }).getByRole('button', { name: '開始活動', exact: true }).click();
    await expect(page.getByRole('tab', { name: '魔王管理', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: '寵物', exact: true })).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(2);
    for (const card of await page.getByRole('article').all()) {
      await expect(card.getByRole('button', { name: '討伐 (-20)', exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: /餵食|玩耍|升級|對戰|建立隊伍|管理隊伍/ })).toHaveCount(0);
    }
    expect(await loadBrowserState(context, workspaceId)).toEqual(saved);
  });

  test('teaching-only controls retain the read-only masked presentation without exposing private records or mutation buttons', async ({ page, context }) => {
    const { workspaceId, saved } = await seed('game-hidden-presentation', flags('teaching'));
    await openConsoleWithApiSession(page, owner);
    await expect(navigation(page).locator('#console-area-activities')).toHaveCount(0);
    await page.getByRole('button', { name: '展示大廳', exact: true }).click();
    const display = page.locator('[data-presentation-mode="true"]');
    await expect(display).toBeVisible();
    await expect(display.getByRole('heading', { name: '寵物展示大廳', exact: true })).toBeVisible();
    await expect(display.getByRole('article')).toHaveCount(2);
    for (const student of saved.data!.classes[0].students) {
      await expect(display.getByRole('heading', { name: getPublicStudentName(student.name, 'masked'), exact: true })).toBeVisible();
    }
    await expect(display.getByRole('progressbar', { name: '魔王生命值', exact: true })).toHaveAttribute('aria-valuenow', '750');
    await expect(display.getByRole('button', { name: /對戰|扭蛋|餵食|攻擊|討伐/ })).toHaveCount(0);
    const text = await display.innerText();
    for (const secret of ['PRIVATE_GAME_POINT_REASON', 'PRIVATE_GAME_MENTOR_NOTE', 'PRIVATE_GAME_LEARNING_EVIDENCE', 'PRIVATE_GAME_EXAM', 'PRIVATE_GAME_BOSS_TITLE']) {
      expect(text).not.toContain(secret);
    }
    expect(await loadBrowserState(context, workspaceId)).toEqual(saved);
  });

  test('mobile and tablet policy controls fit, support keyboard disclosure, and pass the existing serious accessibility gate', async ({ page }, info) => {
    await seed('game-responsive-settings');
    await openConsoleWithApiSession(page, owner);
    await selectTeacherDestination(page, 'Settings', '規則');
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await policy(page).getByRole('button', { name: '完整活動', exact: true }).click();
      for (const name of ['簡約養成（建議）', '完整活動', '專注教學', '儲存活動入口']) {
        const button = policy(page).getByRole('button', { name, exact: true });
        await button.focus();
        await expect(button).toBeFocused();
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await scanAccessibility(page, info, `game-features-${width}`);
      await policy(page).screenshot({ path: `output/game-ux/settings-${width}.png` });
    }
    const summary = page.locator('summary').filter({ hasText: /^進階遊戲參數$/ });
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(summary.locator('..')).toHaveAttribute('open', '');
    await expect(page.locator('#feedCost')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.locator('#feedCost')).not.toBeVisible();
  });
});
