import assert from 'node:assert/strict';
import test from 'node:test';
import { computeExamStudentAnalysis } from '../src/examAnalytics';
import { getExamReportSelection } from '../src/examReport';
import { getExamAssessmentCopy } from '../src/features/exams/model/examAssessmentCopy';
import { buildExamAssessmentModel, buildExamReportModel } from '../src/features/exams/model/examAssessmentModel';
import type { ExamRecord } from '../src/store/types';

const fixture = (): ExamRecord => ({ id: 'current', title: 'Synthetic assessment', examDate: '2026-11-15',
  items: [{ id: 'reading', name: 'Reading', maxScore: 100 }, { id: 'writing', name: 'Writing', maxScore: 40 }],
  results: [
    { studentId: 'alice', scores: { reading: 0, writing: 20 }, mentorComment: 'Current synthetic comment', updatedAt: 2 },
    { studentId: 'bob', scores: { reading: 90 }, updatedAt: 2 },
  ], createdAt: 2, updatedAt: 2 });
const students = [{ id: 'alice', name: 'Synthetic Alice' }, { id: 'bob', name: 'Synthetic Bob' }];
const build = (draft = fixture(), exams: ExamRecord[] = [draft], extra = {}) => buildExamAssessmentModel({
  draft, exams, students, selectedStudentId: 'alice', isDirty: false, readOnly: false, ...extra,
});

test('exam presentation counts zero as entered and preserves incomplete/missing score semantics', () => {
  const model = build();
  assert.equal(model.enteredScoreCount, 3);
  assert.equal(model.totalScoreCount, 4);
  assert.equal(model.completedStudentCount, 1);
  assert.equal(model.isPendingSave, false);
  const draft = fixture();
  draft.results[0].scores.reading = Number.NaN;
  assert.equal(build(draft).enteredScoreCount, 2);
  assert.equal(build(draft).completedStudentCount, 0);
});

test('draft validation keeps existing trim/case rules without adopting normalization semantics', () => {
  const draft = fixture();
  draft.items[1].name = '  reading ';
  assert.equal(build(draft).hasDuplicateItemNames, true);
  assert.equal(build(draft).canSave, false);
  draft.items = [{ id: 'one', name: 'Reading  skills', maxScore: 100 }, { id: 'two', name: 'Reading skills', maxScore: 100 }];
  assert.equal(build(draft).hasDuplicateItemNames, false, 'internal whitespace handling must not change in a refactor');
  draft.title = '  ';
  assert.equal(build(draft).canSave, false);
  draft.title = 'Valid'; draft.items[0].maxScore = 0;
  assert.equal(build(draft).canSave, false);
  draft.items = [];
  assert.equal(build(draft).canSave, false);
});

test('readonly printing, pending-save state and learner fallback retain existing conditions', () => {
  const draft = fixture();
  assert.equal(build(draft, [draft], { readOnly: true }).canPrint, true);
  const unsaved = build(draft, [], { readOnly: true, selectedStudentId: 'missing' });
  assert.equal(unsaved.canPrint, false);
  assert.equal(unsaved.isPendingSave, true);
  assert.equal(unsaved.selectedStudent?.id, 'alice');
  assert.equal(build(draft, [], { readOnly: false }).canPrint, true);
  assert.equal(build(draft, [draft], { isDirty: true }).isPendingSave, true);
  const empty = build(draft, [draft], { students: [] });
  assert.equal(empty.selectedStudent, undefined);
  assert.equal(empty.analysis, null);
  assert.equal(empty.completedStudentCount, 0);
});

test('memoizable assessment output uses canonical analysis and never modifies persisted exams', () => {
  const draft = fixture();
  const previous = { ...fixture(), id: 'previous', examDate: '2026-11-10', createdAt: 1, updatedAt: 1 };
  const source = [previous, { ...fixture(), title: 'Persisted title' }];
  const snapshot = structuredClone({ draft, source, students });
  const model = build(draft, source, { selectedStudentId: 'bob' });
  assert.equal(model.allExamsForAnalysis[0], draft);
  assert.deepEqual(model.allExamsForAnalysis.map(exam => exam.id), ['current', 'previous']);
  for (const student of students) {
    assert.deepEqual(model.studentAnalyses.get(student.id), computeExamStudentAnalysis(model.allExamsForAnalysis, draft.id, student.id));
  }
  assert.equal(model.analysis, model.studentAnalyses.get('bob'));
  assert.deepEqual({ draft, source, students }, snapshot);
});

test('report ranges and exclusions call canonical report selection without changing assessment data', () => {
  const draft = fixture();
  const previous = { ...fixture(), id: 'previous', examDate: '2026-11-10', createdAt: 1, updatedAt: 1 };
  const assessment = build(draft, [previous]);
  const snapshot = structuredClone(draft);
  for (const scoreRange of ['current', 'recent3', 'all'] as const) {
    for (const commentRange of ['current', 'recent3', 'all', 'none'] as const) {
      const report = buildExamReportModel({ draft, assessment, scoreRange, commentRange, excludedItemIds: ['writing'] });
      assert.deepEqual(report.reportSelection, getExamReportSelection({ exams: assessment.allExamsForAnalysis,
        exam: draft, analysis: assessment.analysis!, scoreRange, commentRange }));
      assert.equal(report.reportCommentCount, report.reportSelection!.commentEntries.filter(entry => entry.comment.trim()).length);
      assert.deepEqual(report.selectedReportItemIds, ['reading']);
    }
  }
  assert.deepEqual(draft, snapshot);
});

test('bilingual assessment copy preserves matching keys and safety-focused save wording', () => {
  const en = getExamAssessmentCopy('en');
  const zh = getExamAssessmentCopy('zh');
  assert.deepEqual(Object.keys(en), Object.keys(zh));
  assert.equal(en.saved, 'Added to workspace');
  assert.equal(zh.saved, '已加入工作區');
  assert.match(zh.syncHint, /同步/);
});
