import assert from 'node:assert/strict';

import {
  PET_DEATH_DELAY_MS,
  REVIVE_COST,
  applyDecayToStudent,
  applyBossContributionRewards,
  applyFeedToStudent,
  applyPointGuardrail,
  applyPointAdjustmentToStudent,
  applyParticipationSupportToStudent,
  attackWorldBoss,
  claimDailyTaskForStudent,
  createAutomatedBossRewardTier,
  createPenaltyStatus,
  createPointAdjustmentRecord,
  createEconomyEventRecord,
  getDailyTaskClaimPlan,
  getDailyTeacherPointTotals,
  getMedianPoints,
  getParticipationSupportPlan,
  getDateKey,
  getActiveClassGoals,
  getWeekStartDate,
  getWeekEndDate,
  addDaysToDateKey,
  getBossContributionStandings,
  recalculateBossRewardTiers,
  resolveBattle,
  resolveBossAttack,
  resolveRecoverableBossAttack,
  resolveSharedBossAttack,
  resolveTeamBattle,
  reviveStudentPet,
  saveMentorDailyFeedbackForStudent,
  isBossRecoveryActive,
  type BossRewardRecord,
  type EconomyEventRecord,
  type StudentRuleState,
} from '../src/gameRules.js';
import {
  applyDecay,
  computeBadges,
  countDecayPeriods,
  getSettingsImpactPreview,
  normalizeAppData,
} from '../src/store/utils.js';
import {
  getClassGoalCoverage,
  getClassGoalProgress,
  getDailyPointFairnessInsights,
  getNextStudentGoal,
  getWeeklyEducationInsights,
  getWeeklyStudentGrowth,
} from '../src/educationInsights.js';
import { getPublicStudentName } from '../src/studentPresentation.js';
import {
  computeClassEffectivenessMetrics,
  computeStudentLearningAnalytics,
  createLearningEvidenceRecord,
} from '../shared/education.js';
import {
  computeExamStudentAnalysis,
  normalizeExamRecords,
} from '../src/examAnalytics.js';
import {
  createExamReportHtml,
  getExamReportSelection,
} from '../src/examReport.js';
import {
  createWeeklyFeedbackReportCsv,
  getWeeklyFeedbackReport,
} from '../src/weeklyFeedbackReport.js';
import { getTeacherEconomyInsights } from '../src/economyInsights.js';

const memoryStorage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    clear: () => memoryStorage.clear(),
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    key: (index: number) => Array.from(memoryStorage.keys())[index] ?? null,
    get length() {
      return memoryStorage.size;
    },
    removeItem: (key: string) => memoryStorage.delete(key),
    setItem: (key: string, value: string) => memoryStorage.set(key, value),
  },
});
const { getStoreSessionGeneration, resetStoreForSession, useStore } = await import('../src/store/useStore.js');

const tests: Array<{ name: string; run: () => void }> = [];

const test = (name: string, run: () => void) => {
  tests.push({ name, run });
};

const createStudent = (id = 'student-1', name = 'Student 1') => ({
  id,
  name,
  points: 200,
  rankPoints: 100,
  warningPoints: 0,
  pet: {
    fullness: 80,
    happiness: 50,
    level: 3,
  } as StudentRuleState['pet'],
  stats: {
    wins: 0,
    losses: 0,
  },
  nextUpgradeGachaLevel: 4,
  disciplineRecords: [],
  pointAdjustmentRecords: [],
  economyEventRecords: [] as EconomyEventRecord[],
  bossRewardRecords: [] as BossRewardRecord[],
  dailyProgress: {
    streak: 0,
  },
  lastBossDamage: undefined as number | undefined,
  lastBossFairScore: undefined as number | undefined,
});

const createBoss = () => ({
  id: 'boss-1',
  name: 'Training Boss',
  maxHp: 100,
  currentHp: 100,
  rewardTiers: [
    { rank: 1, points: 50, happiness: 10, rankPoints: 25 },
    { rank: 2, points: 30, happiness: 5, rankPoints: 10 },
  ],
  contributions: {},
  attackCounts: {},
  isActive: true,
});

test('resolveBattle returns draw when scores are equal', () => {
  const attacker = createStudent();
  const defender = createStudent();

  const result = resolveBattle(attacker, defender, { attacker: 5, defender: 5 }, undefined, 1000);

  assert.equal(result.blocked, null);
  assert.equal(result.outcome, 'draw');
  assert.equal(result.attacker.pet.fullness, 30);
  assert.equal(result.defender.pet.fullness, 30);
});

test('resolveBattle uses configurable solo cost and point settings symmetrically', () => {
  const attacker = createStudent();
  const defender = createStudent();

  const result = resolveBattle(
    attacker,
    defender,
    { attacker: 12, defender: 0 },
    {
      soloBattleFullnessCost: 22,
      soloBattleWinPoints: 35,
      soloBattleLossPoints: 18,
    },
    1000,
  );

  assert.equal(result.blocked, null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.attacker.points, 235);
  assert.equal(result.defender.points, 182);
  assert.equal(result.attacker.pet.fullness, 58);
  assert.equal(result.defender.pet.fullness, 58);
});

test('resolveBattle can use different attacker and defender fullness costs', () => {
  const attacker = createStudent();
  const defender = createStudent();

  const result = resolveBattle(
    attacker,
    defender,
    { attacker: 12, defender: 0 },
    {
      soloBattleFullnessCost: 50,
      soloBattleAttackerFullnessCost: 18,
      soloBattleDefenderFullnessCost: 9,
    },
    1000,
  );

  assert.equal(result.blocked, null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.attacker.pet.fullness, 62);
  assert.equal(result.defender.pet.fullness, 71);
});

test('applyFeedToStudent uses custom feed gain and reduced mood under penalty', () => {
  const student = {
    ...createStudent(),
    points: 160,
    pet: {
      ...createStudent().pet,
      fullness: 60,
      happiness: 40,
    },
    penaltyStatus: createPenaltyStatus('autoPenalty', 1000),
  };

  const result = applyFeedToStudent(student, 10, 35, 2000);

  assert.equal(result.points, 150);
  assert.equal(result.pet.fullness, 95);
  assert.equal(result.pet.happiness, 45);
  assert.equal(result.economyEventRecords?.[0].source, 'feed');
  assert.equal(result.economyEventRecords?.[0].amount, -10);
});

test('teacher economy insights calculate supply, spend, saturation, duplicates, and concentration', () => {
  const now = 10_000_000;
  const students = [
    {
      ...createStudent('a', 'Alpha'),
      points: 700,
      pointAdjustmentRecords: [createPointAdjustmentRecord(80, 'manual', undefined, now - 100)],
      economyEventRecords: [createEconomyEventRecord('spend', 'gacha', -20, now - 90, {
        previousPetType: 'cat', newPetType: 'cat',
      })],
    },
    {
      ...createStudent('b', 'Beta'),
      pointAdjustmentRecords: [createPointAdjustmentRecord(10, 'dailyTask', undefined, now - 100)],
      economyEventRecords: [createEconomyEventRecord('spend', 'gacha', -20, now - 90, {
        previousPetType: 'cat', newPetType: 'dog',
      })],
    },
    {
      ...createStudent('c', 'Gamma'),
      pointAdjustmentRecords: [createPointAdjustmentRecord(10, 'quick', undefined, now - 100)],
    },
    createStudent('d', 'Delta'),
    createStudent('e', 'Epsilon'),
  ];

  const insights = getTeacherEconomyInsights(students as any, 700, now, 30);

  assert.equal(insights.totalIssued, 100);
  assert.equal(insights.totalSpent, 40);
  assert.equal(insights.issuanceSpendRatio, 2.5);
  assert.equal(insights.maxedRate, 0.2);
  assert.equal(insights.duplicatePetChangeRate, 0.5);
  assert.equal(insights.rewardConcentrationRate, 0.8);
  assert.equal(insights.warnings.inflation, true);
  assert.equal(insights.warnings.saturation, true);
  assert.equal(insights.warnings.concentration, true);
});

test('applyDecayToStudent marks pet dead after staying at zero fullness long enough', () => {
  const zeroed = applyDecayToStudent(
    {
      ...createStudent(),
      pet: {
        ...createStudent().pet,
        fullness: 5,
      },
    },
    10,
    1000,
  );

  assert.equal(zeroed.pet.fullness, 0);
  assert.equal(zeroed.pet.isDead, false);
  assert.equal(zeroed.pet.zeroFullnessSince, 1000);

  const dead = applyDecayToStudent(zeroed, 0, 1000 + PET_DEATH_DELAY_MS);
  assert.equal(dead.pet.isDead, true);
});

test('supportive pet care keeps a zero-fullness pet resting instead of dead', () => {
  const zeroed = {
    ...createStudent(),
    pet: {
      ...createStudent().pet,
      fullness: 0,
      isDead: true,
      zeroFullnessSince: 1000,
    },
  };

  const resting = applyDecayToStudent(
    zeroed,
    0,
    1000 + PET_DEATH_DELAY_MS,
    { allowDeath: false },
  );

  assert.equal(resting.pet.fullness, 0);
  assert.equal(resting.pet.isDead, false);
});

test('weekend pause excludes Saturday and Sunday from hourly decay', () => {
  const hour = 1000 * 60 * 60;
  const fridayNoon = new Date(2026, 6, 24, 12).getTime();
  const mondayNoon = new Date(2026, 6, 27, 12).getTime();

  assert.equal(countDecayPeriods(fridayNoon, mondayNoon, hour, true), 24);
  assert.equal(countDecayPeriods(fridayNoon, mondayNoon, hour, false), 72);

  const data = normalizeAppData(
    {
      lastOpened: fridayNoon,
      currentClassId: 'class-a',
      classes: [{
        id: 'class-a',
        name: 'Class A',
        students: [{
          ...createStudent('a', 'Alpha'),
          pet: { ...createStudent().pet, fullness: 100 },
        }],
      }],
      settings: {
        decayAmount: 2,
        decayType: 'hourly',
        pauseDecayOnWeekends: true,
        petCareMode: 'rest',
      },
    },
    fridayNoon,
  );
  const decayed = applyDecay(data, mondayNoon);

  assert.equal(decayed.classes[0].students[0].pet.fullness, 52);
  assert.equal(decayed.classes[0].students[0].pet.isDead, false);
});

test('workspace export and import preserves complete pet state without replaying stale decay', () => {
  const exportedAt = new Date(2026, 0, 1, 8).getTime();
  const importedAt = new Date(2026, 1, 1, 8).getTime();
  const exportedData = normalizeAppData(
    {
      lastOpened: exportedAt,
      currentClassId: 'class-a',
      classes: [{
        id: 'class-a',
        name: 'Class A',
        students: [{
          ...createStudent('healthy', 'Healthy Pet'),
          pet: {
            type: 'dog',
            fullness: 73,
            happiness: 61,
            level: 4,
            isDead: false,
          },
        }, {
          ...createStudent('dead', 'Dead Pet'),
          pet: {
            type: 'cat',
            fullness: 0,
            happiness: 25,
            level: 6,
            isDead: true,
            zeroFullnessSince: exportedAt - PET_DEATH_DELAY_MS,
          },
        }],
      }],
      settings: {
        decayAmount: 2,
        decayType: 'hourly',
        inclusiveMode: false,
        pauseDecayOnWeekends: false,
        petCareMode: 'death',
      },
    },
    exportedAt,
  );

  useStore.getState().importData(
    JSON.parse(JSON.stringify(exportedData)),
    importedAt,
  );

  const imported = useStore.getState().data;
  const healthyPet = imported.classes[0].students[0].pet;
  const deadPet = imported.classes[0].students[1].pet;
  assert.deepEqual(healthyPet, {
    type: 'dog',
    fullness: 73,
    happiness: 61,
    level: 4,
    isDead: false,
    zeroFullnessSince: undefined,
  });
  assert.deepEqual(deadPet, {
    type: 'cat',
    fullness: 0,
    happiness: 25,
    level: 6,
    isDead: true,
    zeroFullnessSince: exportedAt - PET_DEATH_DELAY_MS,
  });
  assert.equal(imported.lastOpened, importedAt);

  const immediatelyHydrated = applyDecay(imported, importedAt);
  const oneHourLater = applyDecay(imported, importedAt + 60 * 60 * 1000);
  assert.equal(
    immediatelyHydrated.classes[0].students[0].pet.fullness,
    73,
  );
  assert.equal(oneHourLater.classes[0].students[0].pet.fullness, 71);

  useStore.getState().importData({
    students: [{
      ...createStudent('legacy-resting', 'Legacy Resting Pet'),
      pet: {
        type: 'rabbit',
        fullness: 0,
        happiness: 30,
        level: 2,
        isDead: true,
        zeroFullnessSince: exportedAt - PET_DEATH_DELAY_MS,
      },
    }],
    settings: {
      inclusiveMode: true,
      petCareMode: 'rest',
    },
  }, importedAt);
  const legacyRestingPet =
    useStore.getState().data.classes[0].students[0].pet;
  assert.equal(legacyRestingPet.fullness, 0);
  assert.equal(legacyRestingPet.happiness, 30);
  assert.equal(legacyRestingPet.isDead, false);
  resetStoreForSession(importedAt);
});

test('reviveStudentPet costs points and clears dead state', () => {
  const student = {
    ...createStudent(),
    points: 300,
    pet: {
      ...createStudent().pet,
      fullness: 0,
      happiness: 10,
      isDead: true,
      zeroFullnessSince: 1000,
    },
  };

  const result = reviveStudentPet(student);

  assert.equal(result.points, 300 - REVIVE_COST);
  assert.equal(result.pet.isDead, false);
  assert.equal(result.pet.zeroFullnessSince, undefined);
  assert.equal(result.pet.fullness, 40);
  assert.equal(result.pet.happiness, 25);
  assert.equal(result.economyEventRecords?.[0].source, 'revive');
  assert.equal(result.economyEventRecords?.[0].amount, -REVIVE_COST);
});

test('claimDailyTaskForStudent grants reward once per day and grows streak', () => {
  const first = claimDailyTaskForStudent(
    createStudent(),
    Date.UTC(2026, 2, 29, 1, 0, 0),
    700,
  );

  assert.equal(first.claimed, true);
  assert.equal(first.rewardPoints, 30);
  assert.equal(first.student.points, 230);
  assert.equal(first.student.dailyProgress?.streak, 1);

  const secondSameDay = claimDailyTaskForStudent(
    first.student,
    Date.UTC(2026, 2, 29, 8, 0, 0),
    700,
  );
  assert.equal(secondSameDay.claimed, false);

  const nextDay = claimDailyTaskForStudent(
    first.student,
    Date.UTC(2026, 2, 30, 1, 0, 0),
    700,
  );
  assert.equal(nextDay.claimed, true);
  assert.equal(nextDay.rewardPoints, 35);
  assert.equal(nextDay.student.dailyProgress?.streak, 2);
});

test('daily task grants its reward without collecting feedback data', () => {
  const now = Date.UTC(2026, 6, 28, 2, 0, 0);
  const result = claimDailyTaskForStudent(
    createStudent('a', 'Alpha'),
    now,
    700,
    'Homework Completion Task',
  );

  assert.equal(result.claimed, true);
  assert.equal(result.student.points, 230);
  assert.equal(result.student.dailyProgress?.reflections, undefined);
  assert.deepEqual(result.student.pointAdjustmentRecords?.[0], {
    id: result.student.pointAdjustmentRecords?.[0].id,
    amount: 30,
    createdAt: now,
    source: 'dailyTask',
    reasonId: 'daily-homework',
    reasonLabel: 'Homework Completion Task',
    competency: 'assignmentQuality',
  });
});

