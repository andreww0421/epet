# 班級封存與生命週期

班級有「使用中」（`active`）與「已封存」（`archived`）兩種狀態。封存保留唯讀教學歷史；重新開啟讓班級恢復日常操作；永久刪除會清除班級及其保留的應用程式 revision，須以較高風險操作確認。

此功能沿用 `ClassData.archivedAt`，由 `shared/domain/classArchive.ts` 統一判定狀態，沒有另存第二份 status，也沒有新增 DB schema 或 migration。缺少有效 `archivedAt` 的既有班級視為使用中。

## 使用方式

目前工作區的 owner / admin 可在 Teacher Console → Settings → 資料治理 → 工作區資料檢查班級、封存、重新開啟、檢視唯讀歷史或永久刪除。學生管理中的刪除班級入口也使用同一個永久刪除流程。

| 操作 | 結果與確認 |
| --- | --- |
| 封存 | 輸入 `ARCHIVE CLASS`；班級移出日常教學與公開投影選單，保留資料。 |
| 重新開啟（還原） | 輸入 `REOPEN CLASS`；班級回到一般選單，保留原有資料。 |
| 永久刪除 | 檢查學生、學習證據、考試數量，勾選了解無法以 revision 復原，再輸入 `DELETE CLASS`。 |

至少須保留一個使用中的班級。因此最後一個使用中班級不能封存或刪除；已封存班級可刪除。重複封存／重新開啟是 idempotent，不新增重複 revision 或 audit。永久刪除後再次操作該 ID 會回報找不到班級。

## 封存的唯讀範圍

封存班級保留學生、班級目標、學習證據、考試與成績、教師評語、積分、處罰、對戰、遊戲資源及魔王紀錄。資料仍包含於授權的工作區匯出與保存政策中。

「唯讀歷史」提供學習證據、目標、既有考試分析、教師評語及活動紀錄。考試得分率、前次差異、趨勢與弱項沿用現有 exam domain 計算；歷史檢視本身不正規化資料、不推進時間，也沒有教學或遊戲 mutation callbacks。敏感操作紀錄仍在「稽核」頁查詢。這些內容包含學生個資，只供管理介面檢視，不供公開投影。

封存不執行自動寵物衰減；timed normalization 使用 `archivedAt`，避免未來載入改變處罰、魔王恢復或寵物生命狀態。重新開啟後由一般 workspace clock 繼續，不補算封存期間衰減；原有 wall-clock 到期規則恢復使用目前時間。直接將封存班級傳入 presentation builder，也不會輸出學生、排行榜或魔王。

前端 store 的日常操作以共用 active-class guard 拒絕寫入封存班級，包括積分、學生、學習、考試、對戰、魔王及重設賽季。後端一般 state PUT 同樣拒絕修改封存內容；學習證據與魔王結算 API 另有封存檢查，不能只靠隱藏 UI 控制權限。

## API 與權限

Node 與 Cloudflare Worker 共用 `server/routes/classRoutes.ts`：

```text
POST /api/v1/classes/:classId/privacy/archive
POST /api/v1/classes/:classId/privacy/reopen
POST /api/v1/classes/:classId/privacy/delete
```

三者都需要已驗證 session、目標工作區 owner/admin membership、同站 Origin、CSRF token、目前 `expectedRevision` 與精確 confirmation phrase。永久刪除另須 `acknowledgePermanentDeletion: true`，例如：

```json
{
  "expectedRevision": 42,
  "confirmation": "DELETE CLASS",
  "acknowledgePermanentDeletion": true
}
```

confirmation 是操作確認，不能替代身分驗證。teacher / viewer 即使直接呼叫 API 也會被拒絕；班級查詢限於已授權工作區。版本衝突回傳 `409 REVISION_CONFLICT`，最後使用中班級保護回傳 `409 LAST_ACTIVE_CLASS`，不存在的班級回傳 `404 CLASS_NOT_FOUND`。成功回傳 `action` 與新的 workspace snapshot。

一般 state PUT 對 owner / admin 也不能刪除既有班級、改變 `archivedAt`、修改封存內容或直接建立封存班級。`protectClassLifecycleWrite` 接受封存資料的原始快照或一次正規化後的相等輸入，再保留伺服器原始封存資料，避免背景 normalization 差異阻擋其他使用中班級同步。

## 同步與確認對象

`useClassLifecycleAction` 共用 `useWorkspacePrivacyOperation`，先同步既有草稿，再以固定工作區 ID 讀取最新 revision。確認畫面保存 `reviewedWorkspaceId` 與班級快照；工作區、權限、名稱或封存狀態改變時停止。永久刪除也比較畫面顯示的學生、學習證據與考試數量，要求重新檢查變更後的影響。

