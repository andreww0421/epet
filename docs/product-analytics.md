# Privacy-first product analytics

Implemented 2026-10-07. The purpose is to measure teacher workflows and feature
usage, not student performance or individual people. No gameplay rules, API
contracts, authorization, database schema, or persisted app data were changed.

## Architecture and activation

`src/analytics/schema.ts` owns a closed, versioned event contract and a pure final
allowlist. `client.ts` owns opt-in, environment validation, privacy signals and
bounded, fail-silent delivery. `index.ts` exposes the singleton facade to app
services and commands. `actions.ts` translates existing accepted point-action
outcomes into metadata; it does not calculate game outcomes. The separate React
hook `useFeatureAnalytics.ts` observes committed Teacher Console navigation.
This module is separate from the teacher-only educational analytics in
`src/features/analytics/`; student analysis result objects must never be used as
product event metadata.

The client is **disabled by default** and has no vendor, transport, endpoint,
credentials, browser identifier, persistent queue or replay. There is currently
**no remote product analytics collection**. Monitoring/Sentry is separate and is
not used as a product analytics destination. No dependency was added.

A future reviewed adapter must be configured once in the application bootstrap,
not inside feature components:

```ts
import { configureAnalytics, type AnalyticsSink } from './analytics';

// This adapter must be implemented and privacy-reviewed before opting in.
const initializeProductAnalytics = (
  enabled: boolean,
  environment: 'development' | 'staging' | 'production',
  reviewedSink: AnalyticsSink,
) => configureAnalytics({ enabled, environment, sink: reviewedSink });
```

Development, staging and production must be explicitly configured and use
separate collection destinations. An invalid environment fails closed; it never
falls back to production. Do Not Track (`1` / `yes`) and Global Privacy Control
disable delivery, including when the signal changes after initialization. A
cleanup function removes its own configuration without disabling a newer one.

## Events and responsibility

Every delivered event has exactly `name`, `metadata`, `environment` and
`schema_version: 1`. The environment comes from trusted configuration, not the
caller. The event and rebuilt metadata are frozen.

| Event | Allowed metadata | Completion boundary |
| --- | --- | --- |
| `workspace_created` | `creation_source: registration / explicit` | Successful registration or explicit workspace API response; not login or invitation acceptance |
| `class_created` | None | Existing class command commits locally |
| `student_import_completed` | `student_count` | Bulk import commits; count is the actual newly accepted, unique students, not input rows |
| `point_action_completed` | `student_count`, `action_source: quick / manual / airdrop`, `direction: increase / decrease` | Existing point command commits with at least one non-blocked learner |
| `learning_evidence_created` | None | Valid manual evidence commits; not automatic reflection evidence |
| `exam_created` | None | A normalized new exam ID commits; edits and repeat saves do not count again |
| `report_generated` | `report_type: weekly_feedback / exam_summary`, `format: csv / print` | Weekly CSV download initiated, or individual exam print document successfully prepared |
| `boss_started` | None | Existing boss command normalizes and commits |
| `feature_opened` | `feature` from the existing closed Console destination list | Actual committed, access-resolved Teacher Console destination; read-only and Classroom Display navigation excluded |

Counts must be positive safe integers no greater than 100,000. Report type and
format must match an existing operation (`weekly_feedback/csv` or
`exam_summary/print`). Free-form names, arbitrary feature strings and URLs are
not accepted.

Store completion means **locally accepted teacher action**, not confirmed remote
durability. Backend synchronization can coalesce, retry or conflict separately;
hydration, backup import and synchronization never generate completion events.
This avoids deriving usage from persisted snapshots or counting retries.

Point actions reuse existing domain application outcomes. A clamped/capped
action that still records feedback is an accepted action, not necessarily a
changed balance. Each learner is counted once even if participation support
creates several undo ledger entries. Automated daily rewards, catch-up bonuses,
support top-ups, blocked actions, zero changes and undo do not produce additional
teacher completion events. No amount, balance or reason is transmitted.

Report completion does not prove a file was saved or a printer was used. Browser
save/print cancellation cannot be reliably detected. A blocked popup, invalid
draft or failed document creation emits no report event. Filters, template
downloads and personal-data exports are not product report events.
Existing read-only report permissions are preserved; an authorized viewer's
report preparation can also count, without transmitting their role or identity.

Feature openings deduplicate consecutive equal destinations and React effect
replay in one Console lifetime. Returning to a feature after visiting another
feature counts again. A new Console lifetime may count its initial destination
again; there is no cross-session identity or history. Hidden mounted owners do
not count as visits. Access resolution and server RBAC are unchanged.

## Data boundary

Never pass student names/IDs, workspace/class/user IDs, email, exam scores, points
amounts, comments, evidence contents, passwords, session tokens or CSRF tokens to
analytics. Also excluded: timestamps, event IDs, IP addresses, user agents,
referrers, current URLs, query/hash parameters, DOM text, browser storage,
fingerprints and session/visitor profiles.

The final sanitizer rebuilds only allowed primitive fields rather than deleting
known bad fields from an arbitrary object. Extra fields, nested objects,
prototypes, getters and custom serializers are not forwarded. Required invalid
values discard the event. This security-best-practices allowlist also keeps
component instrumentation vendor-independent.

The adapter receives only this safe event, but JavaScript cannot prevent an
adapter from reading the surrounding browser. Therefore a third-party SDK must
not add IP/location/browser context, cookies, visitor IDs, autocapture, page
tracking, replay or network breadcrumbs. SDK defaults and collection-side
behavior need a separate review. Do not assume a sanitized payload makes an
unreviewed third-party SDK safe.

