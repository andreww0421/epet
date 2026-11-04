# Workspace 輸入驗證契約

更新：2026-10-22；M02 本機修補。實作以 `shared/validation/workspaceValidation.ts` 為準。

State PUT、Workspace Import、Revision Restore、註冊時明確提供的 `initialWorkspaceData`，均須先驗證，再進行 normalization。Node JSON／D1 repository 對新的目前版本亦獨立驗證，避免內部呼叫繞過 HTTP 邊界。錯誤回傳 `400 {"error":"INVALID_APP_DATA"}`，不反射輸入值，也不寫入目前資料、revision、projection 或 mutation audit。註冊限流本身的計數仍照常執行。

既有 byte limits 保持：一般 request 為 **2 MiB**、auth request 為 **16 KiB**、D1 workspace JSON 為 **900 KiB**。超過 byte limit 仍為 `413 PAYLOAD_TOO_LARGE`。D1 在序列化前先檢查結構／配置預算，然後保留既有 byte-size guard 的優先順序，再驗證個別欄位；均發生在持久化之前。

| 項目 | 上限／政策 |
| --- | --- |
| 結構深度 | root 深度為 0，任何節點最多 24 層；採 iterative traversal。 |
| 整份資料節點 | 100,000，包含 scalar 與 container；檢查待訪節點預算後才展開。 |
| 一般陣列／物件 | 陣列最多 10,000 元素，物件最多 2,000 keys；個別欄位可更嚴格。 |
| 一般字串／key | 字串最多 4,096 UTF-16 code units；key 最多 200。 |
| 班級／學生 | 最多 200 班、每班 500 人、整份資料合計 5,000 人。這些是安全上限，不是已量測的產品容量承諾。 |
| ID／姓名 | ID、姓名最多 200；team／legacy teammate ID 最多 512，保留舊版雙學生 ID 衍生的隊伍 ID。 |
| 數值 | 所有 JSON 數值必須有限；一般已宣告數值為 0 至 1,000,000,000。`amount`／`requestedAmount` 等有意義的調整量允許負值至 -1,000,000,000；時間戳為 0 至 8,640,000,000,000,000。未知擴充欄位仍受整體有限數值與結構預算限制。 |
| `warningPoints` | 必須為 0 至 1,000 的整數；負數、小數、超限、非有限值、Strict snapshot 的數字字串／null 均拒絕。 |
| `activeWarningTimestamps` | 每組最多 1,000 個合法時間戳；整份資料的明確或預計合成 timestamps 合計最多 10,000。含 discipline safety snapshots。 |
| 歷史集合 | 一般具名紀錄集合最多 2,000；evidence 2,000、exam records 200、每 exam items／scores 100、results 500；日曆日期陣列 3,660、weekdays 7。既有 normalization 的更小保留上限維持不變。 |
| 必要結構 | Strict snapshot 必須有字串 `currentClassId`、`classes` 陣列；各班必須有字串 `id`、`students` 陣列。學生及舊版本缺少的新欄位可沿用既有安全預設；已提供的欄位須符合型別／範圍。 |

這是資源與型別契約。既有 domain normalization、class lifecycle、duplicate-ID、RBAC、tenant/class scope、CSRF 及 revision/CAS 檢查仍須通過；通過 schema 不代表有權操作或資料已寫入。未知擴充欄位同樣受預算限制，之後依既有 normalizer 的既定規則處理，沒有新增 silent-drop migration。

`normalizeAppData` 本身先檢查整份資源預算；`normalizeStudent` 亦可獨立安全呼叫，並在 `Array.from` 前檢查 warning count。沒有把超限 warning count 截斷到上限，也不會先配置再驗證。既有 direct normalizer 的有界數字字串、預設與 domain clamp 保留；網路上的 Strict snapshot 不以 coercion 取代型別驗證。

舊備份與歷史資料的處理：

1. UI 備份預覽以同一 schema 的 `legacy` 模式驗證，再 normalize 成 Strict snapshot，最後走有 revision 與確認步驟的 Import API。支援 root `students`、缺少新欄位、`hourlyDecay`、單一 `classGoal`、舊隊友／boss reward／feedback history 格式。Legacy 模式只額外接受有界十進位數字字串；不是略過數值或結構上限。
2. 已保存、超出新政策的 revision 保留原樣；Restore 回 400，不會自動裁切、丟棄或覆寫。Owner/admin 可使用既有授權匯出保存原件，在隔離環境盤點原因與修正對照，經人工確認後使用明確 Import 流程。修正數值須保留處理紀錄，不可用截斷掩蓋資料差異。
3. 隱私刪除對既有 revision 的清理只移除指定身分，不能因另一位學生的舊超限 warning count 而失敗。D1 這條內部路徑只保留／清理既有來源，不執行 normalization；保留結構及 900 KiB guard，未涉及的舊值不變。這個例外不能用來寫新目前版本或 Restore；Node／D1 均有成對 regression。
4. 若既有目前資料或歷史本身超出結構預算，可能需先經受控資料修復才能繼續 mutation。部署前須先以授權匯出在隔離環境盤點，不應以提高上限、跳過驗證或直接改正式 D1 解決。

沒有 schema migration、dependency 或 lockfile 變更。驗證以合成資料執行：`npm run test:workspace-validation`、`npm run test:imports`、`npm run test:d1-core`、`npm run verify`。`1e12` warning count 透過配置 sentinel 驗證，測試不會實際配置該長度。正式環境容量、Worker CPU／memory headroom、併發與 transport buffering 應依 V05 另行驗收；本契約不宣稱消除所有 DoS 或所有合法大資料的成本。
