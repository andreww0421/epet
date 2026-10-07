import { PET_DEATH_DELAY_MS, REVIVE_COST } from './constants';
import { appendEconomyDelta } from './economyRules';
import { clamp } from './ruleUtils';
import type { StudentRuleState } from './types';

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

export const applyDecayToStudent = <T extends StudentRuleState>(
  student: T,
  decayAmount: number,
  now = Date.now(),
  options?: { allowDeath?: boolean },
) => {
  const activeWarnings = (student.activeWarningTimestamps || []).filter(
    (timestamp) => now - timestamp < 1000 * 60 * 60 * 24,
  );
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
        happiness:
          actualDecay > 0
            ? clamp(student.pet.happiness - actualDecay, 0, 100)
            : student.pet.happiness,
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
) =>
  appendEconomyDelta(
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
