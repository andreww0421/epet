import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClassroomPresentation,
  type ClassroomPresentationOptions,
} from '../src/features/classroom/model/classroomPresentation';
import { sortStudentsByRank } from '../src/features/classroom/model/classroomModels';
import { createEnrolledStudent } from '../src/studentEnrollment';
import { getPublicStudentName } from '../src/studentPresentation';
import type { AppData, ClassData, Student } from '../src/store/types';

const PRIVATE_CANARY = 'SYNTHETIC_PRIVATE_DO_NOT_PROJECT';
const presentationOptions: ClassroomPresentationOptions = {
  maskNames: true,
  inclusiveLeaderboard: true,
};
const settings = (overrides: Partial<NonNullable<AppData['settings']>> = {}): NonNullable<AppData['settings']> => ({
  decayAmount: 5,
  decayType: 'hourly',
  ...overrides,
});
const student = (id: string, name: string, overrides: Partial<Student> = {}): Student => ({
  ...createEnrolledStudent({ id, name }),
  ...overrides,
});
const classroom = (students: Student[]): ClassData => ({
  id: 'synthetic-class',
  name: 'Synthetic classroom',
  students,
});
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

test('presentation defaults are masked and fail closed when workspace public policy is missing', () => {
  const source = classroom([student('first', 'Synthetic Full Name')]);
  const model = buildClassroomPresentation(source, undefined, {
    maskNames: false,
    inclusiveLeaderboard: false,
  });

  assert.equal(model.language, 'zh');
  assert.equal(model.students[0]?.displayName, getPublicStudentName(source.students[0].name));
  assert.deepEqual(model.leaderboard, { mode: 'hidden', students: [] });
  assert.equal(model.boss, null);
  assert.deepEqual(Object.keys(model).sort(), ['boss', 'language', 'leaderboard', 'students']);
  assert.deepEqual(Object.keys(model.students[0]).sort(), ['displayName', 'level', 'petType']);
});

test('local presentation options cannot unmask a workspace masked-name or inclusive policy', () => {
  const source = classroom([student('first', 'Synthetic Full Name')]);
  const local = { maskNames: false, inclusiveLeaderboard: false };

  for (const policy of [
    settings({ publicNameMode: 'masked', inclusiveMode: false, publicLeaderboardMode: 'rank' }),
    settings({ publicNameMode: 'full', inclusiveMode: true, publicLeaderboardMode: 'rank' }),
    settings({ publicNameMode: 'full', publicLeaderboardMode: 'rank' }),
  ]) {
    const model = buildClassroomPresentation(source, policy, local);
    assert.equal(model.students[0]?.displayName, getPublicStudentName(source.students[0].name));
  }
});

test('full names require explicit workspace permission and a deliberate local opt-out of masking', () => {
  const source = classroom([student('first', 'Synthetic Full Name')]);
  const policy = settings({ publicNameMode: 'full', inclusiveMode: false, publicLeaderboardMode: 'growth' });

  const defaultPresentation = buildClassroomPresentation(source, policy, presentationOptions);
  assert.equal(defaultPresentation.students[0]?.displayName, getPublicStudentName(source.students[0].name));
  const explicit = buildClassroomPresentation(source, policy, { maskNames: false, inclusiveLeaderboard: false });
  assert.equal(explicit.students[0]?.displayName, source.students[0].name);
});

test('masking uses the canonical Unicode and multipart name presentation, not a second implementation', () => {
  const names = ['陳小明', 'A', '👩🏽‍🚀 星辰', '  Ana María  ', ''];
  const source = classroom(names.map((name, index) => student(`synthetic-${index}`, name)));
  const model = buildClassroomPresentation(source, settings({ publicNameMode: 'full', inclusiveMode: false }), presentationOptions);

  assert.deepEqual(model.students.map((item) => item.displayName), names.map((name) => getPublicStudentName(name) || '學生'));
  const english = buildClassroomPresentation(source, settings({ language: 'en' }), presentationOptions);
  assert.equal(english.students.at(-1)?.displayName, 'Learner');
});

