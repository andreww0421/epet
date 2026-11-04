# ePet P0 上線與復原 Runbook

日期：2026-08-23；DR 增量更新：2026-10-30；CI/CD 增量更新：2026-10-31
狀態：技術基線；正式值班人、隱私窗口、RPO／RTO 與備份政策仍需營運者簽核。

## 發布閘門

1. 切換期間維持 `REGISTRATION_ENABLED=false`，封閉試點僅使用 Email 邀請。
2. 確認已設定 `RESEND_API_KEY`、`PASSWORD_RESET_FROM` 與 `PUBLIC_APP_URL`，並實收密碼重設、Email 驗證、工作區邀請及至少一種帳號生命週期通知。
3. 依 [`p1-account-security-cutover.md`](p1-account-security-cutover.md) 先在隔離環境驗真 Turnstile site／secret key、action／hostname／重放與實收信，再經核准切換正式 mandatory flag；health 能力 flags 不能代替金鑰或 D1 驗收。
4. 依 [`database-migration-policy.md`](database-migration-policy.md) 分離 application deploy 與核准 expansion；application 只唯讀檢查 ledger，不自動套用 migration。既有歷史 SQL 不 raw replay，缺 ledger 不推定空庫；Worker 與 Static Assets 仍作同一相容版本發布。
5. 執行 `npm run verify`；任一 lint、test、build 或 Worker dry-run 失敗即停止發布。
6. 在已隔離的 staging／本機合成資料使用兩個測試帳號，驗證 Email token 重寄／過期／重放、邀請、班級範圍、owner 移轉、登出後舊 session 失效與斷線草稿重試；不可把這些資料寫入測試指向 Production。
7. 套用 `0006` 時依 [`p1-normalized-read-cutover.md`](p1-normalized-read-cutover.md) 先完成 shadow verify，確認無 `pending` / `mismatch` 才切到正規化讀取。
8. 依 [`p1-same-origin-session-cutover.md`](p1-same-origin-session-cutover.md) 驗證 `__Host-epet_session` cookie flags、Bearer-only 為 `401`、缺少／跨站 Origin 為 `403`，以及缺少／錯誤 CSRF token 為 `403`。
9. 依 [`p1-data-governance-console.md`](p1-data-governance-console.md) 用非正式工作區完成管理 UI smoke：預覽舊 revision、輸入指定確認字串復原並確認產生新 revision；單生檔不得包含同班其他學生；audit 篩選、分頁與查詢留痕皆須成功。
10. 公開註冊須另完成 AUTH-03 response contract 與營運核准，不因上述 tests／health 通過而自動開啟；本次維持 `REGISTRATION_ENABLED=false`。確認舊 GitHub Pages 已停用或只做導向，不可仍提供登入功能。
11. 正式 application 發布依 [production-deployment.md](production-deployment.md) 完成 `npm ci`／verify／唯讀 ledger gate，發布後執行無帳號唯讀 smoke；核對 serving version、失敗通知接手與人工相容回復。Smoke 不證明 authenticated D1／tenant isolation，且發布後失敗不會自動撤回已服務版本。不得為 smoke 建立正式帳號／學生，或自動回滾 D1。

## 備份與還原演練

- 正式發布前建立可識別的 D1 還原點，並將時間、資料庫、變更版本與操作人記入值班紀錄。
- 每季在非正式資料庫完成一次還原演練：驗證 workspace 數量、會員關係、最新 revision、正規化學生筆數與抽樣匯出一致。
- 還原後不可直接切換流量；先重做備份時點之後的學生／帳號刪除請求，再完成租戶隔離與登入測試。
- 必須由營運者寫入實際 RPO／RTO。在沒有一次有計時的成功演練前，不得宣稱已達成任何復原時間。

完整程序、平台限制、合成演練、停寫／隔離、獨立 suppression journal、舊密碼／Session／token 回復風險及人工重開閘門見 [disaster-recovery.md](disaster-recovery.md)。`npm run test:recovery` 與 `npm run db:drill:local` 只驗證本機 Miniflare，不能填成 hosted Time Travel 或正式 RPO／RTO。還原後須取得可信 schema／migration 基準，執行唯讀完整性檢查並另驗刪除／安全狀態重套；`structurally_valid` 不是准許重開流量。

SQL 匯出可包含超過 D1 單一 statement 100,000 bytes 的合法 workspace／history row。必須在任何匯入寫入前逐 statement 檢查 UTF-8 bytes，超限停止；不可刪除或裁切資料、降低既有 900 KiB snapshot 保護限制、或以拆檔代替單列容量處理。大型備份的參數化還原策略仍須獨立審查與 remote rehearsal。

## 事故處理

1. 停止公開註冊與高風險部署，保留 Worker 觀測資料及 audit event。
2. 確認受影響 workspace、帳號、學生資料類別、發生／發現時間與是否仍持續。
3. 撤銷受影響 session、保留證據，不將 raw token、密碼、學生姓名或評語寫入工單。
4. 依核准的學校協議與適用法規啟動通知，並留存決策人與時間。
5. 修復後重跑 `npm run verify`，另驗證越權、重放、revision 復原、學生刪除與帳號刪除。

## 每日監看

- `/api/v1/health` 為 `200`；公開註冊前 `botProtectionEnabled`、`emailVerificationEnabled`、`lifecycleNotificationsEnabled` 必須皆為 `true`。
- Worker 5xx、D1 錯誤、寄信失敗、revision conflict 與 rate-limit 突增需要有明確負責人。
- 每日 cleanup 與投影全量對帳 cron 有執行紀錄；連續兩次未執行或出現 `mismatch` 時人工補跑並追查。
- 部署、migration、還原與大量刪除都必須留值班記錄。

監控架構、API／D1／認證／寄信／Cron 告警提案、SEV 接手、通知 receipt 演練與不含學生資料的報表見 [monitoring-operations-runbook.md](monitoring-operations-runbook.md)。收到事件量不等於完整錯誤率；沒有可信分母或獨立 Cron collector 時填 unknown。2026-10-31 的 relay／Secret-name 唯讀證據未證明正式 Sentry 已啟用，不能把本機 tests 或安靜 dashboard 當正式營運驗收。
