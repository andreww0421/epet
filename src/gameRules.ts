export type PenaltyStatusSource = 'autoPenalty' | 'discipline';

export type DisciplineRecordType = 'warning' | 'autoPenalty' | 'discipline';

export type DisciplineRecord = {
  id: string;
  type: DisciplineRecordType;
  createdAt: number;
  warningCount?: number;
};

export type PointAdjustmentSource = 'quick' | 'manual' | 'airdrop' | 'dailyTask';

export type LearningCompetency =
  | 'participation'
  | 'collaboration'
  | 'selfManagement'
  | 'assignmentQuality'
  | 'growth';

export const LEARNING_COMPETENCIES: LearningCompetency[] = [
  'participation',
  'collaboration',
  'selfManagement',
  'assignmentQuality',
  'growth',
];

export const isLearningCompetency = (value: unknown): value is LearningCompetency =>
  LEARNING_COMPETENCIES.includes(value as LearningCompetency);

export type ClassGoal = {
  id: string;
  title: string;
  competency: LearningCompetency;
  targetCount: number;
  createdAt: number;
};

export type PointAdjustmentRecord = {
  id: string;
  amount: number;
  createdAt: number;
  source: PointAdjustmentSource;
  reasonId?: string;
  reasonLabel?: string;
  competency?: LearningCompetency;
};

export type PenaltyStatus = {
  source: PenaltyStatusSource;
  until: number;
};

export type DailyProgress = {
  lastClaimDate?: string;
  streak: number;
  reflections?: DailyReflection[];
};

export type DailySelfAssessment = 'needsSupport' | 'progressing' | 'confident';

export type DailyReflection = {
  id: string;
  date: string;
  createdAt: number;
  competency: LearningCompetency;
  selfAssessment: DailySelfAssessment;
  text?: string;
};

export type DailyReflectionInput = {
  competency: LearningCompetency;
  selfAssessment: DailySelfAssessment;
  text?: string;
  reasonLabel?: string;
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
  bossRewardRecords?: BossRewardRecord[];
  dailyProgress?: DailyProgress;
  lastBossDamage?: number;
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
  isActive: boolean;
};

export type BossAttackMode = 'shared' | 'random';

export type BossReward = {
  points: number;
  happiness: number;
  rankPoints: number;
};

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
  previousDamage: number;
  improvementAmount: number;
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
export const PET_DEATH_DELAY_MS = 1000 * 60 * 60 * 24;
export const REVIVE_COST = 120;
export const DAILY_TASK_REWARD_POINTS = 30;
export const DAILY_TASK_REWARD_HAPPINESS = 8;
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
export const DEFAULT_BOSS_ATTACK_MAX_TARGETS = 4;
export const DEFAULT_BOSS_ATTACK_DAMAGE = 20;
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
  reason?: { id?: string; label?: string; competency?: LearningCompetency },
  now = Date.now(),
): PointAdjustmentRecord => ({
  id: `points-${now}-${Math.random().toString(36).slice(2, 8)}`,
  amount,
  createdAt: now,
  source,
  reasonId: reason?.id,
  reasonLabel: reason?.label,
  competency: reason?.competency,
});

