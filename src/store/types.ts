import {
  WorldBoss, PenaltyStatus, DisciplineRecord, PointAdjustmentRecord, DailyProgress,
  PointAdjustmentSource, BossRewardTier, BossContributionStanding,
  BossRewardRecord, LearningCompetency, ClassGoal, BossAttackMode, BossReward,
  DailyReflection, MentorDailyFeedbackInput, DailyAssessment, DailySelfAssessment,
} from '../gameRules';
import type {
  LearningEvidenceInput,
  LearningEvidenceLevel,
  LearningEvidenceRecord,
  LearningEvidenceType,
} from '../../shared/education';

export type {
  WorldBoss, PenaltyStatus, DisciplineRecord, PointAdjustmentRecord, DailyProgress,
  PointAdjustmentSource, BossRewardTier, BossContributionStanding,
  BossRewardRecord, LearningCompetency, ClassGoal, BossAttackMode, BossReward,
  DailyReflection, MentorDailyFeedbackInput, DailyAssessment, DailySelfAssessment,
  LearningEvidenceInput, LearningEvidenceLevel, LearningEvidenceRecord, LearningEvidenceType,
};

export type Pet = {
  type: string;
  fullness: number;
  happiness: number;
  level: number;
  isDead?: boolean;
  zeroFullnessSince?: number;
};

export type StudentStats = {
  wins: number;
  losses: number;
};

export type Student = {
  id: string;
  name: string;
  points: number;
  pet: Pet;
  stats?: StudentStats;
  rankPoints?: number;
  warningPoints?: number;
  activeWarningTimestamps?: number[];
  nextUpgradeGachaLevel?: number | null;
  penaltyStatus?: PenaltyStatus;
  disciplineRecords?: DisciplineRecord[];
  pointAdjustmentRecords?: PointAdjustmentRecord[];
  bossRewardRecords?: BossRewardRecord[];
  dailyProgress?: DailyProgress;
  lastBossDamage?: number;
  lastBossFairScore?: number;
  teamId?: string;
  teammateId?: string;
  badges?: string[];
};

export type UpgradeRewardState = {
  studentId: string;
  studentName: string;
  reachedLevel: number;
};

export type PetAnimationMode = 'feed' | 'play' | 'gacha' | 'reroll' | 'attack';

export type Language = 'zh' | 'en';
export type BattleMode = 'solo' | 'team' | 'both';
export type PublicNameMode = 'full' | 'masked';
export type PublicLeaderboardMode = 'growth' | 'rank' | 'hidden';
export type PetCareMode = 'rest' | 'death';

export type ClassData = {
  id: string;
  name: string;
  students: Student[];
  activeBoss?: WorldBoss;
  classGoals?: ClassGoal[];
  learningEvidenceRecords?: LearningEvidenceRecord[];
};

export type AppData = {
  lastOpened: number;
  classes: ClassData[];
  currentClassId: string;
  settings?: {
    decayAmount: number;
    decayType: 'hourly' | 'daily';
    inclusiveMode?: boolean;
    pauseDecayOnWeekends?: boolean;
    petCareMode?: PetCareMode;
    publicNameMode?: PublicNameMode;
    publicLeaderboardMode?: PublicLeaderboardMode;
    language?: Language;
    feedCost?: number;
    feedGain?: number;
    playCost?: number;
    playGain?: number;
    battleEnabled?: boolean;
    battleMode?: BattleMode;
    maxTeamSize?: number;
    maxPoints?: number;
    rankBrackets?: { diamond: number, platinum: number, gold: number, silver: number };
    battleRankPointsWin?: number;
    battleRankPointsLoss?: number;
    soloBattleFullnessCost?: number;
    soloBattleAttackerFullnessCost?: number;
    soloBattleDefenderFullnessCost?: number;
    soloBattleWinPoints?: number;
    soloBattleLossPoints?: number;
    teamBattleMinFullnessEnabled?: boolean;
    teamBattleMinFullness?: number;
    teamBattleAttackerFullnessCost?: number;
    teamBattleAttackerTeammateFullnessCost?: number;
    teamBattleDefenderFullnessCost?: number;
    teamBattleDefenderTeammateFullnessCost?: number;
    bossAttackMaxTargets?: number;
    bossAttackDamage?: number;
    bossAttackMode?: BossAttackMode;
    pointReasonOptions?: PointReasonOption[];
    pinnedReasonIds?: string[];
    recentReasonIds?: string[];
    feedbackReasonHistory?: string[];
    enableSeasonResetRewards?: boolean;
    seasonResetRewards?: { diamond: number, platinum: number, gold: number, silver: number, bronze: number };
    reviveCost?: number;
  };
};

export type PointReasonOption = {
  id: string;
  amount: number;
  labels: Record<Language, string>;
  competency: LearningCompetency;
};

export type BossVictoryResult = {
  bossName: string;
  standings: BossContributionStanding[];
};
