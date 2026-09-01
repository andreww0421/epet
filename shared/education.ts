export const LEARNING_COMPETENCIES = [
  'participation',
  'collaboration',
  'selfManagement',
  'assignmentQuality',
  'growth',
] as const;

export type LearningCompetency = (typeof LEARNING_COMPETENCIES)[number];

export const isLearningCompetency = (value: unknown): value is LearningCompetency =>
  LEARNING_COMPETENCIES.includes(value as LearningCompetency);

export const LEARNING_EVIDENCE_LEVELS = [
  'needsSupport',
  'progressing',
  'mastered',
] as const;

export type LearningEvidenceLevel = (typeof LEARNING_EVIDENCE_LEVELS)[number];

export const LEARNING_EVIDENCE_TYPES = [
  'observation',
  'assignment',
  'reflection',
  'project',
  'assessment',
] as const;

export type LearningEvidenceType = (typeof LEARNING_EVIDENCE_TYPES)[number];
export type LearningEvidenceActor = 'mentor' | 'system';
export type LearningEvidenceSource = 'manual' | 'mentorDailyFeedback' | 'import';

export type LearningEvidenceRecord = {
  id: string;
  classId: string;
  studentId: string;
  competency: LearningCompetency;
  level: LearningEvidenceLevel;
  evidenceType: LearningEvidenceType;
  title: string;
  note?: string;
  actor: LearningEvidenceActor;
  source: LearningEvidenceSource;
  sourceId?: string;
  rubricVersion: string;
  revision: number;
  createdAt: number;
};

export type LearningEvidenceInput = Pick<
  LearningEvidenceRecord,
  'competency' | 'level' | 'evidenceType' | 'title'
> & {
  note?: string;
  actor?: LearningEvidenceActor;
  source?: LearningEvidenceSource;
  sourceId?: string;
  rubricVersion?: string;
};

export type MentorFeedbackEvidenceInput = {
  id: string;
  competency: LearningCompetency;
  assessment?: 'needsSupport' | 'progressing' | 'confident';
  text?: string;
  createdAt: number;
};

export type CompetencyLearningSummary = {
  competency: LearningCompetency;
  evidenceCount: number;
  latestLevel?: LearningEvidenceLevel;
  latestAt?: number;
  trend: -1 | 0 | 1;
};

export type StudentLearningAnalytics = {
  studentId: string;
  studentName: string;
  windowDays: number;
  evidenceCount: number;
  previousEvidenceCount: number;
  evidenceTrend: number;
  masteredCount: number;
  progressingCount: number;
  needsSupportCount: number;
  competencyBreadth: number;
  competencySummaries: CompetencyLearningSummary[];
  recentEvidence: LearningEvidenceRecord[];
  needsSupportCompetencies: LearningCompetency[];
};

export type ClassEffectivenessMetrics = {
  windowDays: number;
  evidenceCount: number;
  previousEvidenceCount: number;
  evidenceTrend: number;
  studentsWithEvidence: number;
  coverageRate: number;
  progressingOrMasteredRate: number;
  masteryRate: number;
  goalAlignedEvidenceCount: number;
  goalAlignmentRate: number;
  supportRecoveryCount: number;
  competencyBreadth: number;
  overlookedStudentIds: string[];
};

type StudentLike = {
  id: string;
  name: string;
};

