import type { LearningCompetency } from '../../../shared/education';
import type { EconomyEventKind, EconomyEventSource } from './economyEventCatalog';

export type { LearningCompetency } from '../../../shared/education';
export type { EconomyEventKind, EconomyEventSource } from './economyEventCatalog';

export type PenaltyStatusSource = 'autoPenalty' | 'discipline';

export type DisciplineRecordType =
  | 'warning'
  | 'autoPenalty'
  | 'discipline'
  | 'levelDecrease'
  | 'reversal';

export type SafetyActionKind = 'discipline' | 'levelDecrease';

export type SafetyActionSnapshot = {
  points: number;
  rankPoints: number;
  fullness: number;
  happiness: number;
  level: number;
  warningPoints?: number;
  activeWarningTimestamps?: number[];
  penaltyStatus?: PenaltyStatus;
};

export type SafetyActionEffect = {
  before: SafetyActionSnapshot;
  after: SafetyActionSnapshot;
};

export type DisciplineRecord = {
  id: string;
  type: DisciplineRecordType;
  createdAt: number;
  warningCount?: number;
  reason?: string;
  actionKind?: SafetyActionKind;
  reversesRecordId?: string;
  safetyEffect?: SafetyActionEffect;
};

export type PointAdjustmentSource =
  | 'quick'
  | 'manual'
  | 'airdrop'
  | 'dailyTask'
  | 'participationTopUp'
  | 'catchUpBonus';

export type PointGuardrailOutcome = 'applied' | 'clamped' | 'blocked';
export type PointGuardrailReason = 'dailyPositiveLimit' | 'dailyNegativeLimit';

export type PointGuardrailOptions = {
  enabled?: boolean;
  timeZone?: string;
  dailyPositiveLimit?: number;
  dailyNegativeLimit?: number;
};

export type PointGuardrailResult = {
  requestedAmount: number;
  appliedAmount: number;
  outcome: PointGuardrailOutcome;
  reason?: PointGuardrailReason;
  usedAmount: number;
  remainingAmount: number;
};

export type ParticipationSupportOptions = {
  enabled?: boolean;
  timeZone?: string;
  minimumDailyParticipationPoints?: number;
  catchUpGapThreshold?: number;
  dailyCatchUpBonus?: number;
};

export type ParticipationSupportPlan = {
  participationTopUp: number;
  catchUpBonus: number;
  classMedianPoints: number;
  gapAfterBaseReward: number;
};

export type ClassGoal = {
  id: string;
  title: string;
  competency: LearningCompetency;
  targetCount: number;
  createdAt: number;
  weekStartDate?: string;
};

export type PointAdjustmentRecord = {
  id: string;
  amount: number;
  createdAt: number;
  source: PointAdjustmentSource;
  reasonId?: string;
  reasonLabel?: string;
  competency?: LearningCompetency;
  effectiveDate?: string;
  claimKind?: DailyTaskClaimKind;
  requestedAmount?: number;
  guardrailOutcome?: Exclude<PointGuardrailOutcome, 'applied'>;
  guardrailReason?: PointGuardrailReason;
};

export type EconomyEventRecord = {
  id: string;
  kind: EconomyEventKind;
  source: EconomyEventSource;
  amount: number;
  createdAt: number;
  referenceId?: string;
  previousPetType?: string;
  newPetType?: string;
};

export type DailyTaskClaimKind = 'current' | 'makeup';

export type DailyTaskCalendarOptions = {
  timeZone?: string;
  schoolWeekdays?: number[];
  holidayDates?: string[];
  excusedDates?: string[];
  makeupWindowDays?: number;
};

export type DailyTaskClaimPlan = {
  schoolDate: string;
  targetDate?: string;
  claimKind?: DailyTaskClaimKind;
  alreadyClaimed: boolean;
  frozen: boolean;
};

export type PenaltyStatus = {
  source: PenaltyStatusSource;
  until: number;
};

export type DailyProgress = {
  lastClaimDate?: string;
  streak: number;
  reflections?: DailyReflection[];
  excusedDates?: string[];
};

export type DailyAssessment = 'needsSupport' | 'progressing' | 'confident';
export type DailySelfAssessment = DailyAssessment;

export type DailyReflection = {
  id: string;
  date: string;
  createdAt: number;
  competency: LearningCompetency;
  author?: 'student' | 'mentor';
  selfAssessment?: DailyAssessment;
  mentorAssessment?: DailyAssessment;
  text?: string;
};

export type MentorDailyFeedbackInput = {
  competency: LearningCompetency;
  assessment: DailyAssessment;
  text: string;
};

export type BossRecoveryStatus = {
  impact: number;
  startedAt: number;
  recoverAt: number;
};

export type StudentRuleState = {
  points: number;
  rankPoints?: number;
  warningPoints?: number;
  activeWarningTimestamps?: number[];
  pet: {
    fullness: number;
    happiness: number;
    level: number;
    isDead?: boolean;
    zeroFullnessSince?: number;
  };
  stats?: {
    wins: number;
    losses: number;
  };
  nextUpgradeGachaLevel?: number | null;
  penaltyStatus?: PenaltyStatus;
  disciplineRecords?: DisciplineRecord[];
  pointAdjustmentRecords?: PointAdjustmentRecord[];
  economyEventRecords?: EconomyEventRecord[];
  bossRewardRecords?: BossRewardRecord[];
  dailyProgress?: DailyProgress;
  bossRecovery?: BossRecoveryStatus;
  lastBossDamage?: number;
  lastBossFairScore?: number;
};

export type PenaltyAmounts = {
  points: number;
  fullness: number;
  happiness: number;
  rankPoints: number;
};

export type WorldBoss = {
  id: string;
  name: string;
  maxHp: number;
  currentHp: number;
  rewardTiers: BossRewardTier[];
  participationReward?: BossReward;
  improvementReward?: BossReward;
  contributions: Record<string, number>;
  attackCounts?: Record<string, number>;
  isActive: boolean;
};

export type BossAttackMode = 'recoverable' | 'shared' | 'random';

export type BossReward = {
  points: number;
  happiness: number;
  rankPoints: number;
};

export type BossRewardStep = BossReward;

export type BossRewardTier = {
  rank: number;
  points: number;
  happiness: number;
  rankPoints: number;
};

export type BossContributionStanding = {
  rank: number;
  studentId: string;
  studentName: string;
  damage: number;
  attackCount: number;
  fairScore: number;
  previousDamage: number;
  previousFairScore: number;
  improvementAmount: number;
  fairImprovementAmount: number;
  rewardPoints: number;
  rewardRankPoints: number;
  rewardHappiness: number;
  rankRewardPoints: number;
  rankRewardRankPoints: number;
  rankRewardHappiness: number;
  participationRewardPoints: number;
  participationRewardRankPoints: number;
  participationRewardHappiness: number;
  improvementRewardPoints: number;
  improvementRewardRankPoints: number;
  improvementRewardHappiness: number;
  receivedImprovementReward: boolean;
};

export type BossRewardRecord = Omit<BossContributionStanding, 'studentId' | 'studentName'> & {
  id: string;
  bossId: string;
  bossName: string;
  createdAt: number;
};

export type BattleOutcome = 'win' | 'loss' | 'draw';

export type TeamBattleMember<TStudent extends StudentRuleState> = {
  id: string;
  student: TStudent;
};

export type TeamBattleReward = {
  winnerIds: string[];
  bonusPoints: number;
  bonusHappiness: number;
};

export type BattleReadyOptions = {
  minimumFullness?: number;
  ignoreFullness?: boolean;
};

export type BattleResolutionOptions = {
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
};
