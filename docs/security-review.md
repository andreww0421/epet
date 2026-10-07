# Epet authentication defensive security review

Review date: 2026-09-30  
Scope: Node local backend, Cloudflare Worker production backend, shared authentication services, persistence repositories, browser authentication client, and production configuration.

## Executive summary

No Critical or High authentication vulnerability was confirmed. The review found one Medium hardening gap and two Low, conditionally reachable issues:

| ID | Severity | Finding | Current exposure |
| --- | --- | --- | --- |
| AUTH-01 | Medium | Password credentials default to PBKDF2-HMAC-SHA256 with 100,000 iterations | Requires disclosure of the password-verifier store and a guessable password |
| AUTH-02 | Low | Legacy query-string reset/invitation tokens can reach URL logs before client cleanup | Current first-party emails use URL fragments; only legacy/manual query links are affected |
| AUTH-03 | Low | Public registration can reveal whether an email already exists | Production registration is currently disabled and the route is rate limited |

Because no High or Critical issue was validated, this change does not alter authentication behavior, API contracts, cookie semantics, production schema, or production feature flags. The Medium item requires a production Worker CPU benchmark and a compatible credential-migration plan; changing the work factor without that evidence could make authentication unavailable. The Low items require an explicit compatibility/API migration and are recorded below.

