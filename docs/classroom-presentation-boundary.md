# Classroom presentation boundary

## Scope and outcome

This is a scoped review of what Epet renders to a classroom audience from an already authenticated teacher browser. It is not a backend penetration test or a finding that authentication, workspace authorization, CSRF, or tenant isolation is broken.

The public presentation hall is now a separate, read-only surface. Teacher Console > Activities retains the existing pet, feeding, upgrade, battle, team, boss and reward interactions. The split changes the audience and rendering boundary, not game values, domain calculations, API contracts or persisted data structures.

The threat considered here is accidental disclosure while projecting or sharing a teacher's screen: content legitimately available to that teacher is not necessarily appropriate for every student in the room. CSS hiding, a masked heading, or fullscreen alone does not establish this boundary.

## Exposure inventory and scoped findings

The following are the reviewed exposure paths in the previous shared presentation/management composition. Severity reflects classroom disclosure impact, not an unverified remote exploit. The listed mitigations apply to the new public presentation path; private management features remain available in Teacher Console.

Mitigations describe the inspected source-code structure, not a claim that runtime testing is already complete. Fresh automated/manual results are recorded separately in the verification section below.

### Critical

No Critical issue was identified within this scoped rendering review. This statement does not establish that the entire application is free of Critical vulnerabilities.

### High

| Finding | Evidence / exposure path | Mitigation |
| --- | --- | --- |
| Shared application chrome could expose private context or open management screens during projection | `App.tsx` composed account display name/role, workspace selector and names, teacher navigation, legacy import/migration, conflict recovery and full-data download controls with the classroom view | An early presentation branch mounts `ClassroomPresentationShell` instead of the teacher shell. These controls and account/workspace strings are absent from the presentation DOM, including loading and unavailable states. |
| Masked pet names did not constrain arbitrary educational text | Interactive `PetCard` receives learning data; `PetLearningRewardPanel` can render goal titles and positive-feedback reasons. Freeform text can contain identifying or private information even when the student's heading is masked | Public cards use an explicit presentation DTO containing only permitted display name, catalogue pet type and level. Goals, feedback, comments, exam data, evidence and record objects never enter that DTO. |
| Global transient overlays bypassed the classroom's name presentation | App toasts render arbitrary `toast.message`; the upgrade reward dialog interpolates the cached `upgradeReward.studentName`. Boss feedback/result objects also retain name snapshots and freeform boss labels | Presentation returns before global toast/reward rendering. Its connector does not subscribe to these transient values. Boss display projects only current numeric health, not names, contribution/result tables, cached target names or reward snapshots. |

### Medium

| Finding | Evidence / exposure path | Mitigation |
| --- | --- | --- |
| Public display mixed game celebration with individual education and negative indicators | Interactive pet headers/actions show warnings, penalty status or blocked-action reasons; the growth leaderboard computes per-student learning/feedback indicators; activity panels render learning goals | The public DTO excludes warnings, penalties, points, wins/losses, learning progress and educational metrics. Inclusive display includes every current-class roster member in original order, without scoring or comparison. Existing education views stay in the Console. |
| Presentation was also an operational game interface | Reusing the interactive classroom mounted feeding, upgrade, battle, team and boss mutation callbacks and dialogs | The public renderer has no mutation callbacks or store actions. Explicit `ClassroomView` Console modes continue using the existing interactive components, hooks and domain rules. UI filtering is not a substitute for backend write authorization. |
| Leaving fullscreen or reloading could unintentionally replace a projected surface with private UI | Fullscreen describes browser layout, not which application shell should be mounted; auth/workspace recovery can introduce private forms and controls | Fullscreen state is independent of presentation mode. A tab-scoped non-sensitive flag plus `#/presentation` retain the display guard on reload. Authentication checking, expiry, verification-required and workspace-unavailable states show a generic paused stage rather than forms or cached classroom data. Returning to Console requires confirmation. |

### Low

