import {
  BOSS_ATTACK_FULLNESS_COST,
  DEFAULT_BOSS_ATTACK_DAMAGE,
  DEFAULT_BOSS_ATTACK_MAX_TARGETS,
  DEFAULT_BOSS_RECOVERY_MINUTES,
  MAX_BOSS_RECOVERY_MINUTES,
} from './constants';
import { isPenaltyActive } from './penaltyRules';
import { isPetDead, syncPetLifeState } from './petRules';
import { clamp, toFiniteNumber } from './ruleUtils';
import type {
  BossRecoveryStatus,
  StudentRuleState,
  TeamBattleMember,
  WorldBoss,
} from './types';

export const getBossAttackBlockedReason = <T extends StudentRuleState>(
  student: T,
  now = Date.now(),
) => {
  if (isPetDead(student.pet)) return 'dead' as const;
  if (isPenaltyActive(student.penaltyStatus, now)) return 'penalty' as const;
  if (student.pet.fullness < BOSS_ATTACK_FULLNESS_COST) return 'fullness' as const;
  return null;
};

export const attackWorldBoss = <T extends StudentRuleState & { id: string }>(
  student: T,
  boss: WorldBoss,
  now = Date.now(),
) => {
  const blocked = getBossAttackBlockedReason(student, now);
  if (blocked) return { blocked };

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
  const safeMaxTargets = clamp(
    Math.floor(toFiniteNumber(maxTargets, DEFAULT_BOSS_ATTACK_MAX_TARGETS)),
    0,
    4,
  );
  const targetCount = Math.min(
    eligible.length,
    Math.floor(random() * (safeMaxTargets + 1)),
  );
  const shuffled = [...eligible];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const safeDamage = Math.max(
    0,
    Math.floor(toFiniteNumber(damage, DEFAULT_BOSS_ATTACK_DAMAGE)),
  );
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
  const safeTotalDamage = Math.max(
    0,
    Math.floor(toFiniteNumber(totalDamage, DEFAULT_BOSS_ATTACK_DAMAGE)),
  );
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
) =>
  Boolean(
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
  const safeTotalImpact = Math.max(
    0,
    Math.floor(toFiniteNumber(totalImpact, DEFAULT_BOSS_ATTACK_DAMAGE)),
  );
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
