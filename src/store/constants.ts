import { 
  Dog, Cat, Bird, Rabbit, Turtle, Fish, Snail, Bug, Rat, Squirrel, PiggyBank, Worm, Ghost, Bot, PawPrint, Egg
} from 'lucide-react';
import { BattleMode } from './types';

// Re-export i18n for backward compatibility
export { translations, petNames, POINT_REASON_OPTIONS } from '../i18n/translations';

export const PET_TYPES = [
  { id: 'egg', icon: Egg, rarity: 'common' },
  { id: 'dog', icon: Dog, rarity: 'common' },
  { id: 'cat', icon: Cat, rarity: 'common' },
  { id: 'bird', icon: Bird, rarity: 'common' },
  { id: 'rabbit', icon: Rabbit, rarity: 'common' },
  { id: 'turtle', icon: Turtle, rarity: 'common' },
  { id: 'fish', icon: Fish, rarity: 'common' },
  { id: 'snail', icon: Snail, rarity: 'common' },
  { id: 'bug', icon: Bug, rarity: 'common' },
  { id: 'rat', icon: Rat, rarity: 'common' },
  { id: 'worm', icon: Worm, rarity: 'common' },
  { id: 'squirrel', icon: Squirrel, rarity: 'rare' },
  { id: 'piggybank', icon: PiggyBank, rarity: 'rare' },
  { id: 'pawprint', icon: PawPrint, rarity: 'rare' },
  { id: 'ghost', icon: Ghost, rarity: 'legendary' },
  { id: 'bot', icon: Bot, rarity: 'legendary' },
];

export const DEFAULT_CLASS_NAME = '預設班級';
export const STORAGE_KEY = 'tamagotchi_classroom_data';
export const DEFAULT_BATTLE_MODE: BattleMode = 'both';
export const DEFAULT_MAX_TEAM_SIZE = 6;
export const REVIVE_COST = 120;