之後的並行變更由 repository CAS 拒絕。成功後 reload，讓 sync controller 重讀 base revision；不只替換前端 store 而留下舊 revision。操作中禁止重複提交，失敗保留錯誤供重新檢查。

## 永久刪除與 audit

刪除移除整個班級，包含沒有學生的班級與其獨立目標、學習、考試、設定及遊戲紀錄。所有保留的 application revisions 都會移除該班級並更新快照大小與目前班級選擇，因此受控 revision restore 不能取回這些已清除的內容；不只清除目前學生 ID。

JSON repository 在 serialized mutation 的副本上處理 current data、retained revisions 與 audit，檔案原子替換成功後才公布記憶體狀態。D1 在同一個 revision/write-token guarded batch 中處理 workspace blob、normalized projections、retained snapshots、相關學生 audit target 去識別化與新 audit。CAS、projection 或 persistence 失敗不應留下部分刪除。

封存／重新開啟／刪除記錄 `class.privacy.archive`、`class.privacy.reopen`、`class.privacy.delete`；整班清理另記 `privacy.class.purge`，涉及學生時沿用 `privacy.student.purge`。新刪除／清理 audit 只增加刪除班級與學生的彙總數量，不保存被刪班級或學生的名稱、ID、評語或成績。既有 audit 的操作人、動作、時間與必要追責資訊仍保留，不能宣稱所有歷史識別資訊一併抹除。

## 匯入與版本復原

一般 JSON 匯入與明確的舊本機資料遷移先同步並開啟共用確認畫面，列出目前與備份的班級、學生、學習證據、考試與封存數量，不列出學生個資。

保留原有完整 JSON 備份還原功能，但不再直接覆寫 local state 後交給普通 PUT。須勾選了解取代／清除影響、輸入 `IMPORT WORKSPACE`。`POST /api/v1/workspace/import` 要求 owner/admin、既有 Origin/CSRF、`expectedRevision` 與 `acknowledgeReplacement: true`，透過 repository CAS 原子取代並記錄 `workspace.privacy.import`。可還原備份中的封存班級與原有 ID／設定；至少保留一個使用中班級，`lastOpened` 重設為目前時間避免回放舊備份衰減。被移除的班級與學生同樣從 retained revisions 清除。不另引入班級合併、改 ID 或部分遊戲計時規則。

FileReader 開始讀檔時即固定工作區；確認畫面及操作 hook 也固定 reviewed workspace，切換工作區後不能把舊檔案套入另一個工作區。畫面保存伺服器 revision；確認前再次同步與讀取，任何 revision 變動（包含總筆數相同的積分更新）都要求重新檢查，之後再由 CAS 阻擋並行寫入。成功後 reload，不沿用舊 sync revision。舊本機遷移入口在 flush 的 saving 階段保持掛載，避免自己的同步取消確認流程。

原有 revision 預覽與受控 restore 也保留；該操作獨立授權、以目前 revision 寫入並記錄 `workspace.revision.restore`，可能恢復尚未清除的舊生命週期狀態。已永久刪除的班級已從保留快照清除，不能由該路徑取回。但外部備份可以重新引入先前刪除的資料，必須先確認授權與保存政策。

## 模組責任與變更範圍

| 邊界／檔案 | 責任 |
| --- | --- |
| `shared/domain/{classArchive,studentPrivacy}.ts` | 純 lifecycle 判定／變更、last-active 保護、完整歷史班級清除；不依賴 React／Zustand。 |
| `server/routes/{classRoutes,workspaceRoutes,learningRoutes,bossRoutes}.ts`、`server/workspaceScope.ts` | 共用 Node／Worker 的角色、tenant、確認、archive 寫入與 CAS 邊界；明確區隔普通同步與受控復原。 |
| `server/repository.ts`、`worker/{repository,projectionStatements}.ts` | 平台各自的 atomic persistence／D1 batch、歷史清理與 audit，不強行抽象 filesystem／D1。 |
| `ClassLifecycleDialog`、`useClassLifecycleAction`、`model/classLifecycleReview.ts` | 確認 UI、固定工作區與對象、同步協調，不重複 domain rules。 |
| `ArchivedClassHistoryPanel`、`model/classArchiveHistory.ts` | 私人唯讀歷史 projection 與呈現，重用既有 exam analytics；不提供 mutation。 |
| `WorkspaceImportDialog`、`useWorkspaceImportReview`、`src/imports/workspaceImport.ts` | 彙總完整還原影響、固定 workspace／revision 與受控 server import，不重複遊戲邏輯。 |
| `WorkspaceDataPanel`、`DataGovernancePanel`、`StudentManagementSection` | 班級管理入口、歷史與 audit composition；舊刪除入口導向同一流程。 |
| `src/store/useStore.ts` | 既有 mutation 套用共用 active-class guard，包含 undo 與非同步 boss callback；不改遊戲數值。 |
| `DashboardHeader`、`LegacyDataMigration`、`DashboardView`、`App`、`backendApi` | 檔案入口、傳遞既有 flush callback、centralized API；不直接覆寫工作區。 |
| `src/components/ModalDialog.tsx` | 可選的初始／返回焦點 ID，在 native showModal 後聚焦安全取消按鈕；非同步匯入停用 trigger 後仍能返回指定按鈕，其他 callers 不變。 |

