# P1 資料治理控制台

日期：2026-08-23
狀態：程式與自動測試完成；正式環境仍須依本文件完成人工 smoke 與營運簽核。

## 權限與入口

- owner／admin 登入後可在導師控制台開啟「資料治理」。teacher、viewer 不顯示入口，API 仍會獨立以 workspace membership 與 `admin` 最低角色拒絕越權。
- 所有 API 使用同站 HttpOnly session；改變狀態的 revision 復原另受 Origin 與 double-submit CSRF 保護。
- audit 查詢只接受目前 active workspace，不允許以前端傳入任意租戶範圍。

## Revision 復原

1. 控制台載入最近 25 個 revision；列表不包含完整資料，選取後才讀取單一快照並顯示班級、學生、評量與學習證據筆數。
2. 目前 revision 不可復原。管理員必須開啟確認視窗並完整輸入 `RESTORE <revision>`。
3. 送出前先 flush 現有 autosave；flush 失敗即取消，不讓未同步變更被快照覆蓋。
4. 後端以 revision conflict gate 寫入；成功時不改寫歷史，而是以選定快照建立新 revision 與 `workspace.revision.restore` audit event。
5. 成功後整頁重新載入新 revision，避免舊 React state 再次 autosave 覆寫復原結果。

## 單生限縮匯出

- 管理員先選班級與學生，後端從現行 workspace 重新建立 JSON，只包含該生 profile、正式行為／積分紀錄、daily progress、學習證據、該生考試結果與魔王參與摘要。
- 同班其他學生、其他學生的考試結果、完整魔王 contribution map 均不會輸出。
- 檔名使用 student ID 與日期，不使用學生姓名；每次成功匯出會留下 `student.privacy.export` audit event。
- 檔案仍屬學生資料，只能存於核准的加密位置，以已驗證通道交付，案件完成後依核准期限刪除。

## Audit 查詢

- `GET /api/v1/audit` 支援 `action`、`actorUserId`、`targetType`、`from`、`to`、`limit` 與 opaque cursor；單頁最多 100 筆，排序固定為 `createdAt DESC, id DESC`。
- JSON 與 D1 repository 都先限制 workspace，再套用 bound filter 與 cursor，避免跨租戶資料混入。
- 每次成功查詢都新增 `audit.query` event，記錄 request ID、篩選條件與結果筆數，不記 raw authentication data。
- 回應前遞迴移除 metadata 中疑似 token、password、secret、credential、session、authorization 或 cookie 的 key；UI 另做第二層顯示過濾與長度限制。

## 發布前人工 Smoke

使用只含測試資料的非正式 workspace，留下操作人、時間、部署版本與證據：

1. owner 與 admin 看得到入口；teacher 與 viewer 看不到，直接呼叫三類 API 均為 `403`。
2. 建立一筆可辨識變更，預覽前一 revision，輸入錯誤確認字串時按鈕不可送出；正確復原後 revision 增加、資料回到快照內容，且 audit 出現復原事件。
3. 選擇兩位不同學生各匯出一次，搜尋檔案內容確認不含另一位的 ID、姓名、評語與成績。
4. 依動作、操作人、對象與日期分別查詢；載入下一頁時不可重複，並確認 `audit.query` 本身可在重新查詢後看到。
5. 模擬 revision conflict 與斷線 flush 失敗；兩者都不得執行復原，也不得讓目前資料消失。

## 尚未由程式取代的營運責任

- D1 備份／Time Travel 還原演練、核定 RPO／RTO、revision 與 audit 的實際保留期限。
- 資料請求案件編號、請求人與監護／校方授權驗證、安全交付、刪除證明及法定例外保留。
- 正式環境瀏覽器、鍵盤、螢幕閱讀器與 WCAG 2.2 AA 核心流程驗收。
