import type {
  AppData, Student, UpgradeRewardState, PetAnimationMode, PointAdjustmentSource,
  Language, BossRewardTier, BossVictoryResult, ClassGoal, LearningCompetency,
  BossReward, BossAttackMode, MentorDailyFeedbackInput, PointReasonOption,
  LearningEvidenceInput, ExamRecord, ClassDailyTaskCalendar,
} from './types';
import type { PointGuardrailOutcome, SafetyActionKind } from '../gameRules';

/** Root contract only: slices share one AppData tree and one persist owner. */
export type PointAdjustmentReason = {
  id?: string;
  label?: string;
  competency?: LearningCompetency;
};

export type PointUndoEntry = {
  studentId: string;
  recordId: string;
  actualDelta: number;
};

export type PointUndoAction = {
  id: string;
  classId: string;
  label: string;
  expiresAt: number;
  entries: PointUndoEntry[];
};

export type PointGuardrailApplication = {
  studentId: string;
  requestedAmount: number;
  appliedAmount: number;
  outcome: PointGuardrailOutcome;
  participationTopUp: number;
  catchUpBonus: number;
};

export type SafetyUndoAction = {
  id: string;
  classId: string;
  studentId: string;
  originalRecordId: string;
  actionKind: SafetyActionKind;
  label: string;
  expiresAt: number;
};

export type StoreState = {
  data: AppData;
  view: 'dashboard' | 'classroom';
  animatingPets: Record<string, PetAnimationMode | undefined>;
  toast: { message: string; type: 'success' | 'error' } | null;
  upgradeReward: UpgradeRewardState | null;
  bossHitFeedback: { damage: number; id: number } | null;
  bossAttackFeedback: {
    targetNames: string[];
    damage: number;
    id: number;
    mode?: BossAttackMode;
    recoverAt?: number;
  } | null;
  showBossVictory: boolean;
  bossVictoryResult: BossVictoryResult | null;
  undoAction: PointUndoAction | null;
  safetyUndoAction: SafetyUndoAction | null;

  // Actions
  setView: (view: 'dashboard' | 'classroom') => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
  setUpgradeReward: (reward: UpgradeRewardState | null) => void;
  triggerPetAnimation: (studentId: string, mode: PetAnimationMode, durationMs: number) => void;

  // Class / Setup Actions
  switchClass: (classId: string) => void;
  addClass: (name: string) => void;
  deleteClass: (classId: string) => void;
  importData: (importedData: any, now?: number) => void;
  updateSettings: (settings: Partial<NonNullable<AppData['settings']>>) => void;
  updateClassDailyTaskCalendar: (
    classId: string,
    calendar: ClassDailyTaskCalendar,
  ) => void;
  setClassGoal: (
    goal: Pick<ClassGoal, 'title' | 'competency' | 'targetCount'> | null,
    goalId?: string,
  ) => void;
  saveExamRecord: (exam: ExamRecord) => void;
  deleteExamRecord: (examId: string) => void;

  // Student CRUD
  addStudent: (student: Student) => void;
  addStudentsByName: (names: string[]) => number;
  deleteStudent: (studentId: string) => void;
  editStudentName: (studentId: string, newName: string) => void;

  // Student Stats & Discipline
  addPoints: (
    studentId: string,
    pointsToAdd: number,
    source?: PointAdjustmentSource,
    reason?: PointAdjustmentReason,
  ) => void;
  adjustPointsForStudents: (
    studentIds: string[],
    pointsToAdd: number,
    source?: PointAdjustmentSource,
    reason?: PointAdjustmentReason,
  ) => void;
  airdropPoints: (pointsToAdd: number, reasonLabel?: string, competency?: LearningCompetency) => void;
  replacePointReasons: (reasons: PointReasonOption[]) => void;
  togglePinnedReason: (reasonId: string) => void;
  undoLastPointAdjustment: () => void;
  decreaseLevel: (studentId: string, reason?: string) => void;
  warnStudent: (studentId: string) => void;
  removeWarning: (studentId: string) => void;
  disciplineStudent: (studentId: string, reason: string) => void;
  undoLastSafetyAction: () => void;
  removePenalty: (studentId: string) => void;
  resetSeason: () => void;

  // Interactions
  feedPet: (studentId: string) => void;
  playWithPet: (studentId: string) => void;
  claimDailyTask: (studentId: string) => boolean;
  setDailyTaskExcusedDate: (studentId: string, date: string, excused: boolean) => void;
  saveMentorDailyFeedback: (studentId: string, feedback: MentorDailyFeedbackInput) => void;
  addLearningEvidence: (studentId: string, evidence: LearningEvidenceInput) => void;
  revivePet: (studentId: string) => void;
  upgradePet: (studentId: string) => void;
  gachaPet: (studentId: string) => void;
  rerollPetFromUpgrade: (studentId: string, claimedLevel: number) => void;
  advanceUpgradeRewardProgress: (studentId: string, claimedLevel: number) => void;

  // Team & Battle
  setTeammate: (studentId: string, teammateIds?: string[]) => void;
  battle: (attackerId: string, defenderId: string) => void;

  // Boss
  summonBoss: (
    name: string,
    maxHp: number,
    rewardTiers: BossRewardTier[],
    participationReward?: BossReward,
    improvementReward?: BossReward,
  ) => void;
  removeBoss: () => void;
  executeAttackBoss: (studentId: string) => Promise<void>;
  executeBossAttack: () => void;
  clearBossRecovery: () => void;
  dismissBossVictory: () => void;

  // Lifecycle
  triggerDecay: () => void;
};
