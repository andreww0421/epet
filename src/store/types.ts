import { WorldBoss, PenaltyStatus, DisciplineRecord, PointAdjustmentRecord, DailyProgress, PointAdjustmentSource } from '../gameRules';

export type { WorldBoss, PenaltyStatus, DisciplineRecord, PointAdjustmentRecord, DailyProgress, PointAdjustmentSource };

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
  dailyProgress?: DailyProgress;
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

export type ClassData = {
  id: string;
  name: string;
  students: Student[];
  activeBoss?: WorldBoss;
};

export type AppData = {
  lastOpened: number;
  classes: ClassData[];
  currentClassId: string;
  settings?: {
    decayAmount: number;
    decayType: 'hourly' | 'daily';
    language?: Language;
    feedCost?: number;
    feedGain?: number;
    playCost?: number;
    playGain?: number;
    battleMode?: BattleMode;
    maxTeamSize?: number;
    maxPoints?: number;
    rankBrackets?: { diamond: number, platinum: number, gold: number, silver: number };
    battleRankPointsWin?: number;
    battleRankPointsLoss?: number;
    enableSeasonResetRewards?: boolean;
    seasonResetRewards?: { diamond: number, platinum: number, gold: number, silver: number, bronze: number };
    reviveCost?: number;
  };
};

export type PointReasonOption = {
  id: string;
  amount: number;
  labels: Record<Language, string>;
};
