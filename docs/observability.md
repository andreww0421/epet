# Privacy-first observability

## Purpose

Epet uses error monitoring only to answer operational questions such as which
application tier failed, which broad route group was involved, and whether an
unexpected HTTP 5xx occurred. Monitoring is not an application data export and
must never receive student, account, authentication, classroom, assessment, or
learning content.

This architecture intentionally trades detailed remote debugging for privacy.
Sentry receives no original exception, message, stack, URL, SDK request
metadata, browser state, request or response body, React props, logs, traces,
sessions, or replay. The checked-in Vite configuration does not emit production
source maps and this project does not upload source maps.

## Data flow and trust boundaries

### Frontend failures

The browser reduces a failure to the categorical `ErrorReport` contract in
`shared/observability/policy.ts`:

- an allowlisted category;
- a broad route group;
- an allowlisted HTTP method;
- an HTTP status only for an unexpected 5xx.

The browser sends that small JSON document to the same-origin
`POST /api/v1/monitoring` relay. It never receives a real Sentry project DSN; a
fixed synthetic DSN enables SDK buffering with the custom relay transport. The
frontend SDK `beforeSend` hook rebuilds an allowlisted event, and the final
transport discards the SDK envelope and rebuilds the relay JSON again. Redaction
alone is not considered sufficient.

The Worker validates and rebuilds the categorical report once more, then sends
a newly constructed Sentry event through `SENTRY_FRONTEND_DSN`. It does not
forward the incoming request or SDK envelope.

### Worker failures

Worker failures use `SENTRY_DSN`. Each reported failure creates an independent
Cloudflare Sentry client and scope, and delivery is attached to that request or
scheduled execution with `context.waitUntil`. The Worker does not use
`withSentry`, automatic request capture, or a shared mutable scope because those
features could collect an `Env`, request URL, headers, cookies, or data from a
different request.

The Worker event is also rebuilt from the categorical allowlist. Raw errors and
stacks are intentionally unavailable in Sentry. Local, access-controlled
platform diagnostics remain the place to investigate deeper failures.

React root callbacks cover caught, uncaught and recoverable React errors. An
outer error boundary displays fixed, projection-safe text; it never renders an
exception. Explicit `error` and `unhandledrejection` listeners do not pass the
original error to the SDK. The central API client reports unexpected 5xx,
network, timeout and malformed successful-response failures, retaining existing
error instances and authentication/conflict behavior. A WeakSet prevents these
same API errors being reported again as uncaught/rejected errors.

Expected 4xx responses (including login/session/permission errors, revision
conflicts and rate limits) are not monitoring incidents. They retain their
existing UI behavior. Worker final API 5xx responses (including directly returned
503 configuration/delivery failures and caught exceptions, each reported once), uncaught fetch exceptions,
scheduled maintenance and caught background delivery errors are covered; raw
provider/database error logging at the touched boundaries has been removed.

The local Node backend has no Sentry destination or relay by default. The
shared API accepts an optional typed reporter without importing an SDK into
domain/auth logic. Development monitoring validation uses the synthetic
Playwright harness or a local Worker with an explicit development label and a
dedicated development project, never production bindings.

## Data that may leave Epet

Only these fields are permitted:

| Field | Allowed values |
| --- | --- |
| source | `frontend` or `worker` |
| category | A value in `ERROR_CATEGORIES` |
| route | A value in `ROUTE_GROUPS` |
| method | A value in `HTTP_METHODS` |
| status | Integer 500 through 599, and only for an HTTP category |
| environment | `development`, `staging`, or `production` |
| release | Optional 40-character lowercase Git commit SHA |

Generated Sentry event IDs and timestamps are transport metadata. There is no
Sentry user identity and no tenant, workspace, class, student, member, request,
or session correlation identifier.

The following must never be added to monitoring:

- names, email addresses, identifiers, IP addresses, or browser fingerprints;
- passwords, cookies, authorization values, sessions, CSRF values, Turnstile
  responses, invitation tokens, verification tokens, or reset tokens;
