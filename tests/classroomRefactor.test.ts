import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClassroomGoalMetrics,
  buildClassroomTeamSummaries,
  formatClassGoalWeekLabel,
  getClassroomBattleSettings,
  getEligibleBattleOpponents,
  sortStudentsByRank,
} from '../src/features/classroom/model/classroomModels';
import { getWeekStartDate } from '../src/gameRules';
import { createEnrolledStudent } from '../src/studentEnrollment';
import type { Student } from '../src/store/types';

const student = (
  id: string,
  overrides: Partial<Student> = {},
): Student => ({
  ...createEnrolledStudent({ id, name: id.toUpperCase() }),
  ...overrides,
  pet: {
    ...createEnrolledStudent({ id, name: id }).pet,
    ...overrides.pet,
  },
});

test('classroom battle settings preserve legacy cost fallback and explicit role overrides', () => {
  const settings = getClassroomBattleSettings({
    decayAmount: 5,
    decayType: 'hourly',
    battleMode: 'team',
    soloBattleFullnessCost: 14,
    soloBattleAttackerFullnessCost: 9,
    teamBattleMinFullnessEnabled: false,
    teamBattleMinFullness: 45,
  });

  assert.equal(settings.mode, 'team');
  assert.equal(settings.soloAttackerFullnessCost, 9);
  assert.equal(settings.soloDefenderFullnessCost, 14);
  assert.deepEqual(settings.teamReadyOptions, {
    minimumFullness: 45,
    ignoreFullness: true,
  });
});

test('classroom opponent model keeps solo, team and same-team eligibility rules', () => {
  const students = [
    student('alpha-one', { teamId: 'alpha' }),
    student('alpha-two', { teamId: 'alpha' }),
    student('beta-one', { teamId: 'beta' }),
    student('beta-two', { teamId: 'beta' }),
    student('solo'),
    student('tired', { pet: { type: 'egg', level: 1, fullness: 0, happiness: 80 } }),
  ];
  const base = getClassroomBattleSettings({ decayAmount: 5, decayType: 'hourly' });

  const solo = getEligibleBattleOpponents(
    students,
    'alpha-one',
    1_000,
    { ...base, mode: 'solo' },
  ).map(({ id }) => id);
  assert.deepEqual(solo, ['beta-one', 'beta-two', 'solo']);

  const team = getEligibleBattleOpponents(
    students,
    'alpha-one',
    1_000,
    { ...base, mode: 'team' },
  ).map(({ id }) => id);
  assert.deepEqual(team, ['beta-one', 'beta-two']);

  const both = getEligibleBattleOpponents(
    students,
    'alpha-one',
    1_000,
    { ...base, mode: 'both' },
  ).map(({ id }) => id);
  assert.deepEqual(both, ['beta-one', 'beta-two', 'solo']);
});

test('classroom team summaries aggregate once, respect max size, mask names and sort', () => {
  const students = [
    student('alpha-one', {
      name: 'Alpha One',
      teamId: 'alpha',
      rankPoints: 100,
      stats: { wins: 2, losses: 1 },
      pet: { type: 'egg', level: 2, fullness: 80, happiness: 80 },
    }),
    student('alpha-two', {
      name: 'Alpha Two',
      teamId: 'alpha',
      rankPoints: 50,
      stats: { wins: 1, losses: 2 },
      pet: { type: 'egg', level: 4, fullness: 80, happiness: 60 },
    }),
    student('alpha-extra', {
      name: 'Alpha Extra',
      teamId: 'alpha',
      rankPoints: 999,
    }),
    student('beta-one', { teamId: 'beta', rankPoints: 120 }),
    student('beta-two', { teamId: 'beta', rankPoints: 110 }),
    student('singleton', { teamId: 'single', rankPoints: 500 }),
  ];
  const battleSettings = getClassroomBattleSettings({
    decayAmount: 5,
    decayType: 'hourly',
    maxTeamSize: 2,
  });

  const summaries = buildClassroomTeamSummaries(
    students,
    1_000,
    battleSettings,
    (name) => `${name[0]}**`,
  );

  assert.deepEqual(summaries.map(({ id }) => id), ['beta', 'alpha']);
  const alpha = summaries[1];
  assert.ok(alpha);
  assert.equal(alpha.members.length, 2);
  assert.equal(alpha.name, 'A** / A**');
  assert.equal(alpha.totalRankPoints, 150);
  assert.equal(alpha.totalBattles, 6);
  assert.equal(alpha.wins, 3);
  assert.equal(alpha.losses, 3);
  assert.equal(alpha.winRate, 50);
  assert.equal(alpha.averageLevel, 3);
  assert.equal(alpha.readyMembers, 2);
  assert.equal(alpha.averageMood, 70);
});

test('classroom rank sorting does not mutate the persisted student order', () => {
  const students = [
    student('first', { rankPoints: 10 }),
    student('second', { rankPoints: 40 }),
  ];

  const sorted = sortStudentsByRank(students);
  assert.deepEqual(sorted.map(({ id }) => id), ['second', 'first']);
  assert.deepEqual(students.map(({ id }) => id), ['first', 'second']);
});

test('classroom goal model combines progress and coverage for the active week', () => {
  const now = Date.UTC(2026, 8, 10, 4);
  const first = student('first', {
    pointAdjustmentRecords: [{
      id: 'feedback',
      amount: 5,
      createdAt: now - 1_000,
      source: 'manual',
      competency: 'collaboration',
    }],
  });
  const goal = {
    id: 'goal',
    title: 'Work together',
    competency: 'collaboration' as const,
    targetCount: 2,
    createdAt: now - 10_000,
    weekStartDate: getWeekStartDate(now, 'Asia/Taipei'),
  };

  const metrics = buildClassroomGoalMetrics(
    [first, student('second')],
    [goal],
    [],
    now,
    'Asia/Taipei',
  );
  assert.equal(metrics[0]?.progress, 1);
  assert.deepEqual(metrics[0]?.coverage, {
    studentsReached: 1,
    totalStudents: 2,
    rate: 0.5,
  });

  const label = formatClassGoalWeekLabel(
    now,
    'Asia/Taipei',
    'en',
    '{start} – {end}',
  );
  assert.match(label, /^\d+\/\d+ – \d+\/\d+$/);
});
