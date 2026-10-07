# Teacher Today Dashboard

Updated: 2026-10-03.

## Outcome and scope

Teacher login and workspace session reset now open the Console at Today. The standalone Classroom remains available in the header. The current workspace and class stay visible across Console destinations. No feature, gameplay rule, API contract, authentication guard or persisted data structure is removed or changed.

Today is a workbench, not another analytics screen: quick actions come first, followed by five small counts, actionable reminders and at most five recent events. Full analytics stays in Insights.

## Action flow

| Action | Existing owner and behavior |
| --- | --- |
| Give / deduct points | Click the Today action, then a student to apply the visibly displayed configured reason and amount. The initial reason follows existing pinned/recent ordering, filtered by sign. Changing the reason is optional. No student is preselected and opening the dialog never writes. |
| Custom points | The same dialog exposes a custom form with a student picker, positive whole-number magnitude, required feedback reason and competency. Deduct sends the negative amount to the existing manual action. This intentionally needs more interaction than a configured shortcut. |
| Add comment | One click opens the existing daily mentor feedback editor for the current class. |
| Add evidence | One click opens the existing learning evidence editor. |
| Create / import exam | One click opens the existing exam editor, including its existing import controls and saved exams. |
| Start classroom activity | One click opens the existing pet/activity surface; boss and battle remain flat Activities destinations. Starting an activity still requires its existing game controls. |

Configured shortcuts share one `RewardsSection.applyPointReason` handler with the original points table. Both call guarded `addPoints(..., 'quick', reason)`. Custom actions reuse `addPoints(..., 'manual', reason)`. Daily caps, clamping, participation top-ups, catch-up support, undo, record/evidence creation and synchronization remain owned by the store/domain layer. Displayed preset magnitude can differ from the actual delta because those safeguards still apply. No invented point values or automatic deductions are introduced.

Empty classes show an add/import-students action and disable student-dependent shortcuts. Read-only users see review links instead of mutation actions. Existing backend role/class assignment enforcement is unchanged.

## Summary and reminder definitions

- Student count: selected authorized class only.
- Needs attention: deduplicated learners with active `needsSupport` evidence in the last seven days, mentor-authored support comments in that interval, or teacher-only negative point feedback without positive feedback today. Low point totals and pet state are not diagnoses.
- Evidence today: active canonical revisions, limited to existing learners and the class calendar day. Superseded, orphaned and future records are excluded.
- Exam activity today: saved exams updated on the class calendar day, not the number of scores or examinations scheduled for today.
- Pending comments: learners without a mentor-authored comment for the class calendar day. These are optional reminders, not mandatory tasks, deadlines or a new persisted task queue.
- Negative concentration: an explicit display-only heuristic requiring at least three negative teacher actions on one learner, at least half of the class's negative actions, and the existing class feedback ratio below its configured target. It asks the teacher to review context; it does not diagnose, rebalance or automatically penalize.

Evidence/comments use the class timezone. Point fairness uses the workspace timezone, matching the existing point safeguards and Rewards screen; weekly goals retain the existing global calendar. When daily timezones differ, Today explains this distinction. Automated participation/task/catch-up rewards do not count as teacher feedback for attention or concentration.

Recent activity merges existing point changes, comments, evidence, penalties, exams and boss rewards, sorts newest first and keeps five. Invalid/future timestamps are excluded. The projection returns IDs, counts and event categories, not student names or free-form feedback. Names for limited attention reminders are resolved only in the authorized, in-memory class presentation. No student PII is added to logs, analytics or browser storage.

## Architecture and responsibilities

- `model/todayOverview.ts`: pure read-only projection; reuses canonical evidence revisions, education insights, point fairness, mentor counts, goals and record collections. It never writes or imports React/Zustand.
- `model/todayActions.ts`: typed action identifiers and ephemeral point-entry requests; no business services.
- `components/TeacherTodayDashboard.tsx`: localized responsive presentation and semantic action buttons. Memoization avoids recalculating the projection for unrelated renders; data changes refresh the timestamp cutoff immediately, with a minute tick for idle-day rollover.
- `components/TeacherClassContext.tsx`: visible workspace/class context, using the existing guarded class switch or viewer-local selection.
- `DashboardView.tsx`: composition, capability-aware destination/focus coordination and ephemeral point/ledger requests only.
- `RewardsSection` / `PointAdjustmentDialog`: existing mutation owner and modal extended with a picker entry, configured presets and custom form. Legacy student/batch/class dialog contracts remain compatible.
- Records components / `model/recordNavigation.ts`: typed ephemeral ledger selection, so a concentration or recent-point link opens Points rather than the default penalty ledger. Existing category buttons still work.
- `App.tsx` / `useStore.ts`: existing session lifecycle sets the initial view to Dashboard; App retains the global sync/access alert and unmounts editing on conflict/forbidden/offline. Today does not reveal cached content during blocked synchronization or bypass resolution.

