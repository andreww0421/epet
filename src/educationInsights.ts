import {
  type ClassGoal,
  type DailyReflection,
  type LearningCompetency,
  type PointAdjustmentRecord,
  LEARNING_COMPETENCIES,
} from './gameRules';

export type StudentFeedbackSource = {
  id: string;
  name: string;
  pointAdjustmentRecords?: PointAdjustmentRecord[];
  dailyProgress?: {
    lastClaimDate?: string;
    streak?: number;
    reflections?: DailyReflection[];
  };
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
  feedbackStudents: number;
  feedbackCoverageRate: number;
  competencyCounts: Record<LearningCompetency, number>;
  reasonCounts: EducationReasonCount[];
  overlookedStudents: Array<{ id: string; name: string }>;
  needsPositiveFeedbackStudents: Array<{ id: string; name: string }>;
  collaborationStudents: number;
  collaborationRate: number;
  reflectionCount: number;
  needsSupportReflectionStudents: Array<{
    id: string;
    name: string;
    competency: LearningCompetency;
    text?: string;
  }>;
  positiveFeedbackTrend: number;
  feedbackCoverageTrend: number;
};

export type WeeklyStudentGrowth = {
  studentId: string;
  studentName: string;
  positiveFeedbackCount: number;
  competencyCount: number;
  netPoints: number;
};

