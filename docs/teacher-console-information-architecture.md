# Teacher Console information architecture

## Problem and direction

The former seven feature tabs mixed unrelated teaching tasks. Analytics contained evidence entry and exams; Activities combined weekly learning goals with boss management; Records combined daily comments, reports and ledgers. Settings appeared beside everyday work, while the current class selector was available only under Students.

The console now starts at **Today**. Five primary work areas replace the feature list. **Settings** is a separate secondary action. Each work area has one flat row of task tabs; there are no expandable menu trees. The existing product visual language remains in place: this is an information-architecture change, not a visual redesign.

## Destination map

| Area | Tasks | Existing functionality reused |
| --- | --- | --- |
| Today | Current class, quick actions, pending work, recent activity, important alerts | Read-only projections of existing feedback, goal, boss, evidence, exam and ledger data |
| Class | Students, groups, points/rewards, comments, records | Enrollment/import, class administration, existing classroom teams, point and penalty actions, mentor comments, record ledgers |
| Learning | Evidence, exams, goals, reports | Existing evidence editor, assessment/results and exports, weekly class goals, weekly A4/CSV feedback reports |
| Activities | Pets, boss, battle, game rewards, leaderboard | Same classroom pet/battle/boss controls and dialogs; boss management; existing boss reward history; individual and team leaderboards |
| Insights | Student analytics, class analytics, learning trends | Existing student competency profiles, class/economy metrics, evidence trend and competency trend indicators |
| Settings | Rules, reward settings, workspace/users, security/account, data governance | Game/calendar settings, point reasons/guardrails/participation/season rewards, summon-time boss reward drafts, RBAC/invitations, privacy/public display controls, exports/import, revision recovery, audit and account lifecycle |

`Class > 獎勵` retains the established localized label; it contains point feedback and penalties. `Activities > 遊戲獎勵` means recorded game outcomes. Configuration belongs in `Settings > 獎勵設定`. These are distinct tasks, not duplicated reward implementations.

Groups are the existing game teams, not a new classroom grouping model. Activities embed the existing classroom implementation; the standalone student presentation hall is still available from the application header. Pets and Battle retain shared pet-card actions rather than introducing alternate gameplay controls.

The existing usage guide remains available below the pet/battle controls so the selected task is immediately actionable.

Security routes directly to existing workspace access and governance/account-lifecycle controls. Password recovery remains on the sign-in screen. No new session-management or authentication API is implied.

## Responsibilities and state

- `features/teacher-console/model/navigation.ts`: typed, localized destination map and presentation capability filtering. It does not grant backend authorization.
- `TeacherConsoleNavigation`: primary navigation and flat task tabs, active semantics and keyboard behavior.
- `TeacherClassContext`: persistent class context. Writers use the existing guarded switch action; viewers select a class locally without changing persisted workspace state.
- `TeacherTodayDashboard` (`TodayOverview` compatibility export) and `model/todayOverview.ts`: a bounded, non-mutating, action-oriented workbench. Pending counts are optional reminders, not invented deadlines or mandatory tasks. Daily comments use the class calendar timezone; weekly goals and point fairness retain their existing global calendar definitions. The summary refreshes immediately on data changes and every minute while visible. See [Teacher Today Dashboard](teacher-today-dashboard.md) for its action flow and reminder definitions.
- `ClassGroupsPanel`: adapts the existing team hook/dialog and canonical team membership helper.
- `ConsoleSecurityPanel`: links to existing security operations, without copying authentication logic.
- `DashboardView`: composition, navigation, capabilities and high-level shared drafts. It remembers the last task per area for the current mounted console.
- Existing Analytics, Records, Rewards, Boss and Settings components expose backward-compatible presentation modes (default `all`). One owner remains mounted for each editor. Hidden wrappers remove inactive controls from keyboard/accessibility traversal without discarding drafts. Heavy analytics/governance/game bundles load on first use.
- `ClassroomView` optionally embeds focused game surfaces, retaining the standalone default. Embedded dialogs open only while the surface is visible.

