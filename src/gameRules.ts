export type PenaltyStatusSource = 'autoPenalty' | 'discipline';

export type DisciplineRecordType = 'warning' | 'autoPenalty' | 'discipline';

export type DisciplineRecord = {
  id: string;
  type: DisciplineRecordType;
  createdAt: number;
  warningCount?: number;
};

export type PointAdjustmentSource = 'quick' | 'manual';

export type PointAdjustmentRecord = {
  id: string;
  amount: number;
  createdAt: number;
  source: PointAdjustmentSource;
};

export type PenaltyStatus = {
  source: PenaltyStatusSource;
  until: number;
};

export type StudentRuleState = {
  points: number;
  rankPoints?: number;
  warningPoints?: number;
  pet: {
    fullness: number;
    happiness: number;
    level: number;
  };
  stats?: {
    wins: number;
    losses: number;
  };
  nextUpgradeGachaLevel?: number | null;
  penaltyStatus?: PenaltyStatus;
  disciplineRecords?: DisciplineRecord[];
  pointAdjustmentRecords?: PointAdjustmentRecord[];
};

export type PenaltyAmounts = {
  points: number;
  fullness: number;
  happiness: number;
  rankPoints: number;
};

export type BattleOutcome = 'win' | 'loss' | 'draw';

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

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getUpcomingUpgradeGachaLevel = (currentLevel: number) =>
  UPGRADE_GACHA_LEVEL_SEQUENCE.find((level) => level >= currentLevel) ?? null;

export const getNextUpgradeGachaLevel = (claimedLevel: number) =>
  UPGRADE_GACHA_LEVEL_SEQUENCE.find((level) => level > claimedLevel) ?? null;

export const createDisciplineRecord = (
  type: DisciplineRecordType,
  warningCount?: number,
  now = Date.now(),
): DisciplineRecord => ({
  id: `record-${now}-${Math.random().toString(36).slice(2, 8)}`,
  type,
  createdAt: now,
  warningCount,
});

export const createPointAdjustmentRecord = (
  amount: number,
  source: PointAdjustmentSource,
  now = Date.now(),
): PointAdjustmentRecord => ({
  id: `points-${now}-${Math.random().toString(36).slice(2, 8)}`,
  amount,
  createdAt: now,
  source,
});

export const appendRecord = <T extends { createdAt: number }>(records: T[] | undefined, record: T) =>
  [record, ...(records ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ACTIVITY_RECORDS);

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

export const applyPointAdjustmentToStudent = <T extends StudentRuleState>(
  student: T,
  amount: number,
  record: PointAdjustmentRecord,
) => ({
  ...student,
  points: clamp(student.points + amount, 0, 700),
  pointAdjustmentRecords: appendRecord(student.pointAdjustmentRecords, record),
});

export const applyFeedToStudent = <T extends StudentRuleState>(student: T, feedCost: number, now = Date.now()) => ({
  ...student,
  points: student.points - feedCost,
  pet: {
    ...student.pet,
    fullness: clamp(student.pet.fullness + 20, 0, 100),
    happiness: clamp(student.pet.happiness + (isPenaltyActive(student.penaltyStatus, now) ? 5 : 10), 0, 100),
  },
});

export const applyPenaltyToStudent = <T extends StudentRuleState>(
  student: T,
  penalty: PenaltyAmounts,
  options: {
    nextWarningPoints?: number;
    record?: DisciplineRecord;
    now?: number;
    source?: PenaltyStatusSource;
  } = {},
) => ({
  ...student,
  points: clamp(student.points - penalty.points, 0, 700),
  pet: {
    ...student.pet,
    fullness: clamp(student.pet.fullness - penalty.fullness, 0, 100),
    happiness: clamp(student.pet.happiness - penalty.happiness, 0, 100),
  },
  rankPoints: Math.max(0, (student.rankPoints ?? 0) - penalty.rankPoints),
  warningPoints: Math.max(0, options.nextWarningPoints ?? student.warningPoints ?? 0),
  penaltyStatus: options.source ? createPenaltyStatus(options.source, options.now) : student.penaltyStatus,
  disciplineRecords: options.record ? appendRecord(student.disciplineRecords, options.record) : student.disciplineRecords ?? [],
});

export const resolveBattle = <
  TAttacker extends StudentRuleState,
  TDefender extends StudentRuleState,
>(
  attacker: TAttacker,
  defender: TDefender,
  randomRolls: { attacker: number; defender: number },
  now = Date.now(),
) => {
  if (isPenaltyActive(attacker.penaltyStatus, now)) {
    return { blocked: 'penalty' as const };
  }

  if (attacker.pet.fullness < 50) {
    return { blocked: 'fullness' as const };
  }

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
        pet: {
          ...attacker.pet,
          fullness: clamp(attacker.pet.fullness - 30, 0, 100),
        },
      },
      defender: {
        ...defender,
        pet: {
          ...defender.pet,
          fullness: clamp(defender.pet.fullness - 30, 0, 100),
        },
      },
    };
  }

  const attackerWon = outcome === 'win';

  return {
    blocked: null,
    outcome,
    attackerScore,
    defenderScore,
    attacker: {
      ...attacker,
      points: clamp(attacker.points + (attackerWon ? 50 : -60), 0, 700),
      pet: {
        ...attacker.pet,
        fullness: clamp(attacker.pet.fullness - 50, 0, 100),
      },
      stats: {
        wins: attackerWon ? attackerStats.wins + 1 : attackerStats.wins,
        losses: attackerWon ? attackerStats.losses : attackerStats.losses + 1,
      },
      rankPoints: attackerWon ? attackerRankPoints + 20 : Math.max(0, attackerRankPoints - 10),
    },
    defender: {
      ...defender,
      points: clamp(defender.points + (attackerWon ? -50 : 20), 0, 700),
      pet: {
        ...defender.pet,
        fullness: clamp(defender.pet.fullness - (attackerWon ? 50 : 10), 0, 100),
      },
      stats: {
        wins: attackerWon ? defenderStats.wins : defenderStats.wins + 1,
        losses: attackerWon ? defenderStats.losses + 1 : defenderStats.losses,
      },
      rankPoints: attackerWon ? Math.max(0, defenderRankPoints - 10) : defenderRankPoints + 20,
    },
  };
};
