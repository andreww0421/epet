# Server / Worker boundary

## Purpose

ePet has two backend entry points:

- the Node server used for local development and filesystem-backed operation;
- the Cloudflare Worker used in production with D1 and Cloudflare bindings.

This refactor makes code shared only when the behavior is genuinely identical.
It does not introduce a generic repository, change an API URL or response body,
alter cookies, weaken CSRF or RBAC checks, or change the persisted schema.

## Audit findings

The initial concern was duplicated backend business and security logic. The
audit found that most request-level behavior was already executed through one
implementation: both runtimes call `createApiHandler` from `server/api.ts`.
That shared handler owns route dispatch, authentication, CSRF, workspace
authorization, class scope, rate limiting, validation, response contracts, and
business-service orchestration.

The more important problem was ownership and drift at the runtime boundary:

- Node imported Turnstile and account-email services from `worker/`, even
  though those services only require Web APIs and are not Worker-specific.
- the Turnstile module declared a second, looser bot-challenge contract;
- student privacy cleanup was pure domain logic but lived under `server/` and
  was imported by the D1 adapter;
- workspace ID rules, token helpers, response security headers, and several
  repository constants/calculations had more than one implementation;
- both repository adapters implement the same persistence contracts, but their
  write mechanics and edge-case behavior are materially different.

The result is a shared kernel for exact common behavior, with the two storage
and transport adapters remaining explicit.

## Architecture

```text
                         shared/
          contracts  domain  security  services
                ^       ^       ^        ^
                |       |       |        |
       +--------+-------+-------+--------+--------+
       |                                         |
server/ (Node adapter)                    worker/ (Cloudflare adapter)
  HTTP bridge and static files              fetch/scheduled entry point
  filesystem JSON repository                D1 repository and projections
       |                                         |
       +------------ createApiHandler ------------+
                 routes / middleware / auth
```

The dependency direction is inward: platform adapters may depend on shared
code, while `shared/` does not import the Node filesystem adapter, D1, Worker
bindings, React, or Zustand.

### Shared contracts

- `shared/contracts/workspace.ts` is the canonical workspace-role contract.
- `shared/contracts/authDelivery.ts` defines password-reset, verification,
  invitation, and account-lifecycle delivery payloads.
- `shared/contracts/botChallenge.ts` defines the allowed challenge actions and
  prevents the verifier from accepting an arbitrary action string.
- `server/contracts.ts` and `server/contracts/api.ts` retain compatibility
  exports so existing callers do not require a broad import migration.

API URLs, HTTP status meanings, JSON bodies, cookie serialization, and the
production database schema remain unchanged.

### Shared domain policy

- `shared/domain/workspaceIdentifiers.ts` owns local and cloud workspace ID
  patterns and selects the right policy explicitly.
- `shared/domain/repositoryPolicy.ts` owns exact cross-adapter invariants: the
  retained revision count, auth-rate-limit retention period, empty-workspace
  shape, UTF-8 size calculation, and audit-query limit clamping.
- `shared/domain/studentPrivacy.ts` owns pure student-data purge behavior used
  by both persistence adapters.

These modules contain deterministic data rules only. They do not know whether
the result is persisted to a JSON file or D1.

### Shared security and cross-runtime services

- `shared/security/tokens.ts` contains Web Crypto token encoding, hashing, and
  constant-time byte comparison.
- `shared/security/responsePolicy.ts` supplies common security headers with
  explicit platform options instead of silently forcing production-only HTTP
  policy onto local development.
- `shared/services/turnstile.ts` is the canonical fetch-based Turnstile
  verifier.
- `shared/services/accountEmail.ts` is the canonical fetch-based Resend mail
  delivery implementation.

The former `worker/turnstile.ts` and `worker/passwordResetEmail.ts` entry points
remain as compatibility re-exports. New code should import the shared service
paths.

### Shared application pipeline

`server/api.ts` remains the runtime-neutral API composition root despite its
historical directory name. Both Node and Worker use the same routes,
middleware, `AuthService`, validation, authorization, normalization, audit
filtering, and error-to-response mapping.

The security gate order remains:

1. origin allowlist and CORS evaluation;
2. preflight handling and Origin enforcement on unsafe requests;
3. explicitly public system and authentication routes;
4. session parsing;
5. CSRF validation on unsafe protected requests;
6. workspace ID validation and server-side membership authorization;
7. route-specific role and class-scope authorization;
8. protected not-found response.

This pipeline is shared rather than reimplemented in `worker/index.ts`.

## Deliberately platform-specific code

### Node

- `server/app.ts` adapts Node HTTP streams to Fetch `Request`/`Response`,
  serves local build artifacts, and protects static-file path resolution.
- `server/repository.ts` owns JSON-file loading, migrations, serialized local
  mutations, and atomic file replacement.
