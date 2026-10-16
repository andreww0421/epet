import { normalizeArchivedAt } from '../../../../shared/domain/classArchive';
import { compareExamRecords, computeExamStudentAnalysis } from '../../../examAnalytics';
import type {
  BossRewardRecord,
  ClassData,
  DailyReflection,
  DisciplineRecord,
  EconomyEventRecord,
  ExamRecord,
  PointAdjustmentRecord,
  Student,
} from '../../../store/types';

type StudentHistoryIdentity = { studentId: string; studentName: string };

export type ArchivedStudentHistoryEntry = StudentHistoryIdentity & (
  | { kind: 'points'; record: PointAdjustmentRecord }
  | { kind: 'reflection'; record: DailyReflection }
  | { kind: 'penalty'; record: DisciplineRecord }
  | { kind: 'boss'; record: BossRewardRecord }
  | { kind: 'economy'; record: EconomyEventRecord }
);

/** Read-only projection: no normalization, expiry, gameplay calculation or time advancement. */
export const getArchivedClassHistory = (classroom: ClassData) => {
  const archivedAt = normalizeArchivedAt(classroom.archivedAt);
  if (archivedAt === undefined) return null;
  const activities: ArchivedStudentHistoryEntry[] = [];
  for (const student of classroom.students) {
    const identity = { studentId: student.id, studentName: student.name };
    for (const record of student.pointAdjustmentRecords ?? []) activities.push({ ...identity, kind: 'points', record });
    for (const record of student.dailyProgress?.reflections ?? []) activities.push({ ...identity, kind: 'reflection', record });
    for (const record of student.disciplineRecords ?? []) activities.push({ ...identity, kind: 'penalty', record });
    for (const record of student.bossRewardRecords ?? []) activities.push({ ...identity, kind: 'boss', record });
    for (const record of student.economyEventRecords ?? []) activities.push({ ...identity, kind: 'economy', record });
  }
  return {
    archivedAt,
    students: classroom.students,
    goals: [...(classroom.classGoals ?? [])].sort((left, right) => right.createdAt - left.createdAt),
    evidence: [...(classroom.learningEvidenceRecords ?? [])].sort((left, right) => right.createdAt - left.createdAt),
    exams: [...(classroom.examRecords ?? [])].sort((left, right) => compareExamRecords(right, left)),
    activities: activities.sort((left, right) => right.record.createdAt - left.record.createdAt),
    boss: classroom.activeBoss,
  };
};

/** Delegate all score, trend and class-average semantics to the existing exam domain. */
export const getArchivedExamAnalyses = (exams: ExamRecord[], examId: string, students: Student[]) =>
  students.map((student) => ({
    student,
    analysis: computeExamStudentAnalysis(exams, examId, student.id),
  }));
