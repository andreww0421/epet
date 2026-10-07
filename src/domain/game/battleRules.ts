import {
  SOLO_BATTLE_FULLNESS_COST,
  SOLO_BATTLE_LOSS_POINTS,
  SOLO_BATTLE_MIN_FULLNESS,
  SOLO_BATTLE_WIN_POINTS,
  TEAM_BATTLE_ATTACKER_FULLNESS_COST,
  TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_LOSS_POINTS,
  TEAM_BATTLE_LOSS_RANK_POINTS,
  TEAM_BATTLE_MIN_FULLNESS,
  TEAM_BATTLE_SUPPORT_WEIGHT,
  TEAM_BATTLE_SYNERGY_BONUS,
  TEAM_BATTLE_TEAM_BONUS_HAPPINESS,
  TEAM_BATTLE_TEAM_BONUS_POINTS,
  TEAM_BATTLE_WIN_POINTS,
  TEAM_BATTLE_WIN_RANK_POINTS,
} from './constants';
import { appendEconomyDelta } from './economyRules';
import { isPenaltyActive } from './penaltyRules';
import { isPetDead, syncPetLifeState } from './petRules';
import { clamp, toFiniteNumber } from './ruleUtils';
import type {
  BattleOutcome,
  BattleReadyOptions,
  BattleResolutionOptions,
  StudentRuleState,
  TeamBattleMember,
  TeamBattleReward,
} from './types';

export const getBattleBlockedReason = <T extends StudentRuleState>(
  student: T,
  now = Date.now(),
  options: BattleReadyOptions = {},
) => {
  if (isPetDead(student.pet)) return 'dead' as const;
  if (isPenaltyActive(student.penaltyStatus, now)) return 'penalty' as const;
  if (student.pet.happiness < 30) return 'happiness' as const;
  if (
    !options.ignoreFullness &&
    student.pet.fullness < (options.minimumFullness ?? SOLO_BATTLE_MIN_FULLNESS)
  ) {
    return 'fullness' as const;
  }
  return null;
};

export const getTeamBattleReadyOptions = (
  options?: Pick<
    BattleResolutionOptions,
    'teamBattleMinFullnessEnabled' | 'teamBattleMinFullness'
  >,
): BattleReadyOptions => ({
  minimumFullness: Math.max(
    0,
    toFiniteNumber(options?.teamBattleMinFullness, TEAM_BATTLE_MIN_FULLNESS),
  ),
  ignoreFullness: options?.teamBattleMinFullnessEnabled === false,
});

export const isBattleReady = <T extends StudentRuleState>(
  student: T,
  now = Date.now(),
  options: BattleReadyOptions = {},
) => getBattleBlockedReason(student, now, options) == null;

const getBattlePower = <T extends StudentRuleState>(student: T, roll: number) =>
  student.pet.level * 12 +
  student.pet.fullness * 0.7 +
  student.pet.happiness * 0.35 +
  roll;

