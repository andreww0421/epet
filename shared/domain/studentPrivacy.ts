import type { AppData, Student } from '../../src/store/types';
import { isDateKey } from '../../src/domain/game/calendarRules';
import { isPetType } from '../../src/domain/game/petCatalog';
import { isLearningCompetency } from '../education';

export const STUDENT_PRIVACY_CONFIRMATIONS = {
  delete: 'DELETE STUDENT',
  anonymize: 'ANONYMIZE STUDENT',
} as const;

export type StudentPrivacyAction = keyof typeof STUDENT_PRIVACY_CONFIRMATIONS;

const collectStudentIds = (data: AppData | null): Set<string> => new Set(
  data?.classes.flatMap((classroom) =>
    classroom.students.map((student) => student.id),
  ) ?? [],
);

export const findPermanentlyDeletedStudentIds = (
  previous: AppData | null,
  next: AppData,
): Set<string> => {
  const nextIds = collectStudentIds(next);
  return new Set(
    [...collectStudentIds(previous)].filter(
      (studentId) => !nextIds.has(studentId),
    ),
  );
};

export const purgeStudentsFromWorkspaceData = (
  data: AppData,
  deletedStudentIds: ReadonlySet<string>,
): AppData => {
  if (deletedStudentIds.size === 0) return data;
  return {
    ...data,
    classes: data.classes.map((classroom, classIndex) => {
      // Legacy team IDs can contain a student ID/name. Replace the opaque ID
      // for every remaining member, preserving group membership rather than
      // leaving an identifying team identifier in retained snapshots.
      const affectedTeamIds = [...new Set(classroom.students
        .filter((student) => deletedStudentIds.has(student.id) && student.teamId)
        .map((student) => student.teamId as string))];
      const existingTeamIds = new Set(classroom.students.map((student) => student.teamId));
      const replacementTeams = new Map(affectedTeamIds.map((teamId, teamIndex) => {
        let replacement = `privacy-team-${classIndex}-${teamIndex}`;
        while (existingTeamIds.has(replacement)) replacement += '-redacted';
        existingTeamIds.add(replacement);
        return [teamId, replacement] as const;
      }));
      return {
      ...classroom,
      students: classroom.students
        .filter((student) => !deletedStudentIds.has(student.id))
        .map((student) => deletedStudentIds.has(student.teammateId ?? '')
          ? { ...student, teammateId: undefined, teamId: undefined }
          : student.teamId && replacementTeams.has(student.teamId)
            ? { ...student, teamId: replacementTeams.get(student.teamId) }
            : student),
      learningEvidenceRecords: classroom.learningEvidenceRecords?.filter(
        (record) => !deletedStudentIds.has(record.studentId),
      ),
      examRecords: classroom.examRecords?.map((exam) => ({
        ...exam,
        results: exam.results.filter(
          (result) => !deletedStudentIds.has(result.studentId),
        ),
      })),
      activeBoss: classroom.activeBoss
        ? {
            ...classroom.activeBoss,
            contributions: Object.fromEntries(
              Object.entries(classroom.activeBoss.contributions).filter(
                ([studentId]) => !deletedStudentIds.has(studentId),
              ),
            ),
            attackCounts: classroom.activeBoss.attackCounts
              ? Object.fromEntries(
                  Object.entries(classroom.activeBoss.attackCounts).filter(
                    ([studentId]) => !deletedStudentIds.has(studentId),
                  ),
                )
              : undefined,
          }
        : undefined,
      };
    }),
  };
};

// Copy only declared fields. Import extensions and newly added free-text fields
// must be explicitly reviewed before they can survive de-identification.
const pickFields = <T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Pick<T, K> => Object.fromEntries(
  keys.map((key) => [key, value[key]]),
) as Pick<T, K>;

