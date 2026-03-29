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
  reasonId?: string;
  reasonLabel?: string;
};

export type PenaltyStatus = {
  source: PenaltyStatusSource;
  until: number;
};

export type DailyProgress = {
  lastClaimDate?: string;
  streak: number;
};

export type StudentRuleState = {
  points: number;
  rankPoints?: number;
  warningPoints?: number;
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
  dailyProgress?: DailyProgress;
};

export type PenaltyAmounts = {
  points: number;
  fullness: number;
  happiness: number;
  rankPoints: number;
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
export const PET_DEATH_DELAY_MS = 1000 * 60 * 60 * 24;
export const REVIVE_COST = 120;
export const DAILY_TASK_REWARD_POINTS = 30;
export const DAILY_TASK_REWARD_HAPPINESS = 8;
export const TEAM_BATTLE_SUPPORT_WEIGHT = 0.65;
export const TEAM_BATTLE_SYNERGY_BONUS = 12;
export const TEAM_BATTLE_WIN_POINTS = 30;
export const TEAM_BATTLE_LOSS_POINTS = 15;
export const TEAM_BATTLE_WIN_RANK_POINTS = 12;
export const TEAM_BATTLE_LOSS_RANK_POINTS = 6;
export const TEAM_BATTLE_WIN_FULLNESS_COST = 30;
export const TEAM_BATTLE_LOSS_FULLNESS_COST = 35;
export const TEAM_BATTLE_DRAW_FULLNESS_COST = 20;
export const TEAM_BATTLE_TEAM_BONUS_POINTS = 10;
export const TEAM_BATTLE_TEAM_BONUS_HAPPINESS = 6;

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
  reason?: { id?: string; label?: string },
  now = Date.now(),
): PointAdjustmentRecord => ({
  id: `points-${now}-${Math.random().toString(36).slice(2, 8)}`,
  amount,
  createdAt: now,
  source,
  reasonId: reason?.id,
  reasonLabel: reason?.label,
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

export const isBattleReady = <T extends StudentRuleState>(student: T, now = Date.now()) => {
  if (isPetDead(student.pet)) return false;
  if (isPenaltyActive(student.penaltyStatus, now)) return false;
  return student.pet.fullness >= 50;
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
  const isDead = Boolean(pet.isDead) || now - zeroFullnessSince >= PET_DEATH_DELAY_MS;

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
) => ({
  ...student,
  points: clamp(student.points + amount, 0, 700),
  pointAdjustmentRecords: appendRecord(student.pointAdjustmentRecords, record),
});

export const applyFeedToStudent = <T extends StudentRuleState>(
  student: T,
  feedCost: number,
  feedGain: number,
  now = Date.now(),
) => {
  if (isPetDead(student.pet)) {
    return student;
  }

  return {
    ...student,
    points: student.points - feedCost,
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
  now = Date.now(),
) => {
  if (isPetDead(attacker.pet) || isPetDead(defender.pet)) {
    return { blocked: 'dead' as const };
  }

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
        pet: syncPetLifeState(
          {
            ...attacker.pet,
            fullness: clamp(attacker.pet.fullness - 30, 0, 100),
          },
          now,
        ),
      },
      defender: {
        ...defender,
        pet: syncPetLifeState(
          {
            ...defender.pet,
            fullness: clamp(defender.pet.fullness - 30, 0, 100),
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
      points: clamp(attacker.points + (attackerWon ? 50 : -60), 0, 700),
      pet: syncPetLifeState(
        {
          ...attacker.pet,
          fullness: clamp(attacker.pet.fullness - 50, 0, 100),
        },
        now,
      ),
      stats: {
        wins: attackerWon ? attackerStats.wins + 1 : attackerStats.wins,
        losses: attackerWon ? attackerStats.losses : attackerStats.losses + 1,
      },
      rankPoints: attackerWon ? attackerRankPoints + 20 : Math.max(0, attackerRankPoints - 10),
    },
    defender: {
      ...defender,
      points: clamp(defender.points + (attackerWon ? -50 : 20), 0, 700),
      pet: syncPetLifeState(
        {
          ...defender.pet,
          fullness: clamp(defender.pet.fullness - (attackerWon ? 50 : 10), 0, 100),
        },
        now,
      ),
      stats: {
        wins: attackerWon ? defenderStats.wins : defenderStats.wins + 1,
        losses: attackerWon ? defenderStats.losses + 1 : defenderStats.losses,
      },
      rankPoints: attackerWon ? Math.max(0, defenderRankPoints - 10) : defenderRankPoints + 20,
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
  now = Date.now(),
) => {
  const attackerLeader = attackers[0]?.student;
  const defenderLeader = defenders[0]?.student;

  if (!attackerLeader || !defenderLeader) {
    return { blocked: 'invalid' as const };
  }

  if (isPetDead(attackerLeader.pet) || isPetDead(defenderLeader.pet)) {
    return { blocked: 'dead' as const };
  }

  if (isPenaltyActive(attackerLeader.penaltyStatus, now)) {
    return { blocked: 'penalty' as const };
  }

  if (attackerLeader.pet.fullness < 50) {
    return { blocked: 'fullness' as const };
  }

  const attackerScore = getTeamBattleScore(attackers, randomRolls.attackers);
  const defenderScore = getTeamBattleScore(defenders, randomRolls.defenders);

  let outcome: BattleOutcome = 'draw';
  if (attackerScore > defenderScore) outcome = 'win';
  else if (attackerScore < defenderScore) outcome = 'loss';

  const updateMember = <T extends StudentRuleState>(
    member: TeamBattleMember<T>,
    sideWon: boolean | null,
    reward: TeamBattleReward | null,
  ) => {
    const stats = member.student.stats ?? { wins: 0, losses: 0 };
    const rankPoints = member.student.rankPoints ?? 0;

    if (sideWon == null) {
      return {
        ...member.student,
        pet: syncPetLifeState(
          {
            ...member.student.pet,
            fullness: clamp(member.student.pet.fullness - TEAM_BATTLE_DRAW_FULLNESS_COST, 0, 100),
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
        700,
      ),
      pet: syncPetLifeState(
        {
          ...member.student.pet,
          fullness: clamp(
            member.student.pet.fullness - (sideWon ? TEAM_BATTLE_WIN_FULLNESS_COST : TEAM_BATTLE_LOSS_FULLNESS_COST),
            0,
            100,
          ),
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
        ? rankPoints + TEAM_BATTLE_WIN_RANK_POINTS
        : Math.max(0, rankPoints - TEAM_BATTLE_LOSS_RANK_POINTS),
    };
  };

  const updated: Record<string, TAttacker | TDefender> = {};

  if (outcome === 'draw') {
    for (const member of attackers) updated[member.id] = updateMember(member, null, null);
    for (const member of defenders) updated[member.id] = updateMember(member, null, null);
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

  for (const member of attackers) updated[member.id] = updateMember(member, attackerWon, teamReward);
  for (const member of defenders) updated[member.id] = updateMember(member, !attackerWon, teamReward);

  return {
    blocked: null,
    outcome,
    attackerScore,
    defenderScore,
    updated,
    teamReward,
  };
};

export const applyDecayToStudent = <T extends StudentRuleState>(student: T, decayAmount: number, now = Date.now()) => ({
  ...student,
  pet: syncPetLifeState(
    {
      ...student.pet,
      fullness: clamp(student.pet.fullness - decayAmount, 0, 100),
    },
    now,
  ),
});

export const reviveStudentPet = <T extends StudentRuleState>(student: T) => ({
  ...student,
  points: clamp(student.points - REVIVE_COST, 0, 700),
  pet: {
    ...student.pet,
    fullness: 40,
    happiness: Math.max(25, student.pet.happiness),
    isDead: false,
    zeroFullnessSince: undefined,
  },
});

export const claimDailyTaskForStudent = <T extends StudentRuleState>(student: T, now = Date.now()) => {
  const today = getDateKey(now);
  const yesterday = getDateKey(now - 1000 * 60 * 60 * 24);
  const lastClaimDate = student.dailyProgress?.lastClaimDate;
  const currentStreak = student.dailyProgress?.streak ?? 0;

  if (lastClaimDate === today) {
    return { claimed: false as const, student };
  }

  const nextStreak = lastClaimDate === yesterday ? currentStreak + 1 : 1;
  const streakBonus = Math.min(20, (nextStreak - 1) * 5);

  return {
    claimed: true as const,
    rewardPoints: DAILY_TASK_REWARD_POINTS + streakBonus,
    streak: nextStreak,
    student: {
      ...student,
      points: clamp(student.points + DAILY_TASK_REWARD_POINTS + streakBonus, 0, 700),
      pet: {
        ...student.pet,
        happiness: clamp(student.pet.happiness + DAILY_TASK_REWARD_HAPPINESS, 0, 100),
      },
      dailyProgress: {
        lastClaimDate: today,
        streak: nextStreak,
      },
    },
  };
};
