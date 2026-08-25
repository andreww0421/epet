import {
  addDaysToDateKey,
  getDateKey,
  getWeekStartDateFromDateKey,
  isDateKey,
  LEARNING_COMPETENCIES,
  type LearningCompetency,
  type PointAdjustmentRecord,
} from './gameRules';
import type { StudentFeedbackSource } from './educationInsights';
import {
  getActiveLearningEvidence,
  type LearningEvidenceRecord,
} from '../shared/education';

const TEACHER_FEEDBACK_SOURCES = new Set(['quick', 'manual', 'airdrop']);

export type WeeklyFeedbackReasonCount = {
  id: string;
  label: string;
  count: number;
};

export type WeeklyFeedbackReport = {
  weekStartDate: string;
  weekEndDate: string;
  previousWeekStartDate: string;
  previousWeekEndDate: string;
  rosterStudents: number;
  positiveCount: number;
  negativeCount: number;
  positiveRatio: number;
  feedbackStudents: number;
  feedbackCoverageRate: number;
  competencyCounts: Record<LearningCompetency, number>;
  reasonCounts: WeeklyFeedbackReasonCount[];
  overlookedStudents: Array<{ id: string; name: string }>;
  needsPositiveFeedbackStudents: Array<{ id: string; name: string }>;
  needsSupportMentorFeedbackStudents: Array<{
    id: string;
    name: string;
    competency: LearningCompetency;
    text?: string;
  }>;
  collaborationStudents: number;
  collaborationRate: number;
  mentorFeedbackCount: number;
  studentSelfAssessmentCount: number;
  positiveFeedbackTrend: number;
  negativeFeedbackTrend: number;
  feedbackCoverageTrend: number;
  feedbackCoverageRateTrend: number;
  collaborationTrend: number;
  sourceCounts: {
    pointFeedback: number;
    learningEvidence: number;
  };
};

type PeriodStats = {
  positiveCount: number;
  negativeCount: number;
  studentIds: Set<string>;
  collaborationStudentIds: Set<string>;
};

const createPeriodStats = (): PeriodStats => ({
  positiveCount: 0,
  negativeCount: 0,
  studentIds: new Set<string>(),
  collaborationStudentIds: new Set<string>(),
});

const isInDateRange = (dateKey: string, startDate: string, endDate: string) =>
  dateKey >= startDate && dateKey <= endDate;

const getRecordDateKey = (
  createdAt: number,
  timeZone: string,
  effectiveDate?: string,
) => isDateKey(effectiveDate) ? effectiveDate : getDateKey(createdAt, timeZone);