test('daily teacher point guardrails clamp and block positive and negative adjustments', () => {
  const now = Date.UTC(2026, 7, 25, 4, 0, 0);
  const student = {
    ...createStudent('a', 'Alpha'),
    pointAdjustmentRecords: [
      createPointAdjustmentRecord(190, 'quick', undefined, now - 1000),
      createPointAdjustmentRecord(-55, 'manual', undefined, now - 2000),
      createPointAdjustmentRecord(30, 'dailyTask', undefined, now - 3000),
      createPointAdjustmentRecord(99, 'quick', undefined, now - 24 * 60 * 60 * 1000),
    ],
  };

  assert.deepEqual(getDailyTeacherPointTotals(student, now, 'Asia/Taipei'), {
    positive: 190,
    negative: 55,
  });
  assert.deepEqual(
    applyPointGuardrail(student, 25, now, {
      timeZone: 'Asia/Taipei',
      dailyPositiveLimit: 200,
      dailyNegativeLimit: 60,
    }),
    {
      requestedAmount: 25,
      appliedAmount: 10,
      outcome: 'clamped',
      reason: 'dailyPositiveLimit',
      usedAmount: 190,
      remainingAmount: 0,
    },
  );
  assert.equal(applyPointGuardrail(student, -10, now, {
    timeZone: 'Asia/Taipei',
    dailyPositiveLimit: 200,
    dailyNegativeLimit: 60,
  }).appliedAmount, -5);

  const cappedStudent = {
    ...student,
    pointAdjustmentRecords: [
      createPointAdjustmentRecord(200, 'airdrop', undefined, now - 500),
    ],
  };
  assert.deepEqual(
    applyPointGuardrail(cappedStudent, 10, now, {
      timeZone: 'Asia/Taipei',
      dailyPositiveLimit: 200,
    }),
    {
      requestedAmount: 10,
      appliedAmount: 0,
      outcome: 'blocked',
      reason: 'dailyPositiveLimit',
      usedAmount: 200,
      remainingAmount: 0,
    },
  );
});

test('participation support tops up a first reward and grants catch-up once per school day', () => {
  const now = Date.UTC(2026, 7, 25, 4, 0, 0);
  const baseReward = createPointAdjustmentRecord(10, 'quick', undefined, now - 1000);
  const lowStudent = {
    ...createStudent('low', 'Low'),
    points: 210,
    pointAdjustmentRecords: [baseReward],
  };
  const comparisonStudents = [
    { points: 210 },
    { points: 500 },
  ];
  const options = {
    timeZone: 'Asia/Taipei',
    minimumDailyParticipationPoints: 20,
    catchUpGapThreshold: 100,
    dailyCatchUpBonus: 10,
  };

  assert.equal(getMedianPoints(comparisonStudents), 355);
  assert.deepEqual(getParticipationSupportPlan(lowStudent, comparisonStudents, now, options), {
    participationTopUp: 10,
    catchUpBonus: 10,
    classMedianPoints: 355,
    gapAfterBaseReward: 145,
  });

  const supported = applyParticipationSupportToStudent(
    lowStudent,
    comparisonStudents,
    now,
    700,
    options,
  );
  assert.equal(supported.student.points, 230);
  assert.equal(supported.participationTopUp, 10);
  assert.equal(supported.catchUpBonus, 10);
  assert.deepEqual(
    supported.student.pointAdjustmentRecords?.slice(0, 3).map((record) => record.source),
    ['catchUpBonus', 'participationTopUp', 'quick'],
  );
  assert.deepEqual(
    supported.student.pointAdjustmentRecords?.slice(0, 2).map((record) => record.competency),
    ['participation', 'participation'],
  );
  const growth = getWeeklyStudentGrowth([
    { ...supported.student, id: 'low', name: 'Low' },
  ], now);
  assert.equal(growth[0].positiveFeedbackCount, 1);
  assert.equal(growth[0].netPoints, 10);

  const repeated = applyParticipationSupportToStudent(
    supported.student,
    comparisonStudents,
    now + 1000,
    700,
    options,
  );
  assert.equal(repeated.participationTopUp, 0);
  assert.equal(repeated.catchUpBonus, 0);
  assert.equal(repeated.student.points, 230);
});

test('participation support requires positive participation and stays outside teacher caps', () => {
  const now = Date.UTC(2026, 7, 25, 4, 0, 0);
  const student = {
    ...createStudent('low', 'Low'),
    points: 100,
    pointAdjustmentRecords: [
      createPointAdjustmentRecord(-10, 'manual', undefined, now - 1000),
    ],
  };
  const options = {
    timeZone: 'Asia/Taipei',
    minimumDailyParticipationPoints: 20,
    catchUpGapThreshold: 100,
    dailyCatchUpBonus: 10,
  };
  const unsupported = applyParticipationSupportToStudent(
    student,
    [{ points: 100 }, { points: 500 }],
    now,
    700,
    options,
  );
  assert.equal(unsupported.participationTopUp, 0);
  assert.equal(unsupported.catchUpBonus, 0);

  const supportedStudent = {
    ...student,
    pointAdjustmentRecords: [
      createPointAdjustmentRecord(10, 'quick', undefined, now - 500),
      createPointAdjustmentRecord(10, 'participationTopUp', undefined, now - 400),
      createPointAdjustmentRecord(10, 'catchUpBonus', undefined, now - 300),
    ],
  };
  assert.deepEqual(getDailyTeacherPointTotals(supportedStudent, now, 'Asia/Taipei'), {
    positive: 10,
    negative: 0,
  });
});

test('daily tasks can trigger one catch-up bonus without receiving an unnecessary minimum top-up', () => {
  const now = Date.UTC(2026, 7, 25, 4, 0, 0);
  const lowStudent = { ...createStudent('low', 'Low'), points: 0 };
  const claimed = claimDailyTaskForStudent(
    lowStudent,
    now,
    700,
    'Homework Completion Task',
    { timeZone: 'Asia/Taipei', schoolWeekdays: [1, 2, 3, 4, 5] },
  );
  assert.equal(claimed.claimed, true);
  if (!claimed.claimed) throw new Error('Expected daily task claim');

  const supported = applyParticipationSupportToStudent(
    claimed.student,
    [{ points: claimed.student.points }, { points: 500 }],
    now,
    700,
    {
      timeZone: 'Asia/Taipei',
      minimumDailyParticipationPoints: 20,
      catchUpGapThreshold: 100,
      dailyCatchUpBonus: 10,
    },
  );
  assert.equal(supported.participationTopUp, 0);
  assert.equal(supported.catchUpBonus, 10);
  assert.equal(supported.student.points, 40);
});

test('daily point fairness reports ratio reminders, uncovered students, and guardrail outcomes', () => {
  const now = Date.UTC(2026, 7, 25, 4, 0, 0);
  const students = [
    {
      ...createStudent('a', 'Alpha'),
      pointAdjustmentRecords: [
        createPointAdjustmentRecord(10, 'quick', undefined, now - 1000),
        createPointAdjustmentRecord(-5, 'manual', undefined, now - 2000),
      ],
    },
    {
      ...createStudent('b', 'Beta'),
      pointAdjustmentRecords: [
        createPointAdjustmentRecord(0, 'airdrop', undefined, now - 3000, {
          requestedAmount: 10,
          guardrailOutcome: 'blocked',
          guardrailReason: 'dailyPositiveLimit',
        }),
        createPointAdjustmentRecord(10, 'participationTopUp', undefined, now - 2500),
        createPointAdjustmentRecord(10, 'catchUpBonus', undefined, now - 2000),
      ],
    },
    createStudent('c', 'Gamma'),
  ];

  assert.deepEqual(getDailyPointFairnessInsights(students, now, 'Asia/Taipei', 3), {
    positiveCount: 1,
    negativeCount: 1,
    positiveToNegativeRatio: 1,
    targetRatio: 3,
    belowTarget: true,
    clampedCount: 0,
    blockedCount: 1,
    participationTopUpCount: 1,
    catchUpBonusCount: 1,
    supportRewardPoints: 20,
    catchUpCandidates: [],
    uncoveredStudents: [
      { id: 'b', name: 'Beta' },
      { id: 'c', name: 'Gamma' },
    ],
  });
});

test('normalizeAppData sanitizes point guardrail settings and audit metadata', () => {
  const normalized = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [{
        ...createStudent('a', 'Alpha'),
        pointAdjustmentRecords: [{
          id: 'guardrail-1',
          amount: 0,
          createdAt: 1000,
          source: 'quick',
          requestedAmount: 25.9,
          guardrailOutcome: 'blocked',
          guardrailReason: 'dailyPositiveLimit',
        }],
      }],
    }],
    settings: {
      pointGuardrailsEnabled: true,
      dailyPositivePointLimit: -20,
      dailyNegativePointLimit: 20_000,
      positiveFeedbackRatioTarget: 99,
      participationSupportEnabled: true,
      minimumDailyParticipationPoints: -10,
      catchUpGapThreshold: 20_000,
      dailyCatchUpBonus: 2_000,
    },
  }, 2000);

  assert.equal(normalized.settings?.dailyPositivePointLimit, 0);
  assert.equal(normalized.settings?.dailyNegativePointLimit, 10_000);
  assert.equal(normalized.settings?.positiveFeedbackRatioTarget, 10);
  assert.equal(normalized.settings?.minimumDailyParticipationPoints, 0);
  assert.equal(normalized.settings?.catchUpGapThreshold, 10_000);
  assert.equal(normalized.settings?.dailyCatchUpBonus, 1_000);
  assert.deepEqual(
    normalized.classes[0].students[0].pointAdjustmentRecords?.[0],
    {
      id: 'guardrail-1',
      amount: 0,
      createdAt: 1000,
      source: 'quick',
      reasonId: undefined,
      reasonLabel: undefined,
      competency: undefined,
      effectiveDate: undefined,
      claimKind: undefined,
      requestedAmount: 25,
      guardrailOutcome: 'blocked',
      guardrailReason: 'dailyPositiveLimit',
    },
  );
});

test('daily task uses the school timezone instead of resetting at UTC midnight', () => {
  const firstNow = Date.UTC(2026, 7, 24, 16, 30, 0);
  assert.equal(getDateKey(firstNow), '2026-08-24');
  assert.equal(getDateKey(firstNow, 'Asia/Taipei'), '2026-08-25');

  const options = { timeZone: 'Asia/Taipei', schoolWeekdays: [1, 2, 3, 4, 5] };
  const first = claimDailyTaskForStudent(
    createStudent(),
    firstNow,
    700,
    undefined,
    options,
  );
  assert.equal(first.claimed, true);
  assert.equal(first.student.dailyProgress?.lastClaimDate, '2026-08-25');

  const sameSchoolDay = claimDailyTaskForStudent(
    first.student,
    Date.UTC(2026, 7, 25, 10, 0, 0),
    700,
    undefined,
    options,
  );
  assert.equal(sameSchoolDay.claimed, false);
  assert.equal(sameSchoolDay.alreadyClaimed, true);

  const futureDated = getDailyTaskClaimPlan(
    {
      ...createStudent(),
      dailyProgress: { lastClaimDate: '2026-08-26', streak: 2 },
    },
    firstNow,
    options,
  );
  assert.equal(futureDated.targetDate, undefined);
  assert.equal(futureDated.alreadyClaimed, true);
});

test('weekends, school holidays, and approved leave freeze the daily streak', () => {
  const baseOptions = {
    timeZone: 'Asia/Taipei',
    schoolWeekdays: [1, 2, 3, 4, 5],
    makeupWindowDays: 7,
  };
  const friday = claimDailyTaskForStudent(
    createStudent(),
    Date.UTC(2026, 7, 21, 2),
    700,
    undefined,
    baseOptions,
  );
  assert.equal(friday.claimed, true);

  const saturdayPlan = getDailyTaskClaimPlan(
    friday.student,
    Date.UTC(2026, 7, 22, 2),
    baseOptions,
  );
  assert.equal(saturdayPlan.frozen, true);
  assert.equal(saturdayPlan.targetDate, undefined);

  const monday = claimDailyTaskForStudent(
    friday.student,
    Date.UTC(2026, 7, 24, 2),
    700,
    undefined,
    baseOptions,
  );
  assert.equal(monday.claimed, true);
  assert.equal(monday.streak, 2);

  const holidayTuesday = claimDailyTaskForStudent(
    friday.student,
    Date.UTC(2026, 7, 25, 2),
    700,
    undefined,
    { ...baseOptions, holidayDates: ['2026-08-24'] },
  );
  assert.equal(holidayTuesday.claimed, true);
  assert.equal(holidayTuesday.streak, 2);

  const excusedTuesday = claimDailyTaskForStudent(
    monday.student,
    Date.UTC(2026, 7, 26, 2),
    700,
    undefined,
    { ...baseOptions, excusedDates: ['2026-08-25'] },
  );
  assert.equal(excusedTuesday.claimed, true);
  assert.equal(excusedTuesday.effectiveDate, '2026-08-26');
  assert.equal(excusedTuesday.streak, 3);
});

test('make-up claims are ordered, windowed, and auditable', () => {
  const options = {
    timeZone: 'Asia/Taipei',
    schoolWeekdays: [1, 2, 3, 4, 5],
    makeupWindowDays: 7,
  };
  const friday = claimDailyTaskForStudent(
    createStudent(),
    Date.UTC(2026, 7, 21, 2),
    700,
    'Homework Completion Task',
    options,
  );
  assert.equal(friday.claimed, true);

  const makeup = claimDailyTaskForStudent(
    friday.student,
    Date.UTC(2026, 7, 25, 2),
    700,
    'Homework Completion Task',
    options,
  );
  assert.equal(makeup.claimed, true);
  assert.equal(makeup.claimKind, 'makeup');
  assert.equal(makeup.effectiveDate, '2026-08-24');
  assert.equal(makeup.streak, 2);
  assert.equal(makeup.student.pointAdjustmentRecords?.[0].claimKind, 'makeup');
  assert.equal(makeup.student.pointAdjustmentRecords?.[0].effectiveDate, '2026-08-24');
  assert.equal(makeup.student.dailyProgress?.reflections, undefined);

  const secondClaimOnSameSchoolDay = claimDailyTaskForStudent(
    makeup.student,
    Date.UTC(2026, 7, 25, 6),
    700,
    undefined,
    options,
  );
  assert.equal(secondClaimOnSameSchoolDay.claimed, false);
  assert.equal(secondClaimOnSameSchoolDay.alreadyClaimed, true);

  const expiredMakeup = claimDailyTaskForStudent(
    friday.student,
    Date.UTC(2026, 8, 1, 2),
    700,
    undefined,
    options,
  );
  assert.equal(expiredMakeup.claimed, true);
  assert.equal(expiredMakeup.claimKind, 'current');
  assert.equal(expiredMakeup.effectiveDate, '2026-09-01');
  assert.equal(expiredMakeup.streak, 1);
});

test('calendar settings and make-up audit fields are sanitized on import', () => {
  const now = Date.UTC(2026, 7, 25, 2);
  const normalized = normalizeAppData({
    currentClassId: 'class-a',
    settings: {
      schoolTimeZone: 'Invalid/Timezone',
      schoolWeekdays: [4, 1, 4, -1, 8],
      schoolHolidayDates: ['2026-09-28', 'invalid', '2026-09-28'],
      dailyTaskMakeupWindowDays: 99,
    },
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [{
        ...createStudent('a', 'Alpha'),
        dailyProgress: {
          lastClaimDate: 'not-a-date',
          streak: 4,
          excusedDates: ['2026-08-26', 'bad', '2026-08-26'],
        },
        pointAdjustmentRecords: [{
          id: 'makeup-1',
          amount: 35,
          createdAt: now,
          source: 'dailyTask',
          effectiveDate: '2026-08-24',
          claimKind: 'makeup',
        }, {
          id: 'makeup-bad',
          amount: 30,
          createdAt: now - 1,
          source: 'dailyTask',
          effectiveDate: 'bad',
          claimKind: 'unknown',
        }],
      }],
    }],
  }, now);

  assert.equal(normalized.settings?.schoolTimeZone, 'Asia/Taipei');
  assert.deepEqual(normalized.settings?.schoolWeekdays, [1, 4]);
  assert.deepEqual(normalized.settings?.schoolHolidayDates, ['2026-09-28']);
  assert.equal(normalized.settings?.dailyTaskMakeupWindowDays, 30);
  assert.deepEqual(
    normalized.classes[0].students[0].dailyProgress?.excusedDates,
    ['2026-08-26'],
  );
  assert.equal(normalized.classes[0].students[0].dailyProgress?.lastClaimDate, undefined);
  assert.equal(normalized.classes[0].students[0].pointAdjustmentRecords?.[0].claimKind, 'makeup');
  assert.equal(normalized.classes[0].students[0].pointAdjustmentRecords?.[0].effectiveDate, '2026-08-24');
  assert.equal(normalized.classes[0].students[0].pointAdjustmentRecords?.[1].claimKind, undefined);
  assert.equal(normalized.classes[0].students[0].pointAdjustmentRecords?.[1].effectiveDate, undefined);
});

