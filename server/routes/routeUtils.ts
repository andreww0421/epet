import {
  LEARNING_EVIDENCE_LEVELS,
  LEARNING_EVIDENCE_TYPES,
  isLearningCompetency,
  type LearningEvidenceInput,
} from '../../shared/education';
import type { Student, WorldBoss } from '../../src/store/types';

export const isLearningEvidenceInput = (
  value: unknown,
): value is LearningEvidenceInput => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<LearningEvidenceInput>;
  return (
    isLearningCompetency(input.competency) &&
    LEARNING_EVIDENCE_LEVELS.includes(input.level as never) &&
    LEARNING_EVIDENCE_TYPES.includes(input.evidenceType as never) &&
    typeof input.title === 'string' &&
    Boolean(input.title.trim())
  );
};

export const isBossResolutionPayload = (
  students: unknown,
  boss: unknown,
): students is Student[] =>
  Array.isArray(students) &&
  students.every(
    (student) =>
      student &&
      typeof student === 'object' &&
      typeof student.id === 'string' &&
      typeof student.name === 'string' &&
      typeof student.points === 'number' &&
      student.pet &&
      typeof student.pet === 'object' &&
      typeof student.pet.level === 'number',
  ) &&
  Boolean(
    boss &&
    typeof boss === 'object' &&
    typeof (boss as Partial<WorldBoss>).id === 'string' &&
    typeof (boss as Partial<WorldBoss>).name === 'string' &&
    Array.isArray((boss as Partial<WorldBoss>).rewardTiers) &&
    (boss as Partial<WorldBoss>).contributions &&
    typeof (boss as Partial<WorldBoss>).contributions === 'object',
  );

export const getWindowDays = (url: URL) => {
  const value = Number(url.searchParams.get('windowDays'));
  return Number.isFinite(value)
    ? Math.min(180, Math.max(7, Math.floor(value)))
    : 28;
};

export const createStudentPrivacyRecord = (student: Student) => ({
  id: student.id,
  name: student.name,
  points: student.points,
  pet: student.pet,
  stats: student.stats,
  rankPoints: student.rankPoints,
  warningPoints: student.warningPoints,
  activeWarningTimestamps: student.activeWarningTimestamps,
  nextUpgradeGachaLevel: student.nextUpgradeGachaLevel,
  penaltyStatus: student.penaltyStatus,
  disciplineRecords: student.disciplineRecords,
  pointAdjustmentRecords: student.pointAdjustmentRecords,
  bossRewardRecords: student.bossRewardRecords,
  dailyProgress: student.dailyProgress,
  lastBossDamage: student.lastBossDamage,
  lastBossFairScore: student.lastBossFairScore,
  badges: student.badges,
});
