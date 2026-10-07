import { getActiveLearningEvidence } from '../../../../shared/education';
import {
  getLatestPositiveFeedback,
  getNextStudentGoal,
  getRecordCompetency,
} from '../../../educationInsights';
import {
  BOSS_ATTACK_FULLNESS_COST,
  DAILY_TASK_REWARD_POINTS,
  PET_GACHA_COST,
  PET_MAX_LEVEL,
  PET_UPGRADE_FULLNESS_REQUIREMENT,
  PET_UPGRADE_MIN_HAPPINESS,
  SOLO_BATTLE_MIN_FULLNESS,
  clamp,
  getActiveClassGoals,
  getBossAttackBlockedReason,
  getDailyTaskClaimPlan,
  getPetUpgradeBlockedReason,
  getPetUpgradeCost,
  isBattleReady,
  isBossRecoveryActive,
  isPenaltyActive,
  isPetDead,
  type DailyTaskClaimPlan,
} from '../../../gameRules';
import type {
  BattleMode,
  ClassGoal,
  Language,
  LearningCompetency,
  LearningEvidenceRecord,
  PetAnimationMode,
  PointReasonOption,
  PublicNameMode,
  Student,
} from '../../../store/types';
import { computeBadges } from '../../../store/utils';
import { getPublicStudentName } from '../../../studentPresentation';

export type PetCardSettings = {
  lang: Language;
  feedCost: number;
  playCost: number;
  reviveCost: number;
  maxPoints: number;
  /** Retains the existing settings subscription cadence for the connected card. */
  maxTeamSize: number;
  battleEnabled: boolean;
  battleMode: BattleMode;
  inclusiveMode: boolean;
  petCareMode: 'rest' | 'death';
  publicNameMode: PublicNameMode;
  teamBattleMinFullnessEnabled: boolean;
  teamBattleMinFullness: number;
  schoolTimeZone?: string;
  schoolWeekdays?: number[];
  schoolHolidayDates?: string[];
  dailyTaskMakeupWindowDays?: number;
  pointReasonOptions?: PointReasonOption[];
};

export type PetCondition = 'dead' | 'resting' | 'hungry' | 'normal' | 'happy';
export type PetEvolutionStage = 1 | 2 | 3;

export type PetAnimationState = {
  mode?: PetAnimationMode;
  isReroll: boolean;
  isGacha: boolean;
  isFeed: boolean;
  isPlay: boolean;
  isAttack: boolean;
  isAnimating: boolean;
};

export type PetLearningSummary = {
  nextGoal: ReturnType<typeof getNextStudentGoal>;
  weeklyGoalsCompleted: boolean;
  latestPositiveSource: 'point' | 'evidence' | null;
  latestPositiveReason?: string;
  latestPositiveCompetency?: LearningCompetency;
  hasLatestPositiveSummary: boolean;
  shouldDisplay: boolean;
};

export type PetActionWarnings = {
  show: boolean;
  feedNeedsPoints: boolean;
  playNeedsPoints: boolean;
  battleDisabled: boolean;
  battleBlockedByPenalty: boolean;
  battleBlockedByMood: boolean;
  battleBlockedByFullness: boolean;
  upgradeNeedsFullness: boolean;
  upgradeNeedsPoints: boolean;
  upgradeBlockedByMood: boolean;
};

export type PetCardActionState = {
  feedCost: number;
  playCost: number;
  reviveCost: number;
  upgradeCost: number;
  gachaCost: number;
  bossAttackCost: number;
  dailyTaskRewardPoints: number;
  canFeed: boolean;
  canPlay: boolean;
  canUpgrade: boolean;
  canGacha: boolean;
  canRevive: boolean;
  canBattle: boolean;
  canAttackBoss: boolean;
  hasUpgradeReward: boolean;
  dailyTaskPlan: DailyTaskClaimPlan;
  dailyTaskUnavailable: boolean;
  battleEnabled: boolean;
  battleMode: BattleMode;
  teamBattleMinFullnessEnabled: boolean;
  teamBattleMinFullness: number;
  bossIsActive: boolean;
  warnings: PetActionWarnings;
};

export type PetCardModel = {
  studentId: string;
  language: Language;
  publicStudentName: string;
  points: number;
  maxPoints: number;
  warningPoints: number;
  streak: number;
  teammateName?: string;
  hasActivePenalty: boolean;
  hasBossRecovery: boolean;
  bossRecoveryMinutes: number;
  pet: {
    type: string;
    level: number;
    fullness: number;
    happiness: number;
    happinessPercent: number;
    rankPoints: number;
    isDead: boolean;
    isResting: boolean;
    isLowMood: boolean;
    isHappy: boolean;
    isNormal: boolean;
    isHungry: boolean;
    isStrong: boolean;
    condition: PetCondition;
    evolutionStage: PetEvolutionStage;
  };
  animation: PetAnimationState;
  badges: string[];
  learning: PetLearningSummary;
  actions: PetCardActionState;
};

