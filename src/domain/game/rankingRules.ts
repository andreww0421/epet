import {
  DEFAULT_BOSS_IMPROVEMENT_REWARD,
  DEFAULT_BOSS_PARTICIPATION_REWARD,
  FAIR_BOSS_RANKING_ATTACK_CAP,
} from './constants';
import { clamp, toFiniteNumber } from './ruleUtils';
import type {
  BossContributionStanding,
  StudentRuleState,
  WorldBoss,
} from './types';

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
      const damage = Math.max(
        0,
        Math.floor(toFiniteNumber(boss.contributions[student.id], 0)),
      );
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
        1 + (normalizedPerformance - 1) * confidence;
      const fairScore = Math.round(confidenceAdjustedPerformance * 100 + confidence * 15);
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
        previousStandingFairScore === fairScore ? previousStandingRank : index + 1;
      previousStandingFairScore = fairScore;
      previousStandingRank = rank;
      const reward = rewardsByRank.get(rank);
      const previousDamage = Math.max(
        0,
        Math.floor(toFiniteNumber(student.lastBossDamage, 0)),
      );
      const improvementAmount = previousDamage > 0 ? Math.max(0, damage - previousDamage) : 0;
      const previousFairScore = Math.max(
        0,
        Math.floor(toFiniteNumber(student.lastBossFairScore, 0)),
      );
      const hasFairScoreBaseline = previousFairScore > 0;
      const fairImprovementAmount = hasFairScoreBaseline
        ? Math.max(0, fairScore - previousFairScore)
        : improvementAmount;
      const receivedImprovementReward = hasFairScoreBaseline
        ? fairImprovementAmount > 0
        : previousDamage > 0 && improvementAmount > 0;
      const rankRewardPoints = reward?.points ?? 0;
      const rankRewardRankPoints = reward?.rankPoints ?? 0;
      const rankRewardHappiness = reward?.happiness ?? 0;
      const improvementRewardPoints = receivedImprovementReward
        ? improvementReward.points
        : 0;
      const improvementRewardRankPoints = receivedImprovementReward
        ? improvementReward.rankPoints ?? 0
        : 0;
      const improvementRewardHappiness = receivedImprovementReward
        ? improvementReward.happiness
        : 0;
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
        rewardPoints:
          rankRewardPoints + participationReward.points + improvementRewardPoints,
        rewardRankPoints:
          rankRewardRankPoints +
          participationRewardRankPoints +
          improvementRewardRankPoints,
        rewardHappiness:
          rankRewardHappiness +
          participationReward.happiness +
          improvementRewardHappiness,
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
