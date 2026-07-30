import type {
  ExamItem,
  ExamRecord,
  ExamStudentResult,
} from './store/types';

export const MAX_EXAM_RECORDS = 30;
export const MAX_EXAM_ITEMS = 12;
export const MAX_EXAM_COMMENT_LENGTH = 800;

const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const safeDateKey = (value: unknown, fallbackTimestamp: number) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return value;
  }
  return new Date(fallbackTimestamp).toISOString().slice(0, 10);
};

const normalizeItemName = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const compareExams = (left: ExamRecord, right: ExamRecord) =>
  left.examDate.localeCompare(right.examDate) ||
  left.createdAt - right.createdAt ||
  left.id.localeCompare(right.id);

export const normalizeExamRecords = (
  raw: unknown,
  validStudentIds: Set<string>,
  now = Date.now(),
): ExamRecord[] => {
  if (!Array.isArray(raw)) return [];
  const seenExamIds = new Set<string>();

  return raw
    .filter((candidate) => candidate && typeof candidate === 'object')
    .map((candidate: any, examIndex: number): ExamRecord | null => {
      const id =
        typeof candidate.id === 'string' && candidate.id.trim()
          ? candidate.id.trim().slice(0, 120)
          : `exam-${now}-${examIndex}`;
      if (seenExamIds.has(id)) return null;
      seenExamIds.add(id);

      const createdAt = toFiniteNumber(candidate.createdAt, now);
      const seenItemIds = new Set<string>();
      const seenItemNames = new Set<string>();
      const items: ExamItem[] = (Array.isArray(candidate.items) ? candidate.items : [])
        .filter((item: unknown) => item && typeof item === 'object')
        .map((item: any, itemIndex: number): ExamItem | null => {
          const itemId =
            typeof item.id === 'string' && item.id.trim()
              ? item.id.trim().slice(0, 120)
              : `${id}-item-${itemIndex}`;
          const name =
            typeof item.name === 'string' && item.name.trim()
              ? item.name.trim().slice(0, 80)
              : '';
          const normalizedName = normalizeItemName(name);
          if (
            !name ||
            seenItemIds.has(itemId) ||
            seenItemNames.has(normalizedName)
          ) {
            return null;
          }
          seenItemIds.add(itemId);
          seenItemNames.add(normalizedName);
          return {
            id: itemId,
            name,
            maxScore: clamp(toFiniteNumber(item.maxScore, 100), 1, 1000),
          };
        })
        .filter((item: ExamItem | null): item is ExamItem => Boolean(item))
        .slice(0, MAX_EXAM_ITEMS);
      const itemById = new Map(items.map((item) => [item.id, item] as const));
      const seenStudentIds = new Set<string>();
      const results = (Array.isArray(candidate.results) ? candidate.results : [])
        .filter((result: unknown) => result && typeof result === 'object')
        .map((result: any): ExamStudentResult | null => {
          const studentId =
            typeof result.studentId === 'string' ? result.studentId : '';
          if (
            !validStudentIds.has(studentId) ||
            seenStudentIds.has(studentId)
          ) {
            return null;
          }
          seenStudentIds.add(studentId);
          const rawScores =
            result.scores && typeof result.scores === 'object'
              ? result.scores as Record<string, unknown>
              : {};
          const scores: Record<string, number> = {};
          Object.entries(rawScores).forEach(([itemId, rawScore]) => {
            const item = itemById.get(itemId);
            if (!item || rawScore === '' || rawScore == null) return;
            const score = Number(rawScore);
            if (!Number.isFinite(score)) return;
            scores[itemId] = clamp(score, 0, item.maxScore);
          });
          const mentorComment =
            typeof result.mentorComment === 'string'
              ? result.mentorComment.trim().slice(0, MAX_EXAM_COMMENT_LENGTH)
              : '';
          return {
            studentId,
            scores,
            mentorComment: mentorComment || undefined,
            updatedAt: toFiniteNumber(result.updatedAt, createdAt),
          };
        })
        .filter(
          (result: ExamStudentResult | null): result is ExamStudentResult =>
            Boolean(result),
        );

      return {
        id,
        title:
          typeof candidate.title === 'string' && candidate.title.trim()
            ? candidate.title.trim().slice(0, 100)
            : 'Untitled exam',
        examDate: safeDateKey(candidate.examDate, createdAt),
        items,
        results,
        createdAt,
        updatedAt: toFiniteNumber(candidate.updatedAt, createdAt),
      };
    })
    .filter((exam: ExamRecord | null): exam is ExamRecord => Boolean(exam))
    .sort((left, right) => compareExams(right, left))
    .slice(0, MAX_EXAM_RECORDS);
};

export type ExamTrend = 'improving' | 'declining' | 'stable' | 'first';

export type ExamItemAnalysis = {
  itemId: string;
  name: string;
  score: number | null;
  maxScore: number;
  percent: number | null;
  previousPercent: number | null;
  trendDelta: number | null;
  classAveragePercent: number | null;
};

