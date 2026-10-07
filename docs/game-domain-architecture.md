# Game domain architecture

## Why this refactor was needed

`src/gameRules.ts` had grown to more than 2,100 lines and combined unrelated rule sets in one module: pet lifecycle, feeding, upgrades, penalties, battles, boss encounters, rewards, school calendars, daily tasks, participation support, ranking, record retention, and their shared types/constants. The functions were mostly pure, but the single file made dependency direction unclear and increased the risk that a small gameplay change would affect unrelated rules.

This refactor is intentionally structural. It does not change game balance, API contracts, persisted data, or gameplay outcomes. The original `src/gameRules.ts` path remains as a compatibility facade so existing frontend, server, and test imports do not need to migrate together.

## Package layout

The canonical implementation now lives in `src/domain/game/`:

| Module | Responsibility |
| --- | --- |
| `types.ts` | Framework-independent structural types used by game rules. It deliberately does not depend on frontend store types. |
| `economyEventCatalog.ts` | Canonical economy event tuples and their derived literal unions, keeping runtime catalogs and public types in lockstep. |
| `constants.ts` | Existing gameplay thresholds, costs, limits, reward defaults, and literal tuples. No values were rebalanced. |
| `ruleUtils.ts` | Small shared primitives: numeric normalization, clamping, and bounded record ordering. |
| `economyRules.ts` | Point/economy ledger records and point adjustments. Its internal delta helper is not part of the public barrel. |
| `petRules.ts` | Pet life/death synchronization, decay, and revival. |
| `feedingRules.ts` | Feed and play interactions, including their actual economy-ledger deltas. |
| `upgradeRules.ts` | Upgrade cost, eligibility, and gacha milestone selection. |
| `penaltyRules.ts` | Penalty status, discipline records, cooldowns, safety snapshots, and compensating reversals. |
| `battleRules.ts` | Solo/team battle readiness, resolution, resource costs, rewards, and battle ledger entries. |
| `bossRules.ts` | Boss attack eligibility and random/shared/recoverable boss attacks. |
| `rankingRules.ts` | Fair boss contribution scoring and standings. |
| `rewardRules.ts` | Boss reward-tier generation and application of contribution rewards. |
| `calendarRules.ts` | School timezone, date-key, weekday, and week-boundary calculations. |
| `learningRules.ts` | Teacher point guardrails, participation support, medians, and active class goals. |
| `dailyTaskRules.ts` | Instruction-day planning, daily/make-up claims, streak rewards, and mentor daily feedback. |
| `index.ts` | Explicit public domain barrel. It preserves the legacy runtime surface without exposing internal helpers. |

`src/gameRules.ts` only re-exports `src/domain/game/index.ts`. Existing imports therefore continue to receive the same function and singleton identities, while new domain-aware code may import a focused module directly.

## Dependency rules

Dependencies flow from low-level foundations toward composed rules:

`types → constants/ruleUtils → economy → pet → penalty/feeding/upgrade → battle/boss/ranking/reward`

Calendar-based rules form a parallel branch:

`types/constants/ruleUtils → calendar → learning/dailyTask`

Additional constraints:

- Domain modules never import `src/gameRules.ts` or the public `index.ts` barrel.
- No domain rule imports React, Zustand, UI components, or application stores.
- Type-only dependencies are used where a runtime dependency is unnecessary.
- Cross-domain helpers have one owner; calculations are imported rather than duplicated.
- `index.ts` uses an explicit economy export list so the internal `appendEconomyDelta` helper does not expand the legacy API.

These constraints are enforced by `tests/gameDomainArchitecture.test.ts`, which parses every domain module, detects dependency cycles, rejects legacy-facade/barrel/framework imports, and snapshots all 130 legacy runtime exports.

## Behavior and compatibility safeguards

Before extraction, all 88 existing game-rule tests passed. Six additional regression cases were then added against the legacy implementation for previously implicit rules:

- current-versus-next upgrade gacha milestones;
- battle blocker precedence and readiness thresholds;
- penalty coercion and exact expiry boundaries;
- actual play spending, happiness caps, and the dead-pet guard;
- bounded, newest-first, immutable activity ledgers;
- clearing stale death metadata when fullness becomes positive.

After the facade switch, the complete suite of 94 rule tests runs against the modular implementation. The architecture contract test also verifies that both import paths expose the same 130 runtime names and the same object/function identities. TypeScript compilation checks existing type consumers through the legacy facade.

## Intentional non-changes

- No gameplay costs, rewards, limits, formulas, random behavior, or balance values changed.
- No API request/response contract changed.
- No persisted student, pet, boss, reward, or classroom shape changed.
- No database schema or migration changed.
- No authentication, authorization, tenant, CSRF, or privacy behavior moved into the domain package.

## Remaining technical debt

- Most application code still imports the compatibility facade. Migration to focused module imports should be gradual and opportunistic; a repository-wide import rewrite would add risk without changing behavior.
- Several composed rule functions still use `Date.now()` or `Math.random()` defaults for backward compatibility. Callers can already inject time or randomness in the important paths, but a future change could standardize explicit clock/random ports after dedicated compatibility tests are added.
- `battleRules.ts` and the daily/learning rule modules are the largest remaining domain files. They now have cohesive ownership, so any further split should follow observed change patterns rather than file size alone.
- Runtime export compatibility is snapshot-tested. Type compatibility is currently protected by TypeScript compilation of existing consumers; a future public package boundary could add dedicated type-level API snapshot tooling.