test('legacy calendar settings migrate into independent class calendars', () => {
  const normalized = normalizeAppData({
    currentClassId: 'class-a',
    settings: {
      schoolTimeZone: 'Asia/Tokyo',
      schoolWeekdays: [1, 3, 5],
      schoolHolidayDates: ['2026-09-21'],
      dailyTaskMakeupWindowDays: 4,
    },
    classes: [
      { id: 'class-a', name: 'Class A', students: [] },
      { id: 'class-b', name: 'Class B', students: [] },
    ],
  }, Date.UTC(2026, 8, 1));

  assert.deepEqual(normalized.classes[0].dailyTaskCalendar, {
    schoolTimeZone: 'Asia/Tokyo',
    schoolWeekdays: [1, 3, 5],
    schoolHolidayDates: ['2026-09-21'],
    dailyTaskMakeupWindowDays: 4,
  });
  assert.deepEqual(
    normalized.classes[1].dailyTaskCalendar,
    normalized.classes[0].dailyTaskCalendar,
  );
  assert.notEqual(
    normalized.classes[1].dailyTaskCalendar?.schoolWeekdays,
    normalized.classes[0].dailyTaskCalendar?.schoolWeekdays,
  );
});

test('class calendar updates and daily claims stay scoped to the selected class', () => {
  const originalDateNow = Date.now;
  const now = Date.UTC(2026, 8, 6, 2);
  Date.now = () => now;

  try {
    const data = normalizeAppData({
      currentClassId: 'class-a',
      classes: [
        {
          id: 'class-a',
          name: 'Monday Class',
          students: [createStudent('a', 'Alpha')],
          dailyTaskCalendar: {
            schoolTimeZone: 'Asia/Taipei',
            schoolWeekdays: [1],
            schoolHolidayDates: [],
            dailyTaskMakeupWindowDays: 0,
          },
        },
        {
          id: 'class-b',
          name: 'Sunday Class',
          students: [createStudent('b', 'Beta')],
          dailyTaskCalendar: {
            schoolTimeZone: 'Asia/Taipei',
            schoolWeekdays: [0],
            schoolHolidayDates: [],
            dailyTaskMakeupWindowDays: 2,
          },
        },
      ],
    }, now);
    useStore.setState({ data, toast: null, undoAction: null });

    useStore.getState().updateClassDailyTaskCalendar('class-a', {
      schoolTimeZone: 'Asia/Taipei',
      schoolWeekdays: [2, 4],
      schoolHolidayDates: ['2026-09-08', 'invalid'],
      dailyTaskMakeupWindowDays: 99,
    });

    let classes = useStore.getState().data.classes;
    assert.deepEqual(classes[0].dailyTaskCalendar, {
      schoolTimeZone: 'Asia/Taipei',
      schoolWeekdays: [2, 4],
      schoolHolidayDates: ['2026-09-08'],
      dailyTaskMakeupWindowDays: 30,
    });
    assert.deepEqual(classes[1].dailyTaskCalendar?.schoolWeekdays, [0]);
    assert.equal(useStore.getState().claimDailyTask('a'), false);

    useStore.getState().switchClass('class-b');
    assert.equal(useStore.getState().claimDailyTask('b'), true);
    classes = useStore.getState().data.classes;
    assert.equal(classes[1].students[0].dailyProgress?.lastClaimDate, '2026-09-06');
  } finally {
    Date.now = originalDateNow;
    resetStoreForSession(now + 1);
  }
});

test('mentor daily feedback creates and then updates one record for the same day', () => {
  const now = Date.UTC(2026, 6, 28, 2, 0, 0);
  const first = saveMentorDailyFeedbackForStudent(
    createStudent('a', 'Alpha'),
    {
      competency: 'growth',
      assessment: 'needsSupport',
      text: 'Can explain the first step but needs help checking the answer.',
    },
    now,
  );

  assert.equal(first.saved, true);
  assert.equal(first.updated, false);
  assert.equal(first.student.points, 200);
  assert.equal(first.student.dailyProgress?.lastClaimDate, undefined);
  assert.equal(first.student.dailyProgress?.streak, 0);
  assert.deepEqual(first.student.dailyProgress?.reflections?.[0], {
    id: first.student.dailyProgress?.reflections?.[0].id,
    date: '2026-07-28',
    createdAt: now,
    competency: 'growth',
    author: 'mentor',
    mentorAssessment: 'needsSupport',
    text: 'Can explain the first step but needs help checking the answer.',
  });

  const updatedAt = now + 1000 * 60 * 60;
  const second = saveMentorDailyFeedbackForStudent(
    first.student,
    {
      competency: 'collaboration',
      assessment: 'confident',
      text: 'Completed the peer review independently.',
    },
    updatedAt,
  );
  assert.equal(second.saved, true);
  assert.equal(second.updated, true);
  assert.equal(second.student.points, 200);
  assert.equal(second.student.dailyProgress?.lastClaimDate, undefined);
  assert.equal(second.student.dailyProgress?.streak, 0);
  assert.equal(second.student.dailyProgress?.reflections?.length, 1);
  assert.equal(
    second.student.dailyProgress?.reflections?.[0].id,
    first.student.dailyProgress?.reflections?.[0].id,
  );
  assert.deepEqual(second.student.dailyProgress?.reflections?.[0], {
    id: first.student.dailyProgress?.reflections?.[0].id,
    date: '2026-07-28',
    createdAt: updatedAt,
    competency: 'collaboration',
    author: 'mentor',
    mentorAssessment: 'confident',
    text: 'Completed the peer review independently.',
  });

  const insights = getWeeklyEducationInsights([first.student], now);
  assert.equal(insights.reflectionCount, 1);
  assert.deepEqual(insights.needsSupportReflectionStudents, [{
    id: 'a',
    name: 'Alpha',
    competency: 'growth',
    text: 'Can explain the first step but needs help checking the answer.',
  }]);
});

test('mentor daily feedback follows the configured school timezone', () => {
  const utcSundayEvening = Date.UTC(2026, 7, 23, 16, 30);
  const result = saveMentorDailyFeedbackForStudent(
    createStudent('a', 'Alpha'),
    {
      competency: 'participation',
      assessment: 'progressing',
      text: 'Joined the opening discussion.',
    },
    utcSundayEvening,
    'Asia/Taipei',
  );

  const reflections = (
    result.student.dailyProgress as { reflections?: Array<{ date: string }> }
  ).reflections;
  assert.equal(reflections?.[0].date, '2026-08-24');
});

test('resolveTeamBattle updates all active team members', () => {
  const result = resolveTeamBattle(
    [
      { id: 'a1', student: createStudent() },
      {
        id: 'a2',
        student: {
          ...createStudent(),
          pet: { ...createStudent().pet, level: 4, fullness: 90 },
        },
      },
    ],
    [
      { id: 'd1', student: createStudent() },
      {
        id: 'd2',
        student: {
          ...createStudent(),
          pet: { ...createStudent().pet, level: 2, fullness: 60 },
        },
      },
    ],
    {
      attackers: [10, 12],
      defenders: [0, 1],
    },
    undefined,
    1000,
  );

  assert.equal(result.blocked, null);
  assert.equal(result.outcome, 'win');
  assert.deepEqual(result.teamReward, {
    winnerIds: ['a1', 'a2'],
    bonusPoints: 10,
    bonusHappiness: 6,
  });
  assert.equal(result.updated.a1.points, 240);
  assert.equal(result.updated.a1.pet.happiness, 60);
  assert.equal(result.updated.a2.stats?.wins, 1);
  assert.equal(result.updated.d1.points, 185);
  assert.equal(result.updated.d2.rankPoints, 94);
});

test('resolveTeamBattle applies configurable fullness costs by participant role', () => {
  const result = resolveTeamBattle(
    [
      { id: 'a1', student: createStudent() },
      { id: 'a2', student: createStudent() },
    ],
    [
      { id: 'd1', student: createStudent() },
      { id: 'd2', student: createStudent() },
    ],
    {
      attackers: [20, 20],
      defenders: [0, 0],
    },
    {
      teamBattleAttackerFullnessCost: 11,
      teamBattleAttackerTeammateFullnessCost: 5,
      teamBattleDefenderFullnessCost: 13,
      teamBattleDefenderTeammateFullnessCost: 7,
    },
    1000,
  );

  assert.equal(result.blocked, null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.updated.a1.pet.fullness, 69);
  assert.equal(result.updated.a2.pet.fullness, 75);
  assert.equal(result.updated.d1.pet.fullness, 67);
  assert.equal(result.updated.d2.pet.fullness, 73);
});

test('resolveTeamBattle can disable the minimum fullness gate', () => {
  const lowFullnessLeader = {
    ...createStudent(),
    pet: {
      ...createStudent().pet,
      fullness: 25,
    },
  };
  const lowFullnessSupport = {
    ...createStudent(),
    pet: {
      ...createStudent().pet,
      fullness: 20,
    },
  };

  const blocked = resolveTeamBattle(
    [
      { id: 'a1', student: lowFullnessLeader },
      { id: 'a2', student: lowFullnessSupport },
    ],
    [
      { id: 'd1', student: createStudent() },
      { id: 'd2', student: createStudent() },
    ],
    {
      attackers: [5, 5],
      defenders: [1, 1],
    },
    {
      teamBattleMinFullnessEnabled: true,
      teamBattleMinFullness: 50,
    },
    1000,
  );

  assert.equal(blocked.blocked, 'fullness');

  const allowed = resolveTeamBattle(
    [
      { id: 'a1', student: lowFullnessLeader },
      { id: 'a2', student: lowFullnessSupport },
    ],
    [
      { id: 'd1', student: createStudent() },
      { id: 'd2', student: createStudent() },
    ],
    {
      attackers: [8, 8],
      defenders: [0, 0],
    },
    {
      teamBattleMinFullnessEnabled: false,
      teamBattleMinFullness: 50,
    },
    1000,
  );

  assert.equal(allowed.blocked, null);
  assert.ok(allowed.outcome === 'win' || allowed.outcome === 'loss' || allowed.outcome === 'draw');
});

test('attackWorldBoss blocks students with active penalty status', () => {
  const result = attackWorldBoss(
    {
      ...createStudent(),
      penaltyStatus: createPenaltyStatus('discipline', 1000),
    },
    createBoss(),
    2000,
  );

  assert.equal(result.blocked, 'penalty');
});

test('attackWorldBoss records actual damage as student contribution', () => {
  const result = attackWorldBoss(
    createStudent('attacker', 'Attacker'),
    { ...createBoss(), currentHp: 5 },
    2000,
  );

  assert.equal(result.blocked, null);
  assert.equal(result.damageDealt, 5);
  assert.equal(result.updatedBoss?.contributions.attacker, 5);
  assert.equal(result.updatedBoss?.attackCounts?.attacker, 1);
  assert.equal(result.isDefeated, true);
});

test('resolveBossAttack randomly targets up to four living pets and applies configured damage', () => {
  const students = Array.from({ length: 5 }, (_, index) => ({
    id: `student-${index + 1}`,
    student: createStudent(`student-${index + 1}`, `Student ${index + 1}`),
  }));
  const rolls = [0.75, 0, 0, 0, 0];
  const result = resolveBossAttack(students, 4, 20, () => rolls.shift() ?? 0, 2000);

  assert.equal(result.targetIds.length, 3);
  assert.equal(Object.values(result.updated).filter((student) => student.pet.fullness === 60).length, 3);
  assert.equal(Object.values(result.updated).filter((student) => student.pet.fullness === 80).length, 2);
});

test('resolveSharedBossAttack spreads total damage across every living pet', () => {
  const students = [
    { id: 'a', student: createStudent('a', 'Alpha') },
    { id: 'b', student: createStudent('b', 'Beta') },
    {
      id: 'c',
      student: {
        ...createStudent('c', 'Gamma'),
        pet: { ...createStudent().pet, fullness: 0, isDead: true },
      },
    },
  ];
  const result = resolveSharedBossAttack(students, 21, 2000);

  assert.deepEqual(result.targetIds, ['a', 'b']);
  assert.equal(result.damage, 11);
  assert.equal(result.updated.a.pet.fullness, 69);
  assert.equal(result.updated.b.pet.fullness, 69);
  assert.equal(result.updated.c.pet.fullness, 0);
});

test('recoverable boss attack creates a temporary class state without reducing student resources', () => {
  const students = [
    { id: 'a', student: createStudent('a', 'Alpha') },
    { id: 'b', student: createStudent('b', 'Beta') },
    {
      id: 'c',
      student: {
        ...createStudent('c', 'Gamma'),
        pet: { ...createStudent().pet, fullness: 0, isDead: true },
      },
    },
  ];
  const result = resolveRecoverableBossAttack(students, 20, 15, 2_000);

  assert.deepEqual(result.targetIds, ['a', 'b']);
  assert.equal(result.damage, 10);
  assert.equal(result.recoverAt, 902_000);
  assert.equal(result.updated.a.points, 200);
  assert.equal(result.updated.a.rankPoints, 100);
  assert.equal(result.updated.a.pet.fullness, 80);
  assert.equal(result.updated.a.pet.happiness, 50);
  assert.deepEqual(result.updated.a.bossRecovery, {
    impact: 10,
    startedAt: 2_000,
    recoverAt: 902_000,
  });
  assert.equal(result.updated.c.bossRecovery, undefined);
  assert.equal(isBossRecoveryActive(result.updated.a.bossRecovery, 901_999), true);
  assert.equal(isBossRecoveryActive(result.updated.a.bossRecovery, 902_000), false);
});

test('store recoverable boss attack can be cleared by a class regroup action', () => {
  useStore.getState().importData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [createStudent('a', 'Alpha'), createStudent('b', 'Beta')],
      activeBoss: createBoss(),
    }],
    settings: {
      inclusiveMode: true,
      bossAttackMode: 'random',
      bossAttackDamage: 20,
      bossRecoveryMinutes: 10,
    },
  }, 2_000);

  useStore.getState().executeBossAttack();
  let students = useStore.getState().data.classes[0].students;
  assert.equal(useStore.getState().data.settings?.bossAttackMode, 'recoverable');
  assert.equal(students.every((student) => student.points === 200), true);
  assert.equal(students.every((student) => student.pet.fullness === 80), true);
  assert.equal(students.every((student) => student.bossRecovery?.impact === 10), true);
  assert.equal(useStore.getState().bossAttackFeedback?.mode, 'recoverable');

  useStore.getState().clearBossRecovery();
  students = useStore.getState().data.classes[0].students;
  assert.equal(students.every((student) => student.bossRecovery == null), true);
});

test('createAutomatedBossRewardTier derives a new rank and never creates negative rewards', () => {
  const tiers = [
    { rank: 1, points: 100, happiness: 30, rankPoints: 30 },
    { rank: 2, points: 70, happiness: 20, rankPoints: 20 },
    { rank: 3, points: 50, happiness: 10, rankPoints: 10 },
  ];
  const step = { points: 20, happiness: 5, rankPoints: 5 };

  assert.deepEqual(createAutomatedBossRewardTier(tiers, 4, step), {
    rank: 4,
    points: 30,
    happiness: 5,
    rankPoints: 5,
  });
  assert.deepEqual(createAutomatedBossRewardTier(tiers, 7, step), {
    rank: 7,
    points: 0,
    happiness: 0,
    rankPoints: 0,
  });
});

