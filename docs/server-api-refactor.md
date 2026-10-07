# Server API architecture

## Why this refactor was needed

`server/api.ts` previously combined transport concerns, security gates, runtime
configuration, every route handler, validation, audit filtering, and domain
orchestration in one file. That made otherwise local changes risky because the
ordering of Origin, session, CSRF, workspace, and role checks was implicit in a
long conditional chain.

The refactor keeps `server/api.ts` as the backward-compatible composition root
and moves each responsibility behind a small, one-way dependency boundary. No
API URL, response contract, cookie setting, persisted structure, or database
schema was changed.

## Dependency direction

```text
contracts
  -> HTTP helpers and middleware
  -> runtime services and route contexts
  -> feature route handlers
  -> server/api.ts composition root
```

Lower layers do not import route modules. Route modules do not import the API
composition root, React, or Zustand.

## Responsibilities

### `server/api.ts`

- Creates the API runtime.
- Preserves the security pipeline and dispatch order.
- Builds authenticated and workspace-scoped route contexts.
- Dispatches feature handlers and returns the protected 404 fallback.
- Re-exports `ApiOptions` and `BotChallengeVerification` for existing callers.

### `server/contracts/api.ts`

- Defines API configuration and repository composition contracts.
- Keeps server bootstrap and Worker callers independent from handler details.

### `server/http/`

- `response.ts`: JSON responses and the default `Cache-Control: no-store` rule.
- `body.ts`: bounded JSON parsing and primitive request-body accessors.
- `request.ts`: request ID and workspace ID validation.

### `server/middleware/`

- `origin.ts`: same-origin/allowlist CORS behavior and safe-method definition.
- `authentication.ts`: session parsing and exact auth cookie serialization.
- `csrf.ts`: double-submit CSRF validation with constant-time comparison.
- `rateLimit.ts`: repository-backed subject and client rate-limit policies.
- `authorization.ts`: workspace role and class-assignment access controls.
- `errorResponse.ts`: the existing error-to-status/body contract in one mapper.

### `server/services/`

- `apiRuntime.ts`: immutable handler configuration, `AuthService`, mail delivery
  scheduling, bot verification, and authenticated response construction.
- `workspaceValidation.ts`: pure aggregate/revision validators.
- `auditQuery.ts`: audit query parsing and sensitive metadata filtering.
- `botProtection.ts`: typed bot protection failures used by the error mapper.

### `server/routes/`

- `systemRoutes.ts`: health/capability endpoint.
- `authRoutes.ts`: registration, login, session, logout, verification, password,
  invitation acceptance, and account deletion.
- `workspaceRoutes.ts`: workspace creation/deletion and aggregate state access.
- `adminRoutes.ts`: members, invitations, revisions, audit, and workspace export.
- `studentRoutes.ts`: student privacy export.
- `analyticsRoutes.ts`: class and student learning analytics.
- `learningRoutes.ts`: learning evidence creation.
- `bossRoutes.ts`: boss reward resolution.

There are no new class or exam endpoints. Those records remain part of the
existing `/api/v1/state` aggregate so the API and persisted-data contracts stay
unchanged.

## Security ordering retained

The composition root deliberately preserves this sequence:

1. Origin allowlist and CORS evaluation.
2. Preflight handling and required Origin on unsafe methods.
3. Public health and special auth routes.
4. Session cookie syntax validation.
5. CSRF validation for unsafe protected requests.
6. Account/workspace-creation routes that do not require a workspace header.
7. Workspace ID validation and server-side membership authorization.
8. Route-specific role and class-scope checks.
9. Protected `404 NOT_FOUND` fallback.

This ordering is contract-tested because changing it can alter both security
posture and observable HTTP status semantics.

## Remaining technical debt

- `AuthService` still contains a broad set of account, invitation, membership,
  and workspace-lifecycle operations. Splitting that service should be a
  separate change with service-level contract tests.
- The persisted workspace is intentionally still an aggregate. Class and exam
  route separation would require an API/data redesign and is outside this
  architecture-only refactor.
- Route matching remains explicit method/path checks. A declarative router may
  be considered later, but only with equivalent precedence and security-gate
  tests.
- The boss resolution endpoint has no class ID in its existing contract; it
  retains the current teacher-role plus non-empty class-assignment check rather
  than introducing a breaking authorization contract in this refactor.
