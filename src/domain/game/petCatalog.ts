/** Platform-neutral pet identifiers and rarities; visual icons stay in the UI. */
export const PET_CATALOG = [
  { id: 'egg', rarity: 'common' },
  { id: 'dog', rarity: 'common' },
  { id: 'cat', rarity: 'common' },
  { id: 'bird', rarity: 'common' },
  { id: 'rabbit', rarity: 'common' },
  { id: 'turtle', rarity: 'common' },
  { id: 'fish', rarity: 'common' },
  { id: 'snail', rarity: 'common' },
  { id: 'bug', rarity: 'common' },
  { id: 'rat', rarity: 'common' },
  { id: 'worm', rarity: 'common' },
  { id: 'squirrel', rarity: 'rare' },
  { id: 'piggybank', rarity: 'rare' },
  { id: 'pawprint', rarity: 'rare' },
  { id: 'ghost', rarity: 'legendary' },
  { id: 'bot', rarity: 'legendary' },
] as const;

export const isPetType = (value: unknown): value is typeof PET_CATALOG[number]['id'] =>
  PET_CATALOG.some((pet) => pet.id === value);