- the Node transport removes untrusted forwarding headers and supplies a
  server-controlled client identity derived from the socket.
- local development explicitly permits short local workspace IDs.
- HSTS and `upgrade-insecure-requests` are not forced onto the local HTTP
  server, because that would make the development transport unusable rather
  than improve production security.

### Cloudflare Worker

- `worker/index.ts` owns Cloudflare bindings, Assets routing, request context,
  `waitUntil`, and scheduled cleanup/reconciliation.
- `worker/repository.ts` owns D1 SQL, transaction/constraint behavior,
  projection maintenance, and the D1-specific aggregate-size guard.
- `worker/projectionStatements.ts` remains D1-specific.
- production workspace IDs use the stricter cloud format.
- Worker responses keep production-only HSTS, stricter permissions policy, and
  document CSP upgrade behavior.

## Why repositories were not unified

The two repositories share interfaces and pure policies, not an inheritance
hierarchy or a generic CRUD base. Their mechanics are observably different:

- Node serializes local writes; D1 relies on SQL transactions and constraints.
- the D1 adapter applies a platform-specific payload limit and maintains read
  projections.
- optimistic-write behavior is not identical when no base revision is given.
- invitation conflict handling and idempotency rely on different primitives.
- audit metadata round-tripping and equal-timestamp ordering have small
  adapter-specific differences.
- local JSON migration and D1 schema migration have different failure modes.

Abstracting these details behind shared mutation algorithms would either hide
important concurrency semantics or change behavior. The safer boundary is a
shared repository contract plus small pure policies, with separate adapters.

## Security and data-protection preservation

- Authentication, session validation, cookie behavior, CSRF checks, RBAC,
  class scoping, and tenant isolation stay in the shared server-side pipeline.
- Neither runtime delegates authorization to the frontend.
- Repository-backed rate limiting remains active in both adapters; only its
  exact retention constant and calculation are centralized.
- Turnstile fails closed on transport, timeout, hostname, or action mismatch.
- email and token services use opaque-token hashes for idempotency and do not
  add student PII to logs or client storage.
- response-security differences are explicit policy inputs rather than copies
  that can silently drift.
- no production table, migration, or persisted aggregate shape changes as part
  of this boundary refactor.

## Validation strategy

The boundary is protected at three levels:

1. Unit/architecture tests cover workspace-ID selection, repository policy,
   response-header profiles, canonical contracts, and compatibility exports.
2. Existing server and authentication tests protect URL, status, response,
   cookie, Origin, CSRF, rate-limit, RBAC, and tenant-isolation behavior.
3. D1 tests and Worker type/bundle checks protect D1 adapter behavior and the
   production runtime boundary.

The complete release gate is:

```text
npm run lint
npm test
npm run build
npm run check:worker
```

Browser E2E tests remain the regression gate for user-visible flows when this
change is integrated with frontend work.

For this refactor, the release gate completed successfully: TypeScript lint,
the complete unit/server/D1 suite, the 20-test browser E2E suite, the Vite
production build, and Wrangler's Worker dry-run bundle check all passed.
Wrangler reported that its sandboxed debug log file was not writable, but
still completed the dry-run with exit code 0 and produced the binding/bundle
summary.

## Remaining technical debt

- `server/api.ts`, route modules, middleware, `AuthService`, and much of the
  repository contract are runtime-neutral but retain the historical `server/`
  path. Moving them wholesale would create import churn without changing
  behavior; it should be done only with a staged compatibility plan.
- `AuthService` still spans account, session, invitation, membership, and
  workspace-lifecycle behavior. A later split needs service-level contract and
  concurrency tests, not just file movement.
- `normalizeAppData` is already reused by both runtime paths but remains under
  the frontend store utilities. Its migration is high risk because it defines
  persisted-data normalization and should be handled as a dedicated data
  compatibility change.
- `shared/domain/studentPrivacy.ts` still type-imports the canonical `AppData`
  shape from `src/store/types.ts`. This is erased at runtime and does not create
  a platform dependency, but moving persisted domain types out of the frontend
  tree should be a separate, compatibility-tested step.
- student privacy cleanup intentionally preserves the existing bare
  `studentId` matching behavior across classes. If student IDs are not globally
  unique, a future migration to composite workspace/class/student identity will
  require persisted-data and privacy-export tests; changing that rule here
  would have been an unsafe behavior change.
- Repository parity should be described as contract compatibility, not byte-for-
  byte implementation identity. The adapter-specific edge cases listed above
  need focused parity tests before any further unification.
- Worker binding types should continue to be kept in sync with Wrangler's
  generated types and the configured compatibility date; runtime secrets and
  platform bindings must not leak into shared business modules.
- Static response policy still has valid platform differences. Any future
  tightening must be tested independently for local HTTP and production HTTPS
  rather than collapsed into one unconditional header set.
