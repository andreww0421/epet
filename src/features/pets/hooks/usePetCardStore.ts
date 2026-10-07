import { useShallow } from 'zustand/react/shallow';
import {
  TEAM_BATTLE_MIN_FULLNESS,
  TEAM_BATTLE_MIN_FULLNESS_ENABLED,
} from '../../../gameRules';
import {
  DEFAULT_BATTLE_MODE,
  DEFAULT_MAX_TEAM_SIZE,
} from '../../../store/constants';
import type {
  ClassGoal,
  LearningEvidenceRecord,
  PetAnimationMode,
  Student,
} from '../../../store/types';
import { getTeamMembers } from '../../../store/utils';
import { useStore } from '../../../store/useStore';
import { getPublicStudentName } from '../../../studentPresentation';
import type { PetCardSettings } from '../model/petCardModel';

type PetCardStoreState = ReturnType<typeof useStore.getState>;

export type PetCardStoreActions = Pick<
  PetCardStoreState,
  | 'feedPet'
  | 'playWithPet'
  | 'claimDailyTask'
  | 'revivePet'
  | 'upgradePet'
  | 'gachaPet'
  | 'executeAttackBoss'
>;

const EMPTY_CLASS_GOALS: ClassGoal[] = [];
const EMPTY_LEARNING_EVIDENCE: LearningEvidenceRecord[] = [];

const selectStudent = (studentId: string) =>
  (state: PetCardStoreState): Student | undefined =>
    state.data.classes
      .find((classData) => classData.id === state.data.currentClassId)
      ?.students.find((student) => student.id === studentId);

const selectSettings = (state: PetCardStoreState): PetCardSettings => {
  const currentClass = state.data.classes
    .find((classData) => classData.id === state.data.currentClassId);
  const calendar = currentClass?.dailyTaskCalendar;
  return {
    lang: state.data.settings?.language ?? 'zh',
    feedCost: state.data.settings?.feedCost ?? 10,
    playCost: state.data.settings?.playCost ?? 5,
    reviveCost: state.data.settings?.reviveCost ?? 120,
    maxPoints: state.data.settings?.maxPoints ?? 700,
    maxTeamSize: state.data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE,
    battleEnabled: state.data.settings?.battleEnabled !== false,
    battleMode: state.data.settings?.battleMode ?? DEFAULT_BATTLE_MODE,
    inclusiveMode: state.data.settings?.inclusiveMode !== false,
    petCareMode: state.data.settings?.petCareMode === 'death' ? 'death' : 'rest',
    publicNameMode:
      state.data.settings?.publicNameMode === 'full' ? 'full' : 'masked',
    teamBattleMinFullnessEnabled:
      state.data.settings?.teamBattleMinFullnessEnabled ?? TEAM_BATTLE_MIN_FULLNESS_ENABLED,
    teamBattleMinFullness:
      state.data.settings?.teamBattleMinFullness ?? TEAM_BATTLE_MIN_FULLNESS,
    schoolTimeZone:
      calendar?.schoolTimeZone ?? state.data.settings?.schoolTimeZone,
    schoolWeekdays:
      calendar?.schoolWeekdays ?? state.data.settings?.schoolWeekdays,
    schoolHolidayDates:
      calendar?.schoolHolidayDates ?? state.data.settings?.schoolHolidayDates,
    dailyTaskMakeupWindowDays:
      calendar?.dailyTaskMakeupWindowDays ??
      state.data.settings?.dailyTaskMakeupWindowDays,
    pointReasonOptions: state.data.settings?.pointReasonOptions,
  };
};

// Preserve the legacy render cadence: boss updates also refresh time-derived UI.
const selectActiveBoss = (state: PetCardStoreState) =>
  state.data.classes
    .find((classData) => classData.id === state.data.currentClassId)
    ?.activeBoss;

const selectClassGoals = (state: PetCardStoreState): ClassGoal[] =>
  state.data.classes
    .find((classData) => classData.id === state.data.currentClassId)
    ?.classGoals ?? EMPTY_CLASS_GOALS;

const selectLearningEvidence = (
  state: PetCardStoreState,
): LearningEvidenceRecord[] =>
  state.data.classes
    .find((classData) => classData.id === state.data.currentClassId)
    ?.learningEvidenceRecords ?? EMPTY_LEARNING_EVIDENCE;

const selectAnimation = (studentId: string) =>
  (state: PetCardStoreState): PetAnimationMode | undefined =>
    state.animatingPets[studentId];

const selectTeammateName = (studentId: string) =>
  (state: PetCardStoreState): string | undefined => {
    const currentClass = state.data.classes
      .find((classData) => classData.id === state.data.currentClassId);
    if (!currentClass) return undefined;
    const student = currentClass.students
      .find((candidate) => candidate.id === studentId);
    if (!student?.teamId) return undefined;

    const maxTeamSize = state.data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE;
    const publicNameMode = state.data.settings?.publicNameMode === 'full'
      ? 'full'
      : 'masked';
    return getTeamMembers(currentClass.students, student, maxTeamSize)
      .filter((member) => member.id !== studentId)
      .map((member) => getPublicStudentName(member.name, publicNameMode))
      .join(', ') || undefined;
  };

const selectActions = (state: PetCardStoreState): PetCardStoreActions => ({
  feedPet: state.feedPet,
  playWithPet: state.playWithPet,
  claimDailyTask: state.claimDailyTask,
  revivePet: state.revivePet,
  upgradePet: state.upgradePet,
  gachaPet: state.gachaPet,
  executeAttackBoss: state.executeAttackBoss,
});

/** Focused store subscriptions for one pet card; no presentation logic lives here. */
export const usePetCardStore = (studentId: string) => ({
  student: useStore(selectStudent(studentId)),
  settings: useStore(useShallow(selectSettings)),
  activeBoss: useStore(selectActiveBoss),
  classGoals: useStore(selectClassGoals),
  learningEvidence: useStore(selectLearningEvidence),
  animationMode: useStore(selectAnimation(studentId)),
  teammateName: useStore(selectTeammateName(studentId)),
  actions: useStore(useShallow(selectActions)),
});
