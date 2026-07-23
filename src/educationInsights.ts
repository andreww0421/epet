import {
  type ClassGoal,
  type LearningCompetency,
  type PointAdjustmentRecord,
  LEARNING_COMPETENCIES,
} from './gameRules';

type StudentFeedbackSource = {
  id: string;
  name: string;
  pointAdjustmentRecords?: PointAdjustmentRecord[];
};

export type EducationReasonCount = {
  id: string;
  label: string;
  count: number;
};

export type WeeklyEducationInsights = {
  positiveCount: number;
  negativeCount: number;
  positiveRatio: number;
  competencyCounts: Record<LearningCompetency, number>;
  reasonCounts: EducationReasonCount[];
  overlookedStudents: Array<{ id: string; name: string }>;
  collaborationStudents: number;
  collaborationRate: number;
};

const LEGACY_REASON_COMPETENCIES: Record<string, LearningCompetency> = {
  homework: 'assignmentQuality',
  missingHomework: 'assignmentQuality',
  participation: 'participation',
  helpful: 'collaboration',
  late: 'selfManagement',
  disruptive: 'selfManagement',
};

export const getRecordCompetency = (
  record: Pick<PointAdjustmentRecord, 'competency' | 'reasonId'>,
): LearningCompetency | undefined =>
  record.competency ?? (record.reasonId ? LEGACY_REASON_COMPETENCIES[record.reasonId] : undefined);

export const getStudentGoalProgress = (
  student: Pick<StudentFeedbackSource, 'pointAdjustmentRecords'>,
  goal: ClassGoal | undefined,
) => {
  if (!goal) return 0;

  return (student.pointAdjustmentRecords ?? []).filter(
    (record) =>
      record.createdAt >= goal.createdAt &&
      record.amount > 0 &&
      getRecordCompetency(record) === goal.competency,
  ).length;
};

export const getClassGoalProgress = (
  students: Array<Pick<StudentFeedbackSource, 'pointAdjustmentRecords'>>,
  goal: ClassGoal | undefined,
) => students.reduce((total, student) => total + getStudentGoalProgress(student, goal), 0);

export const getWeeklyEducationInsights = (
  students: StudentFeedbackSource[],
  now = Date.now(),
  days = 7,
): WeeklyEducationInsights => {
  const since = now - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const competencyCounts = Object.fromEntries(
    LEARNING_COMPETENCIES.map((competency) => [competency, 0]),
  ) as Record<LearningCompetency, number>;
  const reasonCounts = new Map<string, EducationReasonCount>();
  const studentsWithFeedback = new Set<string>();
  const collaborationStudentIds = new Set<string>();
  let positiveCount = 0;
  let negativeCount = 0;

  students.forEach((student) => {
    (student.pointAdjustmentRecords ?? [])
      .filter((record) => record.createdAt >= since)
      .forEach((record) => {
        studentsWithFeedback.add(student.id);
        if (record.amount > 0) positiveCount += 1;
        if (record.amount < 0) negativeCount += 1;

        const competency = getRecordCompetency(record);
        if (competency) {
          competencyCounts[competency] += 1;
          if (competency === 'collaboration' && record.amount > 0) {
            collaborationStudentIds.add(student.id);
          }
        }

        const reasonId = record.reasonId ?? record.reasonLabel ?? 'manual';
        const current = reasonCounts.get(reasonId);
        reasonCounts.set(reasonId, {
          id: reasonId,
          label: record.reasonLabel ?? reasonId,
          count: (current?.count ?? 0) + 1,
        });
      });
  });

  const ratedCount = positiveCount + negativeCount;

  return {
    positiveCount,
    negativeCount,
    positiveRatio: ratedCount > 0 ? positiveCount / ratedCount : 0,
    competencyCounts,
    reasonCounts: [...reasonCounts.values()].sort(
      (left, right) => right.count - left.count || left.label.localeCompare(right.label),
    ),
    overlookedStudents: students
      .filter((student) => !studentsWithFeedback.has(student.id))
      .map(({ id, name }) => ({ id, name })),
    collaborationStudents: collaborationStudentIds.size,
    collaborationRate: students.length > 0 ? collaborationStudentIds.size / students.length : 0,
  };
};
