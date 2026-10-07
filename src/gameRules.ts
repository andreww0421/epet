/**
 * Backward-compatible game rules entry point.
 *
 * New domain code lives under `src/domain/game`. Existing consumers can keep
 * importing from this module while feature code migrates incrementally.
 */
export * from './domain/game/index';
