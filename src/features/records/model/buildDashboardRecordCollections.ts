import type {
  BossRewardRecord,
  DailyReflection,
  DisciplineRecord,
  PointAdjustmentRecord,
  Student,
} from '../../../store/types';

export type DisciplineRecordWithStudent = DisciplineRecord & {
  studentId: string;
  studentName: string;
};

export type PointAdjustmentRecordWithStudent = PointAdjustmentRecord & {
  studentId: string;
  studentName: string;
};

export type DailyFeedbackRecordWithStudent = DailyReflection & {
  studentId: string;
  studentName: string;
};

export type BossRewardRecordWithStudent = BossRewardRecord & {
  studentId: string;
  studentName: string;
};

const byMostRecent = (left: { createdAt: number }, right: { createdAt: number }) =>
  right.createdAt - left.createdAt;

/**
 * Builds the bounded, newest-first collections consumed by the records UI.
 * Keeping this transformation outside React makes its ordering and attribution
 * independently testable without duplicating the underlying record contracts.
 */
export const buildDashboardRecordCollections = (students: Student[]) => ({
  disciplineRecords: students
    .flatMap((student): DisciplineRecordWithStudent[] =>
      (student.disciplineRecords ?? []).map((record) => ({
        ...record,
        studentId: student.id,
        studentName: student.name,
      })),
    )
    .sort(byMostRecent)
    .slice(0, 12),
  pointAdjustmentRecords: students
    .flatMap((student): PointAdjustmentRecordWithStudent[] =>
      (student.pointAdjustmentRecords ?? []).map((record) => ({
        ...record,
        studentId: student.id,
        studentName: student.name,
      })),
    )
    .sort(byMostRecent)
    .slice(0, 12),
  dailyFeedbackRecords: students
    .flatMap((student): DailyFeedbackRecordWithStudent[] =>
      (student.dailyProgress?.reflections ?? []).map((record) => ({
        ...record,
        studentId: student.id,
        studentName: student.name,
      })),
    )
    .sort(byMostRecent)
    .slice(0, 30),
  bossRewardRecords: students
    .flatMap((student): BossRewardRecordWithStudent[] =>
      (student.bossRewardRecords ?? []).map((record) => ({
        ...record,
        studentId: student.id,
        studentName: student.name,
      })),
    )
    .sort(byMostRecent)
    .slice(0, 12),
});
