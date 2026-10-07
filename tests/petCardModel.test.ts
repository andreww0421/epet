import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PET_GACHA_COST,
  PET_MAX_LEVEL,
  PET_UPGRADE_FULLNESS_REQUIREMENT,
  PET_UPGRADE_MIN_HAPPINESS,
  createPenaltyStatus,
  getPetUpgradeCost,
} from '../src/gameRules';
import {
  buildPetCardModel,
  type BuildPetCardModelInput,
  type PetCardSettings,
} from '../src/features/pets/model/petCardModel';
import { createEnrolledStudent } from '../src/studentEnrollment';
import type { Student } from '../src/store/types';

const NOW = Date.UTC(2026, 8, 14, 4);

const createSettings = (
  overrides: Partial<PetCardSettings> = {},
): PetCardSettings => ({
  lang: 'zh',
  feedCost: 10,
  playCost: 5,
  reviveCost: 120,
  maxPoints: 700,
  maxTeamSize: 6,
  battleEnabled: true,
  battleMode: 'both',
  inclusiveMode: true,
  petCareMode: 'rest',
  publicNameMode: 'masked',
  teamBattleMinFullnessEnabled: true,
  teamBattleMinFullness: 50,
  schoolTimeZone: 'Asia/Taipei',
  schoolWeekdays: [1, 2, 3, 4, 5],
  schoolHolidayDates: [],
  dailyTaskMakeupWindowDays: 7,
  ...overrides,
});

const createStudent = (overrides: Partial<Student> = {}): Student => {
  const enrolled = createEnrolledStudent({ id: 'student-1', name: 'Alice Chen' });
  return {
    ...enrolled,
    ...overrides,
    pet: {
      ...enrolled.pet,
      type: 'cat',
      ...overrides.pet,
    },
  };
};

const build = (
  studentOverrides: Partial<Student> = {},
  settingsOverrides: Partial<PetCardSettings> = {},
  inputOverrides: Partial<BuildPetCardModelInput> = {},
) => buildPetCardModel({
  student: createStudent(studentOverrides),
  settings: createSettings(settingsOverrides),
  bossIsActive: false,
  classGoals: [],
  learningEvidence: [],
  now: NOW,
  ...inputOverrides,
});

test('pet card model preserves exact care, gacha and upgrade boundaries', () => {
  const ready = build({
    points: PET_GACHA_COST,
    pet: {
      type: 'cat',
      level: 1,
      fullness: PET_UPGRADE_FULLNESS_REQUIREMENT,
      happiness: PET_UPGRADE_MIN_HAPPINESS,
    },
  });

  assert.equal(ready.actions.canFeed, true);
  assert.equal(ready.actions.canPlay, true);
  assert.equal(ready.actions.canGacha, true);
  assert.equal(ready.actions.canUpgrade, true);
  assert.equal(ready.actions.upgradeCost, getPetUpgradeCost(1));
  assert.equal(ready.actions.gachaCost, PET_GACHA_COST);

  assert.equal(build({ points: 9 }).actions.canFeed, false);
  assert.equal(build({ points: 4 }).actions.canPlay, false);
  assert.equal(build({ points: PET_GACHA_COST - 1 }).actions.canGacha, false);
  assert.equal(build({
    pet: { type: 'cat', level: 1, fullness: 99, happiness: 80 },
  }).actions.canUpgrade, false);
  assert.equal(build({
    pet: { type: 'cat', level: 1, fullness: 100, happiness: 39 },
  }).actions.canUpgrade, false);
  assert.equal(build({
    points: 700,
    pet: { type: 'cat', level: PET_MAX_LEVEL, fullness: 100, happiness: 100 },
  }).actions.canUpgrade, false);
});

test('pet card model distinguishes resting, dead, hungry, normal and happy states', () => {
  assert.equal(build({
    pet: { type: 'cat', level: 1, fullness: 0, happiness: 80 },
  }).pet.condition, 'resting');
  assert.equal(build({
    pet: { type: 'cat', level: 1, fullness: 0, happiness: 80, isDead: true },
  }).pet.condition, 'dead');
  assert.equal(build({
    pet: { type: 'cat', level: 1, fullness: 80, happiness: 29 },
  }).pet.condition, 'hungry');
  assert.equal(build({
    pet: { type: 'cat', level: 1, fullness: 50, happiness: 80 },
  }).pet.condition, 'normal');
  assert.equal(build({
    pet: { type: 'cat', level: 1, fullness: 80, happiness: 80 },
  }).pet.condition, 'happy');

  const resting = build(
    { pet: { type: 'cat', level: 1, fullness: 0, happiness: 80 } },
    { petCareMode: 'rest' },
  );
  assert.equal(resting.actions.canFeed, true);
  assert.equal(resting.actions.canPlay, false);
});

test('pet card model preserves battle modes, penalty gates and boss cooldown display', () => {
  const lowFullness = {
    pet: { type: 'cat', level: 1, fullness: 40, happiness: 80 },
  } satisfies Partial<Student>;
  assert.equal(build(lowFullness, { battleMode: 'solo' }).actions.canBattle, false);
  assert.equal(build(
    lowFullness,
    { battleMode: 'team', teamBattleMinFullnessEnabled: false },
  ).actions.canBattle, true);
  assert.equal(build(
    lowFullness,
    { battleMode: 'both', teamBattleMinFullnessEnabled: false },
  ).actions.canBattle, true);

  const penalized = build({
    penaltyStatus: createPenaltyStatus('autoPenalty', NOW),
  }, {}, { bossIsActive: true });
  assert.equal(penalized.actions.canBattle, false);
  assert.equal(penalized.actions.canAttackBoss, false);
  assert.equal(penalized.actions.warnings.battleBlockedByPenalty, true);

  const recovering = build({
    bossRecovery: {
      impact: 10,
      startedAt: NOW - 1_000,
      recoverAt: NOW + 90_001,
    },
  });
  assert.equal(recovering.hasBossRecovery, true);
  assert.equal(recovering.bossRecoveryMinutes, 2);
});

test('pet card model keeps names masked and inclusive feedback reasons private', () => {
  const feedback = {
    id: 'feedback-1',
    amount: 5,
    createdAt: NOW - 1_000,
    source: 'manual' as const,
    reasonLabel: 'Private teacher note',
    competency: 'collaboration' as const,
  };
  const inclusive = build({ pointAdjustmentRecords: [feedback] });
  assert.equal(inclusive.publicStudentName, 'A*** C***');
  assert.equal(inclusive.learning.latestPositiveReason, undefined);
  assert.equal(inclusive.learning.latestPositiveCompetency, 'collaboration');
  assert.equal(inclusive.learning.shouldDisplay, true);

  const explicit = build(
    { pointAdjustmentRecords: [feedback] },
    { inclusiveMode: false },
  );
  assert.equal(explicit.learning.latestPositiveReason, 'Private teacher note');
});