test('recalculateBossRewardTiers applies one rank formula from the highest reward rank', () => {
  const result = recalculateBossRewardTiers([
    { rank: 4, points: 1, happiness: 1, rankPoints: 1 },
    { rank: 1, points: 100, happiness: 30, rankPoints: 30 },
    { rank: 2, points: 1, happiness: 1, rankPoints: 1 },
  ], {
    points: 20,
    happiness: 5,
    rankPoints: 5,
  });

  assert.deepEqual(result, [
    { rank: 1, points: 100, happiness: 30, rankPoints: 30 },
    { rank: 2, points: 80, happiness: 25, rankPoints: 25 },
    { rank: 4, points: 40, happiness: 15, rankPoints: 15 },
  ]);
});

test('applyBossContributionRewards ranks fair performance and applies each configured reward tier', () => {
  const students = [
    createStudent('a', 'Alpha'),
    createStudent('b', 'Beta'),
    createStudent('c', 'Gamma'),
  ];
  const boss = {
    ...createBoss(),
    contributions: { a: 40, b: 90, c: 20 },
  };
  const result = applyBossContributionRewards(students, boss, 2000, 700);

  assert.deepEqual(
    result.standings.map(({ studentId, rank, rewardPoints, rewardRankPoints, rewardHappiness }) => ({
      studentId,
      rank,
      rewardPoints,
      rewardRankPoints,
      rewardHappiness,
    })),
    [
      { studentId: 'a', rank: 1, rewardPoints: 60, rewardRankPoints: 30, rewardHappiness: 15 },
      { studentId: 'b', rank: 2, rewardPoints: 40, rewardRankPoints: 15, rewardHappiness: 10 },
      { studentId: 'c', rank: 3, rewardPoints: 10, rewardRankPoints: 5, rewardHappiness: 5 },
    ],
  );
  assert.equal(result.students.find((student) => student.id === 'b')?.points, 240);
  assert.equal(result.students.find((student) => student.id === 'a')?.points, 260);
  assert.equal(result.students.find((student) => student.id === 'c')?.points, 210);
  assert.equal(result.students.find((student) => student.id === 'a')?.economyEventRecords?.[0].source, 'bossReward');
  assert.equal(result.students.find((student) => student.id === 'a')?.economyEventRecords?.[0].referenceId, 'boss-reward-boss-1-a');
  assert.equal(
    getTeacherEconomyInsights(result.students as any, 700, 2000, 30).totalIssued,
    110,
  );
  assert.equal(result.students.find((student) => student.id === 'b')?.rankPoints, 115);
  assert.equal(result.students.find((student) => student.id === 'a')?.rankPoints, 130);
  assert.equal(result.students.find((student) => student.id === 'c')?.rankPoints, 105);
  assert.equal(result.students.find((student) => student.id === 'b')?.lastBossDamage, 90);
  assert.deepEqual(result.students.find((student) => student.id === 'b')?.bossRewardRecords[0], {
    id: 'boss-reward-boss-1-b',
    bossId: 'boss-1',
    bossName: 'Training Boss',
    createdAt: 2000,
    rank: 2,
    damage: 90,
    attackCount: 3,
    fairScore: 100,
    previousDamage: 0,
    previousFairScore: 0,
    improvementAmount: 0,
    fairImprovementAmount: 0,
    rewardPoints: 40,
    rewardRankPoints: 15,
    rewardHappiness: 10,
    rankRewardPoints: 30,
    rankRewardRankPoints: 10,
    rankRewardHappiness: 5,
    participationRewardPoints: 10,
    participationRewardRankPoints: 5,
    participationRewardHappiness: 5,
    improvementRewardPoints: 0,
    improvementRewardRankPoints: 0,
    improvementRewardHappiness: 0,
    receivedImprovementReward: false,
  });
});

test('applyBossContributionRewards adds improvement rewards only after a better result', () => {
  const students = [
    { ...createStudent('a', 'Alpha'), lastBossDamage: 40 },
    { ...createStudent('b', 'Beta'), lastBossDamage: 90 },
  ];
  const boss = {
    ...createBoss(),
    participationReward: { points: 5, happiness: 2, rankPoints: 3 },
    improvementReward: { points: 12, happiness: 4, rankPoints: 7 },
    contributions: { a: 60, b: 80 },
  };
  const result = applyBossContributionRewards(students, boss, 2000, 700);
  const alpha = result.standings.find((standing) => standing.studentId === 'a');
  const beta = result.standings.find((standing) => standing.studentId === 'b');

  assert.equal(alpha?.receivedImprovementReward, true);
  assert.equal(alpha?.previousDamage, 40);
  assert.equal(alpha?.improvementAmount, 20);
  assert.equal(alpha?.improvementRewardPoints, 12);
  assert.equal(alpha?.improvementRewardRankPoints, 7);
  assert.equal(beta?.receivedImprovementReward, false);
  assert.equal(beta?.improvementAmount, 0);
  assert.equal(beta?.improvementRewardPoints, 0);
  assert.equal(beta?.improvementRewardRankPoints, 0);
  assert.equal(result.students.find((student) => student.id === 'a')?.rankPoints, 120);
  assert.equal(result.students.find((student) => student.id === 'b')?.rankPoints, 128);
  assert.deepEqual(
    result.students.find((student) => student.id === 'a')?.bossRewardRecords[0],
    {
      id: 'boss-reward-boss-1-a',
      bossId: 'boss-1',
      bossName: 'Training Boss',
      createdAt: 2000,
      rank: 2,
      damage: 60,
      attackCount: 2,
      fairScore: 100,
      previousDamage: 40,
      previousFairScore: 0,
      improvementAmount: 20,
      fairImprovementAmount: 20,
      rewardPoints: 47,
      rewardRankPoints: 20,
      rewardHappiness: 11,
      rankRewardPoints: 30,
      rankRewardRankPoints: 10,
      rankRewardHappiness: 5,
      participationRewardPoints: 5,
      participationRewardRankPoints: 3,
      participationRewardHappiness: 2,
      improvementRewardPoints: 12,
      improvementRewardRankPoints: 7,
      improvementRewardHappiness: 4,
      receivedImprovementReward: true,
    },
  );
});

test('boss fair ranking caps repeated attacks and normalizes pet level advantage', () => {
  const students = [
    {
      ...createStudent('low', 'Lower Level'),
      pet: { ...createStudent().pet, level: 1 },
    },
    {
      ...createStudent('high', 'Higher Level'),
      pet: { ...createStudent().pet, level: 5 },
    },
    {
      ...createStudent('spam', 'Repeated Attacks'),
      pet: { ...createStudent().pet, level: 5 },
    },
  ];
  const standings = getBossContributionStandings(students, {
    ...createBoss(),
    contributions: { low: 46, high: 150, spam: 300 },
    attackCounts: { low: 3, high: 3, spam: 6 },
  });

  assert.deepEqual(
    standings.map(({ studentId, damage, attackCount, fairScore }) => ({
      studentId,
      damage,
      attackCount,
      fairScore,
    })),
    [
      { studentId: 'low', damage: 46, attackCount: 3, fairScore: 114 },
      { studentId: 'high', damage: 150, attackCount: 3, fairScore: 105 },
      { studentId: 'spam', damage: 300, attackCount: 6, fairScore: 105 },
    ],
  );
  assert.deepEqual(
    standings.map(({ studentId, rank, rankRewardPoints }) => ({
      studentId,
      rank,
      rankRewardPoints,
    })),
    [
      { studentId: 'low', rank: 1, rankRewardPoints: 50 },
      { studentId: 'high', rank: 2, rankRewardPoints: 30 },
      { studentId: 'spam', rank: 2, rankRewardPoints: 30 },
    ],
  );
});

test('applyBossContributionRewards keeps prior boss reward history newest first', () => {
  const first = applyBossContributionRewards(
    [createStudent('a', 'Alpha')],
    { ...createBoss(), contributions: { a: 40 } },
    2000,
    700,
  );
  const second = applyBossContributionRewards(
    first.students,
    { ...createBoss(), id: 'boss-2', name: 'Second Boss', contributions: { a: 50 } },
    3000,
    700,
  );

  assert.deepEqual(
    second.students[0].bossRewardRecords.map(({ bossId, bossName, createdAt }) => ({
      bossId,
      bossName,
      createdAt,
    })),
    [
      { bossId: 'boss-2', bossName: 'Second Boss', createdAt: 3000 },
      { bossId: 'boss-1', bossName: 'Training Boss', createdAt: 2000 },
    ],
  );
});

test('boss victory commits rewards before asynchronous backend verification can be interrupted', () => {
  useStore.getState().importData(
    {
      lastOpened: 2000,
      currentClassId: 'class-a',
      classes: [{
        id: 'class-a',
        name: 'Class A',
        students: [createStudent('a', 'Alpha')],
        activeBoss: {
          ...createBoss(),
          id: 'boss-atomic',
          currentHp: 1,
        },
      }],
    },
    2000,
  );

  void useStore.getState().executeAttackBoss('a');

  const currentClass = useStore.getState().data.classes[0];
  const rewardRecord = currentClass.students[0].bossRewardRecords?.[0];
  assert.equal(currentClass.activeBoss, undefined);
  assert.equal(rewardRecord?.bossId, 'boss-atomic');
  assert.equal(
    rewardRecord?.rewardPoints,
    (rewardRecord?.rankRewardPoints ?? 0) +
      (rewardRecord?.participationRewardPoints ?? 0) +
      (rewardRecord?.improvementRewardPoints ?? 0),
  );
});

test('competency-tagged feedback drives class goals and weekly education insights', () => {
  const now = Date.UTC(2026, 6, 24);
  const collaboration = createPointAdjustmentRecord(
    20,
    'quick',
    { id: 'helpful', label: 'Helping the Class +20', competency: 'collaboration' },
    now - 1000,
  );
  const correction = createPointAdjustmentRecord(
    -10,
    'quick',
    { id: 'late', label: 'Late -10', competency: 'selfManagement' },
    now - 2000,
  );
  const students = [
    { ...createStudent('a', 'Alpha'), pointAdjustmentRecords: [collaboration] },
    { ...createStudent('b', 'Beta'), pointAdjustmentRecords: [correction] },
    createStudent('c', 'Gamma'),
  ];
  const goal = {
    id: 'goal-1',
    title: 'Collaborate',
    competency: 'collaboration' as const,
    targetCount: 5,
    createdAt: now - 5000,
  };

  assert.equal(getClassGoalProgress(students, goal), 1);
  assert.equal(getClassGoalProgress(students, goal, []), 1);
  assert.deepEqual(getClassGoalCoverage(students, goal), {
    studentsReached: 1,
    totalStudents: 3,
    rate: 1 / 3,
  });

  const insights = getWeeklyEducationInsights(students, now);
  assert.equal(insights.positiveCount, 1);
  assert.equal(insights.negativeCount, 1);
  assert.equal(insights.competencyCounts.collaboration, 1);
  assert.equal(insights.collaborationStudents, 1);
  assert.equal(insights.feedbackStudents, 2);
  assert.equal(insights.feedbackCoverageRate, 2 / 3);
  assert.deepEqual(insights.overlookedStudents, [{ id: 'c', name: 'Gamma' }]);
  assert.deepEqual(insights.needsPositiveFeedbackStudents, [{ id: 'b', name: 'Beta' }]);
  assert.equal(insights.positiveFeedbackTrend, 1);
  assert.equal(insights.feedbackCoverageTrend, 2);

  const growth = getWeeklyStudentGrowth(students, now);
  assert.deepEqual(
    growth.map(({ studentId, positiveFeedbackCount, competencyCount, netPoints }) => ({
      studentId,
      positiveFeedbackCount,
      competencyCount,
      netPoints,
    })),
    [
      { studentId: 'a', positiveFeedbackCount: 1, competencyCount: 1, netPoints: 20 },
      { studentId: 'c', positiveFeedbackCount: 0, competencyCount: 0, netPoints: 0 },
      { studentId: 'b', positiveFeedbackCount: 0, competencyCount: 0, netPoints: -10 },
    ],
  );
});

test('weekly feedback report uses school-calendar weeks and combines feedback without using totals', () => {
  const currentMonday = Date.UTC(2026, 7, 23, 16, 30);
  const currentTuesday = Date.UTC(2026, 7, 25, 2, 0);
  const previousMonday = Date.UTC(2026, 7, 17, 2, 0);
  const students = [
    {
      ...createStudent('a', 'Alpha'),
      points: 699,
      pointAdjustmentRecords: [
        createPointAdjustmentRecord(
          20,
          'quick',
          { id: 'helpful', label: 'Helping classmates', competency: 'collaboration' },
          currentMonday,
        ),
        createPointAdjustmentRecord(
          10,
          'manual',
          { id: 'prior-help', label: 'Prior collaboration', competency: 'collaboration' },
          previousMonday,
        ),
        createPointAdjustmentRecord(
          30,
          'dailyTask',
          { id: 'daily-homework', label: 'Daily task', competency: 'assignmentQuality' },
          currentTuesday,
        ),
      ],
      dailyProgress: {
        streak: 1,
        reflections: [{
          id: 'student-reflection',
          date: '2026-08-25',
          createdAt: currentTuesday,
          competency: 'growth' as const,
          author: 'student' as const,
          selfAssessment: 'progressing' as const,
          text: 'I will check my work.',
        }],
      },
    },
    {
      ...createStudent('b', 'Beta'),
      points: 1,
      pointAdjustmentRecords: [
        createPointAdjustmentRecord(
          -10,
          'quick',
          { id: 'late', label: 'Needs a planning check-in', competency: 'selfManagement' },
          currentTuesday,
        ),
      ],
      dailyProgress: {
        streak: 0,
        reflections: [{
          id: 'mentor-feedback',
          date: '2026-08-25',
          createdAt: currentTuesday + 100,
          competency: 'growth' as const,
          author: 'mentor' as const,
          mentorAssessment: 'needsSupport' as const,
          text: 'Needs help checking the next step.',
        }],
      },
    },
    { ...createStudent('c', 'Gamma'), points: 350 },
  ];
  const evidence = [
    createLearningEvidenceRecord(
      'class-a',
      'b',
      {
        competency: 'growth',
        level: 'needsSupport',
        evidenceType: 'reflection',
        title: 'Needs help checking the next step',
        source: 'mentorDailyFeedback',
        sourceId: 'mentor-feedback',
      },
      currentTuesday + 100,
      'evidence-mentor-feedback',
    ),
  ];

  const report = getWeeklyFeedbackReport(
    students,
    '2026-08-26',
    'Asia/Taipei',
    evidence,
  );

  assert.equal(report.weekStartDate, '2026-08-24');
  assert.equal(report.weekEndDate, '2026-08-30');
  assert.equal(report.previousWeekStartDate, '2026-08-17');
  assert.equal(report.previousWeekEndDate, '2026-08-23');
  assert.equal(report.rosterStudents, 3);
  assert.equal(report.positiveCount, 1);
  assert.equal(report.negativeCount, 2);
  assert.equal(report.positiveRatio, 1 / 3);
  assert.equal(report.feedbackStudents, 2);
  assert.equal(report.feedbackCoverageRate, 2 / 3);
  assert.equal(report.collaborationStudents, 1);
  assert.equal(report.mentorFeedbackCount, 1);
  assert.equal(report.studentSelfAssessmentCount, 1);
  assert.equal(report.sourceCounts.pointFeedback, 2);
  assert.equal(report.sourceCounts.learningEvidence, 1);
  assert.equal(report.competencyCounts.assignmentQuality, 0);
  assert.deepEqual(report.overlookedStudents, [{ id: 'c', name: 'Gamma' }]);
  assert.deepEqual(report.needsPositiveFeedbackStudents, [{ id: 'b', name: 'Beta' }]);
  assert.deepEqual(report.needsSupportMentorFeedbackStudents, [{
    id: 'b',
    name: 'Beta',
    competency: 'growth',
    text: 'Needs help checking the next step.',
  }]);
  assert.equal(report.positiveFeedbackTrend, 0);
  assert.equal(report.negativeFeedbackTrend, 2);
  assert.equal(report.feedbackCoverageTrend, 1);
  assert.equal(report.collaborationTrend, 0);
});

