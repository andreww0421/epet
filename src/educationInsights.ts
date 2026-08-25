import {
  type ClassGoal,
  type DailyReflection,
  type LearningCompetency,
  type PointAdjustmentRecord,
  getDateKey,
  getMedianPoints,
  LEARNING_COMPETENCIES,
} from './gameRules';
import {
  getActiveLearningEvidence,
  type LearningEvidenceRecord,
} from '../shared/education';

export type StudentFeedbackSource = {
  id: string;
  name: string;
  points?: number;
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

export type DailyPointFairnessInsights = {
  positiveCount: number;
  negativeCount: number;
  positiveToNegativeRatio: number | null;
  targetRatio: number;
  belowTarget: boolean;
  clampedCount: number;
  blockedCount: number;
  participationTopUpCount: number;
  catchUpBonusCount: number;
  supportRewardPoints: number;
  catchUpCandidates: Array<{ id: string; name: string }>;
  uncoveredStudents: Array<{ id: string; name: string }>;
};

const TEACHER_FEEDBACK_SOURCES = new Set(['quick', 'manual', 'airdrop']);

export const getDailyPointFairnessInsights = (
  students: StudentFeedbackSource[],
  now = Date.now(),
  timeZone = 'Asia/Taipei',
  targetRatio = 3,
  catchUpGapThreshold = 100,
  dailyCatchUpBonus = 10,
): DailyPointFairnessInsights => {
  const dateKey = getDateKey(now, timeZone);
  const positiveStudentIds = new Set<string>();
  let positiveCount = 0;
  let negativeCount = 0;
  let clampedCount = 0;
  let blockedCount = 0;
  let participationTopUpCount = 0;
  let catchUpBonusCount = 0;
  let supportRewardPoints = 0;

  students.forEach((student) => {
    (student.pointAdjustmentRecords ?? []).forEach((record) => {
      if (getDateKey(record.createdAt, timeZone) !== dateKey) return;
      if (record.source === 'participationTopUp') {
        participationTopUpCount += 1;
        supportRewardPoints += Math.max(0, record.amount);
        return;
      }
      if (record.source === 'catchUpBonus') {
        catchUpBonusCount += 1;
        supportRewardPoints += Math.max(0, record.amount);
        return;
      }
      if (!TEACHER_FEEDBACK_SOURCES.has(record.source)) return;
      if (record.amount > 0) {
        positiveCount += 1;
        positiveStudentIds.add(student.id);
      }
      if (record.amount < 0) negativeCount += 1;
      if (record.guardrailOutcome === 'clamped') clampedCount += 1;
      if (record.guardrailOutcome === 'blocked') blockedCount += 1;
    });
  });

  const normalizedTarget = Math.max(1, Math.min(10, Number(targetRatio) || 3));
  const positiveToNegativeRatio = negativeCount > 0
    ? positiveCount / negativeCount
    : null;

  const classMedianPoints = getMedianPoints(
    students.map((student) => ({ points: Number(student.points) || 0 })),
  );
  const normalizedCatchUpGap = Math.max(0, Math.min(10_000, Number(catchUpGapThreshold) || 0));

  return {
    positiveCount,
    negativeCount,
    positiveToNegativeRatio,
    targetRatio: normalizedTarget,
    belowTarget: negativeCount > 0 && positiveCount < negativeCount * normalizedTarget,
    clampedCount,
    blockedCount,
    participationTopUpCount,
    catchUpBonusCount,
    supportRewardPoints,
    catchUpCandidates: Number(dailyCatchUpBonus) > 0 ? students
      .filter((student) => classMedianPoints - (Number(student.points) || 0) >= normalizedCatchUpGap)
      .map(({ id, name }) => ({ id, name })) : [],
    uncoveredStudents: students
      .filter((student) => !positiveStudentIds.has(student.id))
      .map(({ id, name }) => ({ id, name })),
  };
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

export const isParticipationSupportRecord = (
  record: Pick<PointAdjustmentRecord, 'source'>,
) => record.source === 'participationTopUp' || record.source === 'catchUpBonus';

export const getRecordCompetency = (
  record: Pick<PointAdjustmentRecord, 'competency' | 'reasonId'>,
): LearningCompetency | undefined =>
  record.competency ?? (record.reasonId ? LEGACY_REASON_COMPETENCIES[record.reasonId] : undefined);

export const getStudentGoalProgress = (
  student: Pick<StudentFeedbackSource, 'id' | 'pointAdjustmentRecords'>,
  goal: ClassGoal | undefined,
  evidence?: LearningEvidenceRecord[],
) => {
  if (!goal) return 0;
  const evidenceProgress = evidence
    ? getActiveLearningEvidence(evidence).filter(
      (record) =>
        record.studentId === student.id &&
        record.createdAt >= goal.createdAt &&
        record.level !== 'needsSupport' &&
        record.competency === goal.competency,
    ).length
    : 0;

  const rewardProgress = (student.pointAdjustmentRecords ?? []).filter(
    (record) =>
      record.createdAt >= goal.createdAt &&
      record.amount > 0 &&
      !isParticipationSupportRecord(record) &&
      getRecordCompetency(record) === goal.competency,
  ).length;
  return evidenceProgress + rewardProgress;
};

export const getClassGoalProgress = (
  students: Array<Pick<StudentFeedbackSource, 'id' | 'pointAdjustmentRecords'>>,
  goal: ClassGoal | undefined,
  evidence?: LearningEvidenceRecord[],
) => students.reduce(
  (total, student) => total + getStudentGoalProgress(student, goal, evidence),
  0,
);

export const getClassGoalCoverage = (
  students: Array<Pick<StudentFeedbackSource, 'id' | 'pointAdjustmentRecords'>>,
  goal: ClassGoal | undefined,
  evidence?: LearningEvidenceRecord[],
) => {
  const studentsReached = goal
    ? students.filter((student) => getStudentGoalProgress(student, goal, evidence) > 0).length
    : 0;

  return {
    studentsReached,
    totalStudents: students.length,
    rate: students.length > 0 ? studentsReached / students.length : 0,
  };
};

export const getNextStudentGoal = (
  student: Pick<StudentFeedbackSource, 'id' | 'pointAdjustmentRecords'>,
  goals: ClassGoal[],
  evidence?: LearningEvidenceRecord[],
) => {
  const goalsWithProgress = goals.map((goal) => ({
    goal,
    progress: getStudentGoalProgress(student, goal, evidence),
  })).filter(({ goal, progress }) => progress < goal.targetCount);

  const unstartedGoals = goalsWithProgress.filter(({ progress }) => progress === 0);
  if (unstartedGoals.length > 0) {
    return unstartedGoals.sort(
      (left, right) =>
        left.goal.targetCount - right.goal.targetCount ||
        left.goal.createdAt - right.goal.createdAt,
    )[0];
  }

  return goalsWithProgress.sort(
    (left, right) =>
      (left.goal.targetCount - left.progress) -
        (right.goal.targetCount - right.progress) ||
      left.goal.createdAt - right.goal.createdAt,
  )[0];
};

export const getLatestPositiveFeedback = (
  student: Pick<StudentFeedbackSource, 'pointAdjustmentRecords'>,
) =>
  [...(student.pointAdjustmentRecords ?? [])]
    .filter((record) => record.amount > 0 && !isParticipationSupportRecord(record))
    .sort((left, right) => right.createdAt - left.createdAt)[0];

export const getWeeklyStudentGrowth = (
  students: StudentFeedbackSource[],
  now = Date.now(),
  days = 7,
  evidence?: LearningEvidenceRecord[],
): WeeklyStudentGrowth[] => {
  const since = now - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const activeEvidence = evidence ? getActiveLearningEvidence(evidence) : null;

  return students
    .map((student) => {
      const competencies = new Set<LearningCompetency>();
      let positiveFeedbackCount = 0;
      let netPoints = 0;

      (student.pointAdjustmentRecords ?? [])
        .filter((record) => record.createdAt >= since)
        .forEach((record) => {
          if (isParticipationSupportRecord(record)) return;
          netPoints += record.amount;
          if (activeEvidence || record.amount <= 0) return;
          positiveFeedbackCount += 1;
          const competency = getRecordCompetency(record);
          if (competency) competencies.add(competency);
        });
      activeEvidence
        ?.filter(
          (record) =>
            record.studentId === student.id &&
            record.createdAt >= since &&
            record.level !== 'needsSupport',
        )
        .forEach((record) => {
          positiveFeedbackCount += 1;
          competencies.add(record.competency);
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
        (!activeEvidence ? right.netPoints - left.netPoints : 0) ||
        left.studentName.localeCompare(right.studentName),
    );
};

export const getWeeklyEducationInsights = (
  students: StudentFeedbackSource[],
  now = Date.now(),
  days = 7,
  evidence?: LearningEvidenceRecord[],
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
  const needsSupportReflections = new Map<
    string,
    Pick<DailyReflection, 'createdAt' | 'competency' | 'text'>
  >();
  const studentFeedbackBalance = new Map<string, { positive: number; negative: number }>(
    students.map((student) => [student.id, { positive: 0, negative: 0 }]),
  );
  let positiveCount = 0;
  let negativeCount = 0;
  let previousPositiveCount = 0;
  let reflectionCount = 0;

  if (evidence) {
    const studentIds = new Set(students.map((student) => student.id));
    getActiveLearningEvidence(evidence)
      .filter((record) => studentIds.has(record.studentId))
      .forEach((record) => {
        if (record.createdAt >= previousSince && record.createdAt < since) {
          previousStudentsWithFeedback.add(record.studentId);
          if (record.level !== 'needsSupport') previousPositiveCount += 1;
        }
        if (record.createdAt < since) return;

        studentsWithFeedback.add(record.studentId);
        const balance = studentFeedbackBalance.get(record.studentId);
        if (record.level === 'needsSupport') {
          negativeCount += 1;
          if (balance) balance.negative += 1;
        } else {
          positiveCount += 1;
          if (balance) balance.positive += 1;
        }

        competencyCounts[record.competency] += 1;
        if (
          record.competency === 'collaboration' &&
          record.level !== 'needsSupport'
        ) {
          collaborationStudentIds.add(record.studentId);
        }

        const reasonId = record.title;
        const current = reasonCounts.get(reasonId);
        reasonCounts.set(reasonId, {
          id: reasonId,
          label: record.title,
          count: (current?.count ?? 0) + 1,
        });

        if (record.source === 'mentorDailyFeedback') reflectionCount += 1;
        if (record.level === 'needsSupport') {
          const currentSupport = needsSupportReflections.get(record.studentId);
          if (!currentSupport || record.createdAt > currentSupport.createdAt) {
            needsSupportReflections.set(record.studentId, {
              createdAt: record.createdAt,
              competency: record.competency,
              text: record.note || record.title,
            });
          }
        }
      });
  } else {
    students.forEach((student) => {
      (student.pointAdjustmentRecords ?? []).forEach((record) => {
        if (isParticipationSupportRecord(record)) return;
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
  }

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