export const appendRecord = <T extends { createdAt: number }>(
  records: T[] | undefined,
  record: T,
  limit = MAX_ACTIVITY_RECORDS,
) => [record, ...(records ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);

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

export const getDateKey = (timestamp = Date.now()) => new Date(timestamp).toISOString().slice(0, 10);

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

  return {
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
  };
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

  return {
    ...student,
    points: clamp(student.points - playCost, 0, maxPoints),
    pet: syncPetLifeState(
      {
        ...student.pet,
        happiness: clamp(student.pet.happiness + playGain, 0, 100),
      },
      now,
    ),
  };
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

  return {
    blocked: null,
    outcome,
    attackerScore,
    defenderScore,
    attacker: {
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
    },
    defender: {
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
    },
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

    return {
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
    };
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

  return {
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
  };
};

export const reviveStudentPet = <T extends StudentRuleState>(student: T, reviveCost = REVIVE_COST, maxPoints = 700) => ({
  ...student,
  points: clamp(student.points - reviveCost, 0, maxPoints),
  pet: {
    ...student.pet,
    fullness: 40,
    happiness: Math.max(25, student.pet.happiness),
    isDead: false,
    zeroFullnessSince: undefined,
  },
});

export const claimDailyTaskForStudent = <T extends StudentRuleState>(
  student: T,
  now = Date.now(),
  maxPoints = 700,
  reflection?: DailyReflectionInput,
) => {
  const today = getDateKey(now);
  const yesterday = getDateKey(now - 1000 * 60 * 60 * 24);
  const lastClaimDate = student.dailyProgress?.lastClaimDate;
  const currentStreak = student.dailyProgress?.streak ?? 0;

  if (lastClaimDate === today) {
    return { claimed: false as const, student };
  }

  const nextStreak = lastClaimDate === yesterday ? currentStreak + 1 : 1;
  const streakBonus = Math.min(20, (nextStreak - 1) * 5);
  const rewardPoints = DAILY_TASK_REWARD_POINTS + streakBonus;
  const reflectionText = reflection?.text?.trim().slice(0, 160) || undefined;
  const dailyReflection: DailyReflection | undefined = reflection
    ? {
        id: `reflection-${now}-${Math.random().toString(36).slice(2, 8)}`,
        date: today,
        createdAt: now,
        competency: reflection.competency,
        selfAssessment: reflection.selfAssessment,
        text: reflectionText,
      }
    : undefined;
  const rewardRecord = reflection
    ? createPointAdjustmentRecord(
        rewardPoints,
        'dailyTask',
        {
          id: 'daily-reflection',
          label: reflection.reasonLabel?.trim() || undefined,
          competency: reflection.competency,
        },
        now,
      )
    : undefined;

  return {
    claimed: true as const,
    rewardPoints,
    streak: nextStreak,
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
        lastClaimDate: today,
        streak: nextStreak,
        reflections: dailyReflection
          ? [dailyReflection, ...(student.dailyProgress?.reflections ?? [])].slice(0, MAX_DAILY_REFLECTIONS)
          : student.dailyProgress?.reflections,
      },
      pointAdjustmentRecords: rewardRecord
        ? [rewardRecord, ...(student.pointAdjustmentRecords ?? [])].slice(0, MAX_POINT_ADJUSTMENT_RECORDS)
        : student.pointAdjustmentRecords,
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

export const getBossContributionStandings = <
  T extends Pick<StudentRuleState, 'points' | 'pet' | 'lastBossDamage'> & { id: string; name: string },
>(students: T[], boss: WorldBoss): BossContributionStanding[] => {
  const rewardsByRank = new Map(boss.rewardTiers.map((tier) => [tier.rank, tier]));
  const participationReward = boss.participationReward ?? DEFAULT_BOSS_PARTICIPATION_REWARD;
  const improvementReward = boss.improvementReward ?? DEFAULT_BOSS_IMPROVEMENT_REWARD;

  return students
    .map((student) => ({
      student,
      damage: Math.max(0, Math.floor(toFiniteNumber(boss.contributions[student.id], 0))),
    }))
    .filter(({ damage }) => damage > 0)
    .sort((left, right) => right.damage - left.damage || left.student.name.localeCompare(right.student.name))
    .map(({ student, damage }, index) => {
      const rank = index + 1;
      const reward = rewardsByRank.get(rank);
      const previousDamage = Math.max(0, Math.floor(toFiniteNumber(student.lastBossDamage, 0)));
      const improvementAmount = previousDamage > 0 ? Math.max(0, damage - previousDamage) : 0;
      const receivedImprovementReward =
        previousDamage > 0 && improvementAmount > 0;
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
        previousDamage,
        improvementAmount,
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

      return {
        ...student,
        points: clamp(student.points + standing.rewardPoints, 0, maxPoints),
        rankPoints: Math.max(0, (student.rankPoints ?? 0) + standing.rewardRankPoints),
        lastBossDamage: standing.damage,
        bossRewardRecords: appendRecord(
          student.bossRewardRecords,
          {
            id: `boss-reward-${boss.id}-${student.id}`,
            bossId: boss.id,
            bossName: boss.name,
            createdAt: now,
            rank: standing.rank,
            damage: standing.damage,
            previousDamage: standing.previousDamage,
            improvementAmount: standing.improvementAmount,
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
          },
          MAX_BOSS_REWARD_RECORDS,
        ),
        pet: syncPetLifeState(
          {
            ...student.pet,
            happiness: clamp(student.pet.happiness + standing.rewardHappiness, 0, 100),
          },
          now,
        ),
      };
    }),
  };
};
