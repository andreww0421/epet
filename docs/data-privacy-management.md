# Data & Privacy 管理

此功能位於 Teacher Console → Settings → 資料治理。只有**目前工作區**的 owner / admin 可以使用；teacher / viewer 的權限不能由帳號的全域角色替代。

## 使用範圍

- 工作區：匯出目前資料、查看真實保存行為、封存與重新開啟班級。
- 學生：匯出單一學生資料、刪除、結構化匿名化／去識別化。
- 稽核：沿用可篩選、分頁的 sensitive action audit，加入新的資料管理動作。
- 隱私：說明 D1／本機檔案／瀏覽器草稿與下載副本；連到既有公開展示設定。
- 既有 revision 預覽／復原、帳號生命週期功能保留。

## Architecture 與責任

| 模組 | 責任 |
| --- | --- |
| `DataGovernancePanel` | 工作區角色 gate、平面分頁、既有 revision / audit / account composition；切換工作區時重新掛載，避免沿用上一個工作區的 UI state。 |
| `WorkspaceDataPanel` | 工作區匯出、保存資訊、封存影響與 typed confirmation。 |
| `StudentDataPanel` | 限縮學生匯出、對象選擇、影響說明、理解勾選與 typed confirmation。 |
| `PrivacyInformationPanel` | 真實的資料保存邊界與公開展示政策；不維護第二份設定草稿。 |
| `useWorkspacePrivacyOperation` | 防止重複提交、固定 workspace、同步草稿、讀取最新 revision、錯誤回饋與成功後 reload。 |
| `shared/domain/studentPrivacy` | 無 React / Zustand 的純資料刪除與去識別化；共用於 Node 與 Worker。 |
| `shared/domain/classArchive` | 封存狀態正規化、使用中班級、最後一個使用中班級保護。 |
| `server/routes/studentRoutes` / `classRoutes` | server-side admin 授權、輸入確認、tenant 內對象查詢、revision CAS。 |
| JSON / D1 repositories | 原子資料寫入、retained revision 清理、先前學生 audit target 去識別化、新操作 audit。 |

Node 與 Cloudflare Worker 都使用既有 `createApiHandler`，不複製 route security 或 business logic。沒有新增依賴、production DB migration 或 schema 變更。`ClassData.archivedAt` 是可選 JSON 欄位，沿用現有 class `record_json`。

## 權限與 API

保留既有 URLs / 匯出 response contracts，新增以下 POST operations：

```text
/api/v1/classes/:classId/students/:studentId/privacy/delete
/api/v1/classes/:classId/students/:studentId/privacy/anonymize
/api/v1/classes/:classId/privacy/archive
/api/v1/classes/:classId/privacy/reopen
```

所有新操作都需要已驗證 session、目前工作區 owner/admin membership、既有 Origin / CSRF 驗證，以及 `expectedRevision` 和精確 confirmation phrase。查詢／修改對象限於已授權的 workspace；teacher / viewer 的直接 API 請求也會被拒絕。

學生確認字串是 `DELETE STUDENT` / `ANONYMIZE STUDENT`；班級是 `ARCHIVE CLASS` / `REOPEN CLASS`。學生 UI 還須先勾選已了解影響。伺服器不把 UI 是否隱藏視為授權依據，也不把 confirmation 當成身分驗證因子。

教師仍可在已指派班級進行日常新增學生、積分、評語、學習等操作，但不能用一般 state PUT 移除／替換既有學生 ID，不能變更封存狀態或修改封存班級。既有 roster 刪除入口也只供 owner/admin 使用，避免繞過資料管理權限。舊的 admin 匯入、revision restore、state PUT 仍保留；有權限者持有的外部副本仍可能重新匯入，故不能聲稱所有副本均已永久抹除。

## 同步與 race safety