The remaining Low operational risk is misunderstanding partial masking as anonymity, or treating an exit confirmation as proof that a physical projector has stopped. The shell explains both the audience boundary and the need to stop projection before returning. Software cannot verify that external screen sharing or a projector is disconnected.

## Architecture and responsibilities

```text
Authenticated App + backend synchronization/access status
  ├─ presentation active
  │    └─ ClassroomPresentationShell
  │         ├─ unavailable/not authorized → PresentationPaused
  │         └─ ready → ClassroomPresentation connector
  │                    → buildClassroomPresentation (pure allowlist)
  │                    → ClassroomPresentationContent / PublicPetCard
  └─ teacher mode → existing Teacher Console and management overlays
                   → Activities → explicit interactive ClassroomView modes
```

| Module | Responsibility |
| --- | --- |
| `src/App.tsx` | Select the independent presentation shell before account chrome, authentication forms, migration, export/recovery and arbitrary overlays can render. Pause presentation when the session or workspace is not ready. |
| `features/classroom/hooks/usePresentationMode.ts` | Track only whether presentation is active for this browser tab; retain the guard through reload/hash navigation; expose deliberate enter/leave operations. |
| `ClassroomPresentationShell.tsx` | Public display controls, safe default options, fullscreen status and accessible confirmation dialogs. It has no teacher menu, account information, arbitrary toast slots or game mutation controls. |
| `model/classroomPresentation.ts` | Pure `buildClassroomPresentation` projection. Copy explicitly allowed values, enforce persisted public policy, reuse canonical name masking and game-rank sorting, and normalize display-only numbers/catalogue identifiers. No React, Zustand, time-dependent writes or domain mutations. |
| `ClassroomPresentation.tsx` | The small connector selects the current class/settings and builds one projection. `ClassroomPresentationContent` and `PublicPetCard` render only DTOs and local display navigation. |
| `src/components/ClassroomView.tsx` | No-mode callers use the safe public projection. Explicit Console modes retain interactive pets, battle, boss and leaderboard surfaces. |
| Existing pet/classroom hooks and `src/domain/game/` | Remain the owners of gameplay actions and calculations. Presentation neither copies nor changes those rules. |

The allowlist is preferable to passing a full `Student` object with selected UI fields hidden. A future record or property is excluded by default. Raw student identifiers are not used for public React keys, accessibility names, titles or data attributes.

## Public data contract

The public model contains only:

- Language (`zh` or `en`).
- A roster of display name, validated catalogue pet type and finite normalized level.
- Leaderboard visibility/mode and a separately projected roster. RP (`rankPoints`, game ranking points) is included only when competitive game ranking is explicitly permitted; it is distinct from the spendable `points` balance, which is excluded.
- Optional active boss health (`hp`, `maxHp`), with a generic translated label. Invalid/inactive boss health is omitted; visible health is clamped without changing stored data.

It does **not** contain account/workspace/class names or IDs; student IDs; points or economy records; private notes; warnings/penalties; daily comments/reflections; evidence; exams and results; learning goals or progress; audit/governance objects; boss contributions, result names or reward histories; arbitrary feedback strings or cached UI snapshots.

Unknown persisted pet identifiers are converted to the known egg catalogue entry rather than becoming user-controlled text, CSS, titles or accessibility attributes. Labels come from the existing trusted catalogue/translations. A permitted display name remains user data and is rendered as ordinary React text, not HTML.

## Workspace policy and local options

Persisted workspace privacy policy is the upper bound. Local presentation options can only make the display more restrictive.

