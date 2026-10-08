import { petNames } from '../../../i18n/translations';
import { isArchivedClass } from '../../../../shared/domain/classArchive';
import { getPublicStudentName } from '../../../studentPresentation';
import type { AppData, ClassData, Language, Student } from '../../../store/types';
import { sortStudentsByRank } from './classroomModels';

export type ClassroomPresentationOptions = {
  maskNames: boolean;
  inclusiveLeaderboard: boolean;
};

export type ClassroomPresentationStudent = {
  displayName: string;
  petType: keyof typeof petNames.zh;
  level: number;
  rankPoints?: number;
};

export type ClassroomPresentationModel = {
  language: Language;
  students: ClassroomPresentationStudent[];
  leaderboard: {
    mode: 'hidden' | 'inclusive' | 'rank';
    students: ClassroomPresentationStudent[];
  };
  boss: { hp: number; maxHp: number } | null;
};

const isTrustedPetType = (value: string): value is ClassroomPresentationStudent['petType'] =>
  Object.prototype.hasOwnProperty.call(petNames.zh, value);

const finiteNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * An explicit display allowlist, not an authentication boundary. Never pass a
 * stored student, record, goal or arbitrary feedback string through this DTO.
 * Local display options can strengthen, but never override, persisted policy.
 */
export const buildClassroomPresentation = (
  classData: ClassData | undefined,
  settings: AppData['settings'],
  options: ClassroomPresentationOptions,
): ClassroomPresentationModel => {
  const language: Language = settings?.language === 'en' ? 'en' : 'zh';
  const inclusiveMode = settings?.inclusiveMode !== false;
  const nameMode = !inclusiveMode && settings?.publicNameMode === 'full' && options.maskNames === false
    ? 'full' : 'masked';
  const requestedLeaderboard = settings?.publicLeaderboardMode;
  const leaderboardAuthorized = requestedLeaderboard === 'growth' || requestedLeaderboard === 'rank';
  const ranked = requestedLeaderboard === 'rank' && !inclusiveMode && options.inclusiveLeaderboard === false;
  const leaderboardMode = !leaderboardAuthorized ? 'hidden' : ranked ? 'rank' : 'inclusive';
  const displayedClass = classData && !isArchivedClass(classData) ? classData : undefined;
  const roster = displayedClass?.students ?? [];
  const projectStudent = (student: Student): ClassroomPresentationStudent => {
    const petType = isTrustedPetType(student.pet.type) ? student.pet.type : 'egg';
    const level = Math.max(1, Math.trunc(finiteNumber(student.pet.level, 1)));
    const displayName = getPublicStudentName(student.name, nameMode) || (language === 'en' ? 'Learner' : '學生');
    return {
      displayName, petType, level,
      ...(ranked ? { rankPoints: finiteNumber(student.rankPoints, 0) } : {}),
    };
  };
  const activeBoss = displayedClass?.activeBoss;
  const maxHp = finiteNumber(activeBoss?.maxHp, 0);
  const boss = activeBoss?.isActive === true && maxHp > 0 &&
    typeof activeBoss.currentHp === 'number' && Number.isFinite(activeBoss.currentHp) ? {
    hp: Math.max(0, Math.min(maxHp, finiteNumber(activeBoss.currentHp, 0))),
    maxHp,
  } : null;

  return {
    language,
    students: roster.map(projectStudent),
    leaderboard: {
      mode: leaderboardMode,
      students: !leaderboardAuthorized ? [] : (ranked ? sortStudentsByRank(roster) : roster).map(projectStudent),
    },
    boss,
  };
};