The UI/UX skills informed action-first ordering, visible labels, compact mobile layout, keyboard focus, touch targets and contextual feedback. Existing visual tokens and feature editors were reused; no marketing layout or new design system was introduced.

## Verification

Before implementation, the focused authentication/navigation browser baseline passed 11/11. During implementation, focused model, TypeScript and real-browser action tests were run. New regression coverage includes calendar boundaries, canonical evidence revisions, immutable/name-free summaries, optional pending counts, future timestamps, teacher-only feedback, concentration, penalties, immediate freshness and six action identities.

Three new E2E scenarios cover custom and two-click configured point actions with actual persisted records, required reasons, existing participation support, immediate recent-activity updates, comments/evidence/exams through canonical editors, mobile/keyboard/focus behavior and concentration ledger navigation. Existing viewer/server-denial and sync-conflict tests additionally assert Today cannot expose write actions. Login helpers explicitly assert the Today landing before navigating elsewhere.

Four additional axe scan states cover Give/Deduct in preset and custom modes, with no disabled rules or exclusions. Browser tests use isolated local Node fixtures, real sessions/CSRF and synthetic learners; never production Worker/D1.

Final local verification on 2026-10-03:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed; application and test TypeScript checked |
| `npm test` | 240 checks passed, including all 94 game rule cases and auth/server/D1 regression suites |
| `npm run test:dashboard` | 21/21 passed; ten new Today model cases |
| `npm run build` | Passed |
| `npm run check:worker` | Passed; dry-run only, no deployment |
| `npm run test:e2e` | 29/29 passed; three new Today scenarios plus existing behavior/security checks |
| `npm run test:a11y` | 13/13 passed; 29 distinct axe scan states, zero confirmed violations |
| `git diff --check` | Passed |

Desktop/populated Today, mobile Today and preset/custom point dialog screenshots were inspected. Six existing scan states retain `color-contrast` incomplete results; the four new point dialog states have neither violations nor incomplete results. Screen-reader/manual contrast review is still required. The original PII-cache isolation test changes only its explicit session-view expectation from Classroom to Dashboard; all cache/session reset assertions remain intact.

## Files changed in this increment

- Today UI/model: `src/features/teacher-console/components/{TeacherTodayDashboard,TodayOverview,TeacherClassContext}.tsx`, `src/features/teacher-console/model/{todayOverview,todayActions}.ts`.
- Composition/session landing: `src/components/DashboardView.tsx`, `src/App.tsx`, `src/store/useStore.ts` (view defaults only).
- Reused operations/navigation: `src/features/rewards/components/{RewardsSection,PointAdjustmentDialog}.tsx`, `src/features/records/components/{DashboardRecordsSection,DashboardRecordsPanel}.tsx`, `src/features/records/model/recordNavigation.ts`.
- Regression coverage: `tests/teacherToday.test.ts`, `tests/gameRules.test.ts` (new session-view expectation only), `tests/e2e/{teacher-console-navigation,data-safety,dashboard-refactor}.spec.ts`, `tests/e2e/support/fixtures.ts`, `tests/accessibility/pages.spec.ts`, `package.json` (include Today unit tests in `test:dashboard`).
- Documentation: this file, `docs/teacher-console-information-architecture.md`, `docs/accessibility-backlog.md`.

Other uncommitted architecture/security/deployment work predates this increment and is preserved.

## Remaining boundaries / technical debt

- This is not a statistical student-risk model. The concentration heuristic needs teacher interpretation and product validation before changing thresholds or adding user configuration.
- Recent events are capped at five; full history remains in Records. No new backend event stream or due-date service was invented.
- Comment/evidence/exam actions open canonical editors in one click; entering new information still takes typing and explicit save. Activity launch opens the existing surface, not an automatic boss/battle start.
- Configured point shortcuts do not persist a new Today-specific preference. Custom amounts/reasons remain explicit; existing reason settings are the source of truth.
- Browser navigation stays in memory; URL deep links and selecting a specific student from a reminder need a separate scoped routing/filter decision.
- Large rosters use a scrollable button grid in the shortcut dialog; search/virtualization is deferred pending measured need.
- Assistive-technology, non-Chromium, zoom and contrast-incomplete review remains in [accessibility backlog](accessibility-backlog.md). Automated tests are not a WCAG certification.