| Output | Required conditions |
| --- | --- |
| Masked display names | Default on every new shell and when policy is missing, masked or inclusive. Uses existing `getPublicStudentName`; no second masking algorithm. |
| Full names | Workspace explicitly has `publicNameMode: 'full'` and `inclusiveMode: false`, then the presenter deliberately disables local masking and confirms. Local permission is not persisted. |
| No leaderboard | Persisted mode is `hidden`, missing or unsupported. The local checkbox cannot enable it. |
| Inclusive roster | A leaderboard is permitted, but competitive ranking is not jointly enabled. Every student in the authorized current class is included in stored roster order, including students with eggs; no top-N filtering, educational metrics, scores or rank positions. |
| Competitive game ranking | Workspace explicitly has `publicLeaderboardMode: 'rank'` and `inclusiveMode: false`, and the presenter deliberately disables local inclusive mode. Existing canonical game sorting is reused. |

Persisted `growth` mode becomes a game-only inclusive roster in the public hall, not the educational growth leaderboard. That educational view remains available in Teacher Console. Missing policy fails closed. Policy changes are reevaluated when source settings change, even if a local checkbox was previously enabled.

Both name masking and inclusive display start enabled locally. Their values are not saved to workspace settings or browser storage. The shell disables opt-out controls when workspace policy does not permit them; the pure builder enforces the same restriction independently of the controls.

## Lifecycle and safe exit

1. Entering presentation records only `epet.presentation.active = '1'` in `sessionStorage` and replaces the fragment with `#/presentation`. Neither location stores students, class/workspace IDs, names, records, tokens or privacy preferences.
2. Reloading the tab can recognize either signal. The active in-memory guard is not cleared merely because the URL fragment changes. This is an accidental-disclosure guard, not a browser lock or authorization token.
3. While authentication is checking, expired, signed out or awaiting email verification, presentation stays in its public shell with `PresentationPaused`. It does not replace the projected stage with login/email forms.
4. Missing workspaces, denied access, loading/switching, conflicts and other unavailable synchronization states also pause. Cached classroom content and full-data recovery/export controls are not shown in these states. Connected/saving states can display the authorized current-class projection.
5. Escape or the browser's fullscreen exit only changes fullscreen state. The presentation shell remains mounted. Failure to change fullscreen leaves the safe shell in place and shows a generic message.
6. `End presentation` opens a confirmation. Escape/cancel leaves presentation active. Confirming warns the operator to stop projecting/sharing first, exits fullscreen if necessary, then deliberately returns to Teacher Console. If fullscreen exit fails, private content is not opened.

The presentation session flag is cleared only on this deliberate exit. It does not grant access and is not sent as a credential. Authentication, cookie/CSRF protection, workspace RBAC and class scoping remain enforced by the existing backend.

## Preserved teacher behavior

Teachers continue operating games through Console > Activities. Pet care, gacha, evolution, battle costs and outcomes, cooldowns, team membership, boss attacks/recovery/rewards and existing private dialogs reuse the same handlers and domain calculations. Nothing is disabled in the domain to implement a read-only projection.

The legacy presentation header entry now opens the safe hall rather than a writable teacher game screen. Existing tests for mutations must navigate to the explicit Console Activities destination; they must not re-enable public mutation controls to preserve an obsolete selector. Viewer access remains governed by existing capabilities, not by the presentation flag.

## Verification record

Current-task verification was completed on 2026-10-05. All fixtures are synthetic; no production deployment or migration was performed.

The current implementation adds `tests/classroomPresentation.test.ts` coverage for strict DTO keys, synthetic private-data canaries, immutable inputs, missing/hidden policy, local opt-out restrictions, canonical masking/ranking, inclusive whole-roster order, unknown pet identifiers and malformed boss health.

Five added browser regressions verify the actual DOM and accessible names, not just DTO serialization: private-record/name canaries, a real raw-name teacher toast, absence of teacher navigation/account/export controls, unchanged persisted data, policy-bound toggles, keyboard confirmations, fullscreen entry/exit rejection, Escape, reload/hash/back navigation (including unavailable session storage), detected authentication loss and denied workspace access. Existing gameplay assertions run in Console Activities and still verify saved points, undo, battles and teams. Pending upgrade/Boss-victory overlay sequences and an in-flight sync conflict during projection remain follow-up browser scenarios; their teacher-only composition and unavailable-state branches were inspected, not individually exercised by the new cases.

