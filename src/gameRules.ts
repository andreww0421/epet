import {
  LEARNING_COMPETENCIES,
  isLearningCompetency,
  type LearningCompetency,
} from '../shared/education';

export {
  LEARNING_COMPETENCIES,
  isLearningCompetency,
  type LearningCompetency,
} from '../shared/education';

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

export const LEVEL_DECREASE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const hasActiveLevelDecreaseCooldown = (
  records: DisciplineRecord[] | undefined,
  now = Date.now(),
) => {
  const reversedRecordIds = new Set(
    (records ?? [])
      .filter((record) => record.type === 'reversal' && record.reversesRecordId)
      .map((record) => record.reversesRecordId as string),
  );
  return (records ?? []).some((record) =>
    record.type === 'levelDecrease' &&
    !reversedRecordIds.has(record.id) &&
    record.createdAt > now - LEVEL_DECREASE_COOLDOWN_MS,
  );
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

export const ECONOMY_EVENT_KINDS = [
  'issuance',
  'spend',
  'petChange',
] as const;

export type EconomyEventKind = (typeof ECONOMY_EVENT_KINDS)[number];

export const ECONOMY_EVENT_SOURCES = [
  'feed',
  'play',
  'upgrade',
  'gacha',
  'upgradeReroll',
  'revive',
  'soloBattle',
  'teamBattle',
  'bossReward',
] as const;

export type EconomyEventSource = (typeof ECONOMY_EVENT_SOURCES)[number];

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

export const isEconomyEventKind = (value: unknown): value is EconomyEventKind =>
  ECONOMY_EVENT_KINDS.includes(value as EconomyEventKind);

export const isEconomyEventSource = (value: unknown): value is EconomyEventSource =>
  ECONOMY_EVENT_SOURCES.includes(value as EconomyEventSource);

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

export type DailyTaskReflectionInput = {
  competency: LearningCompetency;
  assessment: DailySelfAssessment;
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

export const UPGRADE_GACHA_LEVEL_SEQUENCE = [2, 4, 6, 8] as const;
export const UPGRADE_GACHA_LEVELS = new Set<number>(UPGRADE_GACHA_LEVEL_SEQUENCE);
export const UPGRADE_REWARD_LEVEL = 2;
export const UPGRADE_REWARD_FULLNESS = 30;
export const UPGRADE_REWARD_HAPPINESS = 25;
export const WARNING_THRESHOLD = 3;
export const WARNING_AUTO_PENALTY: PenaltyAmounts = { points: 20, fullness: 15, happiness: 10, rankPoints: 15 };
export const DIRECT_DISCIPLINE_PENALTY: PenaltyAmounts = { points: 30, fullness: 20, happiness: 15, rankPoints: 30 };
export const PENALTY_DURATION_MS: Record<PenaltyStatusSource, number> = {
  autoPenalty: 1000 * 60 * 60 * 24,
  discipline: 1000 * 60 * 60 * 48,
};
export const MAX_ACTIVITY_RECORDS = 20;
export const MAX_POINT_ADJUSTMENT_RECORDS = 200;
export const MAX_BOSS_REWARD_RECORDS = 100;
export const MAX_DAILY_REFLECTIONS = 60;
export const MAX_ECONOMY_EVENT_RECORDS = 240;
export const PET_DEATH_DELAY_MS = 1000 * 60 * 60 * 24;
export const REVIVE_COST = 120;
export const DAILY_TASK_REWARD_POINTS = 30;
export const DAILY_TASK_REWARD_HAPPINESS = 8;
export const DEFAULT_SCHOOL_TIME_ZONE = 'Asia/Taipei';
export const DEFAULT_SCHOOL_WEEKDAYS = [1, 2, 3, 4, 5];
export const DEFAULT_DAILY_TASK_MAKEUP_WINDOW_DAYS = 7;
export const DEFAULT_DAILY_POSITIVE_POINT_LIMIT = 200;
export const DEFAULT_DAILY_NEGATIVE_POINT_LIMIT = 60;
export const DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET = 3;
export const DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS = 20;
export const DEFAULT_CATCH_UP_GAP_THRESHOLD = 100;
export const DEFAULT_DAILY_CATCH_UP_BONUS = 10;
export const SOLO_BATTLE_MIN_FULLNESS = 50;
export const SOLO_BATTLE_FULLNESS_COST = 50;
export const SOLO_BATTLE_WIN_POINTS = 50;
export const SOLO_BATTLE_LOSS_POINTS = 60;
export const TEAM_BATTLE_SUPPORT_WEIGHT = 0.65;
export const TEAM_BATTLE_SYNERGY_BONUS = 12;
export const TEAM_BATTLE_WIN_POINTS = 30;
export const TEAM_BATTLE_LOSS_POINTS = 15;
export const TEAM_BATTLE_WIN_RANK_POINTS = 12;
export const TEAM_BATTLE_LOSS_RANK_POINTS = 6;
export const TEAM_BATTLE_MIN_FULLNESS_ENABLED = true;
export const TEAM_BATTLE_MIN_FULLNESS = 50;
export const TEAM_BATTLE_ATTACKER_FULLNESS_COST = 30;
export const TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST = 20;
export const TEAM_BATTLE_DEFENDER_FULLNESS_COST = 35;
export const TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST = 20;
export const TEAM_BATTLE_TEAM_BONUS_POINTS = 10;
export const TEAM_BATTLE_TEAM_BONUS_HAPPINESS = 6;
export const BOSS_ATTACK_FULLNESS_COST = 20;
export const FAIR_BOSS_RANKING_ATTACK_CAP = 3;
export const DEFAULT_BOSS_ATTACK_MAX_TARGETS = 4;
export const DEFAULT_BOSS_ATTACK_DAMAGE = 20;
export const DEFAULT_BOSS_RECOVERY_MINUTES = 15;
export const MAX_BOSS_RECOVERY_MINUTES = 120;
export const DEFAULT_BOSS_PARTICIPATION_REWARD: BossReward = { points: 10, happiness: 5, rankPoints: 5 };
export const DEFAULT_BOSS_IMPROVEMENT_REWARD: BossReward = { points: 15, happiness: 5, rankPoints: 5 };
export const DEFAULT_BOSS_REWARD_TIERS: BossRewardTier[] = [
  { rank: 1, points: 100, happiness: 30, rankPoints: 30 },
  { rank: 2, points: 70, happiness: 20, rankPoints: 20 },
  { rank: 3, points: 50, happiness: 10, rankPoints: 10 },
];

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBossRewardStep = (step: BossRewardStep): BossRewardStep => ({
  points: Math.max(0, Math.floor(toFiniteNumber(step.points, 0))),
  happiness: Math.max(0, Math.floor(toFiniteNumber(step.happiness, 0))),
  rankPoints: Math.max(0, Math.floor(toFiniteNumber(step.rankPoints, 0))),
});

export const createAutomatedBossRewardTier = (
  tiers: BossRewardTier[],
  rank: number,
  step: BossRewardStep,
): BossRewardTier => {
  const safeRank = Math.max(1, Math.floor(toFiniteNumber(rank, 1)));
  const safeStep = normalizeBossRewardStep(step);
  const sorted = tiers
    .slice()
    .sort((left, right) => left.rank - right.rank);
  const existing = sorted.find((tier) => tier.rank === safeRank);
  if (existing) return { ...existing };
  const lowerTiers = sorted.filter((tier) => tier.rank < safeRank);
  const lower = lowerTiers[lowerTiers.length - 1];
  const higher = sorted.find((tier) => tier.rank > safeRank);
  const anchor = lower ?? higher;
  if (!anchor) {
    return { rank: safeRank, points: 0, happiness: 0, rankPoints: 0 };
  }

  const distance = Math.abs(safeRank - anchor.rank);
  const direction = lower ? -1 : 1;
  return {
    rank: safeRank,
    points: Math.max(0, anchor.points + direction * safeStep.points * distance),
    happiness: Math.max(0, anchor.happiness + direction * safeStep.happiness * distance),
    rankPoints: Math.max(0, anchor.rankPoints + direction * safeStep.rankPoints * distance),
  };
};

export const recalculateBossRewardTiers = (
  tiers: BossRewardTier[],
  step: BossRewardStep,
) => {
  const sorted = tiers
    .slice()
    .sort((left, right) => left.rank - right.rank);
  if (sorted.length === 0) return [];
  const safeStep = normalizeBossRewardStep(step);
  const base = sorted[0];
  return sorted.map((tier) => {
    const distance = Math.max(0, tier.rank - base.rank);
    return {
      rank: tier.rank,
      points: Math.max(0, base.points - safeStep.points * distance),
      happiness: Math.max(0, base.happiness - safeStep.happiness * distance),
      rankPoints: Math.max(0, base.rankPoints - safeStep.rankPoints * distance),
    };
  });
};

export const getUpcomingUpgradeGachaLevel = (currentLevel: number) =>
  UPGRADE_GACHA_LEVEL_SEQUENCE.find((level) => level >= currentLevel) ?? null;

export const getNextUpgradeGachaLevel = (claimedLevel: number) =>
  UPGRADE_GACHA_LEVEL_SEQUENCE.find((level) => level > claimedLevel) ?? null;

export const createDisciplineRecord = (
  type: DisciplineRecordType,
  warningCount?: number,
  now = Date.now(),
  details: Pick<
    DisciplineRecord,
    'reason' | 'actionKind' | 'reversesRecordId' | 'safetyEffect'
  > = {},
): DisciplineRecord => ({
  id: `record-${now}-${Math.random().toString(36).slice(2, 8)}`,
  type,
  createdAt: now,
  warningCount,
  ...details,
});

export const createPointAdjustmentRecord = (
  amount: number,
  source: PointAdjustmentSource,
  reason?: { id?: string; label?: string; competency?: LearningCompetency },
  now = Date.now(),
  audit?: Pick<
    PointAdjustmentRecord,
    | 'effectiveDate'
    | 'claimKind'
    | 'requestedAmount'
    | 'guardrailOutcome'
    | 'guardrailReason'
  >,
): PointAdjustmentRecord => ({
  id: `points-${now}-${Math.random().toString(36).slice(2, 8)}`,
  amount,
  createdAt: now,
  source,
  reasonId: reason?.id,
  reasonLabel: reason?.label,
  competency: reason?.competency,
  ...(audit?.effectiveDate ? { effectiveDate: audit.effectiveDate } : {}),
  ...(audit?.claimKind ? { claimKind: audit.claimKind } : {}),
  ...(audit?.requestedAmount != null ? { requestedAmount: audit.requestedAmount } : {}),
  ...(audit?.guardrailOutcome ? { guardrailOutcome: audit.guardrailOutcome } : {}),
  ...(audit?.guardrailReason ? { guardrailReason: audit.guardrailReason } : {}),
});

export const createEconomyEventRecord = (
  kind: EconomyEventKind,
  source: EconomyEventSource,
  amount: number,
  now = Date.now(),
  details: Pick<
    EconomyEventRecord,
    'referenceId' | 'previousPetType' | 'newPetType'
  > = {},
): EconomyEventRecord => ({
  id: `economy-${now}-${Math.random().toString(36).slice(2, 8)}`,
  kind,
  source,
  amount: Math.trunc(toFiniteNumber(amount, 0)),
  createdAt: now,
  ...(details.referenceId ? { referenceId: details.referenceId } : {}),
  ...(details.previousPetType ? { previousPetType: details.previousPetType } : {}),
  ...(details.newPetType ? { newPetType: details.newPetType } : {}),
});

export const appendRecord = <T extends { createdAt: number }>(
  records: T[] | undefined,
  record: T,
  limit = MAX_ACTIVITY_RECORDS,
) => [record, ...(records ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);

export const appendEconomyEventToStudent = <T extends StudentRuleState>(
  student: T,
  record: EconomyEventRecord,
) => ({
  ...student,
  economyEventRecords: appendRecord(
    student.economyEventRecords,
    record,
    MAX_ECONOMY_EVENT_RECORDS,
  ),
});

const appendEconomyDelta = <T extends StudentRuleState>(
  before: T,
  after: T,
  source: EconomyEventSource,
  now: number,
): T => {
  const amount = Math.trunc(after.points - before.points);
  if (amount === 0) return after;
  return appendEconomyEventToStudent(
    after,
    createEconomyEventRecord(amount > 0 ? 'issuance' : 'spend', source, amount, now),
  ) as T;
};

export const createPenaltyStatus = (source: PenaltyStatusSource, now = Date.now()): PenaltyStatus => ({
  source,
  until: now + PENALTY_DURATION_MS[source],
});

export const normalizePenaltyStatus = (raw: unknown, now = Date.now()): PenaltyStatus | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = (raw as { source?: string }).source;
  const until = toFiniteNumber((raw as { until?: unknown }).until, 0);
  if ((source !== 'autoPenalty' && source !== 'discipline') || until <= now) {
    return undefined;
  }
  return { source, until };
};

export const isPenaltyActive = (penaltyStatus: PenaltyStatus | undefined, now = Date.now()) =>
  Boolean(penaltyStatus && penaltyStatus.until > now);

export const getBattleBlockedReason = <T extends StudentRuleState>(
  student: T,
  now = Date.now(),
  options: BattleReadyOptions = {},
) => {
  if (isPetDead(student.pet)) return 'dead' as const;
  if (isPenaltyActive(student.penaltyStatus, now)) return 'penalty' as const;
  if (student.pet.happiness < 30) return 'happiness' as const;
  if (!options.ignoreFullness && student.pet.fullness < (options.minimumFullness ?? SOLO_BATTLE_MIN_FULLNESS)) {
    return 'fullness' as const;
  }
  return null;
};

export const getTeamBattleReadyOptions = (
  options?: Pick<BattleResolutionOptions, 'teamBattleMinFullnessEnabled' | 'teamBattleMinFullness'>,
): BattleReadyOptions => ({
  minimumFullness: Math.max(0, toFiniteNumber(options?.teamBattleMinFullness, TEAM_BATTLE_MIN_FULLNESS)),
  ignoreFullness: options?.teamBattleMinFullnessEnabled === false,
});

export const isBattleReady = <T extends StudentRuleState>(
  student: T,
  now = Date.now(),
  options: BattleReadyOptions = {},
) => {
  return getBattleBlockedReason(student, now, options) == null;
};

const getBattlePower = <T extends StudentRuleState>(student: T, roll: number) =>
  student.pet.level * 12 + student.pet.fullness * 0.7 + student.pet.happiness * 0.35 + roll;

const getTeamBattleScore = <T extends StudentRuleState>(
  members: Array<TeamBattleMember<T>>,
  rolls: number[],
) => {
  const leaderPower = members[0] ? getBattlePower(members[0].student, rolls[0] ?? 0) : 0;
  const supportPower = members.slice(1).reduce((total, member, index) => {
    return total + getBattlePower(member.student, rolls[index + 1] ?? 0) * TEAM_BATTLE_SUPPORT_WEIGHT;
  }, 0);
  const synergyBonus = members.length > 1 ? TEAM_BATTLE_SYNERGY_BONUS : 0;

  return Math.round(leaderPower + supportPower + synergyBonus);
};

export const isDateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const normalizeDateKeyList = (value: unknown, limit = 366) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isDateKey))).sort().slice(0, limit);
};

