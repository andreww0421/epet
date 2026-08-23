# ePet P1 同站 Session 切換 Runbook

日期：2026-08-23

## 架構與安全基線

- Cloudflare Worker 同時提供前端 Static Assets 與 `/api/`，正式瀏覽器不再跨站呼叫 API。
- session 使用 `__Host-epet_session` cookie：`Path=/`、`HttpOnly`、`Secure`、`SameSite=Lax`，不設定 `Domain`。
- CSRF 使用 double-submit：可讀的 `__Host-epet_csrf` cookie 必須與 `X-CSRF-Token` header 一致。
- 所有會改變狀態的方法都必須有 `Origin`；只有與請求 URL 同源的 Origin 可通過。
- API 不再接受 `Authorization: Bearer`，登入／註冊／邀請接受回應也不回傳 raw session token。
- Worker 對文件與 API 統一加入 CSP、HSTS、`nosniff`、`no-referrer`、COOP、CORP 與限制型 Permissions Policy。

## 發布前提

1. GitHub production environment 設定 `CLOUDFLARE_ACCOUNT_ID` 與最小權限的 `CLOUDFLARE_API_TOKEN`。
2. Worker secrets 已設定 `RESEND_API_KEY`、`PASSWORD_RESET_FROM`；`PUBLIC_APP_URL` 指向同站正式首頁。
3. 建立 D1 還原點，記錄 commit、操作人與時間。
4. 執行 `npm run verify`，確認 lint、單元／整合測試、前端 build 與 Worker dry-run 全部成功。

## 部署與驗收

1. 執行 `npm run db:migrate:remote`。
2. 執行 `npm run deploy:worker`；這一步同時發布 API 與 `dist` 靜態資源。
3. 從正式首頁登入，在瀏覽器 DevTools 確認 session cookie 具有 `HttpOnly`、`Secure`、`SameSite=Lax`，且沒有 `Domain`。
4. 驗證重新整理可復原登入；登出後相同 cookie 無法再取得 session。
5. 驗證只帶 Bearer、缺少 Origin、跨站 Origin、缺少或錯誤 CSRF 的請求分別得到 `401` 或 `403`。
6. 驗證登入、邀請接受、workspace 寫入、忘記／重設密碼與帳號刪除的正常路徑。
7. 確認 HTML 與 API 回應包含預期安全標頭，且 SPA 深層路由仍回傳入口頁。
8. 停用舊 GitHub Pages 正式入口，或將它改成不含登入功能的正式網址導向頁。

## 切換注意事項

- 舊版存在 `sessionStorage` 的 Bearer token 會自然失效；使用者第一次進入新版需重新登入。
- 不可讓舊 GitHub Pages 與新 Worker 同時充當正式登入入口；HttpOnly session 刻意不支援該跨站模式。
- 自訂網域上線時，前端與 `/api/` 必須一起綁在同一 origin，並同步更新 `PUBLIC_APP_URL`。

## 回滾

1. 回滾整個 Worker 版本，使 API 與 Static Assets 保持同版；不可只回滾其中一側。
2. 不可重新開啟 Bearer token 或把 session 放回 Web Storage。若問題只影響登入，先關閉公開註冊並修復 cookie／CSRF 流程。
3. D1 僅在 migration 本身造成資料問題時依已記錄還原點處理；session 資料庫仍只保存 token hash，不需為前端切換降版。
4. 回滾後撤銷測試 session，重新驗證租戶隔離、登出、Origin 與 CSRF 拒絕路徑。
