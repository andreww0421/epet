# Epet authentication defensive security review

Review date: 2026-09-30  
Hardening follow-up: 2026-10-29 (see dated addendum below).
Scope: Node local backend, Cloudflare Worker production backend, shared authentication services, persistence repositories, browser authentication client, and production configuration.

## Executive summary

The 2026-09-30 baseline confirmed no Critical or High vulnerability and found the items below. The 2026-10-29 follow-up additionally confirmed AUTH-04, a credential-reset/session-issuance race; its local remediation and verification are recorded in the dated addendum. The original test results below remain historical.

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

## 2026-10-29 會員與登入安全強化

本節是目前工作樹的增量驗收；前文 2026-09-30 的結果為歷史基線。本次不讀取正式會員／學生資料，不修改 Production Secrets、Worker、D1、公開註冊或 Turnstile flags。

### AUTH-04 — 密碼重設後，舊憑證的並行登入／邀請仍可能建立授權

Severity：**High**。狀態：**Closed（本機修復及驗證，2026-10-29）；尚未部署。** 正式營運切換維持 Partially Completed，不以本機測試代替外部驗收。

**Root cause / affected scope：** `server/auth.ts` 的 login 先讀取 user 並驗證其 password snapshot，再經 `issueSession` 寫入 Session。舊 Node `createAuthSession` 只檢查 user 存在，舊 D1 直接 INSERT；reset 雖原子更新密碼並撤銷當時所有 Session，卻無法撤銷尚未插入的 Session。因此持有舊密碼的並行請求可能在 reset 完成後重新登入。既有會員接受邀請同樣先驗舊憑證、後寫 Membership；D1 邀請成功判斷還允許同毫秒／同會員的並行請求誤認同一個成功結果。這不是已證明的正式入侵；前提是舊密碼及可達的競態視窗，既有限流仍存在。

**修補與不變量：**

| 檔案 | 本次用途 |
| --- | --- |
| `server/auth.ts` | register／login／invitation 的 Session 發行都傳入已驗證的 user credential snapshot；原子寫入拒絕時沿用 `401 INVALID_CREDENTIALS`。預設 PBKDF2 不變。 |
| `server/contracts.ts` | `createAuthSession(session, expectedPassword): Promise<boolean>` 要求每個 adapter 在同一個原子操作比對憑證。這是內部 TypeScript contract，不是公開 API／儲存格式變更。 |
| `server/repository.ts` | 在既有 JSON mutation queue／copy-on-write 原子持久化內比對 active user 的 algorithm、salt、hash、iterations；既有會員邀請也在任何副作用前驗證 snapshot。 |
| `worker/repository.ts` | Session 使用單一條件 INSERT SELECT；邀請的 user 驗證、token 消耗、唯一 attempt audit、Membership／Class assignment 在同一個 D1 batch 中串接。拒絕不新增這些資料；重放不再借用前次同毫秒結果。 |
| `tests/authConcurrency.test.ts` | Node＋實際本機 D1 的競態、完整憑證欄位、disabled／missing user、持久化、限流與合法限班 Teacher 控制。 |
| `tests/authProtection.test.ts`、`tests/auth.test.ts` | Turnstile provider／timeout／缺設定／token 上限，以及舊 iteration／新 policy 相容性；修正原 Node 測試名稱，避免宣稱它證明 hosted Worker 上限。 |
| `package.json` | 新安全測試納入 `test:auth`，由既有 `npm test`／`verify` 執行。沒有新增 dependency 或改動 lockfile。 |
| 本文件、`p1-account-security-cutover.md`、`commercial-readiness-audit.md` | 紀錄證據、殘餘風險及人工切換／回復計畫。 |

若 Session 先插入，reset 仍撤銷它；若 reset 先完成，舊 snapshot 的插入失敗。比較完整 credential，不能只比 `passwordChangedAt`，因為同毫秒、甚至重設成同一密碼，salt／hash 仍必須使舊授權失效。已在 reset 之前合法提交的邀請不會被回滾；其後發行 Session 仍必須通過新的原子條件。已授權且執行中的一般請求不宣稱可被即時撤回。

### 已實際檢查的既有防護

- Login 保留 generic error／未知帳號 dummy PBKDF2。Forgot 保留非同步寄信、response floor、`202 {accepted:true}` 與 hashed identifiers；reset／email verification 保留期限、輪替與單次消耗，reset 仍撤銷所有 Session。
- Session 保留 `__Host-`、`Secure`、`HttpOnly`、`Path=/`、`SameSite=Lax`；CSRF 保留雙提交及固定時間比對，unsafe methods 保留 Origin gate。沒有新增 CORS wildcard、Bearer bypass 或降低 body limits。
- Workspace membership、角色、Email 驗證及 class assignments 仍由伺服器讀取；原有租戶／限班／viewer write 禁止規則保留。新測試驗證合法 Teacher 的 state 只含 Class A，E2E 另驗角色、CSRF／Origin、資料及班級操作。
- Rate limiting 不改政策：login subject 10／15m、client 30／15m，其他 auth scopes 保留既有值。並行測試使用不同合成 client identity 及同 Email 大小寫／空白變體，仍只有十次 credential 驗證機會，下一次 429 且有 Retry-After；重建 repository／handler 後仍封鎖。
- Turnstile 已具備 secret-only Siteverify、嚴格 `success===true`／action／hostname、五秒 abort、2,048 字元 token 上限與 required 設定缺漏 fail-closed。本次補測，不重做驗證器或強制切換正式 flags。Cloudflare 的真 token 到期／重放與真金鑰仍需獨立環境驗收。