const getTeamBattleScore = <T extends StudentRuleState>(
  members: Array<TeamBattleMember<T>>,
  rolls: number[],
) => {
  const leaderPower = members[0]
    ? getBattlePower(members[0].student, rolls[0] ?? 0)
    : 0;
  const supportPower = members.slice(1).reduce((total, member, index) => {
    return total + getBattlePower(member.student, rolls[index + 1] ?? 0) * TEAM_BATTLE_SUPPORT_WEIGHT;
  }, 0);
  const synergyBonus = members.length > 1 ? TEAM_BATTLE_SYNERGY_BONUS : 0;

  return Math.round(leaderPower + supportPower + synergyBonus);
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
  maxPoints = 700,
) => {
  const attackerBlocked = getBattleBlockedReason(attacker, now, {
    minimumFullness: SOLO_BATTLE_MIN_FULLNESS,
  });
  if (attackerBlocked) return { blocked: attackerBlocked };

  const defenderBlocked = getBattleBlockedReason(defender, now, {
    minimumFullness: SOLO_BATTLE_MIN_FULLNESS,
  });
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
  const soloBattleWinPoints = Math.max(
    0,
    toFiniteNumber(options?.soloBattleWinPoints, SOLO_BATTLE_WIN_POINTS),
  );
  const soloBattleLossPoints = Math.max(
    0,
    toFiniteNumber(options?.soloBattleLossPoints, SOLO_BATTLE_LOSS_POINTS),
  );

  const attackerScore =
    attacker.pet.level * 10 + attacker.pet.fullness + randomRolls.attacker;
  const defenderScore =
    defender.pet.level * 10 + defender.pet.fullness + randomRolls.defender;

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
            fullness: clamp(
              attacker.pet.fullness - soloBattleAttackerFullnessCost,
              0,
              100,
            ),
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
            fullness: clamp(
              defender.pet.fullness - soloBattleDefenderFullnessCost,
              0,
              100,
            ),
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
    points: clamp(
      attacker.points + (attackerWon ? soloBattleWinPoints : -soloBattleLossPoints),
      0,
      maxPoints,
    ),
    pet: syncPetLifeState(
      {
        ...attacker.pet,
        fullness: clamp(
          attacker.pet.fullness - soloBattleAttackerFullnessCost,
          0,
          100,
        ),
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
    points: clamp(
      defender.points + (attackerWon ? -soloBattleLossPoints : soloBattleWinPoints),
      0,
      maxPoints,
    ),
    pet: syncPetLifeState(
      {
        ...defender.pet,
        fullness: clamp(
          defender.pet.fullness - soloBattleDefenderFullnessCost,
          0,
          100,
        ),
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
  maxPoints = 700,
) => {
  const attackerLeader = attackers[0]?.student;
  const defenderLeader = defenders[0]?.student;

  if (!attackerLeader || !defenderLeader) {
    return { blocked: 'invalid' as const };
  }

  const teamBattleReadyOptions = getTeamBattleReadyOptions(options);
  const attackerLeaderBlocked = getBattleBlockedReason(
    attackerLeader,
    now,
    teamBattleReadyOptions,
  );
  if (attackerLeaderBlocked) return { blocked: attackerLeaderBlocked };

  const defenderLeaderBlocked = getBattleBlockedReason(
    defenderLeader,
    now,
    teamBattleReadyOptions,
  );
  if (defenderLeaderBlocked) return { blocked: defenderLeaderBlocked };

  const attackerScore = getTeamBattleScore(attackers, randomRolls.attackers);
  const defenderScore = getTeamBattleScore(defenders, randomRolls.defenders);

  let outcome: BattleOutcome = 'draw';
  if (attackerScore > defenderScore) outcome = 'win';
  else if (attackerScore < defenderScore) outcome = 'loss';

  const teamBattleAttackerFullnessCost = Math.max(
    0,
    toFiniteNumber(
      options?.teamBattleAttackerFullnessCost,
      TEAM_BATTLE_ATTACKER_FULLNESS_COST,
    ),
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
    toFiniteNumber(
      options?.teamBattleDefenderFullnessCost,
      TEAM_BATTLE_DEFENDER_FULLNESS_COST,
    ),
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
        member.student.points +
          (sideWon ? TEAM_BATTLE_WIN_POINTS + bonusPoints : -TEAM_BATTLE_LOSS_POINTS),
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
        : Math.max(
            0,
            rankPoints - (options?.battleRankPointsLoss ?? TEAM_BATTLE_LOSS_RANK_POINTS),
          ),
    } as T;
    return appendEconomyDelta(member.student, nextStudent, 'teamBattle', now);
  };

  const updated: Record<string, TAttacker | TDefender> = {};

  const updateAttackers = (
    sideWon: boolean | null,
    reward: TeamBattleReward | null,
  ) => {
    attackers.forEach((member, index) => {
      updated[member.id] = updateMember(
        member,
        sideWon,
        reward,
        index === 0
          ? teamBattleAttackerFullnessCost
          : teamBattleAttackerTeammateFullnessCost,
      );
    });
  };
  const updateDefenders = (
    sideWon: boolean | null,
    reward: TeamBattleReward | null,
  ) => {
    defenders.forEach((member, index) => {
      updated[member.id] = updateMember(
        member,
        sideWon,
        reward,
        index === 0
          ? teamBattleDefenderFullnessCost
          : teamBattleDefenderTeammateFullnessCost,
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