export const normalizeSchoolTimeZone = (value: unknown) => {
  const requested = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_SCHOOL_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: requested }).format(0);
    return requested;
  } catch {
    return DEFAULT_SCHOOL_TIME_ZONE;
  }
};

export const normalizeSchoolWeekdays = (value: unknown) => {
  if (!Array.isArray(value)) return [...DEFAULT_SCHOOL_WEEKDAYS];
  const weekdays = Array.from(new Set(
    value
      .map((day) => Math.floor(Number(day)))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
  )).sort((left, right) => left - right);
  return weekdays.length > 0 ? weekdays : [...DEFAULT_SCHOOL_WEEKDAYS];
};

export const normalizeDailyTaskMakeupWindowDays = (value: unknown) =>
  clamp(
    Math.floor(toFiniteNumber(value, DEFAULT_DAILY_TASK_MAKEUP_WINDOW_DAYS)),
    0,
    30,
  );

export const getDateKey = (timestamp = Date.now(), timeZone = 'UTC') => {
  if (timeZone === 'UTC') return new Date(timestamp).toISOString().slice(0, 10);
  const safeTimeZone = normalizeSchoolTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const TEACHER_FEEDBACK_SOURCES = new Set<PointAdjustmentSource>([
  'quick',
  'manual',
  'airdrop',
]);

export const getDailyTeacherPointTotals = (
  student: Pick<StudentRuleState, 'pointAdjustmentRecords'>,
  now = Date.now(),
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
) => {
  const dateKey = getDateKey(now, timeZone);
  return (student.pointAdjustmentRecords ?? []).reduce(
    (totals, record) => {
      if (
        !TEACHER_FEEDBACK_SOURCES.has(record.source) ||
        getDateKey(record.createdAt, timeZone) !== dateKey
      ) {
        return totals;
      }
      if (record.amount > 0) totals.positive += record.amount;
      if (record.amount < 0) totals.negative += Math.abs(record.amount);
      return totals;
    },
    { positive: 0, negative: 0 },
  );
};

export const applyPointGuardrail = (
  student: Pick<StudentRuleState, 'pointAdjustmentRecords'>,
  requestedAmount: number,
  now = Date.now(),
  options: PointGuardrailOptions = {},
): PointGuardrailResult => {
  const normalizedRequest = Math.trunc(toFiniteNumber(requestedAmount, 0));
  if (normalizedRequest === 0 || options.enabled === false) {
    return {
      requestedAmount: normalizedRequest,
      appliedAmount: normalizedRequest,
      outcome: 'applied',
      usedAmount: 0,
      remainingAmount: Number.POSITIVE_INFINITY,
    };
  }

  const totals = getDailyTeacherPointTotals(student, now, options.timeZone);
  const isPositive = normalizedRequest > 0;
  const configuredLimit = isPositive
    ? options.dailyPositiveLimit
    : options.dailyNegativeLimit;
  const fallbackLimit = isPositive
    ? DEFAULT_DAILY_POSITIVE_POINT_LIMIT
    : DEFAULT_DAILY_NEGATIVE_POINT_LIMIT;
  const limit = clamp(
    Math.trunc(toFiniteNumber(configuredLimit, fallbackLimit)),
    0,
    10_000,
  );
  const usedAmount = isPositive ? totals.positive : totals.negative;
  const remainingAmount = Math.max(0, limit - usedAmount);
  const requestedMagnitude = Math.abs(normalizedRequest);
  const appliedMagnitude = Math.min(requestedMagnitude, remainingAmount);
  const appliedAmount = isPositive ? appliedMagnitude : -appliedMagnitude;
  const reason: PointGuardrailReason = isPositive
    ? 'dailyPositiveLimit'
    : 'dailyNegativeLimit';

  return {
    requestedAmount: normalizedRequest,
    appliedAmount,
    outcome:
      appliedMagnitude === 0
        ? 'blocked'
        : appliedMagnitude < requestedMagnitude
          ? 'clamped'
          : 'applied',
    ...(appliedMagnitude < requestedMagnitude ? { reason } : {}),
    usedAmount,
    remainingAmount: Math.max(0, remainingAmount - appliedMagnitude),
  };
};

const PARTICIPATION_BASE_SOURCES = new Set<PointAdjustmentSource>([
  'quick',
  'manual',
  'airdrop',
  'dailyTask',
]);

export const getMedianPoints = (
  students: Array<Pick<StudentRuleState, 'points'>>,
) => {
  if (students.length === 0) return 0;
  const values = students.map((student) => student.points).sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
};

export const getParticipationSupportPlan = (
  student: Pick<StudentRuleState, 'points' | 'pointAdjustmentRecords'>,
  comparisonStudents: Array<Pick<StudentRuleState, 'points'>>,
  now = Date.now(),
  options: ParticipationSupportOptions = {},
): ParticipationSupportPlan => {
  const classMedianPoints = getMedianPoints(comparisonStudents);
  const gapAfterBaseReward = Math.max(0, classMedianPoints - student.points);
  if (options.enabled === false) {
    return { participationTopUp: 0, catchUpBonus: 0, classMedianPoints, gapAfterBaseReward };
  }

  const timeZone = options.timeZone ?? DEFAULT_SCHOOL_TIME_ZONE;
  const dateKey = getDateKey(now, timeZone);
  const todayRecords = (student.pointAdjustmentRecords ?? []).filter(
    (record) => getDateKey(record.createdAt, timeZone) === dateKey,
  );
  const hasParticipationTopUp = todayRecords.some(
    (record) => record.source === 'participationTopUp',
  );
  const hasCatchUpBonus = todayRecords.some((record) => record.source === 'catchUpBonus');
  const qualifyingParticipationPoints = todayRecords.reduce(
    (total, record) =>
      PARTICIPATION_BASE_SOURCES.has(record.source) && record.amount > 0
        ? total + record.amount
        : total,
    0,
  );
  const minimumDailyParticipationPoints = clamp(
    Math.floor(toFiniteNumber(
      options.minimumDailyParticipationPoints,
      DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS,
    )),
    0,
    1_000,
  );
  const catchUpGapThreshold = clamp(
    Math.floor(toFiniteNumber(options.catchUpGapThreshold, DEFAULT_CATCH_UP_GAP_THRESHOLD)),
    0,
    10_000,
  );
  const configuredCatchUpBonus = clamp(
    Math.floor(toFiniteNumber(options.dailyCatchUpBonus, DEFAULT_DAILY_CATCH_UP_BONUS)),
    0,
    1_000,
  );

  return {
    participationTopUp:
      !hasParticipationTopUp && qualifyingParticipationPoints > 0
        ? Math.max(0, minimumDailyParticipationPoints - qualifyingParticipationPoints)
        : 0,
    catchUpBonus:
      !hasCatchUpBonus &&
      qualifyingParticipationPoints > 0 &&
      configuredCatchUpBonus > 0 &&
      gapAfterBaseReward >= catchUpGapThreshold
        ? configuredCatchUpBonus
        : 0,
    classMedianPoints,
    gapAfterBaseReward,
  };
};

export const applyParticipationSupportToStudent = <T extends StudentRuleState>(
  student: T,
  comparisonStudents: Array<Pick<StudentRuleState, 'points'>>,
  now = Date.now(),
  maxPoints = 700,
  options: ParticipationSupportOptions = {},
) => {
  const plan = getParticipationSupportPlan(student, comparisonStudents, now, options);
  let nextStudent = student;
  const records: PointAdjustmentRecord[] = [];

  const applyReward = (
    requestedAmount: number,
    source: Extract<PointAdjustmentSource, 'participationTopUp' | 'catchUpBonus'>,
    reasonId: string,
  ) => {
    const actualAmount = Math.min(
      requestedAmount,
      Math.max(0, maxPoints - nextStudent.points),
    );
    if (actualAmount <= 0) return;
    const record = createPointAdjustmentRecord(
      actualAmount,
      source,
      { id: reasonId, competency: 'participation' },
      now,
    );
    nextStudent = applyPointAdjustmentToStudent(nextStudent, actualAmount, record, maxPoints);
    records.push(record);
  };

  applyReward(plan.participationTopUp, 'participationTopUp', 'participation-safety-net');
  applyReward(plan.catchUpBonus, 'catchUpBonus', 'catch-up-bonus');

  return {
    student: nextStudent,
    participationTopUp: records.find((record) => record.source === 'participationTopUp')?.amount ?? 0,
    catchUpBonus: records.find((record) => record.source === 'catchUpBonus')?.amount ?? 0,
    records,
    plan,
  };
};

export const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const getWeekStartDateFromDateKey = (dateKey: string) => {
  if (!isDateKey(dateKey)) return dateKey;
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return addDaysToDateKey(dateKey, -daysSinceMonday);
};

export const getWeekStartDate = (
  timestamp = Date.now(),
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
) => getWeekStartDateFromDateKey(getDateKey(timestamp, timeZone));

export const getWeekEndDate = (
  timestamp = Date.now(),
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
) => addDaysToDateKey(getWeekStartDate(timestamp, timeZone), 6);

export const getActiveClassGoals = (
  goals: ClassGoal[] | undefined,
  timestamp = Date.now(),
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
) => {
  const currentWeekStart = getWeekStartDate(timestamp, timeZone);
  return (goals ?? []).filter((goal) => {
    const goalWeekStart = goal.weekStartDate
      ? getWeekStartDateFromDateKey(goal.weekStartDate)
      : getWeekStartDate(goal.createdAt, timeZone);
    return goalWeekStart === currentWeekStart;
  });
};

export const getDateKeyDistance = (fromDateKey: string, toDateKey: string) =>
  Math.floor(
    (new Date(`${toDateKey}T00:00:00.000Z`).getTime() -
      new Date(`${fromDateKey}T00:00:00.000Z`).getTime()) /
      (24 * 60 * 60 * 1000),
  );

const normalizeDailyTaskCalendarOptions = (options: DailyTaskCalendarOptions = {}) => ({
  timeZone: normalizeSchoolTimeZone(options.timeZone),
  schoolWeekdays: normalizeSchoolWeekdays(options.schoolWeekdays),
  holidayDates: new Set(normalizeDateKeyList(options.holidayDates)),
  excusedDates: new Set(normalizeDateKeyList(options.excusedDates, 120)),
  makeupWindowDays: normalizeDailyTaskMakeupWindowDays(options.makeupWindowDays),
});

type NormalizedDailyTaskCalendar = ReturnType<typeof normalizeDailyTaskCalendarOptions>;

const isInstructionDateForCalendar = (
  dateKey: string,
  calendar: NormalizedDailyTaskCalendar,
) => {
  if (!isDateKey(dateKey)) return false;
  const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return calendar.schoolWeekdays.includes(weekday) &&
    !calendar.holidayDates.has(dateKey) &&
    !calendar.excusedDates.has(dateKey);
};

const getNextInstructionDateForCalendar = (
  afterDateKey: string,
  calendar: NormalizedDailyTaskCalendar,
) => {
  if (!isDateKey(afterDateKey)) return undefined;
  for (let offset = 1; offset <= 800; offset += 1) {
    const candidate = addDaysToDateKey(afterDateKey, offset);
    if (isInstructionDateForCalendar(candidate, calendar)) return candidate;
  }
  return undefined;
};

export const isDailyTaskInstructionDate = (
  dateKey: string,
  options: DailyTaskCalendarOptions = {},
) => {
  const calendar = normalizeDailyTaskCalendarOptions(options);
  return isInstructionDateForCalendar(dateKey, calendar);
};

export const getNextDailyTaskInstructionDate = (
  afterDateKey: string,
  options: DailyTaskCalendarOptions = {},
) => {
  const calendar = normalizeDailyTaskCalendarOptions(options);
  return getNextInstructionDateForCalendar(afterDateKey, calendar);
};

export const getDailyTaskClaimPlan = <T extends StudentRuleState>(
  student: T,
  now = Date.now(),
  options: DailyTaskCalendarOptions = {},
): DailyTaskClaimPlan => {
  const calendar = normalizeDailyTaskCalendarOptions(options);
  const schoolDate = getDateKey(now, calendar.timeZone);
  const lastClaimDate = isDateKey(student.dailyProgress?.lastClaimDate)
    ? student.dailyProgress?.lastClaimDate
    : undefined;
  const alreadyClaimed = Boolean(lastClaimDate && lastClaimDate >= schoolDate) ||
    (student.pointAdjustmentRecords ?? []).some(
      (record) => record.source === 'dailyTask' &&
        getDateKey(record.createdAt, calendar.timeZone) === schoolDate,
    );

  if (alreadyClaimed) {
    return { schoolDate, alreadyClaimed: true, frozen: false };
  }

  if (!lastClaimDate) {
    const available = isInstructionDateForCalendar(schoolDate, calendar);
    return available
      ? {
          schoolDate,
          targetDate: schoolDate,
          claimKind: 'current',
          alreadyClaimed: false,
          frozen: false,
        }
      : { schoolDate, alreadyClaimed: false, frozen: true };
  }

  const nextInstructionDate = getNextInstructionDateForCalendar(lastClaimDate, calendar);
  if (nextInstructionDate && nextInstructionDate <= schoolDate) {
    if (nextInstructionDate === schoolDate) {
      return {
        schoolDate,
        targetDate: schoolDate,
        claimKind: 'current',
        alreadyClaimed: false,
        frozen: false,
      };
    }
    if (getDateKeyDistance(nextInstructionDate, schoolDate) <= calendar.makeupWindowDays) {
      return {
        schoolDate,
        targetDate: nextInstructionDate,
        claimKind: 'makeup',
        alreadyClaimed: false,
        frozen: false,
      };
    }
  }

  const availableToday = isInstructionDateForCalendar(schoolDate, calendar);
  return availableToday
    ? {
        schoolDate,
        targetDate: schoolDate,
        claimKind: 'current',
        alreadyClaimed: false,
        frozen: false,
      }
    : { schoolDate, alreadyClaimed: false, frozen: true };
};

export const isPetDead = (pet: { isDead?: boolean }) => Boolean(pet.isDead);

export const syncPetLifeState = <
  TPet extends { fullness: number; isDead?: boolean; zeroFullnessSince?: number },
>(
  pet: TPet,
  now = Date.now(),
  allowDeath = true,
) => {
  const fullness = clamp(pet.fullness, 0, 100);

  if (fullness > 0) {
    return {
      ...pet,
      fullness,
      isDead: false,
      zeroFullnessSince: undefined,
    };
  }

  const zeroFullnessSince = pet.zeroFullnessSince ?? now;
  const isDead =
    allowDeath &&
    (Boolean(pet.isDead) || now - zeroFullnessSince >= PET_DEATH_DELAY_MS);

  return {
    ...pet,
    fullness: 0,
    zeroFullnessSince,
    isDead,
  };
};

export const applyPointAdjustmentToStudent = <T extends StudentRuleState>(
  student: T,
  amount: number,
  record: PointAdjustmentRecord,
  maxPoints = 700
) => ({
  ...student,
  points: clamp(student.points + amount, 0, maxPoints),
  pointAdjustmentRecords: appendRecord(
    student.pointAdjustmentRecords,
    record,
    MAX_POINT_ADJUSTMENT_RECORDS,
  ),
});

export const applyFeedToStudent = <T extends StudentRuleState>(
  student: T,
  feedCost: number,
  feedGain: number,
  now = Date.now(),
  maxPoints = 700
) => {
  if (isPetDead(student.pet)) {
    return student;
  }

  const nextStudent = {
    ...student,
    points: clamp(student.points - feedCost, 0, maxPoints),
    pet: syncPetLifeState(
      {
        ...student.pet,
        fullness: clamp(student.pet.fullness + feedGain, 0, 100),
        happiness: clamp(student.pet.happiness + (isPenaltyActive(student.penaltyStatus, now) ? 5 : 10), 0, 100),
      },
      now,
    ),
  } as T;
  return appendEconomyDelta(student, nextStudent, 'feed', now);
};

export const applyPlayWithPet = <T extends StudentRuleState>(
  student: T,
  playCost: number,
  playGain: number,
  now = Date.now(),
  maxPoints = 700
) => {
  if (isPetDead(student.pet)) {
    return student;
  }

  const nextStudent = {
    ...student,
    points: clamp(student.points - playCost, 0, maxPoints),
    pet: syncPetLifeState(
      {
        ...student.pet,
        happiness: clamp(student.pet.happiness + playGain, 0, 100),
      },
      now,
    ),
  } as T;
  return appendEconomyDelta(student, nextStudent, 'play', now);
};

export const applyPenaltyToStudent = <T extends StudentRuleState>(
  student: T,
  penalty: PenaltyAmounts,
  options: {
    nextWarningPoints?: number;
    record?: DisciplineRecord;
    now?: number;
    source?: PenaltyStatusSource;
  } = {},
  maxPoints = 700
) => ({
  ...student,
  points: clamp(student.points - penalty.points, 0, maxPoints),
  pet: syncPetLifeState(
    {
      ...student.pet,
      fullness: clamp(student.pet.fullness - penalty.fullness, 0, 100),
      happiness: clamp(student.pet.happiness - penalty.happiness, 0, 100),
    },
    options.now,
  ),
  rankPoints: Math.max(0, (student.rankPoints ?? 0) - penalty.rankPoints),
  warningPoints: Math.max(0, options.nextWarningPoints ?? student.warningPoints ?? 0),
  penaltyStatus: options.source ? createPenaltyStatus(options.source, options.now) : student.penaltyStatus,
  disciplineRecords: options.record ? appendRecord(student.disciplineRecords, options.record) : student.disciplineRecords ?? [],
});

const clonePenaltyStatus = (status: PenaltyStatus | undefined) => status
  ? { source: status.source, until: status.until }
  : undefined;

export const createSafetyActionSnapshot = <T extends StudentRuleState>(
  student: T,
): SafetyActionSnapshot => ({
  points: student.points,
  rankPoints: student.rankPoints ?? 0,
  fullness: student.pet.fullness,
  happiness: student.pet.happiness,
  level: student.pet.level,
  warningPoints: student.warningPoints,
  activeWarningTimestamps: student.activeWarningTimestamps
    ? [...student.activeWarningTimestamps]
    : undefined,
  penaltyStatus: clonePenaltyStatus(student.penaltyStatus),
});

export const createSafetyActionEffect = <TBefore extends StudentRuleState, TAfter extends StudentRuleState>(
  before: TBefore,
  after: TAfter,
): SafetyActionEffect => ({
  before: createSafetyActionSnapshot(before),
  after: createSafetyActionSnapshot(after),
});

const samePenaltyStatus = (left: PenaltyStatus | undefined, right: PenaltyStatus | undefined) =>
  left?.source === right?.source && left?.until === right?.until;

const sameOptionalNumberList = (left: number[] | undefined, right: number[] | undefined) => {
  if (!left || !right) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
};

/**
 * Reverses only the effect of one safety action. Numeric fields use inverse deltas so
 * unrelated additive changes made during the undo window survive. Non-additive
 * warning and penalty state is restored only while it still matches the action's
 * recorded post-state, preventing the undo from overwriting a newer command.
 */
export const applySafetyActionReversal = <T extends StudentRuleState>(
  student: T,
  effect: SafetyActionEffect,
  reversalRecord: DisciplineRecord,
  maxPoints = 700,
): T => {
  const { before, after } = effect;
  const warningStateUnchanged =
    student.warningPoints === after.warningPoints &&
    sameOptionalNumberList(student.activeWarningTimestamps, after.activeWarningTimestamps);
  const penaltyStateUnchanged = samePenaltyStatus(student.penaltyStatus, after.penaltyStatus);

  const nextStudent = {
    ...student,
    points: clamp(student.points - (after.points - before.points), 0, maxPoints),
    rankPoints: Math.max(0, (student.rankPoints ?? 0) - (after.rankPoints - before.rankPoints)),
    warningPoints: warningStateUnchanged ? before.warningPoints : student.warningPoints,
    activeWarningTimestamps: warningStateUnchanged
      ? before.activeWarningTimestamps && [...before.activeWarningTimestamps]
      : student.activeWarningTimestamps,
    penaltyStatus: penaltyStateUnchanged
      ? clonePenaltyStatus(before.penaltyStatus)
      : student.penaltyStatus,
    pet: {
      ...student.pet,
      fullness: clamp(student.pet.fullness - (after.fullness - before.fullness), 0, 100),
      happiness: clamp(student.pet.happiness - (after.happiness - before.happiness), 0, 100),
      level: Math.max(1, student.pet.level - (after.level - before.level)),
    },
    disciplineRecords: appendRecord(student.disciplineRecords, reversalRecord),
  } as T;
  return nextStudent;
};

export const resolveBattle = <
  TAttacker extends StudentRuleState,
  TDefender extends StudentRuleState,
>(
  attacker: TAttacker,
  defender: TDefender,
  randomRolls: { attacker: number; defender: number },
  options?: BattleResolutionOptions,
  now = Date.now(),
  maxPoints = 700
) => {
  const attackerBlocked = getBattleBlockedReason(attacker, now, { minimumFullness: SOLO_BATTLE_MIN_FULLNESS });
  if (attackerBlocked) return { blocked: attackerBlocked };

  const defenderBlocked = getBattleBlockedReason(defender, now, { minimumFullness: SOLO_BATTLE_MIN_FULLNESS });
  if (defenderBlocked) return { blocked: defenderBlocked };

  const soloBattleFullnessCost = Math.max(
    0,
    toFiniteNumber(options?.soloBattleFullnessCost, SOLO_BATTLE_FULLNESS_COST),
  );
  const soloBattleAttackerFullnessCost = Math.max(
    0,
    toFiniteNumber(options?.soloBattleAttackerFullnessCost, soloBattleFullnessCost),
  );
  const soloBattleDefenderFullnessCost = Math.max(
    0,
    toFiniteNumber(options?.soloBattleDefenderFullnessCost, soloBattleFullnessCost),
  );
  const soloBattleWinPoints = Math.max(0, toFiniteNumber(options?.soloBattleWinPoints, SOLO_BATTLE_WIN_POINTS));
  const soloBattleLossPoints = Math.max(0, toFiniteNumber(options?.soloBattleLossPoints, SOLO_BATTLE_LOSS_POINTS));

  const attackerScore = attacker.pet.level * 10 + attacker.pet.fullness + randomRolls.attacker;
  const defenderScore = defender.pet.level * 10 + defender.pet.fullness + randomRolls.defender;

  let outcome: BattleOutcome = 'draw';
  if (attackerScore > defenderScore) outcome = 'win';
  else if (attackerScore < defenderScore) outcome = 'loss';

  const attackerStats = attacker.stats ?? { wins: 0, losses: 0 };
  const defenderStats = defender.stats ?? { wins: 0, losses: 0 };
  const attackerRankPoints = attacker.rankPoints ?? 0;
  const defenderRankPoints = defender.rankPoints ?? 0;

  if (outcome === 'draw') {
    return {
      blocked: null,
      outcome,
      attackerScore,
      defenderScore,
      attacker: {
        ...attacker,
        pet: syncPetLifeState(
          {
            ...attacker.pet,
            fullness: clamp(attacker.pet.fullness - soloBattleAttackerFullnessCost, 0, 100),
            happiness: clamp(attacker.pet.happiness - 5, 0, 100),
          },
          now,
        ),
      },
      defender: {
        ...defender,
        pet: syncPetLifeState(
          {
            ...defender.pet,
            fullness: clamp(defender.pet.fullness - soloBattleDefenderFullnessCost, 0, 100),
            happiness: clamp(defender.pet.happiness - 5, 0, 100),
          },
          now,
        ),
      },
    };
  }

  const attackerWon = outcome === 'win';
  const nextAttacker = {
    ...attacker,
    points: clamp(attacker.points + (attackerWon ? soloBattleWinPoints : -soloBattleLossPoints), 0, maxPoints),
    pet: syncPetLifeState(
      {
        ...attacker.pet,
        fullness: clamp(attacker.pet.fullness - soloBattleAttackerFullnessCost, 0, 100),
        happiness: clamp(attacker.pet.happiness + (attackerWon ? 15 : -20), 0, 100),
      },
      now,
    ),
    stats: {
      wins: attackerWon ? attackerStats.wins + 1 : attackerStats.wins,
      losses: attackerWon ? attackerStats.losses : attackerStats.losses + 1,
    },
    rankPoints: attackerWon
      ? attackerRankPoints + (options?.battleRankPointsWin ?? 20)
      : Math.max(0, attackerRankPoints - (options?.battleRankPointsLoss ?? 10)),
  } as TAttacker;
  const nextDefender = {
    ...defender,
    points: clamp(defender.points + (attackerWon ? -soloBattleLossPoints : soloBattleWinPoints), 0, maxPoints),
    pet: syncPetLifeState(
      {
        ...defender.pet,
        fullness: clamp(defender.pet.fullness - soloBattleDefenderFullnessCost, 0, 100),
        happiness: clamp(defender.pet.happiness + (attackerWon ? -20 : 15), 0, 100),
      },
      now,
    ),
    stats: {
      wins: attackerWon ? defenderStats.wins : defenderStats.wins + 1,
      losses: attackerWon ? defenderStats.losses + 1 : defenderStats.losses,
    },
    rankPoints: attackerWon
      ? Math.max(0, defenderRankPoints - (options?.battleRankPointsLoss ?? 10))
      : defenderRankPoints + (options?.battleRankPointsWin ?? 20),
  } as TDefender;

  return {
    blocked: null,
    outcome,
    attackerScore,
    defenderScore,
    attacker: appendEconomyDelta(attacker, nextAttacker, 'soloBattle', now),
    defender: appendEconomyDelta(defender, nextDefender, 'soloBattle', now),
  };
};

export const resolveTeamBattle = <
  TAttacker extends StudentRuleState,
  TDefender extends StudentRuleState,
>(
  attackers: Array<TeamBattleMember<TAttacker>>,
  defenders: Array<TeamBattleMember<TDefender>>,
  randomRolls: { attackers: number[]; defenders: number[] },
  options?: BattleResolutionOptions,
  now = Date.now(),
  maxPoints = 700
) => {
  const attackerLeader = attackers[0]?.student;
  const defenderLeader = defenders[0]?.student;

  if (!attackerLeader || !defenderLeader) {
    return { blocked: 'invalid' as const };
  }

  const teamBattleReadyOptions = getTeamBattleReadyOptions(options);
  const attackerLeaderBlocked = getBattleBlockedReason(attackerLeader, now, teamBattleReadyOptions);
  if (attackerLeaderBlocked) return { blocked: attackerLeaderBlocked };

  const defenderLeaderBlocked = getBattleBlockedReason(defenderLeader, now, teamBattleReadyOptions);
  if (defenderLeaderBlocked) return { blocked: defenderLeaderBlocked };

  const attackerScore = getTeamBattleScore(attackers, randomRolls.attackers);
  const defenderScore = getTeamBattleScore(defenders, randomRolls.defenders);

  let outcome: BattleOutcome = 'draw';
  if (attackerScore > defenderScore) outcome = 'win';
  else if (attackerScore < defenderScore) outcome = 'loss';

  const teamBattleAttackerFullnessCost = Math.max(
    0,
    toFiniteNumber(options?.teamBattleAttackerFullnessCost, TEAM_BATTLE_ATTACKER_FULLNESS_COST),
  );
  const teamBattleAttackerTeammateFullnessCost = Math.max(
    0,
    toFiniteNumber(
      options?.teamBattleAttackerTeammateFullnessCost,
      TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
    ),
  );
  const teamBattleDefenderFullnessCost = Math.max(
    0,
    toFiniteNumber(options?.teamBattleDefenderFullnessCost, TEAM_BATTLE_DEFENDER_FULLNESS_COST),
  );
  const teamBattleDefenderTeammateFullnessCost = Math.max(
    0,
    toFiniteNumber(
      options?.teamBattleDefenderTeammateFullnessCost,
      TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
    ),
  );

  const updateMember = <T extends StudentRuleState>(
    member: TeamBattleMember<T>,
    sideWon: boolean | null,
    reward: TeamBattleReward | null,
    fullnessCost: number,
  ) => {
    const stats = member.student.stats ?? { wins: 0, losses: 0 };
    const rankPoints = member.student.rankPoints ?? 0;

    if (sideWon == null) {
      return {
        ...member.student,
        pet: syncPetLifeState(
          {
            ...member.student.pet,
            fullness: clamp(member.student.pet.fullness - fullnessCost, 0, 100),
          },
          now,
        ),
      };
    }

    const hasTeamReward = Boolean(reward?.winnerIds.includes(member.id));
    const bonusPoints = hasTeamReward ? reward?.bonusPoints ?? 0 : 0;
    const bonusHappiness = hasTeamReward ? reward?.bonusHappiness ?? 0 : 0;

    const nextStudent = {
      ...member.student,
      points: clamp(
        member.student.points + (sideWon ? TEAM_BATTLE_WIN_POINTS + bonusPoints : -TEAM_BATTLE_LOSS_POINTS),
        0,
        maxPoints,
      ),
      pet: syncPetLifeState(
        {
          ...member.student.pet,
          fullness: clamp(member.student.pet.fullness - fullnessCost, 0, 100),
          happiness: clamp(
            member.student.pet.happiness + (sideWon ? 4 + bonusHappiness : -4),
            0,
            100,
          ),
        },
        now,
      ),
      stats: {
        wins: sideWon ? stats.wins + 1 : stats.wins,
        losses: sideWon ? stats.losses : stats.losses + 1,
      },
      rankPoints: sideWon
        ? rankPoints + (options?.battleRankPointsWin ?? TEAM_BATTLE_WIN_RANK_POINTS)
        : Math.max(0, rankPoints - (options?.battleRankPointsLoss ?? TEAM_BATTLE_LOSS_RANK_POINTS)),
    } as T;
    return appendEconomyDelta(member.student, nextStudent, 'teamBattle', now);
  };

  const updated: Record<string, TAttacker | TDefender> = {};

  const updateAttackers = (sideWon: boolean | null, reward: TeamBattleReward | null) => {
    attackers.forEach((member, index) => {
      updated[member.id] = updateMember(
        member,
        sideWon,
        reward,
        index === 0 ? teamBattleAttackerFullnessCost : teamBattleAttackerTeammateFullnessCost,
      );
    });
  };
  const updateDefenders = (sideWon: boolean | null, reward: TeamBattleReward | null) => {
    defenders.forEach((member, index) => {
      updated[member.id] = updateMember(
        member,
        sideWon,
        reward,
        index === 0 ? teamBattleDefenderFullnessCost : teamBattleDefenderTeammateFullnessCost,
      );
    });
  };

  if (outcome === 'draw') {
    updateAttackers(null, null);
    updateDefenders(null, null);
    return {
      blocked: null,
      outcome,
      attackerScore,
      defenderScore,
      updated,
      teamReward: null,
    };
  }

  const attackerWon = outcome === 'win';
  const winningMembers = attackerWon ? attackers : defenders;
  const teamReward =
    winningMembers.length > 1
      ? {
          winnerIds: winningMembers.map((member) => member.id),
          bonusPoints: TEAM_BATTLE_TEAM_BONUS_POINTS,
          bonusHappiness: TEAM_BATTLE_TEAM_BONUS_HAPPINESS,
        }
      : null;

  updateAttackers(attackerWon, teamReward);
  updateDefenders(!attackerWon, teamReward);

  return {
    blocked: null,
    outcome,
    attackerScore,
    defenderScore,
    updated,
    teamReward,
  };
};

export const applyDecayToStudent = <T extends StudentRuleState>(
  student: T,
  decayAmount: number,
  now = Date.now(),
  options?: { allowDeath?: boolean },
) => {
  const activeWarnings = (student.activeWarningTimestamps || []).filter(t => now - t < 1000 * 60 * 60 * 24);
  const newFullness = student.pet.fullness - decayAmount;
  const actualDecay = Math.max(0, -newFullness);
  const nextFullness = clamp(newFullness, 0, 100);

  const nextStudent = {
    ...student,
    warningPoints: activeWarnings.length,
    activeWarningTimestamps: activeWarnings,
    pet: syncPetLifeState(
      {
        ...student.pet,
        fullness: nextFullness,
        happiness: actualDecay > 0 ? clamp(student.pet.happiness - actualDecay, 0, 100) : student.pet.happiness,
      },
      now,
      options?.allowDeath ?? true,
    ),
  } as T;
  return nextStudent;
};

export const reviveStudentPet = <T extends StudentRuleState>(
  student: T,
  reviveCost = REVIVE_COST,
  maxPoints = 700,
  now = Date.now(),
) => appendEconomyDelta(
  student,
  {
    ...student,
    points: clamp(student.points - reviveCost, 0, maxPoints),
    pet: {
      ...student.pet,
      fullness: 40,
      happiness: Math.max(25, student.pet.happiness),
      isDead: false,
      zeroFullnessSince: undefined,
    },
  } as T,
  'revive',
  now,
);

export const claimDailyTaskForStudent = <T extends StudentRuleState>(
  student: T,
  now = Date.now(),
  maxPoints = 700,
  reasonLabel?: string,
  calendarOptions?: DailyTaskCalendarOptions,
  reflectionInput?: DailyTaskReflectionInput,
) => {
  const lastClaimDate = student.dailyProgress?.lastClaimDate;
  const currentStreak = student.dailyProgress?.streak ?? 0;
  const plan = calendarOptions
    ? getDailyTaskClaimPlan(student, now, {
        ...calendarOptions,
        excusedDates: calendarOptions.excusedDates ?? student.dailyProgress?.excusedDates,
      })
    : undefined;
  const targetDate = plan?.targetDate ?? getDateKey(now);
  const yesterday = getDateKey(now - 1000 * 60 * 60 * 24);

  if (plan && !plan.targetDate) {
    return {
      claimed: false as const,
      student,
      alreadyClaimed: plan.alreadyClaimed,
      frozen: plan.frozen,
    };
  }
  if (!plan && lastClaimDate === targetDate) {
    return { claimed: false as const, student, alreadyClaimed: true, frozen: false };
  }

  const reflectionText = reflectionInput?.text.trim().slice(0, 160) ?? '';
  const reflectionIsValid = Boolean(
    reflectionText &&
    reflectionInput &&
    isLearningCompetency(reflectionInput.competency) &&
    (
      reflectionInput.assessment === 'needsSupport' ||
      reflectionInput.assessment === 'progressing' ||
      reflectionInput.assessment === 'confident'
    ),
  );
  if (!reflectionIsValid || !reflectionInput) {
    return {
      claimed: false as const,
      student,
      alreadyClaimed: false,
      frozen: false,
      reflectionRequired: true as const,
    };
  }

  const followsPreviousInstructionDate = calendarOptions && isDateKey(lastClaimDate)
    ? getNextDailyTaskInstructionDate(lastClaimDate, {
        ...calendarOptions,
        excusedDates: calendarOptions.excusedDates ?? student.dailyProgress?.excusedDates,
      }) === targetDate
    : lastClaimDate === yesterday;
  const nextStreak = followsPreviousInstructionDate ? currentStreak + 1 : 1;
  const streakBonus = Math.min(20, (nextStreak - 1) * 5);
  const rewardPoints = DAILY_TASK_REWARD_POINTS + streakBonus;
  const claimKind = plan?.claimKind ?? 'current';
  const rewardRecord = createPointAdjustmentRecord(
    rewardPoints,
    'dailyTask',
    {
      id: 'daily-homework',
      label: reasonLabel?.trim() || undefined,
      competency: 'assignmentQuality',
    },
    now,
    plan ? { effectiveDate: targetDate, claimKind } : undefined,
  );
  const dailyReflection: DailyReflection = {
    id: `reflection-${now}-${Math.random().toString(36).slice(2, 8)}`,
    date: targetDate,
    createdAt: now,
    competency: reflectionInput.competency,
    author: 'student',
    selfAssessment: reflectionInput.assessment,
    text: reflectionText,
  };

  return {
    claimed: true as const,
    rewardPoints,
    streak: nextStreak,
    effectiveDate: targetDate,
    claimKind,
    student: {
      ...student,
      points: clamp(student.points + rewardPoints, 0, maxPoints),
      pet: syncPetLifeState(
        {
          ...student.pet,
          happiness: clamp(student.pet.happiness + DAILY_TASK_REWARD_HAPPINESS, 0, 100),
        },
        now,
      ),
      dailyProgress: {
        lastClaimDate: targetDate,
        streak: nextStreak,
        reflections: [
          dailyReflection,
          ...(student.dailyProgress?.reflections ?? []),
        ].slice(0, MAX_DAILY_REFLECTIONS),
        excusedDates: student.dailyProgress?.excusedDates,
      },
      pointAdjustmentRecords: [
        rewardRecord,
        ...(student.pointAdjustmentRecords ?? []),
      ].slice(0, MAX_POINT_ADJUSTMENT_RECORDS),
    },
  };
};

export const saveMentorDailyFeedbackForStudent = <T extends StudentRuleState>(
  student: T,
  feedback: MentorDailyFeedbackInput,
  now = Date.now(),
  timeZone = 'Asia/Taipei',
) => {
  const text = feedback.text.trim().slice(0, 160);
  if (!text) {
    return { saved: false as const, updated: false as const, student };
  }

  const date = getDateKey(now, timeZone);
  const reflections = student.dailyProgress?.reflections ?? [];
  const existing = reflections.find(
    (reflection) => reflection.date === date && reflection.author === 'mentor',
  );
  const dailyFeedback: DailyReflection = {
    id: existing?.id ?? `reflection-${now}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    createdAt: now,
    competency: feedback.competency,
    author: 'mentor',
    mentorAssessment: feedback.assessment,
    text,
  };

  return {
    saved: true as const,
    updated: Boolean(existing),
    student: {
      ...student,
      dailyProgress: {
        lastClaimDate: student.dailyProgress?.lastClaimDate,
        streak: student.dailyProgress?.streak ?? 0,
        reflections: [
          dailyFeedback,
          ...reflections.filter(
            (reflection) => !(reflection.date === date && reflection.author === 'mentor'),
          ),
        ].slice(0, MAX_DAILY_REFLECTIONS),
        excusedDates: student.dailyProgress?.excusedDates,
      },
    },
  };
};

export const attackWorldBoss = <T extends StudentRuleState & { id: string }>(
  student: T,
  boss: WorldBoss,
  now = Date.now(),
) => {
  if (isPetDead(student.pet)) {
    return { blocked: 'dead' as const };
  }
  if (isPenaltyActive(student.penaltyStatus, now)) {
    return { blocked: 'penalty' as const };
  }
  if (student.pet.fullness < BOSS_ATTACK_FULLNESS_COST) {
    return { blocked: 'fullness' as const };
  }

  const updatedStudent = {
    ...student,
    pet: syncPetLifeState(
      {
        ...student.pet,
        fullness: clamp(student.pet.fullness - BOSS_ATTACK_FULLNESS_COST, 0, 100),
      },
      now,
    ),
  };

  const rolledDamage = student.pet.level * 10 + Math.floor(Math.random() * 10) + 1;
  const damageDealt = Math.min(boss.currentHp, rolledDamage);
  const newHp = Math.max(0, boss.currentHp - damageDealt);
  
  const updatedBoss = {
    ...boss,
    currentHp: newHp,
    contributions: {
      ...boss.contributions,
      [student.id]: (boss.contributions[student.id] ?? 0) + damageDealt,
    },
    attackCounts: {
      ...(boss.attackCounts ?? {}),
      [student.id]: (boss.attackCounts?.[student.id] ?? 0) + 1,
    },
    isActive: newHp > 0,
  };

  return {
    blocked: null,
    updatedStudent,
    updatedBoss,
    damageDealt,
    isDefeated: newHp <= 0,
  };
};

export const resolveBossAttack = <T extends StudentRuleState>(
  students: Array<TeamBattleMember<T>>,
  maxTargets = DEFAULT_BOSS_ATTACK_MAX_TARGETS,
  damage = DEFAULT_BOSS_ATTACK_DAMAGE,
  random = Math.random,
  now = Date.now(),
): { updated: Record<string, T>; targetIds: string[]; damage: number } => {
  const eligible = students.filter(({ student }) => !isPetDead(student.pet));
  const safeMaxTargets = clamp(Math.floor(toFiniteNumber(maxTargets, DEFAULT_BOSS_ATTACK_MAX_TARGETS)), 0, 4);
  const targetCount = Math.min(eligible.length, Math.floor(random() * (safeMaxTargets + 1)));
  const shuffled = [...eligible];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const safeDamage = Math.max(0, Math.floor(toFiniteNumber(damage, DEFAULT_BOSS_ATTACK_DAMAGE)));
  const targets = shuffled.slice(0, targetCount);
  const targetIds = targets.map(({ id }) => id);
  const targetIdSet = new Set(targetIds);
  const updated: Record<string, T> = {};

  students.forEach(({ id, student }) => {
    updated[id] = targetIdSet.has(id)
      ? {
          ...student,
          pet: syncPetLifeState(
            {
              ...student.pet,
              fullness: student.pet.fullness - safeDamage,
            },
            now,
          ),
        }
      : student;
  });

  return { updated, targetIds, damage: safeDamage };
};

export const resolveSharedBossAttack = <T extends StudentRuleState>(
  students: Array<TeamBattleMember<T>>,
  totalDamage = DEFAULT_BOSS_ATTACK_DAMAGE,
  now = Date.now(),
): { updated: Record<string, T>; targetIds: string[]; damage: number } => {
  const eligible = students.filter(({ student }) => !isPetDead(student.pet));
  const safeTotalDamage = Math.max(0, Math.floor(toFiniteNumber(totalDamage, DEFAULT_BOSS_ATTACK_DAMAGE)));
  const sharedDamage = eligible.length > 0 ? Math.ceil(safeTotalDamage / eligible.length) : 0;
  const targetIds = eligible.map(({ id }) => id);
  const targetIdSet = new Set(targetIds);
  const updated: Record<string, T> = {};

  students.forEach(({ id, student }) => {
    updated[id] = targetIdSet.has(id)
      ? {
          ...student,
          pet: syncPetLifeState(
            {
              ...student.pet,
              fullness: student.pet.fullness - sharedDamage,
            },
            now,
          ),
        }
      : student;
  });

  return { updated, targetIds, damage: sharedDamage };
};

export const isBossRecoveryActive = (
  recovery: BossRecoveryStatus | undefined,
  now = Date.now(),
) => Boolean(
  recovery &&
  recovery.impact > 0 &&
  recovery.startedAt <= now &&
  recovery.recoverAt > now,
);

export const resolveRecoverableBossAttack = <T extends StudentRuleState>(
  students: Array<TeamBattleMember<T>>,
  totalImpact = DEFAULT_BOSS_ATTACK_DAMAGE,
  recoveryMinutes = DEFAULT_BOSS_RECOVERY_MINUTES,
  now = Date.now(),
): {
  updated: Record<string, T & { bossRecovery?: BossRecoveryStatus }>;
  targetIds: string[];
  damage: number;
  recoverAt: number;
} => {
  const eligible = students.filter(({ student }) => !isPetDead(student.pet));
  const safeTotalImpact = Math.max(0, Math.floor(toFiniteNumber(totalImpact, DEFAULT_BOSS_ATTACK_DAMAGE)));
  const sharedImpact = eligible.length > 0 ? Math.ceil(safeTotalImpact / eligible.length) : 0;
  const safeRecoveryMinutes = clamp(
    Math.floor(toFiniteNumber(recoveryMinutes, DEFAULT_BOSS_RECOVERY_MINUTES)),
    1,
    MAX_BOSS_RECOVERY_MINUTES,
  );
  const recoverAt = now + safeRecoveryMinutes * 60_000;
  const targetIds = sharedImpact > 0 ? eligible.map(({ id }) => id) : [];
  const targetIdSet = new Set(targetIds);
  const updated: Record<string, T & { bossRecovery?: BossRecoveryStatus }> = {};

  students.forEach(({ id, student }) => {
    if (!targetIdSet.has(id)) {
      updated[id] = student;
      return;
    }
    const existingImpact = isBossRecoveryActive(student.bossRecovery, now)
      ? student.bossRecovery?.impact ?? 0
      : 0;
    updated[id] = {
      ...student,
      bossRecovery: {
        impact: Math.max(existingImpact, sharedImpact),
        startedAt: now,
        recoverAt,
      },
    };
  });

  return { updated, targetIds, damage: sharedImpact, recoverAt };
};

export const getBossContributionStandings = <
  T extends Pick<
    StudentRuleState,
    'points' | 'pet' | 'lastBossDamage' | 'lastBossFairScore'
  > & { id: string; name: string },
>(students: T[], boss: WorldBoss): BossContributionStanding[] => {
  const rewardsByRank = new Map(boss.rewardTiers.map((tier) => [tier.rank, tier]));
  const participationReward = boss.participationReward ?? DEFAULT_BOSS_PARTICIPATION_REWARD;
  const improvementReward = boss.improvementReward ?? DEFAULT_BOSS_IMPROVEMENT_REWARD;
  let previousStandingFairScore: number | undefined;
  let previousStandingRank = 0;

  return students
    .map((student) => {
      const damage = Math.max(0, Math.floor(toFiniteNumber(boss.contributions[student.id], 0)));
      const expectedDamagePerAttack = Math.max(1, student.pet.level * 10 + 5.5);
      const recordedAttackCount = Math.max(
        0,
        Math.floor(toFiniteNumber(boss.attackCounts?.[student.id], 0)),
      );
      const attackCount =
        recordedAttackCount > 0
          ? recordedAttackCount
          : damage > 0
            ? Math.max(1, Math.round(damage / expectedDamagePerAttack))
            : 0;
      const normalizedPerformance =
        attackCount > 0
          ? clamp(damage / (attackCount * expectedDamagePerAttack), 0.75, 1.25)
          : 0;
      const cappedAttackCount = Math.min(attackCount, FAIR_BOSS_RANKING_ATTACK_CAP);
      const confidence = cappedAttackCount / FAIR_BOSS_RANKING_ATTACK_CAP;
      const confidenceAdjustedPerformance =
        1 + ((normalizedPerformance - 1) * confidence);
      const fairScore = Math.round(
        (confidenceAdjustedPerformance * 100) + (confidence * 15),
      );
      return { student, damage, attackCount, fairScore };
    })
    .filter(({ damage }) => damage > 0)
    .sort(
      (left, right) =>
        right.fairScore - left.fairScore ||
        left.student.name.localeCompare(right.student.name),
    )
    .map(({ student, damage, attackCount, fairScore }, index) => {
      const rank =
        previousStandingFairScore === fairScore
          ? previousStandingRank
          : index + 1;
      previousStandingFairScore = fairScore;
      previousStandingRank = rank;
      const reward = rewardsByRank.get(rank);
      const previousDamage = Math.max(0, Math.floor(toFiniteNumber(student.lastBossDamage, 0)));
      const improvementAmount = previousDamage > 0 ? Math.max(0, damage - previousDamage) : 0;
      const previousFairScore = Math.max(
        0,
        Math.floor(toFiniteNumber(student.lastBossFairScore, 0)),
      );
      const hasFairScoreBaseline = previousFairScore > 0;
      const fairImprovementAmount = hasFairScoreBaseline
        ? Math.max(0, fairScore - previousFairScore)
        : improvementAmount;
      const receivedImprovementReward =
        hasFairScoreBaseline
          ? fairImprovementAmount > 0
          : previousDamage > 0 && improvementAmount > 0;
      const rankRewardPoints = reward?.points ?? 0;
      const rankRewardRankPoints = reward?.rankPoints ?? 0;
      const rankRewardHappiness = reward?.happiness ?? 0;
      const improvementRewardPoints = receivedImprovementReward ? improvementReward.points : 0;
      const improvementRewardRankPoints = receivedImprovementReward ? (improvementReward.rankPoints ?? 0) : 0;
      const improvementRewardHappiness = receivedImprovementReward ? improvementReward.happiness : 0;
      const participationRewardRankPoints = participationReward.rankPoints ?? 0;

      return {
        rank,
        studentId: student.id,
        studentName: student.name,
        damage,
        attackCount,
        fairScore,
        previousDamage,
        previousFairScore,
        improvementAmount,
        fairImprovementAmount,
        rewardPoints: rankRewardPoints + participationReward.points + improvementRewardPoints,
        rewardRankPoints:
          rankRewardRankPoints + participationRewardRankPoints + improvementRewardRankPoints,
        rewardHappiness: rankRewardHappiness + participationReward.happiness + improvementRewardHappiness,
        rankRewardPoints,
        rankRewardRankPoints,
        rankRewardHappiness,
        participationRewardPoints: participationReward.points,
        participationRewardRankPoints,
        participationRewardHappiness: participationReward.happiness,
        improvementRewardPoints,
        improvementRewardRankPoints,
        improvementRewardHappiness,
        receivedImprovementReward,
      };
    });
};

export const applyBossContributionRewards = <
  T extends StudentRuleState & { id: string; name: string },
>(
  students: T[],
  boss: WorldBoss,
  now = Date.now(),
  maxPoints = 700,
): { students: T[]; standings: BossContributionStanding[] } => {
  const standings = getBossContributionStandings(students, boss);
  const standingByStudentId = new Map(standings.map((standing) => [standing.studentId, standing]));

  return {
    standings,
    students: students.map((student) => {
      const standing = standingByStudentId.get(student.id);
      if (!standing) return student;

      const bossRecord: BossRewardRecord = {
        id: `boss-reward-${boss.id}-${student.id}`,
        bossId: boss.id,
        bossName: boss.name,
        createdAt: now,
        rank: standing.rank,
        damage: standing.damage,
        attackCount: standing.attackCount,
        fairScore: standing.fairScore,
        previousDamage: standing.previousDamage,
        previousFairScore: standing.previousFairScore,
        improvementAmount: standing.improvementAmount,
        fairImprovementAmount: standing.fairImprovementAmount,
        rewardPoints: standing.rewardPoints,
        rewardRankPoints: standing.rewardRankPoints,
        rewardHappiness: standing.rewardHappiness,
        rankRewardPoints: standing.rankRewardPoints,
        rankRewardRankPoints: standing.rankRewardRankPoints,
        rankRewardHappiness: standing.rankRewardHappiness,
        participationRewardPoints: standing.participationRewardPoints,
        participationRewardRankPoints: standing.participationRewardRankPoints,
        participationRewardHappiness: standing.participationRewardHappiness,
        improvementRewardPoints: standing.improvementRewardPoints,
        improvementRewardRankPoints: standing.improvementRewardRankPoints,
        improvementRewardHappiness: standing.improvementRewardHappiness,
        receivedImprovementReward: standing.receivedImprovementReward,
      };

      const nextStudent = {
        ...student,
        points: clamp(student.points + standing.rewardPoints, 0, maxPoints),
        rankPoints: Math.max(0, (student.rankPoints ?? 0) + standing.rewardRankPoints),
        lastBossDamage: standing.damage,
        lastBossFairScore: standing.fairScore,
        bossRewardRecords: appendRecord(
          student.bossRewardRecords,
          bossRecord,
          MAX_BOSS_REWARD_RECORDS,
        ),
        pet: syncPetLifeState(
          {
            ...student.pet,
            happiness: clamp(student.pet.happiness + standing.rewardHappiness, 0, 100),
          },
          now,
        ),
      } as T;
      const actualReward = Math.trunc(nextStudent.points - student.points);
      if (actualReward <= 0) return nextStudent;
      return appendEconomyEventToStudent(
        nextStudent,
        createEconomyEventRecord('issuance', 'bossReward', actualReward, now, {
          referenceId: bossRecord.id,
        }),
      ) as T;
    }),
  };
};