const LEGACY_REASON_COMPETENCIES: Record<string, LearningCompetency> = {
  homework: 'assignmentQuality',
  missingHomework: 'assignmentQuality',
  participation: 'participation',
  helpful: 'collaboration',
  growth: 'growth',
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

export const getClassGoalCoverage = (
  students: Array<Pick<StudentFeedbackSource, 'pointAdjustmentRecords'>>,
  goal: ClassGoal | undefined,
) => {
  const studentsReached = goal
    ? students.filter((student) => getStudentGoalProgress(student, goal) > 0).length
    : 0;

  return {
    studentsReached,
    totalStudents: students.length,
    rate: students.length > 0 ? studentsReached / students.length : 0,
  };
};

export const getNextStudentGoal = (
  student: Pick<StudentFeedbackSource, 'pointAdjustmentRecords'>,
  goals: ClassGoal[],
) => {
  const goalsWithProgress = goals.map((goal) => ({
    goal,
    progress: getStudentGoalProgress(student, goal),
  }));

  return (
    goalsWithProgress.find(({ progress }) => progress === 0) ??
    goalsWithProgress.sort(
      (left, right) =>
        left.progress - right.progress ||
        left.goal.createdAt - right.goal.createdAt,
    )[0]
  );
};

export const getLatestPositiveFeedback = (
  student: Pick<StudentFeedbackSource, 'pointAdjustmentRecords'>,
) =>
  [...(student.pointAdjustmentRecords ?? [])]
    .filter((record) => record.amount > 0)
    .sort((left, right) => right.createdAt - left.createdAt)[0];

export const getWeeklyStudentGrowth = (
  students: StudentFeedbackSource[],
  now = Date.now(),
  days = 7,
): WeeklyStudentGrowth[] => {
  const since = now - Math.max(1, days) * 24 * 60 * 60 * 1000;

  return students
    .map((student) => {
      const competencies = new Set<LearningCompetency>();
      let positiveFeedbackCount = 0;
      let netPoints = 0;

      (student.pointAdjustmentRecords ?? [])
        .filter((record) => record.createdAt >= since)
        .forEach((record) => {
          netPoints += record.amount;
          if (record.amount <= 0) return;
          positiveFeedbackCount += 1;
          const competency = getRecordCompetency(record);
          if (competency) competencies.add(competency);
        });

      return {
        studentId: student.id,
        studentName: student.name,
        positiveFeedbackCount,
        competencyCount: competencies.size,
        netPoints,
      };
    })
    .sort(
      (left, right) =>
        right.positiveFeedbackCount - left.positiveFeedbackCount ||
        right.competencyCount - left.competencyCount ||
        right.netPoints - left.netPoints ||
        left.studentName.localeCompare(right.studentName),
    );
};

export const getWeeklyEducationInsights = (
  students: StudentFeedbackSource[],
  now = Date.now(),
  days = 7,
): WeeklyEducationInsights => {
  const since = now - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const previousSince = since - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const competencyCounts = Object.fromEntries(
    LEARNING_COMPETENCIES.map((competency) => [competency, 0]),
  ) as Record<LearningCompetency, number>;
  const reasonCounts = new Map<string, EducationReasonCount>();
  const studentsWithFeedback = new Set<string>();
  const previousStudentsWithFeedback = new Set<string>();
  const collaborationStudentIds = new Set<string>();
  const needsSupportReflections = new Map<string, DailyReflection>();
  const studentFeedbackBalance = new Map<string, { positive: number; negative: number }>(
    students.map((student) => [student.id, { positive: 0, negative: 0 }]),
  );
  let positiveCount = 0;
  let negativeCount = 0;
  let previousPositiveCount = 0;
  let reflectionCount = 0;

  students.forEach((student) => {
    (student.pointAdjustmentRecords ?? []).forEach((record) => {
      if (record.createdAt >= previousSince && record.createdAt < since) {
        previousStudentsWithFeedback.add(student.id);
        if (record.amount > 0) previousPositiveCount += 1;
      }
      if (record.createdAt < since) return;

      studentsWithFeedback.add(student.id);
      const balance = studentFeedbackBalance.get(student.id);
      if (record.amount > 0) {
        positiveCount += 1;
        if (balance) balance.positive += 1;
      }
      if (record.amount < 0) {
        negativeCount += 1;
        if (balance) balance.negative += 1;
      }

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

    (student.dailyProgress?.reflections ?? [])
      .filter((reflection) => reflection.createdAt >= since)
      .forEach((reflection) => {
        if (reflection.author !== 'mentor') return;
        reflectionCount += 1;
        const assessment = reflection.mentorAssessment ?? reflection.selfAssessment;
        if (assessment === 'needsSupport') {
          const current = needsSupportReflections.get(student.id);
          if (!current || reflection.createdAt > current.createdAt) {
            needsSupportReflections.set(student.id, reflection);
          }
        }
      });
  });

  const ratedCount = positiveCount + negativeCount;

  return {
    positiveCount,
    negativeCount,
    positiveRatio: ratedCount > 0 ? positiveCount / ratedCount : 0,
    feedbackStudents: studentsWithFeedback.size,
    feedbackCoverageRate: students.length > 0 ? studentsWithFeedback.size / students.length : 0,
    competencyCounts,
    reasonCounts: [...reasonCounts.values()].sort(
      (left, right) => right.count - left.count || left.label.localeCompare(right.label),
    ),
    overlookedStudents: students
      .filter((student) => !studentsWithFeedback.has(student.id))
      .map(({ id, name }) => ({ id, name })),
    needsPositiveFeedbackStudents: students
      .filter((student) => {
        const balance = studentFeedbackBalance.get(student.id);
        return Boolean(balance && balance.negative > 0 && balance.positive === 0);
      })
      .map(({ id, name }) => ({ id, name })),
    collaborationStudents: collaborationStudentIds.size,
    collaborationRate: students.length > 0 ? collaborationStudentIds.size / students.length : 0,
    reflectionCount,
    needsSupportReflectionStudents: students
      .filter((student) => needsSupportReflections.has(student.id))
      .map(({ id, name }) => {
        const reflection = needsSupportReflections.get(id)!;
        return {
          id,
          name,
          competency: reflection.competency,
          text: reflection.text,
        };
      }),
    positiveFeedbackTrend: positiveCount - previousPositiveCount,
    feedbackCoverageTrend: studentsWithFeedback.size - previousStudentsWithFeedback.size,
  };
};
