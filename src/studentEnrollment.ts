import type { Student } from './store/types';

export type StudentEnrollmentInput =
  Pick<Student, 'id' | 'name'> &
  Partial<Omit<Student, 'id' | 'name' | 'pet'>> & {
    pet?: Partial<Student['pet']>;
  };

/**
 * Canonicalizes a newly enrolled student before it enters workspace state.
 *
 * Both single-student enrollment and roster import use this factory so initial
 * game state cannot drift between UI entry points and the store boundary.
 */
export const createEnrolledStudent = (
  student: StudentEnrollmentInput,
): Student => ({
  ...student,
  points: 200,
  pet: {
    fullness: 80,
    happiness: 80,
    level: 1,
    ...student.pet,
    type: 'egg',
  },
  stats: { wins: 0, losses: 0 },
  rankPoints: 0,
  warningPoints: 0,
  nextUpgradeGachaLevel: 2,
  penaltyStatus: undefined,
  disciplineRecords: [],
  pointAdjustmentRecords: [],
  economyEventRecords: [],
  bossRewardRecords: [],
  dailyProgress: { streak: 0 },
  bossRecovery: undefined,
  teamId: undefined,
  badges: [],
});