These are fresh current-task results, not inherited Teacher Console/Today results. An initial full E2E run had two obsolete public-screen expectations; these were moved to the retained private Activities workflow, with new negative assertions for public educational/Boss titles. The complete rerun passed without removing the persisted gameplay assertions or disabling checks.

| Check | Current-task result |
| --- | --- |
| Relevant baseline tests before this change | Classroom 5/5, pets 4/4; targeted gameplay/read-only/CSRF-Origin E2E 3/3 passed. |
| `npm run test:classroom` / `npm run test:pets` | 19/19 (including 14 new presentation tests) and 4/4 passed. |
| `npm run test:rules` / `npm test` | All 254 tests passed, including 94 unchanged gameplay rule cases, auth, Node and D1 suites. |
| `npm run test:e2e` | Complete suite 34/34 passed, including five new projection cases. After the final fullscreen-error dialog wording, the targeted fullscreen entry/exit rejection + navigation/Escape case passed 1/1 again. |
| `npm run test:a11y` | 14/14 passed; 35 distinct axe scan states, zero confirmed violations (including moderate/minor). Nine states have `color-contrast` incomplete; no rules were disabled or elements excluded. |
| `npm run lint` / `npm run build` / `npm run check:worker` | All passed. Worker check was dry-run only; no deployment or migration. |
| Visual/keyboard/fullscreen checks | Inspected real Chromium desktop gallery, mobile inclusive display and both confirmation screenshots; tested 320px layout, focus containment/restoration and native fullscreen behavior. Physical projector, screen reader and other browser/device validation remain outstanding. |

### Files changed in this task

- App boundary: `src/App.tsx`, `src/components/ClassroomView.tsx`.
- New feature modules: `src/features/classroom/model/classroomPresentation.ts`, `components/ClassroomPresentation.tsx`, `components/ClassroomPresentationShell.tsx`, `hooks/usePresentationMode.ts`.
- Regression coverage: new `tests/classroomPresentation.test.ts`; updated `tests/e2e/teacher-console-navigation.spec.ts`, `tests/e2e/dashboard-refactor.spec.ts`, `tests/accessibility/pages.spec.ts`; the `test:classroom` script in `package.json` includes the new unit suite.
- Documentation: this file, the boundary update in `docs/classroom-refactor.md`, and `docs/accessibility-backlog.md`.

The security/UI skills influenced the explicit data allowlist, fail-closed shell, native confirmations, visible keyboard focus and touch-sized controls. Existing business logic, API contracts, database schema and production deployment configuration were not changed by this task.

## Limitations and follow-up boundaries

- This is a display-minimization boundary inside an authorized teacher browser. That browser still receives and holds raw authorized workspace state in memory. DevTools, direct authenticated API access and browser extensions are outside this projection guarantee. This is not an anonymous kiosk or a sanitized public API.
- Partial masking is **not anonymity**. Classmates may recognize a name fragment, pet, level or roster position. Full-name/rank opt-outs require an appropriate classroom privacy decision; software flags cannot establish consent.
- The presenter must stop external projection/screen sharing **before** confirming return to Console. Neither the Fullscreen API nor the exit dialog can verify the physical audience.
- If both browser storage and the URL guard are deliberately removed, the application cannot promise to remember presentation across reload. Do not treat the guard as protection against a user controlling the browser.
- Game ranking is still an individual comparison when deliberately enabled. The default inclusive view avoids that comparison; it does not create a new gameplay balance or ranking algorithm.
- Future public fields require an explicit allowlist decision and synthetic leakage regressions. Do not spread raw records into DTOs, add arbitrary message/HTML slots, or reuse interactive `PetCard` in the public renderer.
- A truly separate public/kiosk endpoint with server-side projection and distinct credentials would be a different architecture and is not introduced by this change.