test('weekly feedback CSV is UTF-8, structured, and neutralizes spreadsheet formulas', () => {
  const report = getWeeklyFeedbackReport(
    [{ ...createStudent('unsafe', '=HYPERLINK("bad")') }],
    '2026-08-24',
    'Asia/Taipei',
  );
  const csv = createWeeklyFeedbackReportCsv(
    {
      ...report,
      reasonCounts: [{ id: 'unsafe', label: '+SUM(1,1)', count: 1 }],
    },
    'en',
    {
      participation: 'Participation',
      collaboration: 'Collaboration',
      selfManagement: 'Self-management',
      assignmentQuality: 'Assignment Quality',
      growth: 'Growth',
    },
  );

  assert.equal(csv.startsWith('\uFEFF"Section","Item","Value"\r\n'), true);
  assert.equal(csv.includes('"\'+SUM(1,1)"'), true);
  assert.equal(csv.includes('"\'=HYPERLINK(""bad"")"'), true);
  assert.equal(csv.endsWith('\r\n'), true);
});

test('weekly class goals follow the school timezone and keep prior weeks inactive', () => {
  const mondayInTaipei = Date.UTC(2026, 7, 23, 16, 30, 0);
  assert.equal(getWeekStartDate(mondayInTaipei, 'Asia/Taipei'), '2026-08-24');
  assert.equal(getWeekEndDate(mondayInTaipei, 'Asia/Taipei'), '2026-08-30');

  const goals = [
    {
      id: 'current',
      title: 'Current week',
      competency: 'participation' as const,
      targetCount: 3,
      createdAt: mondayInTaipei,
      weekStartDate: '2026-08-24',
    },
    {
      id: 'prior',
      title: 'Prior week',
      competency: 'growth' as const,
      targetCount: 3,
      createdAt: mondayInTaipei - 7 * 24 * 60 * 60 * 1000,
      weekStartDate: '2026-08-17',
    },
  ];
  assert.deepEqual(
    getActiveClassGoals(goals, mondayInTaipei, 'Asia/Taipei').map((goal) => goal.id),
    ['current'],
  );
});

test('students receive the next unstarted goal before goals already in progress', () => {
  const now = Date.UTC(2026, 6, 24);
  const student = {
    ...createStudent('a', 'Alpha'),
    pointAdjustmentRecords: [
      createPointAdjustmentRecord(
        10,
        'quick',
        { competency: 'participation' },
        now,
      ),
    ],
  };
  const goals = [
    {
      id: 'goal-1',
      title: 'Participate',
      competency: 'participation' as const,
      targetCount: 10,
      createdAt: now - 1000,
    },
    {
      id: 'goal-2',
      title: 'Show growth',
      competency: 'growth' as const,
      targetCount: 10,
      createdAt: now - 1000,
    },
  ];

  assert.equal(getNextStudentGoal(student, goals)?.goal.id, 'goal-2');
});

test('next student goal skips completed goals and chooses the fewest remaining steps', () => {
  const now = Date.UTC(2026, 6, 24);
  const reward = (competency: 'participation' | 'collaboration' | 'growth', offset: number) =>
    createPointAdjustmentRecord(10, 'quick', { competency }, now + offset);
  const student = {
    ...createStudent('a', 'Alpha'),
    pointAdjustmentRecords: [
      reward('participation', 1),
      reward('participation', 2),
      reward('growth', 3),
      reward('collaboration', 4),
    ],
  };
  const goals = [
    {
      id: 'completed',
      title: 'Participate twice',
      competency: 'participation' as const,
      targetCount: 2,
      createdAt: now,
    },
    {
      id: 'two-left',
      title: 'Grow three times',
      competency: 'growth' as const,
      targetCount: 3,
      createdAt: now,
    },
    {
      id: 'one-left',
      title: 'Collaborate twice',
      competency: 'collaboration' as const,
      targetCount: 2,
      createdAt: now,
    },
  ];

  assert.equal(getNextStudentGoal(student, goals)?.goal.id, 'one-left');
  assert.equal(getNextStudentGoal(student, [goals[0]]), undefined);
});

test('public student names can be masked without changing mentor records', () => {
  assert.equal(getPublicStudentName('王小明', 'masked'), '王**');
  assert.equal(getPublicStudentName('Amy Lin', 'masked'), 'A** L**');
  assert.equal(getPublicStudentName('王小明', 'full'), '王小明');
});

test('point feedback history remains long enough for multi-week education goals', () => {
  let student = createStudent('a', 'Alpha');

  for (let index = 0; index < 25; index += 1) {
    const record = createPointAdjustmentRecord(
      1,
      'quick',
      { competency: 'participation' },
      1000 + index,
    );
    student = applyPointAdjustmentToStudent(student, 1, record, 700);
  }

  assert.equal(student.pointAdjustmentRecords.length, 25);
});

test('normalizeAppData sanitizes active boss data and drops defeated bosses', () => {
  const normalized = normalizeAppData(
    {
      lastOpened: 1000,
      currentClassId: 'class-a',
      settings: {
        battleEnabled: false,
        soloBattleFullnessCost: '17',
        teamBattleAttackerFullnessCost: '11',
        teamBattleAttackerTeammateFullnessCost: '5',
        teamBattleDefenderFullnessCost: '13',
        teamBattleDefenderTeammateFullnessCost: '-2',
      },
      classes: [
        {
          id: 'class-a',
          name: 'Class A',
          students: [],
          activeBoss: {
            id: 'boss-a',
            name: '  Dragon  ',
            maxHp: '50.8',
            currentHp: '80',
            rewardPoints: '-10',
            rewardHappiness: '12.4',
            isActive: true,
          },
        },
        {
          id: 'class-b',
          name: 'Class B',
          students: [],
          activeBoss: {
            id: 'boss-b',
            name: 'Defeated',
            maxHp: 100,
            currentHp: 0,
            rewardPoints: 20,
            rewardHappiness: 5,
            isActive: true,
          },
        },
      ],
    },
    2000,
  );

  assert.deepEqual(normalized.classes[0].activeBoss, {
    id: 'boss-a',
    name: 'Dragon',
    maxHp: 50,
    currentHp: 50,
    rewardTiers: [{ rank: 1, points: 0, happiness: 12, rankPoints: 30 }],
    participationReward: { points: 10, happiness: 5, rankPoints: 5 },
    improvementReward: { points: 15, happiness: 5, rankPoints: 5 },
    contributions: {},
    attackCounts: {},
    isActive: true,
  });
  assert.equal(normalized.classes[1].activeBoss, undefined);
  assert.equal(normalized.settings?.soloBattleFullnessCost, 17);
  assert.equal(normalized.settings?.soloBattleAttackerFullnessCost, 17);
  assert.equal(normalized.settings?.soloBattleDefenderFullnessCost, 17);
  assert.equal(normalized.settings?.teamBattleAttackerFullnessCost, 11);
  assert.equal(normalized.settings?.teamBattleAttackerTeammateFullnessCost, 5);
  assert.equal(normalized.settings?.teamBattleDefenderFullnessCost, 13);
  assert.equal(normalized.settings?.teamBattleDefenderTeammateFullnessCost, 0);
  assert.equal(normalized.settings?.bossAttackMode, 'recoverable');
  assert.equal(normalized.settings?.bossRecoveryMinutes, 15);
  assert.equal(normalized.settings?.battleEnabled, false);
});

test('normalizeAppData keeps battles enabled for legacy saves without the switch', () => {
  const normalized = normalizeAppData(
    {
      currentClassId: 'class-a',
      classes: [{ id: 'class-a', name: 'Class A', students: [] }],
      settings: {},
    },
    2000,
  );

  assert.equal(normalized.settings?.battleEnabled, true);
});

test('normalizeAppData sanitizes active boss recovery states and expiry settings', () => {
  const normalized = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [
        {
          ...createStudent('active', 'Active'),
          bossRecovery: { impact: '8', startedAt: 1_000, recoverAt: 5_000 },
        },
        {
          ...createStudent('expired', 'Expired'),
          bossRecovery: { impact: 9, startedAt: 500, recoverAt: 1_500 },
        },
      ],
    }],
    settings: { bossRecoveryMinutes: 999 },
  }, 2_000);

  assert.deepEqual(normalized.classes[0].students[0].bossRecovery, {
    impact: 8,
    startedAt: 1_000,
    recoverAt: 5_000,
  });
  assert.equal(normalized.classes[0].students[1].bossRecovery, undefined);
  assert.equal(normalized.settings?.bossRecoveryMinutes, 120);
});

test('normalizeAppData migrates one legacy goal and keeps at most three class goals', () => {
  const legacy = normalizeAppData(
    {
      currentClassId: 'class-a',
      classes: [{
        id: 'class-a',
        name: 'Class A',
        students: [],
        classGoal: {
          id: 'legacy-goal',
          title: 'Collaborate',
          competency: 'collaboration',
          targetCount: 12,
          createdAt: 1000,
        },
      }],
    },
    2000,
  );
  assert.deepEqual(legacy.classes[0].classGoals, [{
    id: 'legacy-goal',
    title: 'Collaborate',
    competency: 'collaboration',
    targetCount: 12,
    createdAt: 1000,
    weekStartDate: getWeekStartDate(2000),
  }]);

  const capped = normalizeAppData(
    {
      currentClassId: 'class-a',
      classes: [{
        id: 'class-a',
        name: 'Class A',
        students: [],
        classGoals: ['participation', 'collaboration', 'growth', 'selfManagement'].map(
          (competency, index) => ({
            id: `goal-${index}`,
            title: `Goal ${index}`,
            competency,
            targetCount: 10,
            createdAt: 1000 + index,
          }),
        ),
      }],
    },
    2000,
  );
  assert.equal(capped.classes[0].classGoals?.length, 3);
  assert.equal(capped.classes[0].classGoals?.[2].competency, 'growth');
});

test('normalizeAppData preserves goal history while limiting each week to three goals', () => {
  const now = Date.UTC(2026, 7, 25, 4, 0, 0);
  const normalized = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [],
      classGoals: [
        ...['a', 'b', 'c'].map((id) => ({
          id: `prior-${id}`,
          title: `Prior ${id}`,
          competency: 'growth',
          targetCount: 3,
          createdAt: now - 7 * 24 * 60 * 60 * 1000,
          weekStartDate: '2026-08-17',
        })),
        ...['a', 'b', 'c', 'd'].map((id) => ({
          id: `current-${id}`,
          title: `Current ${id}`,
          competency: 'collaboration',
          targetCount: 3,
          createdAt: now,
          weekStartDate: '2026-08-24',
        })),
      ],
    }],
    settings: { schoolTimeZone: 'Asia/Taipei' },
  }, now);

  assert.equal(normalized.classes[0].classGoals?.length, 6);
  assert.equal(
    getActiveClassGoals(
      normalized.classes[0].classGoals,
      now,
      'Asia/Taipei',
    ).length,
    3,
  );
});

test('store archives prior-week goals and enforces three active goals this week', () => {
  const now = Date.now();
  const currentWeek = getWeekStartDate(now, 'Asia/Taipei');
  const priorWeek = addDaysToDateKey(currentWeek, -7);
  const data = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [],
      classGoals: [{
        id: 'prior-goal',
        title: 'Prior goal',
        competency: 'growth',
        targetCount: 3,
        createdAt: now - 7 * 24 * 60 * 60 * 1000,
        weekStartDate: priorWeek,
      }],
    }],
    settings: { schoolTimeZone: 'Asia/Taipei' },
  }, now);
  useStore.setState({ data, toast: null, showToast: () => undefined });

  ['Participation', 'Collaboration', 'Growth', 'Fourth'].forEach((title, index) => {
    useStore.getState().setClassGoal({
      title,
      competency: index === 1 ? 'collaboration' : 'participation',
      targetCount: 3,
    });
  });

  const storedGoals = useStore.getState().data.classes[0].classGoals ?? [];
  assert.equal(storedGoals.some((goal) => goal.id === 'prior-goal'), true);
  assert.equal(storedGoals.length, 4);
  assert.equal(
    getActiveClassGoals(storedGoals, now, 'Asia/Taipei').length,
    3,
  );
  assert.equal(storedGoals.some((goal) => goal.title === 'Fourth'), false);
});

test('normalizeAppData keeps legacy self-assessments separate from mentor feedback metrics', () => {
  const now = Date.UTC(2026, 6, 28, 4, 0, 0);
  const normalized = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [{
        ...createStudent('a', 'Alpha'),
        dailyProgress: {
          streak: 0,
          reflections: [
            {
              id: 'legacy-reflection',
              date: '2026-07-28',
              createdAt: now - 2000,
              competency: 'growth',
              selfAssessment: 'needsSupport',
              text: 'Legacy student check-in',
            },
            {
              id: 'mentor-feedback',
              date: '2026-07-28',
              createdAt: now - 1000,
              competency: 'assignmentQuality',
              author: 'mentor',
              mentorAssessment: 'confident',
              text: 'Homework was completed carefully.',
            },
          ],
        },
      }],
    }],
  }, now);

  const reflections = normalized.classes[0].students[0].dailyProgress?.reflections ?? [];
  assert.equal(reflections[0].author, 'mentor');
  assert.equal(reflections[0].mentorAssessment, 'confident');
  assert.equal(reflections[1].author, 'student');
  assert.equal(reflections[1].selfAssessment, 'needsSupport');

  assert.deepEqual(normalized.classes[0].learningEvidenceRecords, [{
    id: 'evidence-mentor-feedback',
    classId: 'class-a',
    studentId: 'a',
    competency: 'assignmentQuality',
    level: 'mastered',
    evidenceType: 'observation',
    title: 'Homework was completed carefully.',
    note: 'Homework was completed carefully.',
    actor: 'mentor',
    source: 'mentorDailyFeedback',
    sourceId: 'mentor-feedback',
    rubricVersion: 'legacy-1.0',
    revision: 1,
    createdAt: now - 1000,
  }]);

  const insights = getWeeklyEducationInsights(normalized.classes[0].students, now);
  assert.equal(insights.reflectionCount, 1);
  assert.deepEqual(insights.needsSupportReflectionStudents, []);
});

test('inclusive mode enforces supportive public rules and can be disabled', () => {
  const createRawData = (inclusiveMode: boolean) => ({
    currentClassId: 'class-a',
    classes: [{ id: 'class-a', name: 'Class A', students: [] }],
    settings: {
      inclusiveMode,
      pauseDecayOnWeekends: false,
      petCareMode: 'death',
      publicNameMode: 'full',
      publicLeaderboardMode: 'rank',
      bossAttackMode: 'random',
    },
  });

  const inclusive = normalizeAppData(createRawData(true), 2000);
  assert.equal(inclusive.settings?.inclusiveMode, true);
  assert.equal(inclusive.settings?.pauseDecayOnWeekends, true);
  assert.equal(inclusive.settings?.petCareMode, 'rest');
  assert.equal(inclusive.settings?.publicNameMode, 'masked');
  assert.equal(inclusive.settings?.publicLeaderboardMode, 'growth');
  assert.equal(inclusive.settings?.bossAttackMode, 'recoverable');

  const classic = normalizeAppData(createRawData(false), 2000);
  assert.equal(classic.settings?.inclusiveMode, false);
  assert.equal(classic.settings?.pauseDecayOnWeekends, false);
  assert.equal(classic.settings?.petCareMode, 'death');
  assert.equal(classic.settings?.publicNameMode, 'full');
  assert.equal(classic.settings?.publicLeaderboardMode, 'rank');
  assert.equal(classic.settings?.bossAttackMode, 'random');
});

