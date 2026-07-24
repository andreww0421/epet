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
  createPenaltyStatus,
  createPointAdjustmentRecord,
  resolveBattle,
  resolveBossAttack,
  resolveSharedBossAttack,
  resolveTeamBattle,
  reviveStudentPet,
} from '../src/gameRules.js';
import { computeBadges, normalizeAppData } from '../src/store/utils.js';
import {
  getClassGoalProgress,
  getWeeklyEducationInsights,
} from '../src/educationInsights.js';

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
  dailyProgress: {
    streak: 0,
  },
  lastBossDamage: undefined as number | undefined,
});

const createBoss = () => ({
  id: 'boss-1',
  name: 'Training Boss',
  maxHp: 100,
  currentHp: 100,
  rewardTiers: [
    { rank: 1, points: 50, happiness: 10 },
    { rank: 2, points: 30, happiness: 5 },
  ],
  contributions: {},
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

test('applyBossContributionRewards ranks damage and applies each configured reward tier', () => {
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
    result.standings.map(({ studentId, rank, rewardPoints, rewardHappiness }) => ({ studentId, rank, rewardPoints, rewardHappiness })),
    [
      { studentId: 'b', rank: 1, rewardPoints: 60, rewardHappiness: 15 },
      { studentId: 'a', rank: 2, rewardPoints: 40, rewardHappiness: 10 },
      { studentId: 'c', rank: 3, rewardPoints: 10, rewardHappiness: 5 },
    ],
  );
  assert.equal(result.students.find((student) => student.id === 'b')?.points, 260);
  assert.equal(result.students.find((student) => student.id === 'a')?.points, 240);
  assert.equal(result.students.find((student) => student.id === 'c')?.points, 210);
  assert.equal(result.students.find((student) => student.id === 'b')?.lastBossDamage, 90);
});

test('applyBossContributionRewards adds improvement rewards only after a better result', () => {
  const students = [
    { ...createStudent('a', 'Alpha'), lastBossDamage: 40 },
    { ...createStudent('b', 'Beta'), lastBossDamage: 90 },
  ];
  const boss = {
    ...createBoss(),
    participationReward: { points: 5, happiness: 2 },
    improvementReward: { points: 12, happiness: 4 },
    contributions: { a: 60, b: 80 },
  };
  const result = applyBossContributionRewards(students, boss, 2000, 700);
  const alpha = result.standings.find((standing) => standing.studentId === 'a');
  const beta = result.standings.find((standing) => standing.studentId === 'b');

  assert.equal(alpha?.receivedImprovementReward, true);
  assert.equal(alpha?.improvementRewardPoints, 12);
  assert.equal(beta?.receivedImprovementReward, false);
  assert.equal(beta?.improvementRewardPoints, 0);
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

  const insights = getWeeklyEducationInsights(students, now);
  assert.equal(insights.positiveCount, 1);
  assert.equal(insights.negativeCount, 1);
  assert.equal(insights.competencyCounts.collaboration, 1);
  assert.equal(insights.collaborationStudents, 1);
  assert.deepEqual(insights.overlookedStudents, [{ id: 'c', name: 'Gamma' }]);
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
    rewardTiers: [{ rank: 1, points: 0, happiness: 12 }],
    participationReward: { points: 10, happiness: 5 },
    improvementReward: { points: 15, happiness: 5 },
    contributions: {},
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
