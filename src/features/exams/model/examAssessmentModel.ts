import { computeExamStudentAnalysis } from '../../../examAnalytics';
import { getExamReportSelection, type ExamReportCommentRange, type ExamReportScoreRange } from '../../../examReport';
import type { ExamRecord } from '../../../store/types';
import type { ExamRosterStudent } from './examAssessmentContext';
import { getStudentResult, hasExamScore } from './examDraft';

type AssessmentInput = {
  draft: ExamRecord;
  exams: ExamRecord[];
  students: ExamRosterStudent[];
  selectedStudentId: string;
  isDirty: boolean;
  readOnly: boolean;
};

/** Presentation calculations only. Keep domain normalization, storage and
 * protected draft lifecycle in their existing owners.
 */
export const buildExamAssessmentModel = ({ draft, exams, students, selectedStudentId, isDirty, readOnly }: AssessmentInput) => {
  const storedExam = exams.find((exam) => exam.id === draft.id);
  const normalizedItemNames = draft.items.map((item) => item.name.trim().toLocaleLowerCase());
  const hasDuplicateItemNames = new Set(normalizedItemNames.filter(Boolean)).size !==
    normalizedItemNames.filter(Boolean).length;
  const canSave = Boolean(draft.title.trim()) && draft.items.length > 0 &&
    draft.items.every((item) => item.name.trim() && item.maxScore > 0) && !hasDuplicateItemNames;
  const allExamsForAnalysis = [draft, ...exams.filter((exam) => exam.id !== draft.id)];
  const studentAnalyses = new Map(students.map((student) => [student.id,
    computeExamStudentAnalysis(allExamsForAnalysis, draft.id, student.id)]));
  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? students[0];
  const analysis = selectedStudent ? studentAnalyses.get(selectedStudent.id)! : null;
  const enteredScoreCount = students.reduce((total, student) => {
    const result = getStudentResult(draft, student.id);
    return total + draft.items.filter((item) => hasExamScore(result?.scores[item.id])).length;
  }, 0);
  const completedStudentCount = students.filter((student) => {
    const result = getStudentResult(draft, student.id);
    return draft.items.length > 0 && draft.items.every((item) => hasExamScore(result?.scores[item.id]));
  }).length;
  return { storedExam, isPendingSave: isDirty || !storedExam, hasDuplicateItemNames, canSave,
    canPrint: canSave && (!readOnly || Boolean(storedExam)), allExamsForAnalysis,
    studentAnalyses, selectedStudent, analysis, enteredScoreCount,
    totalScoreCount: students.length * draft.items.length, completedStudentCount };
};

/** Selection changes do not recalculate every student's historical analysis. */
export const buildExamReportModel = ({ draft, assessment, scoreRange, commentRange, excludedItemIds }: {
  draft: ExamRecord;
  assessment: ReturnType<typeof buildExamAssessmentModel>;
  scoreRange: ExamReportScoreRange;
  commentRange: ExamReportCommentRange;
  excludedItemIds: string[];
}) => {
  const reportSelection = assessment.analysis ? getExamReportSelection({
    exams: assessment.allExamsForAnalysis, exam: draft, analysis: assessment.analysis, scoreRange, commentRange,
  }) : null;
  const reportCommentCount = reportSelection?.commentEntries.filter((entry) => entry.comment.trim()).length ?? 0;
  const selectedReportItemIds = draft.items.filter((item) => !excludedItemIds.includes(item.id)).map((item) => item.id);
  return { reportSelection, reportCommentCount, selectedReportItemIds };
};