test('normalizeAppData defaults legacy boss reward history and sanitizes persisted records', () => {
  const normalized = normalizeAppData(
    {
      currentClassId: 'class-a',
      classes: [{
        id: 'class-a',
        name: 'Class A',
        students: [
          { id: 'legacy', name: 'Legacy Student' },
          {
            id: 'saved',
            name: 'Saved Student',
            bossRewardRecords: [{
              id: 'reward-1',
              bossId: 'boss-legacy',
              bossName: '  Dragon  ',
              createdAt: '1500',
              rank: '2.9',
              damage: '44.8',
              previousDamage: '-5',
              improvementAmount: '12.7',
              rewardPoints: '30.9',
              rewardRankPoints: '11.2',
              rewardHappiness: '8.7',
              rankRewardPoints: '20',
              rankRewardRankPoints: '6',
              rankRewardHappiness: '4',
              participationRewardPoints: '10',
              participationRewardRankPoints: '5',
              participationRewardHappiness: '4',
              improvementRewardPoints: '-2',
              improvementRewardRankPoints: 0,
              improvementRewardHappiness: 0,
              receivedImprovementReward: false,
            }],
          },
        ],
      }],
    },
    2000,
  );

  assert.deepEqual(normalized.classes[0].students[0].bossRewardRecords, []);
  assert.deepEqual(normalized.classes[0].students[1].bossRewardRecords?.[0], {
    id: 'reward-1',
    bossId: 'boss-legacy',
    bossName: 'Dragon',
    createdAt: 1500,
    rank: 2,
    damage: 44,
    attackCount: 1,
    fairScore: 44,
    previousDamage: 0,
    previousFairScore: 0,
    improvementAmount: 12,
    fairImprovementAmount: 12,
    rewardPoints: 30,
    rewardRankPoints: 11,
    rewardHappiness: 8,
    rankRewardPoints: 20,
    rankRewardRankPoints: 6,
    rankRewardHappiness: 4,
    participationRewardPoints: 10,
    participationRewardRankPoints: 5,
    participationRewardHappiness: 4,
    improvementRewardPoints: 0,
    improvementRewardRankPoints: 0,
    improvementRewardHappiness: 0,
    receivedImprovementReward: false,
  });
});

test('normalizeAppData maps totals-only legacy boss rewards to an explicit rank breakdown', () => {
  const normalized = normalizeAppData(
    {
      currentClassId: 'class-a',
      classes: [{
        id: 'class-a',
        name: 'Class A',
        students: [{
          id: 'legacy',
          name: 'Legacy Student',
          bossRewardRecords: [{
            id: 'reward-total-only',
            bossId: 'boss-old',
            bossName: 'Old Boss',
            createdAt: 1500,
            rank: 1,
            damage: 25,
            rewardPoints: '30.9',
            rewardRankPoints: '11.2',
            rewardHappiness: '8.7',
          }],
        }],
      }],
    },
    2000,
  );

  const record = normalized.classes[0].students[0].bossRewardRecords?.[0];
  assert.equal(record?.rewardPoints, 30);
  assert.equal(record?.rewardRankPoints, 11);
  assert.equal(record?.rewardHappiness, 8);
  assert.deepEqual(
    {
      rank: [
        record?.rankRewardPoints,
        record?.rankRewardRankPoints,
        record?.rankRewardHappiness,
      ],
      participation: [
        record?.participationRewardPoints,
        record?.participationRewardRankPoints,
        record?.participationRewardHappiness,
      ],
      improvement: [
        record?.improvementRewardPoints,
        record?.improvementRewardRankPoints,
        record?.improvementRewardHappiness,
      ],
    },
    {
      rank: [30, 11, 8],
      participation: [0, 0, 0],
      improvement: [0, 0, 0],
    },
  );
});

test('computeBadges derives badges from the current student state', () => {
  const badges = computeBadges({
    ...createStudent(),
    points: 520,
    pet: {
      ...createStudent().pet,
      type: 'dog',
      level: 10,
    },
    stats: {
      wins: 10,
      losses: 2,
    },
  });

  assert.deepEqual(badges, ['badgeFirstWin', 'badgeVeteran', 'badgeRich', 'badgeMaxLevel']);
});

test('settings impact preview follows weekend decay and current student upgrade gaps', () => {
  const monday = new Date(2026, 6, 27, 0).getTime();
  const student = {
    ...createStudent(),
    points: 20,
    pet: {
      ...createStudent().pet,
      type: 'dog',
      level: 1,
      fullness: 80,
    },
  };

  const preview = getSettingsImpactPreview(
    [student],
    {
      decayAmount: 2,
      decayType: 'daily',
      pauseDecayOnWeekends: true,
      feedCost: 10,
      feedGain: 20,
    },
    7,
    monday,
  );

  assert.deepEqual(preview, {
    currentAverageFullness: 80,
    projectedAverageFullness: 70,
    sevenDayDecay: 10,
    estimatedUpgradeActions: 5,
    estimatedUpgradeDays: 5,
  });
});

test('normalizeAppData deduplicates persisted point reason shortcuts', () => {
  const normalized = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{ id: 'class-a', name: 'Class A', students: [] }],
    settings: {
      pinnedReasonIds: ['homework', '', 'homework', 2, 'helpful'],
      recentReasonIds: ['late', 'growth', 'late'],
    },
  }, 1000);

  assert.deepEqual(normalized.settings?.pinnedReasonIds, ['homework', 'helpful']);
  assert.deepEqual(normalized.settings?.recentReasonIds, ['late', 'growth']);
});

test('normalizeAppData sanitizes custom point reasons and remembered feedback history', () => {
  const normalized = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{ id: 'class-a', name: 'Class A', students: [] }],
    settings: {
      pointReasonOptions: [
        {
          id: 'participation',
          amount: 15,
          competency: 'participation',
          labels: { zh: '課堂參與 +15', en: 'Participation +15' },
        },
        {
          id: 'custom-help',
          amount: -5,
          competency: 'collaboration',
          labels: { zh: '小組提醒', en: 'Team Reminder' },
        },
        {
          id: 'custom-help',
          amount: 20,
          competency: 'growth',
          labels: { zh: '重複項目', en: 'Duplicate' },
        },
        {
          id: 'invalid-zero',
          amount: 0,
          competency: 'growth',
          labels: { zh: '無效', en: 'Invalid' },
        },
      ],
      pinnedReasonIds: ['participation', 'missing', 'custom-help'],
      recentReasonIds: ['missing', 'custom-help'],
      feedbackReasonHistory: [
        '小組提醒',
        { label: '持續進步', competency: 'growth' },
        '主動協助',
        '主動協助',
        '  Task complete  ',
        'task complete',
      ],
    },
  }, 1000);

  assert.deepEqual(normalized.settings?.pointReasonOptions, [
    {
      id: 'participation',
      amount: 15,
      competency: 'participation',
      labels: { zh: '課堂參與', en: 'Participation' },
    },
    {
      id: 'custom-help',
      amount: -5,
      competency: 'collaboration',
      labels: { zh: '小組提醒', en: 'Team Reminder' },
    },
  ]);
  assert.deepEqual(normalized.settings?.pinnedReasonIds, ['participation', 'custom-help']);
  assert.deepEqual(normalized.settings?.recentReasonIds, ['custom-help']);
  assert.deepEqual(normalized.settings?.feedbackReasonHistory, [
    { label: '小組提醒', competency: 'collaboration' },
    { label: '持續進步', competency: 'growth' },
    { label: '主動協助', competency: 'participation' },
    { label: 'Task complete', competency: 'participation' },
  ]);
});

test('deleteStudent immediately removes every class-level record keyed to that student', () => {
  const evidence = (studentId: string, createdAt: number) => ({
    id: `evidence-${studentId}`,
    classId: 'class-a',
    studentId,
    competency: 'participation',
    level: 'progressing',
    evidenceType: 'observation',
    title: `Evidence for ${studentId}`,
    actor: 'mentor',
    source: 'manual',
    rubricVersion: '1.0',
    revision: 1,
    createdAt,
  });
  useStore.getState().importData(
    {
      lastOpened: 2000,
      currentClassId: 'class-a',
      classes: [{
        id: 'class-a',
        name: 'Class A',
        students: [
          createStudent('deleted', 'Deleted Student'),
          createStudent('kept', 'Kept Student'),
        ],
        learningEvidenceRecords: [
          evidence('deleted', 1900),
          evidence('kept', 1800),
        ],
        examRecords: [{
          id: 'exam-a',
          title: 'Assessment',
          examDate: '2026-07-01',
          items: [{ id: 'item-a', name: 'Math', maxScore: 100 }],
          results: [
            { studentId: 'deleted', scores: { 'item-a': 70 }, updatedAt: 1900 },
            { studentId: 'kept', scores: { 'item-a': 80 }, updatedAt: 1900 },
          ],
          createdAt: 1800,
          updatedAt: 1900,
        }],
        activeBoss: {
          ...createBoss(),
          contributions: { deleted: 30, kept: 20 },
          attackCounts: { deleted: 2, kept: 1 },
        },
      }],
    },
    2000,
  );

  useStore.getState().deleteStudent('deleted');

  const currentClass = useStore.getState().data.classes[0];
  assert.deepEqual(currentClass.students.map((student) => student.id), ['kept']);
  assert.deepEqual(
    currentClass.learningEvidenceRecords?.map((record) => record.studentId),
    ['kept'],
  );
  assert.deepEqual(
    currentClass.examRecords?.[0].results.map((result) => result.studentId),
    ['kept'],
  );
  assert.deepEqual(currentClass.activeBoss?.contributions, { kept: 20 });
  assert.deepEqual(currentClass.activeBoss?.attackCounts, { kept: 1 });
});

test('session reset invalidates sync observers before notifying them without persisting lifecycle metadata', () => {
  const generation = getStoreSessionGeneration();
  let observedGeneration: number | undefined;
  const unsubscribe = useStore.subscribe(() => {
    observedGeneration = getStoreSessionGeneration();
  });
  try {
    resetStoreForSession(3000);
    assert.equal(observedGeneration, generation + 1);
    assert.equal(getStoreSessionGeneration(), generation + 1);
    useStore.setState({ view: 'dashboard' });
    assert.equal(getStoreSessionGeneration(), generation + 1);
    assert.equal('storeSessionGeneration' in useStore.getState().data, false);
  } finally {
    unsubscribe();
    resetStoreForSession(3000);
  }
});

test('PII cache is opt-in and resetStoreForSession clears account-scoped state without deleting legacy data', () => {
  memoryStorage.clear();
  memoryStorage.set('tamagotchi_classroom_data', 'legacy-cache-awaiting-migration');
  useStore.getState().importData(
    {
      currentClassId: 'class-a',
      classes: [{
        id: 'class-a',
        name: 'Class A',
        students: [createStudent('a', 'Alpha')],
      }],
    },
    2000,
  );
  useStore.setState({
    view: 'dashboard',
    animatingPets: { a: 'attack' },
    toast: { message: 'private toast', type: 'success' },
    upgradeReward: { studentId: 'a', studentName: 'Alpha', reachedLevel: 2 },
    bossHitFeedback: { damage: 10, id: 1 },
    bossAttackFeedback: { targetNames: ['Alpha'], damage: 5, id: 2 },
    showBossVictory: true,
    bossVictoryResult: { bossName: 'Boss', standings: [] },
    undoAction: {
      id: 'undo-a',
      classId: 'class-a',
      label: 'Undo',
      expiresAt: 9999,
      entries: [],
    },
    safetyUndoAction: {
      id: 'undo-safety-a',
      classId: 'class-a',
      studentId: 'a',
      originalRecordId: 'record-a',
      actionKind: 'discipline',
      label: 'Undo formal action',
      expiresAt: 9999,
    },
  });

  assert.equal(
    memoryStorage.get('tamagotchi_classroom_data'),
    'legacy-cache-awaiting-migration',
  );
  assert.equal(memoryStorage.has('epet-session-memory-only'), false);

  resetStoreForSession(3000);

  const state = useStore.getState();
  assert.equal(state.data.classes.length, 1);
  assert.deepEqual(state.data.classes[0].students, []);
  assert.equal(state.view, 'classroom');
  assert.deepEqual(state.animatingPets, {});
  assert.equal(state.toast, null);
  assert.equal(state.upgradeReward, null);
  assert.equal(state.bossHitFeedback, null);
  assert.equal(state.bossAttackFeedback, null);
  assert.equal(state.showBossVictory, false);
  assert.equal(state.bossVictoryResult, null);
  assert.equal(state.undoAction, null);
  assert.equal(state.safetyUndoAction, null);
  assert.equal(
    memoryStorage.get('tamagotchi_classroom_data'),
    'legacy-cache-awaiting-migration',
  );
});

test('formal discipline requires a reason while quick level decrease uses an audit label and cannot repeat', () => {
  const data = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [{
        ...createStudent('a', 'Alpha'),
        activeWarningTimestamps: [1000, 1100],
        warningPoints: 2,
        pet: { ...createStudent().pet, type: 'dog' },
      }],
    }],
  }, 2000);
  useStore.setState({
    data,
    toast: null,
    undoAction: null,
    safetyUndoAction: null,
    showToast: () => undefined,
  });

  useStore.getState().disciplineStudent('a', '   ');
  useStore.getState().decreaseLevel('a');
  let student = useStore.getState().data.classes[0].students[0];
  assert.equal(student.points, 200);
  assert.equal(student.pet.level, 2);
  assert.equal(student.disciplineRecords?.length, 1);
  assert.equal(student.disciplineRecords?.[0].type, 'levelDecrease');
  assert.equal(student.disciplineRecords?.[0].reason, '導師快速降級操作');
  useStore.getState().decreaseLevel('a');
  student = useStore.getState().data.classes[0].students[0];
  assert.equal(student.pet.level, 2);
  assert.equal(student.disciplineRecords?.length, 1);
  const pendingLevelUndo = useStore.getState().safetyUndoAction;
  assert.ok(pendingLevelUndo);
  useStore.setState({
    safetyUndoAction: { ...pendingLevelUndo, expiresAt: Date.now() - 1 },
  });
  useStore.getState().decreaseLevel('a', 'Expired undo must not bypass the cooldown');
  useStore.setState({ safetyUndoAction: null });
  useStore.getState().decreaseLevel('a', 'Cleared undo must not bypass the cooldown');
  student = useStore.getState().data.classes[0].students[0];
  assert.equal(student.pet.level, 2);
  assert.equal(student.disciplineRecords?.length, 1);

  resetStoreForSession(2100);
  useStore.setState({
    data,
    toast: null,
    undoAction: null,
    safetyUndoAction: null,
    showToast: () => undefined,
  });
  useStore.getState().disciplineStudent('a', 'Unsafe repeated conduct after prior reminders');
  const once = useStore.getState().data.classes[0].students[0];
  useStore.setState({ safetyUndoAction: null });
  useStore.getState().disciplineStudent('a', 'Duplicate punishment must be rejected');
  const twice = useStore.getState().data.classes[0].students[0];
  assert.equal(twice.points, once.points);
  assert.equal(twice.rankPoints, once.rankPoints);
  assert.equal(twice.pet.fullness, once.pet.fullness);
  assert.equal(twice.pet.happiness, once.pet.happiness);
  assert.equal(twice.penaltyStatus?.until, once.penaltyStatus?.until);
  assert.equal(twice.disciplineRecords?.length, 1);
  assert.equal(twice.disciplineRecords?.[0].reason, 'Unsafe repeated conduct after prior reminders');
  resetStoreForSession(2200);
});