export type ExamStudentAnalysis = {
  studentId: string;
  overallPercent: number | null;
  previousOverallPercent: number | null;
  trendDelta: number | null;
  trend: ExamTrend;
  completedItemCount: number;
  totalItemCount: number;
  classAveragePercent: number | null;
  itemAnalyses: ExamItemAnalysis[];
  weaknessItems: ExamItemAnalysis[];
  strengthItems: ExamItemAnalysis[];
  missingItems: ExamItemAnalysis[];
  mentorComment: string;
};

const getResult = (exam: ExamRecord, studentId: string) =>
  exam.results.find((result) => result.studentId === studentId);

const getOverallPercent = (
  exam: ExamRecord,
  result: ExamStudentResult | undefined,
) => {
  if (!result) return null;
  let earned = 0;
  let maximum = 0;
  exam.items.forEach((item) => {
    const score = result.scores[item.id];
    if (!Number.isFinite(score)) return;
    earned += score;
    maximum += item.maxScore;
  });
  return maximum > 0 ? (earned / maximum) * 100 : null;
};

const getPreviousExams = (exams: ExamRecord[], currentExam: ExamRecord) =>
  exams
    .filter((exam) => exam.id !== currentExam.id && compareExams(exam, currentExam) < 0)
    .sort((left, right) => compareExams(right, left));

const getClassAveragePercent = (exam: ExamRecord) => {
  const values = exam.results
    .map((result) => getOverallPercent(exam, result))
    .filter((value): value is number => value != null);
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
};

export const computeExamStudentAnalysis = (
  exams: ExamRecord[],
  examId: string,
  studentId: string,
): ExamStudentAnalysis | null => {
  const exam = exams.find((candidate) => candidate.id === examId);
  if (!exam) return null;
  const result = getResult(exam, studentId);
  const previousExams = getPreviousExams(exams, exam);
  const previousOverall = previousExams
    .map((candidate) => getOverallPercent(candidate, getResult(candidate, studentId)))
    .find((value): value is number => value != null) ?? null;
  const overallPercent = getOverallPercent(exam, result);
  const trendDelta =
    overallPercent != null && previousOverall != null
      ? overallPercent - previousOverall
      : null;
  const trend: ExamTrend =
    trendDelta == null
      ? 'first'
      : trendDelta >= 3
        ? 'improving'
        : trendDelta <= -3
          ? 'declining'
          : 'stable';

  const itemAnalyses = exam.items.map((item): ExamItemAnalysis => {
    const score = result?.scores[item.id];
    const percent = Number.isFinite(score) ? (score / item.maxScore) * 100 : null;
    const normalizedName = normalizeItemName(item.name);
    let previousPercent: number | null = null;
    for (const previousExam of previousExams) {
      const previousItem = previousExam.items.find(
        (candidate) => normalizeItemName(candidate.name) === normalizedName,
      );
      if (!previousItem) continue;
      const previousScore = getResult(previousExam, studentId)?.scores[previousItem.id];
      if (Number.isFinite(previousScore)) {
        previousPercent = (previousScore / previousItem.maxScore) * 100;
        break;
      }
    }
    const classScores = exam.results
      .map((candidate) => candidate.scores[item.id])
      .filter((candidate) => Number.isFinite(candidate))
      .map((candidate) => (candidate / item.maxScore) * 100);
    const classAveragePercent =
      classScores.length > 0
        ? classScores.reduce((sum, value) => sum + value, 0) / classScores.length
        : null;
    return {
      itemId: item.id,
      name: item.name,
      score: Number.isFinite(score) ? score : null,
      maxScore: item.maxScore,
      percent,
      previousPercent,
      trendDelta:
        percent != null && previousPercent != null ? percent - previousPercent : null,
      classAveragePercent,
    };
  });
  const scoredItems = itemAnalyses.filter(
    (item): item is ExamItemAnalysis & { percent: number } => item.percent != null,
  );
  const belowSupportThreshold = scoredItems
    .filter((item) => item.percent < 60)
    .sort((left, right) => left.percent - right.percent);
  const attentionFallback = scoredItems
    .filter((item) => item.percent < 80)
    .sort((left, right) => left.percent - right.percent)
    .slice(0, 1);

  return {
    studentId,
    overallPercent,
    previousOverallPercent: previousOverall,
    trendDelta,
    trend,
    completedItemCount: scoredItems.length,
    totalItemCount: exam.items.length,
    classAveragePercent: getClassAveragePercent(exam),
    itemAnalyses,
    weaknessItems:
      belowSupportThreshold.length > 0
        ? belowSupportThreshold.slice(0, 3)
        : attentionFallback,
    strengthItems: scoredItems
      .filter((item) => item.percent >= 85)
      .sort((left, right) => right.percent - left.percent)
      .slice(0, 3),
    missingItems: itemAnalyses.filter((item) => item.percent == null),
    mentorComment: result?.mentorComment ?? '',
  };
};
