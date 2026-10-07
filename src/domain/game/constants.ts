import type {
  BossReward,
  BossRewardTier,
  PenaltyAmounts,
  PenaltyStatusSource,
} from './types';

export {
  ECONOMY_EVENT_KINDS,
  ECONOMY_EVENT_SOURCES,
} from './economyEventCatalog';

export const LEVEL_DECREASE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const UPGRADE_GACHA_LEVEL_SEQUENCE = [2, 4, 6, 8] as const;
export const UPGRADE_GACHA_LEVELS = new Set<number>(UPGRADE_GACHA_LEVEL_SEQUENCE);
export const UPGRADE_REWARD_LEVEL = 2;
export const UPGRADE_REWARD_FULLNESS = 30;
export const UPGRADE_REWARD_HAPPINESS = 25;
export const PET_MAX_LEVEL = 10;
export const PET_UPGRADE_FULLNESS_REQUIREMENT = 100;
export const PET_UPGRADE_MIN_HAPPINESS = 40;
export const PET_UPGRADE_BASE_COST = 100;
export const PET_UPGRADE_COST_PER_LEVEL = 50;
export const PET_GACHA_COST = 200;
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
