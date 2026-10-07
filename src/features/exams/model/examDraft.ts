import type {
  ExamRecord,
  ExamStudentResult,
  Language,
} from '../../../store/types';

export const createExamEntityId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const getLocalDateKey = (now = new Date()) => {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export const cloneExam = (exam: ExamRecord): ExamRecord => ({
  ...exam,
  items: exam.items.map((item) => ({ ...item })),
  results: exam.results.map((result) => ({
    ...result,
    scores: { ...result.scores },
  })),
});

export const createExamDraft = (
  language: Language,
  sequence: number,
): ExamRecord => {
  const now = Date.now();
  return {
    id: createExamEntityId('exam'),
    title: language === 'en'
      ? `Assessment ${sequence}`
      : `第 ${sequence} 次考試`,
    examDate: getLocalDateKey(),
    items: [{
      id: createExamEntityId('exam-item'),
      name: language === 'en' ? 'Item 1' : '項目 1',
      maxScore: 100,
    }],
    results: [],
    createdAt: now,
    updatedAt: now,
  };
};

export const getStudentResult = (exam: ExamRecord, studentId: string) =>
  exam.results.find((result) => result.studentId === studentId);

export const upsertStudentResult = (
  exam: ExamRecord,
  studentId: string,
  update: (result: ExamStudentResult) => ExamStudentResult,
) => {
  const existing = getStudentResult(exam, studentId) ?? {
    studentId,
    scores: {},
    updatedAt: Date.now(),
  };
  const nextResult = update(existing);
  const hasExisting = exam.results.some((result) => result.studentId === studentId);
  return {
    ...exam,
    updatedAt: Date.now(),
    results: hasExisting
      ? exam.results.map((result) =>
          result.studentId === studentId ? nextResult : result
        )
      : [...exam.results, nextResult],
  };
};

export const formatExamPercent = (value: number | null) =>
  value == null ? '-' : `${Math.round(value)}%`;

export const formatExamDelta = (value: number | null) =>
  value == null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

export const hasExamScore = (value: number | undefined) => Number.isFinite(value);

export const createSafeExamFilenameSegment = (
  value: string,
  fallback: string,
) => value
  .normalize('NFKC')
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
  .replace(/\s+/g, '_')
  .replace(/_+/g, '_')
  .replace(/^[-_.]+|[-_.]+$/g, '')
  .slice(0, 60) || fallback;