1. UI 捕捉正在檢查的 class / student ID 與名稱，不在操作期間跟隨 select 切換。
2. 先 `flushChanges`；未完成同步就不進行資料操作。
3. 使用固定 workspace ID 讀取最新 revision；若權限／工作區／掛載狀態改變則停止。
4. 學生名稱、班級名稱或封存狀態若與確認畫面不同，要求重新檢查；之後的並行寫入由 server CAS 拒絕。
5. 成功後 reload，讓既有 sync controller 重新讀取 revision。不能只替換 Zustand 資料卻留下 controller 的舊 base revision，否則可能 replay stale draft。
6. 匯出在 await 後再次確認工作區／權限，才產生瀏覽器下載。audit 在 server 產生檔案時記錄，即使瀏覽器最後下載失敗仍保留紀錄。

錯誤訊息不輸出學生資料／自由文字。檔名只使用用途與日期，不含學生姓名／ID。下載 Blob URL 會釋放；不新增 client persistence 或 vendor tracking。

## 刪除與匿名化的精確範圍

刪除移除學生、其 learning evidence、exam results、boss contribution / attack-count keys 與 teammate links。所有保留的 application revisions 都移除原 student ID 的 structured records，因此 revision restore 不會復原已清除的學生。

匿名化以新隨機 ID 與固定名稱替代身分，移除該學生的教學內容、評量結果與學生紀錄中的自由文字／未審核 extension fields。使用 allowlist 保留寵物數值、積分與 RP、勝敗、數值型安全／點數限制／每日領取／cooldown／penalty reversal 紀錄；相關 record IDs、隊伍與 boss keys 一致更新。既有 pet identifier / rarity / order 共用純 `petCatalog`，沒有改變 active gameplay 數值或規則。

這是**結構化去識別化，不是不可逆匿名性的保證**。保留的數值與時間仍可能被重新識別。其他學生評語、班級名稱／目標、考卷標題或任意手動文字中對此人的提及，不會用不可靠的字串替換自動清除；須由授權人員另行審查。

JSON repository 在 serialized mutation 中處理 current data、revision purge 與 audit；D1 使用同一 revision/write-token guarded batch 處理 blob、normalized projections、retained snapshots、audit target redaction 與新 audit。CAS 或 projection 失敗不能只清理 audit 卻未提交資料變更。

新 audit actions：`student.privacy.delete`、`student.privacy.anonymize`、`class.privacy.archive`、`class.privacy.reopen`。既有 student/workspace export 與 `privacy.student.purge` 保留。新 destructive audit 只記錄 actor、workspace、動作、revision／aggregate counts，不新增學生姓名、評語、成績或原 ID。

## 班級封存

封存不等於刪除／保留期限到期；保留班級資料，移出教學 class selector 與公開 presentation DTO。至少保留一個使用中班級；重複 archive/reopen 是 idempotent，不新增重複 revision / audit。

封存班級是唯讀快照，不執行自動寵物衰減；其 timed normalization 使用 `archivedAt`，不因未來載入而改變 penalty、boss recovery 或 pet life state。使用中班級仍使用原本的衰減／到期規則。teacher PUT 驗證原始快照或一次正規化後的相等輸入，並保留 server 的原始封存資料，不把正規化差異寫回。這避免封存資料的背景變化阻擋其他使用中班級同步，同時保持 raw API round-trip 相容性。

重新開啟後從一般 workspace clock 繼續，不補發封存期間的衰減；原有 wall-clock 到期與生命狀態規則則恢復使用目前時間。直接傳入封存班級的 presentation builder 也不會顯示學生、排行榜或 boss。

## 保存資訊與未完成的營運政策

- 每個 workspace 最多保留 25 個 revisions：是版本**數量**，不是天數。
- Live classes / students / audit 沒有自動 age-based expiry。
- 長期 localStorage PII cache 預設關閉；既有 unsynced drafts 仍可能存在分頁的 sessionStorage，成功同步／登出後清除。另行啟用 `VITE_ALLOW_LOCAL_PII_CACHE` 會產生長期副本。
- 下載／列印／報告、Cloudflare 備份／Time Travel、外部系統副本不會由這個 UI 自動刪除。
- 機構須另訂保存期限、請求人驗證、安全交付、例外保留、備份還原後重做刪除的程序，不能將此 UI 當成法律遵循證明。
- 部分 legacy normalization defaults 並非完全冪等（例如無效 gacha milestone 的 fallback）；本輪不改 active gameplay 行為，archive gate 同時接受原始快照或一次正規化的相等版本。整體 normalization 冪等性仍是後續 domain 技術債。
- Wrangler 對既有 Sentry optional integrations 仍有 Node built-in compatibility 警告；實際 Worker bundle 的 Miniflare runtime regression 保留，沒有為這次 UI 功能加入新的 compatibility flag。