test('a recorded reversal releases the 24-hour level decrease cooldown', () => {
  const data = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [{
        ...createStudent('a', 'Alpha'),
        pet: { ...createStudent().pet, type: 'dog', level: 3 },
      }],
    }],
  }, 2000);
  useStore.setState({
    data,
    toast: null,
    undoAction: null,
    safetyUndoAction: null,
    showToast: () => undefined,
  });

  useStore.getState().decreaseLevel('a', 'Initial action entered in error');
  useStore.getState().undoLastSafetyAction();
  useStore.getState().decreaseLevel('a', 'Correctly documented level intervention');

  const student = useStore.getState().data.classes[0].students[0];
  assert.equal(student.pet.level, 2);
  assert.equal(student.disciplineRecords?.filter((record) => record.type === 'levelDecrease').length, 2);
  assert.equal(student.disciplineRecords?.filter((record) => record.type === 'reversal').length, 1);
  const reversal = student.disciplineRecords?.find((record) => record.type === 'reversal');
  const firstDecrease = student.disciplineRecords?.find(
    (record) => record.type === 'levelDecrease' && record.reason === 'Initial action entered in error',
  );
  assert.equal(reversal?.reversesRecordId, firstDecrease?.id);
  resetStoreForSession(2250);
});

test('formal discipline undo restores every affected state and keeps original plus reversal ledger records', () => {
  const originalStudent = {
    ...createStudent('a', 'Alpha'),
    points: 15,
    rankPoints: 10,
    warningPoints: 2,
    activeWarningTimestamps: [1000, 1100],
    pet: {
      ...createStudent().pet,
      type: 'dog',
      fullness: 10,
      happiness: 8,
      level: 3,
    },
  };
  const data = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{ id: 'class-a', name: 'Class A', students: [originalStudent] }],
  }, 2000);
  useStore.setState({
    data,
    toast: null,
    undoAction: null,
    safetyUndoAction: null,
    showToast: () => undefined,
  });

  useStore.getState().disciplineStudent('a', 'Documented serious classroom safety incident');
  const penalized = useStore.getState().data.classes[0].students[0];
  assert.equal(penalized.points, 0);
  assert.equal(penalized.rankPoints, 0);
  assert.equal(penalized.pet.fullness, 0);
  assert.equal(penalized.pet.happiness, 0);
  assert.equal(penalized.warningPoints, 0);
  assert.deepEqual(penalized.activeWarningTimestamps, []);
  assert.equal(penalized.penaltyStatus?.source, 'discipline');
  const originalRecordId = penalized.disciplineRecords?.[0].id;

  useStore.getState().undoLastSafetyAction();
  const restored = useStore.getState().data.classes[0].students[0];
  assert.equal(restored.points, originalStudent.points);
  assert.equal(restored.rankPoints, originalStudent.rankPoints);
  assert.equal(restored.pet.fullness, originalStudent.pet.fullness);
  assert.equal(restored.pet.happiness, originalStudent.pet.happiness);
  assert.equal(restored.pet.level, originalStudent.pet.level);
  assert.equal(restored.warningPoints, originalStudent.warningPoints);
  assert.deepEqual(restored.activeWarningTimestamps, originalStudent.activeWarningTimestamps);
  assert.equal(restored.penaltyStatus, undefined);
  assert.deepEqual(restored.disciplineRecords?.map((record) => record.type), [
    'reversal',
    'discipline',
  ]);
  assert.equal(restored.disciplineRecords?.[0].reversesRecordId, originalRecordId);
  assert.equal(restored.disciplineRecords?.[0].reason, 'Documented serious classroom safety incident');
  assert.equal(restored.disciplineRecords?.[1].id, originalRecordId);
  assert.ok(restored.disciplineRecords?.[1].safetyEffect);
  assert.equal(useStore.getState().safetyUndoAction, null);

  useStore.getState().importData(useStore.getState().data, Date.now());
  const roundTrippedRecords = useStore.getState().data.classes[0].students[0].disciplineRecords ?? [];
  assert.deepEqual(roundTrippedRecords.map((record) => record.type), ['reversal', 'discipline']);
  assert.equal(roundTrippedRecords[0].reversesRecordId, originalRecordId);
  assert.equal(roundTrippedRecords[0].reason, 'Documented serious classroom safety incident');
  assert.equal(roundTrippedRecords[1].id, originalRecordId);
  assert.equal(roundTrippedRecords[1].actionKind, 'discipline');
  assert.deepEqual(roundTrippedRecords[1].safetyEffect?.before.activeWarningTimestamps, [1000, 1100]);
  assert.equal(roundTrippedRecords[1].safetyEffect?.after.penaltyStatus?.source, 'discipline');
  resetStoreForSession(2300);
});

test('discipline record import preserves legacy entries and rejects unknown ledger values', () => {
  const data = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [{
        ...createStudent('a', 'Alpha'),
        disciplineRecords: [
          { id: 'legacy', type: 'warning', createdAt: 1000, warningCount: 1 },
          {
            id: 'unknown',
            type: 'executeScript',
            createdAt: 900,
            reason: { unsafe: true },
            actionKind: 'deleteStudent',
            reversesRecordId: '<script>',
            safetyEffect: { before: 'invalid', after: 'invalid' },
          },
        ],
        pet: { ...createStudent().pet, type: 'dog' },
      }],
    }],
  }, 2000);
  const records = data.classes[0].students[0].disciplineRecords ?? [];
  assert.equal(records[0].type, 'warning');
  assert.equal(records[0].warningCount, 1);
  assert.equal(records[1].type, 'warning');
  assert.equal(records[1].reason, undefined);
  assert.equal(records[1].actionKind, undefined);
  assert.equal(records[1].reversesRecordId, undefined);
  assert.equal(records[1].safetyEffect, undefined);
});

test('safety undo compensates deltas without overwriting newer warning or penalty state', () => {
  const data = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [{
        ...createStudent('a', 'Alpha'),
        pet: { ...createStudent().pet, type: 'dog', level: 3 },
      }],
    }],
  }, 2000);
  useStore.setState({
    data,
    toast: null,
    undoAction: null,
    safetyUndoAction: null,
    showToast: () => undefined,
  });
  useStore.getState().decreaseLevel('a', 'Documented intervention');

  const newerPenalty = { source: 'autoPenalty' as const, until: Date.now() + 50000 };
  useStore.setState((state) => ({
    data: {
      ...state.data,
      classes: state.data.classes.map((classData) => ({
        ...classData,
        students: classData.students.map((student) => student.id === 'a'
          ? {
              ...student,
              points: student.points + 7,
              rankPoints: (student.rankPoints ?? 0) + 3,
              warningPoints: 1,
              activeWarningTimestamps: [5555],
              penaltyStatus: newerPenalty,
              pet: {
                ...student.pet,
                level: student.pet.level + 1,
                fullness: student.pet.fullness + 4,
                happiness: student.pet.happiness + 2,
              },
            }
          : student),
      })),
    },
  }));

  useStore.getState().undoLastSafetyAction();
  const restored = useStore.getState().data.classes[0].students[0];
  assert.equal(restored.points, 207);
  assert.equal(restored.rankPoints, 103);
  assert.equal(restored.pet.level, 4);
  assert.equal(restored.pet.fullness, 84);
  assert.equal(restored.pet.happiness, 52);
  assert.equal(restored.warningPoints, 1);
  assert.deepEqual(restored.activeWarningTimestamps, [5555]);
  assert.deepEqual(restored.penaltyStatus, newerPenalty);
  assert.deepEqual(restored.disciplineRecords?.map((record) => record.type), [
    'reversal',
    'levelDecrease',
  ]);
  resetStoreForSession(2400);
});

test('batch point adjustment undo restores clamped point values and removes its records', () => {
  const data = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [
        {
          ...createStudent('a', 'Alpha'),
          points: 95,
          pet: { ...createStudent().pet, type: 'dog' },
        },
        {
          ...createStudent('b', 'Beta'),
          points: 20,
          pet: { ...createStudent().pet, type: 'cat' },
        },
      ],
    }],
    settings: { maxPoints: 100, participationSupportEnabled: false },
  }, 1000);
  useStore.setState({
    data,
    toast: null,
    undoAction: null,
    showToast: () => undefined,
  });

  useStore.getState().adjustPointsForStudents(
    ['a', 'b'],
    10,
    'manual',
    { label: 'Team feedback', competency: 'collaboration' },
  );
  const adjustedStudents = useStore.getState().data.classes[0].students;
  assert.deepEqual(adjustedStudents.map((student) => student.points), [100, 30]);
  assert.deepEqual(
    adjustedStudents.map((student) => student.pointAdjustmentRecords?.length),
    [1, 1],
  );
  assert.deepEqual(
    useStore.getState().data.settings?.feedbackReasonHistory,
    [{ label: 'Team feedback', competency: 'collaboration' }],
  );
  assert.deepEqual(
    adjustedStudents.map((student) => student.pointAdjustmentRecords?.[0].competency),
    ['collaboration', 'collaboration'],
  );

  useStore.getState().undoLastPointAdjustment();
  const restoredStudents = useStore.getState().data.classes[0].students;
  assert.deepEqual(restoredStudents.map((student) => student.points), [95, 20]);
  assert.deepEqual(
    restoredStudents.map((student) => student.pointAdjustmentRecords?.length),
    [0, 0],
  );
  assert.equal(useStore.getState().undoAction, null);
});

test('store point guardrails preserve auditable clamped and blocked outcomes', () => {
  const now = Date.now();
  const existingRecord = createPointAdjustmentRecord(190, 'quick', undefined, now - 1000);
  const data = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [{
        ...createStudent('a', 'Alpha'),
        points: 200,
        pet: { ...createStudent().pet, type: 'dog' },
        pointAdjustmentRecords: [existingRecord],
      }],
    }],
    settings: {
      pointGuardrailsEnabled: true,
      dailyPositivePointLimit: 200,
      dailyNegativePointLimit: 60,
      schoolTimeZone: 'Asia/Taipei',
    },
  }, now);
  useStore.setState({
    data,
    toast: null,
    undoAction: null,
    showToast: () => undefined,
  });

  useStore.getState().addPoints('a', 20, 'quick', { label: 'Strong contribution' });
  const clampedStudent = useStore.getState().data.classes[0].students[0];
  assert.equal(clampedStudent.points, 210);
  assert.deepEqual(
    {
      amount: clampedStudent.pointAdjustmentRecords?.[0].amount,
      requestedAmount: clampedStudent.pointAdjustmentRecords?.[0].requestedAmount,
      outcome: clampedStudent.pointAdjustmentRecords?.[0].guardrailOutcome,
      reason: clampedStudent.pointAdjustmentRecords?.[0].guardrailReason,
    },
    {
      amount: 10,
      requestedAmount: 20,
      outcome: 'clamped',
      reason: 'dailyPositiveLimit',
    },
  );

  useStore.getState().undoLastPointAdjustment();
  const restoredStudent = useStore.getState().data.classes[0].students[0];
  assert.equal(restoredStudent.points, 200);
  assert.deepEqual(restoredStudent.pointAdjustmentRecords?.map((record) => record.id), [
    existingRecord.id,
  ]);

  useStore.setState((state) => ({
    data: {
      ...state.data,
      classes: state.data.classes.map((classData) => ({
        ...classData,
        students: classData.students.map((student) => ({
          ...student,
          pointAdjustmentRecords: [
            createPointAdjustmentRecord(200, 'quick', undefined, Date.now() - 100),
          ],
        })),
      })),
    },
    undoAction: null,
  }));
  useStore.getState().addPoints('a', 10, 'quick', { label: 'Extra reward' });
  const blockedStudent = useStore.getState().data.classes[0].students[0];
  assert.equal(blockedStudent.points, 200);
  assert.equal(blockedStudent.pointAdjustmentRecords?.[0].amount, 0);
  assert.equal(blockedStudent.pointAdjustmentRecords?.[0].requestedAmount, 10);
  assert.equal(blockedStudent.pointAdjustmentRecords?.[0].guardrailOutcome, 'blocked');
  assert.equal(blockedStudent.pointAdjustmentRecords?.[0].competency, 'participation');
  assert.equal(useStore.getState().undoAction, null);
});

test('store participation support is auditable and undoes atomically with the base reward', () => {
  const now = Date.now();
  const data = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [
        {
          ...createStudent('low', 'Low'),
          points: 100,
          pet: { ...createStudent().pet, type: 'dog' },
        },
        {
          ...createStudent('high', 'High'),
          points: 500,
          pet: { ...createStudent().pet, type: 'cat' },
        },
      ],
    }],
    settings: {
      pointGuardrailsEnabled: true,
      dailyPositivePointLimit: 200,
      participationSupportEnabled: true,
      minimumDailyParticipationPoints: 20,
      catchUpGapThreshold: 100,
      dailyCatchUpBonus: 10,
      schoolTimeZone: 'Asia/Taipei',
    },
  }, now);
  useStore.setState({
    data,
    toast: null,
    undoAction: null,
    showToast: () => undefined,
  });

  useStore.getState().addPoints('low', 5, 'manual', {
    label: 'Participated in discussion',
    competency: 'participation',
  });
  const supportedStudent = useStore.getState().data.classes[0].students[0];
  assert.equal(supportedStudent.points, 130);
  assert.deepEqual(
    supportedStudent.pointAdjustmentRecords?.slice(0, 3).map((record) => ({
      source: record.source,
      amount: record.amount,
      competency: record.competency,
    })),
    [
      { source: 'catchUpBonus', amount: 10, competency: 'participation' },
      { source: 'participationTopUp', amount: 15, competency: 'participation' },
      { source: 'manual', amount: 5, competency: 'participation' },
    ],
  );
  assert.equal(useStore.getState().undoAction?.entries.length, 3);

  useStore.getState().undoLastPointAdjustment();
  const restoredStudent = useStore.getState().data.classes[0].students[0];
  assert.equal(restoredStudent.points, 100);
  assert.deepEqual(restoredStudent.pointAdjustmentRecords, []);
  assert.equal(useStore.getState().undoAction, null);
});

test('learning evidence stays separate from game points and point history', () => {
  const data = normalizeAppData({
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [{
        ...createStudent('a', 'Alpha'),
        pet: { ...createStudent().pet, type: 'dog' },
      }],
      learningEvidenceRecords: [],
    }],
  }, 1000);
  useStore.setState({
    data,
    toast: null,
    undoAction: null,
    showToast: () => undefined,
  });

  useStore.getState().addLearningEvidence('a', {
    competency: 'collaboration',
    level: 'progressing',
    evidenceType: 'observation',
    title: 'Explains a strategy to teammates',
    note: 'Used evidence from the group worksheet.',
  });

  const nextClass = useStore.getState().data.classes[0];
  assert.equal(nextClass.students[0].points, 200);
  assert.deepEqual(nextClass.students[0].pointAdjustmentRecords, []);
  assert.equal(nextClass.learningEvidenceRecords?.length, 1);
  assert.equal(nextClass.learningEvidenceRecords?.[0].competency, 'collaboration');
  assert.equal(nextClass.learningEvidenceRecords?.[0].source, 'manual');
});

test('daily task skips feedback collection while separate mentor feedback still syncs evidence', () => {
  const originalDateNow = Date.now;
  let now = Date.UTC(2026, 7, 31, 2, 0, 0);
  Date.now = () => now;

  try {
    const data = normalizeAppData({
      currentClassId: 'class-a',
      classes: [{
        id: 'class-a',
        name: 'Class A',
        students: [{
          ...createStudent('a', 'Alpha'),
          pet: { ...createStudent().pet, type: 'dog' },
        }],
        learningEvidenceRecords: [],
      }],
    }, now);
    useStore.setState({
      data,
      toast: null,
      undoAction: null,
      showToast: () => undefined,
    });

    const claimed = useStore.getState().claimDailyTask('a');
    assert.equal(claimed, true);

    let currentClass = useStore.getState().data.classes[0];
    assert.deepEqual(currentClass.students[0].dailyProgress?.reflections ?? [], []);
    assert.deepEqual(currentClass.learningEvidenceRecords, []);

    now += 60_000;
    useStore.getState().saveMentorDailyFeedback('a', {
      competency: 'growth',
      assessment: 'needsSupport',
      text: 'Needs a prompt to explain the next improvement step.',
    });

    currentClass = useStore.getState().data.classes[0];
    const mentorFeedback = currentClass.students[0].dailyProgress?.reflections?.[0];
    assert.equal(mentorFeedback?.author, 'mentor');
    assert.equal(currentClass.learningEvidenceRecords?.length, 1);
    assert.equal(currentClass.learningEvidenceRecords?.[0].sourceId, mentorFeedback?.id);

    const analytics = computeStudentLearningAnalytics(
      currentClass.students[0],
      currentClass.learningEvidenceRecords ?? [],
      now,
    );
    assert.equal(analytics.evidenceCount, 1);
    assert.equal(analytics.recentEvidence[0]?.competency, 'growth');
    assert.equal(analytics.recentEvidence[0]?.level, 'needsSupport');
    assert.equal(
      analytics.recentEvidence[0]?.title,
      'Needs a prompt to explain the next improvement step.',
    );
  } finally {
    Date.now = originalDateNow;
  }
});