export type BuildPetCardModelInput = {
  student: Student;
  settings: PetCardSettings;
  bossIsActive: boolean;
  classGoals: ClassGoal[];
  learningEvidence: LearningEvidenceRecord[];
  animationMode?: PetAnimationMode;
  teammateName?: string;
  now: number;
};

const getAnimationState = (mode?: PetAnimationMode): PetAnimationState => {
  const isReroll = mode === 'reroll';
  const isGacha = mode === 'gacha';
  const isFeed = mode === 'feed';
  const isPlay = mode === 'play';
  const isAttack = mode === 'attack';
  return {
    mode,
    isReroll,
    isGacha,
    isFeed,
    isPlay,
    isAttack,
    isAnimating: isFeed || isPlay || isReroll || isGacha || isAttack,
  };
};

const getLearningSummary = (
  student: Student,
  settings: PetCardSettings,
  classGoals: ClassGoal[],
  learningEvidence: LearningEvidenceRecord[],
  now: number,
): PetLearningSummary => {
  const activeClassGoals = getActiveClassGoals(
    classGoals,
    now,
    settings.schoolTimeZone,
  );
  const nextGoal = getNextStudentGoal(student, activeClassGoals, learningEvidence);
  const weeklyGoalsCompleted = activeClassGoals.length > 0 && !nextGoal;
  const latestPositiveEvidence = getActiveLearningEvidence(learningEvidence)
    .find((record) => record.studentId === student.id && record.level !== 'needsSupport');
  const latestPointFeedback = getLatestPositiveFeedback(student);
  const configuredPointReason = latestPointFeedback?.reasonId
    ? settings.pointReasonOptions?.find((reason) => reason.id === latestPointFeedback.reasonId)
    : undefined;
  const latestPositiveCompetency = latestPointFeedback
    ? getRecordCompetency(latestPointFeedback)
    : latestPositiveEvidence?.competency;
  const latestPositiveReason = latestPointFeedback
    ? configuredPointReason
      ? latestPointFeedback.reasonLabel ?? configuredPointReason.labels[settings.lang]
      : !settings.inclusiveMode || latestPointFeedback.source === 'dailyTask'
        ? latestPointFeedback.reasonLabel
        : undefined
    : !settings.inclusiveMode
      ? latestPositiveEvidence?.title
      : undefined;
  const hasLatestPositiveSummary = Boolean(
    latestPositiveReason || latestPositiveCompetency,
  );

  return {
    nextGoal,
    weeklyGoalsCompleted,
    latestPositiveSource: latestPointFeedback
      ? 'point'
      : latestPositiveEvidence
        ? 'evidence'
        : null,
    latestPositiveReason,
    latestPositiveCompetency,
    hasLatestPositiveSummary,
    shouldDisplay: Boolean(nextGoal || weeklyGoalsCompleted || hasLatestPositiveSummary),
  };
};

