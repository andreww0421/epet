import {
  MAX_BOSS_REWARD_RECORDS,
} from './constants';
import {
  appendEconomyEventToStudent,
  createEconomyEventRecord,
} from './economyRules';
import { syncPetLifeState } from './petRules';
import { getBossContributionStandings } from './rankingRules';
import { appendRecord, clamp, toFiniteNumber } from './ruleUtils';
import type {
  BossContributionStanding,
  BossRewardRecord,
  BossRewardStep,
  BossRewardTier,
  StudentRuleState,
  WorldBoss,
} from './types';

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
  const sorted = tiers.slice().sort((left, right) => left.rank - right.rank);
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
    happiness: Math.max(
      0,
      anchor.happiness + direction * safeStep.happiness * distance,
    ),
    rankPoints: Math.max(
      0,
      anchor.rankPoints + direction * safeStep.rankPoints * distance,
    ),
  };
};

export const recalculateBossRewardTiers = (
  tiers: BossRewardTier[],
  step: BossRewardStep,
) => {
  const sorted = tiers.slice().sort((left, right) => left.rank - right.rank);
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

export const applyBossContributionRewards = <
  T extends StudentRuleState & { id: string; name: string },
>(
  students: T[],
  boss: WorldBoss,
  now = Date.now(),
  maxPoints = 700,
): { students: T[]; standings: BossContributionStanding[] } => {
  const standings = getBossContributionStandings(students, boss);
  const standingByStudentId = new Map(
    standings.map((standing) => [standing.studentId, standing]),
  );

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
            happiness: clamp(
              student.pet.happiness + standing.rewardHappiness,
              0,
              100,
            ),
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