const deidentifyStudent = (student: Student, replacementId: string): Student => {
  const identifiers = new Map<string, string>();
  const replaceIdentifier = (value: string) => {
    const existing = identifiers.get(value);
    if (existing) return existing;
    const replacement = `${replacementId}-record-${identifiers.size + 1}`;
    identifiers.set(value, replacement);
    return replacement;
  };
  const copyPenalty = (status: Student['penaltyStatus']) => status
    ? pickFields(status, ['source', 'until'])
    : undefined;
  const copySafetySnapshot = (
    snapshot: NonNullable<NonNullable<Student['disciplineRecords']>[number]['safetyEffect']>['before'],
  ) => ({
    ...pickFields(snapshot, [
      'points', 'rankPoints', 'fullness', 'happiness', 'level', 'warningPoints',
    ]),
    activeWarningTimestamps: snapshot.activeWarningTimestamps?.slice(),
    penaltyStatus: copyPenalty(snapshot.penaltyStatus),
  });

  return {
    ...pickFields(student, [
      'points', 'rankPoints', 'warningPoints', 'nextUpgradeGachaLevel',
      'lastBossDamage', 'lastBossFairScore', 'teamId', 'teammateId',
    ]),
    id: replacementId,
    name: 'Anonymous student',
    pet: {
      ...pickFields(student.pet, [
        'fullness', 'happiness', 'level', 'isDead', 'zeroFullnessSince',
      ]),
      type: isPetType(student.pet.type) ? student.pet.type : 'egg',
    },
    stats: student.stats ? pickFields(student.stats, ['wins', 'losses']) : undefined,
    activeWarningTimestamps: student.activeWarningTimestamps?.slice(),
    penaltyStatus: copyPenalty(student.penaltyStatus),
    bossRecovery: student.bossRecovery
      ? pickFields(student.bossRecovery, ['impact', 'startedAt', 'recoverAt'])
      : undefined,
    disciplineRecords: student.disciplineRecords?.map((record) => ({
      ...pickFields(record, ['type', 'createdAt', 'warningCount', 'actionKind']),
      id: replaceIdentifier(record.id),
      reversesRecordId: record.reversesRecordId
        ? replaceIdentifier(record.reversesRecordId)
        : undefined,
      safetyEffect: record.safetyEffect ? {
        before: copySafetySnapshot(record.safetyEffect.before),
        after: copySafetySnapshot(record.safetyEffect.after),
      } : undefined,
    })),
    // Retain numeric/source/date history: removing it would reset point limits,
    // daily-claim eligibility, or penalty reversal/cooldown rules.
    pointAdjustmentRecords: student.pointAdjustmentRecords?.map((record) => ({
      ...pickFields(record, [
        'amount', 'createdAt', 'source', 'competency', 'effectiveDate', 'claimKind',
        'requestedAmount', 'guardrailOutcome', 'guardrailReason',
      ]),
      id: replaceIdentifier(record.id),
      effectiveDate: isDateKey(record.effectiveDate) ? record.effectiveDate : undefined,
    })),
    economyEventRecords: student.economyEventRecords?.map((record) => ({
      ...pickFields(record, ['kind', 'source', 'amount', 'createdAt']),
      id: replaceIdentifier(record.id),
      referenceId: record.referenceId ? replaceIdentifier(record.referenceId) : undefined,
      // Pet-change strings are optional historical annotations, not game rules.
    })),
    bossRewardRecords: student.bossRewardRecords?.map((record) => ({
      ...pickFields(record, [
        'createdAt', 'rank', 'damage', 'attackCount', 'fairScore', 'previousDamage',
        'previousFairScore', 'improvementAmount', 'fairImprovementAmount',
        'rewardPoints', 'rewardRankPoints', 'rewardHappiness', 'rankRewardPoints',
        'rankRewardRankPoints', 'rankRewardHappiness', 'participationRewardPoints',
        'participationRewardRankPoints', 'participationRewardHappiness',
        'improvementRewardPoints', 'improvementRewardRankPoints',
        'improvementRewardHappiness', 'receivedImprovementReward',
      ]),
      id: replaceIdentifier(record.id),
      bossId: replaceIdentifier(record.bossId),
      bossName: 'Archived activity',
    })),
    dailyProgress: student.dailyProgress ? {
      streak: student.dailyProgress.streak,
      lastClaimDate: isDateKey(student.dailyProgress.lastClaimDate)
        ? student.dailyProgress.lastClaimDate
        : undefined,
      excusedDates: student.dailyProgress.excusedDates?.filter(isDateKey),
      reflections: student.dailyProgress.reflections?.filter((reflection) =>
        isDateKey(reflection.date) && isLearningCompetency(reflection.competency),
      ).map((reflection) => ({
        ...pickFields(reflection, [
          'date', 'createdAt', 'competency', 'author', 'selfAssessment', 'mentorAssessment',
        ]),
        id: replaceIdentifier(reflection.id),
      })),
    } : undefined,
    badges: student.badges?.filter((badge) => [
      'badgeFirstWin', 'badgeVeteran', 'badgeRich', 'badgeMaxLevel',
    ].includes(badge)),
  };
};

/** De-identify the structured record, not arbitrary mentions in other records. */
export const anonymizeStudentInWorkspaceData = (
  data: AppData,
  studentId: string,
  replacementId: string,
): AppData => {
  if (!replacementId || replacementId === studentId ||
      data.classes.some((classroom) => classroom.students.some(
        (student) => student.id === replacementId,
      ))) {
    throw new Error('Invalid replacement student identifier');
  }
  const purged = purgeStudentsFromWorkspaceData(data, new Set([studentId]));
  return {
    ...purged,
    classes: purged.classes.map((classroom, index) => {
      const original = data.classes[index];
      const affectedTeamIds = new Set(original.students
        .filter((student) => student.id === studentId && student.teamId)
        .map((student) => student.teamId));
      const replaceTeam = (student: Student) => student.teamId && affectedTeamIds.has(student.teamId)
        ? { ...student, teamId: `${replacementId}-team-${index}` }
        : student;
      return {
        ...classroom,
        students: original.students.map((student) => replaceTeam(student.id === studentId
          ? deidentifyStudent(student, replacementId)
          : student.teammateId === studentId
            ? { ...student, teammateId: replacementId }
            : student)),
        activeBoss: classroom.activeBoss && original.activeBoss
          ? {
              ...classroom.activeBoss,
              contributions: {
                ...classroom.activeBoss.contributions,
                ...(Object.hasOwn(original.activeBoss.contributions, studentId)
                  ? { [replacementId]: original.activeBoss.contributions[studentId] }
                  : {}),
              },
              attackCounts: original.activeBoss.attackCounts ? {
                ...classroom.activeBoss.attackCounts,
                ...(Object.hasOwn(original.activeBoss.attackCounts, studentId)
                  ? { [replacementId]: original.activeBoss.attackCounts[studentId] }
                  : {}),
              } : undefined,
            }
          : classroom.activeBoss,
      };
    }),
  };
};