type GoalLike = {
  competency: LearningCompetency;
  createdAt: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const levelScore: Record<LearningEvidenceLevel, number> = {
  needsSupport: 0,
  progressing: 1,
  mastered: 2,
};

const toSafeText = (value: unknown, maxLength: number) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const toSafeTimestamp = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const createLearningEvidenceRecord = (
  classId: string,
  studentId: string,
  input: LearningEvidenceInput,
  now = Date.now(),
  id = `evidence-${now}-${Math.random().toString(36).slice(2, 8)}`,
  revision = 1,
): LearningEvidenceRecord => ({
  id,
  classId,
  studentId,
  competency: input.competency,
  level: input.level,
  evidenceType: input.evidenceType,
  title: input.title.trim().slice(0, 100),
  note: input.note?.trim().slice(0, 500) || undefined,
  actor: input.actor ?? 'mentor',
  source: input.source ?? 'manual',
  sourceId: input.sourceId?.trim().slice(0, 120) || undefined,
  rubricVersion: input.rubricVersion?.trim().slice(0, 40) || '1.0',
  revision: Math.max(1, Math.floor(revision)),
  createdAt: now,
});

export const createMentorFeedbackEvidenceRecord = (
  classId: string,
  studentId: string,
  feedback: MentorFeedbackEvidenceInput,
  existingRecords: LearningEvidenceRecord[] = [],
  rubricVersion = '1.0',
): LearningEvidenceRecord => {
  const previousRevision = Math.max(
    0,
    ...existingRecords
      .filter(
        (record) =>
          record.source === 'mentorDailyFeedback' &&
          record.sourceId === feedback.id,
      )
      .map((record) => record.revision),
  );
  const revision = previousRevision + 1;
  const text = feedback.text?.trim() || 'Mentor daily feedback';

  return createLearningEvidenceRecord(
    classId,
    studentId,
    {
      competency: feedback.competency,
      level:
        feedback.assessment === 'needsSupport'
          ? 'needsSupport'
          : feedback.assessment === 'confident'
            ? 'mastered'
            : 'progressing',
      evidenceType: 'observation',
      title: text,
      note: feedback.text,
      actor: 'mentor',
      source: 'mentorDailyFeedback',
      sourceId: feedback.id,
      rubricVersion,
    },
    feedback.createdAt,
    revision === 1 ? `evidence-${feedback.id}` : `evidence-${feedback.id}-${revision}`,
    revision,
  );
};

export const normalizeLearningEvidenceRecords = (
  value: unknown,
  classId: string,
  validStudentIds?: Set<string>,
  now = Date.now(),
): LearningEvidenceRecord[] => {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();

  return value
    .map((item, index): LearningEvidenceRecord | null => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Partial<LearningEvidenceRecord>;
      const id = toSafeText(raw.id, 120) || `evidence-import-${now}-${index}`;
      const studentId = toSafeText(raw.studentId, 120);
      const normalizedClassId = toSafeText(raw.classId, 120) || classId;
      if (
        seenIds.has(id) ||
        !studentId ||
        normalizedClassId !== classId ||
        (validStudentIds && !validStudentIds.has(studentId)) ||
        !isLearningCompetency(raw.competency) ||
        !LEARNING_EVIDENCE_LEVELS.includes(raw.level as LearningEvidenceLevel) ||
        !LEARNING_EVIDENCE_TYPES.includes(raw.evidenceType as LearningEvidenceType)
      ) {
        return null;
      }
      const title = toSafeText(raw.title, 100);
      if (!title) return null;
      seenIds.add(id);
      return {
        id,
        classId,
        studentId,
        competency: raw.competency,
        level: raw.level as LearningEvidenceLevel,
        evidenceType: raw.evidenceType as LearningEvidenceType,
        title,
        note: toSafeText(raw.note, 500) || undefined,
        actor: raw.actor === 'system' ? 'system' : 'mentor',
        source:
          raw.source === 'mentorDailyFeedback' || raw.source === 'import'
            ? raw.source
            : 'manual',
        sourceId: toSafeText(raw.sourceId, 120) || undefined,
        rubricVersion: toSafeText(raw.rubricVersion, 40) || '1.0',
        revision: Math.max(1, Math.floor(Number(raw.revision) || 1)),
        createdAt: toSafeTimestamp(raw.createdAt, now),
      };
    })
    .filter((record): record is LearningEvidenceRecord => Boolean(record))
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 2000);
};

export const getActiveLearningEvidence = (
  records: LearningEvidenceRecord[],
): LearningEvidenceRecord[] => {
  const latestBySource = new Map<string, LearningEvidenceRecord>();
  const standalone: LearningEvidenceRecord[] = [];

  records.forEach((record) => {
    if (!record.sourceId) {
      standalone.push(record);
      return;
    }
    const key = `${record.source}:${record.sourceId}`;
    const current = latestBySource.get(key);
    if (
      !current ||
      record.revision > current.revision ||
      (record.revision === current.revision && record.createdAt > current.createdAt)
    ) {
      latestBySource.set(key, record);
    }
  });

  return [...standalone, ...latestBySource.values()].sort(
    (left, right) => right.createdAt - left.createdAt,
  );
};

const getCompetencyTrend = (
  records: LearningEvidenceRecord[],
): -1 | 0 | 1 => {
  if (records.length < 2) return 0;
  const latest = records[0];
  const previous = records[1];
  const delta = levelScore[latest.level] - levelScore[previous.level];
  return delta === 0 ? 0 : delta > 0 ? 1 : -1;
};

