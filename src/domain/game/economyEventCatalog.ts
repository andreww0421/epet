export const ECONOMY_EVENT_KINDS = [
  'issuance',
  'spend',
  'petChange',
] as const;

export type EconomyEventKind = (typeof ECONOMY_EVENT_KINDS)[number];

export const ECONOMY_EVENT_SOURCES = [
  'feed',
  'play',
  'upgrade',
  'gacha',
  'upgradeReroll',
  'revive',
  'soloBattle',
  'teamBattle',
  'bossReward',
] as const;

export type EconomyEventSource = (typeof ECONOMY_EVENT_SOURCES)[number];
