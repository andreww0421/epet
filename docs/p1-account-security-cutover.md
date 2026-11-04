# ePet P1 帳號安全切換 Runbook

日期：2026-08-23；安全強化補充：2026-10-29

## 已實作基線

- 新註冊帳號預設未驗證；24 小時 Email token 單次使用、重寄即輪替，資料庫只保存 SHA-256 hash。
- 未驗證帳號可維持 session、重寄驗證信、登出或刪除帳號，但不能讀寫既有工作區或建立新工作區。
- 接受工作區邀請或完成密碼重設可證明 Email 持有權，並將帳號標記為已驗證。
- Turnstile 用於註冊、登入及忘記密碼。伺服器必須驗證 Siteverify 的 `success`、`action` 與 `hostname`，並帶入 Cloudflare 提供的來源 IP。
- 密碼變更、Email 驗證、加入／移除工作區、角色／所有權異動、工作區及帳號刪除會以 `waitUntil` 排程 Resend 安全通知；寄信失敗不回滾已完成的資料交易。

## 正式切換順序

1. 維持 `REGISTRATION_ENABLED=false`，建立 D1 還原點並記錄 commit、操作人與時間。
2. 部署含 `0007_email_verification.sql` 的版本。遷移會把既有帳號安全回填為已驗證，並新增 verification token 表及 `verify` rate-limit scope。
3. 設定 `RESEND_API_KEY`、`PASSWORD_RESET_FROM`、`PUBLIC_APP_URL`，確認正式 hostname 實收密碼重設、Email 驗證、邀請與生命週期通知。
4. 在 Cloudflare Turnstile 建立只允許正式 hostname 的 widget，設定 `TURNSTILE_SITE_KEY` 與 secret `TURNSTILE_SECRET_KEY`。
5. 先在專用 Staging 驗證 widget、真 Siteverify 與寄信。health 的 `botProtectionEnabled=true` 只代表 site key／verifier 已配置，不證明金鑰有效或 hostname 設定正確。現有程式在兩者齊全時，即使 `BOT_PROTECTION_REQUIRED=false` 也已要求 challenge；加入正式金鑰本身也是需核准的行為切換。
6. Staging 驗收後，由管理員依受保護發布流程設定正式 widget／Secrets；確認正式 hostname 的登入與忘記密碼成功，再經獨立核准切換 `BOT_PROTECTION_REQUIRED=true`。缺少金鑰時應回 `503 BOT_PROTECTION_UNAVAILABLE`，不得以開放註冊繞過。整個切換維持 `REGISTRATION_ENABLED=false`。
7. 公開註冊是另一個產品／安全變更，不包含在本次強化。先完成 `docs/security-review.md` AUTH-03 的 duplicate-email response contract、濫用／寄信與 entitlement 驗收，再提出獨立核准；health flags 全為 true 仍不足以授權開啟註冊。

以上是操作計畫，本次沒有執行正式 Secrets、flags、Worker、D1 或會員變更。Staging Worker／D1 使用者最近確認尚未建立，必須先依 [staging-deployment.md](staging-deployment.md) 建置隔離環境；不得以正式學生資料補足測試。

## 2026-10-29 密碼／Session 修補發布與回復

- 修補使用現有 credential 欄位進行原子條件寫入，沒有 SQL Migration、重設密碼、清除會員或全體登出需求。既有不同 iteration 的 credential 仍依各帳號參數驗證。
- 發布前在 Staging 用合成帳號驗證「重設先完成 → 舊登入不得建立 Session」、「登入先寫入 → 重設撤銷該 Session」、同毫秒重設，以及既有會員接受邀請的失敗無副作用／合法重試。
- 以真瀏覽器驗收 session／CSRF cookies、錯誤 Origin、舊 Session、限班 Teacher、跨 Workspace 拒絕；重設／驗證連結的到期、輪替、單次使用及信件僅送受控收件匣。
- 正式發布需既有 PR checks、Review 與獨立 Environment approval。記錄 commit、Worker version、操作人、時間與結果；本次未 push、merge 或部署。
- 修補沒有破壞性資料變更。優先 forward-fix；若需回復，先核對舊版仍可讀取原 credential/schema，回復應用版本並保留 D1／ledger／所有密碼變更。回到未修補版本會重新暴露 AUTH-04，須事故核准、受控入口與立即補修，不可把還原舊密碼當成回復方法。