Settings still has one shared draft/save owner. Save applies pending rule, reward and governance drafts together, exactly as before; a visible hint makes that clear. Boss reward settings remain summon-time drafts and take effect on the next summon, not an independent settings save.

## Accessibility and responsive behavior

Primary navigation uses native buttons in the `Teacher Console` landmark with `aria-current="page"`. Task tabs use `aria-selected`, one roving tab stop, arrows, Home/End, and an associated focusable panel. Active state is expressed through shape/border/weight as well as color. Keyboard focus remains visible.

The five primary actions fit one compact mobile row; Settings is on a separate row. Task tabs wrap instead of creating deep mobile menus. New navigation targets are at least 44px high. Class context and Today cards stack on narrow screens.

Owner/admin Settings gates, teacher class assignments, viewer read-only restrictions and backend RBAC are unchanged. Viewers retain analytics, records, saved exams and reports. They do not see mutation destinations or Settings. APIs, database schema, persisted data, game values, CSRF and authorization contracts are untouched.

## Verification and follow-up debt

Regression coverage includes destination/capability mapping, school-timezone reminders, immutable bounded summaries, primary/mobile/keyboard navigation, editor draft retention without writes, relocated settings/export functionality, team editing and embedded game workflows, and viewer saved-exam review with server write denial. Existing E2E and axe checks are retained and updated to the new task locations.

Leaderboard coverage explicitly checks the default hidden individual board and the existing team board before opting into growth display through the real Settings UI. Neither production privacy defaults nor gameplay values were changed to satisfy the test.

The new console suite and existing dashboard/workspace suites reuse real registered owners with separately created workspaces. This reduces setup registrations while retaining real cookies, CSRF, backend authorization, independent browser contexts and workspace data isolation. Production rate limits are unchanged. As of the 2026-10-03 Today implementation, login and workspace session reset start at Today; the standalone presentation hall remains available from the header.

TypeScript excludes generated `dist`, browser reports under `output`, coverage, and Wrangler artifacts. Application, server, shared domain, scripts and tests remain checked; no diagnostics are suppressed or rule checks disabled.

Final local verification on 2026-10-02:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed; application and test TypeScript checked |
| `npm test` | 230 checks passed, including game rules, authentication, server and D1 regressions |
| `npm run test:dashboard` | 11/11 passed, including five new console model regressions |
| `npm run build` | Passed; browser suites also rebuild the current production bundle |
| `npm run check:worker` | Passed; dry-run only, no deployment |
| `npm run test:e2e` | 26/26 passed, including six new Teacher Console scenarios |
| `npm run test:a11y` | 13/13 passed; 25 distinct axe scan states, zero confirmed violations |
| `git diff --check` | Passed |

Desktop Today/Class/Boss/Settings and mobile screenshots were reviewed. Six axe states still have color-contrast `incomplete` findings; these are manual-review work, not evidence of conformance. See [accessibility backlog](accessibility-backlog.md) for the remaining accessibility and screen-reader work. E2E and accessibility run sequentially against isolated local test data on port 3100, never production Worker/D1.

The subsequent Teacher Today implementation was verified on 2026-10-03: `npm test` 240 checks, E2E 29/29, axe 13/13 with 29 distinct states and zero confirmed violations, lint/build/Worker dry-run all passed. The six existing contrast-incomplete states remain. See [Teacher Today Dashboard](teacher-today-dashboard.md) for the changed-file inventory, action flows and reminder definitions.

Remaining deliberate boundaries:

- Navigation remains in-memory, matching the previous console. URL deep links/history restoration require a separate routing change.
- Learning trends reuse existing indicators, not a newly invented historical time-series dataset.
- Governance retains its existing internal revision/export/audit/lifecycle tab strip. Flattening that complex workflow can be a later scoped change.
- Settings saves all shared drafts; independent per-task saving would change existing behavior and needs a separate design decision.
- Some existing dense tables and legacy form controls still use their original responsive layout/touch sizing; this change does not redesign every feature panel.
