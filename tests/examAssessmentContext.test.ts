import assert from 'node:assert/strict';
import test from 'node:test';
import { createExamAssessmentContextSelector } from '../src/features/exams/model/examAssessmentContext';
import { createEnrolledStudent } from '../src/studentEnrollment';
import type { AppData, ExamRecord } from '../src/store/types';

const exam = (id: string): ExamRecord => ({ id, title: id, examDate: '2026-11-15',
  items: [{ id: 'math', name: 'Math', maxScore: 100 }],
  results: [{ studentId: '100', scores: { math: 80 }, updatedAt: 1 }], createdAt: 1, updatedAt: 1 });
const fixture = (): AppData => ({ lastOpened: 1, currentClassId: 'A', classes: [
  { id: 'A', name: 'Synthetic A', students: [createEnrolledStudent({ id: '100', name: 'Alice' }),
    createEnrolledStudent({ id: '200', name: 'Ann' })], examRecords: [exam('a-exam')] },
  { id: 'B', name: 'Synthetic B', students: [createEnrolledStudent({ id: '100', name: 'Bob' })], examRecords: [exam('b-exam')] },
] });

test('exam context preserves reference on points, pets, feedback, goals, boss and unrelated-class changes', () => {
  const data = fixture();
  const selector = createExamAssessmentContextSelector();
  const first = selector(data, 1)!;
  const changed: AppData = { ...data, classes: data.classes.map(classroom => ({ ...classroom,
    students: classroom.students.map(student => ({ ...student, points: student.points + 1,
      pet: { ...student.pet, fullness: 10 }, dailyProgress: { streak: 8 } })),
    classGoals: [], learningEvidenceRecords: [],
    activeBoss: { id: 'boss', name: 'Boss', maxHp: 100, currentHp: 90, isActive: true,
      rewardTiers: [], contributions: {} },
  })) };
  assert.equal(selector(changed, 1), first);
  assert.deepEqual(first.students, [{ id: '100', name: 'Alice' }, { id: '200', name: 'Ann' }]);
  assert.deepEqual(Object.keys(first).sort(), ['examRecords', 'id', 'name', 'students']);
  assert.deepEqual(Object.keys(first.students[0]).sort(), ['id', 'name']);
});

test('exam context invalidates for roster rename, reorder, additions and removals', () => {
  const original = fixture();
  for (const students of [
    original.classes[0].students.map((student, index) => index === 0 ? { ...student, name: 'Renamed' } : student),
    [...original.classes[0].students].reverse(),
    [...original.classes[0].students, createEnrolledStudent({ id: '300', name: 'Additional' })],
    original.classes[0].students.slice(1),
  ]) {
    const selector = createExamAssessmentContextSelector('A');
    const first = selector(original, 1)!;
    const next = selector({ ...original, classes: [{ ...original.classes[0], students }, original.classes[1]] }, 1)!;
    assert.notEqual(next, first);
    assert.notEqual(next.students, first.students);
    assert.deepEqual(next.students, students.map(({ id, name }) => ({ id, name })));
  }
});

test('exam context reacts to class metadata and exam changes while reusing unchanged roster', () => {
  const data = fixture();
  const selector = createExamAssessmentContextSelector('A');
  const first = selector(data, 1)!;
  const renamed = selector({ ...data, classes: [{ ...data.classes[0], name: 'Renamed class' }] }, 1)!;
  assert.notEqual(renamed, first);
  assert.equal(renamed.name, 'Renamed class');
  assert.equal(renamed.students, first.students);
  const updated = [{ ...data.classes[0].examRecords![0], updatedAt: 2 }];
  const next = selector({ ...data, classes: [{ ...data.classes[0], name: 'Renamed class', examRecords: updated }] }, 1)!;
  assert.notEqual(next, renamed);
  assert.equal(next.students, renamed.students);
  assert.equal(next.examRecords, updated);
});

test('same student IDs across classes never share cached roster or exams', () => {
  const data = fixture();
  const selector = createExamAssessmentContextSelector();
  const alice = selector(data, 1)!;
  const bob = selector({ ...data, currentClassId: 'B' }, 1)!;
  assert.notEqual(bob, alice);
  assert.deepEqual(bob.students, [{ id: '100', name: 'Bob' }]);
  assert.equal(bob.examRecords[0].id, 'b-exam');
  assert.notEqual(selector(data, 1), alice);
  const fixed = createExamAssessmentContextSelector('A');
  assert.equal(fixed({ ...data, currentClassId: 'B' }, 1)?.id, 'A');
});

test('session and membership resets clear context identity even when data values match', () => {
  const data = fixture();
  const selector = createExamAssessmentContextSelector();
  const previous = selector(data, 1)!;
  const reset = selector(data, 2)!;
  assert.notEqual(reset, previous);
  assert.notEqual(reset.students, previous.students);
  assert.deepEqual(reset.students, previous.students);
  assert.equal(selector(data, 2), reset);
});

test('missing classes clear cached learners and separate panel instances never share cache', () => {
  const data = fixture();
  const selector = createExamAssessmentContextSelector('A');
  const previous = selector(data, 1)!;
  assert.equal(selector({ ...data, classes: [] }, 1), undefined);
  assert.notEqual(selector(data, 1), previous);
  const other = createExamAssessmentContextSelector('A');
  assert.notEqual(other(data, 1), selector(data, 1));
});
