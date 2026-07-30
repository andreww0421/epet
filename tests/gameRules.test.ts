import assert from 'node:assert/strict';

import {
  PET_DEATH_DELAY_MS,
  REVIVE_COST,
  applyDecayToStudent,
  applyBossContributionRewards,
  applyFeedToStudent,
  applyPointAdjustmentToStudent,
  attackWorldBoss,
  claimDailyTaskForStudent,
  createAutomatedBossRewardTier,
  createPenaltyStatus,
  createPointAdjustmentRecord,
  getBossContributionStandings,
  recalculateBossRewardTiers,
  resolveBattle,
  resolveBossAttack,
  resolveSharedBossAttack,
  resolveTeamBattle,
  reviveStudentPet,
  saveMentorDailyFeedbackForStudent,
  type BossRewardRecord,
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
import { createExamReportHtml } from '../src/examReport.js';

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
const { useStore } = await import('../src/store/useStore.js');

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
  },
  stats: {
    wins: 0,
    losses: 0,
  },
  nextUpgradeGachaLevel: 4,
  disciplineRecords: [],
  pointAdjustmentRecords: [],
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
});

test('claimDailyTaskForStudent grants reward once per day and grows streak', () => {
  const first = claimDailyTaskForStudent(createStudent(), Date.UTC(2026, 2, 29, 1, 0, 0));

  assert.equal(first.claimed, true);
  assert.equal(first.rewardPoints, 30);
  assert.equal(first.student.points, 230);
  assert.equal(first.student.dailyProgress?.streak, 1);

  const secondSameDay = claimDailyTaskForStudent(first.student, Date.UTC(2026, 2, 29, 8, 0, 0));
  assert.equal(secondSameDay.claimed, false);

  const nextDay = claimDailyTaskForStudent(first.student, Date.UTC(2026, 2, 30, 1, 0, 0));
  assert.equal(nextDay.claimed, true);
  assert.equal(nextDay.rewardPoints, 35);
  assert.equal(nextDay.student.dailyProgress?.streak, 2);
});

test('daily task stores a homework reward without creating a student self-assessment', () => {
  const now = Date.UTC(2026, 6, 28, 2, 0, 0);
  const result = claimDailyTaskForStudent(
    createStudent('a', 'Alpha'),
    now,
    700,
    'Homework Completion Task',
  );

  assert.equal(result.claimed, true);
  assert.deepEqual(result.student.dailyProgress?.reflections, undefined);
  assert.deepEqual(result.student.pointAdjustmentRecords?.[0], {
    id: result.student.pointAdjustmentRecords?.[0].id,
    amount: 30,
    createdAt: now,
    source: 'dailyTask',
    reasonId: 'daily-homework',
    reasonLabel: 'Homework Completion Task',
    competency: 'assignmentQuality',
  });

  const insights = getWeeklyEducationInsights([result.student], now);
  assert.equal(insights.reflectionCount, 0);
  assert.equal(insights.competencyCounts.assignmentQuality, 1);
});

test('mentor daily feedback creates and then updates one record for the same day', () => {
  const now = Date.UTC(2026, 6, 28, 2, 0, 0);
  const claimed = claimDailyTaskForStudent(
    createStudent('a', 'Alpha'),
    now,
    700,
    'Homework Completion Task',
  );
  assert.equal(claimed.claimed, true);
  const first = saveMentorDailyFeedbackForStudent(
    claimed.student,
    {
      competency: 'growth',
      assessment: 'needsSupport',
      text: 'Can explain the first step but needs help checking the answer.',
    },
    now,
  );

  assert.equal(first.saved, true);
  assert.equal(first.updated, false);
  assert.equal(first.student.points, 230);
  assert.equal(first.student.dailyProgress?.lastClaimDate, '2026-07-28');
  assert.equal(first.student.dailyProgress?.streak, 1);
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
  assert.equal(second.student.points, 230);
  assert.equal(second.student.dailyProgress?.lastClaimDate, '2026-07-28');
  assert.equal(second.student.dailyProgress?.streak, 1);
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
  assert.equal(normalized.settings?.bossAttackMode, 'shared');
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
  assert.equal(inclusive.settings?.bossAttackMode, 'shared');

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
      feedbackReasonHistory: ['主動協助', '主動協助', '  Task complete  ', 'task complete'],
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
  assert.deepEqual(normalized.settings?.feedbackReasonHistory, ['主動協助', 'Task complete']);
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
    settings: { maxPoints: 100 },
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
    ['Team feedback'],
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
      items: [{ id: 'item-1', name: 'Reading', maxScore: 100 }],
      results: [{
        studentId: 'a',
        scores: { 'item-1': 72 },
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
  });

  assert.match(html, /@page \{ size: A4 portrait;/);
  assert.match(html, /Progress &lt;Review&gt;/);
  assert.match(html, /Practice &lt;strong&gt;daily&lt;\/strong&gt;\./);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
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