## PBKDF2 強化的獨立驗收門檻

1. 本次維持 `DEFAULT_PASSWORD_ITERATIONS=100_000`；不增加正式成本或改寫既有 verifier。OWASP 建議 PBKDF2-SHA256 600,000，但本機 workerd 可接受較大值，不能證明 hosted Worker 支援或 CPU 預算足夠。
2. 管理員先記錄實際方案、Worker compatibility date、CPU limits、部署版本；在獨立合成環境量測登入成功／失敗／未知帳號、註冊、邀請與 reset 的平台 CPU／wall p50/p95/p99、超時、錯誤率及有界併發。事前訂定可用性與 CPU headroom 門檻；未達標不切換。
3. Hosted `performance.now()`／`Date.now()` 在 I/O 間的行為不能用來準確量出 KDF CPU，須使用平台 invocation metrics。開發機 dispatch wall time 僅作本機相容性參考。
4. 若保留現有 algorithm，只提升經驗證的 iteration，現有欄位通常不需 schema migration；仍需另外實作 rehash-on-success，並以舊 credential CAS 避免覆蓋同時發生的 reset。新舊 credential／dummy KDF／成本上限須一起測試，不能先部署新雜湊再回滾成無法驗證它的舊程式。
5. 若改為 Argon2id／外部 IdP 或新格式，另提 Expand／Migrate／Contract、密碼驗證器與回復相容計畫，不匯出會員 verifier 或要求全體重設作為預設遷移。

參考：[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Cloudflare CPU limits](https://developers.cloudflare.com/workers/platform/limits/)、[Worker timers](https://developers.cloudflare.com/workers/runtime-apis/performance/)。

## 驗收案例

- 缺少、錯誤、逾期或重放的 Turnstile token 不能註冊、登入或申請重設密碼；錯誤 action／hostname 也必須被拒絕。
- 註冊回應與資料庫、log、瀏覽器儲存區都不得出現 raw Email verification token；token 只存在寄信任務與驗證頁元件記憶體。
- 未驗證 session 讀取 `/api/v1/state` 回覆 `403 EMAIL_VERIFICATION_REQUIRED`；重寄後舊連結失效，新連結使用一次後不可重放。
- 驗證頁載入後立即從網址移除 token；成功後原 session 顯示 `emailVerified=true` 並可讀取工作區。
- 密碼重設撤銷既有 session，且實收 `password_changed` 通知；成員角色、所有權、移除與刪除事件也各實收一封。
- CSP 僅允許 `https://challenges.cloudflare.com` 的 script/frame；其他第三方來源仍被拒絕。

## 監看與回滾

- 監看 `BOT_CHALLENGE_FAILED`、Turnstile Siteverify timeout、Resend 429/5xx、verification rate-limit 與生命週期寄信失敗。
- bot 服務故障時先把 `REGISTRATION_ENABLED=false`。若必須讓既有教師暫時登入，可經事故核准後把 `BOT_PROTECTION_REQUIRED=false`，保留 rate limit 並記錄開始／結束時間；不得同時開放公開註冊。
- 寄信服務故障時維持公開註冊關閉。既有已驗證帳號仍可登入；不要人工回傳 raw verification token。
- 程式回滾不刪除 `email_verified_at` 或 token 表。若前版程式不認得 `0007` 欄位，應回滾 Worker 程式、保留向前相容資料庫，不執行破壞性 down migration。
- 事故解除後恢復完整設定，重跑本文件驗收，再由兩人覆核是否重新開放註冊。
