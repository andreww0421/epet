# P1 正規化讀取切換與 blob 退場

日期：2026-08-23

## 已實作的安全模型

- `0006_projection_read_model.sql` 新增工作區根層投影、每個實體的原始陣列順序，以及 `pending` / `verified` / `mismatch` 對帳狀態。
- Worker 預設以正規化表重建 `AppData`，不再以 `workspaces.data_json` 作為主要讀取來源。
- 首次讀取與每次新 revision 會對 blob 與投影做穩定序列化 SHA-256 對帳；只有 checksum 一致才標記為 `verified`。
- 已驗證的 revision 之後只讀取根層投影與正規化實體表；投影 checksum 漂移時自動改讀 blob，不把不完整資料送給使用者。
- 每日 Worker cron 會分批重新對帳，並從當前 blob 交易式重建有差異的投影。

## 部署與驗收順序

1. 備份 D1，記錄還原點、部署 commit 與操作人。
2. 先套用 `0006_projection_read_model.sql`，完成根層投影與 `sort_index` 回填。
3. 部署 Worker，先以 `WORKSPACE_READ_MODE=verify` 做 shadow read：重建並對帳正規化資料，對外仍回傳 blob。
4. 觸發一次 scheduled maintenance，或等待每日 cron 完成全量對帳。
5. 以下列 SQL 確認全數 `verified`，且無 `pending` / `mismatch`：

```sql
SELECT reconciliation_status, COUNT(*) AS workspace_count
FROM workspace_projection_documents
GROUP BY reconciliation_status
ORDER BY reconciliation_status;
```

6. 抽樣檢查各實體數量與 `details_json`，再移除 `WORKSPACE_READ_MODE=verify` 或設為 `normalized`。
7. 驗證登入、切換工作區、儲存、revision 復原、單生刪除與匯出。

## 回滾

若正規化讀取錯誤率、`mismatch` 或延遲上升：

1. 將 Worker 的 `WORKSPACE_READ_MODE` 設為 `blob` 並重新部署。
2. 保留 `workspace_projection_documents`、投影表與 audit，不刪除差異證據。
3. 以 `details_json` 的期望／實際筆數定位差異，修正後回到 `verify`。
4. 再次達成全數 `verified` 才重開 `normalized`。

`blob` 回滾只改讀取來源，dual-write、revision 與投影對帳仍繼續運作。

## blob 退場閘門

`workspaces.data_json` 目前已降級為交易式相容寫入、revision 來源與緊急回滾副本，不再是預設讀取來源。實體欄位不應在下列條件前物理刪除：

- 正式資料已連續 30 日全數 `verified`，且沒有未解決 `mismatch`。
- 已完成一次 D1 備份還原，還原後投影仍可全數驗證。
- revision 快照改為不依賴 `workspaces.data_json` 觸發器的寫入路徑。
- 所有寫入都以正規化表為主，並已通過並發、回滾、刪除與租戶隔離測試。
- 緊急回滾不再需要 blob，且有可還原的 migration 與簽核。

達成上述條件後，才能以新 migration 移除 `data_json` 與舊 trigger；不可在第一次切讀時同時做不可逆刪除。
