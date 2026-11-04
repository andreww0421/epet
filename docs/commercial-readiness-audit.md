# ePet 商業化技術稽核

稽核日期：2026-10-18（Asia/Taipei）

目標：[andreww0421/epet](https://github.com/andreww0421/epet)，最新 `main`：[`2ee853da40616f03498195de354e5af6d440d8a4`](https://github.com/andreww0421/epet/commit/2ee853da40616f03498195de354e5af6d440d8a4)。

後續修復：H01／H02 已於 2026-10-19 完成本機修補與驗證；M01 已於 2026-10-21 完成草稿隔離修補；M02 已於 2026-10-22 完成有界輸入驗證修補；M03 與 H03 已於 2026-10-23 分別完成 Ownership 併發一致性及衝突恢復修補；H04 已於 2026-10-24 完成容量／重試與恢復閉環驗證。七項均標示 Closed（本機修復及驗證）、尚未部署，詳見各項修復證據及剩餘風險。其餘稽核內容及第 9 節測試結果保留 2026-10-18 的原始基線；這不代表其他上線阻礙已關閉或正式環境已更新。

2026-10-25 H05／V01：已補 PR functional CI、SHA pins、Ruleset 提案及管理員手冊，並建立正常／負向測試 PR；實際 main／Production 政策尚未套用，維持 **Open（部分修復，外部控制未完成）**。新讀取也確認 Dependency graph 設定缺口及 npm audit High，保留失敗門檻；不以 CI 檔案或一個成功 run 宣告保護已生效。

2026-10-27 最終驗收：PR #18 的依賴／CI 子任務 **Completed**，已合併 main `21aefe1`；PR 與 main 的 Functional CI 均 20/20 jobs success，PR Security 3/3 success。今日重跑完整 npm audit 為 0 vulnerabilities、安全 CI 測試 26/26；main 的 17 browser specs 共 72/72 通過。**H05／V01 整體仍為 Partially Completed／Open**：有效 main rules 仍 `[]`，production protection rules 仍 `[]`、admin bypass=true、branch policy=null。既有合併流程已自動部署成功是本輪新讀取的歷史執行證據，本輪沒有重新部署或變更正式資料。最終驗收、相容性、剩餘風險及操作／回復計畫見 H05 下方 2026-10-27 小節。

## 1. 判定與方法

**目前不建議公開商業 GA。** 已有完整的教師教學、會員、租戶隔離與資料治理底座，適合繼續改善既有產品；不需要重建會員、RBAC、staging 或全部無障礙元件。H01 衝突回應、H02 學生隱私身分範圍、H03 衝突恢復、H04 容量／重試恢復、M01 草稿隔離、M02 有界輸入驗證及 M03 Ownership 併發一致性已完成本機修復、尚未部署；仍須處理合併閘門等其餘項目，再完成發布與營運驗收。

原始稽核時，本機起始工作樹乾淨，分支為 `main`；GitHub branch API 回傳的 SHA 與本機 HEAD 完全一致，因此未切換分支、pull、reset 或修改產品程式。讀取了指定 README、Wrangler、`server/`、`worker/`、`src/`、三份既有稽核／計畫與全部四個 workflows，並交叉檢查 migrations、shared domain、測試與營運文件。採獨立安全基線、架構、前端與針對性安全複核；不是對每個 tracked file 每一行的完整證明。

狀態分為：

- **已確認**：現行程式／設定足以證實；若只有靜態資料流或併發分析，會註明，並不冒稱已動態重現。
- **潛在風險**：機制存在，但影響取決於資料規模、匯入內容、部署或產品定位。
- **需正式環境驗證**：repository 無法證明 Cloudflare、GitHub environment、供應商或營運流程實際狀態。

Critical 代表立即且嚴重的全面失陷；High 代表重要保密、資料完整性、核心可用性或上線治理阻礙；Medium 代表有前提的安全／可靠性問題或重要驗收缺口；Low 代表維護、文件及發布衛生。**P0／P1／P2 是交付順序，與漏洞嚴重度分開**：Medium 的資料清理缺陷也可能需要先修。營運 High 不等於已確認 High 漏洞。

未讀取正式 D1／真實師生資料、未驗證任何秘密值、未觸發 production migration、部署、寄信、push 或 PR。測試使用暫存副本與既有本機依賴；原始稽核階段的 repository 只新增本報告；後續 H01／H02／H03／M01／M02／M03 修補變更另列於各項證據。

## 2. 已落地功能：應保留與驗證，避免重複開發

| 領域 | 現行實作與主要證據 | 判讀 |
| --- | --- | --- |
| 前端結構 | React 19、TypeScript、Zustand 5；Teacher Console feature modules、lazy analytics/governance/game；`src/components/DashboardView.tsx:29,103`，`src/features/pets/hooks/usePetCardStore.ts:128` | Dashboard 已拆分，PetCard 已有 selectors；不是舊文件中的全部 UI monolith。 |
| 領域邏輯 | `src/domain/game/`、`shared/education.ts`、`shared/domain/`；學習證據與遊戲積分分離；包容性模式、日常教學、考試／報告、獎懲與補償撤銷 | 已有產品能力，不應重做為「新商業功能」。 |
| 展示隱私 | 獨立 presentation DTO／shell；`src/App.tsx:228`、`docs/classroom-presentation-boundary.md` | 展示畫面與教師資料邊界已有專門設計與回歸測試。 |
| API／平台 | `server/api.ts:36` 組合 middleware／routes；`worker/index.ts:81` 同站 assets + API；Node JSON adapter 與 Worker D1 adapter | 共用 API 與領域邏輯已有分層；platform adapter 仍需契約一致性。 |
| Authentication | PBKDF2 salted verifier、opaque token hash、七日絕對到期 session、登出撤銷、reset 單次／到期／撤銷 session、Email verification、邀請 | `server/auth.ts:178,456,727`；`server/middleware/authentication.ts:23`。登入憑證實際在 HttpOnly cookie。 |
| RBAC／CSRF | owner/admin/teacher/viewer、workspace membership、明確 class assignments，空 scope 拒絕；Origin + double-submit CSRF | `server/api.ts:45,88,104`、`server/middleware/authorization.ts:25`；公開 auth 路徑走 Origin／限流／bot gate，並非所有 auth 都走相同 CSRF gate。 |
| Rate limiting／bot | 持久 subject + client authentication limits；Worker 使用 CF IP、Node 使用 socket 並移除偽造 forwarding；Turnstile 驗 action／hostname | `server/middleware/rateLimit.ts:99`、`server/app.ts:108`、`shared/services/turnstile.ts:16`。不能報成「沒有 rate limit」。 |
| 同步／衝突 | 固定 workspace request、generation 隔離、串行 autosave、退避、草稿、401/403/409、丟失回應後比對恢復 | `src/hooks/useBackendSync.ts:139,177,215`；`src/App.tsx:186,199` 切換／登出先 flush。保護已有，恢復 UX 仍有缺陷。 |
| D1 | tenant keys、正規化讀取、blob fallback、checksum／修復、CAS + gated transactional dual-write、最近 25 revisions | `worker/repository.ts:400,813,892,991`；`worker/projectionStatements.ts:14`。normalized 不是已移除所有 blob／revision 副本。 |
| 資料治理 | admin 匯出／單生限縮匯出、學生刪除／去識別化、班級封存／復開／永久刪除、audit filter/cursor、revision restore、完整備份匯入影響確認 | `server/routes/studentRoutes.ts:38`、`classRoutes.ts`、`adminRoutes.ts:155,221`、`workspaceRoutes.ts:74`。有 UI/API；營運程序與碰撞身分缺口仍需處理。 |
| 發布 | production ledger-only check、獨立 manual expansion、同 concurrency；獨立 staging Worker/D1／STAGING_* guards／唯讀 smoke | `.github/workflows/deploy.yml:49`、`database-expand.yml:37`、`staging.yml:43`、`scripts/staging-policy.mjs:25`。不應再報「部署自動改 schema」或「沒有 staging」。 |
| 安全／可觀測性 | PR／排程 CodeQL、dependency review、npm audit、Dependabot；privacy-safe Sentry categorical relay／Worker reporting | `.github/workflows/security.yml:3`、`.github/dependabot.yml`、`worker/monitoringRelay.ts:58`。是否啟用 provider／警報仍待實證。 |
| 測試／a11y | rules、API、D1、privacy、imports、monitoring、analytics、Chromium E2E、axe／keyboard；既有 native ModalDialog | `package.json:15`、`tests/e2e/`、`tests/accessibility/`、`src/components/ModalDialog.tsx:21`。缺口是覆蓋及 release gate，而非從零建立測試。 |

普通 state 寫入已有 duplicate **class ID** guard（`server/workspaceScope.ts:24`）；備份匯入亦檢查 class 與班內 student ID 重複（`workspaceRoutes.ts:90`）。這些不等於跨班 student identity 與所有 ingestion paths 已正確。

## 3. Critical

**本次未確認 Critical 問題。** 不將尚未完成的正式營運驗收、僅有特定前提的草稿風險或授權 owner 的併發錯誤誇大為匿名全面失陷。

## 4. High

### H01 — 學習證據 API 的 409 回傳未限縮工作區（P0；已修復並通過本機驗證，尚未部署）

位置：`server/routes/learningRoutes.ts:27-41,63-72`；`server/middleware/errorResponse.ts:33-38`；`worker/repository.ts:820-826,991-996`；`server/api.ts:138-145`。

限班 teacher 可以對自己獲授權的班級發出合法 evidence POST。路由讀取完整 workspace，再以舊 revision 寫入；兩個請求重疊便可能讓其中一個 CAS 失敗。例外攜帶完整 current workspace，通用 serializer 原樣放進 409，揭露同工作區其他班的學生、評量與紀錄。攻擊者不需要另一位使用者配合。Node adapter 也會拋完整 current。

正常 `/state` GET／teacher PUT 已限縮成功及 conflict 回應（`workspaceRoutes.ts:111,169,193`），selected class／session／CSRF 亦有檢查；缺陷是 evidence 的例外路徑，**不是跨 workspace 或匿名讀取**。既有測試通過不能排除此未涵蓋併發路徑。

修正：generic conflict 預設只回 code／revision；只有帶明確授權 context 的 serializer 才能回 scoped snapshot。同步檢查 sibling routes，避免只補單一 catch。

驗收：以兩班合成資料、僅有 A 班權限的 teacher 對 A 班併發寫入，強制 pre-check 與 batch CAS 兩種失敗；Node／D1 的所有成功／409 body 均不得包含 B 班識別或內容；仍保持 revision 保護。

#### H01 修復紀錄（2026-10-19）

**Root cause：** class access 僅保護選定班級的操作；`learningRoutes` 仍讀取完整 workspace 並帶當時 revision 寫回。Node 在序列化 mutation queue 內檢查 revision（`server/repository.ts:343-350`），D1 在前置讀取與 SQL compare-and-swap 兩處拒絕舊版本（`worker/repository.ts:820-826,991-996`）。這些正確的拒絕會攜帶內部完整 `WorkspaceConflictError.current`（`server/contracts.ts:361`），但 `server/api.ts:145` 的共用 fallback 沒有 scope context，直接把整份資料轉成 HTTP JSON。修復的是錯誤序列化邊界，不改 repository 的完整 snapshot／CAS 契約。

| 修改檔案 | 程式差異與原因 |
| --- | --- |
| `server/middleware/errorResponse.ts:33-45` | 通用 409 只 allowlist `error`、`revision`、`updatedAt`；不回 `current`、`data` 或 extension fields，不使用 snapshot object spread。 |
| `server/routes/workspaceRoutes.ts:149-167` | 已確認 admin membership 的 state PUT 明確攔截 repository conflict，保留與既有前置檢查相同的 full snapshot；teacher 的前置／CAS conflict 繼續經 `scopeStoredWorkspace` 限縮。保留 autosave／lost-response recovery 需要的 `/state` 契約。 |
| `server/routes/classRoutes.ts:46-61` | admin-only 班級生命週期操作也明確攔截 CAS conflict，保留原本已受權限保護且有測試的 snapshot 回應；teacher 仍在讀取資料前被拒絕。 |
| `tests/revisionConflictSecurity.test.ts` | 新增 14 個案例，以真實 JSON／Miniflare D1、AuthService invitation／membership／class assignment、session cookie／CSRF 驗證 A 班教師；B 班有獨立學生、73.125 分成績、評語及學習證據標記。 |
| `tests/backendApiMonitoring.test.ts:35-45` | metadata-only 409 應為 `BackendApiError(409, REVISION_CONFLICT)`；explicit snapshot 409 仍為 `BackendRevisionConflict`，不能把只有 metadata 的物件偽裝成 `current` snapshot。 |
| `tests/classLifecycle.test.ts` | 強化未提供 baseRevision 的 owner state CAS-loss 案例，確認仍回獲授權的完整 winning snapshot。 |
| `package.json` | 增加 `npm run test:revision-security` 並納入 `npm test`／`npm run verify`，避免 regression 只存在於未執行的測試檔。沒有 dependency／lockfile 變更。 |

`learningRoutes.ts`、`server/api.ts`、Node／D1 repositories 已追蹤但不需改動：讓未處理的 evidence conflict 自然進入安全 fallback，可同時覆蓋兩個 adapter 及其他未明確 opt-in snapshot 的路徑。Origin、CSRF、RBAC、workspace membership、class scope、revision 檢查與 SQL projection gates 均未放寬。

| 情境 | 修復前 | 修復後 |
| --- | --- | --- |
| A 班 teacher 正常新增 evidence | `201 {record, revision}` | 相同契約，僅 A 班紀錄。 |
| Evidence 並行／前置 revision 失敗／D1 CAS 失敗 | `409 {error, current: {revision, updatedAt, data: A+B}}`，洩漏 B 班 | `409 {error: 'REVISION_CONFLICT', revision, updatedAt}`；無 snapshot。 |
| Teacher `/state` conflict | 只含授權班級的 `current` | 維持只含 A 班的 snapshot，包含真正 repository/CAS conflict。 |
| Admin/owner `/state`、admin 班級生命週期 conflict | 已授權 full snapshot | 明確 route-local 保留；不得由通用 fallback 默默發送。 |
| Student privacy／workspace import／revision restore 的未攔截 conflict | 通用 full snapshot（路由原已要求 admin） | 改為 metadata-only；相關 UI 依 `REVISION_CONFLICT` 顯示重新載入提示，不依賴 snapshot。 |

**修復前證據：** 在未修補來源的隔離副本執行同一組 14 個 regression，8 個正常／授權控制案例通過，6 個 generic/evidence conflict 案例因回應含 B 班合成標記失敗。包括 Node／D1 並行、兩者 repository 前置版本拒絕，以及 D1 真正 SQL CAS loser，並非手工拋出假錯誤。

**修復後驗證：**

| 命令 | 結果 |
| --- | --- |
| `npm run lint` | 通過，TypeScript noEmit。 |
| `npm run test:revision-security` | 14/14 通過，無 skip。 |
| `node --import tsx --test tests/classArchive.test.ts tests/classLifecycle.test.ts tests/backendApiMonitoring.test.ts` | 46/46 通過。 |
| `npm run test:auth` | 11/11 通過。 |
| `npm run test:server` | 33/33 通過。 |
| `npm run test:d1-core` | 23/23 通過。 |
| `npm run test:e2e -- tests/e2e/data-safety.spec.ts tests/e2e/permissions.spec.ts tests/e2e/class-and-teacher.spec.ts` | 10/10 通過，含教師操作、workspace switch、同步 conflict、角色／CSRF／Origin。 |
| `npm run verify` | 通過，exit 0；7 個 migrations 檢查、TypeScript、463/463（94 rules + 369 Node cases）、production build／analytics boundary、Worker dry-run 均通過，無 fail/skip。既有 Sentry optional Node built-in 警告未改動。 |

上述測試在 Windows／Node 24.13.0 的隔離副本執行，重用現有依賴；最終確認七個程式／測試／package 檔案與工作樹內容一致，`git diff --check` 通過。Raw red／green／相容性／auth／server／D1／E2E／verify logs 由安全工具保存為本機 standalone `artifacts/h01-fix/` 驗證證據，沒有更動先前已封存的原始稽核 scan。

新測試驗證正常 evidence 的成功回應及所有 teacher 錯誤回應不含 B 班／其他 workspace 標記，另一班資料不變；競爭寫入恰一成功，loser 沒有 evidence、額外 revision、audit 或 D1 projection 副作用。另涵蓋直接 B 班存取、跨 workspace、viewer、空 class assignment、錯誤 student、缺 session／CSRF、跨站 Origin。D1 CAS 案例在 repository 內部讀取完成後用獨立 D1 adapter 提交競爭版本，再讓真實條件式 SQL UPDATE 失敗。獨立 read-only patch 複核未發現可重現的 bypass／regression。

**範圍與剩餘風險：** 僅本機隔離 JSON／Miniflare D1 與合成 browser 帳號，沒有正式 D1、真實學生、production deploy／migration。正式環境仍須經既有發布閘門更新後才能視為完成部署；其他 H/M 項目不在此修復範圍。第三方若依賴先前通用 409 的 `current`，須改用安全 metadata 或重新讀取自身有權限的 state；第一方同步與 admin lifecycle snapshot 契約已有相容性測試。

### H02 — 學生隱私操作的班級身分範圍錯配（P0；Closed：本機修復與持久化驗證完成，尚未部署）

原始問題位置：`server/routes/studentRoutes.ts:58-77`、`shared/domain/studentPrivacy.ts`、`server/repository.ts`、`worker/repository.ts`。2026-10-19 修復僅使用隔離 JSON／Miniflare D1 與合成資料；正式資料中的碰撞數量及過去是否受影響未查詢，不等於正式環境已修復。

**Root Cause Analysis：** API 查詢已使用 classId + studentId，但刪除／匿名化 helper 隨後只接收裸 studentId，會同時處理另一班同 ID 學生。Repository 又以 workspace 全域 student ID 集合計算差集，因 Bob/100 仍存在而漏判 Alice/100 已被移除，造成 retained revisions／audit 未清理。D1 現有主鍵本來就是 `(workspace_id, class_id, student_id)`，而 normalizer 保留輸入 ID，import 僅拒絕班內重複，因此合法模型與清理邏輯不一致。

**資料模型與修補差異：**

| 路徑／檔案 | 修正與相容性 |
| --- | --- |
| `shared/domain/studentPrivacy.ts` | 新增 typed `StudentIdentity {classId, studentId}`，workspace 由 repository 呼叫參數隔離。`findPermanentlyDeletedStudents` 以 JSON tuple keys 作差集；purge／anonymize 僅進入指定班級，涵蓋 teammate/team、evidence、exam results、boss contributions／attack counts，歷史 orphan references 亦清理。其他班級原物件及可選欄位形狀保留。 |
| `server/routes/studentRoutes.ts` | 將已驗證班級與學生一起傳入 helper。URL、角色、確認字串、CSRF、expectedRevision 與正常匯出契約不變。 |
| `server/repository.ts`、`worker/repository.ts` | 所有 put 路徑（privacy API、state、import、restore、class deletion）均以 tuple 偵測刪除及清理所有 retained snapshots。計數以學生 tuple 數為準，同 ID 的兩位學生同時刪除計 2。Node 仍在成功原子替換檔案後發布記憶體；D1 snapshot／audit／projection 清理仍受同批 CAS + write token gate 約束。 |
| 同上兩個 adapters、`worker/projectionStatements.ts` | 有 `metadata.classId` 的 student audit target 按精確 tuple 清理；export 延遲 append 時在原子寫入內檢查該 tuple 仍存在，防止刪除後重新新增 Alice 的 target。事件的 actor／action／time 保留。 |
| `server/routes/adminRoutes.ts` | restore 改為先讀 current revision、再讀 source snapshot，以先前 revision CAS 寫入。刪除若穿插其間，回 409，不能把已載入的舊 Alice snapshot 用較新 revision 寫回。 |
| `worker/repository.ts` | normalized loader 的 class/student 及 class/exam map keys 改用 JSON tuple，避免 `('a:b','c')` 與 `('a','b:c')` 冒號拼接碰撞而串接他班個人紀錄／成績。 |
| `tests/studentIdentityPrivacy.test.ts`、`tests/studentPrivacy.test.ts` | 新增跨 adapter API／持久化回歸與 domain 邊界測試。既有 privacy／archive／D1／boundary tests 更新 helper 呼叫身分；`package.json` 將新測試納入 `test:privacy`／`verify`。 |

**Migration 需求：無 schema／ID migration。** `migrations/0003_core_entities.sql:30-44` 已使用三欄主鍵；其餘學生關聯 projection 亦含 workspace/class。`src/store/utils.ts`、`workspaceRoutes.ts` 的現有 import／normalization 保留同 ID 的 Alice 與 Bob，沒有新增全 workspace 唯一限制、重編 ID、dedup、silent-drop、刪除或合併既有碰撞資料。未改寫既有 migration，也沒有需要執行的 Expand／Migrate／Contract；若未來改身分契約，須另行提出該計畫，不能把本修補當成授權 migration。

既有碰撞的處理政策：以各自完整 tuple 保留，先做唯讀盤點與人工確認，不依裸 ID 推斷誰該刪。舊 audit 若缺 classId，僅在 current、next 及 retained histories 均沒有本次刪除範圍以外的同 ID 身分時，沿用清除 target 的相容行為；有歧義則保留，不能猜成 Alice 而刪 Bob。新 export audit 本來就有 classId。歷史歧義事件不會被本次修補自動歸屬或重寫。

| 情境 | 修復前 | 修復後驗收 |
| --- | --- | --- |
| 刪除／匿名化 A/Alice/100 | B/Bob/100 也可能被清除或匿名化 | 僅處理 Alice；Bob 個資、遊戲值、評語、學習證據、成績、boss／audit target 完全保留。 |
| state／import 僅移除 A/100 | 因 B/100 存在，歷史差集漏判 | 所有保留 revision 只清 Alice；匯出 Bob、重新載入 JSON／D1 均一致。 |
| 歷史 restore 與隱私刪除交錯 | 可能以刪除後新 revision 寫回手上的舊 Alice | source read 前綁定 revision；CAS 拒絕競爭 restore，無復活、額外 restore audit 或 partial purge。 |
| 班級 archive／reopen／delete、完整 backup import | 不應以全域去重破壞資料 | 保留跨班碰撞；刪 A 班後 B 班與其他 workspace 不變。 |
| Node 落盤失敗／D1 CAS loser／D1 projection 失敗 | 必須維持交易安全 | workspace、history、audit、projection 均保留 winning／原狀，失敗操作無部分清理。 |

**驗證證據（2026-10-19）：** 統一使用 Alice／Bob 同 ID = `100`、各自獨立成績、評語、反思、積分／獎懲／boss 紀錄及 learning evidence。修復前副本執行同一最終 22 案例為 7 pass／15 fail（正常授權控制與交易 rollback 保留）；修復後全部 22 pass，直接重現並排除誤刪、漏清歷史、restore／audit 競態及 normalized tuple join 問題。

| 命令／閘門 | 結果 |
| --- | --- |
| `node --import tsx --test tests/studentIdentityPrivacy.test.ts` | 22/22 通過，無 skip；Node／D1 delete、anonymize、Bob export、所有保留 revisions、受控 restore、重新載入、state／import、class archive／reopen／delete、跨 workspace、RBAC／CSRF、stale revision、兩 tuple 計數、延遲 audit append。 |
| 同上持久化負向案例 | Node 真正 atomic rename 失敗：原磁碟 bytes／記憶體／history／audit 不變；D1 真 SQL CAS loser、projection 失敗：winning blob、gate、normalized records、history、A/B scoped audit 均不被 loser 清理。D1 採 normalized read 並要求 reconciliation `verified`，避免 blob fallback 隱藏錯誤；另逐筆檢查 raw workspace blob 及 revisions。 |
| `npm run test:privacy` | 139/139 通過，無 fail／skip，包含新 regression、domain orphan／tuple／legacy audit 案例與既有班級生命週期、UI 邊界及歷史相容性。 |
| `npm run test:d1-core` | 23/23 通過，無 fail／skip；既有 migration、tenant、projection、revision、auth、CAS、privacy／class deletion 交易保護均保留。 |
| `npm run lint` | 通過，包含最終新測試檔。 |
| `npm run verify` | exit 0；7 個 checksum-locked migrations、TypeScript、488/488（94 rules + 394 Node cases）、production build／analytics boundary、Worker dry-run 全部通過。既有 Sentry optional Node built-in 警告保留；dry-run 未部署或存取正式 D1。 |
| 獨立 read-only 修補複核、`git diff --check` | 未發現具體可行動 bypass／regression；diff check 通過。最終確認隔離副本 18 個異動來源／測試／package 檔案與工作樹 SHA-256 完全一致（含先前 H01 變更）。 |

所有測試使用 Windows／Node 24.13.0 的安全工具隔離副本及既有依賴。新增 22 個整合 regression 及 3 個 domain cases，已納入 `verify`；沒有更動依賴／lockfile、schema、normalizer、import 的 ID 契約或既有 CSRF／RBAC。Raw red／green／privacy／D1／TypeScript／verify logs 與獨立複核記錄保存於本機 standalone `artifacts/h02-fix/`，沒有改寫已封存的原始安全 scan。H02 僅在上述 current／history／audit／projection／restore／reload 路徑全部通過後標示 **Closed（本機）**。

**剩餘風險與後續工作：** 本機修補沒有更新 production。發布前依既有 staging／release gates 驗收，正式資料僅授權人員可唯讀盤點。無班級的歧義舊 audit 與修補前已受損／漏清的歷史資料須另行人工歸屬及受控修復；不能無證據自動刪 Bob 或推定過去刪除意圖。任意自由文字提及學生、已下載備份及外部副本不是本次結構化身分清理的涵蓋範圍；授權 admin 明確匯入外部舊備份仍是完整資料替換，不能視為防復活 tombstone。受控 retained revision restore 的防復活已納入測試。本次不新增 tombstone 或永久封鎖合法 ID 再利用。

### H03 — 真實 revision conflict 缺少可完成的恢復流程（P0；Closed：本機修復及驗證，尚未部署）

原始位置（修補前）：`src/hooks/useBackendSync.ts:256-280,333-366`；`src/App.tsx:186-214,454-459`；`tests/e2e/data-safety.spec.ts:224`。修補後位置及驗證見下方。

原始問題：409 正確保存舊 baseRevision 草稿並停止覆寫，但「重新載入最新版本」只執行 reload；啟動又載入相同衝突草稿並 return conflict。當時沒有丟棄／採用遠端／合併入口，登出及切換還被 flush 失敗阻擋；原 E2E 僅驗證保留草稿與不覆寫。現在已加入明確確認的採用遠端及保留導覽，並以真實 409 E2E 驗證完整恢復閉環；自動合併不在本次範圍。

修正：保留受控備份後，提供明確確認的「丟棄本地、採用遠端」，同時清 memory／storage／queue 並載入新 revision；後續可逐筆重套 command。teacher 的恢復不得因此取得完整工作區匯出。

驗收：兩 tab → 真實 409 → 保留草稿 → 明確採用遠端 → 新合法變更保存成功；重載／登出／切換可完成，另一位使用者的變更保留。

### H03 修復與驗證（2026-10-23；Closed：本機修復及驗證，尚未部署）

**Root Cause：** Autosave 正確保留舊 `baseRevision` 並拒絕覆寫，但 App 的重新載入只做 document reload；新 hook mount 又恢復同一份 pending draft，再進入 conflict。live conflict 仍有 Store listener，啟動時恢復的 conflict 則提前 return、沒有 listener，所以只清 storage 或只換畫面均不足以恢復寫入。原本導覽必須 flush 成功，409 因而永久阻擋登出與工作區切換。

| 程式位置 | 修正與行為 |
| --- | --- |
| `src/hooks/useBackendSync.ts:348,356` | 新增 `preserveConflictDraft` 與 `adoptRemote`。保留路徑只接受確定衝突、未到期、成功寫入 storage 的原 namespace；採用路徑停止 timers、等待舊 save、fresh GET 驗 user／workspace／role／class scope，成功前保留草稿。 |
| `src/hooks/useBackendSync.ts:308,327,376` | 明確解除 listener、清 pending／in-flight/request ID／retry，重設 Store 學生暫態與 generation、採用 remote revision，再建立 listener。live／recovered conflict 共用同一條 hydration 流程，舊下載的成功或失敗都不能污染已採用的新 generation。 |
| `src/hooks/useBackendSync.ts:253,256,449` | 確定 409 後停止自動／flush 重送；已結束的失敗 attempt 不再誤標為 uncertain in-flight。正常 lost-response idempotency 與一般離線 retry 保留。 |
| `src/services/workspaceDrafts.ts:46,89` | storage save／clear 回報結果；清除失敗時保留最新 memory fallback 與磁碟原值，採用流程不假裝成功。不掃描／清理其他身分或 scope 草稿，v2 envelope／TTL 不變。 |
| `src/App.tsx:192,219,231,429,511` | 繁中恢復選項與明確 native confirm：保留草稿登出／切換、取消、採用雲端前確認丟棄。失敗說明草稿仍保留；一般 offline／in-flight flush 保護不放寬。 |
| `tests/workspaceDrafts.test.ts`、`tests/e2e/conflict-recovery.spec.ts`、`tests/e2e/data-safety.spec.ts` | 新增 storage clear 結果／namespace regression，以及真正雙頁面 409 的完整恢復、導覽、斷線、storage 失敗、Teacher 隔離與恢復前降權 E2E；原資料安全測試只更新衝突文案。 |
| `docs/workspace-conflict-recovery.md`、README／privacy 文件 | 使用者恢復步驟、24h／分頁保存限制、角色匯出、失敗策略與工程維護契約。 |

`backendApi.ts` 已追蹤但不需修改：既有 `loadBackendState(workspaceId, expectedUserId)` 使用 `cache: no-store` 與 expected principal，fresh access 仍由伺服器產生。採用雲端只 GET，不 PUT／不改 Revision；後續新修改仍使用正常 CAS，所以採用後又有另一筆合法更新時會重新 409，不能強制覆寫。Teacher 仍無完整草稿下載，下載前 server scope 重驗保留；沒有 AppData／Schema／dependency 變更，也沒有修改 CSRF、RBAC、Tenant Isolation。

**驗證環境：** Windows／Node `v24.13.0`、managed 暫存副本、虛構師生與本機 JSON／D1。修補前同一新增 E2E 已透過 Tab A 真 UI commit、Tab B 舊 Revision PUT 得到真實 409，並因缺少採用操作失敗；沒有偽造 conflict response。各頁面使用獨立 browser context 保持可控的舊 Revision，避免 focus auth refresh 在建立 race 時更新 base；測試仍使用相同帳號／工作區及真 API。

| 命令／驗證 | 結果與證據範圍 |
| --- | --- |
| `npm run lint` | TypeScript 通過；最終 verify 另以凍結 runtime 再執行。 |
| `npm run test:draft-security` | **44/44 通過**（32 draft unit + 12 真 Auth／API）。新增 namespace clear、storage 移除失敗保留最新 fallback 的 regression，保留所有既有 binding／TTL／role／class scope／CSRF／revision 斷言。 |
| `npm run test:e2e -- tests/e2e/conflict-recovery.spec.ts` | **8/8 通過**：真實雙頁面 409、下載與取消丟棄、重整保留、確認採用後無 PUT／舊草稿不復活、新修改用新 baseRevision 成功保存；保留登出／重新登入、工作區往返、採用時斷線、storage 刪除失敗、Teacher A/B 隔離、恢復前 Admin 降為限班 Teacher，以及舊下載延遲失敗。 |
| `npm run test:e2e -- tests/e2e/data-safety.spec.ts tests/e2e/draft-recovery.spec.ts` | **16/16 通過**：原有 data safety 6 與 M01 draft recovery 10；包含儲存中切換、延遲載入、正常登出與恢復、離線保留、跨 principal／降權隔離、TTL／legacy v1、stale cookie／下載及已提交 in-flight write 的 focus refresh。 |
| `npm run test:e2e -- tests/e2e/permissions.spec.ts` | **2/2 通過**，獨立測試伺服器驗證 viewer／teacher／admin／owner 能力及正常 ownership、Origin／CSRF 契約。與上述 8 + 16 合計，最終來源 **26/26 E2E 通過**。 |
| `npm run verify` | **exit 0；583 項通過（94 rules + 489 Node cases），0 fail／cancelled／skip／todo**。包含 draft/access 44、H01／H02／M02／M03 回歸、D1 core 23、Import／API／RBAC／privacy、7 份 migration checksum／分類檢查、TypeScript、production build／analytics boundary 與 Worker dry-run。既有 optional Sentry `node:*` bundling warnings 保留；未改 flags、未部署。 |

**一次獨立複核：** fresh read-only reviewer 找到「舊下載的延遲失敗仍能把恢復成功的頁面改回 offline／session invalid」路徑。成功結果原有 generation guard，但 catch 未檢查下載生命週期；本任務用 hold-download → 採用成功 → 舊 GET abort 的真實 E2E 重現，修補前失去 connected 狀態，補上相同 guard 後已在最終 8/8 中通過。複核沒有執行測試，也未找到其他具體 H03 bypass；未進行第二輪複核。最終 runtime 驗證由本任務執行。

**測試限制與中途結果：** 首次沙箱執行被合成 JSON 資料庫 atomic rename 的 EPERM 阻擋，沒有完成測試，不列為關閉證據；後續在核准本機環境執行。中途 regression 找到已拒絕 409 被再次寫成 uncertain in-flight，已修正標記，未放寬保留資料的斷言。測試文件間刻意保留的 memory fallback 與單工作區不顯示 selector 的 fixture 問題也已修正。合併資料／草稿／權限 suites 時，17 項通過、最後登入命中既有 Rate Limit；最終分批啟動獨立合成測試伺服器，不調高 production／test 限流、不改驗證強度。

最終副本與工作樹的 **48 個變更 source/test/package/docs 檔 SHA-256 相符**（本稽核報告除外；最後文件更新已同步再比對），`git diff --check` 通過；最終 production assets 未含 E2E Store／DOM／Storage 觀測 globals。runtime 來源凍結後執行最終 26 項 E2E 與完整 verify，後續僅改文件與證據。

補充證據存於 standalone `artifacts/h03-fix/`：`red-e2e.log`、`late-download-red.log`、`recovery-e2e.log`、`draft-security.log`、`lint.log`、`data-draft-e2e.log`、`permissions-e2e.log`、`combined-intermediate-e2e.log`、`verify.log`、`independent-review.md`、`final-checks.log`、`verification-summary.md`。`combined-intermediate-e2e.log` 是觸及登入限流的中途結果，不作結案通過證據；`recovery-e2e.log` 才是最終 8/8。最終 `verify.log` SHA-256：`b7d00e86eb48e402b57bf8694c7a9dc18c4043adae7c9f822b32dfc67b6571f6`。H03 標示 **Closed（本機修復及驗證，尚未部署）**，原封存 scan 保持不變。

**有效範圍／剩餘風險：** 沒有自動合併；選擇丟棄後不保留可回復的舊本機副本，須由使用者先依權限備份或取消。sessionStorage／24h TTL 不是跨裝置或關閉分頁後的備份；儲存受限時不宣稱可安全離開。H03 結案時尚待處理的永久容量／驗證錯誤，已在後續 H04 另行修復，詳見下節。正式環境未部署、未讀寫正式資料；本機合成測試不能代替正式跨地區延遲與容量驗收。

### H04 — 容量／驗證永久錯誤被當離線無限重試（P0；Closed：本機修復及驗證，尚未部署）

原始位置：`worker/repository.ts:73,374-380`；`src/services/backendApi.ts:212-218`；`src/hooks/useBackendSync.ts:18-25,151-175,256-280`（2026-10-18 基線）。

原始行為：D1 有 900 KiB snapshot 上限，但 400／413 沒有 terminal 狀態，會持續送相同 snapshot（退避最後停在每 30 秒），並暫停編輯／阻擋 flush。一般新增紀錄達上限後，沒有產品內可完成的清理／採用遠端恢復路徑。HTTP 2 MiB body cap 不等於 D1 可儲存容量。

**Root Cause：** API 原本僅保留 status／code，沒有讀取 Retry-After 或容量契約；Autosave 除 401／403／409 外，一律當成離線並繼續排程，退避有上限但次數無上限。草稿沒有保存失敗分類、預算與下次允許時間，重整會再次送出相同無效內容；flush 失敗又阻擋登出及切換。原 D1 900 KiB 防護正確，缺陷在錯誤到 UI／queue／storage 的完整生命週期。

**修補與契約（2026-10-24）：**

| 檔案／邊界 | 修改與保留條件 |
| --- | --- |
| `src/services/backendApi.ts`、新增 `src/services/syncRetryPolicy.ts` | 安全解析 Retry-After 秒數／日期；400／422 validation、413 capacity、其他不可恢復 HTTP 永久暫停。網路／408／425／429／500／502／503／504／520–524 最多 5 次自動重試，退避 1／2／5／10／30 秒；429 取較長 server delay。無效、超長 timer 或超出 TTL 不變成提早重送。 |
| `src/services/workspaceDrafts.ts`、`src/hooks/useBackendSync.ts` | v2 草稿新增 optional `syncState`，保存 budget／deadline／pause；舊 v2 相容，不重寫 AppData。400／413 在 timer、flush、重整、相同 scope 再登入均不自動重送；新 session／exact scope／TTL 及 Revision／idempotency 保護保留。已提交但遺失回應的舊寫入只更新 Base Revision，不清掉較新草稿的 Retry-After。 |
| `src/App.tsx` | 繁體中文錯誤／容量／等待時間、受控保留及明確確認採用遠端；暫停草稿可經 storage 成功留存後登出／切換。只有 owner／admin 可重新驗證權限後下載完整草稿；teacher 不出現完整下載入口。採用時清除 Memory／Storage／Queue／Timer／舊 Request ID／Base Revision，再恢復 Autosave。 |
| `shared/domain/repositoryPolicy.ts`、`worker/repository.ts`、`server/contracts.ts`、`server/middleware/errorResponse.ts`、`server/http/body.ts` | 共用原本 900 KiB D1 常數與 UTF-8 計算；413 僅新增經驗證的公開 `limitBytes`／`limitKind`。不回傳合併後實際大小、snapshot、其他班級或內部錯誤；前端大小只算當前授權草稿。2 MiB／16 KiB body cap 與 Node JSON 原儲存契約不變，沒有 Schema Migration。 |
| `src/features/workspace/hooks/useWorkspacePrivacyOperation.ts`、`src/features/workspace/components/DataGovernancePanel.tsx` | Import／Restore 400／413 清楚說明沒有取代資料，不自動重試；保留既有權限、確認、flush、schema、CAS、歷史及 privacy 控制。管理員可備份後明確整理及匯入較小資料；不會自動刪除學生或裁切紀錄以避開限制。 |
| 新增 `tests/workspaceCapacity.test.ts`、`tests/syncRetryPolicy.test.ts`、`tests/e2e-capacity/capacity-recovery.spec.ts`、`tests/e2e/support/d1-server.ts`、`playwright.capacity.config.ts` | 合成 Node／D1／API 容量與 partial-write 斷言、錯誤分類／deadline／TTL、真實 D1 413 與 browser recovery；專用測試伺服器固定本機，不加入 production bundle 或修改正式會員。`package.json` 將 48 項 unit/API regressions 納入 verify，另提供 `test:e2e:capacity`。 |

**修復前後：** 原本相同 413 每 30 秒持續重送且無法離開；現在首次 413 即暫停，草稿與錯誤狀態跨重整留存，可安全保留後離開或確認採用遠端。原本 transient 無限重試；現在原請求 + 最多 5 次後暫停，手動續試仍遵守 server deadline。合法清理或採用遠端後的新修改可保存，未強制覆寫其他使用者資料。

操作、容量及相容性完整文件：[工作區容量與同步重試](workspace-capacity-and-retry.md)。

**驗證證據：**

| 命令／範圍 | 結果 |
| --- | --- |
| `npx tsx --test tests/workspaceCapacity.test.ts` | **26/26 通過**：Node JSON／真實 Miniflare D1／API，正常、近上限、剛好 900 KiB、超限；限班 teacher／owner、Import／歷史 Restore、body limit、snapshot／revision／projection／audit 原子拒絕及清理後保存。Node 仍接受超過 D1 專屬 cap 的合法資料，沒有藉修補收緊 Node 儲存相容性。 |
| `npx tsx --test tests/syncRetryPolicy.test.ts tests/workspaceDrafts.test.ts` | **54/54 通過**：新增 policy／API 22 + 既有 draft 32，涵蓋終止／暫時 status、5 次預算、Retry-After 日期／秒數／超長 deadline、TTL、v2 相容、metadata allowlist 及 telemetry 隱私。 |
| `npm run test:e2e:capacity` | **9/9 通過**：真實 D1 413（非 mock 413）、跨重整停止、保留切換／登出、明確清理且 220 筆歷史完整、採用後保存；400、429 等待、lost committed response + queued draft + 429 + reload、network／500 原請求 + 5 次後暫停／手動恢復、Class A teacher 無 Class B／完整草稿下載。 |
| `npm run test:e2e -- tests/e2e/conflict-recovery.spec.ts` | **8/8 通過**：真實雙頁面 409、明確丟棄／保留、降權／下載／storage 失敗與恢復 Autosave，H03 保護維持。 |
| `npm run test:e2e -- tests/e2e/data-safety.spec.ts tests/e2e/draft-recovery.spec.ts` | **16/16 通過**：in-flight／延遲載入／離線、登出／workspace 往返、跨 principal／降權／TTL／legacy 草稿、下載授權與已提交寫入的 focus refresh。 |
| `npm run test:e2e -- tests/e2e/permissions.spec.ts` | **2/2 通過**：viewer／teacher／admin／owner、CSRF／Origin；分批獨立 server，既有限流不變。加上前述容量 9 + 衝突 8 + data/draft 16，最終來源 **35/35 E2E 通過**。 |
| `npm run verify` | **exit 0；631 項通過（94 rules + 537 Node cases），0 fail／cancelled／skip／todo**。含 sync reliability 48、D1 core 23、Import 22、draft/access 44、H01／H02／M02／M03、RBAC／privacy／observability、7 份 migration checksum／分類檢查、TypeScript、production build／analytics boundary 及 Worker dry-run。既有 optional Sentry `node:*` bundling warnings 保留，未改 compatibility flags；dry-run 並非部署或正式 runtime 驗收。 |

**一次獨立複核：** fresh read-only reviewer 透過來源／基線差異與實際 hook 的獨立 lifecycle harness，找到 uncertain committed write 的 rebase 清掉較新草稿重試 deadline。瀏覽器回歸在修補前確認 429 後重整約 1.5 秒即送出下一個 PUT，而 server 指定等待 30 秒；保留整個 `syncState` 後，最終 9/9 驗證自動及手動均不提前、時間到才以新 Base Revision 寫入。複核沒有修改來源、沒有執行廣泛 suite，未找到其他具體 H04 regression；沒有第二輪 review。

**中途結果與限制：** 初版 TypeScript 的 limitKind inference／Playwright config typing 已修正。測試曾遇到本機 D1 GET 逾時及短暫 toast 斷言逾時；最終使用實際 200 寫入與持久資料斷言，不放寬既有 6 秒 API timeout。另將登出測試改用獨立合法 browser session，避免撤銷驗證用 session；teacher 恢復後只導覽有權限的頁面。未調高限流、容量、測試 retry 或改弱 scope／資料完整性斷言；中途失敗紀錄保留，不作結案通過證據。

測試在 Windows／Node `v24.13.0`／npm `11.6.2` 的 managed 暫存副本執行，所有帳號／學生／本機 D1 均為合成資料。最終副本與工作樹 **59 個變更 source/test/package/docs 檔 SHA-256 相符**（本稽核報告除外）；`git diff --check` 通過，production assets 不含 E2E Store／DOM／Storage／analytics 觀測介面。runtime 來源凍結後執行最終 35 項 E2E 與完整 verify；後續僅補文件及證據。

補充證據存於 standalone `artifacts/h04-fix/`：`red-e2e.log`、`retry-after-red.log`、`retry-after-red-observation.md`、`capacity-api.log`、`retry-policy-draft.log`、`capacity-e2e.log`、`conflict-e2e.log`、`data-draft-e2e.log`、`permissions-e2e.log`、`lint.log`、`verify.log`、`independent-review.md`、`final-checks.log`、`verification-summary.md`，以及三份標示 intermediate 的失敗紀錄。最終 `verify.log` SHA-256：`1eca8557188a995e97a52c5c230669a841f9b6eb71627306021e78793a285d44`；`capacity-e2e.log` SHA-256：`eec3486a5b880fd9954e448d9a641a601bc175e419ed6ce3e8e7b1008c3efa14`。H04 標示 **Closed（本機修復及驗證，尚未部署）**，沒有改寫原封存 scan。

**剩餘風險與後續：** full snapshot 仍受原 900 KiB cap 限制，需另依 M07 設計增量儲存及容量預警；本修補提供可完成的保留／採用／授權清理，不擴容、不自動合併。sessionStorage／24h TTL／瀏覽器配額並非持久備份；權限縮減後舊完整草稿仍隔離，不因容量恢復放寬下載。正式 Worker CPU、延遲、實際超限比例與發布後 smoke 尚未驗證，未部署或使用正式資料。前置調查另指出既有 Restore UI `await flushChanges()` 後使用 active workspace 的 target timing 風險（`DataGovernancePanel.tsx:482-496`、`backendApi.ts:545-554`），應獨立補 target／mount guard 及導航回歸；H04 沒有改動該呼叫契約，永久失敗 flush 仍拒絕 Restore，server 容量／Revision／歷史原子性已驗證，不能據此宣稱所有 Restore UI 併發均已證明安全。

### H05／V01 — Main Review／Required Checks／Production Approval（P0；Open／Partially Completed；2026-10-27 最終驗收）

位置：`.github/workflows/deploy.yml:3-7,18-21`；`SECURITY.md:47`；[main branch API](https://api.github.com/repos/andreww0421/epet/branches/main)、[現有 tutorops ruleset](https://github.com/andreww0421/epet/rules/24704133)。

原始查詢時 main `protected=false`。已有 active ruleset `tutorops`，但 ref include 空、規則只有 creation/update/deletion/non-fast-forward，沒有 required PR 或 required status checks，並有多種 always bypass。**不是完全沒有 ruleset**；已讀設定無法形成必須 functional／security checks 通過才 merge main 的條件，而 main push 會進 production deployment。獨立 Security workflow 成功也不會自動成為 deploy job 的依賴。

**2026-10-25 實際 readback（未變更設定）：**

| 外部邊界 | 已確認結果／證據限制 |
| --- | --- |
| Main／Rulesets | main 仍為 `2ee853da40616f03498195de354e5af6d440d8a4`、`protected=false`；匿名 GET `/rules/branches/main` 回 **200 `[]`**。`tutorops` ID **24704133** 仍 active，include `[]`、無 PR／status checks；DeployKey、RepositoryRole 2／4／5、Integration 85455／1144995 均有 always bypass。 |
| Production Environment | 匿名 GET `/environments/production` 回 **200**，ID **20414168857**、`protection_rules=[]`、`can_admins_bypass=true`、`deployment_branch_policy=null`。因此此時不是「無法判斷有無 approval」，而是已確認沒有配置該審批／分支政策。 |
| Repository／Actions 存取 | CLI `gh auth status` 的既有憑證失效；連接 App 能建立 branch／PR，但 Branch Protection 管理讀取回 **403 Resource not accessible by integration**。repository metadata 的 user `admin=true` 不能當作 App 具管理權限的證據；沒有藉其他 credential 修改規則或 Environment。 |
| 既有 workflows | 公開 API 回報四個既有 workflows 及 Dependabot Updates 均 active；新 Functional CI 從本次 PR 執行。Security／Dependabot／staging 本次不刪除、不修改；Production migration 保持獨立 manual-only。 |
| 其他 publisher／token | 同一 main SHA 有歷史 **Workers Builds: epet-api** check（Cloudflare App 85455）；這條路徑不能由 GitHub Environment 自動保護。使用者已明確確認「只有 main 能發布，PR／其他分支不能操作 Production Worker 或 D1」，據此建立測試 PR；provider approval、原生 Builds 政策及 Cloudflare token policy／Secrets 所在層級仍未取得管理端證據。 |

**程式與設定提案：** 新增 `.github/workflows/functional.yml`、`scripts/release-ci.mjs`、`.github/rulesets/main-protection.json`、`docs/release-protection.md`；修改 `tests/securityCi.test.ts`、`SECURITY.md`，以及 `deploy.yml`／`database-expand.yml` 的 Actions pins、checkout credentials 與 timeout。沒有更動 Production secret 引用、角色權限、migration SQL、依賴或產品程式。

- `Application verification` 執行既有 `npm run verify`，包括 TypeScript／Unit／API／本機 D1／build／Worker dry-run。Browser matrix 逐 spec 使用獨立 runner／server／合成 DB，保留真實限流；目前工作樹 **20 specs（14 E2E + 5 a11y + 1 capacity）**。低權限、無 Production Environment／secrets、無 paths／draft skip、無特權 PR 事件、無敏感 browser artifact upload。
- 固定 **`PR required checks`**，`if: always()` 且 exact `discover`／`verify`／`browser` 必須全部 success；failure／cancelled／skipped／缺項均失敗。Required 清單為 **PR required checks、CodeQL、Dependency review、npm audit**，均綁定本 repo check run 實測 **GitHub Actions App 15368**。
- Main Ruleset 提案 exact `refs/heads/main`、Active、1 位獨立 review、dismiss stale、last-push approval、threads resolved、strict up-to-date checks、禁止 force push／刪除、bypass 空白。它是可審閱的 JSON，**沒有呼叫 API 套用**；沒有假造 CODEOWNERS／reviewer 身分。CI 政策檔案本身仍須合格獨立人員 review，App 綁定不會辨識同 App 的同名偽造 workflow。
- Deploy／D1 expansion 原本浮動 v4 actions 已固定為官方 tag readback 的 full SHA：checkout `11d5960a326750d5838078e36cf38b85af677262`、setup-node `49933ea5288caeca8642d1e84afbd3f7d6820020`。保留 v4 行為而未任意升 major；其他現有 pinned actions／Dependabot 維持。兩條 production 流程仍 main-only、引用 production、共用 concurrency；應用只 check ledger，schema expansion 不部署 Worker。

**真實正向／負向 PR（不合併、不部署）：**

| 測試／SHA | 實際結果 |
| --- | --- |
| 正常候選 [PR #14](https://github.com/andreww0421/epet/pull/14)，`c3b161f18f70571090b0cc2c2e8820407fcc91ce` | 非 Draft，僅 8 個 CI／政策檔；[Functional CI run 40204604002](https://github.com/andreww0421/epet/actions/runs/40204604002) **20/20 jobs 成功**（17 browser specs + discover／verify／gate），`Application verification` **464 tests（94 rules + 370 Node）通過**。這個 branch 以原 main 為基底，未將本機 H01–H04 等尚未發布的產品修補一起公開；故 remote 17 specs／464 與本機 20 specs／後述完整 verify 的基底不同，不能混算。 |
| 故意失敗 [PR #15](https://github.com/andreww0421/epet/pull/15)，`6fc50b589eae8d10e40865b2c9c75dfc62646766` | 非 Draft、獨立 branch；原 game rules 僅新增 3 行合成 `assert.fail`，不修改本機正常來源。[Functional CI run 40204705755](https://github.com/andreww0421/epet/actions/runs/40204705755) **failure**：`Application verification` 回 **ERR_ASSERTION**，`PR required checks` 明確拒絕 verify failure；其餘 **18 jobs 成功**。確認不是語法／安裝失敗，也沒有把 skipped dependency 當綠燈。測試完成後已 **Closed、未 merged**，保留分支／run 避免誤合併；未把關閉狀態當作政策拒絕證據，管理員完成政策後需 reopen／重建負向 PR 驗收。 |
| 既有 Security，正常 PR run **40204603927** | CodeQL **success**；Dependency review **failure**，明確訊息為 repository 未啟用 Dependency graph／不支援 review；npm audit **failure**，**4 advisories（2 moderate、2 high）**，含 undici／Vite 依賴鏈。沒有移除檢查、降低 high 門檻、加 continue-on-error 或以 bypass 冒充正常 PR 全綠。 |
| Required Check／Review 阻擋 | **未通過外部驗收**：有效 main 規則仍 `[]`。PR API 的 `mergeable=true` 是可計算合併／無衝突資訊，不能當作政策允許合併或已阻擋證據；未實際 merge 或呼叫 merge API。正常 PR 也未取得獨立 review，不能宣稱 Required Review 已生效。 |
| 一般協作者 direct push | **未執行**：main 未保護時真的 push 可能發布，違反本任務限制；沒有把 admin／dry-run 的結果當成拒絕證據。須先由管理員套用保護及 publisher approval，再由無 bypass 的 write collaborator 驗證 server 拒絕、main SHA 不變。 |
| Production approval | **尚未驗收、未 dispatch**：現有 policy 已確認缺少審批。本次不執行真實 deploy／schema expansion；管理員完成設定後，先以不含 credentials／部署／SQL 的 noop policy probe 驗證 pending、self-review／非 reviewer／非 main 拒絕，再依另次明確授權驗證真正發布。 |

**本機驗證：** 新增 15 項 policy regressions，與原有 10 項合計 **25/25 通過**；實際 CLI gate 的 success／failure／cancelled／skipped 回傳符合預期；TypeScript 通過。以同一 CI runner helper 執行 current 工作樹 a11y pages **8/8**、data safety **6/6**、真實本機 D1 capacity **9/9**，三種 config 共 **23/23**。`npm run verify` **exit 0；646 項通過（94 rules + 552 Node），0 fail／cancelled／skip／todo**，包含 local D1、既有所有安全修復、migration／staging 隔離、build／analytics boundary 及 Worker dry-run；既有 optional Sentry `node:*` warnings 保留，不改 flags、不部署。這不包含 npm audit，該獨立 Security job 的失敗另外如實列出。一次 fresh read-only candidate review 未找到現行 H05 具體 bypass／regression，沒有修改來源、沒有第二輪 review；指出目前 discovery 僅處理各目錄第一層 `*.spec.ts`，現有 specs 全符合，未來新增 nested／其他 extension 必須擴充 helper 與 coverage regression。

**管理員精確後續順序：**

1. **先保護所有 Production publisher，再考慮任何 main merge**：production Required reviewers、Prevent self-review、`can_admins_bypass=false`、Selected branch exact main（無 tags／PR refs）；確認原生 Workers Builds 同樣受核准或依另次授權停用該發布入口。不要只設定 YAML environment 名稱。
2. Settings → Security／Code security → 啟用 **Dependency graph**，重跑實際 PR Dependency review；另做相容依賴修補，處理本次 npm audit High，保留既有門檻後四個必要 checks 必須全綠。不要用關掃描、omit dev、強制 upgrade 或合併本 PR 來規避。
3. Settings → Rules → Rulesets：審查並匯入 `.github/rulesets/main-protection.json`，核對實際 context／App／review／strict／無 bypass；保留既有保護，讀回 effective rules。安排真正獨立、有 write 權限的 reviewer；重要 CI／security／migration 檔案指定合格 CODEOWNERS 後才開對應規則，不以作者自審代替。
4. 用上述正負 PR 重新驗證 red check／缺 review／新 push stale review／direct push 拒絕；確認測試時沒有拿已關閉 PR 或 Draft 的阻擋當成規則證據。Environment 用安全 probe 驗證審批；保存 head／merge SHA、check URLs／App、review／approver、ruleset／environment JSON 及 policy evaluations。
5. Cloudflare 管理員提供不含 token value 的 permission groups／resource scopes／owner／expiry 證據：Worker deploy 限既有目標 Worker Editor、ledger check D1 Read、獨立 migration token D1 Write 且無 Worker 發布權，staging 完全獨立；依 provider 支援範圍驗證，不能由 token 名稱／whoami／secret 存在推定 least privilege。本次未建立、搬移或輪替 Secrets，也未改正式權限。

完整 UI／API readback、Branch Protection fallback、Emergency expedited PR／無 standing bypass／audit trail 規格見 [發布保護手冊](release-protection.md)。**H05／V01 維持 Open**；即使本機 verify 及 Functional CI 成功，仍缺實際強制 review／checks／Production approval／least-privilege／負向拒絕證據，不能標示 Closed。

**來源與證據保存：** 測試使用 Windows／Node 24.13.0 的 managed 暫存副本及 GitHub-hosted Ubuntu；沒有使用正式學生資料或正式 D1。全部 **68 個變更檔案**（含本報告、所有先前修補）與測試副本 SHA-256 相符，`git diff --check` 通過，production assets 沒有 E2E 觀測介面。最後匿名 readback 的 main SHA 不變；正常 #14 仍 Open／未 merged，負向 #15 已 Closed／未 merged。補充檔位於 standalone `artifacts/h05-fix/`：`github-public.jsonl`、`final-readback.jsonl`、ruleset／protection／PR run／jobs JSON、正常 verification／Security logs、負向 assertion／gate logs、`verify.log`、`ci-policy.log`、`gate-cli.log`、三種 browser logs、`lint.log`、`independent-review.md`、`final-checks.log`、`verification-summary.md`。本機 `verify.log` SHA-256：`af27a45d1a6692d177bbf7c1c3bb0f4ba5f9d6dca76ce4b25a0b27f011f618b1`。原封存 scan 未改寫；本機未安裝額外 YAML parser／actionlint，GitHub 已實際接受並完整執行候選 workflow，沒有以靜態字串測試代替遠端 YAML 執行。

**2026-10-26 後續：CI 依賴修復與 push 問題釐清。** 上述 2026-10-25 的 Open／未 merged 與設定 readback 為當時快照。GitHub 隨後已合併 #14，main 為 `c3317faec70b7264db29c0af019a1575a58f958c`；使用者提供的 [Security run 40338460209](https://github.com/andreww0421/epet/actions/runs/40338460209) 是這次成功 push 後觸發的執行，失敗的 npm audit job **121626269489** 回報 4 個 vulnerable dependency 項目（2 moderate、2 high），不是該 push 未送達。另有本機落後遠端造成的 `fetch first`，已保留所有工作檔並將本機 Git 參照對齊，沒有強推 main。

已建立獨立 [PR #18](https://github.com/andreww0421/epet/pull/18)，head `780a213d6ecc11ddc56fce871df2b935d2f018d1`，僅 4 檔：`package.json`、`package-lock.json`、`tests/securityCi.test.ts`、`README.md`。Vite `8.1.5 → 8.1.6`，Miniflare scoped Undici override `7.29.1 → 7.30.1`；保持原穩定 Worker toolchain 配對、全部 197 個 lock entries、其餘套件版本及所有 Security workflow 門檻，沒有 `audit fix --force`／omit dev／continue-on-error。版本 regression 檢查所有鎖定實例，新增 Vite floor；一次 fresh candidate review 沒有找到具體 bypass／regression。

驗證：clean `npm ci` 與完整 `npm audit --audit-level=high` 均 exit 0，0 vulnerabilities；安裝前後 lockfile SHA-256 均為 `75192bb192a5efb7541ce2ebd794ef6c097a9a2963cec80d26522ab6858848a9`。含所有既有本機產品修復的副本 `npm run verify` **647/647（94 rules + 553 Node）通過**，staging offline dry-run 通過；PR 候選的 TypeScript、security-ci **26/26**、data safety **6/6**、a11y pages **8/8** 通過。遠端 PR #18 的 npm audit job **121643467640 success**（0 vulnerabilities），`Application verification` job **121643468580 success**（465 tests，94 rules + 371 Node）；remote 基底未包含其他未提交產品修補，計數不可與本機 647 混算。

Dependency review 首次 job **121643467990** 回報「Dependency review is not supported on this repository. Please ensure that Dependency graph is enabled」。使用者隨後確認已啟用 Dependency graph 並授權重跑；重跑 job **121645383710 success**，實際日誌確認沒有 High 以上 vulnerable packages 或 denied packages。[Security run 40343303310](https://github.com/andreww0421/epet/actions/runs/40343303310) attempt 2 已 **success**，最新 Dependency review／CodeQL（121645386483）／npm audit（121645387640）全通過。沒有移除或放寬檢查；此執行結果驗證 Dependency review 已可使用，不代表其他 repository／Production 政策已完成。

README 明確記錄 Wrangler CLI 內嵌 Undici `7.28.0` 的剩餘風險：npm override 不會修補 bundle，新的普通 fetch content-encoding DoS 不需要 interceptor，不能據 npm audit 通過宣稱 CLI 已完整修復。[Functional CI run 40343303344](https://github.com/andreww0421/epet/actions/runs/40343303344) 本次 readback 為 16 jobs success、3 個 browser jobs（product-analytics、exam、a11y privacy）仍在安裝瀏覽器，aggregate 尚未執行；不將 pending 當作成功。main readback 仍是 `c3317fa`、`protected=false`。H05／V01 不因 npm audit 修復而 Closed，review／effective rules／Production approval／token 政策仍須各自取得實際驗收證據。本次沒有合併 #18、部署或操作正式 D1／Secrets。補充證據存於 standalone `artifacts/npm-audit-fix/`。

#### 2026-10-27 最終驗收：npm audit／Dependency review 修復

**1. 任務狀態與範圍。** 本次 PR #18 的依賴／CI 修復子任務為 **Completed**；所屬 **H05／V01 整體為 Partially Completed，Finding 維持 Open**，不是 Blocked 或 Closed。上方 2026-10-26 的未 merged／browser pending 為當時快照；最新 [PR #18](https://github.com/andreww0421/epet/pull/18) 已於 **2026-10-26 23:36:13（Asia/Taipei）**合併為 main `21aefe1a963b10f04d51afea960d57f357dfa118`。候選 `780a213` 與合併提交的 Git tree 同為 `a3097ccb1883d9ec3fd596d775ca87ad595f4249`，因此最終 CI 驗證的確實是相同程式內容。本輪驗收不修改產品程式、套件版本、測試或部署設定。

**2. Root Cause 與影響範圍。** 原 `npm audit --audit-level=high` 會因已鎖定 Vite 8.1.5、Miniflare 的 Undici 7.29.1 落入新 advisory 範圍而 exit 1，屬成功 push 後的 Security job 失敗。Dependency review 的另一個失敗來源為 Dependency graph 未啟用／不支援；使用者啟用後重跑成功。受影響的是 dev server、build、D1／Worker 本機工具與 CI 的依賴圖，不是會員／學生／班級資料 schema 變更。本機另有 main 落後遠端的 `fetch first`，已於前次保留工作檔並對齊 Git 參照；不將它與 audit failure 混為同一原因。

**3. Modified Files。** PR 僅 4 檔、13 additions／12 deletions；本輪另更新本報告。其他既有未提交修補不屬於本次 PR。

| 檔案 | 用途 |
| --- | --- |
| `package.json` | Vite 下限 `^8.1.6`；Miniflare scoped Undici override `7.30.1`。保留既有 scripts 與其餘依賴。 |
| `package-lock.json` | 更新根 manifest 與兩套件的 version／resolved／integrity；保留全部 197 entries、其他套件與跨平台 optional variants。 |
| `tests/securityCi.test.ts` | 提高 Undici floor 至 7.30.1、加入 Vite floor 8.1.6，涵蓋所有 root／nested locked instances；沒有刪除或放寬測試。 |
| `README.md` | 更新修補版本，明確揭露 Wrangler bundle 仍含舊 Undici，避免將 clean npm graph 誤報為整個 CLI 已修復。 |
| `docs/commercial-readiness-audit.md` | 記錄修復、2026-10-27 最終驗收、H05／V01／M04 狀態及必要人工工作；完整報告沒有加入 PR #18。 |

**4. Security Validation 與資料隔離。** 今日完整 npm audit 的 info／low／moderate／high／critical 均為 0；今日 26 項 security-ci 實際驗證 manifest／lock 一致、全部鎖定實例下限、穩定 Worker 工具配對、workflow 權限與 High 門檻、gate 對 failure／skipped／cancelled 等結果拒絕。PR 與 main 全部功能／browser checks 成功，既有合成 authentication、permissions、privacy、workspace switching、revision conflict、Node／D1 測試維持通過。PR 沒有變更 Auth、RBAC、CSRF、tenant／class scope 實作或開放 Production secrets 給 PR，這些結果是既有控制的 regression 證據，**不宣稱已對正式學生資料、所有跨班路徑或實際部署做全面滲透驗證**。

獨立 read-only 複核確認 Vite 8.1.6 內嵌 launch-editor 2.14.2 的修補、Undici 7.30.1 的 EventSource 狀態上限／SRI algorithm normalization／先拒絕 content codings 再建立 body stream。實際 Miniflare 解析到外部 Undici 7.30.1；完整 Worker 配對、五種 workerd 與十六種 Sharp 平台 variants 保留。未獨立重現每一項 advisory exploit，也沒有以正式 Cloudflare API 製造惡意回應。

**5. Regression Tests：實際命令與結果。** 今日只重跑 audit 與 focused security-ci；其餘採用相同 source tree 的已完成 CI／保留本機日誌，不假稱今日重跑全部 suite。所有列出的最終測試均 0 fail／skip／cancel；歷史 audit／Dependency graph 失敗仍保留，未靠刪測試或降低條件取得綠燈。

| 命令／驗證對象 | 通過 | 失敗 | 證據與範圍 |
| --- | ---: | ---: | --- |
| `npm ci`，乾淨候選及完整本機修復副本 | exit 0 | 0 | 前次完整安裝、未省略 dev／optional 或 install scripts；lock hash 不變。main Linux CI 的 clean install 亦成功。 |
| `npm audit --audit-level=high --json`，2026-10-27 重跑 | 0 vulnerabilities／exit 0 | 0 | 完整 dependency graph；未使用 omit／force／忽略 advisory。 |
| `npm run test:security-ci`，2026-10-27 重跑 | 26 | 0 | 保留 symlink fixture 與全部門檻；沒有 skip。 |
| `npm run lint`，候選 | exit 0 | 0 | 前次 TypeScript 與 main verify 皆成功。 |
| `npm run verify`，PR／main | 465（94 rules + 371 Node） | 0 | [main Functional CI 40350945855](https://github.com/andreww0421/epet/actions/runs/40350945855)，Application verification job 121670504743；含 API／D1／migration／build／Worker dry-run。 |
| `npm run verify`，含所有先前本機修復的副本 | 647（94 rules + 553 Node） | 0 | 前次保留的完整日誌；今日 61 個 source／test／package／其他 docs 檔與該副本 hash 相同（本報告除外）。**不能將 647 當成 main 已包含其他未提交修補的證據。** |
| `node scripts/release-ci.mjs browser`，`EPET_CI_KIND=e2e`、逐個 `EPET_CI_SPEC` | 52（12 specs） | 0 | main 的 authentication／permissions／privacy／class lifecycle／data safety 等實際 browser job logs；每 spec 獨立 runner／server／合成資料。 |
| 同一 browser 命令，`EPET_CI_KIND=a11y`、逐個 spec | 20（5 specs） | 0 | main axe／keyboard／privacy 等實際 job logs；合計 browser **72/72、17 specs**。 |
| 同一 helper 單獨執行 data-safety／a11y pages | 6／8 | 0 | 前次本機候選回歸，與上述 suite 有重疊，不另加總。 |
| `npm run check:worker:staging` | exit 0 | 0 | 前次 offline synthetic staging dry-run，沒有對遠端 staging／Production 發布。 |

PR [Functional CI 40343303344](https://github.com/andreww0421/epet/actions/runs/40343303344) 最終 **20/20 jobs success**，先前 3 個安裝中的 browser jobs 均成功；[PR Security 40343303310](https://github.com/andreww0421/epet/actions/runs/40343303310) attempt 2 的 Dependency review／CodeQL／npm audit **3/3 success**。main Functional CI 同樣 **20/20 jobs success**；[main push Security 40350946013](https://github.com/andreww0421/epet/actions/runs/40350946013) CodeQL／npm audit 成功，Dependency review 按既有 PR-only 條件 skipped，**不將 main 的 skip 當作新的 review 成功**。CodeQL job 成功不等於已人工清空所有 code scanning alerts。Lock SHA-256 仍為 `75192bb192a5efb7541ce2ebd794ef6c097a9a2963cec80d26522ab6858848a9`。

**6. Backward Compatibility。** 四檔修補未變更會員／學生／班級／遊戲 domain model、Student Identity、API payload、revision contract、資料讀寫、SQL 或 migration；不要求既有資料轉換、不刪除或匿名化資料。Worker／Miniflare／workerd 配對與 plugins／Node engines 相容條件保留；既有會員登入、班級／學生操作、遊戲規則、匯入匯出與 Node／D1 合成回歸通過。這是相容性證據，不是「所有正式資料已逐筆對帳」；正式會員、學生與 D1 均未用於本輪測試。

**7. Remaining Risks 與人工操作。**

- H05／V01 尚有**已確認**的控制缺口：2026-10-27 匿名 GET main effective rules 為 **200 `[]`**，main branch API `protected=false`；production Environment ID 20414168857 的 `protection_rules=[]`、`can_admins_bypass=true`、`deployment_branch_policy=null`。成功 CI／合併本身都不能證明 Required Review／Required Checks／Production Approval 已強制生效，尚無無 bypass 使用者的 server rejection／正式 approval 正負向驗收。
- Dependency graph 已由使用者啟用，PR Dependency review 真實執行成功；這項設定缺口已處理，無需重做或停用掃描。GitHub／Cloudflare 管理員仍須依 `release-protection.md` 套用並讀回 exact main、獨立 review、四個 Required Checks、無 standing bypass、Production reviewer／self-review prevention／main-only policy，以及原生 Workers Builds 的等效核准。Token 實際 least-privilege policy 仍需管理端遮罩證據。
- Wrangler CLI 仍內嵌 Undici 7.28.0；其 Cloudflare API fetch path 的舊 content-coding 處理未由 override 修補。這是仍存在的 vulnerable primitive，攻擊可利用性還取決於 API peer／TLS 控制，沒有證明正式學生請求可觸發。後續須選定含 bundle 修補的穩定工具配對，重做 clean install／D1／Worker／browser 驗證；不能據 clean npm audit 將此風險標示 Closed。
- 其他 H01–H04／M01–M03 等既有本機產品修補仍不在本次四檔 PR；本機 647 通過不能替代其各自提交、review、合成 staging 與授權發布。既有 optional Sentry `node:*` dry-run warnings 及實際 serving SHA／post-deploy smoke 仍按原範圍追蹤，沒有放寬 flags 掩蓋。

**8. Deployment Impact、操作與回復計畫。** 本次依賴修復**不需要新 Migration、Secrets、Cloudflare bindings 或 Production D1 mutation**。但 GitHub 已顯示合併後的既有 [Deploy run 40350946097](https://github.com/andreww0421/epet/actions/runs/40350946097) success：日誌先確認 migration ledger current／no database changes required，後發布 `epet-api`，Worker Version ID **`a3c77790-8b80-40f2-b668-11a79c5a12e0`**。這是本輪唯讀取得的既有自動部署紀錄，**不能再泛稱尚未部署**；本輪代理沒有 merge、dispatch、deploy、讀寫正式學生資料或更改正式權限。實際服務 SHA／已登入的 post-deploy smoke 沒有在本輪執行，不以 job success 代替服務端驗收。

尚未執行的正式管控操作：先保存現況 ruleset／Environment／publisher policy／上一個經核准 Worker Version ID，由管理員核定變更，依 `release-protection.md` 套用 main ruleset、四個 checks、獨立 review 與 production approval，維持 D1 expansion 獨立流程；先驗證無 Secrets／SQL／deploy 的 Environment noop probe，再做受保護的正負 PR／無 bypass push 拒絕驗收。所有 publisher 尚未受保護前，不對 main 真推測試 commit。

若設定阻擋正常流程，停止發布、修正 reviewer／ref／check context，保留拒絕門檻，不自動關閉保護或加入 bypass。若應用版本有回歸，另取得正式操作授權後，從 Cloudflare 部署歷史回復**經安全審查且與現有 D1 相容**的 Worker 版本，保留 D1；本次沒有 schema 變更，不執行資料庫反向 migration。舊版依賴可能重新帶入本次 advisories，須核准風險或採 forward fix；上一版實際 Version ID 與 live smoke 為人工回復前置查核，未假造或執行回復。

**9. Audit Status 與下一個 P0。** 2026-10-27：依賴／CI 子任務 **Completed（實際驗證通過）**；**H05／V01 維持 Open／Partially Completed**；M04 的 CI 已實際完整執行，但外部 required release gate 尚未完成。不把任何僅完成程式碼／JSON 提案的控制標示 Closed。**本次依賴修復已可交接下一個 P0，建議下一項優先完成 H05／V01 的管理端發布管控；這不是 H05／V01 結案或商業化正式發布放行。** 本輪未進行任何正式設定／Secrets／D1 變更或再部署。補充原始證據位於 standalone `artifacts/npm-audit-acceptance-2026-10-27/`，包含當日 audit／security-ci、PR／main metadata、policy readback、17 個 browser logs、main verify 與既有 deploy log；先前 `artifacts/npm-audit-fix/` 保留原始與修補過程證據。

#### 2026-10-28 Staging／Production 架構查核與本機修補

沿用既有 `wrangler.staging.jsonc`、`scripts/staging.mjs`、`staging.yml` 及三項唯讀 smoke，未重建流程。宣告目標為 production `epet-api`／`epet-production`，staging `epet-staging`／不同 D1 UUID；guard 拒絕 production UUID、額外 bindings／routes／named environments，所有指令固定 config、顯式 staging credentials、empty env-file。Worker repository 只使用 `env.DB`，前端 API 使用 same-origin relative paths，沒有 staging frontend 的 production API host override。這是原始碼邊界，不是實體環境已啟用的證明。

本輪發現原 CLI 繼承的 `WRANGLER_CI_OVERRIDE_NAME` 可在 Wrangler 讀取固定 config 後覆寫 Worker 名稱；若 staging token 也能存取 production，可能選到 `epet-api`。同類 ambient environment／API endpoint selectors 與 `WRANGLER_LOG_SANITIZE=false` 也會破壞預期邊界。已在 child process 共用入口不分大小寫移除這些 selectors、一般／legacy Cloudflare 與 application secrets，再設定 canonical staging credentials、`CI=true` 及 `WRANGLER_LOG_SANITIZE=true`。先以離線 synthetic CLI tests 重現 4 項失敗，再重現 2 項 Windows lowercase／mixed-case 失敗；最終 34 項 staging policy tests 全通過。獨立複核確認 Windows alias bypass 已關閉，但其先前廣泛 review 曾因使用量限制中斷，不宣稱已完成完整獨立 live review。

將原 smoke 的 network policy 抽為 `tests/staging/network-policy.mjs`，維持 staging GET／HEAD、Turnstile 非 top-level dependency，實測拒絕 staging 寫入 methods、production／其他 origins、3xx redirects 與 malformed URLs；實際 config invariant 亦驗證無本機 seed／teardown／storageState／敏感 artifacts。沒有改 Auth、RBAC、CSRF、資料模型、SQL、Production Worker／D1／Secrets、兩份 Wrangler config 或 deployment workflows。

**驗證：** `npm run test:staging-policy` **34/34**；完整工作樹副本 `npm run verify` **659/659（94 rules + 565 Node），0 fail／skip／cancel**，含 TypeScript、Node／D1、migration policy、build 與 Worker dry-run。真實 Wrangler staging dry-run 在污染的 ambient selectors／合成錯誤憑證下仍 exit 0、只使用 dummy staging binding；`staging:validate` 通過。`test:e2e:staging -- --list` 僅成功列出 3 項，**未執行 remote smoke**。工作區 60 個 runtime／test／package 檔與測試副本 hash 相符；其他先前未提交產品修補仍保留，不能將本機 659 當作 main 已發布的證據。保留既有 Sentry optional `node:*` warnings，沒有增加 flags 或放寬測試。

**外部狀態／未完成：** 使用者最近回覆 staging Worker／D1「尚未」建立。2026-10-28 公開 API 再查 `staging.yml` run history 為 0、staging Environment 回 404，尚未取得保護政策與 live target 證據；production Environment 仍 `protection_rules=[]`、`can_admins_bypass=true`、`deployment_branch_policy=null`。實際 token／widget／provider key／sender／recipient 限制沒有查驗，不能從 `STAGING_` 名稱推定秘密值獨立。Email source 沒有 staging recipient filter，Resend domain-scoped key 只限制寄件來源；未有受控 test inbox／sink 前不得宣稱無誤寄風險。Health 不查 D1，anonymous 401 也可能不碰 repository，所以三項 public smoke 無法證明 live DB／schema／實際 binding、登入後 scope、Turnstile／email 或 serving SHA。

**狀態：本機程式／測試／文件已完成；外部 staging 啟用與驗收未完成。H05／V01、M05、V02／V03 維持 Open，不標示 Closed。** 管理員需先盤點沿用資源、只建立缺少的 staging Worker／D1、設特定 Worker Editor 與最小 staging D1 scope、獨立 GitHub Environment／review／branch policy、獨立 Turnstile／Email；若 D1 IAM 只到 account 級，優先隔離 account。缺 migration ledger 不代表 DB 空白，未知來源／既有資料時停止，不 reset 或重放歷史 SQL。具體設定、核准首次部署／live smoke、合成帳號驗收與 staging-only retry／rollback 步驟見 [staging deployment](staging-deployment.md)；本次沒有執行任何遠端 migration／部署或正式變更。補充證據保存在 standalone `artifacts/staging-architecture-2026-10-28/`。

### H06 — 備份還原與 RPO／RTO 缺乏上線驗收證據（P1；需正式環境驗證）

位置：`docs/p0-operations-runbook.md:3-4,19-24`；`docs/database-migration-policy.md:108-114`。

文件要求 restore point、季度演練、還原後重做刪除與實測時間，但值班人、備份政策、RPO／RTO 仍待簽核。**不能因此斷言沒有備份**；目前無證據可支持對付費客戶的資料復原承諾。25 revisions 不是獨立災難備份，Worker rollback 亦不是 D1 restore。

建議／驗收：核定目標與負責人，在非正式 D1 完成計時 restore drill，驗證 membership、workspace、revision、normalized 筆數、tenant boundary；重放備份時點後的刪除要求。保存版本、還原點、實測 RPO／RTO、對帳與刪除證據，建立定期演練。

**2026-10-30 增量驗證：H06／V04 維持 Open（部分完成）。** 已加入唯讀復原 validator、本機可重複合成演練與 SQL byte guard；在使用者指定帳戶中新建兩個 synthetic D1，實際完成 Time Travel／previous-bookmark undo／SQL 往返，23 表 schema／rows／ledger 與基準精確相同。本機 19 個 DR cases 與完整 verify 697 cases 通過。這不等於正式 RPO／RTO、外部備份／journal、完整容量 SQL fallback 或正式隔離／重開已驗收；詳細證據與剩餘事項見第 13 節及 [DR Runbook](disaster-recovery.md)。

### H07 — 商業隱私與資料治理營運尚待核定（P1；文件確認待辦，實際營運需查驗）

位置：`docs/privacy-data-governance.md:8-18,61-79`；`worker/repository.ts:1530-1569`；`docs/data-privacy-management.md:89-95`。

營運者、窗口、通知責任、保存期限仍待填；請求人驗證、案件追蹤、安全交付、外部副本與備份例外流程尚未完成。Auth cleanup 已存在，但沒有 live teaching data／audit 的 age-based retention；25 revision 是版本數，不是天數。刪除／去識別化 UI/API 已實作，不應再開同一功能。

建議／驗收：由營運者與校方核定期限／DPA／隱私聲明／處理者清單／事件責任人，據此實作 retention/purge 與例外限縮；演練單生請求、安全交付、到期銷毀及還原後重刪。此為技術及流程驗收，不是本報告對特定法規的符合性認證。

## 5. Medium

| ID／順序／狀態 | 證據、影響及前提 | 修正方法與驗收標準 |
| --- | --- | --- |
| **M01／P0／Closed（本機驗證；尚未部署）**：草稿 principal／scope 隔離 | 原始 workspace-only namespace 的跨帳號、降權 Store 洩漏已用合成 E2E 重現。現已實作 user + workspace + role + class scope binding、fresh server authorization、24h TTL、下載重驗及隔離保留。 | Draft/API 42/42、新 E2E 10/10、相容性 E2E 15/15、verify 530/530 通過。詳見下方「M01 修復與驗證」；裝置／XSS 對明文 storage 的存取仍是獨立界線。 |
| **M02／P0／Closed（本機驗證；尚未部署）**：小 payload 可要求無界配置 | 原 shallow schema 與 warningPoints → `Array.from` 路徑已用安全合成值確認。現已加入共用 Runtime Schema、normalizer 前資源檢查、單筆及整體 warning 配置預算，涵蓋 State PUT／Import／Restore／初始註冊及 Node／D1 新寫入。 | 新增 26/26 regression、既有 Import 22/22、D1 23/23、相關 E2E 12/12 及 verify 556/556 通過。契約、相容性與剩餘容量風險詳見下方「M02 修復與驗證」及 `docs/workspace-input-validation.md`。 |
| **M03／P0／Closed（本機驗證；尚未部署）**：D1 owner 轉移可留下多 owner | 原始 race 已在合成 D1 重現：兩個成功、2 owners／2 audits。現改為既有 claim pointer 的 transaction 內 CAS，roles／audit／scope 清理均有直接成功閘門；失敗回 `409 OWNERSHIP_CONFLICT`。 | Ownership／Concurrency 25/25、Auth 11/11、Server／RBAC 33/33、權限 E2E 2/2 通過；最終 verify 共 581 項通過（94 rules + 487 Node tests），含 D1 core 23/23。詳見下方修復證據及 `docs/workspace-ownership-consistency.md`。 |
| **M04／P1／CI 已合併，外部 release gate 待驗收**：browser/a11y 閘門 | 原 main 缺功能 PR workflow；後續 H05 已新增 `functional.yml`，正常 PR 的全部 E2E／a11y jobs 及 aggregate 實際成功，負向 PR 產生真實功能失敗；2026-10-26 已確認 #14 合併至 main `c3317fa`。 | Required Checks 的設定快照與外部驗收見 H05／V01；完成 effective policies／review／拒絕驗收前，不宣稱 release gate 已有效。verify 本身仍不含 E2E/a11y，兩者由 PR job 各自執行。 |
| **M05／P1／已確認覆蓋限制**：staging／production smoke 未完成發布閉環 | `tests/staging/smoke.spec.ts:8-86` 只有 health flags、anonymous 401、login UI/headers，刻意禁止資料 mutation；`docs/staging-deployment.md:89-105`；deploy.yml 在 `:57-61` deploy 後結束。沒有 serving SHA readback／authenticated Worker+D1 browser 驗收／post-deploy smoke。已有 rollback runbook，不能報「沒有 rollback 文件」。 | 保留唯讀 smoke，另建合成 staging account/資料清理與正式 auth 流程，驗證 D1 read/write、scope、409、實收信與 bot challenge；綁 immutable release identifier。Production 低風險 readback/smoke 失敗通知值班，演練相容 Worker rollback/forward fix；不得自動將 D1 回滾當作應用復原。 |
| **M06／P1／已確認**：郵件 best-effort，缺 durable delivery | `server/services/apiRuntime.ts:91-114`；`authRoutes.ts:275-322`；`adminRoutes.ts:73-89`；`shared/services/accountEmail.ts:41,91,138,234`。waitUntil／Promise catch 可回 accepted 後丟失郵件，沒有 durable retry/status/DLQ。Resend idempotency keys 已有。 | 交易式 outbox／Queue + timeout/retry/backoff/status/DLQ，保留 idempotency；對短效 capability 的儲存／重寄採獨立安全設計，不能為可靠性改存明碼 raw token。驗收 429/5xx/timeout/Worker restart 可恢復且不重複送，不洩漏內容到 logs。 |
| **M07／P1／潛在容量／併發風險**：full snapshot 是主要寫入單位 | `src/hooks/useBackendSync.ts:95,294`；`server/routes/workspaceRoutes.ts:121-188`；`worker/repository.ts:813-991`；`worker/projectionStatements.ts:67,112`。小變更重送／序列化全 workspace，保存 revision、重建 projection；global revision 令不同班級互相衝突。Admin optional baseRevision 允許未提供舊版本的 snapshot 覆蓋（workspaceRoutes.ts:127-155），CAS 不能推知 client 的舊意圖。 | 先以 evidence／points typed command 垂直切片，server validation/clock、idempotency、增量 SQL；逐步 class/domain revisions，保留 versioned snapshot compatibility。驗收大工作區及多班併發的 bytes/query/latency/409 budget；拒絕或明確定義盲寫；補 JSON/D1 共同 adapter conformance，不能一次切掉舊匯入／復原。 |
| **M08／P1／已確認機制；規模影響待驗證**：cron 對帳只覆蓋前 500 workspace | `worker/repository.ts:771-809` 每次 cursor=''，50×10 後只回 truncated；`worker/index.ts:129-136` 每天只呼叫一次並記 completed。超過 500 時反覆檢查同一排序前段，後段只能依賴讀取驗證等路徑；不符合 runbook 的全量期待。 | 持久 continuation／分段排程與 last-success age；truncated／漏跑告警。驗收 >500 合成 workspace 多輪可公平覆蓋，後段 drift 可修復；正式環境查 count 與最久未對帳時間。 |
| **M09／P1／已確認**：兩個 modal 尚無真正 modality | `src/features/workspace/components/DataGovernancePanel.tsx:896-929` 的 revision restore；`src/App.tsx:468-513` 升級獎勵。一般 div + aria-modal 不會限制 Tab／背景互動；restore 雖有 autofocus/Escape，仍缺一致 focus containment/return。 | 遷移至**既有** `src/components/ModalDialog.tsx:21-68`，保留 confirmation、flush、busy、RBAC/revision。驗收 initial focus、Tab/Shift+Tab、背景 inert、Escape/busy、return focus，以及兩個未覆蓋 branch 的 keyboard/axe。 |
| **M10／P1／需人工驗證**：a11y 通過不等於 WCAG AA | `tests/accessibility/fixtures.ts:24-59` 掃全部預設規則，但只有 serious/critical fail；`playwright.config.ts:18-25` Chromium/zh-TW；`docs/accessibility-backlog.md:95-104`。仍需 contrast incomplete、screen reader、不同角色、Firefox/WebKit、200/400%、forced-colors、完整手機／reset/invite/Turnstile 等驗收；`src/App.tsx:249` 尚缺 skip-to-main。 | 依 backlog 做人工 contrast／NVDA/VoiceOver／keyboard／zoom 紀錄，每個 incomplete 有 disposition；補 skip link、角色／瀏覽器矩陣與 CI artifacts/責任人。不得把 incomplete 自動判成違規或通過。 |
| **M11／P1／既有已確認設計，攻擊前提為 verifier 洩漏**：密碼 hash policy 仍需演進 | `server/auth.ts:46,178-262,321`；`docs/security-review.md` AUTH-01。100,000 PBKDF2 iterations 有 random salt、每帳號參數、密碼長度及線上限流，但沒有 rehash-on-success。不是新的已重現登入繞過。 | 在正式 Worker plan 做 CPU/latency benchmark，再選可支援 policy／格式／漸進 rehash，保留舊憑證相容與 rollback。驗收新舊憑證、reset/invite/login、尖峰 CPU/error budget；不憑註解直接調高 iterations。 |
| **M12／P2／潛在產品完整性風險**：遊戲結果仍由 client 決定 | `src/store/useStore.ts:2213,2595-2606`；`server/routes/bossRoutes.ts:18-46`；`README.md:79`。Boss 先本地套獎，再呼叫接受 client students/boss/time 的純計算 API 且忽略回傳；不是 authoritative atomic settlement。目前 teacher 以上才可寫，不能稱匿名學生可作弊。 | 教師主持模式先修正文案／信任契約；若推出獨立學生／可兌現獎勵，升為公開推出前 blocker：server clock/RNG、command/revision/idempotent atomic award。驗收改 client 數值／時間無法改 trusted 結果，重放只發獎一次。 |
| **M13／P1／潛在規模風險、provider 待驗證**：SLO／成本／警報未形成證據閉環 | `docs/observability.md:61-66,272-277`；`shared/observability/policy.ts:65-80`；`docs/p0-operations-runbook.md:34-39`。已有安全 error reporting，但刻意不把 409/429 當 incidents；relay quotas 只有 isolate-local，不能當 edge/global quota。未見 load/performance budget 或可證明的值班 routing。 | 只加不含個資的 aggregate latency/5xx/409/429/D1 CPU/size/cron metrics，核定容量與成本模型，配置 edge/WAF/provider quota。驗收代表性大工作區、並發 autosave、尖峰 auth 的 p95/error/headroom；合成事故確實通知值班，維持 telemetry allowlist。 |

### M01 修復與驗證（2026-10-21；Closed：本機修復及驗證，尚未部署）

**Root Cause Analysis：** `useBackendSync` 原以 `epet-unsynced-workspace-v1:<workspaceId>` 保存完整未同步資料，只驗 workspace 與 revision，沒有 principal、role、class scope 或 TTL。session 失效會清 Store／credentials，但保留該草稿；同分頁下一位可寫帳號或降權者可在相同 revision 時把前任完整草稿 hydrate 到 Store，然後才遭 PUT 403。revision 不會因 membership/class assignment 更新而必然改變，不能代替授權版本。原 `storeWorkspaceId` 也不能區分同 workspace 的不同帳號；403 與下載控制僅看舊 UI 角色，未撤銷先前的 client authority。

修復前以同一組合成 A/B/C E2E 驗證：A admin→限 A 班 teacher、B 同一 teacher AB→A 兩個情境都在歷次 Store 快照中確認未授權資料；C 同人同權限重新登入成功，為合法控制。修復前結果 **2 fail／1 pass**；不是以 fixture 403、登入限流或單純畫面等待失敗當成漏洞證據。

| 程式位置 | 最終修正與保持的行為 |
| --- | --- |
| `shared/contracts/workspace.ts:4,15,26,32` | `WorkspaceAccess {userId, workspaceId, role, classIds}` 為獨立授權 DTO，不放入 AppData。owner/admin 用明確 null=all；teacher/viewer 必須有非空 allowlist。canonical JSON tuple 使用 sorted/deduplicated class IDs；HTTP precondition 採 WebCrypto SHA-256、固定 67-byte `v1.<hex>`，支援 200 個長 Unicode IDs，避免原始 key 超過 header 上限。指紋不是登入憑證，不能取代 RBAC／CSRF。 |
| `server/routes/workspaceRoutes.ts:112-145` | GET `/state` 帶 `x-epet-sync-user` 時，先核對本次 cookie 的已授權 user，再從同次 request 的 membership／`getClassScope()` 回傳 scope metadata 與限縮 snapshot。PUT 的 `x-epet-sync-access` 由 server 獨立重算，比對失敗在 consume body／repository write 前 403。沒有新 headers 的舊 GET／PUT 契約維持；未放寬 Origin、CSRF、membership、teacher class merge 或 CAS。 |
| `src/services/backendApi.ts:315,327,503,658` | session/state 使用 no-store；同步讀取帶預期 principal，寫入帶固定長度 authority precondition。auth generation 阻止晚到的 session/login/logout response 覆蓋較新的 credentials／active workspace。API 與 Worker 共用同一 server route；無 D1 schema 或正式會員資料變更。 |
| `src/services/workspaceDrafts.ts:5,22,27,36,53,82` | v2 key 是 encoded canonical user/workspace/role/scope tuple，envelope 內再次保存 binding、version、baseRevision、requestId、createdAt/updatedAt/expiresAt。拒絕錯誤 namespace、未來／非法時間、越界的 data 或 uncertainData；未經授權不 normalize 進 Store。TTL 為最後一次使用者編輯後 24h，retry/read 不續期；到期後自身 namespace 不可恢復並清除。已提交內容比對在同一時點 normalize 並 canonicalize object keys，容忍 server 補入的預設欄位，仍保留陣列順序與實際編輯差異。 |
| 同上 storage failure 路徑 | storage 缺失／policy denial／quota failure 時保留本頁、同 namespace 的記憶體 fallback；若磁碟仍可讀舊值，以較新 failed write 為準。成功保存／清理同步移除該 fallback；不枚舉、載入或刪除其他使用者／scope 的草稿。分頁關閉／reload 無法保證這種 memory-only 內容留存。 |
| `src/hooks/useBackendSync.ts:86,91,98,154,302,326,333` | 每次重新掛載先 reset Store/generation，fresh server access 與目前已驗證 session 的 user/workspace/role 相符後，才讀取該 exact-scope 草稿。重送及草稿下載前再驗 scope；401/403 撤銷 view/queue authority，舊草稿留在原 namespace。in-flight handoff 保存 uncertainData；remote 與草稿相同時直接認定已提交，不重送或製造假 conflict；新 local edit 仍依既有 revision 保護處理。 |
| `src/auth/AuthProvider.tsx:90-124,180-222` | async auth operation 以 generation 排序；換 principal、refresh／focus／回到可見分頁時先清 client view，再重新驗 session/scope。正常 logout 先以既有 CSRF/cookie 啟動 server revocation，隨即清 client view，避免先清 CSRF 令 logout 被 403 拒絕。scope 不是從 draft 或畫面中的 class list 推測。 |
| `src/App.tsx:36,137,452,478,526`、`src/components/AuthScreen.tsx` | 下載只使用 controller 經重驗後提供的合法草稿，不直接把 Store 當成可下載依據；暫停狀態不顯示含學生的 toast/reward modal，安全的切換／登出失敗提示另行保留。登入及恢復畫面說明 24h、同帳號／工作區／權限策略。 |
| `src/store/useStore.ts:2643` | opt-in legacy PII cache 加 `skipHydration`，避免在 session/scope 驗證前自動把舊 localStorage 全量資料載入 Store；authenticated hydration 由 sync 邊界統一管理。一般資料操作、備份匯入與 game rules 保留。 |
| `server/middleware/origin.ts`、`tests/serverApiContracts.test.ts` | 僅在既有 CORS allowed-headers 加入兩個同步 preconditions，Origin allowlist 不變；真 OPTIONS preflight 有 regression。 |
| 新 tests／既有相容性 tests、`package.json` | `workspaceDrafts.test.ts`、`workspaceSyncAccess.test.ts` 納入 `npm run test:draft-security` 與 `verify`；`draft-recovery.spec.ts` 走真 cookies／Authentication／Class assignment／UI。`data-safety.spec.ts` 的草稿存在性 assertion 更新為 v2，其餘流程保留。Store 觀測僅透過 E2E build plugin，production 不產生 test global；README／privacy 文件同步更正 cookie 與 retention 行為。 |

**恢復／資料遺失策略：** 不全面清除草稿。相同使用者、workspace、角色及同一組 class scope 在 24h 內重新登入並通過 server 驗證後可恢復；權限增加或縮減也不猜測舊完整草稿可以重用，不會先讀舊內容再嘗試 filter。其他 namespace 保留但目前帳號不能透過應用載入／匯出／重送；若原授權合法恢復且仍在 TTL 內，可再恢復原草稿。viewer 不重送。v1 缺少可信 principal/scope，不能安全自動遷移，故保持隔離、不自動歸屬，直到分頁關閉由瀏覽器移除。真正 revision conflict 的明確採用遠端／合併 UX 仍屬 H03，不能用本修補宣稱已解決。

以上為 M01 結案時的恢復範圍；後續 H03 已另行完成明確採用遠端／保留草稿導覽，詳見本報告 H03 與 `docs/workspace-conflict-recovery.md`。自動合併仍未實作。

**修復前後行為：** A 情境由「限 A 班 teacher 先載入 admin 全量草稿、之後 PUT 才被拒絕」改為「fresh session/scope 後只讀自己的 namespace，未授權內容不進 Store／DOM／匯出／request」；B 情境由「同帳號降權仍可載入 AB 草稿」改為「AB 與 A 是不同 binding，舊草稿隔離保留」；C 情境維持「同帳號、同 workspace、同權限於 TTL 內重新登入可恢復」。過期、舊 v1、principal 在 session check 後被替換、舊下載控制均不能繞過授權檢查。

**驗證證據：** Windows、Node `v24.13.0`，所有 mutation 使用隔離暫存副本、合成帳號及班級資料。以下是最終修補版本的結果；第 9 節仍為原始稽核基線。

| 命令／證據 | 最終結果與驗收範圍 |
| --- | --- |
| 修復前 A/B/C E2E | **2 fail／1 pass**：兩個失敗均觀測到未授權 Store 資料；同人同權限控制通過。保留 `red-e2e.log`。 |
| `npm run lint` | **通過，exit 0**。 |
| `npm run test:draft-security` | **42/42 通過、零 skip**：30 個 draft unit cases、12 個真 API／Auth cases；包含 binding、TTL、範圍驗證、quota memory fallback、normalization 比對、fresh principal/scope preconditions 及拒絕前不讀 body／不寫 repository。 |
| `npm run test:e2e -- tests/e2e/draft-recovery.spec.ts` | **10/10 通過**：A/B/C、TTL、舊 v1、workspace switching、session check 後換 cookie principal、舊下載控制、真 logout revocation、focus refresh 與已提交 in-flight write。A/B 觀察 Store 歷程、DOM、匯出及 request；合法 A 班操作／CSV 仍可用，B 班合成資料不變；C 走重新登入並恢復。 |
| `npm run test:e2e -- tests/e2e/authentication.spec.ts tests/e2e/data-safety.spec.ts tests/e2e/permissions.spec.ts tests/e2e/class-and-teacher.spec.ts` | **15/15 通過**：既有登入、資料安全、權限及班級／教師操作相容性。 |
| `npm run verify` | **通過，exit 0；530/530、零 fail/skip**：94 game rules + 436 Node cases，包含既有安全／D1／隱私 suites、7 個 checksum-locked migrations、TypeScript、production build／analytics boundary、Worker dry-run。既有 Sentry optional Node built-in warnings 仍存在；dry-run 沒有部署或連線修改 production D1。 |
| 獨立修補複核及修正 | 一次 fresh read-only review 找出三項相容性回歸：logout 先清 CSRF、quota fallback 被舊 storage 值蓋過、focus refresh 不識別已提交寫入。均已確認並修正，加入對應單元／E2E regression；額外涵蓋 server normalization 預設欄位差異。未把複核描述為零問題。 |
| 來源與產物檢查 | 驗證用副本與工作樹的 **35 個變更 source/test/package/docs 檔 SHA-256 相符**（不含本稽核報告）；`git diff --check` 通過；最終 production assets 不含 `__epetTestStore`／`__epetDraftDomLeaks` 觀測 globals。沒有 dependency／lockfile／schema 變更。 |

完整 logs 與複核紀錄另存 Codex Security standalone `artifacts/m01-fix/`：`red-e2e.log`、`draft-api.log`、`recovery-e2e.log`、`compatibility-e2e.log`、`verify.log`、`final-checks.log`、`independent-review.md`。最終 `verify.log` SHA-256：`278c0265efedf8c3e17c57f212bb5d7eb02d5ee632f905a1300965868749742a`。因此 M01 標示 **Closed（本機應用層修復及驗證）**；正式發布及環境驗收仍待既有 release 流程。

**界線與剩餘風險：** 本次是應用層的 replay／Store／DOM／export／request 隔離；為保留恢復能力，其他 namespace 的草稿仍是同源 sessionStorage 明文。XSS、DevTools、瀏覽器設定檔或裝置持有人不在 namespace 的保密邊界內；若需求包含惡意本機操作者隔離，須另設 server-gated 加密 key 或 server-side 草稿，不可把 metadata key 當成加密。遠端權限撤銷需待 fresh request／focus／session refresh 才被 client 偵測，不能撤回已授權讀取或已發送的 in-flight bytes；server 每次仍獨立執行 RBAC／class scope 與 precondition。過期／不相容內容不會自動恢復；sessionStorage 邏輯到期在驗證後讀取該 namespace 時清除，不宣稱跨所有 namespace 的背景實體抹除。完全離線時不能重新證明目前權限，因此不提供略過驗權的草稿下載。

沒有部署、正式 D1 操作、正式會員變更或真實學生資料。新 client 對缺少 authority metadata 的舊 server fail closed；若分開發布 backend/frontend，應先部署相容 server 再切換 client，依既有 staging/release gates 驗收。本報告原始封存 scan 保留原樣；本次證據另存 standalone `artifacts/m01-fix/`。

### M02 修復與驗證（2026-10-22；Closed：本機修復及驗證，尚未部署）

**Root Cause Analysis：** `server/services/workspaceValidation.ts` 原只檢查 root／class 外殼。`server/routes/workspaceRoutes.ts` 的 Import、admin／teacher State PUT，以及 `authRoutes.ts` 的初始 workspace 與 `adminRoutes.ts` 的 Revision Restore，會在深層型別／資源驗證之前呼叫 `normalizeAppData`。`normalizeStudent` 將 `toFiniteNumber(warningPoints)` 的結果直接用作 `Array.from({length})`；極大的有限數字仍有效，且小 JSON 不會先撞到 request byte limit。D1 的 900 KiB guard 只看 normalization 之後的 JSON，無法阻止前面的配置。這不是 RBAC／CSRF 繞過，也沒有動態耗盡 Worker 記憶體或證明全面停機。

修補前的安全 probe 使用 warningPoints=2 作合法控制、1001 作小型超限例子：兩者均通過舊 `isAppData`，並分別配置 2／1001 個 timestamps。修補後超限例子在配置前被拒絕。`1e12` 的數值及數字字串另用同步 `Array.from` sentinel 測試：若配置真的被呼叫會立即攔截，最終 sentinel 呼叫次數為 0；沒有建立巨大陣列。

| 程式位置 | 修正與驗證邊界 |
| --- | --- |
| `shared/validation/workspaceValidation.ts`（新增） | 共用 iterative 資源預算與型別 schema；`WorkspaceValidationError` 不攜帶輸入值。Strict snapshot 與 Legacy 備份共用相同結構／數值上限，Legacy 僅額外允許有界十進位數字字串及既有缺省／alias。 |
| `server/services/workspaceValidation.ts:4`、`server/routes/workspaceRoutes.ts` | 保留既有 `isAppData` 呼叫位置與錯誤契約，predicate 現執行完整 schema；兩個既有 gate 分別在 Import／State PUT 的 normalization 前拒絕資料。admin／teacher、lifecycle、duplicate-ID、scope merge、revision／CAS 均維持。 |
| `server/routes/adminRoutes.ts:241`、`server/routes/authRoutes.ts:110` | Restore 在讀到來源後、normalization 前驗證。註冊時若明確提供非法初始資料，回 400，不再悄悄建立預設 workspace；未提供仍使用安全預設。 |
| `src/store/utils.ts:444,445,712` | 整份資料先做資源 preflight；獨立 `normalizeStudent` 亦先檢查，經過 `checkedWarningPoints` 才配置。使用單次有界 `Array.from({length}, mapper)`；不以 clamp／slice 掩蓋超限 warning 值。既有有界 sanitizer／migration 控制仍保留。 |
| `server/repository.ts:345,501,528` | put 與帳號／workspace 建立都在 mutate／clone 前驗證新目前資料，避免內部 typed 呼叫繞過 HTTP 邊界。 |
| `worker/repository.ts:379-397,885` | 新目前資料先檢查結構／warning 配置預算，再序列化、執行既有 900 KiB guard、完整 schema；在任何 DB write／projection 前完成。保留歷史的隱私清理用獨立內部 serializer，不 normalize 來源、不要求未涉及的舊 warning 值符合新政策；結構／byte guard 與 CAS transaction 仍在。不能用該 serializer 授權新的目前資料或 Restore。 |
| `src/features/workspace/hooks/useWorkspaceImportReview.ts:34` | 授權及既有 operation error boundary 內先驗 Legacy 備份，再 normalize／顯示 aggregate impact；確認後仍走 Strict Import API，不在 browser 先配置不可信 count。 |
| `server/middleware/errorResponse.ts` | 將共用 validation error 對應為 `400 {error: 'INVALID_APP_DATA'}`；無欄位值、完整 payload 或其他班級資料。原有 413 與 H01 的安全 409 serializer 保留。 |
| `tests/workspaceValidationSecurity.test.ts`、`package.json` | 新增專用 `test:workspace-validation` 並納入 `npm test`／`verify`；未新增 dependency／lockfile／schema migration。 |

**輸入契約與相容性：** 詳見 [Workspace 輸入驗證契約](workspace-input-validation.md)。主要上限為深度 24、100,000 節點、一般字串 4,096 code units、ID／姓名 200、200 班／每班 500 人／合計 5,000 人；warningPoints 為 0–1,000 整數，timestamps 每組 1,000、整份資料合計 10,000。已宣告一般數值有界且有限，調整金額允許負值，時間戳另有界限。Request 2 MiB、auth 16 KiB、D1 900 KiB **完全未降低**。這些是安全上限，並非正式產品容量或 Worker CPU 保證。

保留缺少新欄位的合法舊 snapshot、root students 備份、舊 goal／隊友／boss reward／feedback history aliases 與合理數字字串的受控 Legacy 轉換。成熟合成資料含 2,000 筆 evidence 及 2,000 筆 point records，原始與正規化版本均在 900 KiB 及節點預算內並通過 schema。新政策超限的歷史來源保持原樣，Restore 明確 400；不自動裁切、刪除、合併或遷移。修復需先授權匯出原件、離線盤點及人工確認，再走具 revision／確認步驟的 Import。若目前資料或歷史超出結構預算，mutation 可能需先受控修復。

**獨立複核及相容性修正：** 一次 fresh read-only review 找到 D1 歷史隱私清理誤套新輸入 schema 的問題。安全 regression 確認 Node 通過、D1 回 400 阻擋刪除；修正後兩者均能刪除 B、保留 A 的超限舊值，且該舊來源仍不能 Restore。複核也指出額外 transport streaming 候選會影響 Node socket／413；該候選已完整撤回，最終 `server/http/body.ts` 語意及 byte limits 保持原狀。沒有宣稱實測 connection reset，亦未以修補 M02 為由更改 transport 契約。未進行第二輪複核。

| 最終驗證 | 結果／證據範圍 |
| --- | --- |
| `npm run test:workspace-validation` | **26/26 通過，零 skip**；負數、小數、超大／非有限值、JSON `1e999`、錯型、過長字串、過深／過寬結構、陣列與 aggregate warning budget、巢狀 safety／exam／settings，以及配置 sentinel。真 API／Auth + JSON／Miniflare D1 驗 State PUT owner／限班 teacher、Import、註冊、持久化歷史 Restore／reload。 |
| 無 partial write | 非法 State PUT 在 `repository.put` 前被拒絕；失敗後 blob、revision history、audit、normalized projection、使用者／workspace inventory 不變。註冊限流計數不在無副作用承諾內。錯誤 body 不包含 B 班合成 sentinel。 |
| 既有相容性 | `npm run test:rules`：94 規則 + 2 architecture cases；`npm run test:imports`：22/22；`npm run test:d1-core`：23/23，包含既有 900 KiB guard。 |
| Browser 相容性 | `npm run test:e2e -- tests/e2e/data-safety.spec.ts`：**6/6**；`npm run test:e2e -- tests/e2e/class-lifecycle.spec.ts`：**6/6**。涵蓋 workspace switching／同步、完整 JSON 備份確認／取代、stale review、舊 local backup、封存／復開／隱私刪除。 |
| `npm run verify` | **通過，exit 0；556/556、零 fail/skip**：94 game rules + 462 Node cases，包含新驗證、既有安全／API／D1／Import／隱私 suites、7 個 checksum-locked migrations、TypeScript、production build／analytics boundary 及 Worker dry-run。既有 Sentry optional Node built-in warnings 仍存在；未放寬 compatibility flags，亦未部署。 |

驗證環境為 Windows／Node `v24.13.0`，所有測試在 managed 暫存副本執行，使用合成帳號、學生與本機 D1。最終副本與工作樹的 **42 個變更 source/test/package/docs 檔 SHA-256 相符**（本稽核報告除外）；`git diff --check` 通過；production assets 沒有 E2E Store／DOM 觀測 globals。最終來源凍結後完整重跑 verify，未以中途版本的結果作為關閉證據。首次受限環境測試程序未完成並被中止，不列為關閉證據；後續同一合成資料副本在核准環境完整通過，未為此放寬程式或測試。

補充證據存於 standalone `artifacts/m02-fix/`：`red-probe.log`、`history-red.log`、`focused.log`、`imports.log`、`d1.log`、`rules.log`、`data-safety-e2e.log`、`class-lifecycle-e2e.log`、`verify.log`、`independent-review.md`、`verification-summary.md`。其中 standalone D1 log 為歷史相容性修正前的既有套件結果；最終 verify 已以修正後來源重跑相同 D1 套件與新 regression。最終 `verify.log` SHA-256：`f4a76af59a78a2e84f8a64fc4fb0555f51495e033b55b049cc305747566e34ba`。因此 M02 標示 **Closed（本機輸入擴張路徑修復及驗證）**。

**剩餘風險／發布條件：** 這次限制 normalization／新寫入的輸入擴張，沒有證明所有 DoS、正式環境負載或超大合法資料都安全。Worker CPU／memory headroom、full-snapshot 成本及併發仍需 V05／M07 量測；低層 request buffering 維持既有行為。部署前須以授權匯出盤點舊超限資料及驗證恢復流程；不可直接改正式 D1 或以放寬上限取代修復。只使用本機合成資料，沒有 production migration、部署或正式會員變更。原封存 scan 保持不變，補充證據另存 standalone `artifacts/m02-fix/`。

### M03 修復與驗證（2026-10-23；Closed：本機修復及驗證，尚未部署）

**原始 Race Condition：** `server/routes/adminRoutes.ts:139` 呼叫 `AuthService.transferWorkspaceOwnership`；service 在 session／workspace／owner 授權後檢查 target 為既有非 owner，交給 repository。D1 原本又在 batch 外讀 source／target，然後 batch 無條件清 scope、條件式 demote source、無條件 promote target／更新 claim／新增 audit。A→B 與 A→C 都讀到 A 是 owner 後，第二個 batch 即使 demote 影響 0 rows，仍會提升 C。D1 的 batch 交易性只能把當次 statement 一起提交，不能補上缺少的成功條件。Node 原本在 mutation queue 內重新檢查角色，能拒絕第二次移轉，但未提供專用 ownership conflict 契約。

同一安全合成 probe 的結果：單次移轉控制組為 1 success／1 owner／1 transfer audit；修復前並行組為 **2 success／2 owners／2 audits**；修復後相同並行組為 **1 success、1 rejected／1 owner／1 audit**。正式 API regression 再以授權入口與 D1 transaction 的雙 barrier 驗證：兩個請求均進入後，回應恰為 **200 + 409 OWNERSHIP_CONFLICT**。這是已授權 owner 操作的完整性問題，不是匿名／teacher 提權。

| 程式位置 | 修正與一致性保證 |
| --- | --- |
| `worker/repository.ts:1464-1523` | 移除 transaction 外 role read 作為寫入決策。第一個 Claim UPSERT 在同一 SQL 驗證 source 是 workspace 唯一 owner、target 存在且非 owner，且既有 claim 仍指向 source；符合條件的 missing claim 可原子初始化。 |
| 同上四個相鄰 statements | Claim CAS 成功 1 row → 單一 `CASE UPDATE` 同時改兩個 memberships（要求 `changes()=1`）→ audit INSERT（要求 `changes()=2`）→ scope DELETE（要求 `changes()=1`）。同一 D1 batch 內不可交錯；loser 形成 0／0／0，不改角色、claim、scope 或 audit。SQL／audit／最後 cleanup 任一步失敗時，整批回滾。 |
| `server/repository.ts:677` | 同一 invariant 在既有 serialized mutate 內檢查，clone 上更新所有內容，檔案 atomic replacement 成功後才發布。失敗保留原檔與記憶體；target 的 creator 欄位同步 D1 行為。 |
| `server/repository.ts:956`、`worker/repository.ts:1923` | Legacy Claim 也在 mutation／SQL 內拒絕另一位既有 owner，避免利用 missing claim 形成第二位 owner；真正 ownerless／unclaimed workspace 仍可認領一次。claim／role 不一致或多 owner 的 Transfer fail closed，未自動挑選 owner 或修復資料。 |
| `server/contracts.ts:403`、`server/middleware/errorResponse.ts:54` | 專用 `WorkspaceOwnershipConflictError` → `409 {error: 'OWNERSHIP_CONFLICT'}`；無 workspace snapshot／成員資訊。新請求若在 source 降權後才驗權，仍回 403，不放寬 RBAC 以強求 409。 |
| `src/features/workspace/components/WorkspaceAccessPanel.tsx:39` | 衝突顯示重新載入成員／權限後再操作的中英文提示，既有 Backend API error 契約保留。 |
| `tests/ownershipConcurrency.test.ts`、`package.json` | 新增專用 `npm run test:ownership` 並納入 `npm test`／`verify`。使用真 JSON repository、AuthService／cookie／CSRF/API，以及兩個 repository 共用同一 Miniflare D1。 |

`server/auth.ts`、Transfer route 與 checksum-locked `migrations/0002_auth_rbac.sql` 已追蹤但無須改動。保留任何既有非 owner（含 teacher／viewer）可被合法提升、source 降為 admin、清兩人 scope、workspace 教學資料／revision 不變及僅成功後通知雙方的行為。沒有角色名稱或權限定義變更。

**方案與 Migration：** 詳見 [Workspace Ownership 一致性契約](workspace-ownership-consistency.md)。本次沿用既有 `workspace_claims` 主鍵及 pointer 做 CAS，不讓它取代 membership 授權模型。新增 partial UNIQUE index 只能保證最多一位，且屬 constraint tightening，需盤點舊重複資料並走既有 migration policy；全新 authoritative pointer 則需改所有授權／生命週期。這兩項均非本修補必要範圍，因此**沒有 schema migration、dependency 或 lockfile 變更**。沒有執行正式 Membership 盤點／修正。

**驗證證據：** Windows／Node `v24.13.0`、managed 暫存副本、本機合成帳號與 D1。

| 命令／檢查 | 結果與驗收範圍 |
| --- | --- |
| `npm run lint` | **通過**。 |
| `npm run test:ownership` | **25/25 通過、零 skip**。A owner、B/C admin 並行；兩個授權及 transaction barrier 均要求恰命中兩次。檢查恰一 owner、claim 指向 winner、只一筆正確 audit、loser membership／無關 scope／另一 workspace／資料 revision 不變、重載一致及只發出 winner 的兩則 lifecycle 通知。 |
| 邊界與回滾 regression（同上） | repository 層的 stale／self／不存在／跨 workspace target、相同 input／timestamp 重播、API RBAC／CSRF、missing claim、mismatched claim、多 owner fail-closed、合法後續移轉；注入 D1 audit 及最後 scope DELETE 失敗，roles／claim／assignments／audit 全部回滾；JSON persist 失敗不發布記憶體或磁碟 partial state。AuthService 既有 self／非法 target 等前置錯誤契約保留。 |
| `npm run test:auth`／`npm run test:server` | **11/11／33/33 通過**，含既有 membership／ownership／legacy claim 及角色、Origin／CSRF 等 API 契約。 |
| `npm run test:e2e -- tests/e2e/permissions.spec.ts` | **2/2 通過**，含 viewer／teacher／admin／owner 權限、正常 ownership UI／API 及 authenticated mutation 的 CSRF／Origin。 |
| 獨立複核 | 一次 fresh read-only source review，未找到具體存續的 M03 bypass／regression；並不宣稱所有直接 SQL 或正式環境都已驗證。複核未執行測試；上述結果由本任務實際執行。 |
| `npm run verify` | **exit 0，581 項通過（94 rules + 487 Node tests），0 fail／cancelled／skip／todo**。包含上述安全回歸、D1 core **23/23**、7 份 migration checksum／分類檢查、TypeScript、production build／analytics 邊界及 Worker dry-run。既有 optional Sentry `node:*` bundling warnings 仍存在，dry-run 成功且未部署。 |

最終執行副本與工作樹的 **46 個變更 source/test/package/docs 檔 SHA-256 相符**（本稽核報告除外；一致性契約的最後日期更新同步副本後再比對）；`git diff --check` 通過，production assets 未包含 E2E Store／DOM 觀測 globals。runtime 來源凍結後完整執行 verify，後續只更新文件與證據，未以中途版本結果關閉。

補充證據存於 standalone `artifacts/m03-fix/`：`red-probe.log`、`green-probe.log`、`lint.log`、`focused.log`、`auth.log`、`server.log`、`permissions-e2e.log`、`verify.log`、`independent-review.md`、`verification-summary.md`。最終 `verify.log` SHA-256：`36081f6d08590b46e065da1b2d734b1f8229b14dd28a8c22c0051dd1a3b2fc70`。原封存 scan 未更動。M03 因而標示 **Closed（本機修復及驗證；正式環境尚未部署）**。

**剩餘風險／有效範圍：** 一致性保證以有效初始狀態與受支援的 application writer 為前提；任意 direct SQL／外部管理工具／未來新增 owner writer 仍須遵守 invariant。D1 由 transaction 提供跨 repository 保護；Node JSON 使用既有 server 單一 repository／process 模型，不支援多個 process 同時共用 JSON 檔案。已存在的多 owner／pointer 不一致須授權核對後個案修復，不得 silent-drop 或任選一人降權。`changes()` 閘門的相鄰順序是必要條件，事後 rows 檢查不是回滾機制。其他 member update／remove 的 stale pre-read 副作用是相鄰議題，未藉本修補宣稱全面重設所有 membership transaction。沒有 production 操作、部署或真實會員資料；原封存 scan 保持不變，補充證據另存 standalone `artifacts/m03-fix/`。

## 6. Low

| ID／狀態 | 位置與風險 | 建議與驗收 |
| --- | --- | --- |
| **L01／潛在維護風險**：型別與 store 邊界偏寬 | `tsconfig.json:2` 未開 strict；`src/store/utils.ts:442,708` 的 any／normalization；`src/services/backendApi.ts:227` 泛型 response；`src/store/useStore.ts:480` 仍集中約 2,696 行。`worker/repository.ts` 2,513 行、auth 1,368 行；Dashboard/api 已分別降至 150/159 行，不能引用舊大小。 | 優先 unknown→validated DTO 與新增 command contract，再漸進 strict/domain slices／selective subscription。驗收新邊界無 any、錯型不越界，既有遊戲／匯入／同步不變；只在量測支持時做進一步效能拆分。 |
| **L02／部分修正；其餘文件偏差待處理** | M01 已同步更正 README 的 cookie、privacy 文件的草稿保留／TTL 與 `VITE_ENABLE_PII_CACHE` 名稱。舊 architecture audit 的缺 staging／CI／migration 描述仍過時；privacy 處理者清單亦未反映已實作 Sentry。 | 持續統一現況與歷史標記，補監控處理者/期限；以測試佐證對外承諾。不因 M01 的文件修正而關閉整項。 |
| **L03／已確認設定，利用需供應鏈事件** | `.github/workflows/deploy.yml:25,28`、`database-expand.yml:23,26` 仍用 checkout/setup-node mutable v4 tag；security/staging 已 SHA pin。`package.json:38,46` 人工 deploy 不隱含 verify/build。 | 對 production 高權限 actions 同樣 full SHA pin、Dependabot 更新；人工發布提供可驗證 build SHA／乾淨 artifact／受控入口。驗收未驗證或陳舊 dist 無法被正常發布流程誤用。 |
| **L04／既有條件風險**：legacy URL token／registration oracle | `src/components/AuthScreen.tsx:50-82` legacy query token 相容，`server/middleware/errorResponse.ts:92-97` duplicate Email 409；`docs/security-review.md` AUTH-02/03。現行寄信用 fragment、token hash/單次/到期，production registration=false，降低目前曝險。 | 確認舊連結來源後移除／限期淘汰 query 相容、檢查 URL log redaction；公開註冊前設計一致外部回應與回歸。不可為隱藏 oracle 破壞忘記密碼 generic 202 與既有限流。 |

## 7. 商業營運產品缺口與決策

以下是商業交付能力，並非全部是安全漏洞。先決定教師主持的機構合約模式或自助 SaaS；已有多 workspace、membership、邀請、owner transfer、audit、匯出／刪除、privacy-safe analytics，不重開同一功能。

| 項目／嚴重度／狀態 | 現有證據與缺口 | 後續工作及驗收 |
| --- | --- | --- |
| **B01／Medium／repository 未見實作**：收費／權益／usage | `server/api.ts:128-140` 的 routes、migrations、`server/auth.ts:1324` workspace creation 無 billing/subscription/seat entitlement。 | 人工合約先建受控 provisioning、到期/席次/容量 ledger；自助付費才加入支付/續約/取消/退款/欠費與 server entitlements。驗收 webhook idempotency/順序、退款取消、server quota；不能只隱藏前端按鈕。 |
| **B02／Medium／潛在機構銷售缺口**：學校組織／年度交接 | `migrations/0002_auth_rbac.sql:29-40` 是 user↔workspace，已有四角色與限班，未見 organization／跨 workspace 校管／年度 rollover。 | 依合約做機構管理、離職交接、學年封存/遷移；SSO/MFA 按客戶要求排程。驗收人員離職後權限撤銷、學校管理邊界與歷史資料政策，不重做已存在 member management。 |
| **B03／Medium／產品邊界待決策**：學生／監護人獨立入口 | README 的「學生端」是互動功能；角色模型沒有 student/guardian，viewer 仍是班級範圍。 | 對外明示教師主持／展示模式。若推出獨立入口，另做 identity mapping／guardian authority／only-own-student DTO/authz／server commands；驗收不能讀同班他人資料，不以 teacher 或全班 viewer 代替。 |
| **B04／Medium／營運流程待補**：客戶導入／支援／帳號自助 | `src/features/teacher-console/components/ConsoleSecurityPanel.tsx:4-11` 指向既有 membership/audit/account；無 session inventory、完整帳號安全自助與支援案件流程。 | 建立試用導入、可理解的失敗恢復、支援 SLA/回報/事件溝通；按需提供 session 管理與密碼變更。驗收客戶可完成 onboarding、帳號事故撤銷與工單追蹤；不引入未受控客服 impersonation。 |
| **B05／High／正式上線前須有證據**：營運責任與供應商 | H06/H07、`docs/observability.md:225-237`。已有技術控制但未證明正式合約、值班、寄信、告警／付款處理者設定。 | 指派 owner／support／security/privacy 窗口，完成 DPA、provider/區域/retention/access、SLO/成本預算與停用程序；用演練與核准紀錄驗收，不以新增一份文件當完成營運。 |

## 8. 正式／staging 必須取得的驗證證據

| ID／優先 | 需要驗證的內容 | 完成標準 |
| --- | --- | --- |
| **V01／P0／Open／Partially Completed（2026-10-27 重驗）** | 當日有效 main rules 仍為 200 `[]`、main protected=false；production protection_rules=[]、branch policy=null、admin bypass=true。Cloudflare token／Secrets scope／其他 publisher 核准仍需管理端證據。 | H05 CI 已合併且 PR／main 功能檢查完整成功；Dependency graph 與 npm audit 子缺口已處理。管理員仍須完成 publisher approval、四項 Required Checks、獨立 review、least privilege 及正負驗收。既有合併後自動 deploy 已成功；本輪只讀紀錄，未執行正式變更。詳見 H05 的 2026-10-27 最終驗收與 `docs/release-protection.md`。 |
| **V02／P1** | 實際 serving SHA／Worker version、同站 cookie/CSP/no-store、migration ledger、normalized verified/mismatch/fallback | 指定 release readback 與合成帳號 smoke；未授權租戶／班級拒絕；沒有使用正式學生資料。成功 workflow 不足以證明此項。 |
| **V03／P1** | Turnstile、Resend 核准寄件者／hostname、verification/reset/invite/lifecycle 實收及錯誤情境 | Checked-in `BOT_PROTECTION_REQUIRED=false`、`EMAIL_VERIFICATION_REQUIRED=true`、`REGISTRATION_ENABLED=false`（wrangler.jsonc:23-27）。未完成前維持受控註冊；公開開放須 required fail-closed、錯 action/hostname/失效 token 拒絕、Email 重放拒絕。false 不代表可斷言 live bot 完全未設定，亦不是當前匿名登入繞過。 |
| **V04／P1** | D1 Time Travel/備份 restore、RPO/RTO、deletion replay | 依 H06 計時演練並核准，釐清 application rollback 與資料還原，恢復後不復活已刪學生。 |
| **V05／P1** | 實際 payload/tenant 規模、>500 cron、latency/CPU/D1/storage/cost、告警 routing | 明確支援容量、headroom、truncated/漏跑通知與 SLO，並有值班責任人。 |
| **V06／P1** | Sentry channels/labels/release、IP retention/scrubbing、provider quota/retention、前端 PII cache build flag | 僅合成 sentinel 驗 allowlist、無敏感資料；kill switch 與通知有效。Worker `SENTRY_RELEASE` 需另同步，不能假設 frontend SHA 自動成為 relay release。 |
| **V07／P1** | 人工 a11y、資料請求、安全交付、合約／隱私窗口 | 對照 M10/H07 的具日期證據與簽核；不將 automated test pass 當完整 WCAG／法律認證。 |

## 9. 本次測試及限制

環境：Windows、Node `v24.13.0`、npm `11.6.2`，暫存副本重用已安裝 `node_modules`，沒有改 lockfile 或重新安裝依賴。沒有將 production secrets 搬入測試；E2E/a11y 只跑本機 `127.0.0.1:3100` 與虛構帳號。兩個 browser suites 依序執行。

| 命令／檢查 | 本次結果 | 範圍與限制 |
| --- | --- | --- |
| `npm run verify` | **通過，exit 0** | 7 個 classified/checksum-locked migrations、TypeScript、`npm test`、production build、Worker dry-run。 |
| `npm test`（由 verify 執行） | **449/449 通過** | 94 game rules + 355 Node test cases，零 fail/skip；D1 23、server 33、privacy 114、auth 11、imports 22 均包含其中。不是 449 個 browser tests。 |
| `npm run build` | **通過** | production analytics boundary check 通過；本次 main entry 約 266.58 kB（gzip 83.80），Dashboard chunk 約 210.25 kB（gzip 51.35），不是大型資料負載證明。 |
| `npm run check:worker` | **通過，dry-run** | bundle 515.55 KiB／gzip 108.77 KiB；Sentry optional integrations 的 Node built-in 警告仍存在。既有 workerd runtime tests 亦通過，不能僅因 warning 要求放寬 nodejs_compat。沒有部署。 |
| `npm run check:worker:staging` | **通過，dry-run** | 合成 offline staging 設定、獨立 epet-staging binding；不等於遠端 staging 已布建／測通。 |
| `npm audit --audit-level=high --json` | **通過，0 vulnerabilities** | 查詢時 info/low/moderate/high/critical 均 0；限於 npm 回報的已解析 dependency graph，不保證 bundled CLI 內嵌程式或未知弱點皆安全。 |
| `npm run test:e2e` | **52/52 通過，約 3.5 分鐘** | Chromium + Node JSON adapter；與 production Worker/D1 browser integration 不同。 |
| `npm run test:a11y` | **20/20 通過，約 1.8 分鐘** | 48 個不同 axe 掃描狀態，所有嚴重度 confirmed violations 均為 0；21 個狀態有 color-contrast incomplete，需人工量測。JSON attachments 複本去重後計數。 |

首次 sandbox verify 在 auth JSON 暫存檔 atomic rename 遇 `EPERM`，因此不能當產品 auth 回歸失敗；相同現有命令在同一隔離副本、核准的沙箱外執行後 verify 全部通過。沒有為此改測試斷言／降低 auth/CSRF/RBAC 或變更程式。

GitHub 的相同 SHA 已有成功的 [Production deployment run](https://github.com/andreww0421/epet/actions/runs/38923554385) 與 [Security run](https://github.com/andreww0421/epet/actions/runs/38923554593)。這是正向 CI 證據；本次未重跑遠端 workflow，也不以此代替 V01–V07。未執行 remote staging smoke（缺本次已確認的 staging target／正式 provider 測試情境），未做負載／破壞性測試或手動 screen reader。

安全發現由現行來源逐步追蹤、獨立複核；沒有新增漏洞測試、執行耗盡資源 payload 或以真實資料動態利用。測試全過只表示**既有** assertions 通過。H01/M01/M02、ID 碰撞、owner race、409 完成恢復、413 terminal、>500 cron 等仍需後續定向 regression。另對 373 個 current tracked paths 執行 provider token／private key／JWT／敏感賦值模式搜尋與候選內容判讀，未確認嵌入式憑證或私鑰；此項與 npm dependency audit 分開，不涵蓋 Git history 或供應商 secrets。

## 10. 優先順序、工作清單與退出條件

| 階段 | 工作／建議 owner | 退出條件 |
| --- | --- | --- |
| **P0：先關閉明確資料風險及恢復斷點** | Backend/Security：H01、H02、M02、M03；Frontend/Backend：M01、H03、H04；Repository admin：H05/V01 | 限班 error 不洩漏；清理只影響選定 identity；草稿隔離與 scope 正確；409/413 可完成恢復；single-owner race 有測試；危險輸入在 normalization 前拒絕；負向 PR 證明閘門有效。 |
| **P1：付費公開推出前** | QA/Platform：M04/M05、V02/V03；Operations/Privacy：H06/H07、B05；Backend：M06/M08、M07 容量與盲寫契約驗收、M11 密碼 policy benchmark／遷移計畫；Design/QA：M09/M10；Platform：M13/V04–V07 | synthetic staging Worker/D1 核心旅程、指定 SHA smoke、實收郵件/bot、計時 DR、核定 retention/DPA、值班告警、主要 a11y 人工驗收與 browser gates 全部具證據；容量與密碼 CPU budget 已量測並有核准方案。 |
| **P2：依商業模式與規模逐步交付** | Product：B01–B04；Backend：依 P1 結果實作 M07 command／增量寫入、M11 漸進 rehash，再交付 M12；Frontend：L01；Platform/Docs：L02–L04 | 定義付費/機構/學生入口契約；第一個 authoritative command 完成，容量/成本量測達標；漸進 strict/rehash/組織及自助功能；每項可獨立回復。 |

- [x] H01 已完成 metadata-only fallback、明確授權 snapshot 相容性與 Node／D1 regression；463/463 verify 與定向 10/10 E2E 通過。正式發布仍待既有發布流程。
- [x] H02 已完成 composite identity 修補、22 個 JSON／D1 regression、139/139 privacy、23/23 D1 及 488/488 verify；Closed（本機），正式發布與既有資料人工盤點仍待執行。
- [x] M01 已完成 user／workspace／role／class scope binding、fresh authorization、24h TTL 及安全恢復；Draft/API 42/42、新 E2E 10/10、相容性 E2E 15/15、verify 530/530 通過。Closed（本機），正式發布與環境驗收待執行。
- [x] M02 已完成 normalization 前共用有界 schema、配置預算與歷史相容性修補；26/26 新 regression、12/12 E2E、556/556 verify 通過。Closed（本機），正式發布前仍須盤點既有超限資料及容量驗收。
- [x] M03：完成 Node／D1 原子 Ownership Transfer、Legacy Claim invariant 及失敗回滾；新增 25 項 regression、權限 E2E 2/2，最終 verify 581 項通過。Closed 限本機修復及驗證，正式環境尚未部署。
- [x] H03：完成真實 409 的明確採用遠端／保留草稿導覽、受權限限制的草稿下載及恢復 Autosave；新 E2E 8、既有相容性 18 全通過，verify 583 項通過。Closed 限本機修復及驗證，未部署。
- [x] H04：完成永久容量／驗證拒絕、有界重試／Retry-After、受控保留／採用及授權清理；Node／D1 capacity 26、相關 E2E 35、verify 631 項通過。Closed 限本機修復及驗證，未部署；900 KiB 儲存模型及正式容量驗收仍待後續工作。
- [ ] 獨立追蹤既有 Restore UI 在 flush 等待期間切換 workspace 的目標固定／mount guard，補導航競態 regression；勿把 repository 容量原子性測試誤當 UI 生命週期的完整證明。
- [x] 備妥無 production secrets 的 Functional PR CI、穩定 aggregate、Actions pins 與 Main Ruleset 提案；正常／故意失敗 PR 已實測，保留既有 security/staging/migration controls。套用為 main 必要閘門仍屬下列外部待辦。
- [ ] H05／V01（2026-10-27）：CI／依賴修復已合併，Dependency graph、npm audit、完整功能／browser checks 已驗證；production／原生 publisher 審批、管理端 main policies、least privilege 及無 bypass 拒絕／approval 驗收尚未完成，維持 Open，禁止直接發布測試。
- [ ] 完成 synthetic staging、release readback、post-deploy smoke、相容 rollback 與 DR 演練。
- [ ] 指派 retention／DPA／資料請求／客服／值班 owner；完成供應商清單及費用／容量預算。
- [ ] 依正式契約決定人工合約或 self-service billing，以及教師主持或學生獨立入口；不先開放公開註冊再補 entitlement／隱私邊界。
- [ ] 修正文檔與實作矛盾，保留舊稽核日期與已關閉項目，避免後續重複開發。

**GA 驗收不是單次 test pass。** 需 P0 全關閉、P1 有具日期的環境／營運證據、剩餘風險有明確接受人與期限；在此之前維持受控範圍。H01／H02／H03／H04／M01／M02／M03 本機修復已驗證，但正式環境仍需經發布後才能確認更新，即使仍是邀請制也不能忽略同工作區跨班保密、衝突／容量恢復與 Ownership 一致性。

## 11. 補充安全掃描紀錄

Codex Security Standard scan `49a57c9a-8d1b-440a-a678-4525359ee3be` 已完成，獨立記錄 1 High（H01）與 2 Medium（M01/M02）來源驗證安全發現；商業報告另含資料正確性、可用性與營運風險，兩者計數口徑不同。安全覆蓋明確標為 partial，不宣稱全 repository 每一行或正式環境均已驗證。Canonical manifest/findings/coverage、來源威脅模型與本次測試 logs 保留在工具產生的本機掃描 artifacts。

工具回報彙總 usage：6 個 threads、input 16,506,021 tokens（其中 cached input 15,764,992）、output 89,230、total 16,595,251。這是工具記錄的執行緒彙總，包含重複快取上下文，不是本報告自行估算的費用或付費 token 數。

完成時工具提示 working tree 改變；最終 Git 檢查確認唯一變更為本次要求新增的 `docs/commercial-readiness-audit.md`，所有 tracked 產品來源及 HEAD 仍為上述 main snapshot，沒有為消除提示修改或重建掃描。

## 12. 會員／登入安全強化增量驗收（2026-10-29）

**任務狀態：Partially Completed。** 低風險應用層修補及本機驗證 Completed；正式 Turnstile／Email／CPU 與受保護發布仍待人工，尚未部署。本節針對目前工作樹，不將先前尚未提交的 H01～H04／M01～M03 修正當成本次新增，也不宣稱遠端 main 或正式服務已採用此版本。

| Finding | 狀態與證據 |
| --- | --- |
| **AUTH-04／High：reset 後舊登入／邀請仍能發行授權** | **Closed（本機修復與驗證，2026-10-29）；尚未部署。** Node 與 D1 的 Session 插入會原子比對 active user 的完整 credential；邀請接受的驗證／消耗／Audit／Membership／Class assignment 同步受條件控制。修復前相同 regression 4 pass／9 expected fail；修復後 13/13 pass。 |
| **AUTH-01／Medium：PBKDF2 成本** | **Open。** 維持 100,000；本機跨 runtime 舊 credential 相容性已驗證，但未取得正式方案／CPU／hosted 支援證據，未提高 iteration 或執行 rehash。 |
| **AUTH-02／Low：舊 query lifecycle tokens** | **Open。** 保留現有舊連結相容性；需確認既有 sender 與 CDN／origin／telemetry redaction，不因本次修補宣稱已消除外部 URL log 留存。 |
| **AUTH-03／Low：公開註冊 enumeration** | **Open，來源設定仍關閉註冊。** 公開註冊需另改 response contract 及獨立核准，不以 health flags 自動開啟。 |
| **H05／V01、M05、V02／V03 外部 gates** | 維持原 Open／未完成狀態。沒有變更 Ruleset、Environment、Cloudflare token、正式部署或資料；Staging 尚未建置，不能宣稱真金鑰與 live D1 已驗收。 |

### Root Cause 與修復前後

舊 `AuthService.login` 先取得 user／驗 password snapshot，再呼叫無條件 `createAuthSession`。reset 的交易雖撤銷既有 Session，但在它之後才插入的舊登入 Session 仍可存活；既有會員接受邀請也可在 reset 後以舊 snapshot 新增 Membership。D1 原本對同會員同毫秒邀請以「Membership 已存在」當成功 fallback，兩個並行接受可能都成功且留下重複 Audit。

修復將比較放在 Node 既有原子 mutate 及 D1 條件 INSERT／batch 中，涵蓋 algorithm、salt、hash、iterations 及 active status，而非僅比較可能相同的 `passwordChangedAt`。reset 先完成時登入回既有 `401 INVALID_CREDENTIALS`、不建立 Session／login Audit；過期驗證的邀請回既有 `400 INVALID_WORKSPACE_INVITATION`，沒有新增 Membership、Class assignment、token consumption 或 acceptance Audit，合法新密碼可重試。若 Session 先插入，後續 reset 仍撤銷它。先合法提交的邀請不會被之後的 reset 回滾，其 Session 發行仍受 credential 條件限制。

### 本次修改範圍與相容性

本次共 **11 個檔案**：`server/auth.ts`、`server/contracts.ts`、`server/repository.ts`、`worker/repository.ts`、`tests/auth.test.ts`、新增 `tests/authConcurrency.test.ts`／`tests/authProtection.test.ts`、`package.json`、`docs/security-review.md`、`docs/p1-account-security-cutover.md`、本報告。逐檔用途與 source-to-sink 分析見 [安全審查 AUTH-04](security-review.md#2026-10-29-會員與登入安全強化)。

**不需 Schema Migration、新 Secrets 或 flags 變更。** 沒有變更會員、學生、班級、遊戲、Workspace／備份資料模型、角色名稱或權限定義；密碼演算法／預設 iteration、Cookie、CSRF、Origin、body limits、限流與 Revision 保護保留。內部 repository interface 須隨服務一併更新；既有不同 iteration 的密碼可繼續驗證。沒有改 lockfile、Wrangler config、workflow 或 Production 設定。

### 實際驗證

所有測試僅用隔離副本、合成帳號／班級／學生與本機 Miniflare D1；沒有讀取正式會員、verifier、Secret 或學生資料。

| 實際命令／驗收 | 結果 |
| --- | --- |
| `node --import tsx --test tests/authConcurrency.test.ts` 對修補前／後 snapshot | **前：4 pass／9 expected fail；後：13 pass／0 fail/skip。** 包含 reset 的兩種排序、同毫秒同密碼、完整欄位 CAS、disabled／missing user、持久化重載、合法限 A 班 Teacher、11 個並行同 subject 登入限流及 D1 單次邀請。 |
| `npm run test:auth`（verify 實際呼叫） | **30 pass／0 fail/skip**：12 auth、13 concurrency、5 protection。Turnstile 覆蓋 non-2xx、malformed/null JSON、非 boolean success、網路拒絕、五秒 abort／timer cleanup、2,048／2,049、缺設定 fail-closed；外部 fetch 全部 mock。 |
| `node --import tsx --test tests/auth.test.ts tests/d1-core.test.ts tests/ownershipConcurrency.test.ts` | **60 pass／0 fail/skip**（12＋23＋25），實際 D1 migrations／RBAC／tenant／Ownership 行為保留。 |
| `npm run test:e2e -- tests/e2e/authentication.spec.ts tests/e2e/permissions.spec.ts tests/e2e/data-safety.spec.ts tests/e2e/class-and-teacher.spec.ts` | **15 pass／0 fail/skip**：真本機瀏覽器 cookie、登出／過期 Session、CSRF／Origin、角色、班級教師操作、Workspace switching／conflict 草稿安全。 |
| `npm run verify` | **exit 0；678 pass（94 legacy rules＋584 Node cases）、0 fail/skip**。7 個 checksum-locked migrations、TypeScript、所有 Node／API／D1／隱私／安全測試、production build／analytics boundary、Worker dry-run 均成功。既有 Sentry optional Node built-in warnings 保留，沒有藉此改 compatibility flags。 |
| 本機 workerd PBKDF2 probe | legacy 1,000／目前 100,000 Node credential 驗證成功，錯密碼拒絕；本機單次 100,001 probe 可執行。100,000 的 host dispatch wall median **50.195 ms／5 samples**，不是正式 CPU 或 hosted 上限證據。 |
| Fresh 獨立 candidate review | 未找到具體 in-scope bypass／regression；reviewer 的 D1 sandbox 未能執行，主要執行已完成真 Miniflare D1，兩者範圍分開紀錄。 |
| 來源／格式 | 測試副本與目前 **64 個變更 source/test/config 檔 SHA-256 相符，0 mismatch**（文件另行更新）；既有 repo 設定的 `git diff --check` 通過。lockfile SHA-256 仍為 `75192bb192a5efb7541ce2ebd794ef6c097a9a2963cec80d26522ab6858848a9`。 |

完整 verify log SHA-256：`b2b438d6d2388b74248160b3fa229d1e92845b075b83a27ea63a7a5424799934`。證據另存 Codex Security standalone `artifacts/auth-hardening-2026-10-29/`；初始受 sandbox／暫存路徑影響而中止的診斷、修正測試預期值的原因亦記於安全審查，不把它們算成通過。

### 人工切換、風險與後續工作

- 先建立真正隔離的 Staging Worker／D1／provider，使用合成測試帳號驗真 Siteverify、hostname／action／逾期／重放、信件實收及登入後 D1／class scope；health 能力 flags 不能取代此步驟。
- 依 [切換／回復計畫](p1-account-security-cutover.md) 經獨立 Review、必要 CI 與 Production Environment approval 發布，記錄 immutable commit／Worker version／操作人／時間。本次沒有 push／merge／部署，也沒有修改正式權限、Secrets 或 D1。
- PBKDF2 待管理員取得 live plan／CPU metrics，另做有界合成負載及相容 credential CAS migration 設計；目前沒有執行會員 rehash。正式 Turnstile 設定須先驗真 key，再獨立核准 mandatory flag；公開註冊持續關閉。
- 本修補無破壞性 Migration；優先 forward-fix。必要時經事故核准回復相容應用版本、保留 D1／migration ledger／已重設密碼，不能還原舊 verifier。未修補舊版會重開 AUTH-04，須暫時受控入口並立即補修。

本次可進入下一個獨立、受控的程式修復任務；**不代表已通過 GA 或正式會員安全切換驗收**。應用層 AUTH-04 已驗證；既有正式營運 gates 與 AUTH-01～03 不以完成測試為由關閉。

## 13. D1 資料保護與災難復原增量驗收（2026-10-30）

**本次程式／測試／小型 synthetic staging DB 演練完成；正式復原就緒度 Partially Completed。H06／V04 保持 Open。** 沒有讀寫 Production D1、使用真實學生／既有會員資料、變更正式 Secrets、發布 Worker 或執行正式 migration。

### 已有能力與新增改善

既有 7 個 checksum-locked migrations、獨立 expand 流程／application 唯讀 ledger gate、workspace CAS／write-token projection guards、25 份 application revisions、composite student identity、班級封存／刪除／歷史 purge 與 rollback tests 均沿用，沒有重做或改寫舊 SQL。Application revisions 與 Worker rollback 仍不是獨立災難備份。

缺口在於復原後缺乏可重複的完整驗收：正常讀取會 blob fallback，`reconcile(..., false)` 也會寫 status；僅看 counts／cached verified／health 可能漏掉資料或 schema 損壞。整庫復原還可能帶回已刪學生、已撤銷 scope、Session、舊密碼與單次 token。

| 本次修改檔案（12 個） | 用途 |
| --- | --- |
| `worker/recoveryValidation.ts`（新） | 唯讀、去敏、分頁／資源有界的復原檢查；要求獨立可信 `expectedSchema`／`expectedMigrations`，驗 SQL definitions／ledger default/unique／quick-check／FK／ownership／scope／current & history／全部 projection rows 及 indexed scalars；錯誤或截斷 fail closed，不自動 repair。 |
| `worker/repository.ts` | 加入不更新 reconciliation metadata 的 reconstructed projection inspection；完整 DR 驗收仍使用較強的 validator，原有讀寫／fallback 行為保留。 |
| `scripts/disaster-recovery.ts`（新） | 固定 synthetic fixture、兩個 fresh 本機 D1、真 SQL export/import、精確 round-trip、獨立模擬 journal 的 privacy／auth 補償及 CAS；可程式化匯出固定合成 fixture，CLI 不接受 resource／remote／file selectors。 |
| `tests/recoveryValidation.test.ts`、`tests/disasterRecovery.test.ts`（新） | 正常與故障／損壞案例、去敏／唯讀、legacy 相容、容量邊界及完整合成復原／刪除重套 regression。 |
| `package.json` | 新增 `test:recovery`、`db:drill:local`，納入既有 verify。無 dependency／lockfile 變更。 |
| `docs/disaster-recovery.md`（新） | 備份、復原、撤回、分段紀錄、隔離／privacy／auth gate、RPO/RTO 提案、平台限制及實際 evidence。 |
| `docs/database-migration-policy.md`、`docs/p0-operations-runbook.md` | 對齊分離 migration／application release，補還原後的 schema／ledger gate 與 DR 入口，避免舊 runbook 要求一律先套 migration。 |
| `docs/class-archive-lifecycle.md`、`docs/privacy-data-governance.md` | 對齊整庫還原與受控 revision restore 的差異、tuple identity、獨立 suppression journal 與刪除後重套。 |
| 本報告 | H06／V04 日期化部分完成狀態及驗證界線。 |

### 實際測試與 remote 證據

| 實際執行 | 結果／適用範圍 |
| --- | --- |
| `npm run test:recovery` | **19 pass／0 fail/skip**，真本機 Miniflare D1，包含損壞／部分 schema／same-count projection／cached status／歷史及 ledger 防護。 |
| `node --import tsx --test tests/disasterRecovery.test.ts` | 最終 **4 pass／0 fail/skip**；包含可重複 fixture 匯出 callback、完整還原／補償與 UTF-8 SQL 上限，不用降低條件取代實測。 |
| `npm run db:drill:local` | **exit 0**；23 表、2 workspace、7 migrations、9 項完整資料／隱私／auth／CAS checks 均 true；輸出只含摘要，`privacyStatus:not_verified`、平台 Time Travel／RPO／RTO 不冒充已量測。 |
| `npm run lint` | 最終 **exit 0**。 |
| `npm run verify` | **exit 0；697 pass（94 legacy rules＋603 Node cases）、0 fail/skip**；涵蓋原有 API／D1／tenant／privacy／archive／revision／auth suites、migration checksum、build、analytics boundary 與 Worker dry-run。既有 Sentry optional Node built-in warnings 保留。 |
| 遠端 synthetic source | 新建 `epet-dr-source-20261030-fc2c0986`，UUID `75e9e6cd-7d20-4f92-b642-eec1bab873fd`，未綁定 Worker；先驗空庫，再載入固定合成資料。 |
| 遠端 synthetic target | 新建 `epet-dr-target-20261030-fc2c0986`，UUID `dc79cafa-da74-4dd6-9969-ceaeabf565b5`，未綁定 Worker；只在空庫核對後匯入 source export。 |
| 實際 Time Travel／undo／CAS | 以 baseline bookmark 回復、確認故意新增的 revision 變更消失；以 provider 回傳 previous bookmark 撤回後該變更出現，再回 baseline。Stale CAS `changes=0`，沒有用不安全 read-then-write 代替 CAS。 |
| 遠端 SQL export／import | 成功。Target 直接查 `quick_check=ok`、FK violations=0、migrations=7、workspaces=2。原始 baseline／remote source export／remote target export 再各匯入新的本機 D1，唯讀 validator 全部通過、0 issues；23 表 schema／全部 rows／ledger 摘要完全相同。完整 validator 是驗 exported copies，不宣稱在 hosted Worker 執行全部檢查。 |
| 來源／模型／格式 | 68 個變更 source/test/config SHA-256 與驗證副本相符；`git diff --check` 通過。既有 `worker/projectionStatements.ts` 與本任務開始的 bytes 相同；沒有改 migrations、Wrangler config、workflow、原本資料模型或既有角色／學生成績／遊戲數值。 |

完整 verify log SHA-256：`033652e5ca7aeac376b38679b019f72de9f9b0579510d61d5411ec55498edc28`。三份相同 canonical manifest：`6e6c82e5e0322f4dc56c7df8c2f59ad6df35c91e9ceb1875f27908620404ed64`。Logs、aggregate remote report／readback、schema／digest、複核紀錄另存 standalone `artifacts/disaster-recovery-2026-10-30/`；不提交合成 SQL 或任何真實學生資料。

### 風險、相容性與後續工作

**無新 Schema Migration、正式 Secret 或部署要求。** 新工具不進 public API／cron，舊讀寫及所有歷史 SQL 保留。檢查會接受 harmless ledger id gaps、合法跨班／跨 tenant 重複 Student ID 與 history 中未涉及的舊 scalar／null optional／extension fields；不會刪除、合併、重編 ID 或 silent-drop。損壞或超過 current policy 的來源回 blocked 保留原件，另做受控盤點／修復。

Fresh read-only review 找出兩個新 checker 缺口並已補 regression：歷史 `{}` 雖可解析卻會讓 privacy purge crash；ledger 缺 timestamp default／name unique 雖已有 rows 正常，下一次 Wrangler migration 會失敗。另在真 D1 確認 `_cf_METADATA` 屬平台 reserved namespace，應與 export 一致排除；沒有略過 application objects。D1 authorizer 不支援的 full `integrity_check` 改用支援的有界 `quick_check(1)` 加上精確業務資料／FK／schema 檢查，不宣稱兩者涵蓋相同。初版開發失敗及 CLI 參數／JSON progress 診斷保留說明，未刪除測試或放寬驗收。

**確認的平台容量限制：** 合法 900 KiB snapshot／history 可以匯出成超過 D1 單一 SQL statement **100,000 bytes** 的 INSERT。新增通過 runtime schema、超過 150 KiB 的合成 Workspace JSON row 實際 export 測試，證明需在任何 target write 前停止；UTF-8 上限、Unicode 與精確邊界有 regression。沒有提高或降低 application 900 KiB guard、裁切資料、略過歷史或假設拆檔可處理單一大 row。大型 SQL fallback／參數化還原仍待實作及遠端容量驗證。

**正式復原 blockers：**

- 獨立於被還原 DB 的完整 privacy／security suppression journal、加密備份排程、存取／保留／到期銷毀與失敗告警仍未建置；現有 audit 與 application revisions 不足以代替它。
- Remote 演練只驗小型 DB 的 SQL／Time Travel／undo、直接 aggregate checks 及 exported-copy 完整性；privacy／auth replay 已在實際本機 D1 驗證，未在 remote 完成完整 journal／登入／mail／cron／維護隔離／重開驗收。這兩個 DR DB 不是既有 staging application 上線。
- 正式 account 方案／Time Travel 歷史窗口、實際負載、值班／隱私窗口與 RPO／RTO 未量測或簽核。Runbook 的 15 分鐘／4 小時、24 小時／1 工作日僅是提案，不是 SLA；provider 四秒左右的小型操作不是正式 RTO。
- 人員 OAuth 的 D1 權限較廣；這次使用獨立 config／空 env-file／ambient override 清理／固定 account 與新 UUID，沒有修改 IAM 或宣稱 DB 級最小權限。日後自動化需另設最小 scope 與隔離帳戶。
- 兩個 synthetic DB 保留供覆核，沒有 application binding；核對 account／精確 UUID／無人改作其他用途後再刪除，清理尚未執行。沒有觸及 Production D1 或發布任何 Worker。

具體可重複程序、停止條件、復原後補償、正式未來操作與回復計畫見 [disaster-recovery.md](disaster-recovery.md)。可以繼續下一個受控 P0 程式修復；不能據此宣告 GA 或 H06／V04 正式結案。

## 14. Production CI/CD 增量驗收（2026-10-31）

**Workflow 與唯讀 smoke 程式已完成 mock／本機驗證；正式發布、通知送達及外部保護尚未驗證。H05／V01 保持 Open。** 本次未 push／merge／dispatch workflow、部署 Worker、讀寫 Production D1、建立正式帳號／學生或更改 Secrets／IAM。收尾 harness 有一次提前載入 CLI，意外向正式首頁送出未登入 GET；資源 manifest 不符即停止，沒有呼叫正式 API。此事另記於下方，不算正式 smoke 驗收。

### 問題與修正

既有 application pipeline 已有 `npm ci`、`npm run verify`（migration policy、TypeScript、tests、build、Worker dry-run）及發布前唯讀 migration ledger gate，並與 expansion workflow 共用 concurrency。缺口是發布命令成功後沒有驗證對外入口／assets／API，且失敗缺乏明確接手與回復程序。既有 staging URL、method、redirect 護欄及三項 login UI／health／anonymous smoke 沿用。

Production 現在發布後執行固定 origin、GET-only、無登入憑證的 smoke：比對本次 build 的入口 JS／CSS／modulepreload paths、實際 bytes／SHA-256、health contract、三個未登入 API 的 401 及現有 response headers。禁止跟隨 redirect、讀取 anonymous response body 或以 remote HTML 中任意 URL 作請求。最多 3 次嘗試，只有網路／408／429／500／502／503／504 可有限重試，遵守 Retry-After；10 秒 request、90 秒全程預算、decoded body／asset 數量與大小均有界。終止錯誤不重試、不寫資料、不自動 rollback。

Production／staging 失敗或取消時提供 annotation／job summary、run／logs／runbook link 及 deploy／smoke outcome。發布成功但 smoke 失敗仍使 job 失敗，可能仍有該版在服務；發布命令失敗／timeout 也不能推定沒有生效。人工確認實際版本、現有 schema 相容性及事故核准後，才選 reviewed forward fix 或特定版本的 Worker rollback。D1、ledger、資料與原有獨立 migration release policy 保留。

### 本次修改檔案（10 個）

| 檔案 | 用途 |
| --- | --- |
| `.github/workflows/deploy.yml` | 發布後 smoke、2 分鐘 step 上限、失敗／取消接手摘要；不將 Cloudflare credentials 注入 smoke。 |
| `.github/workflows/staging.yml` | 沿用隔離驗證／migration／deploy／browser smoke，補驗證與發布失敗摘要及 smoke timeout。 |
| `scripts/production-smoke.mjs`（新） | 固定目標、GET-only、有界且去敏的部署檢查；本機 build manifest／asset digest 比對。 |
| `tests/deploymentWorkflow.test.mjs`（新） | 發布前後順序、environment／權限／concurrency、migration 分離與真正執行 failure-summary shell。 |
| `tests/productionSmoke.test.mjs`（新） | mock、真實本機 Worker、HTTP gzip、abort／retry／大小／資料不讀取回歸。 |
| `package.json` | 新增 `test:deployment`、`smoke:production`，將離線部署測試加入 `npm test`／verify；不把 live smoke 加入 verify。 |
| `docs/production-deployment.md`（新） | 部署檢查清單、通知接手、失敗分類與人工回復。 |
| `docs/staging-deployment.md`、`docs/p0-operations-runbook.md` | 對齊兩環境的唯讀 smoke／失敗流程，維持正式資料寫入限制。 |
| 本報告 | 日期化證據與 H05／V01 未完成界線。 |

`server/routes/systemRoutes.ts` 已檢查但無須修改：health 僅為公開 configuration contract，沒有新增 DB probe、build secret 或登入路徑。沒有改 schema／資料模型、密碼政策、RBAC／CSRF／租戶與班級 scope、revision protection、lockfile、Wrangler configs、既有 migration SQL／policy 或 `database-expand.yml`。

### 驗證與外部 gates

- 隔離副本 `npm ci`：exit 0，既有 lockfile 安裝成功，沒有 dependency 升級。
- `npm run verify`：exit 0，**724 pass（94 legacy rules＋630 Node cases）、0 fail/skip**；包含新增部署 suite 與既有 API／D1／auth／隱私／revision／ownership suites、migration checksum、TypeScript、build／analytics boundary、Worker dry-run。保留 Sentry／SQLite 非致命 warnings，未變動 compatibility flags。
- 最終 `npm run test:deployment`：**27 pass／0 fail/skip**；9 項 workflow 與 18 項 smoke／transport 檢查。完整 verify 後強化同一 CLI test 的 preload 隔離與 Windows file URL，另外重跑通過；應用／smoke runtime 未再修改。測試重跑有重疊，不重複累計通過數。
- 實際 build 的 CLI＋本機 Worker mock：exit 0，5 assets／10 mocked GET／0 retry；無 D1 access 或背景工作。`npm run check:worker:staging` exit 0；YAML 1.2 syntax check 3 份 workflow 通過。這些是本機證據，沒有執行 GitHub runner 或遠端 application staging。
- Health／401 可以不讀 D1 就成功；實際本機 Worker 測試對任何 D1 access／背景工作／外部 fetch 都會拒絕，確認本次請求未觸發它們。這不等於正式 D1 binding、authenticated RBAC／tenant isolation、Email／Turnstile／cron 已驗收。
- GitHub summary 不是通知送達。值班人需核對 native Actions notification 的觸發者／preferences 限制並實測 receipt；集中式 on-call delivery 未建置／未驗證。Forced termination 也可能使最後摘要無法執行。
- GitHub branch rules、production reviewers／deployment branches／bypass、token IAM，以及 Cloudflare 原生 Builds 是否有等效 gates／單一 publisher，仍需管理員核對。本次未變更或重新宣稱它們已生效。
- 真正 staging application 仍須獨立啟用與驗收；既有兩個 DR-only DB 不是 application staging。Production live smoke、通知送達及人工 rollback 演練均未執行。

本次不需要新 Schema Migration、Secrets 或正式環境切換。外部操作步驟、停止條件與回復清單見 [production-deployment.md](production-deployment.md)；可繼續下一個受控程式任務，但不能以本次測試結案 H05／V01 或宣告正式 CI/CD 保護完整生效。

Verify log SHA-256：`795ee5da30d9bf2df268127c1bb4e4a82f7ebbb6b62e9bd1d2ee59c8eedd51e8`。最終 source／test／config 與執行副本對照 85 份檔案，包含關鍵未改 migration／config，0 mismatch；完整 verify 後僅強化上述 CLI test，另有最終 suite 證據。Lockfile SHA-256 仍為 `75192bb192a5efb7541ce2ebd794ef6c097a9a2963cec80d26522ab6858848a9`。

**Harness 誤觸：** 一次臨時 preload import CLI helper 導致 mock 安裝前執行 main，實際正式首頁 GET 因 manifest 不符立即失敗。只有一次無憑證首頁讀取，沒有正式 asset／API／資料或部署操作；不算正式驗收。已先封鎖 fetch、移除 preload 對 CLI 的 import 並補獨立 CLI regression，修正後 10 次 mocked GET 成功。詳見 Runbook 的誤觸與修正紀錄；不將該次失敗藏成 mock 成功。

## 15. 營運監控增量驗收（2026-10-31）

最終本機驗收日期：**2026-11-01**。正式環境的唯讀證據仍為 2026-10-31 查核，不宣稱今日重新讀取。

**程式／本機合成驗證已改善；正式營運監控 Partially Completed。M13／V05／V06 維持 Open。** 本次沒有 push／部署、正式 D1 讀寫、會員／學生資料查詢、Secret 值讀取或設定變更，也沒有建立 Sentry projects／rules／送出正式事件或通知。

### 現況證據與根因

既有 Sentry 已有錯誤 allowlist、多層重建、獨立 client／scope、timeout／quota、敏感 canaries 與 fail-silent 設計，不重做 SDK 或開 Replay／Tracing。原缺口包括 D1 normalized fallback 與投影異常不形成分類訊號、Cron 只有執行失敗而缺少明確 completion／partial evidence、忘記密碼在沒有 mailer 時仍以 202 隱藏帳號存在性、SDK dispose 的 rejection 可逃出 waitUntil。

Cloudflare 是另一個隱私邊界：原本 `observability.enabled=true` 的 default invocation logs 可保留 URL／metadata，Worker 外層及 Cron 又會重拋原始 error。Sentry 去敏不代表平台自動 logging 也安全。

| 實際唯讀核對 | 結果與可推論界線 |
| --- | --- |
| 正式 `GET /api/v1/monitoring` | 404／no-store；未附認證、未讀 body、未 POST event。與通道 disabled／invalid 或 serving route 不符相容，不是 delivery 驗收。 |
| 指定 account／`epet-api` 的 Secret 名稱 | `SENTRY_DSN`、`SENTRY_FRONTEND_DSN` 均 absent；只輸出這兩個 boolean，未讀值或列其他 names。不能據此排除非法 plain vars 或宣稱平台 telemetry 全關。 |
| GitHub `EPET_MONITORING_ENABLED` | exact production-variable readback unavailable，前端 build 狀態為 unknown。 |
| Sentry／平台 receipt、privacy、alert、Cron absence | 未取得管理端／合成接收／通知證據，維持未驗證。 |

因此不能確認正式 Sentry 監控已真正啟用；需要先完成環境 Secrets、privacy 與 synthetic receipt，再另行核准 production 切換。`health=200`、relay acceptance 或「沒有事件」都不足以證明健康。

### 本次修改檔案（20 個）

| 檔案 | 用途 |
| --- | --- |
| `shared/observability/policy.ts` | 延伸固定 `worker.database`／`worker.projection`／`worker.email`／`worker.configuration` 分類，保留所有既有欄位重建與 prefix／status 限制。 |
| `shared/observability/operations.ts`（新） | 純函式建立有界、分鐘時間／耗時區間／投影統計／coverage／health 的營運摘要；不接 SDK／DB／網路或原始 exception。 |
| `worker/monitoring.ts` | 同步／非同步 flush／dispose 錯誤完全隔離；mail adapter 只送固定分類，原始 delivery/error 留在既有本機業務處理路徑。 |
| `worker/monitoringRelay.ts` | quota 基礎設施失敗回固定 503、不讀 body、不遞迴回報。 |
| `worker/index.ts` | 接上 mail／D1 fixed signals；Cron 產生重建摘要，修復／缺失／截斷不宣稱完全健康；外層 500／Cron failed 只用固定安全錯誤。 |
| `worker/repository.ts` | 讀取路徑 optional observer，只傳 `database`／`projection`，去重且吞掉 observer 錯誤；既有 fallback、原始 repository error、寫入／CAS／隱私流程保留。 |
| `src/services/monitoring.ts` | SDK close 同步 throw 與 async rejection 均不影響卸載／登出。 |
| `server/routes/authRoutes.ts` | mailer 缺失依 allowed forgot request 回固定 configuration marker，與帳號存在性無關，保留 rate limit／bot／202／timing 契約。 |
| `scripts/staging-policy.mjs` | generated staging config 拒絕 invocation logs、traces 與額外 destinations。 |
| `wrangler.jsonc`、`wrangler.staging.jsonc` | 本機 source 明確關閉 invocation logs／traces，保留安全 custom logs；未部署、不宣稱 live policy 已變更。 |
| `tests/operationsMonitoring.test.ts`、`tests/d1Monitoring.test.ts`、`tests/operationalFailureSignals.test.ts`（新） | 固定報表、實際合成 D1 read/fallback、故障與無效設定／Cron／mail／SDK cleanup／平台設定回歸。 |
| `tests/workerMonitoring.test.ts` | 未處理 Worker error 改驗固定 500／原始 canary 不出邊界，而非要求重拋 raw exception；HTTP 5xx 與去敏驗收更明確。 |
| `package.json` | 3 個新 suites 納入既有 `test:observability`／verify，無新增 dependency。 |
| `docs/observability.md`、`docs/monitoring-operations-runbook.md`、`docs/p0-operations-runbook.md`、本報告 | 架構、alert thresholds、SEV／接手、人工設定、報表模板及驗證界線。 |

### 已有測試與驗收界線

`npm run test:observability`：**55 pass／0 fail/skip**（既有 28＋新增 27）；`npm run test:staging-policy` **34 pass／0 fail/skip**；`npm run lint` exit 0。獨立複核後強化相同 Cron 整合 case 的 malformed projection／invalid environment，另跑 failure suite **9 pass／0 fail/skip**。測試重跑不重複累計。

2026-11-01 確認 `npm run verify` **exit 0，751 pass（94 legacy rules＋657 Node cases）、0 fail/skip**。所有最終程式／tests 均納入，涵蓋 migration policy、TypeScript、既有 API／D1／auth／隱私／revision／ownership、build／analytics boundary 與 Worker dry-run。完整 verify log SHA-256：`351deee4d0f3182470c4ed2d49c63de1063f879c3ebbd80052aa1503c77ecea3`。既有 Sentry optional Node built-in／SQLite experimental warnings 保留，沒有增加 compatibility flags 或削弱檢查。

`npm run check:worker:staging` **exit 0**；source／test／config 與實際執行副本 **96 份 SHA-256 相符、0 mismatch**，包含關鍵未改 migration／workflows。Lockfile SHA-256 仍為 `75192bb192a5efb7541ce2ebd794ef6c097a9a2963cec80d26522ab6858848a9`。格式與補充證據保存在 standalone `artifacts/observability-2026-11-01/`；不保留正式 response／request body、Secret 值或原始平台 log。

所有新測試使用固定合成資料、ephemeral D1 或 mock provider；錯誤分類不含學生姓名、分數、評語、收件者、識別碼、Cookie、Token、Request Body、SQL 或 raw error。沒有新增 public status／admin route，營運報表僅為受限結構化 evidence／模板。既有 migration、會員／學生／班級／遊戲資料模型與角色權限不變。

### 警報、營運與剩餘風險

- 告警提案涵蓋 `worker.api.http`、`worker.unhandled`、認證 broad group、D1、mail、projection、Cron failure／absence、監控通道本身。以 received-event count 為起點；沒有同 population／window 的可信 denominator 時，error rate／SLO 為 unknown。
- 新 D1 marker 只覆蓋 repository **讀取**異常，不以 exception 文字分析 SQL；其他 D1 寫入／平台錯誤仍須 API／Cron／provider aggregate 對照。多個 marker 可以屬於同一事故，不能加總成獨立 outages。
- Cron 的 complete 是此次有界掃描 coverage，不是全服務可用性；>500 workspace 可能持續 truncated、起始 cursor／分段營運仍待規劃。沒有外部 collector 就沒有可靠漏跑警報；Sentry non-error check-in transport 仍停用。
- `observability.logs.invocation_logs=false` 與 traces false 目前只是 source。需核對 deployed version／平台 log envelope、保留／export／存取政策；舊 log 不因這次修改自動刪除。本次沒有執行 log 刪除或 provider 設定操作。
- API 外層未處理錯誤由平台 exception 改為固定 JSON 500；Cron 仍 rejected 但 error／cause 已去敏。平台 invocation outcome 成功不等於 HTTP 200，外部警報須包含 HTTP 5xx／固定 markers，不能只看 uncaught exception count。
- Sentry Secrets／前端 flag／隱私設定／provider quota、通知 destinations／primary／backup receipt、獨立 collector 與正式 MTTA／MTTR／負載成本仍需管理員核准與演練。沒有啟用 Replay／Tracing／Profiling／Session Tracking、source maps 或敏感診斷。

**不需 Schema Migration 或資料轉換。** 既有 Sentry Secret 名稱沿用，沒有新的 API key；真正啟用仍需管理員以 Secrets 設定並走 staging → 核准 release，不把 secret put 當唯讀操作。操作與回復見 [monitoring-operations-runbook.md](monitoring-operations-runbook.md)；本次不是正式監控 Ready 或 M13／V05／V06 Closed 的證據。

## 2026-11-03 產品分析試點與跨登入 onboarding 驗收

**狀態：Partially Completed。** 本機程式與合成驗證 Completed：最終完整 verify 810 pass／0 fail／0 skip，兩種 repository 的瀏覽器驗證均通過。正式收集關閉、遠端 application staging／分析 D1／privacy 與營運簽核尚未完成，不標示 Closed。

### 問題與 Finding 狀態

既有 v1 已經提供固定事件 schema、DNT／GPC、opt-in、accepted-command instrumentation 與合成 E2E，不重做。缺口是 v1 只有本機操作完成，沒有第一方 collector、後端確認階段、可信 funnel 分母或跨登入的新教師去重；拿它當 durable-save／unique-teacher rate 會造成錯誤結論。

| 範圍 | 2026-11-03 狀態 |
| --- | --- |
| **B04 導入量測子項** | 本機實作與驗證 Completed：跨登入最小 onboarding 與匿名流程彙總、分析 84/84、完整 verify 810/810。正式試點啟用未驗收；B04 整體支援 SLA／工單／帳號自助仍 Open，不能以量測代替支援流程。 |
| **B05／V05／V06 外部營運與 privacy gates** | 維持 Open；未啟用第三方、修改正式權限、建立 Production binding 或宣稱正式資料收集合法／有效。 |
| **H01–H04、M01–M03 既有保護** | 未降低 scope、CSRF、tenant isolation、revision／draft／terminal-retry 規則；新增測試維持失敗不洩漏／不誤報成功的契約。正式發布狀態仍按各 Finding 原記錄。 |

使用者最終選擇為「跨登入的新教師完成率，另設最小 onboarding 狀態」。帳號層只保存 existing account key、cohort UTC day 與三個 boolean；沒有帳號 ID 進匿名 collector。分母是 cutoff 後建立、5 分鐘內且首次教學寫入前成功 enroll、具有現有建班權限的帳號；一般 teacher 角色不升權。延遲 Email 驗證／較晚首次使用、DNT／GPC、enrollment 失敗均會使 coverage 不完整，不能宣稱是所有新教師完成率。

### 主要行為、相容性與安全保證

- seven 個固定流程：class_create、roster_import、point_increase、point_decrease、exam_create、report_weekly、report_exam。started／local_completed／backend_acknowledged 分開；reports 只有輸出準備完成，backend rate 為 null；取消／拒絕／unconfirmed 不混算新保存成功。
- 成功 PUT 僅確認該 request 捕捉、目前授權 scope 下仍存在且回應保留的操作見證。合併、undo／刪除、舊 request、scope 切換、409 遠端等價都不偽造新 ACK；不重播草稿。
- 第一方傳輸固定同源、omit credentials、no-referrer、禁止 redirect，1.5 秒／16 pending／120 每分鐘，不重試、不進 browser storage 或 Sentry。Worker collector 不建立 auth repository、不讀 business DB、不記錄 Cookie／IP／body，獨立 schema 與 server environment，DNT／GPC 在 body／DB 前生效。
- onboarding POST 沿用 session／Origin／CSRF／RBAC，只能接觸自己 state。進度請求序列化且依 scope generation 丟棄舊 callback，避免 started／local_completed 亂序遺失；同帳號重登入保留合法 progress。
- 後端 confirmation 在成功商業寫入後才以 best-effort background observer 執行；不加入 D1 CAS／projection transaction。故障或 observer 掛起不延遲／回滾教師保存。其遺失是明確漏計風險，不是 durable audit。
- Workspace／學生／班級／遊戲資料模型不變；Node JSON 新欄位 optional、無舊帳號 backfill；D1 新增 `0008_product_onboarding.sql` 為 additive table。歷史七份 SQL checksum 不變。帳號刪除同步移除 onboarding；受控 DR 驗證新增 calendar／flag 語意且接受可信七份 migration 舊備份。仍須 release 前用實際 serving artifact 在隔離 staging 驗相容，不能以來源分析代替。
- 彙總不含 actor／workspace／class／student／nonce，k≥10 且小補集抑制。匿名成熟分母等待 24h、未成熟另列；沒有 denominator 為 null。public collector 可偽造，不作帳務／安全稽核／DAU 或學生表現分析。

### 修改檔案與用途（只列本次增補）

| 檔案 | 用途 |
| --- | --- |
| `src/analytics/client.ts`、新增 `firstParty.ts`／`workflows.ts`、`src/main.tsx` | 重用 privacy signal、可選傳輸／onboarding observer、記憶體流程狀態及預設關閉 bootstrap。 |
| `src/services/backendApi.ts`、新增 `productWorkflowPersistence.ts`、`src/hooks/useBackendSync.ts`、`src/store/useStore.ts` | 正常 auth API、class intent、私有操作見證、成功回應與 revision 的 ACK 整合及 reset。 |
| `src/features/students/components/StudentManagementSection.tsx`／`RosterImportPanel.tsx`、`src/features/exams/components/ExamAssessmentPanel.tsx`、`src/features/records/components/WeeklyFeedbackReportPanel.tsx` | 明確開始／取消／本機完成；考試編輯與報告準備語意。 |
| `server/contracts.ts`／`contracts/api.ts`、`server/api.ts`、新增 `routes/productOnboardingRoutes.ts`、`routes/workspaceRoutes.ts` | optional repository/API 契約、私有 onboarding route、成功保存後非阻塞 confirmation。 |
| `server/repository.ts`、`worker/repository.ts` | Node／D1 帳號層 enroll／單調進度／彙總／刪帳一致性；不改 business CAS。 |
| 新增 `shared/productAnalytics/schema.ts`／`report.ts`、`worker/productAnalytics.ts`／`productAnalyticsRepository.ts`、`worker/index.ts` | v2 allowlist、k 抑制、獨立匿名 collector／配額／有界原子彙總與清理、Worker routes／config／獨立 maintenance。 |
| 新增 `migrations/0008_product_onboarding.sql`、`migrations/policy.json`、`analytics-migrations/0001_product_analytics.sql` | 核心 optional expand 與另 DB 分析 schema；未執行遠端 migration。 |
| `worker/recoveryValidation.ts`、`tests/recoveryValidation.test.ts` | 新 optional table 結構／日期／flags 復原驗證及舊備份相容。 |
| `scripts/disaster-recovery.ts`、`tests/disasterRecovery.test.ts` | DR 精確比對核准 migration 清單，新增兩個不同帳號 onboarding 的 SQL roundtrip 與學生隱私重播不干擾驗證。 |
| 新增 `scripts/product-analytics-report.ts`、`package.json` | 無 remote target 的合成報表與正式 verify 測試整合。 |
| `scripts/staging-policy.mjs`、`wrangler.jsonc`／`wrangler.staging.jsonc` | 明確 disabled＋環境名稱；staging 保留拒絕額外 binding／意外啟用的預設限制。 |
| 新增 `tests/productAnalyticsCollector.test.ts`／`productAnalyticsWorker.test.ts`／`productAnalyticsTransport.test.ts`／`productAnalyticsConfiguration.test.ts`／`productWorkflowLifecycle.test.ts`／`productOnboarding.test.ts` | schema、actual D1／workerd、quota／privacy、傳輸、queue／scope、Node／D1 跨登入與故障不阻擋操作等 regressions。 |
| `tests/e2e/product-analytics.spec.ts`／`support/web-server.ts`、`scripts/check-production-analytics.mjs`、`tests/analyticsBuildBoundary.test.ts` | 真實 UI 的 v2 測試 sink、七項 Node／D1 瀏覽器驗證及禁止合成 hook 進正式 dist。 |
| `docs/product-analytics.md`、新增 `docs/product-analytics-pilot.md`、本報告 | v1／v2 邊界、事件與分母、保留／隱私風險、人工啟用／停止程序與證據。 |

### 實測證據

- 隔離來源副本 `npm ci` exit 0：依既有 lockfile 安裝，0 vulnerabilities；本次沒有新增／升級依賴。
- 副本排除規則曾因路徑格式帶入本機 `server/data/epet-runtime.json`；僅確認名稱／大小後即移除副本，未讀內容，原始檔未變動。測試使用明確建立的獨立 fixture 路徑，未引用該檔；沒有從正式 D1 匯出或使用正式資料。
- `npx tsx --test tests/productAnalyticsCollector.test.ts tests/productAnalyticsWorker.test.ts` 既有 14 項通過；再新增 actual bundled workerd 測試後 Worker suite **5/5** 通過，合計 collector＋Worker **15 個獨立案例**。初次新 runtime test 因 DOM／Miniflare Request adapter 不相容失敗，修正 adapter、保留斷言後通過，沒有藉此改 runtime 或放寬安全條件。
- `npx tsx --test tests/productAnalyticsTransport.test.ts`：**8 pass／0 fail**。`npx tsx --test tests/recoveryValidation.test.ts`：**17 pass／0 fail**。`--test-name-pattern="public registration" tests/productOnboarding.test.ts`：**2 pass／0 fail**（Node＋D1，包含登出重登入）。這些包含於之後完整 verify，不重複加總。
- `npm run test:analytics`：**84 pass／0 fail／0 skip，exit 0**，包含全部原有 27 項 v1 與新增 57 項 collector／actual workerd／scope／transport／Node＋D1 onboarding 等案例。
- `npx playwright test tests/e2e/product-analytics.spec.ts`：Node **7 pass／0 fail／0 skip**；設定 `EPET_E2E_REPOSITORY=d1` 同一命令：**7 pass／0 fail／0 skip**。兩輪是同一七案，不宣稱十四個不同案例。使用本機合成帳號及全新 D1，不接觸正式資料；該瀏覽器套件使用測試記憶體 sink，沒有宣稱已驗 remote collector 或跨登入 onboarding 的真實瀏覽器整合，後者目前證據來自 API／unit tests。
- `npm run analytics:report:local` exit 0：七個流程成熟 local completion 1，reports backend rate null；新教師示範 40 enrolled／20 local／20 backend，明確使用固定 aggregate fixture。輸出 `output/product-analytics/synthetic-report.json` 無 nonce／account ID；不是正式客戶使用報告。
- 最終 `npm run verify`：**exit 0；810 pass（94 legacy rules＋716 Node cases）、0 fail／0 skip**。包含 8 份 migration policy／歷史 checksum、TypeScript、既有 API／auth／RBAC／tenant／revision／ownership／學生隱私／D1／DR、84 項分析測試、build／production analytics artifact guard 與 Worker dry-run；本次完整 DR suite 21/21 通過。既有 Sentry optional Node built-in、SQLite experimental warnings 保留，沒有為消除警告改 compatibility flags 或降低驗證。
- `npm run check:worker:staging`：**exit 0**，與完整 verify 中 Production dry-run 均顯示分析 disabled，沒有 ANALYTICS_DB binding；沒有 deploy 或 remote migration。
- 首次完整 verify 為 **exit 1**：DR suite 20 pass／1 fail，失敗為舊測試硬編碼七份 migration（`8 !== 7`），其餘還原驗證均通過。修正為精確 reviewed catalog parity，且增加 populated onboarding 狀態的備份／還原／privacy replay 斷言，沒有刪測試或放寬安全條件。`npx tsx --test --test-name-pattern="synthetic D1 SQL backup/restore" tests/disasterRecovery.test.ts` 修正後 **1 pass／0 fail、exit 0**，之後重新完整執行 verify 並通過，未跳過前段檢查。
- 最終 verify log SHA-256：`9def2d4842cead3227ef8134e62583f8451b331779378c9155c0784ab68f86ae`。本機保留 `output/product-analytics/verify-20261103.log`、首次失敗 log、analytics／npm-ci／staging dry-run logs 與 `validation-20261103.json`；47 個程式／測試／設定驗證輸入的 workspace 與隔離副本 SHA-256 全部相同。Docs 最終補登證據不改 runtime。

### 啟用前人工事項與剩餘風險

完整操作／回復在 [product-analytics-pilot.md](product-analytics-pilot.md)。未執行：Production migration、Secrets、Worker deploy、GitHub settings、遠端 analytics DB 或正式收集。

需先核准並驗證 core expand 0008、每環境獨立 analytics DB 的 UUID／名稱／帳戶、analytics migration、靜態 binding policy 擴充、同步 client／server flags 與 cutoff、privacy／告知／operator、edge 濫用控制、cleanup 容量／backlog 告警、平台 logs／備份與刪除政策。runtime binding 物件不相等不能證明真正 DB UUID 不相同，source config 當前完全不綁 ANALYTICS_DB。

24h 是匿名 attempt 邏輯到期；bounded 500 batch＋daily Cron 不保證實體準時抹除。onboarding 目前隨帳號刪除，90 天 purpose-limited purge 只是建議、尚未實作。多次差分仍有隱私風險；限制 operator 與固定報表發布。公開事件可偽造，offline／quota／opt-out／背景確認遺失使率偏低，不能為補齊分母回填學生資料或重播使用者草稿。

**可進入下一個受控 P0 程式任務**，前提是分析維持關閉、保留所有既有安全 gates，且不把本機驗證當成正式發布授權。外部啟用與 B04／B05／V05／V06 不會因本機測試完成自動 Closed；本任務不是商業 GA 或正式分析收集 Ready 的證據。
