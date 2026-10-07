# PetCard refactor

## Original problems

`src/components/PetCard.tsx` previously combined several unrelated concerns in
one component: Zustand store selection, current-class lookup, education evidence
selection, game-rule calculations, cooldown timing, animation rendering, pet
stats, action availability, reward display, and every interaction callback.
The component also repeated upgrade, gacha, warning, daily-task, and boss-attack
values that already belonged in the game rules layer. Its selectors used
untyped `any` values and some empty-array fallbacks changed identity on every
store evaluation.

## New architecture

`PetCard.tsx` is now a small compatibility shell. It subscribes to the minimum
store state, builds one semantic view model, and composes feature components.
It does not calculate costs, battle readiness, evolution eligibility, rewards,
or cooldown values in JSX.

The feature lives under `src/features/pets/`:

- `model/petCardModel.ts` builds a deterministic, React-independent model from
  a student, classroom settings, learning records, animation state, and an
  explicit timestamp.
- `hooks/usePetCardStore.ts` owns typed, focused Zustand subscriptions and
  stable empty fallbacks. The existing Boss/settings subscription cadence is
  retained so opportunistic refresh of time-derived UI remains compatible.
- `hooks/usePetRecoveryClock.ts` owns only the expiry timer used to refresh a
  recovery badge.
- `presentation/petPresentation.ts` maps semantic pet conditions to icons and
  the existing Tailwind visual treatment.
- `components/PetCardHeader.tsx` renders masked identity, level, warnings,
  streak, team, cooldown, and points.
- `components/PetLearningRewardPanel.tsx` renders current learning-goal progress
  and positive feedback context.
- `components/PetBadges.tsx` renders earned reward badges with accessible names.
- `components/PetVisual.tsx` renders the pet, rank, evolution effects, and
  existing animations; `PetStats.tsx` owns the two accessible stat meters.
- `components/PetActions.tsx` preserves action ordering and composes focused
  care, daily reward, evolution, battle, boss, and warning components.

The authoritative values for pet maximum level, upgrade requirements and cost,
gacha cost, and boss attack blocking now live in `src/gameRules.ts`. Store
mutations, settings previews, and the PetCard model consume those shared rules.
No API contract, persisted data shape, database schema, or gameplay value was
changed.

## Accessibility

Each card is now an `article` named by its already-masked public student name.
The visible name is a heading, fullness and happiness are labelled
`progressbar` elements, earned badges and pet status have accessible labels,
and decorative icons/animations are hidden from assistive technology. Existing
text-labelled action buttons remain keyboard-operable without putting raw
student names into labels or client metadata.

## Regression coverage

- Game-rule tests pin the established upgrade thresholds/costs, gacha cost,
  boss attack gate, and store mutation results.
- Pure pet-card model tests cover action boundaries, all displayed pet
  conditions, battle modes, penalty/cooldown behavior, masked names, and
  inclusive feedback display.
- The existing Dashboard/Classroom E2E flow now scopes battle and team actions
  through the accessible card and checks the stat meters.
- The existing Classroom accessibility flow exercises hatch, team, and battle
  controls by keyboard and scans the pre-hatch, post-hatch, and dialog states.

### Executed validation (2026-09-15)

- Before implementation: `npm run test:rules` passed all 85 existing rules.
- After implementation: `npm test` passed all 151 tests, including 88 game-rule
  tests and 4 pet-card model tests.
- `npm run lint`, `npm run build`, and `npm run check:worker` passed. The Worker
  command was a dry-run only; no production deployment or migration occurred.
- `npm run test:e2e` passed 20/20. After the final heading/render-cadence review,
  the relevant Dashboard/Classroom spec was rerun and passed 2/2.
- The final Classroom accessibility case passed 1/1 with four axe scan states
  and zero confirmed violations at any impact. Pre/post-hatch contrast still
  has axe incomplete results from overlapping visual layers; these remain a
  manual-review item in `docs/accessibility-backlog.md`.

## Remaining technical debt

- In `both` battle mode, the card keeps the legacy readiness behavior: a
  fullness-eligible team path can enable the battle entry point before the
  stricter opponent dialog verifies a complete ready team. Changing it would
  alter current UX/game behavior and should be addressed as a separate rules
  change.
- Pet animation markup remains intentionally detailed in `PetVisual.tsx` so the
  visual behavior stays unchanged. If animations expand, they could become
  separate visual-only components without touching the model.
- Class goals and evidence are still subscribed per card. The pure model makes
  a future class-level cached projection possible, but that optimization needs
  profiling with realistically large rosters before adding more memoization.
- Penalty expiry and school-day boundaries still refresh on the next card
  update, as before. Only Boss recovery has a dedicated expiry timer; an
  explicit broader time-boundary refresh strategy is a separate follow-up.