test('a hidden workspace leaderboard cannot be enabled by local presentation controls', () => {
  const source = classroom([student('first', 'Synthetic Full Name', { rankPoints: 900 })]);

  for (const inclusiveLeaderboard of [true, false]) {
    const model = buildClassroomPresentation(source, settings({
      publicLeaderboardMode: 'hidden', inclusiveMode: false,
    }), { maskNames: true, inclusiveLeaderboard });
    assert.deepEqual(model.leaderboard, { mode: 'hidden', students: [] });
    assert.equal('rankPoints' in model.students[0], false);
  }
});

test('inclusive presentation celebrates the whole roster in original order without individual rank or negative metrics', () => {
  const source = classroom([
    student('first', 'Synthetic First Learner', { rankPoints: 1, points: -50, warningPoints: 7, stats: { wins: 0, losses: 99 } }),
    student('second', 'Synthetic Second Learner', { rankPoints: 900, points: 300 }),
    student('third', 'Synthetic Third Learner', { rankPoints: 3 }),
  ]);
  const model = buildClassroomPresentation(source, settings({
    publicLeaderboardMode: 'rank', inclusiveMode: false,
  }), presentationOptions);

  assert.equal(model.leaderboard.mode, 'inclusive');
  assert.equal(model.leaderboard.students.length, source.students.length);
  assert.deepEqual(model.leaderboard.students.map((item) => item.displayName), source.students.map((item) => getPublicStudentName(item.name)));
  for (const item of [...model.students, ...model.leaderboard.students]) {
    assert.deepEqual(Object.keys(item).sort(), ['displayName', 'level', 'petType']);
  }
});

test('workspace growth mode becomes an inclusive game-only roster, never learning analytics', () => {
  const source = classroom([student('first', 'Synthetic First Learner')]);
  const model = buildClassroomPresentation(source, settings({
    publicLeaderboardMode: 'growth', inclusiveMode: false,
  }), { maskNames: true, inclusiveLeaderboard: false });

  assert.equal(model.leaderboard.mode, 'inclusive');
  assert.deepEqual(model.leaderboard.students, model.students);
  assert.equal('rankPoints' in model.leaderboard.students[0], false);
});

test('competitive ranking requires explicit global and local permission and reuses canonical sorting', () => {
  const source = classroom([
    student('first', 'Synthetic First Learner', { rankPoints: 20, stats: { wins: 2, losses: 9 } }),
    student('second', 'Synthetic Second Learner', { rankPoints: 40 }),
    student('third', 'Synthetic Third Learner', { rankPoints: 20 }),
  ]);
  const policy = settings({ publicNameMode: 'full', publicLeaderboardMode: 'rank', inclusiveMode: false });
  const model = buildClassroomPresentation(source, policy, { maskNames: false, inclusiveLeaderboard: false });

  assert.equal(model.leaderboard.mode, 'rank');
  assert.deepEqual(model.leaderboard.students.map((item) => item.displayName), sortStudentsByRank(source.students).map((item) => item.name));
  assert.deepEqual(model.leaderboard.students.map((item) => item.rankPoints), [40, 20, 20]);
  assert.deepEqual(model.students.map((item) => item.displayName), source.students.map((item) => item.name));
  for (const item of model.leaderboard.students) {
    assert.deepEqual(Object.keys(item).sort(), ['displayName', 'level', 'petType', 'rankPoints']);
  }
  assert.deepEqual(source.students.map((item) => item.id), ['first', 'second', 'third']);
});