The review followed the project security policy and the OWASP guidance for [authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [forgot-password flows](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), and [IDOR prevention](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html). Cloudflare's official documentation confirms Workers Web Crypto support for PBKDF2, but does not document the repository comment's exact 100,000-iteration ceiling; benchmark against the deployed plan's [CPU limits](https://developers.cloudflare.com/workers/platform/limits/) before changing the policy.

## Threat model and boundaries

Protected assets include password verifiers, session and account-lifecycle tokens, workspace membership and roles, class-scoped student data, and production mail/bot-protection bindings.

The reviewed trust boundaries are:

- Browser to same-origin Node or Worker API.
- Public authentication routes to `AuthService`.
- Session cookie to dynamic workspace authorization.
- Business services to the Node JSON or D1 repository.
- Lifecycle email provider to the recipient's browser.

The attacker model includes an unauthenticated internet client, a legitimate low-privilege workspace member, a caller who tampers with workspace/class/student identifiers, and an attacker who obtains a password-verifier snapshot. It does not assume control of production secrets or Cloudflare bindings.

## Control review

| Area | Result | Evidence and conclusion |
| --- | --- | --- |
| Password hashing | Medium finding | `server/auth.ts` uses PBKDF2-HMAC-SHA256, a random 16-byte salt, a 256-bit result, a 12–128 character password policy, and per-account iteration metadata. The 100,000-round default is below current OWASP PBKDF2-SHA256 guidance. |
| Session generation | Pass | Session tokens use 32 random bytes from Web Crypto and a URL-safe encoding. |
| Session hashing | Pass | Only the SHA-256 hash is persisted and looked up; raw session tokens are returned to the client solely for cookie issuance. |
| Cookie configuration | Pass | The production session cookie is `__Host-epet_session` with `Path=/`, `Secure`, `HttpOnly`, and `SameSite=Lax`. The CSRF cookie is `__Host-epet_csrf`, `Secure`, and `SameSite=Lax`; it is intentionally readable for double-submit validation. |
| Session expiration | Pass | Sessions have a seven-day absolute expiry and fail closed when `expiresAt <= now`. Expired records are marked revoked when encountered. No sliding/idle timeout is implemented; this is a policy choice, not an authorization bypass. |
| Session revocation | Pass | Logout revokes the current session. Password reset atomically consumes the reset token, updates the credential, and revokes all user sessions in both repositories. Workspace authorization re-reads membership, so member removal or role reduction affects already-issued sessions immediately. |
| CSRF | Pass | Authenticated unsafe methods require a constant-time double-submit cookie/header token. Session cookies are not exposed to JavaScript. |
| Origin validation | Pass | Unsafe methods require an `Origin` header and exact same-origin or explicit allowlist matching. Missing or unapproved origins fail closed; RBAC remains server-side. |
| Login brute force | Pass with operational note | Login uses a persistent subject limit of 10/15 minutes and a global client limit of 30/15 minutes. Node derives the client address from the socket after stripping spoofable forwarding headers; Worker uses Cloudflare's `cf-connecting-ip`. |
| Password reset | Pass | Reset tokens use CSPRNG output, are hashed at rest, expire after 30 minutes, are single-use, and revoke all sessions. Forgot-password always returns `202 { accepted: true }`, uses a response floor, and does not expose delivery failures. |
| Email verification | Pass | Verification tokens are random, hashed, expire after 24 hours, and are consumed once. Production Worker configuration requires verification. Registration fails closed if verification is required but mail delivery is unavailable. |
| Account enumeration | Low finding | Login uses one generic error and performs a dummy PBKDF2 derivation for unknown/malformed accounts. Forgot-password has generic status/body and timing floor. Registration retains a distinct duplicate-email response, but production registration is disabled. |
| Invitation tokens | Pass with Low URL compatibility finding | Invitation tokens are random, hashed, expire after seven days, are revocable and single-use, and carry a server-stored role/class scope. Current emails place tokens in URL fragments. The UI still accepts legacy top-level query tokens. |
| Token expiration | Pass | Session, reset, verification, and invitation expiry comparisons all reject at the expiry boundary. Repository cleanup removes expired/revoked records without changing authorization semantics. |
| Timing attacks | Pass | Secret comparisons are constant-time. Unknown-account login performs the same one PBKDF2 derivation as a wrong password, and forgot-password uses a minimum response time. Network scheduling still prevents a claim of perfectly identical wall-clock latency. |
| Rate limiting | Pass | Authentication limits are stored in the repository, survive process reloads, combine subject and global-client budgets, and store hashed rate-limit keys rather than raw email/IP discriminators. |
| Workspace authorization | Pass | Every workspace route resolves the current session and current membership before dispatch. Email verification and minimum role are checked server-side. |
| Privilege escalation | Pass | Non-owner admins cannot grant or modify admin access, cannot transfer ownership, and cannot remove owners. Destructive owner operations require current-password verification and explicit confirmation. |
| IDOR / tenant isolation | Pass | Workspace IDs are authorized before route access; class-scoped roles fail closed without assignments; student/learning/analytics lookups remain inside the authorized workspace and class; D1 queries and constraints include tenant keys. |

## Critical

No confirmed Critical findings.

## High

No confirmed High findings.

## Medium

### AUTH-01 — PBKDF2 work factor is below the current recommended baseline

Status: Open; compensating controls present.

`DEFAULT_PASSWORD_ITERATIONS` is 100,000. Credentials use a unique random salt and persist the algorithm and iteration count, so precomputed attacks are resisted and a staged migration is possible. Online login and recovery are also rate limited. Those controls do not protect password verifiers after a database disclosure, where an attacker can test guesses offline.

The repository comment says Cloudflare Workers rejects iteration counts above 100,000. The reviewed official Cloudflare documentation confirms PBKDF2 support but not that exact ceiling, so the safe remediation is evidence-driven:

1. Benchmark representative login, registration, invitation acceptance, and password reset requests on the production Worker plan.
2. Select the strongest supported policy within the CPU/error budget, preferring a memory-hard algorithm if the production runtime and persistence format can support it safely.
3. Preserve per-account parameters and add rehash-on-success for older credentials.
4. Add Worker integration and migration regression tests before raising the production default.

This was not changed in this review because an unbenchmarked work-factor increase can cause authentication denial of service, and a format change needs a backward-compatible migration.

## Low

### AUTH-02 — Legacy query-string lifecycle tokens may be retained outside the browser

Status: Open; current first-party links are protected.

`src/components/AuthScreen.tsx` accepts reset/invitation tokens from both the fragment and `window.location.search`. A query parameter is sent with the initial document request before React can call `history.replaceState`, so a legacy/manual link may be retained by an origin/CDN access log or URL telemetry. Current reset, invitation, and verification email generators use fragment URLs, and the tokens remain hashed, expiring, and single-use.

Recommended follow-up:

- Confirm whether any deployed legacy sender or external integration still creates `?token=` or `?resetToken=` links.
- If not, remove query-token compatibility and test fragment-only routing.
- Until then, redact those parameter names in CDN, origin, error-reporting, and analytics pipelines.

### AUTH-03 — Registration has a conditional account-existence oracle

Status: Open but unreachable under the checked production configuration.

With registration enabled, an existing normalized email produces HTTP 409 with `EMAIL_ALREADY_EXISTS`, while a new email follows the registration path. This supports low-volume account enumeration. Production currently has `REGISTRATION_ENABLED=false`, and registration has both subject and global-client limits.

Before enabling public registration, coordinate an explicit response-contract migration so duplicate and new-email submissions are externally indistinguishable while internal audit events and rate limits remain intact. Turnstile and lifecycle email delivery should also be enabled and verified before the registration flag changes.

## Rejected candidates and configuration notes

- `BOT_PROTECTION_REQUIRED=false` is not treated as a standalone vulnerability in the current deployment: public registration is disabled and login/recovery retain persistent dual-layer limits. It is still an operational prerequisite before enabling public registration.
- The Node entry point defaults email verification and bot protection to disabled unless explicitly configured, while the Worker production configuration requires email verification. Node is the local-development backend in the reviewed architecture. If it is ever exposed as a production deployment target, fail-closed production environment validation must be added first.
- No session raw token, password, reset token, verification token, invitation token, or student PII was found in application logging. Lifecycle delivery failures use generic errors; rate-limit storage uses hashed discriminators.
- Multi-factor authentication and a separate idle-session timeout are product-policy enhancements, not confirmed bypasses in this review, and were not introduced as part of this defensive change.

## Security regression tests added

`tests/auth.test.ts` now verifies:

- An expired session fails exactly at the expiry boundary and is persistently marked revoked.
- Unknown-account and wrong-password login paths each execute one PBKDF2 derivation and return the same credential error class.
- Invitation bearer tokens are not persisted raw and cannot be replayed.
- Removing a workspace member immediately denies that member's already-issued session on the next authorization check.

These tests exercise the shared `AuthService` and Node repository contract used by both platform adapters without changing API or database contracts.

## Verification performed

Before implementation:

- `npm run test:auth` — 8/8 passed.
- `npm run test:server` — 30/30 passed.

After implementation:

- `npm run test:auth` — 11/11 passed.
- `npm run lint` — passed.
- `npm test` — 184/184 passed.
- `npm run build` — passed.
- `npm run check:worker` — Worker dry-run passed.
- `npm run test:e2e` — 20/20 passed.

## Remaining risks and next review triggers

- Benchmark and plan AUTH-01 before changing the password policy.
- Resolve AUTH-02 only after confirming legacy-link usage, to avoid silently breaking valid outstanding links.
- Resolve AUTH-03 before enabling public registration.
- Verify live Cloudflare vars/secrets, CDN log redaction, Resend configuration, and deployed security headers during the next production readiness review; repository review cannot attest to dashboard state.
- Repeat authorization tests whenever workspace roles, class assignment storage, or route registration changes.

## Review limitations

- The review did not inspect live production traffic, Cloudflare dashboard bindings/secrets, email-provider logs, or a production database snapshot.
- Independent baseline and architecture subreviews were attempted but could not run because the account hit its subagent usage limit. The primary reviewer completed the source, persistence, route, and test analysis sequentially; this reduces independent-review diversity, not the listed code coverage.
