# Today and optional teacher setup

Updated: 2026-11-04 (Asia/Taipei).

## Behavior

Today keeps its existing overview projection, timezone rules, attention reminders, pending comments/goals and recent records. Its primary actions are now **加減分 / Points**, **記錄成績 / Record grades**, **學習紀錄 / Learning records**, and **開始活動 / Start activity**. Daily comments remain a secondary one-click action. Every action delegates to its existing feature owner, validation, revision and mutation guards.

The optional guide follows five steps: class, roster, teacher point adjustment, student review, then game interface choice. The server already creates a default class for a new workspace: this satisfies step one without another class or workspace creation. If a workspace genuinely lacks an active class, the guide opens existing student/class management; it does not invent a second creation path. Existing invitations and permission checks control whether class creation is available.

A successful fresh registration through the UI creates a one-time, exact user/workspace enrollment marker. Claimed legacy workspaces, existing logins and API-created accounts are not automatically enrolled. Existing users can start the guide themselves. Invited teachers can use the same optional guide within their current permissions. Continue later and Skip hide the expanded guide and retain a Resume action. All five completed steps collapse the guide; data changes do not automatically reopen a completed guide. Interface visibility remains changeable independently.

Class readiness comes from active, authorized classes. Roster and point steps follow the selected active class so the next action operates on the class visible in Today. Only nonzero, unblocked, nonfuture teacher adjustments (`quick`, `manual`, `airdrop`) count; automated task, catch-up and participation rewards do not. The review flag records opening the existing student-insights screen; it does not claim the teacher read or understood a particular student's information. Workspace data remains the authority for actual roster and point records. The existing sync indicator distinguishes pending local edits from confirmed saves.

The game choice controls interface visibility only. Focus on teaching hides the Activities navigation, activity shortcut and presentation-hall entry; Today always provides Show gamification interface to restore them. Existing pet, battle, rewards and point calculations are retained. Existing records remain accessible from Records. This preference grants no API permission and is not an enforcement mechanism for disabling gameplay rules.

## State, privacy and compatibility

No backend endpoint, D1 schema, workspace settings field, student record or migration is introduced. The existing AppData model supplies completion facts. Minimal personal interface metadata is stored separately from educational data and from optional product analytics:

| Item | Contract |
| --- | --- |
| Namespace | `epet-teacher-setup-v1:` plus the existing canonical WorkspaceAccess tuple |
| Binding | Authenticated user ID, workspace ID, role and exact assigned class allowlist; owner/admin use the existing null/full-workspace scope |
| Value | Exactly `{mode, reviewed, gameMode}`; bounded to 256 characters when read |
| Mode | `idle`, `active`, `paused`, `skipped`, `completed` |
| Game mode | `null` (undecided), `shown`, `hidden` |
| Personal/education content | No names, email, student IDs, scores, comments, snapshots, cookies or tokens in values |
| Enrollment | Exact user/workspace sessionStorage marker, consumed after fresh verified workspace load |
| Read timing | Sync controller supplies server-derived verifiedAccess only after authorization and hydration; prior identity/role/workspace bindings are masked immediately |
| Storage failure | Continue with exact-scope memory flags and a visible warning; no teacher action is blocked |

Preferences persist across reload and same-browser relogin. A different account, workspace, role or class scope gets an independent default. Browser storage is not trusted for authorization. Removing these optional keys resets guide choices without changing workspace data. The metadata contains necessary internal account/resource identifiers in its key and should follow the school's shared-device/browser-profile policy. It is not uploaded or sent to third-party analytics. DNT/GPC do not disable functional interface preferences, and no new analytics consent or collection setting is changed.

This is browser-local progress, not cross-device or account-level onboarding analytics. Clearing storage or using another browser may reset preferences; a previously registered account will then see a compact manual invitation, not an automatically forced guide. A future cloud-synchronized preference needs a separately authorized user-preferences model. Existing teachers cannot change workspace settings through this flow, and user-indexed personal progress is deliberately not placed in settings visible to other workspace members.

## Task steps compared

Counts start at Today and count entry/button selections, excluding typing, selecting reasons and explicit editor saves. They are interaction counts, not measured completion times.

| Task | Previous | Current |
| --- | --- | --- |
| Apply configured positive points | Give points → learner (2) | Points → learner (2) |
| Apply configured negative points | Deduct points → learner (2) | Points → Deduct radio → learner (3) |
| Open grades, evidence or daily comments | One shortcut (1) | One primary/secondary shortcut (1) |
| Add/import students to an empty class | Existing empty-class action (1) | Same action or guide CTA (1) |
| Review student status from Today | Class → Student analytics (2), or attention link when present (1) | Guide Review student status (1), with existing attention links retained |
| Establish a first class | Default class already exists (0) | Reuse default class (0), explicitly explained |
| Pause/resume guide or choose game interface | No equivalent ordered guide/preference | One explicit choice; no workspace write |

The negative-point flow intentionally adds a direction selection to reduce six competing primary choices to four. Reasons, sign handling, guardrails, focus restoration and confirmation remain covered by regression tests.

## Verification and release

Run `npm run verify`, the onboarding/navigation/permissions/draft/conflict E2E suites, and accessibility scans against the isolated synthetic server. Test results and limitations are recorded in the latest section of [Today Dashboard](teacher-today-dashboard.md). No production account or student is used. Deployment is not part of this task; rollback is the previous frontend release, with no D1 rollback or secret changes required. Unknown optional interface metadata is harmless to the previous release.