test('education metrics report evidence coverage, recovery, alignment, and student trend', () => {
  const now = Date.UTC(2026, 6, 29, 4, 0, 0);
  const students = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
    { id: 'c', name: 'Gamma' },
  ];
  const evidence = [
    createLearningEvidenceRecord(
      'class-a',
      'a',
      {
        competency: 'collaboration',
        level: 'needsSupport',
        evidenceType: 'observation',
        title: 'Needs a turn-taking prompt',
      },
      now - 3 * 24 * 60 * 60 * 1000,
      'evidence-1',
    ),
    createLearningEvidenceRecord(
      'class-a',
      'a',
      {
        competency: 'collaboration',
        level: 'progressing',
        evidenceType: 'project',
        title: 'Uses turn-taking independently',
      },
      now - 2 * 24 * 60 * 60 * 1000,
      'evidence-2',
    ),
    createLearningEvidenceRecord(
      'class-a',
      'b',
      {
        competency: 'assignmentQuality',
        level: 'mastered',
        evidenceType: 'assignment',
        title: 'Meets every rubric criterion',
      },
      now - 24 * 60 * 60 * 1000,
      'evidence-3',
    ),
  ];

  const classMetrics = computeClassEffectivenessMetrics(
    students,
    evidence,
    [{ competency: 'collaboration', createdAt: now - 4 * 24 * 60 * 60 * 1000 }],
    now,
  );
  assert.equal(classMetrics.evidenceCount, 3);
  assert.equal(classMetrics.coverageRate, 2 / 3);
  assert.equal(classMetrics.progressingOrMasteredRate, 2 / 3);
  assert.equal(classMetrics.masteryRate, 1 / 3);
  assert.equal(classMetrics.goalAlignmentRate, 2 / 3);
  assert.equal(classMetrics.supportRecoveryCount, 1);
  assert.equal(classMetrics.competencyBreadth, 2);
  assert.deepEqual(classMetrics.overlookedStudentIds, ['c']);

  const studentMetrics = computeStudentLearningAnalytics(students[0], evidence, now);
  assert.equal(studentMetrics.evidenceCount, 2);
  assert.equal(studentMetrics.competencyBreadth, 1);
  assert.equal(
    studentMetrics.competencySummaries.find(
      (summary) => summary.competency === 'collaboration',
    )?.trend,
    1,
  );
  assert.deepEqual(studentMetrics.needsSupportCompetencies, []);
});

test('weekly education insights ignore game points when learning evidence is available', () => {
  const now = Date.UTC(2026, 6, 29, 4, 0, 0);
  const student = {
    ...createStudent('a', 'Alpha'),
    pointAdjustmentRecords: [
      createPointAdjustmentRecord(
        100,
        'quick',
        {
          id: 'participation',
          label: 'Game reward',
          competency: 'participation',
        },
        now - 1000,
      ),
    ],
  };
  const evidence = [
    createLearningEvidenceRecord(
      'class-a',
      'a',
      {
        competency: 'collaboration',
        level: 'needsSupport',
        evidenceType: 'observation',
        title: 'Needs support taking turns',
      },
      now - 500,
      'evidence-support',
    ),
  ];

  const insights = getWeeklyEducationInsights([student], now, 7, evidence);
  assert.equal(insights.positiveCount, 0);
  assert.equal(insights.negativeCount, 1);
  assert.equal(insights.competencyCounts.participation, 0);
  assert.equal(insights.competencyCounts.collaboration, 1);
});

test('exam analytics calculates normalized trends, class comparison, strengths, and weaknesses', () => {
  const exams = normalizeExamRecords(
    [
      {
        id: 'exam-current',
        title: 'Second Assessment',
        examDate: '2026-07-01',
        createdAt: 2000,
        updatedAt: 2000,
        items: [
          { id: 'math-current', name: 'Math', maxScore: 100 },
          { id: 'reading-current', name: 'Reading', maxScore: 100 },
        ],
        results: [
          {
            studentId: 'a',
            scores: { 'math-current': 90, 'reading-current': 50 },
            mentorComment: 'Use evidence from the text.',
            updatedAt: 2000,
          },
          {
            studentId: 'b',
            scores: { 'math-current': 50, 'reading-current': 70 },
            updatedAt: 2000,
          },
        ],
      },
      {
        id: 'exam-previous',
        title: 'First Assessment',
        examDate: '2026-06-01',
        createdAt: 1000,
        updatedAt: 1000,
        items: [
          { id: 'math-previous', name: 'Math', maxScore: 100 },
          { id: 'reading-previous', name: 'Reading', maxScore: 50 },
        ],
        results: [
          {
            studentId: 'a',
            scores: { 'math-previous': 60, 'reading-previous': 40 },
            updatedAt: 1000,
          },
        ],
      },
    ],
    new Set(['a', 'b']),
    3000,
  );
  const analysis = computeExamStudentAnalysis(exams, 'exam-current', 'a');

  assert.ok(analysis);
  assert.equal(Math.round(analysis.overallPercent ?? 0), 70);
  assert.equal(Math.round(analysis.previousOverallPercent ?? 0), 67);
  assert.equal(analysis.trend, 'improving');
  assert.equal(Math.round(analysis.classAveragePercent ?? 0), 65);
  assert.deepEqual(
    analysis.strengthItems.map((item) => item.name),
    ['Math'],
  );
  assert.deepEqual(
    analysis.weaknessItems.map((item) => item.name),
    ['Reading'],
  );
  assert.equal(
    Math.round(
      analysis.itemAnalyses.find((item) => item.name === 'Reading')?.trendDelta ?? 0,
    ),
    -30,
  );
  assert.equal(analysis.mentorComment, 'Use evidence from the text.');
});

test('normalizeAppData keeps legacy saves compatible and sanitizes exam records', () => {
  const normalized = normalizeAppData(
    {
      currentClassId: 'class-a',
      classes: [
        {
          id: 'class-a',
          name: 'Class A',
          students: [
            { id: 'legacy', name: 'Legacy' },
            { id: 'saved', name: 'Saved' },
          ],
          examRecords: [{
            id: 'exam-1',
            title: '  Midterm  ',
            examDate: '2026-07-01',
            createdAt: 1000,
            items: [
              { id: 'item-a', name: ' Math ', maxScore: '50' },
              { id: 'item-b', name: 'math', maxScore: 100 },
            ],
            results: [
              {
                studentId: 'saved',
                scores: { 'item-a': '70', 'item-b': 80, unknown: 10 },
                mentorComment: '  Keep showing your work.  ',
              },
              {
                studentId: 'missing',
                scores: { 'item-a': 20 },
              },
            ],
          }],
        },
      ],
    },
    2000,
  );

  assert.equal(normalized.classes[0].examRecords?.length, 1);
  assert.equal(normalized.classes[0].examRecords?.[0].title, 'Midterm');
  assert.deepEqual(normalized.classes[0].examRecords?.[0].items, [
    { id: 'item-a', name: 'Math', maxScore: 50 },
  ]);
  assert.deepEqual(normalized.classes[0].examRecords?.[0].results, [
    {
      studentId: 'saved',
      scores: { 'item-a': 50 },
      mentorComment: 'Keep showing your work.',
      updatedAt: 1000,
    },
  ]);

  const legacy = normalizeAppData({
    currentClassId: 'legacy-class',
    classes: [{ id: 'legacy-class', name: 'Legacy', students: [] }],
  }, 2000);
  assert.deepEqual(legacy.classes[0].examRecords, []);
});

test('individual exam report uses A4 print CSS and escapes teacher-provided content', () => {
  const exam = normalizeExamRecords(
    [{
      id: 'exam-report',
      title: 'Progress <Review>',
      examDate: '2026-07-01',
      items: [
        { id: 'item-1', name: 'Reading', maxScore: 100 },
        { id: 'item-2', name: 'Writing', maxScore: 100 },
      ],
      results: [{
        studentId: 'a',
        scores: { 'item-1': 72, 'item-2': 84 },
        mentorComment: 'Practice <strong>daily</strong>.',
      }],
      createdAt: 1000,
    }],
    new Set(['a']),
    1000,
  )[0];
  const analysis = computeExamStudentAnalysis([exam], exam.id, 'a');
  assert.ok(analysis);

  const html = createExamReportHtml({
    className: 'Class <A>',
    studentName: '<script>alert(1)</script>',
    exam,
    analysis,
    lang: 'zh',
    itemIds: ['item-1'],
  });

  assert.match(html, /@page \{ size: A4 portrait;/);
  assert.match(html, /Progress &lt;Review&gt;/);
  assert.match(html, /Practice &lt;strong&gt;daily&lt;\/strong&gt;\./);
  assert.match(html, /Reading/);
  assert.doesNotMatch(html, /Writing/);
  assert.match(html, /<strong>1 \/ 2<\/strong>/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);

  const noItemRowsHtml = createExamReportHtml({
    className: 'Class A',
    studentName: 'Student A',
    exam,
    analysis,
    lang: 'zh',
    itemIds: [],
  });
  assert.doesNotMatch(noItemRowsHtml, /<h2>得分率<\/h2>/);
  assert.doesNotMatch(noItemRowsHtml, /Reading|Writing/);
  assert.match(noItemRowsHtml, /<strong>0 \/ 2<\/strong>/);
});

test('individual exam report independently scopes score and completed comment history', () => {
  const createHistoryExam = (
    id: string,
    title: string,
    examDate: string,
    score: number,
    mentorComment?: string,
  ) => ({
    id,
    title,
    examDate,
    items: [{ id: `${id}-math`, name: 'Math', maxScore: 100 }],
    results: [{
      studentId: 'a',
      scores: { [`${id}-math`]: score },
      mentorComment,
    }],
    createdAt: Date.parse(`${examDate}T00:00:00Z`),
  });
  const exams = normalizeExamRecords(
    [
      createHistoryExam('future', 'Future Assessment', '2026-08-01', 99, 'Future comment'),
      createHistoryExam('current', 'Current Assessment', '2026-07-01', 90, 'Current <comment>'),
      createHistoryExam('june', 'June Assessment', '2026-06-01', 80),
      createHistoryExam('may', 'May Assessment', '2026-05-01', 70, 'May comment'),
      createHistoryExam('april', 'April Assessment', '2026-04-01', 60, 'April comment'),
      createHistoryExam('march', 'March Assessment', '2026-03-01', 50, 'March comment'),
    ],
    new Set(['a']),
    Date.UTC(2026, 7, 2),
  );
  const currentExam = exams.find((exam) => exam.id === 'current');
  assert.ok(currentExam);
  const analysis = computeExamStudentAnalysis(exams, currentExam.id, 'a');
  assert.ok(analysis);

  const selection = getExamReportSelection({
    exams,
    exam: currentExam,
    analysis,
    scoreRange: 'recent3',
    commentRange: 'recent3',
  });
  assert.deepEqual(
    selection.scoreEntries.map((entry) => entry.exam.id),
    ['current', 'june', 'may'],
  );
  assert.deepEqual(
    selection.commentEntries.map((entry) => entry.exam.id),
    ['current', 'may', 'april'],
  );

  const scoreOnlyHtml = createExamReportHtml({
    className: 'Class A',
    studentName: 'Alpha',
    exam: currentExam,
    exams,
    analysis,
    lang: 'zh',
    scoreRange: 'recent3',
    commentRange: 'none',
  });
  assert.match(scoreOnlyHtml, /最近 3 次考試 \(3\)/);
  assert.match(scoreOnlyHtml, /June Assessment/);
  assert.match(scoreOnlyHtml, /May Assessment/);
  assert.doesNotMatch(scoreOnlyHtml, /Future Assessment/);
  assert.doesNotMatch(scoreOnlyHtml, /March Assessment/);
  assert.doesNotMatch(scoreOnlyHtml, /<h2>導師評語<\/h2>/);
  assert.doesNotMatch(scoreOnlyHtml, /Current &lt;comment&gt;/);

  const commentHistoryHtml = createExamReportHtml({
    className: 'Class A',
    studentName: 'Alpha',
    exam: currentExam,
    exams,
    analysis,
    lang: 'zh',
    scoreRange: 'current',
    commentRange: 'recent3',
  });
  assert.match(commentHistoryHtml, /最近 3 筆評語 \(3\)/);
  assert.match(commentHistoryHtml, /Current &lt;comment&gt;/);
  assert.match(commentHistoryHtml, /May comment/);
  assert.match(commentHistoryHtml, /April comment/);
  assert.doesNotMatch(commentHistoryHtml, /March comment/);
  assert.doesNotMatch(commentHistoryHtml, /Future comment/);
});

test('normalizeAppData preserves and sanitizes the economy event ledger', () => {
  const normalized = normalizeAppData({
    lastOpened: 2000,
    currentClassId: 'economy-class',
    classes: [{
      id: 'economy-class',
      name: 'Economy Class',
      students: [{
        ...createStudent('economy-student'),
        economyEventRecords: [{
          id: 'economy-record',
          kind: 'spend',
          source: 'upgrade',
          amount: -25.8,
          createdAt: 1900,
          referenceId: 'upgrade-1',
        }],
      }],
    }],
  }, 2000);

  assert.deepEqual(normalized.classes[0].students[0].economyEventRecords, [{
    id: 'economy-record',
    kind: 'spend',
    source: 'upgrade',
    amount: -25,
    createdAt: 1900,
    referenceId: 'upgrade-1',
    previousPetType: undefined,
    newPetType: undefined,
  }]);
});

test('bulk roster import appends once and preserves every existing pet field', () => {
  const existingStudent = {
    ...createStudent('existing', 'Alice'),
    points: 487,
    rankPoints: 73,
    pet: {
      type: 'dragon',
      fullness: 37,
      happiness: 64,
      level: 8,
      zeroFullnessSince: 1234,
    },
    badges: ['steady-growth'],
  };
  useStore.setState({
    data: normalizeAppData({
      lastOpened: 2000,
      currentClassId: 'class-roster',
      classes: [{
        id: 'class-roster',
        name: 'Roster Class',
        students: [existingStudent],
      }],
    }, 2000),
  });
  const before = structuredClone(useStore.getState().data.classes[0].students[0]);
  let dataMutations = 0;
  const unsubscribe = useStore.subscribe((state, previousState) => {
    if (state.data !== previousState.data) dataMutations += 1;
  });

  const added = useStore.getState().addStudentsByName([
    ' Alice ',
    'Ｂｏｂ',
    'Bob',
    '  Cara   Chen  ',
  ]);
  unsubscribe();

  const students = useStore.getState().data.classes[0].students;
  assert.equal(added, 2);
  assert.equal(dataMutations, 1);
  assert.deepEqual(students[0], before);
  assert.deepEqual(students.slice(1).map((student) => student.name), [
    'Bob',
    'Cara Chen',
  ]);
  for (const student of students.slice(1)) {
    assert.equal(student.points, 200);
    assert.deepEqual(student.pet, {
      type: 'egg',
      fullness: 80,
      happiness: 80,
      level: 1,
    });
  }
});

let failures = 0;

for (const entry of tests) {
  try {
    entry.run();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${entry.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exit(1);
}

console.log(`All ${tests.length} rule tests passed.`);