export const computeStudentLearningAnalytics = (
  student: StudentLike,
  evidence: LearningEvidenceRecord[],
  now = Date.now(),
  windowDays = 28,
): StudentLearningAnalytics => {
  const safeWindowDays = Math.max(1, Math.floor(windowDays));
  const since = now - safeWindowDays * DAY_MS;
  const previousSince = since - safeWindowDays * DAY_MS;
  const active = getActiveLearningEvidence(evidence)
    .filter((record) => record.studentId === student.id);
  const recent = active.filter((record) => record.createdAt >= since);
  const previous = active.filter(
    (record) => record.createdAt >= previousSince && record.createdAt < since,
  );
  const competencySummaries = LEARNING_COMPETENCIES.map((competency) => {
    const competencyEvidence = active.filter((record) => record.competency === competency);
    return {
      competency,
      evidenceCount: competencyEvidence.length,
      latestLevel: competencyEvidence[0]?.level,
      latestAt: competencyEvidence[0]?.createdAt,
      trend: getCompetencyTrend(competencyEvidence),
    };
  });

  return {
    studentId: student.id,
    studentName: student.name,
    windowDays: safeWindowDays,
    evidenceCount: recent.length,
    previousEvidenceCount: previous.length,
    evidenceTrend: recent.length - previous.length,
    masteredCount: recent.filter((record) => record.level === 'mastered').length,
    progressingCount: recent.filter((record) => record.level === 'progressing').length,
    needsSupportCount: recent.filter((record) => record.level === 'needsSupport').length,
    competencyBreadth: competencySummaries.filter((summary) => summary.evidenceCount > 0).length,
    competencySummaries,
    recentEvidence: recent.slice(0, 12),
    needsSupportCompetencies: competencySummaries
      .filter((summary) => summary.latestLevel === 'needsSupport')
      .map((summary) => summary.competency),
  };
};

export const computeClassEffectivenessMetrics = (
  students: StudentLike[],
  evidence: LearningEvidenceRecord[],
  goals: GoalLike[] = [],
  now = Date.now(),
  windowDays = 28,
): ClassEffectivenessMetrics => {
  const safeWindowDays = Math.max(1, Math.floor(windowDays));
  const since = now - safeWindowDays * DAY_MS;
  const previousSince = since - safeWindowDays * DAY_MS;
  const studentIds = new Set(students.map((student) => student.id));
  const active = getActiveLearningEvidence(evidence)
    .filter((record) => studentIds.has(record.studentId));
  const recent = active.filter((record) => record.createdAt >= since);
  const previous = active.filter(
    (record) => record.createdAt >= previousSince && record.createdAt < since,
  );
  const studentsWithEvidence = new Set(recent.map((record) => record.studentId));
  const activeGoals = goals.filter((goal) => goal.createdAt <= now);
  const goalAlignedEvidenceCount = recent.filter((record) =>
    activeGoals.some(
      (goal) =>
        goal.competency === record.competency &&
        record.createdAt >= goal.createdAt,
    ),
  ).length;
  const grouped = new Map<string, LearningEvidenceRecord[]>();
  active
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .forEach((record) => {
      const key = `${record.studentId}:${record.competency}`;
      grouped.set(key, [...(grouped.get(key) ?? []), record]);
    });
  let supportRecoveryCount = 0;
  grouped.forEach((records) => {
    const firstSupportIndex = records.findIndex((record) => record.level === 'needsSupport');
    if (
      firstSupportIndex >= 0 &&
      records.slice(firstSupportIndex + 1).some((record) => record.level !== 'needsSupport')
    ) {
      supportRecoveryCount += 1;
    }
  });
  const progressingOrMastered = recent.filter(
    (record) => record.level === 'progressing' || record.level === 'mastered',
  ).length;

  return {
    windowDays: safeWindowDays,
    evidenceCount: recent.length,
    previousEvidenceCount: previous.length,
    evidenceTrend: recent.length - previous.length,
    studentsWithEvidence: studentsWithEvidence.size,
    coverageRate: students.length > 0 ? studentsWithEvidence.size / students.length : 0,
    progressingOrMasteredRate:
      recent.length > 0 ? progressingOrMastered / recent.length : 0,
    masteryRate:
      recent.length > 0
        ? recent.filter((record) => record.level === 'mastered').length / recent.length
        : 0,
    goalAlignedEvidenceCount,
    goalAlignmentRate:
      recent.length > 0 ? goalAlignedEvidenceCount / recent.length : 0,
    supportRecoveryCount,
    competencyBreadth: new Set(recent.map((record) => record.competency)).size,
    overlookedStudentIds: students
      .filter((student) => !studentsWithEvidence.has(student.id))
      .map((student) => student.id),
  };
};
