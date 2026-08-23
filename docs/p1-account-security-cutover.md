# ePet P1 帳號安全切換 Runbook

日期：2026-08-23

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
5. 先保持 `BOT_PROTECTION_REQUIRED=false` 做 smoke test；金鑰齊全時 health 應顯示 `botProtectionEnabled=true`，登入頁也應載入 widget。
6. 將 `BOT_PROTECTION_REQUIRED=true` 後再部署一次。確認金鑰缺失時 health 的 `authenticationEnabled=false`，不可用關閉驗證的方式繞過故障。
7. 驗證 `/api/v1/health` 的 `emailVerificationEnabled`、`lifecycleNotificationsEnabled`、`botProtectionEnabled` 都為 `true`，再把 `REGISTRATION_ENABLED=true`。

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