- student state, scores, exams, comments, learning evidence, mentor feedback,
  discipline records, rewards, or boss contributions;
- request or response bodies, headers, raw URLs, query strings, fragments,
  dynamic route parameters, local/session storage, Zustand state, drafts, React
  props, DOM text, screenshots, or attachments;
- original exception messages, stacks, console output, breadcrumbs, SDK
  contexts, logs, replay, tracing, profiling, or session tracking.

Any future field requires a privacy review, an allowlist change at both
sanitization boundaries, and synthetic regression tests.

## Implementation responsibilities

| Files | Responsibility |
| --- | --- |
| `shared/observability/policy.ts` | Typed categorical contract, strict environment/DSN validation, route grouping, fail-silent reporting. No React or platform bindings. |
| `shared/observability/sentry.ts`, `sdkOptions.ts` | Rebuild allowlisted events and wire envelopes; disable automatic data collection and all non-error channels. |
| `src/services/monitoring.ts` | React SDK adapter, global listeners, same-origin transport, bounded delivery and duplicate suppression. |
| `src/main.tsx`, `src/components/ui/ApplicationErrorBoundary.tsx` | React lifecycle reporting and a fixed, presentation-safe recovery UI. |
| `src/services/backendApi.ts` | Observe failures at the existing API seam without changing requests, auth, CSRF, conflict or error contracts. |
| `server/api.ts`, `server/contracts/api.ts`, background delivery boundaries | Optional SDK-independent reporter; observe final 5xx once and report background failures with fixed categories. |
| `worker/monitoring.ts`, `worker/monitoringRelay.ts`, `worker/index.ts` | Independent Worker clients, strict public intake, production API/unhandled/scheduled coverage and `waitUntil` delivery. |
| Wrangler configuration, deployment workflows, staging guards, `.env.example` | Explicit opt-in/environment separation; no real DSNs in build output, source or workflows. |

No business rules, persisted data structures, database schema, existing product
API contracts, or authentication middleware were redesigned. Monitoring remains
an adapter at existing error boundaries, not a dependency of domain services.

## Public relay protections

`POST /api/v1/monitoring` is deliberately unauthenticated so failures on the
login, registration, reset, invitation, and verification screens can be
reported. It is not a product-data mutation and does not relax or alter CSRF,
authentication, authorization, cookie, or tenant-isolation checks on any other
API route.

The relay must remain write-only and enforce all of these controls:

- same-origin `Origin` validation with no permissive CORS response;
- POST only and the expected JSON content type;
- the `MONITORING_BODY_LIMIT` 2,048-byte declared and streamed body limit;
- the `MONITORING_TIMEOUT_MS` 1,500-ms read and outbound delivery deadline;
- bounded per-client and global rate limiting before outbound Sentry work;
- a bounded number of categorical reports per request;
- no cookie parsing, no session lookup, no CSRF token, no auth header, no
  workspace lookup, and no response reflection;
- browser delivery with omitted credentials and `Referrer-Policy: no-referrer`;
- generic success/failure responses that reveal no Sentry configuration.

Rate-limit keys and diagnostics must not retain raw client IPs or other stable
identifiers. Invalid, oversized, cross-origin, timed-out, or rate-limited
payloads are dropped without being logged verbatim.

## Configuration

### Browser build configuration

The browser has no real Sentry project DSN. Its build-time variables are:

| Variable | Meaning |
| --- | --- |
| `VITE_MONITORING_ENABLED` | Only the exact string `true` enables relay calls. Unset, empty, or `false` is the kill switch. |
| `VITE_MONITORING_ENVIRONMENT` | Must be the explicit deployment label. Production and staging workflows set `production` and `staging`; local examples use `development`. |
| `VITE_MONITORING_RELEASE` | Optional Git commit SHA supplied by CI. Invalid values are omitted, never replaced with user input. |

The optional GitHub environment variable `EPET_MONITORING_ENABLED` should be
set to `true` only after the environment-specific Worker secrets and provider
privacy controls have been verified. The production and staging workflows map
it to `VITE_MONITORING_ENABLED` only during their frontend build. Staging never
falls back to a production label.

