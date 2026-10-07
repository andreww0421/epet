import {
  PET_MAX_LEVEL,
  PET_UPGRADE_BASE_COST,
  PET_UPGRADE_COST_PER_LEVEL,
  PET_UPGRADE_FULLNESS_REQUIREMENT,
  PET_UPGRADE_MIN_HAPPINESS,
  UPGRADE_GACHA_LEVEL_SEQUENCE,
} from './constants';
import { isPetDead } from './petRules';
import type { StudentRuleState } from './types';

export const getPetUpgradeCost = (level: number) =>
  PET_UPGRADE_BASE_COST + (level - 1) * PET_UPGRADE_COST_PER_LEVEL;

export const getUpcomingUpgradeGachaLevel = (currentLevel: number) =>
  UPGRADE_GACHA_LEVEL_SEQUENCE.find((level) => level >= currentLevel) ?? null;

export const getNextUpgradeGachaLevel = (claimedLevel: number) =>
  UPGRADE_GACHA_LEVEL_SEQUENCE.find((level) => level > claimedLevel) ?? null;

export const getPetUpgradeBlockedReason = <T extends StudentRuleState>(
  student: T,
  options: { requireAlive?: boolean } = {},
) => {
  const currentLevel = student.pet.level || 1;
  if (options.requireAlive && isPetDead(student.pet)) return 'dead' as const;
  if (currentLevel >= PET_MAX_LEVEL) return 'maxLevel' as const;
  if (student.pet.fullness < PET_UPGRADE_FULLNESS_REQUIREMENT) return 'fullness' as const;
  if ((student.pet.happiness || 0) < PET_UPGRADE_MIN_HAPPINESS) return 'happiness' as const;
  if (student.points < getPetUpgradeCost(currentLevel)) return 'points' as const;
  return null;
};
