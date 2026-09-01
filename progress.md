Original prompt: 執行P0第1項

## 2026-08-25

- Started P0 gamification calendar work: school timezone, non-school-day streak freeze, and auditable make-up claims.
- Preserve backward compatibility for existing workspaces and daily task records.
- Added timezone-aware school dates, weekday/holiday/leave streak freezes, ordered make-up windows, and audit fields on daily-task point records.
- Added teacher controls for school calendar and per-student approved leave, plus make-up/frozen states in the student card.
- Validation so far: production build, TypeScript lint, and 59 rule tests pass.
- Final validation: full `npm run verify` passed (108 tests, production build, Worker dry-run); the calendar, leave, frozen-day, and completed-task flows were also exercised in a real browser with no new console errors.
- Follow-up suggestion: a future P2 enhancement could import government/district holiday calendars; this P0 implementation supports explicit ISO dates and configurable teaching weekdays.

## P0-2 · 2026-08-25

- New request: 執行P0第2項
- Scope: add configurable daily positive/negative point guardrails, fairness reminders, uncovered-student visibility, and auditable cap outcomes without breaking existing point workflows.
- Implemented per-student, per-school-day caps for quick, manual, and airdrop point feedback; daily tasks and game-system rewards/costs remain outside the cap.
- Added auditable requested/applied values and clamped/blocked outcomes to point records, including import normalization and undo-safe behavior.
- Added reward-screen fairness visibility for positive/corrective ratio, reminder target, uncovered students, and guardrail outcome counts.
- Added administrator settings for enabling limits, daily positive/negative caps, and the positive feedback ratio reminder.
- Rule/store compatibility checks: TypeScript passed; 64 rule tests passed.
- Final validation: full `npm run verify` passed (112 tests), production build completed, Worker dry-run passed with a workspace-scoped log path, and authenticated browser checks confirmed clamping, fairness reminders, settings persistence, and audit presentation with no console or HTTP 5xx errors.

## P0-3 · 2026-08-25

- New request: 執行P0第3項
- Scope: add a configurable daily minimum participation top-up and a once-per-school-day catch-up bonus for students below the class median by a defined gap.
- Design constraint: support rewards are separate, auditable records; they do not consume teacher-feedback caps or inflate positive/corrective feedback ratios, and adjustments awarded with a teacher action must undo atomically with that action.
- Implemented defaults of 20 minimum daily participation points, a 100-point post-reward gap below the projected class median, and a +10 once-daily catch-up bonus; all are configurable or can be disabled.
- Integrated support with quick/manual/batch/class adjustments and daily-task claims. Batch eligibility uses the class state after every base adjustment, and support rewards never add RP or public growth metrics.
- Added separate `participationTopUp` and `catchUpBonus` audit records, support-aware import normalization, an atomic multi-record undo, a teacher watchlist/summary, and rule settings.
- Final validation: TypeScript and 68 rule tests pass; full `npm run verify` passed (116 tests), the production build completed, and the Worker dry-run passed.
- Authenticated browser verification confirmed the combined +15 minimum top-up and +10 catch-up bonus, atomic undo, separate audit records, and settings persistence after reload. No browser console errors or HTTP 5xx responses occurred.
- Final UI review confirmed the support summary, watchlist, audit labels, and settings remain readable at desktop width; large watchlists are capped to an eight-student preview with a remaining-count indicator.

## P0-4 · 2026-08-25

- New request: 執行P0第4項
- Scope: make boss counterattacks safe by default so impact is shared as a recoverable activity state instead of being randomly concentrated on a few students.
- Added a recommended `recoverable` shield-regroup mode. It distributes a temporary class impact marker across every living pet without reducing points, RP, fullness, happiness, or access to game actions.
- Inclusive mode and all safety presets now force recoverable boss attacks. Shared-fullness and random-target modes remain available only when inclusive mode is disabled and display an explicit persistent-impact warning.
- Added configurable 1–120 minute regroup time (15-minute default), automatic UI expiry, visible student status badges, and a teacher action to complete the class regroup immediately.
- Final validation: 71 rule tests and the complete 119-test suite pass; production build and Worker dry-run also pass.
- Authenticated browser checks confirmed the inclusive-mode lock, warning for persistent-impact modes, saved recovery duration, unchanged student points/fullness, two visible shield statuses, and one-click class regroup. No browser console errors or HTTP 5xx responses occurred.
- Final screenshot review confirmed the boss encounter, student status badges, regroup action, and the distinct “class shield impact” setting are readable and visually separated from persistent damage modes.