### Worker configuration

The checked-in Wrangler files set non-secret environment labels:

- production: `MONITORING_ENVIRONMENT=production`;
- staging: `MONITORING_ENVIRONMENT=staging`.

No Node compatibility flags were added. Explicit clients/scopes do not use
`withSentry` or AsyncLocalStorage. The actual bundled Worker is tested in workerd
without Node flags, including successful SDK delivery. Wrangler may warn about
Node imports in unused SDK integrations; these are tree-shaken out of the bundle.
Do not enable broader compatibility flags merely to silence those warnings.
The staging policy rejects unreviewed flags and any production monitoring label.

Configure these only as environment-scoped Worker secrets; never put their
values in source, Wrangler vars, GitHub variables, workflow output, test
fixtures, or frontend build variables:

| Secret | Purpose |
| --- | --- |
| `SENTRY_DSN` | Categorical Worker failures |
| `SENTRY_FRONTEND_DSN` | Categorical reports accepted by the frontend relay |

An absent or invalid DSN disables that channel. The two channels may use
separate Sentry projects and retention policies. `SENTRY_RELEASE` is optional
Worker-only metadata and, when configured, must be a commit SHA. It is not a
substitute for the frontend release build variable and must never contain a
user, tenant, or deployment secret.

The relay intentionally ignores client-supplied environment, release and DSN.
The actual outbound environment/release come from the Worker configuration.
Keep `SENTRY_RELEASE` synchronized with the deployed Git SHA if release
correlation is required; it is otherwise omitted. The frontend build SHA is
discarded by the relay rather than trusting an arbitrary visitor-supplied value.

Only HTTPS Sentry SaaS ingest DSNs with a validated public key/project ID are
accepted (`o<number>.ingest.sentry.io` and regional `us`, `eu`, `de` hosts).
Self-hosted Sentry requires a separately reviewed destination allowlist, not a
wildcard or visitor-supplied target.

No real DSN is included in this repository, and this architecture change does
not deploy, create Sentry projects, upload source maps, or modify production
database schema.

## Privacy kill switch

To stop all monitoring without changing application behavior:

1. unset or remove `SENTRY_DSN` and `SENTRY_FRONTEND_DSN` in the affected Worker
   environment;
2. unset `EPET_MONITORING_ENABLED`, or set it to anything other than the exact
   string `true`, before rebuilding frontend assets.

Either missing Worker DSN disables the corresponding outbound channel. Turning
off the frontend flag additionally prevents the browser from calling the relay.
Invalid environments never fall back to production.

## Sentry project controls

Before enabling either environment:

1. disable IP address retention;
2. enable server-side data scrubbing as defense in depth, including common
   credential, token, email, name, identifier, comment, assessment, and
   education-data keys;
3. keep Replay, Logs, Tracing, Profiling, Session tracking, Feedback, and
   attachment collection disabled;
4. use short, reviewed retention and least-privilege project access;
5. keep staging and production projects or environments visibly distinct;
6. configure alerts from categorical tags only, not event text.

Provider scrubbing is a final safety net. It does not replace the local
allowlist reconstruction performed before the relay, inside the relay, before
the Sentry SDK, and in the final transport.

## Synthetic staging verification

Enable staging first, using only synthetic accounts and synthetic classroom
content. Verify all of the following before production enablement:

1. an unauthenticated synthetic render failure reaches the frontend Sentry
   project through the same-origin relay;
2. a synthetic Worker failure reaches only the Worker project;
3. each event contains only source, categorical failure, broad route group,
   method, optional 5xx status, environment, release, generated event ID, and
   timestamp;
4. no raw URL, stack, message, breadcrumb, SDK metadata, request, header,
   cookie, identifier, storage value, student content, exam content, comment,
   evidence, password, session, or CSRF sentinel appears in event JSON;
5. missing DSNs and a disabled frontend flag produce no outbound delivery;
6. wrong-origin, oversized, malformed, timed-out, and rate-limited relay calls
   are rejected without affecting existing API endpoints;
