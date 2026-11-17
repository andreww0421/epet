/** Workspace UI availability, not a replacement for RBAC or gameplay rules.
 * Hiding an activity never resets progress, rewards or historical records.
 */
export type GameFeatures = {
  pets: boolean;
  battles: boolean;
  bosses: boolean;
  leaderboards: boolean;
};

export type GameFeaturePreset = 'simple' | 'full' | 'teaching';

export const GAME_FEATURE_PRESETS = Object.freeze({
  simple: Object.freeze({ pets: true, battles: false, bosses: false, leaderboards: false }),
  full: Object.freeze({ pets: true, battles: true, bosses: true, leaderboards: true }),
  teaching: Object.freeze({ pets: false, battles: false, bosses: false, leaderboards: false }),
}) satisfies Readonly<Record<GameFeaturePreset, Readonly<GameFeatures>>>;

const FEATURE_KEYS: readonly (keyof GameFeatures)[] = ['pets', 'battles', 'bosses', 'leaderboards'];

export const isGameFeatures = (value: unknown): value is GameFeatures => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === FEATURE_KEYS.length &&
    FEATURE_KEYS.every((key) => Object.hasOwn(candidate, key) && typeof candidate[key] === 'boolean');
};

/** Always return fresh flags so settings drafts cannot mutate shared presets. */
export const cloneGameFeaturePreset = (preset: GameFeaturePreset): GameFeatures =>
  ({ ...GAME_FEATURE_PRESETS[preset] });

/** Missing policy is a legacy workspace: retain its existing entry points. */
export const resolveGameFeatures = (value?: GameFeatures): GameFeatures =>
  value === undefined ? cloneGameFeaturePreset('full') : { ...value };
