import { expect, type Locator, type Page } from '@playwright/test';
import { createEnrolledStudent } from '../../src/studentEnrollment';
import type { Language } from '../../src/store/types';
import { E2eApiSession, testAccount } from '../e2e/support/fixtures';
import { scanAccessibility, test } from './fixtures';

// Synthetic names deliberately include unbroken text within the existing
// 200-character contract. No real student data is used by this suite.
const names = [
  'SyntheticLongLearnerNameWithoutSpaces'.repeat(3),
  '合成測試學生名字很長僅供排版驗證'.repeat(3),
  'Synthetic Escape Reward Learner',
  'Synthetic Keep Reward Learner',
];

const seedPetActivities = async (page: Page, language: Language) => {
  const session = await E2eApiSession.register(testAccount(`pet-a11y-${language}`));
  const snapshot = await session.loadState();
  if (!snapshot.data) throw new Error('Synthetic workspace is missing');
  const classData = snapshot.data.classes[0];
  const students = names.map((name, index) => ({
    ...createEnrolledStudent({ id: `pet-a11y-${index}`, name }),
    points: 700,
    teamId: index < 2 ? 'synthetic-a11y-team' : undefined,
    pet: { type: 'cat', level: index === 1 ? 2 : 1, fullness: index === 0 ? 80 : 100, happiness: 80 },
  }));
  await session.saveState({
    ...snapshot.data,
    settings: {
      ...snapshot.data.settings!,
      language,
      inclusiveMode: false,
      publicNameMode: 'full',
      gameFeatures: { pets: true, battles: true, bosses: true, leaderboards: true },
      battleEnabled: true,
      battleMode: 'both',
      // Keep the synthetic action states stable throughout a slow axe run.
      decayAmount: 0,
    },
    classes: [{
      ...classData,
      students,
      activeBoss: {
        id: 'synthetic-a11y-boss', name: 'Synthetic Boss', isActive: true,
        maxHp: 1000, currentHp: 1000, contributions: {}, rewardTiers: [],
      },
    }],
    currentClassId: classData.id,
  }, snapshot.revision);
  await page.context().addCookies((await session.context.storageState()).cookies);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: language === 'en' ? 'Today' : '首頁', exact: true })).toBeVisible();
  const hubName = language === 'en' ? 'Pet activities' : '寵物活動';
  await page.getByRole('button', { name: hubName, exact: true }).click();
  await expect(page.getByRole('heading', { name: hubName, exact: true })).toBeVisible();
  await expect(page.locator('#pet-activity-class')).toHaveValue(classData.id);
  return { session, classId: classData.id };
};

const expectReflow = async (page: Page) => {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'The page must not require horizontal scrolling').toBeLessThanOrEqual(1);
  for (const card of await page.getByRole('article').all()) {
    expect(await card.evaluate((element) => element.scrollWidth - element.clientWidth),
      'Long names and controls must fit each pet card').toBeLessThanOrEqual(1);
    const badges = card.getByRole('list');
    if (await badges.count()) {
      const nameBounds = await card.getByRole('heading', { level: 2 }).boundingBox();
      const badgeBounds = await badges.boundingBox();
      expect(nameBounds).not.toBeNull();
      expect(badgeBounds).not.toBeNull();
      expect(badgeBounds!.y, 'Earned badges must not overlap a wrapped student name')
        .toBeGreaterThanOrEqual(nameBounds!.y + nameBounds!.height);
    }
  }
};

const expectTouchTarget = async (control: Locator) => {
  await expect(control).toBeVisible();
  const bounds = await control.boundingBox();
  expect(bounds).not.toBeNull();
  // Product usability requirement; WCAG 2.5.8 AA itself specifies 24 CSS px.
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
};