export const buildPetCardModel = ({
  student,
  settings,
  bossIsActive,
  classGoals,
  learningEvidence,
  animationMode,
  teammateName,
  now,
}: BuildPetCardModelInput): PetCardModel => {
  const level = student.pet.level ?? 1;
  const happiness = student.pet.happiness ?? 80;
  const fullness = student.pet.fullness;
  const rankPoints = student.rankPoints ?? 0;
  const warningPoints = student.warningPoints ?? 0;
  const nextUpgradeGachaLevel = student.nextUpgradeGachaLevel === undefined
    ? 2
    : student.nextUpgradeGachaLevel;
  const petIsDead = isPetDead(student.pet);
  const petIsResting = settings.petCareMode === 'rest' && fullness <= 0 && !petIsDead;
  const isLowMood = happiness < 30;
  const isHappy = fullness > 70 && !isLowMood;
  const isNormal = fullness >= 30 && fullness <= 70 && !isLowMood;
  const isHungry = fullness < 30 || isLowMood;
  const hasActivePenalty = isPenaltyActive(student.penaltyStatus, now);
  const hasBossRecovery = isBossRecoveryActive(student.bossRecovery, now);
  const bossRecoveryMinutes = hasBossRecovery
    ? Math.max(
        1,
        Math.ceil(((student.bossRecovery?.recoverAt ?? now) - now) / 60_000),
      )
    : 0;
  const soloBattleReady = isBattleReady(student, now, {
    minimumFullness: SOLO_BATTLE_MIN_FULLNESS,
  });
  const teamBattleReady = isBattleReady(student, now, {
    minimumFullness: settings.teamBattleMinFullness,
    ignoreFullness: !settings.teamBattleMinFullnessEnabled,
  });
  const canBattle = settings.battleEnabled && (
    settings.battleMode === 'team'
      ? teamBattleReady
      : settings.battleMode === 'solo'
        ? soloBattleReady
        : soloBattleReady || teamBattleReady
  );
  const upgradeCost = getPetUpgradeCost(level);
  const canUpgrade = getPetUpgradeBlockedReason(student, { requireAlive: true }) === null;
  const canFeed = student.points >= settings.feedCost && !petIsDead;
  const canPlay = student.points >= settings.playCost && !petIsDead && !petIsResting;
  const canGacha = student.points >= PET_GACHA_COST && !petIsDead;
  const canRevive = student.points >= settings.reviveCost;
  const canAttackBoss = getBossAttackBlockedReason(student, now) === null;
  const hasUpgradeReward = nextUpgradeGachaLevel !== null && level >= nextUpgradeGachaLevel;
  const dailyTaskPlan = getDailyTaskClaimPlan(student, now, {
    timeZone: settings.schoolTimeZone,
    schoolWeekdays: settings.schoolWeekdays,
    holidayDates: settings.schoolHolidayDates,
    excusedDates: student.dailyProgress?.excusedDates,
    makeupWindowDays: settings.dailyTaskMakeupWindowDays,
  });
  const battleBlockedByFullness = settings.battleEnabled &&
    !canBattle &&
    !hasActivePenalty &&
    !isLowMood &&
    !petIsDead && (
      (settings.battleMode === 'solo' && fullness < SOLO_BATTLE_MIN_FULLNESS) ||
      (
        settings.battleMode === 'team' &&
        settings.teamBattleMinFullnessEnabled &&
        fullness < settings.teamBattleMinFullness
      ) ||
      (
        settings.battleMode === 'both' &&
        fullness < SOLO_BATTLE_MIN_FULLNESS &&
        settings.teamBattleMinFullnessEnabled &&
        fullness < settings.teamBattleMinFullness
      )
    );
  const warnings: PetActionWarnings = {
    show:
      (!canFeed && fullness < 100) ||
      (!canPlay && happiness < 100) ||
      !canBattle ||
      (!canUpgrade && level < PET_MAX_LEVEL),
    feedNeedsPoints: !canFeed && fullness < 100,
    playNeedsPoints: !canPlay && happiness < 100,
    battleDisabled: !settings.battleEnabled,
    battleBlockedByPenalty:
      settings.battleEnabled && !canBattle && hasActivePenalty,
    battleBlockedByMood:
      settings.battleEnabled && !canBattle && !hasActivePenalty && isLowMood,
    battleBlockedByFullness,
    upgradeNeedsFullness:
      !canUpgrade && level < PET_MAX_LEVEL && fullness < PET_UPGRADE_FULLNESS_REQUIREMENT,
    upgradeNeedsPoints:
      !canUpgrade &&
      level < PET_MAX_LEVEL &&
      fullness >= PET_UPGRADE_FULLNESS_REQUIREMENT &&
      student.points < upgradeCost,
    upgradeBlockedByMood:
      !canUpgrade &&
      level < PET_MAX_LEVEL &&
      fullness >= PET_UPGRADE_FULLNESS_REQUIREMENT &&
      student.points >= upgradeCost &&
      happiness < PET_UPGRADE_MIN_HAPPINESS,
  };
  const condition: PetCondition = petIsDead
    ? 'dead'
    : petIsResting
      ? 'resting'
      : isHungry
        ? 'hungry'
        : isNormal
          ? 'normal'
          : 'happy';
  const evolutionStage: PetEvolutionStage = level >= PET_MAX_LEVEL
    ? 3
    : level >= 5
      ? 2
      : 1;

  return {
    studentId: student.id,
    language: settings.lang,
    publicStudentName: getPublicStudentName(student.name, settings.publicNameMode),
    points: student.points,
    maxPoints: settings.maxPoints,
    warningPoints,
    streak: student.dailyProgress?.streak ?? 0,
    teammateName,
    hasActivePenalty,
    hasBossRecovery,
    bossRecoveryMinutes,
    pet: {
      type: student.pet.type,
      level,
      fullness,
      happiness,
      happinessPercent: clamp(happiness, 0, 100),
      rankPoints,
      isDead: petIsDead,
      isResting: petIsResting,
      isLowMood,
      isHappy,
      isNormal,
      isHungry,
      isStrong: student.points >= 100 || fullness === 100,
      condition,
      evolutionStage,
    },
    animation: getAnimationState(animationMode),
    badges: computeBadges(student),
    learning: getLearningSummary(
      student,
      settings,
      classGoals,
      learningEvidence,
      now,
    ),
    actions: {
      feedCost: settings.feedCost,
      playCost: settings.playCost,
      reviveCost: settings.reviveCost,
      upgradeCost,
      gachaCost: PET_GACHA_COST,
      bossAttackCost: BOSS_ATTACK_FULLNESS_COST,
      dailyTaskRewardPoints: DAILY_TASK_REWARD_POINTS,
      canFeed,
      canPlay,
      canUpgrade,
      canGacha,
      canRevive,
      canBattle,
      canAttackBoss,
      hasUpgradeReward,
      dailyTaskPlan,
      dailyTaskUnavailable: !dailyTaskPlan.targetDate,
      battleEnabled: settings.battleEnabled,
      battleMode: settings.battleMode,
      teamBattleMinFullnessEnabled: settings.teamBattleMinFullnessEnabled,
      teamBattleMinFullness: settings.teamBattleMinFullness,
      bossIsActive,
      warnings,
    },
  };
};