## P1-1 · 2026-08-25

- New request: 執行P1第1項
- Scope: bind every reward reason to one of five learning competencies: participation, collaboration, self-management, assignment quality, or growth.
- Found and fixed a migration gap where recent custom feedback saved only its label and silently reverted to participation when reused.
- Feedback history now preserves the selected competency, migrates legacy string entries, and inherits the competency of a configured shortcut when labels match.
- New teacher rewards always write an auditable competency; participation support uses participation, daily tasks use assignment quality, and season rewards use growth.
- Reward shortcuts expose their competency at a glance, and student cards use the newest positive reward or learning evidence to show both the reason and competency.
- Final validation: all 119 automated checks, production build, and Worker dry-run pass. Authenticated browser testing confirmed configured shortcut labels, custom-reason competency reuse, two persisted competency-tagged audit records, structured feedback history, and student-card display with no post-login console errors or HTTP 5xx responses.

## P1-2 · 2026-08-25

- New request: 執行P1-2
- Scope: support 1–3 class goals per week and show each student the next attainable goal plus why points were earned.
- Found a progress bug: passing an empty learning-evidence array caused every competency-tagged point reward to be ignored by class goals.
- Goal progress now combines qualifying positive rewards and positive learning evidence while excluding participation safety-net and catch-up records.
- Goals now carry a Monday-based school-timezone week key. Prior weeks remain archived in workspace data, while only the current week can be edited or displayed as active.
- Next-goal selection excludes completed goals, prioritizes unstarted goals for breadth, then selects the goal with the fewest remaining steps.
- The dashboard and classroom now show the active week range; the dashboard exposes current/three goal capacity and retains an archived-goal count without carrying old goals into the new week.
- Student cards show personal goal progress, the next attainable goal, a completion state when all weekly goals are done, and the historical fixed reward reason when it is safe for public display.
- Final validation: all 123 automated checks, TypeScript, production build, and Worker dry-run pass. Authenticated browser testing confirmed two weekly goals persisted with the correct week key, reward-driven 0/1 → 1/2 goal selection, completed-state display, fixed reward reasons, and zero post-login console errors or HTTP 5xx responses.

## P1-3 · 2026-08-25

- New request: 執行P1-3
- Scope: require a one-sentence student reflection and self-assessment before a daily-task reward can be claimed.
- Daily tasks no longer award points from a direct click. A keyboard-accessible dialog now collects the reflection, one of five learning competencies, and a support/progress/confident self-assessment.
- Empty or cancelled reflections do not change points, streaks, happiness, or audit records. Valid submissions atomically save one private student-authored reflection and the daily-task reward; make-up reflections use the effective make-up date.
- Student self-assessments remain separate from mentor-created learning evidence and public classroom content. They are visible in the mentor dashboard’s daily-feedback records with a clear “學生自評” source label.
- While extending the shared reflection store, mentor feedback was also fixed to preserve approved-leave dates instead of dropping them when a daily note is saved.
- Final validation: all 123 automated checks, TypeScript, production build, and Worker dry-run pass. Authenticated browser testing confirmed Escape cancellation, blank validation, 0 → 30 point award only after valid reflection, private/public separation, dashboard record visibility, focus handling, and zero post-login console errors or HTTP 5xx responses.

## P1-4 · 2026-08-25