7. staging events are labelled `staging`, never `production`.

Do not use real student or staff data for monitoring validation.

## Known trade-offs and follow-up

- Remote events deliberately have no original stack. Release plus categorical
  route/failure information can identify regressions, but detailed debugging
  relies on local reproduction and tightly controlled platform diagnostics.
- Source maps remain disabled and are not uploaded. If source maps are proposed
  later, they require a separate privacy/build-artifact review and must never be
  publicly deployed under `dist/assets`.
- The public relay needs ongoing abuse/rate-limit monitoring using aggregate
  counts only. Do not add per-user or per-tenant correlation to improve this.
- Limits are isolate-local: 20 reports per client/minute and 200 total/minute,
  with minute-cleared, in-memory salted IP hashes and bounded storage. They are not a
  globally distributed quota. Configure Cloudflare edge rate limits/WAF and
  Sentry quotas for cost protection before a high-traffic production rollout.
- Browser delivery is bounded to 20/minute with at most 16 in-flight requests,
  a 1.5s deadline and 60s backoff after network/429/5xx failures. No offline
  queue, retry persistence, storage or unload beacon is used; some errors may
  be lost during navigation, outages or rate limiting.
- The Sentry runtime is bundled with the frontend; the current entry chunk
  exceeds Vite's 500kB warning threshold. Lazy-loading the SDK is a follow-up
  performance trade-off because it would delay startup error capture.
- Dependency audit reports outstanding high advisories in the existing
  Wrangler/Miniflare development toolchain (including sharp/undici), not the
  added Sentry SDKs. Resolve them in a separate tested toolchain update; do not
  use `npm audit fix --force` or upgrade to an alpha only to clear this check.
- Any future SDK upgrade must rerun envelope-shape and allowlist tests. The final
  transport must continue rebuilding, rather than forwarding, SDK envelopes.

## Automated verification (2026-10-06)

Baseline before implementation: `npm run test:server` (30/30) and
`npm run test:auth` (11/11).

Post-change verification:

- `npm run lint`: passed.
- `npm test`: 282 passed, including all 94 existing game-rule cases, all auth,
  server, migration, staging, D1, UI-model tests and 28 observability cases.
- `npm run test:e2e`: 37/37 passed, including three new privacy/monitoring cases.
- `npm run test:a11y`: 14/14 passed; latest reports for 35 unique scanned states
  contain no axe violations. No rules were disabled.
- `npm run build`, `npm run check:worker`, `npm run check:worker:staging`: passed.
- `git diff --check`: passed.
- `npm audit --omit=dev --json`: not clean; four high toolchain advisories
  remain in Wrangler, Miniflare, sharp and undici, as described above.

The 28 new cases cover strict reconstruction with synthetic sensitive canaries,
SDK wire envelopes, dropped non-error channels, cross-environment/project
isolation, disabled monitoring, preserved auth/CSRF/conflict/error contracts,
direct 503 and caught 500 single reporting, fail-silent reporters, relay
origin/body/deadline/quota enforcement, transport backoff and rejected redirects.
Two of them bundle the actual Worker and execute it in workerd without Node
compatibility flags, intercepting outbound requests locally rather than sending
anything to Sentry. The three browser cases exercise uncaught/rejected failures,
API 5xx versus expected authentication failures, and the React error fallback.

No real Sentry project, live staging/production DSN, provider privacy settings,
or remote deployment was activated or verified by these tests. Those are
explicit operator prerequisites, not assumptions based on synthetic delivery.

## Implementation references

SDK behavior was checked against the pinned installed 11.4.0 implementation,
including [CloudflareClient](https://github.com/getsentry/sentry-javascript/blob/11.4.0/packages/cloudflare/src/client.ts)
and [data collection controls](https://github.com/getsentry/sentry-javascript/blob/11.4.0/packages/core/src/types/datacollection.ts).
Transport behavior is verified in workerd; Workers uses manual redirects (never
follows provider redirects), while the browser transport uses redirect errors.
