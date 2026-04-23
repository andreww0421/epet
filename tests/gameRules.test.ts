import assert from 'node:assert/strict';

import {
  PET_DEATH_DELAY_MS,
  REVIVE_COST,
  applyDecayToStudent,
  applyFeedToStudent,
  claimDailyTaskForStudent,
  createPenaltyStatus,
  resolveBattle,
  resolveTeamBattle,
  reviveStudentPet,
} from '../src/gameRules.js';

const tests: Array<{ name: string; run: () => void }> = [];

const test = (name: string, run: () => void) => {
  tests.push({ name, run });
};

const createStudent = () => ({
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