### PBKDF2 評估與相容性

維持 100,000 iterations、隨機 16-byte salt、256-bit result 及每會員 metadata；沒有 rehash、會員 Migration 或強制改密碼。測試先以 1,000 建立 synthetic credential，再把服務 policy 設為 2,000：舊登入依 persisted 1,000 驗證，新註冊／reset 依 2,000 建立，原 Session 被正確撤銷。這些較低值僅是測試參數。

本機 Miniflare `4.20260722.1`、compatibility date `2026-07-29` 的實際 workerd 能驗 Node 產生的舊 1,000 與目前 100,000 credential，並拒絕錯誤密碼；一次 100,001 支援 probe 在本機可執行。100,000 的五次 host dispatch wall 為 95.491／54.904／49.854／50.195／49.906 ms，中位數 50.195 ms。這包含 IPC／本機開銷，**不是 Worker CPU、正式延遲或 hosted iteration ceiling 的證據**。

[OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) 建議的 PBKDF2-SHA256 成本高於目前值；[Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) 支援 PBKDF2，但 local／hosted 限制可能不同（[workerd 維護者討論](https://github.com/cloudflare/workerd/issues/1346)）。未取得 live plan／CPU metrics，不提高次數。Hosted timers 有 [I/O 推進限制](https://developers.cloudflare.com/workers/runtime-apis/performance/)，應依平台 invocation CPU／wall metrics 做有界負載驗收，再另提兼容 rehash-on-success CAS 或新算法計畫。**AUTH-01 保持 Open。**

### 驗證紀錄與正式環境界線

- 最終合成 regression 對修補前 snapshot：**13 cases，4 pass／9 expected fail**；同一套對候選修補 **13/13 pass、0 fail/skip**，包含真 Miniflare D1。
- `node --import tsx --test tests/auth.test.ts tests/d1-core.test.ts tests/ownershipConcurrency.test.ts`：**60/60 pass、0 fail/skip**。
- `npm run test:auth`（由 verify 實際呼叫）：**30/30 pass、0 fail/skip**，包含 13 concurrency、5 protection、12 auth cases。
- `npm run test:e2e -- tests/e2e/authentication.spec.ts tests/e2e/permissions.spec.ts tests/e2e/data-safety.spec.ts tests/e2e/class-and-teacher.spec.ts`：**15/15 pass**；只連隔離本機伺服器。
- 完整 `npm run verify`：**通過，exit 0；678/678（94 legacy rules＋584 Node cases），0 fail/skip**，包含 TypeScript、API／D1／安全回歸、production build／analytics boundary、migration checksum 與 Worker dry-run。既有 Sentry optional Node built-in warnings 保留。一次 fresh 獨立 read-only candidate review 未找到具體繞過／相容性回歸；reviewer 的 D1 sandbox 受限，由主要執行的真 D1 測試補足，未宣稱 reviewer 獨立跑完 D1。
- 初次 sandbox 執行受暫存權限／loopback 限制，長暫存路徑另出現 SQLite CANTOPEN；原碼不變，經核准以預設系統 TEMP 重跑。首版邀請測試的兩個預期值誤以為 reset 不會驗證 Email，已改為比對 reset 後的完整 user snapshot，強化「沒有額外帳號副作用」；未刪除測試或降低保護。

**正式切換／Migration：** 本修補不需 schema migration、新 Secrets 或 Cloudflare flags；內部 adapter 須隨 server 一起更新。尚未 push／merge／deploy；先依 [安全切換 runbook](p1-account-security-cutover.md) 與 Staging 合成帳號驗收，經 Review／Production approval 再發布。回復只處理相容應用版本、保留 D1／ledger 及所有已重設密碼；回到舊程式會重開 AUTH-04，需事故核准與立即補修。

**剩餘事項：** AUTH-01 CPU／credential 升級、AUTH-02 舊 query-token URL／外部 log redaction、AUTH-03 註冊 enumeration contract 仍 Open。正式 Turnstile key／hostname、實收信與 provider／Environment policies 未驗證；health flags 只證明配置能力，不能取代真驗收。Staging 尚未建立，不用正式會員或學生資料替代。維持公開註冊關閉；MFA／idle session policy 仍屬後續產品決策。Node JSON 的同步保證以既有單一 repository instance／本機開發用途為前提，不把它宣稱為跨程序資料庫鎖。
