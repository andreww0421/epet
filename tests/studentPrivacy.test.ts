import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anonymizeStudentInWorkspaceData,
  purgeStudentsFromWorkspaceData,
} from '../shared/domain/studentPrivacy';
import { PET_CATALOG } from '../src/domain/game/petCatalog';
import {
  getDailyTaskClaimPlan, getDailyTeacherPointTotals, hasActiveLevelDecreaseCooldown,
} from '../src/gameRules';
import type { AppData, Student } from '../src/store/types';

const now = Date.parse('2026-10-08T09:00:00Z');
const createData = (): AppData => {
  const student: Student = {
    id: 'private-student-id', name: 'Private learner', points: 201,
    rankPoints: 34, warningPoints: 1, activeWarningTimestamps: [now - 10],
    nextUpgradeGachaLevel: 5,
    pet: { type: 'dog', fullness: 74, happiness: 63, level: 3 },
    stats: { wins: 2, losses: 1 }, teamId: 'team-private-student-id',
    teammateId: 'other-student', badges: ['badgeFirstWin', 'Private learner'],
    penaltyStatus: { source: 'discipline', until: now + 60_000 },
    bossRecovery: { impact: 20, startedAt: now - 10, recoverAt: now + 1_000 },
    disciplineRecords: [
      { id: 'private-discipline', type: 'levelDecrease', createdAt: now - 5, reason: 'Private note' },
      { id: 'private-reversal', type: 'reversal', createdAt: now, reversesRecordId: 'private-discipline' },
    ],
    pointAdjustmentRecords: [
      { id: 'private-points', source: 'manual', amount: 12, createdAt: now,
        reasonId: 'Private reason ID', reasonLabel: 'Private reason', requestedAmount: 20 },
      { id: 'private-claim', source: 'dailyTask', amount: 5, createdAt: now,
        effectiveDate: '2026-10-08', claimKind: 'current' },
    ],
    economyEventRecords: [{ id: 'private-economy', kind: 'spend', source: 'feed',
      amount: 20, createdAt: now, referenceId: 'private-points', previousPetType: 'Private type' }],
    dailyProgress: { lastClaimDate: '2026-10-08', streak: 5, excusedDates: ['2026-10-07'],
      reflections: [{ id: 'private-reflection', competency: 'collaboration', author: 'mentor',
        mentorAssessment: 'progressing', date: '2026-10-08', createdAt: now, text: 'Private comment' }] },
  };
  Object.assign(student, { privateNote: 'Private extension' });
  Object.assign(student.pet, { privateNote: 'Private nested extension' });
  return {
    lastOpened: now, currentClassId: 'class-a',
    classes: [{ id: 'class-a', name: 'Class A', students: [student, {
      id: 'other-student', name: 'Other learner', points: 102,
      pet: { type: 'cat', fullness: 80, happiness: 70, level: 2 },
      teamId: student.teamId, teammateId: student.id,
      pointAdjustmentRecords: [{ id: 'other-points', amount: -3, createdAt: now,
        source: 'manual', reasonLabel: 'Other learner reason' }],
    }],
    learningEvidenceRecords: [{ id: 'private-evidence', classId: 'class-a', studentId: student.id,
      competency: 'participation', level: 'mastered', evidenceType: 'observation',
      title: 'Private evidence', actor: 'mentor', source: 'manual', rubricVersion: '1.0',
      revision: 1, createdAt: now }],
    examRecords: [{ id: 'exam-a', title: 'Exam', examDate: '2026-10-08',
      items: [{ id: 'math', name: 'Math', maxScore: 100 }], results: [
        { studentId: student.id, scores: { math: 91 }, mentorComment: 'Private exam note', updatedAt: now },
        { studentId: 'other-student', scores: { math: 76 }, mentorComment: 'Other exam note', updatedAt: now },
      ], createdAt: now, updatedAt: now }],
    activeBoss: { id: 'boss-a', name: 'Boss', maxHp: 100, currentHp: 60,
      rewardTiers: [], contributions: { [student.id]: 10, 'other-student': 30 },
      attackCounts: { [student.id]: 1, 'other-student': 3 }, isActive: true },
    }],
  };
};