test('allowlisted projection cannot serialize private notes, education, audit, account or arbitrary freeform data', () => {
  const privateStudent: Student & { privateNote: string; account: { email: string } } = {
    ...student('first', 'Synthetic Full Learner'),
    privateNote: PRIVATE_CANARY,
    account: { email: `${PRIVATE_CANARY}@example.invalid` },
    points: -34,
    warningPoints: 9,
    penaltyStatus: { source: 'discipline', until: 999_999 },
    disciplineRecords: [{ id: 'audit', type: 'discipline', reason: PRIVATE_CANARY, createdAt: 1 }],
    pointAdjustmentRecords: [{ id: 'points', amount: -15, reasonLabel: PRIVATE_CANARY, source: 'manual', competency: 'participation', createdAt: 1 }],
    dailyProgress: { streak: 0, reflections: [{ id: 'mentor-note', author: 'mentor', date: '2026-10-03', text: PRIVATE_CANARY, competency: 'participation', mentorAssessment: 'needsSupport', createdAt: 1 }] },
    badges: [PRIVATE_CANARY],
    bossRecovery: { impact: 40, startedAt: 1, recoverAt: 99 },
  };
  const source: ClassData & { workspaceAdministration: { audit: string } } = {
    ...classroom([privateStudent]),
    name: PRIVATE_CANARY,
    workspaceAdministration: { audit: PRIVATE_CANARY },
    classGoals: [{ id: 'goal', title: PRIVATE_CANARY, targetCount: 5, competency: 'participation', createdAt: 1 }],
    learningEvidenceRecords: [{ id: 'evidence', classId: 'synthetic-class', studentId: 'first', title: PRIVATE_CANARY, note: PRIVATE_CANARY, competency: 'participation', level: 'needsSupport', evidenceType: 'observation', actor: 'mentor', source: 'manual', rubricVersion: 'v1', revision: 1, createdAt: 1 }],
    examRecords: [{ id: 'exam', title: PRIVATE_CANARY, examDate: '2026-10-03', items: [{ id: 'item', name: PRIVATE_CANARY, maxScore: 100 }], results: [{ studentId: 'first', scores: { item: 8 }, mentorComment: PRIVATE_CANARY, updatedAt: 1 }], createdAt: 1, updatedAt: 1 }],
    activeBoss: { id: PRIVATE_CANARY, name: PRIVATE_CANARY, maxHp: 100, currentHp: 42, isActive: true, rewardTiers: [], contributions: { [PRIVATE_CANARY]: 20 }, attackCounts: { [PRIVATE_CANARY]: 5 } },
  };
  const policy = settings({ publicLeaderboardMode: 'rank', inclusiveMode: false, publicNameMode: 'masked', feedbackReasonHistory: [{ label: PRIVATE_CANARY, competency: 'participation' }] });
  const original = structuredClone(source);
  const model = buildClassroomPresentation(deepFreeze(source), deepFreeze(policy), { maskNames: true, inclusiveLeaderboard: false });
  const serialized = JSON.stringify(model);

  assert.equal(serialized.includes(PRIVATE_CANARY), false);
  assert.equal(serialized.includes(privateStudent.name), false);
  for (const forbiddenField of ['studentId', 'id', 'points', 'warningPoints', 'penaltyStatus', 'disciplineRecords', 'pointAdjustmentRecords', 'dailyProgress', 'badges', 'bossRecovery', 'classGoals', 'learningEvidenceRecords', 'examRecords', 'workspaceAdministration', 'privateNote', 'account', 'contributions', 'attackCounts', 'name']) {
    assert.equal(serialized.includes(`"${forbiddenField}":`), false, `${forbiddenField} must remain outside the projection DTO`);
  }
  assert.deepEqual(model.boss, { hp: 42, maxHp: 100 });
  assert.deepEqual(Object.keys(model.boss).sort(), ['hp', 'maxHp']);
  assert.deepEqual(source, original);
  assert.notEqual(model.students, source.students);
  assert.notEqual(model.students[0], source.students[0]);
});