- New request: 執行P1-4
- Scope: replace the rolling seven-day evidence summary with a formal weekly feedback report covering positive/support feedback, reason distribution, students not reached, collaboration participation, and week-over-week trends.
- Added Monday–Sunday report periods based on the configured school timezone, with the current week plus seven prior weeks selectable from the mentor dashboard.
- The report combines teacher point feedback with active learning evidence while explicitly excluding daily-task and game-system point events. Student total scores are never used to infer learning performance.
- Added positive/support ratios, roster coverage, collaboration reach, mentor-feedback and student-self-assessment counts, competency/reason distributions, support watchlists, and exact previous-calendar-week comparisons.
- Added a bilingual UTF-8 CSV export with period, sources, summary, trends, distributions, and student follow-up lists. User-provided cells are protected against spreadsheet formula injection.
- Fixed mentor daily feedback to use the configured school timezone, preventing midnight-boundary records from landing in the wrong school week.
- Final validation: TypeScript, production build, Worker dry-run, and the complete 126-test suite pass. The local browser security policy and a Playwright runtime/browser revision mismatch blocked screenshot-level UI automation; retry the authenticated weekly-report flow when browser automation becomes available.
- Follow-up suggestion: after deploying, perform one manual desktop/mobile pass through week switching and CSV download because automated visual inspection was unavailable in this run.

## P1-5 · 2026-08-25

- New request: execute the P1-5 item from the linked Figma audit (`5:47`): build a teacher economy dashboard for issuance/spend ratio, at-cap rate, duplicate pet changes, and reward concentration.
- Added a bounded per-student economy ledger for actual game issuance/spend and pet-change events. Feeding, play, upgrades, pet draws, upgrade rerolls, revives, solo/team battles, and boss rewards now record their actual clamped point delta without treating educational corrections as voluntary game spend.
- Historical positive point records and boss rewards remain usable. New boss events carry a reference ID so the dashboard never double-counts the same reward through legacy and current ledgers.
- Added a bilingual teacher dashboard in Analytics with 7/30/90-day windows, four headline metrics, issuance/spend breakdowns, top reward recipients, explicit definitions, and configurable-risk signals for inflation, point saturation, repeated pet draws, and concentration.
- Added import normalization and capped record retention for backward-compatible workspace persistence. Existing workspaces need no migration action; old data displays what can be derived from retained point and boss records while new consumption and pet-change metrics accumulate prospectively.
- Final validation: TypeScript, production build, Worker dry-run, 80 rule tests, and the complete 128-test suite pass. The economy tests cover all four formulas, event normalization, spend recording, boss reference deduplication, and revival/feeding records.
- Visual automation could not be completed: the official game client has no local Playwright package, and the in-app browser's admin-enforced localhost policy could not be verified. A manual authenticated desktop/mobile review of the Analytics tab remains recommended after deployment.

## Daily task mentor feedback · 2026-08-30

- New request: change the pet-screen daily-task self-assessment into mentor-authored feedback and suggest relevant or previously used comments while the mentor types.
- New daily-task claims now store `author: mentor` plus `mentorAssessment`; legacy student-authored reflections and self-assessments remain unchanged so historical reports keep their original meaning.
- The feedback field now uses mentor-facing bilingual copy and an accessible suggestion list with mouse and keyboard selection. Suggestions combine deduplicated recent mentor comments from the current class with competency-specific Chinese and English templates.
- Keyword matching prioritizes recently used comments, then phrases for the selected learning competency. Empty searches provide recent and commonly used starting points; unmatched text remains freely editable.
- Final automated validation: TypeScript, all 129 tests, the production build, Worker dry-run, and `git diff --check` pass. Wrangler's first dry-run could not write its default debug log under the sandbox, so the dry-run was repeated successfully with a temporary log path.
- Visual automation remains unavailable because the required Playwright package is not installed in this project; the official game client exits before opening localhost. A manual check of suggestion placement at narrow and desktop widths is still recommended before deployment.

## Mentor feedback and learning evidence integration · 2026-08-30