export const getWeeklyFeedbackReport = (
  students: StudentFeedbackSource[],
  requestedWeekStartDate: string,
  timeZone = 'Asia/Taipei',
  evidence: LearningEvidenceRecord[] = [],
): WeeklyFeedbackReport => {
  const fallbackDate = getDateKey(Date.now(), timeZone);
  const weekStartDate = getWeekStartDateFromDateKey(
    isDateKey(requestedWeekStartDate) ? requestedWeekStartDate : fallbackDate,
  );
  const weekEndDate = addDaysToDateKey(weekStartDate, 6);
  const previousWeekStartDate = addDaysToDateKey(weekStartDate, -7);
  const previousWeekEndDate = addDaysToDateKey(weekStartDate, -1);
  const current = createPeriodStats();
  const previous = createPeriodStats();
  const competencyCounts = Object.fromEntries(
    LEARNING_COMPETENCIES.map((competency) => [competency, 0]),
  ) as Record<LearningCompetency, number>;
  const reasonCounts = new Map<string, WeeklyFeedbackReasonCount>();
  const studentFeedbackBalance = new Map<string, { positive: number; negative: number }>(
    students.map((student) => [student.id, { positive: 0, negative: 0 }]),
  );
  const studentIds = new Set(students.map((student) => student.id));
  const needsSupportMentorFeedback = new Map<
    string,
    { competency: LearningCompetency; createdAt: number; text?: string }
  >();
  let mentorFeedbackCount = 0;
  let studentSelfAssessmentCount = 0;
  let pointFeedbackCount = 0;
  let learningEvidenceCount = 0;

  const addReason = (label: string) => {
    const normalizedLabel = label.trim() || 'Unspecified feedback';
    const key = normalizedLabel.toLocaleLowerCase();
    const existing = reasonCounts.get(key);
    reasonCounts.set(key, {
      id: key,
      label: existing?.label ?? normalizedLabel,
      count: (existing?.count ?? 0) + 1,
    });
  };

  const recordEvent = (
    period: PeriodStats,
    studentId: string,
    polarity: 'positive' | 'negative',
    competency: LearningCompetency,
    isCurrentPeriod: boolean,
    reasonLabel: string,
  ) => {
    period.studentIds.add(studentId);
    if (polarity === 'positive') {
      period.positiveCount += 1;
      if (competency === 'collaboration') period.collaborationStudentIds.add(studentId);
    } else {
      period.negativeCount += 1;
    }
    if (!isCurrentPeriod) return;

    competencyCounts[competency] += 1;
    addReason(reasonLabel);
    const balance = studentFeedbackBalance.get(studentId);
    if (balance) balance[polarity] += 1;
  };

  const processPointRecord = (
    studentId: string,
    record: PointAdjustmentRecord,
  ) => {
    if (!TEACHER_FEEDBACK_SOURCES.has(record.source) || record.amount === 0) return;
    const dateKey = getRecordDateKey(record.createdAt, timeZone, record.effectiveDate);
    const competency = record.competency ?? 'participation';
    const polarity = record.amount > 0 ? 'positive' : 'negative';
    const reasonLabel = record.reasonLabel ?? record.reasonId ?? record.source;
    if (isInDateRange(dateKey, weekStartDate, weekEndDate)) {
      recordEvent(current, studentId, polarity, competency, true, reasonLabel);
      pointFeedbackCount += 1;
    } else if (isInDateRange(dateKey, previousWeekStartDate, previousWeekEndDate)) {
      recordEvent(previous, studentId, polarity, competency, false, reasonLabel);
    }
  };

  students.forEach((student) => {
    (student.pointAdjustmentRecords ?? []).forEach((record) =>
      processPointRecord(student.id, record),
    );

    (student.dailyProgress?.reflections ?? []).forEach((reflection) => {
      const dateKey = isDateKey(reflection.date)
        ? reflection.date
        : getDateKey(reflection.createdAt, timeZone);
      if (reflection.author === 'student' && isInDateRange(dateKey, weekStartDate, weekEndDate)) {
        studentSelfAssessmentCount += 1;
      }
      if (reflection.author === 'mentor' && isInDateRange(dateKey, weekStartDate, weekEndDate)) {
        mentorFeedbackCount += 1;
        const assessment = reflection.mentorAssessment ?? reflection.selfAssessment;
        const existing = needsSupportMentorFeedback.get(student.id);
        if (
          assessment === 'needsSupport' &&
          (!existing || reflection.createdAt > existing.createdAt)
        ) {
          needsSupportMentorFeedback.set(student.id, {
            competency: reflection.competency,
            createdAt: reflection.createdAt,
            text: reflection.text,
          });
        }
      }
    });
  });

  getActiveLearningEvidence(evidence)
    .filter((record) => studentIds.has(record.studentId))
    .forEach((record) => {
      const dateKey = getDateKey(record.createdAt, timeZone);
      const polarity = record.level === 'needsSupport' ? 'negative' : 'positive';
      if (isInDateRange(dateKey, weekStartDate, weekEndDate)) {
        recordEvent(
          current,
          record.studentId,
          polarity,
          record.competency,
          true,
          record.title,
        );
        learningEvidenceCount += 1;
      } else if (isInDateRange(dateKey, previousWeekStartDate, previousWeekEndDate)) {
        recordEvent(
          previous,
          record.studentId,
          polarity,
          record.competency,
          false,
          record.title,
        );
      }
    });

  const ratedCount = current.positiveCount + current.negativeCount;
  const currentCoverageRate = students.length > 0
    ? current.studentIds.size / students.length
    : 0;
  const previousCoverageRate = students.length > 0
    ? previous.studentIds.size / students.length
    : 0;

  return {
    weekStartDate,
    weekEndDate,
    previousWeekStartDate,
    previousWeekEndDate,
    rosterStudents: students.length,
    positiveCount: current.positiveCount,
    negativeCount: current.negativeCount,
    positiveRatio: ratedCount > 0 ? current.positiveCount / ratedCount : 0,
    feedbackStudents: current.studentIds.size,
    feedbackCoverageRate: currentCoverageRate,
    competencyCounts,
    reasonCounts: [...reasonCounts.values()].sort(
      (left, right) => right.count - left.count || left.label.localeCompare(right.label),
    ),
    overlookedStudents: students
      .filter((student) => !current.studentIds.has(student.id))
      .map(({ id, name }) => ({ id, name })),
    needsPositiveFeedbackStudents: students
      .filter((student) => {
        const balance = studentFeedbackBalance.get(student.id);
        return Boolean(balance && balance.negative > 0 && balance.positive === 0);
      })
      .map(({ id, name }) => ({ id, name })),
    needsSupportMentorFeedbackStudents: students.flatMap((student) => {
      const feedback = needsSupportMentorFeedback.get(student.id);
      return feedback
        ? [{
            id: student.id,
            name: student.name,
            competency: feedback.competency,
            text: feedback.text,
          }]
        : [];
    }),
    collaborationStudents: current.collaborationStudentIds.size,
    collaborationRate: students.length > 0
      ? current.collaborationStudentIds.size / students.length
      : 0,
    mentorFeedbackCount,
    studentSelfAssessmentCount,
    positiveFeedbackTrend: current.positiveCount - previous.positiveCount,
    negativeFeedbackTrend: current.negativeCount - previous.negativeCount,
    feedbackCoverageTrend: current.studentIds.size - previous.studentIds.size,
    feedbackCoverageRateTrend: currentCoverageRate - previousCoverageRate,
    collaborationTrend:
      current.collaborationStudentIds.size - previous.collaborationStudentIds.size,
    sourceCounts: {
      pointFeedback: pointFeedbackCount,
      learningEvidence: learningEvidenceCount,
    },
  };
};