## 保存限制與技術債

- 封存不是刪除，也不代表保存期限到期；目前仍由機構訂定期限並由授權人員手動處理。
- 每個工作區最多保留 25 個 revisions，是版本數量而非天數；live data 與 audit 尚無自動依年齡到期政策。
- 外部下載、列印、報告、Cloudflare 備份／Time Travel 及其他系統副本不會隨本操作撤回；授權人員仍可能將外部副本作為新資料匯入。
- 匯入維持完整備份還原，不提供逐班合併或重新編號。外部備份需要機構自行審核資料來源及刪除後再引入的風險。
- 舊資料 normalization 尚有非冪等 fallback；本輪保留既有遊戲規則，封存寫入 guard 接受原始或一次正規化的相等快照。

## 驗證入口

`npm run test:privacy` 納入 lifecycle API、repository purge、store 封存保護與歷史 projection 回歸；`npm run test:imports` 納入受控完整還原、彙總影響及 workspace／revision pin。D1 成功清理與 rollback 在 `npm run test:d1-core`；完整規則與整合驗證使用 `npm test`。

```bash
npm run test:e2e -- tests/e2e/class-lifecycle.spec.ts
npm run test:a11y -- tests/accessibility/class-lifecycle.spec.ts
```

Browser coverage 使用隔離的虛構資料，檢查封存／重新開啟／永久刪除、唯讀歷史、公開展示、確認與取消、權限、revision conflict，以及鍵盤／axe。

### 本輪實際結果（2026-10-15–16）

改動前相關 baseline：`test:privacy` 32/32、`test:server` 33/33 通過。新增 96 項單元／整合回歸，涵蓋 47 項 store 保護、20 項 lifecycle、7 項 JSON/pure purge、6 項歷史 projection、9 項匯入、2 項確認目標與 5 項 D1 回滾／清理。

| Command | 結果 |
| --- | --- |
| `npm run lint` | 通過。 |
| `npm test` | 最終 source 449/449 通過：355 項 Node tests 加上全部 94 項 gameRules cases。 |
| `npm run test:imports` | 22/22 通過，已納入完整測試。 |
| `npm run test:privacy` | 114/114 通過，已納入完整測試。 |
| `npm run test:d1-core` | 23/23 通過，包含整班清理、空班級、tenant 隔離、CAS loser 及 projection rollback。 |
| `npm run build` | 通過，production assets 未混入 synthetic analytics hooks。 |
| `npm run check:worker` | 通過，僅 dry-run；既有 Sentry optional Node built-in 警告仍保留。 |
| `npm run test:e2e` | 完整 suite 51/51 通過，unexpected／flaky／skipped 均為 0；保存原始 HTML report。其後針對最終 `App` 掛載修正新增的 legacy save-in-flight 回歸另跑 1/1 通過，總計 52 項案例有實際驗證。 |
| `npm run test:a11y` | 最終 source 20/20 通過；48 個不同 axe 狀態為 0 confirmed violations（含 moderate／minor）。21 個 color-contrast incomplete 狀態仍須人工量測；本輪新增 7 個掃描狀態，未停用規則或排除元素。 |

Windows sandbox 的 TEMP atomic rename 遭遇 EPERM 後，以核准的相同本機命令重跑；沒有為此改低安全政策。既有 forgot-password 測試另修正背景 task 啟動排程的競態：先確認 response 在 delivery gate 未放行時返回，再等待 mailer 啟動訊號；原有 response deadline、最小回應時間及 delivery gate 斷言保留，沒有改動 authentication policy。

Browser 測試找出並修正兩個焦點問題（native showModal 覆蓋 React autoFocus、非同步停用匯入 trigger 造成無法返回焦點）及一個重複 landmark 名稱。最終完整 a11y suite 覆蓋共用對話框的舊行為；已檢查本輪桌面／手機實際截圖。axe incomplete、實際輔具與跨瀏覽器限制保留在 [accessibility backlog](accessibility-backlog.md)，不能將自動測試結果視為 WCAG 認證。

[Data & Privacy 文件的 2026-10-08 結果](data-privacy-management.md) 是先前版本的歷史結果。以上是實作／本機驗證階段的紀錄；該階段未執行 production migration、部署或 push。後續 GitHub 與 Cloudflare release 結果另以發布報告確認。
