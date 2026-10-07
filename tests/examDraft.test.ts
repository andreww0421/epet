import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExamRecord } from '../src/store/types';
import {
  cloneExam,
  createExamDraft,
  createSafeExamFilenameSegment,
  formatExamDelta,
  formatExamPercent,
  getStudentResult,
  hasExamScore,
  upsertStudentResult,
} from '../src/features/exams/model/examDraft';

const examFixture = (): ExamRecord => ({
  id: 'exam-1',
  title: 'Midterm',
  examDate: '2026-09-12',
  items: [{ id: 'item-1', name: 'Reading', maxScore: 100 }],
  results: [{
    studentId: 'student-1',
    scores: { 'item-1': 80 },
    updatedAt: 10,
  }],
  createdAt: 1,
  updatedAt: 10,
});

test('exam drafts keep localized defaults outside the React panel', () => {
  const draft = createExamDraft('zh', 3);
  assert.equal(draft.title, '第 3 次考試');
  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0]?.name, '項目 1');
  assert.equal(draft.items[0]?.maxScore, 100);
  assert.deepEqual(draft.results, []);
});

test('exam clone and result upsert do not mutate stored records', () => {
  const original = examFixture();
  const cloned = cloneExam(original);
  cloned.items[0]!.name = 'Changed';
  cloned.results[0]!.scores['item-1'] = 90;
  assert.equal(original.items[0]?.name, 'Reading');
  assert.equal(original.results[0]?.scores['item-1'], 80);

  const updated = upsertStudentResult(original, 'student-1', (result) => ({
    ...result,
    scores: { ...result.scores, 'item-1': 95 },
    updatedAt: 20,
  }));
  assert.equal(getStudentResult(updated, 'student-1')?.scores['item-1'], 95);
  assert.equal(getStudentResult(original, 'student-1')?.scores['item-1'], 80);

  const appended = upsertStudentResult(original, 'student-2', (result) => ({
    ...result,
    scores: { 'item-1': 70 },
  }));
  assert.equal(appended.results.length, 2);
  assert.equal(getStudentResult(appended, 'student-2')?.scores['item-1'], 70);
});

test('exam display and filename helpers keep prior edge-case behavior', () => {
  assert.equal(formatExamPercent(null), '-');
  assert.equal(formatExamPercent(84.6), '85%');
  assert.equal(formatExamDelta(2), '+2.0%');
  assert.equal(formatExamDelta(-1.25), '-1.3%');
  assert.equal(hasExamScore(0), true);
  assert.equal(hasExamScore(undefined), false);
  assert.equal(
    createSafeExamFilenameSegment('  A/B: C  ', 'assessment'),
    'A-B-_C',
  );
  assert.equal(createSafeExamFilenameSegment('***', 'assessment'), 'assessment');
});