const protectSpreadsheetCell = (value: string) => {
  const normalized = value.replace(/\r\n|\r|\n/g, ' ');
  return /^[\s]*[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
};

const csvCell = (value: string | number) => {
  const normalized = typeof value === 'number'
    ? String(value)
    : protectSpreadsheetCell(value);
  return `"${normalized.replace(/"/g, '""')}"`;
};

export const createWeeklyFeedbackReportCsv = (
  report: WeeklyFeedbackReport,
  language: 'zh' | 'en',
  competencyLabels: Record<LearningCompetency, string>,
) => {
  const copy = language === 'en'
    ? {
        section: 'Section', item: 'Item', value: 'Value', summary: 'Summary',
        period: 'Period', positive: 'Positive feedback', negative: 'Support feedback',
        ratio: 'Positive ratio', coverage: 'Feedback coverage', collaboration: 'Collaboration reach',
        mentor: 'Mentor daily feedback', selfAssessment: 'Student self-assessments',
        pointSource: 'Point feedback', evidenceSource: 'Learning evidence',
        competency: 'Competency', reason: 'Reason', overlooked: 'Overlooked student',
        positiveGap: 'Needs positive feedback', mentorSupport: 'Mentor-marked support need',
        trend: 'Trend vs. previous week', count: 'Count',
      }
    : {
        section: '區段', item: '項目', value: '數值', summary: '摘要',
        period: '週次', positive: '正向回饋', negative: '需支持回饋',
        ratio: '正向比例', coverage: '回饋覆蓋', collaboration: '合作參與',
        mentor: '導師每日評語', selfAssessment: '學生自評',
        pointSource: '積分回饋', evidenceSource: '學習證據',
        competency: '能力分布', reason: '原因分布', overlooked: '未被關注學生',
        positiveGap: '尚無正向回饋', mentorSupport: '導師標記需要協助',
        trend: '較前週趨勢', count: '次數',
      };
  const rows: Array<Array<string | number>> = [
    [copy.section, copy.item, copy.value],
    [copy.summary, copy.period, `${report.weekStartDate} ~ ${report.weekEndDate}`],
    [copy.summary, copy.positive, report.positiveCount],
    [copy.summary, copy.negative, report.negativeCount],
    [copy.summary, copy.ratio, `${Math.round(report.positiveRatio * 100)}%`],
    [
      copy.summary,
      copy.coverage,
      `${report.feedbackStudents} / ${report.rosterStudents} (${Math.round(report.feedbackCoverageRate * 100)}%)`,
    ],
    [
      copy.summary,
      copy.collaboration,
      `${report.collaborationStudents} / ${report.rosterStudents} (${Math.round(report.collaborationRate * 100)}%)`,
    ],
    [copy.summary, copy.mentor, report.mentorFeedbackCount],
    [copy.summary, copy.selfAssessment, report.studentSelfAssessmentCount],
    [copy.summary, copy.pointSource, report.sourceCounts.pointFeedback],
    [copy.summary, copy.evidenceSource, report.sourceCounts.learningEvidence],
    [copy.trend, copy.positive, report.positiveFeedbackTrend],
    [copy.trend, copy.negative, report.negativeFeedbackTrend],
    [copy.trend, `${copy.coverage} (pp)`, Math.round(report.feedbackCoverageRateTrend * 100)],
    [copy.trend, copy.collaboration, report.collaborationTrend],
    ...LEARNING_COMPETENCIES.map((competency) => [
      copy.competency,
      competencyLabels[competency],
      report.competencyCounts[competency],
    ] as Array<string | number>),
    ...report.reasonCounts.map((reason) => [copy.reason, reason.label, reason.count]),
    ...report.overlookedStudents.map((student) => [copy.overlooked, student.name, '']),
    ...report.needsPositiveFeedbackStudents.map((student) => [copy.positiveGap, student.name, '']),
    ...report.needsSupportMentorFeedbackStudents.map((student) => [
      copy.mentorSupport,
      student.name,
      competencyLabels[student.competency],
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
};
