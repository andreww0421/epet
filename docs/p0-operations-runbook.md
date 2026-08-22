# ePet P0 上線與復原 Runbook

日期：2026-08-23
狀態：技術基線；正式值班人、隱私窗口、RPO／RTO 與備份政策仍需營運者簽核。

## 發布閘門

1. 確認 `REGISTRATION_ENABLED=false`，封閉試點僅使用 Email 邀請。
2. 確認已設定 `RESEND_API_KEY`、`PASSWORD_RESET_FROM` 與 `PUBLIC_APP_URL`，並實收一封密碼重設及一封工作區邀請。
3. 先套用 D1 migration，再部署 Worker，最後部署前端。
4. 執行 `npm run verify`；任一 lint、test、build 或 Worker dry-run 失敗即停止發布。
5. 用兩個測試帳號驗證邀請、班級範圍、owner 移轉、登出後舊 session 失效與斷線草稿重試。

## 備份與還原演練

- 正式發布前建立可識別的 D1 還原點，並將時間、資料庫、變更版本與操作人記入值班紀錄。
- 每季在非正式資料庫完成一次還原演練：驗證 workspace 數量、會員關係、最新 revision、正規化學生筆數與抽樣匯出一致。
- 還原後不可直接切換流量；先重做備份時點之後的學生／帳號刪除請求，再完成租戶隔離與登入測試。
- 必須由營運者寫入實際 RPO／RTO。在沒有一次有計時的成功演練前，不得宣稱已達成任何復原時間。

## 事故處理

1. 停止公開註冊與高風險部署，保留 Worker 觀測資料及 audit event。
2. 確認受影響 workspace、帳號、學生資料類別、發生／發現時間與是否仍持續。
3. 撤銷受影響 session、保留證據，不將 raw token、密碼、學生姓名或評語寫入工單。
4. 依核准的學校協議與適用法規啟動通知，並留存決策人與時間。
5. 修復後重跑 `npm run verify`，另驗證越權、重放、revision 復原、學生刪除與帳號刪除。

## 每日監看

- `/api/v1/health` 為 `200`，邀請寄送狀態與預期一致。
- Worker 5xx、D1 錯誤、寄信失敗、revision conflict 與 rate-limit 突增需要有明確負責人。
- 每日 cleanup cron 有執行紀錄；連續兩次未執行時人工補跑並追查。
- 部署、migration、還原與大量刪除都必須留值班記錄。