## 驗證

Regression coverage 包含純資料去識別化、game safety history 不變、封存 idempotence / normalization、直接掛載的 fail-closed UI、server RBAC / tenant / CSRF / Origin / confirmation / CAS，以及 D1 成功清理與 rollback。

Playwright 測試工作區／單一學生下載、雙重確認、取消、刪除／匿名化、不影響其他學生、server bypass rejection、封存／復開、audit 與公開展示限制。axe 預設規則掃描新 panels / dialogs；keyboard 測試 focus containment、Escape 與 focus return，不停用規則來通過。

### 實際執行結果（2026-10-08）

改動前的 main baseline：lint、309 項單元／整合測試、build、Worker dry-run 通過；定向 data-safety / permissions E2E 8/8 通過。改動後新增 38 項單元／整合回歸、5 項 E2E 與 2 項 accessibility 案例。

| Command | 結果 |
| --- | --- |
| `npm run lint` | 通過。 |
| `npm test` | 347 項通過，包含全部 94 個 gameRules cases。 |
| `npm run test:privacy` | 32/32 通過，已包含於完整測試。 |
| `npm run test:e2e` | 46/46 通過；使用最終的後端／前端 source。 |
| `npm run test:a11y` | 16/16 通過；41 個不同掃描狀態無 confirmed violations。15 個 contrast incomplete 狀態仍需人工量測，詳見 accessibility backlog。 |
| `npm run build` | 通過；production assets 未混入 synthetic analytics hooks。 |
| `npm run check:worker` | 通過，僅 dry-run。 |
| `npm run check:worker:staging` | 通過，使用離線的 synthetic staging config，僅 dry-run。 |

Windows sandbox 的 temp atomic rename / Miniflare 啟動與 Wrangler log 寫入限制，已用既有獨立本機測試機制與核准的沙箱外重跑確認。沒有為測試降低 auth quota、CSRF、RBAC 或 axe rules。没有執行 production migration、部署或 GitHub push。

### 變更檔案範圍

- Workspace UI：`src/features/workspace/components/{DataGovernancePanel,WorkspaceDataPanel,StudentDataPanel,PrivacyInformationPanel}.tsx`、`hooks/useWorkspacePrivacyOperation.ts`、`model/privacyDownloads.ts`。
- Integration / UX guards：`src/components/DashboardView.tsx`、`src/services/backendApi.ts`、`src/features/settings/components/DashboardSettingsSection.tsx`、`src/features/students/components/StudentManagementSection.tsx`、`src/features/rewards/components/RewardsSection.tsx`、`src/features/teacher-console/components/TeacherClassContext.tsx`、`src/features/classroom/model/classroomPresentation.ts`。
- State / pure rules：`src/store/{types,useStore,utils,constants}.ts`、`src/domain/game/petCatalog.ts`、`shared/domain/{studentPrivacy,classArchive}.ts`。
- Backend：`server/api.ts`、`server/routes/{studentRoutes,classRoutes,workspaceRoutes}.ts`、`server/workspaceScope.ts`、`server/repository.ts`、`worker/repository.ts`。
- Regression tests：`tests/{studentPrivacy,classArchive,workspacePrivacyUi,server,d1-core}.test.ts`、`tests/e2e/{privacy-management,data-safety}.spec.ts`、`tests/accessibility/privacy.spec.ts`。
- Scripts / docs：`package.json`、`.gitignore`、`README.md`、本文件、`docs/privacy-data-governance.md`、`docs/accessibility-backlog.md`。