for (const language of ['zh', 'en'] as const) {
  for (const viewport of [{ width: 320, height: 568 }, { width: 768, height: 1024 }]) {
    test(`Pet activities: ${language} ${viewport.width}px reflow, actions and scrollable dialogs`, async ({ page }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      const { session } = await seedPetActivities(page, language);
      try {
        const card = page.getByRole('article', { name: names[0], exact: true });
        const pendingRewardCard = page.getByRole('article', { name: names[1], exact: true });
        await expect(card).toBeVisible();
        await expectReflow(page);
        const feed = card.getByRole('button', { name: language === 'en' ? /^Feed/ : /^餵食/ });
        const play = card.getByRole('button', { name: language === 'en' ? /^Play/ : /^玩耍/ });
        const team = card.getByRole('button', { name: language === 'en' ? 'Manage Team' : '管理隊伍', exact: true });
        const battle = card.getByRole('button', { name: language === 'en' ? 'Battle' : '對戰', exact: true });
        const attack = card.getByRole('button', { name: language === 'en' ? /^Attack/ : /^討伐/ });
        const upgrade = pendingRewardCard.getByRole('button', { name: language === 'en' ? /^Upgrade/ : /^升級/ });
        for (const action of [feed, play, team, battle, attack, upgrade]) {
          await expect(action).toBeEnabled();
          await expectTouchTarget(action);
        }
        await scanAccessibility(page, info, `pet-actions-${language}-${viewport.width}`);

        await team.focus();
        await page.keyboard.press('Enter');
        const teamDialog = page.getByRole('dialog', { name: language === 'en' ? 'Manage Team' : '管理隊伍', exact: true });
        const close = teamDialog.getByRole('button', { name: language === 'en' ? 'Close' : '關閉', exact: true });
        const save = teamDialog.getByRole('button', { name: language === 'en' ? 'Save Team' : '儲存隊伍', exact: true });
        await expect(teamDialog).toHaveCSS('overflow-y', 'auto');
        await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(save).toBeFocused();
        await expect(save).toBeInViewport({ ratio: 1 });
        await expectTouchTarget(save);
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await expect(close).toBeInViewport({ ratio: 1 });
        await scanAccessibility(page, info, `pet-team-${language}-${viewport.width}`);
        await page.keyboard.press('Escape');
        await expect(teamDialog).not.toBeVisible();
        await expect(team).toBeFocused();

        await battle.focus();
        await page.keyboard.press('Enter');
        const battleDialog = page.getByRole('dialog', { name: language === 'en' ? 'Select Opponent' : '選擇對戰對手', exact: true });
        await expect(battleDialog).toHaveCSS('overflow-y', 'auto');
        // Non-toggle buttons also match pressed:false in Playwright. Select an
        // actual opponent, never the dialog's Close/Cancel controls.
        await battleDialog.locator('button[aria-pressed="false"]').first().click();
        const start = battleDialog.getByRole('button', { name: language === 'en' ? 'Start Battle' : '開始對戰', exact: true });
        await expect(start).toBeEnabled();
        const battleClose = battleDialog.getByRole('button', { name: language === 'en' ? 'Close' : '關閉', exact: true });
        await battleClose.focus();
        await page.keyboard.press('Shift+Tab');
        await expect(start).toBeFocused();
        await expect(start).toBeInViewport({ ratio: 1 });
        await expectTouchTarget(start);
        await scanAccessibility(page, info, `pet-battle-${language}-${viewport.width}`);
        await page.keyboard.press('Escape');
        await expect(battleDialog).not.toBeVisible();
        await expect(battle).toBeFocused();
        await expectReflow(page);
      } finally {
        await session.dispose();
      }
    });
  }

  test(`Level-up reward: ${language} native keyboard modality and Escape equals Keep`, async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const { session, classId } = await seedPetActivities(page, language);
    try {
      const dialogName = language === 'en' ? 'Level-Up Reward Gacha' : '升級獎勵扭蛋';
      const keepName = language === 'en' ? 'Keep Current Pet' : '保留原寵物';
      const drawName = language === 'en' ? 'Draw New Pet' : '抽新寵物';
      for (const [index, choice] of [[2, 'escape'], [3, 'keep']] as const) {
        const card = page.getByRole('article', { name: names[index], exact: true });
        const upgrade = card.getByRole('button', { name: language === 'en' ? /^Upgrade/ : /^升級/ });
        await upgrade.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
        const keep = dialog.getByRole('button', { name: keepName, exact: true });
        const draw = dialog.getByRole('button', { name: drawName, exact: true });
        await expect(keep).toBeFocused();
        expect(await dialog.evaluate((element) => element instanceof HTMLDialogElement && element.matches(':modal'))).toBe(true);
        // Native modality must prevent focus moving to the background controls.
        await page.locator('#pet-activity-class').evaluate((element) => (element as HTMLElement).focus());
        await expect(keep).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(draw).toBeFocused();
        await expect(draw).toBeInViewport({ ratio: 1 });
        await page.keyboard.press('Tab');
        await expect(keep).toBeFocused();
        await scanAccessibility(page, info, `pet-reward-${language}-${choice}`);
        if (choice === 'escape') {
          await page.keyboard.press('Tab');
          await expect(draw).toBeFocused();
          await page.keyboard.press('Escape');
        } else {
          await page.keyboard.press('Enter');
        }
        await expect(dialog).not.toBeVisible();
        // The hub heading remains mounted even when a filter/page removes the
        // original card, making it a stable keyboard recovery destination.
        await expect(page.locator('#pet-activities-title')).toBeFocused();
        await expect.poll(async () => {
          const saved = await session.loadState();
          const student = saved.data?.classes.find((item) => item.id === classId)?.students.find((item) => item.id === `pet-a11y-${index}`);
          return student && { pet: student.pet, points: student.points, nextUpgradeGachaLevel: student.nextUpgradeGachaLevel };
        }).toEqual({ pet: { type: 'cat', level: 2, fullness: 100, happiness: 80, isDead: false }, points: 600, nextUpgradeGachaLevel: 4 });
      }
      await page.reload();
      await page.getByRole('button', { name: language === 'en' ? 'Pet activities' : '寵物活動', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
      await session.dispose();
    }
  });
}