test('de-identification removes linked content and free text without recalculating game values', () => {
  const original = createData();
  const before = structuredClone(original);
  const next = anonymizeStudentInWorkspaceData(original, 'private-student-id', 'anonymous-new-id');
  assert.deepEqual(original, before, 'domain operation must not mutate input');
  const student = next.classes[0].students[0];
  assert.equal(student.id, 'anonymous-new-id');
  assert.equal(student.name, 'Anonymous student');
  assert.equal(student.points, 201);
  assert.equal(student.rankPoints, 34);
  assert.deepEqual(student.pet, { type: 'dog', fullness: 74, happiness: 63, level: 3,
    isDead: undefined, zeroFullnessSince: undefined });
  assert.deepEqual(student.stats, original.classes[0].students[0].stats);
  assert.deepEqual(student.penaltyStatus, original.classes[0].students[0].penaltyStatus);
  assert.deepEqual(student.bossRecovery, original.classes[0].students[0].bossRecovery);
  const serialized = JSON.stringify(next);
  for (const secret of ['private-student-id', 'Private learner', 'Private note', 'Private reason',
    'Private comment', 'Private evidence', 'Private exam note', 'Private extension',
    'Private nested extension', 'Private type', 'private-points', 'private-reflection']) {
    assert.equal(serialized.includes(secret), false, `must remove ${secret}`);
  }
  assert.deepEqual(next.classes[0].learningEvidenceRecords, []);
  assert.deepEqual(next.classes[0].examRecords?.[0].results, original.classes[0].examRecords?.[0].results.slice(1));
});

test('de-identification preserves point limits, daily claim state, cooldown and reversal semantics', () => {
  const data = createData();
  const original = data.classes[0].students[0];
  const next = anonymizeStudentInWorkspaceData(data, original.id, 'anonymous-new-id').classes[0].students[0];
  assert.deepEqual(getDailyTeacherPointTotals(next, now), getDailyTeacherPointTotals(original, now));
  assert.deepEqual(getDailyTaskClaimPlan(next, now), getDailyTaskClaimPlan(original, now));
  assert.equal(hasActiveLevelDecreaseCooldown(next.disciplineRecords, now),
    hasActiveLevelDecreaseCooldown(original.disciplineRecords, now));
  assert.equal(next.disciplineRecords?.[1].reversesRecordId, next.disciplineRecords?.[0].id);
  assert.equal(next.economyEventRecords?.[0].referenceId, next.pointAdjustmentRecords?.[0].id);
});

test('de-identification preserves other learners and boss/team relationships under fresh identifiers', () => {
  const data = createData();
  const next = anonymizeStudentInWorkspaceData(data, 'private-student-id', 'anonymous-new-id');
  const classroom = next.classes[0];
  assert.deepEqual(classroom.students[1], {
    ...data.classes[0].students[1], teammateId: 'anonymous-new-id', teamId: 'anonymous-new-id-team-0',
  });
  assert.equal(classroom.students[0].teamId, classroom.students[1].teamId);
  assert.equal(classroom.activeBoss?.currentHp, 60);
  assert.deepEqual(classroom.activeBoss?.contributions, { 'anonymous-new-id': 10, 'other-student': 30 });
  assert.deepEqual(classroom.activeBoss?.attackCounts, { 'anonymous-new-id': 1, 'other-student': 3 });
});

test('privacy purge removes the student, linked content and identifying team references', () => {
  const data = createData();
  const purged = purgeStudentsFromWorkspaceData(data, new Set(['private-student-id']));
  assert.equal(purged.classes[0].students.length, 1);
  assert.equal(purged.classes[0].students[0].points, 102);
  assert.equal(purged.classes[0].students[0].teammateId, undefined);
  assert.equal(JSON.stringify(purged).includes('private-student-id'), false);
  assert.equal(purged.classes[0].activeBoss?.contributions['other-student'], 30);
});

test('anonymization rejects identifier reuse or collision', () => {
  const data = createData();
  for (const replacement of ['', 'private-student-id', 'other-student']) {
    assert.throws(() => anonymizeStudentInWorkspaceData(data, 'private-student-id', replacement),
      /Invalid replacement student identifier/);
  }
});

test('pure pet catalog keeps every existing pet identifier, rarity and order', () => {
  assert.deepEqual(PET_CATALOG.map((pet) => `${pet.id}:${pet.rarity}`), [
    'egg:common', 'dog:common', 'cat:common', 'bird:common', 'rabbit:common',
    'turtle:common', 'fish:common', 'snail:common', 'bug:common', 'rat:common',
    'worm:common', 'squirrel:rare', 'piggybank:rare', 'pawprint:rare', 'ghost:legendary', 'bot:legendary',
  ]);
});
