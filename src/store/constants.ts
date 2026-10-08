import { 
  Dog, Cat, Bird, Rabbit, Turtle, Fish, Snail, Bug, Rat, Squirrel, PiggyBank, Worm, Ghost, Bot, PawPrint, Egg
} from 'lucide-react';
import { BattleMode } from './types';
import { PET_CATALOG } from '../domain/game/petCatalog';

// Re-export i18n for backward compatibility
export { translations, petNames, POINT_REASON_OPTIONS } from '../i18n/translations';

const petIcons = {
  egg: Egg, dog: Dog, cat: Cat, bird: Bird, rabbit: Rabbit, turtle: Turtle,
  fish: Fish, snail: Snail, bug: Bug, rat: Rat, worm: Worm, squirrel: Squirrel,
  piggybank: PiggyBank, pawprint: PawPrint, ghost: Ghost, bot: Bot,
};
export const PET_TYPES = PET_CATALOG.map((pet) => ({ ...pet, icon: petIcons[pet.id] }));

export const DEFAULT_CLASS_NAME = '預設班級';
export const STORAGE_KEY = 'tamagotchi_classroom_data';
export const DEFAULT_BATTLE_MODE: BattleMode = 'both';
export const DEFAULT_MAX_TEAM_SIZE = 6;
