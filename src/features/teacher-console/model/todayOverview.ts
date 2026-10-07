import { getActiveLearningEvidence } from '../../../../shared/education';
import { getDailyPointFairnessInsights, getWeeklyEducationInsights } from '../../../educationInsights';
import { DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET, getActiveClassGoals, getDateKey } from '../../../gameRules';
import type { AppData, ClassData } from '../../../store/types';
import { buildDashboardRecordCollections } from '../../records/model/buildDashboardRecordCollections';
import { getMentorFeedbackCount } from '../../records/model/getMentorFeedbackCount';
import type { ConsoleDestination } from './navigation';

export type RecentClassActivity = { id: string; createdAt: number; kind: 'points' | 'feedback' | 'boss' | 'discipline' | 'evidence' | 'exam'; destination: ConsoleDestination; amount?: number };
export type AttentionReason = 'learning-support' | 'mentor-support' | 'negative-feedback';
export type TodayAttentionStudent = { studentId: string; reasons: AttentionReason[] };

/** A read-only projection of existing records. No new due dates, scoring or persisted task state. */
export const buildTodayOverview = (classData: ClassData | undefined, now: number, schoolTimeZone?: string, settings?: AppData['settings']) => {
  const students = classData?.students ?? [];
  // Daily feedback uses the class calendar; weekly goals retain the established global calendar.
  const today = getDateKey(now, classData?.dailyTaskCalendar?.schoolTimeZone ?? schoolTimeZone);
  const dailyTimeZone = classData?.dailyTaskCalendar?.schoolTimeZone ?? schoolTimeZone;
  const studentIds = new Set(students.map((student) => student.id));
  const evidence = getActiveLearningEvidence(classData?.learningEvidenceRecords ?? [])
    .filter((record) => studentIds.has(record.studentId) && record.createdAt <= now);
  const learningSupport = new Set(getWeeklyEducationInsights(students, now, 7, evidence)
    .needsSupportReflectionStudents.map((student) => student.id));
  const feedbackSources = students.map((student) => ({ ...student,
    pointAdjustmentRecords: (student.pointAdjustmentRecords ?? []).filter((record) => record.createdAt <= now),
    dailyProgress: student.dailyProgress ? { ...student.dailyProgress,
      reflections: (student.dailyProgress.reflections ?? []).filter((record) => record.createdAt <= now),
    } : undefined,
  }));
  const mentorSupport = new Set(getWeeklyEducationInsights(feedbackSources, now, 7)
    .needsSupportReflectionStudents.map((student) => student.id));
  // Reuse the established teacher-only daily feedback definition, excluding
  // battle/economy/participation rewards. No new scoring or punitive action.
  const fairnessTimeZone = schoolTimeZone ?? 'Asia/Taipei';
  const targetRatio = settings?.positiveFeedbackRatioTarget ?? DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET;
  const fairness = getDailyPointFairnessInsights(feedbackSources, now, fairnessTimeZone, targetRatio);
  const dailyFeedback = feedbackSources.map((student) => ({
    studentId: student.id,
    insights: getDailyPointFairnessInsights([student], now, fairnessTimeZone, targetRatio),
  }));
  const attentionStudents: TodayAttentionStudent[] = dailyFeedback.flatMap(({ studentId, insights }) => {
    const reasons: AttentionReason[] = [];
    if (learningSupport.has(studentId)) reasons.push('learning-support');
    if (mentorSupport.has(studentId)) reasons.push('mentor-support');
    if (insights.negativeCount > 0 && insights.positiveCount === 0) reasons.push('negative-feedback');
    return reasons.length > 0 ? [{ studentId, reasons }] : [];
  });
  // A transparent UI reminder, not a statistical diagnosis: require at least
  // three negative teacher actions, >= half on one learner, and the existing
  // class ratio below its configured target before flagging concentration.
  const concentratedStudents = dailyFeedback.filter(({ insights }) =>
    insights.negativeCount >= 3 && insights.negativeCount * 2 >= fairness.negativeCount,
  ).map(({ studentId, insights }) => ({ studentId, count: insights.negativeCount }));
  const records = buildDashboardRecordCollections(students);
  const recent: RecentClassActivity[] = [
    ...records.pointAdjustmentRecords.map((item) => ({ id: `points-${item.id}`, createdAt: item.createdAt, kind: 'points' as const, destination: 'records' as const, amount: item.amount })),
    ...records.dailyFeedbackRecords.map((item) => ({ id: `feedback-${item.id}`, createdAt: item.createdAt, kind: 'feedback' as const, destination: 'records' as const })),
    ...records.bossRewardRecords.map((item) => ({ id: `boss-${item.id}`, createdAt: item.createdAt, kind: 'boss' as const, destination: 'activity-rewards' as const })),
    ...records.disciplineRecords.map((item) => ({ id: `discipline-${item.id}`, createdAt: item.createdAt, kind: 'discipline' as const, destination: 'records' as const })),
    ...evidence.map((item) => ({ id: `evidence-${item.id}`, createdAt: item.createdAt, kind: 'evidence' as const, destination: 'evidence' as const })),
    ...(classData?.examRecords ?? []).map((item) => ({ id: `exam-${item.id}`, createdAt: item.updatedAt, kind: 'exam' as const, destination: 'exams' as const })),
  ];
  return {
    studentCount: students.length,
    feedbackPending: students.length - getMentorFeedbackCount(feedbackSources, today),
    attentionStudents,
    attentionCount: attentionStudents.length,
    evidenceTodayCount: evidence.filter((record) => getDateKey(record.createdAt, dailyTimeZone) === today).length,
    examTodayCount: (classData?.examRecords ?? []).filter((record) => record.updatedAt <= now && getDateKey(record.updatedAt, dailyTimeZone) === today).length,
    negativeFeedbackAlert: fairness.belowTarget && concentratedStudents.length > 0 ? {
      positiveCount: fairness.positiveCount, negativeCount: fairness.negativeCount,
      targetRatio: fairness.targetRatio, concentratedStudents,
    } : null,
    activeGoalCount: getActiveClassGoals(classData?.classGoals, now, schoolTimeZone).length,
    activeBoss: Boolean(classData?.activeBoss?.isActive && classData.activeBoss.currentHp > 0),
    recentActivity: recent.filter((item) => Number.isFinite(new Date(item.createdAt).getTime()) && item.createdAt <= now)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
  };
};