- New request: integrate the mentor daily-feedback records shown under Records with the learning-evidence content used by Individual Student Analytics.
- Root cause: dashboard-created feedback already wrote an evidence revision, and reload normalization backfilled old mentor feedback, but pet-screen daily-task feedback did not update `learningEvidenceRecords` in the current session.
- Added one shared conversion rule for mentor assessment → evidence level and deterministic source/revision IDs. Pet daily tasks and dashboard feedback now both create or revise the same active evidence record without duplicating analytics counts.
- Existing mentor feedback is still backfilled on normalization; legacy student-authored self-assessments remain separate and are not converted into mentor evidence.
- Individual analytics now labels each evidence source and explicitly identifies synchronized mentor daily feedback.
- Final automated validation: TypeScript, all 130 tests, production build, Worker dry-run, and diff whitespace checks pass. The integration regression covers immediate pet-task sync, same-source revision updates, latest-only analytics counting, and content/status changes.
- Visual automation is still blocked because this project has no Playwright dependency; the required official game client exits with `ERR_MODULE_NOT_FOUND` before it can capture the Records and Individual Analytics screens.

## Individual trend report ranges · 2026-09-01

- New request: let mentors choose the score and comment ranges when exporting a report from Individual Analytics → Assessment Trends.
- Added independent report controls for current, latest-three, or all assessments up to the selected assessment; comments can independently use current, latest-three completed, all completed, or be excluded.
- The UI previews the exact assessment/comment counts without changing saved records. The A4 report records the chosen scope, adds a normalized score-history table when history is requested, and renders dated comment history separately from scores.
- Added per-item export checkboxes with select-all and clear-all actions. Deselected assessment rows are also removed from the report's strengths, focus areas, and missing-score cards; clearing every item retains only overall/trend/history and comments.
- PDF rendering was validated through headless Chrome and Poppler at A4 size. A worst-case fixture with four assessments, three selected item rows, and four completed comments fits on one readable page without clipping or an orphaned footer.
- Final automated validation: TypeScript, production build, Worker dry-run, all 131 tests, and diff whitespace checks pass. The official game browser client is still unavailable because this project does not install Playwright and exits with `ERR_MODULE_NOT_FOUND` before loading localhost.

## Simplified daily task and pet level decrease · 2026-09-01

- New request: remove the data-entry steps from pet-screen daily tasks and pet level decreases because both workflows were too complex.
- Daily tasks now award the existing points, happiness, streak, make-up, and participation-support results directly from the pet card. They no longer open a feedback form or create mentor feedback / learning-evidence records; existing historical feedback remains readable and the separate mentor daily-feedback workflow remains available in Records.
- Pet level decrease now uses one explicit confirmation instead of a required reason prompt. The system writes a localized audit reason automatically, while the level-one floor, 24-hour cooldown, 10-second undo, and reversal ledger remain intact.
- Removed the retired daily-task dialog, its form-only types and bilingual copy, and the now-unused feedback-suggestion helper. TypeScript and all 82 rule tests pass after updating direct-claim and safety-action regressions.
- Final validation: all 130 automated tests, the production build, Worker dry-run, and diff whitespace checks pass. The official browser client still cannot start because Playwright is not installed, so a final manual click-through of direct daily-task claim plus confirm/cancel level decrease is recommended after deployment.

## Per-class daily-task calendars · 2026-09-01

- New request: let teachers configure the Daily Task Calendar independently for every class instead of sharing one global teaching schedule.
- Added a normalized `dailyTaskCalendar` to each class for timezone, teaching weekdays, class cancellation/holiday dates, and make-up window. Existing workspaces automatically copy their former global calendar into each class, preserving prior behavior while giving every class its own independent arrays and future edits.
- The Rules panel now includes a class selector, an explicit class-only scope notice, and a nearby “Save this class calendar” action. Switching classes refreshes the form, student leave list, and default leave date from that class.
- Daily-task availability, claims, make-ups, streaks, leave handling, pet-card state, and mentor daily-feedback dates now use the selected class calendar. Creating or updating one class does not mutate another class.
- Regression coverage verifies legacy migration, calendar sanitization, per-class update isolation, and different claim outcomes for classes that meet on different weekdays. Final automated validation: TypeScript, production build, Worker dry-run, all 84 rule tests, and the complete 132-test suite pass.
- The official browser client was attempted against the production preview but remains blocked because Playwright is not installed (`ERR_MODULE_NOT_FOUND`). Manually verify the class selector and save action at desktop and narrow widths when authenticated UI testing is available.