test('unknown pet identifiers cannot smuggle freeform text into public presentation', () => {
  const invalidPetTypes = [PRIVATE_CANARY, '__proto__', 'constructor', 'toString'];
  const source = classroom(invalidPetTypes.map((type, index) => student(`synthetic-${index}`, 'Synthetic Learner', {
    pet: { type, level: 3, fullness: 80, happiness: 80 },
  })));
  const model = buildClassroomPresentation(source, undefined, presentationOptions);

  assert.deepEqual(model.students.map((item) => item.petType), invalidPetTypes.map(() => 'egg'));
  assert.deepEqual(model.students.map((item) => item.level), invalidPetTypes.map(() => 3));
  assert.equal(JSON.stringify(model).includes(PRIVATE_CANARY), false);
  assert.equal(source.students[0].pet.type, PRIVATE_CANARY);
});

test('public numeric normalization is display-only and cannot alter stored game values', () => {
  const levels = [3.9, -1, Number.NaN, Number.POSITIVE_INFINITY];
  const source = classroom(levels.map((level, index) => student(`synthetic-${index}`, 'Synthetic Learner', {
    pet: { type: 'egg', level, fullness: 80, happiness: 80 },
    rankPoints: index === 0 ? -9 : index === 1 ? Number.NaN : index === 2 ? Number.POSITIVE_INFINITY : undefined,
  })));
  const original = structuredClone(source);
  const model = buildClassroomPresentation(deepFreeze(source), settings({
    publicLeaderboardMode: 'rank', inclusiveMode: false,
  }), { maskNames: true, inclusiveLeaderboard: false });

  assert.deepEqual(model.students.map((item) => item.level), [3, 1, 1, 1]);
  assert.deepEqual(model.students.map((item) => item.rankPoints), [-9, 0, 0, 0]);
  assert.equal(model.leaderboard.students.every((item) => Number.isFinite(item.rankPoints)), true);
  assert.deepEqual(source, original);
});

test('unknown persisted leaderboard values fail closed rather than becoming competitive rank', () => {
  // Exercise malformed historical input at runtime without relaxing production types.
  const invalidPolicy = { ...settings({ inclusiveMode: false }), publicLeaderboardMode: 'unexpected' } as unknown as NonNullable<AppData['settings']>;
  const model = buildClassroomPresentation(classroom([student('first', 'Synthetic Learner')]), invalidPolicy, {
    maskNames: false, inclusiveLeaderboard: false,
  });

  assert.deepEqual(model.leaderboard, { mode: 'hidden', students: [] });
  assert.equal('rankPoints' in model.students[0], false);
});

test('boss presentation excludes inactive or malformed bosses and only clamps visible HP, never persisted state', () => {
  const source = classroom([]);
  const base = { id: 'boss', name: PRIVATE_CANARY, maxHp: 100, currentHp: 150, isActive: true, rewardTiers: [], contributions: {} };
  source.activeBoss = base;
  assert.deepEqual(buildClassroomPresentation(source, undefined, presentationOptions).boss, { hp: 100, maxHp: 100 });
  assert.equal(source.activeBoss.currentHp, 150);
  source.activeBoss = { ...base, currentHp: -10 };
  assert.deepEqual(buildClassroomPresentation(source, undefined, presentationOptions).boss, { hp: 0, maxHp: 100 });

  for (const boss of [
    { ...base, isActive: false },
    { ...base, maxHp: 0 },
    { ...base, maxHp: Number.NaN },
    { ...base, currentHp: Number.POSITIVE_INFINITY },
  ]) {
    source.activeBoss = boss;
    assert.equal(buildClassroomPresentation(source, undefined, presentationOptions).boss, null);
  }
});

test('missing and empty classrooms have a safe name-free presentation model', () => {
  for (const source of [undefined, classroom([])]) {
    const model = buildClassroomPresentation(source, settings({ language: 'en', publicLeaderboardMode: 'growth' }), presentationOptions);
    assert.equal(model.language, 'en');
    assert.deepEqual(model.students, []);
    assert.deepEqual(model.leaderboard.students, []);
    assert.equal(model.boss, null);
  }
});