No current client network request exists. If a transport is added later, review
destination ownership, retention, consent, credentials/referrer handling and
environment isolation. A first-party aggregate collector should independently
validate the same contract, apply rate limits and avoid recording request IPs or
user/session context. Do not reuse state-save payloads or monitoring exceptions.

## Reliability and interpretation

Delivery failures are swallowed without logging payloads, surfacing errors or
changing product results. There is no retry, persistent buffering or replay.
Reentrant delivery is suppressed. At most 16 deliveries remain pending;
completion is released in a microtask even for a synchronous adapter, so more
than 16 events in one synchronous burst are dropped. This prioritizes bounded
memory and non-interference over lossless telemetry. An opted-out/disabled event
is never delivered when collection later becomes enabled.

These events support aggregate action totals, feature popularity and workflow
adoption. They do **not** support unique teacher counts, per-workspace funnels,
individual retention, reliable billing/auditing or student outcome analysis.
Without identity, timestamps and delivery acknowledgements, do not label them
DAU, successful backend saves or exact durable transaction counts. A future
collector may aggregate reception-time windows without modifying the payload;
its retention and access controls still require review.

## Verification

`npm run test:analytics` covers the closed privacy contract, malicious object
inputs, environment/opt-out controls, bounded and failing adapters, exact API
completion boundaries, post-commit store behavior and navigation deduplication.
Existing game-rule tests remain the authority for gameplay behavior.

`tests/e2e/product-analytics.spec.ts` exercises real teacher UI actions with
synthetic sensitive canaries. The existing E2E-only Vite build injects an enabled
local development sink that dispatches safe events to the test. Production builds
contain no test collector or debug endpoint and remain disabled. The browser
fixture does not send events externally or persist them.
Synthetic builds are served exclusively from `output/playwright/server-dist`,
never deployment's `dist` directory. This also isolates the existing monitoring
test configuration from production assets.
`npm run build` also runs `scripts/check-production-analytics.mjs`, which scans
all generated assets (including unreferenced stale chunks) and fails with file
names, never contents, if a synthetic analytics hook remains. Missing/unreadable
assets and symbolic links fail closed. Two regressions verify build/serve path
isolation and rejection of stale bundles even when HTML references a clean one.

Feature E2E fixtures reuse legitimately issued sessions and keep each case in an
independent workspace so the larger suite stays within existing authentication
quotas. The class/teacher feature cases also share one registered owner rather
than creating a new account for each test. Authentication tests still exercise
login, expiry and revocation; production rate limits are not changed or bypassed.

Validation on 2026-10-07:

- Before instrumentation: existing game rules/domain architecture, imports,
  authentication and Dashboard suites passed.
- Final `npm run lint`: passed.
- Final `npm test`: 309 passed, including all 94 game-rule cases and 27 analytics
  regressions.
- Final `npm run test:e2e`: 41/41 passed using the isolated build directory.
- Final `npm run test:a11y`: 14/14 passed; no rules disabled.
- `npm run build`: passed, including the mandatory production artifact guard.
- `npm run check:worker` and `npm run check:worker:staging`: passed (dry-run only).
- Actual Worker runtime tests passed without changing compatibility flags.
  No provider was activated, migration run, or application deployed.

## Remaining decisions

- Select and privacy-review a destination/adapter before enabling collection.
- Define collection-side aggregation, retention and access policy; these are not
  implicitly provided by this client abstraction.
- Anonymous action totals are intentionally best-effort; no identifier-based
  cross-session deduplication or student-level analysis will be added by default.
- Local OneDrive build output was observed retaining obsolete chunks despite
  Vite's intended cleanup; the exact mechanism is unproven. Only the confirmed
  synthetic analytics chunk was removed. Isolation and the post-build guard
  prevent its redeployment; general reproducible-output cleanup remains debt.
- Existing >500 kB frontend chunk and optional Sentry Node-import build warnings
  remain. No warning threshold or Worker compatibility flag was changed;
  the existing actual Worker runtime tests remain part of `npm test`.

## Changed files

- `src/analytics/{schema,client,index,actions,useFeatureAnalytics}.ts`: contract,
  privacy/delivery boundary, facade, accepted-point translation and navigation.
- `src/store/useStore.ts`: post-commit class/import/point/evidence/exam/boss events.
- `src/services/backendApi.ts`: successful workspace creation events only.
- `src/components/DashboardView.tsx`: committed access-resolved feature openings.
- `src/features/records/components/WeeklyFeedbackReportPanel.tsx` and
  `src/features/exams/components/ExamAssessmentPanel.tsx`: fixed report metadata
  at the existing browser preparation/download boundaries.
- `tests/analytics{Privacy,Api,Store,Navigation}.test.ts`: 25 focused regressions.
- `tests/analyticsBuildBoundary.test.ts`: two production artifact regressions.
- `tests/e2e/product-analytics.spec.ts`: four real-browser regressions.
- `tests/e2e/support/web-server.ts`: synthetic local sink in the E2E build only.
- `tests/e2e/support/paths.ts` and `server.ts`: pin synthetic builds and serving
  to a non-deployment output directory.
- `tests/e2e/class-and-teacher.spec.ts`: isolated-workspace feature setup with
  one legitimate registration; existing assertions unchanged.
- `scripts/check-production-analytics.mjs` and `package.json`: mandatory
  production artifact guard, plus `test:analytics` included in `npm test`.
- This document: contract, completion semantics, activation and remaining risks.
