# 班級寵物養成系統

一個給班級經營使用的教育遊戲化系統。導師可以管理學生積分、學習證據、警告與處罰；學生則能用積分餵食寵物、升級、對戰、抽扭蛋，並查看排行榜與寵物狀態。正式環境由同一個 Cloudflare Worker 提供前端與 API，並使用 D1 保存資料。

## 直接使用

- 正式網站：[https://epet-api.jtwen12345us.workers.dev/](https://epet-api.jtwen12345us.workers.dev/)
- GitHub Repo: [https://github.com/andreww0421/epet](https://github.com/andreww0421/epet)

推送到 `main` 後，GitHub Actions 會先驗證、套用 D1 migration，再將前端靜態資源與 API 一起部署到 Cloudflare Worker。

## 目前功能

- 班級管理：新增班級、切換班級、刪除班級
- 學生管理：新增／刪除學生、CSV／TSV 名冊預覽匯入、手動加減分、降級
- 寵物養成：餵食、升級、扭蛋、免費升級換寵
- 對戰排行：對戰、勝敗統計、段位排行與近 7 日成長回饋榜
- 魔王副本：輸出貢獻排行、參與與進步獎勵、名次獎勵自動遞減設定
- 懲罰系統：警告、正式處罰、虛弱狀態、降級冷卻與補償式撤銷帳本
- 記錄系統：處罰、加減分、導師每日評語與魔王獎勵拆分記錄
- 教育連結：五種能力標籤、每班最多三個學習目標、學生下一目標與導師每日評語
- 學習證據：觀察、作業、反思、專題與評量紀錄，與遊戲積分完全分開
- 個人分析：學生能力概況、最近證據、支持需求、證據趨勢與遊戲狀態對照
- 考試分析：試算表多格貼上、整批分數驗證、學習趨勢／弱項、導師評語與個別 A4 PDF
- 教育指標：證據覆蓋、進展／精熟率、目標對齊、支持後進展與能力涵蓋
- 公開安全：可切換的包容性模式、姓名遮罩、排行榜模式、週末暫停衰減與友善照護
- 會員安全：Email 驗證、Turnstile bot 防護、登入／重設密碼、可撤銷 session、角色權限與帳號生命週期通知
- 資料管理：Cloudflare D1 同步、revision 衝突保護、受控版本復原、單生限縮匯出、可查詢 audit 與舊本機資料明確遷移

## 遊戲規則摘要

### 學生端

- 每位學生起始有 `200` 積分與一顆神秘蛋
- 學生點擊「作業完成」即可領取每日任務獎勵；學習狀態與每日評語由導師在控制台記錄
- 餵食會消耗積分，回復飽食度與心情
- 預設在週末暫停飽食度衰減
- 預設採友善照護模式，飽食度歸零時寵物會休息，餵食後即可恢復；導師可切換為死亡與復活規則
- 升級需要：
  - 飽食度 `100`
  - 足夠積分
  - 心情至少 `40`
- 免費換寵門檻依序為：`Lv.2 -> Lv.4 -> Lv.6 -> Lv.8`
- 若選擇升級獎勵的「新寵物」，會重設為：
  - `Lv.2`
  - 飽食度 `30`
  - 心情 `25`

### 對戰

- 發起對戰至少需要 `50` 飽食度
- 導師可用賽制選單分別調整個人賽進攻／防守方，以及隊伍賽發動者、被攻擊者與雙方隊友的單次飽食度消耗
- 虛弱狀態中的學生不能發起對戰
- 平手不再算主動方獲勝
- 平手時雙方只會消耗部分飽食度，不會直接判定勝敗

### 導師端獎懲

- `記警告`：每次 +1，累積到 `3` 次會自動觸發一次處罰
- `正式處罰`：直接套用較重處罰
- 自動處罰後會進入 `24 小時` 虛弱
- 正式處罰後會進入 `48 小時` 虛弱
- 正式處罰與降級必須填寫理由並二次確認；降級同一學生 `24 小時` 內不可重複執行
- 正式處罰與降級有 `10 秒` 撤銷視窗；撤銷保留原事件並追加補償紀錄，不會覆蓋後續合法變更
- 快速加減分與手動調整都會留下操作記錄
- 導師可自訂常用回饋的中英文名稱、獎懲分數與能力標籤
- 單人、批次與全班加減分會記住最近輸入的具體原因，點擊欄位或輸入文字即可搜尋重用
- 加減分可標記課堂參與、合作互助、自我管理、作業品質或學習成長
- 每班可同時設定最多三個學習目標，進度只計算目標建立後達到「穩定進步」或「已精熟」的學習證據
- 加減分只影響遊戲經濟；能力趨勢、目標進度與教育效果指標不使用遊戲積分推論

### 魔王公平排名

- 排名使用寵物等級校正後的每次平均表現，不直接依累積傷害排序
- 前 `3` 次攻擊只增加小幅可信度權重，超過後不再增加次數優勢
- 進步獎勵比較前後兩次公平分數；舊資料第一次結算會相容原始傷害紀錄
- 結算由後端 API 執行，前端離線時才使用相同的共用規則作為備援

### 包容性模式

- 可在導師控制台的規則設定中開啟或關閉
- 開啟時固定使用姓名遮罩、成長榜、友善照護、週末暫停衰減及全班共同承擔魔王攻擊
- 關閉後可個別調整公開姓名、排行榜、照護規則、週末衰減與魔王攻擊方式

## 記錄面板

介面中的記錄面板可切換查看：

- `處罰記錄`
- `加減分記錄`
- `每日評語`
- `魔王獎勵記錄`（積分、RP、心情及排名／參與／進步獎勵拆分）

各種記錄都會依時間排序，方便導師快速追蹤班級狀況。

## 技術架構

- 前端：React 19、TypeScript、Vite、Tailwind CSS 4、Zustand、Lucide React
- 共用領域層：學習證據分析、魔王公平排名與資料正規化
- 本機後端：Node HTTP API、JSON repository、會員驗證與 revision 衝突控制
- 正式後端：Cloudflare Workers、D1、租戶隔離、RBAC 與條件式 revision 更新
- 效能：展示大廳、導師控制台與學生分析採 lazy loading

## 本機開發

安裝依賴：

```bash
npm install
```

同時啟動前端與本機 API：

```bash
npm run dev:full
```

預設網址：

- 前端：`http://localhost:3000`
- API：`http://localhost:8787`

只啟動前端可使用 `npm run dev`；Vite 會將 `/api` 代理到本機 `8787`。

首次使用請建立導師帳號。密碼長度為 12–128 字元；登入 token 只保存在該分頁工作階段的 `sessionStorage`。未登入者不能讀寫工作區資料。

## 驗證

完整執行型別檢查、規則測試、後端整合測試、前端建置及 Worker dry-run：

```bash
npm run verify
```

### Playwright E2E testing

E2E tests 以真實 Chromium 驗證登入、工作區、班級／學生、導師操作、考試、角色權限及同步衝突等 critical user flows。第一次執行前安裝 Playwright browser：

```bash
npm ci
npx playwright install chromium
```

執行完整 E2E suite：

```bash
npm run test:e2e
```

Playwright 會自動執行 `npm run build`，再於 `127.0.0.1:3100` 啟動專用 Node server，同站提供建置後的 frontend 與 API。請保持此 port 未被占用；測試不會沿用既有 server，也不提供 production URL override。每次測試在系統暫存目錄建立獨立的 `epet-e2e-<UUID>/` JSON repository 與邀請 outbox，正常結束或案例失敗時由 teardown 清除，不會連線或修改 production D1。這也避免 OneDrive 對頻繁替換 JSON 檔案的鎖定干擾。測試 server 只在該 process 內開放註冊並捕捉虛構的 `example.test` 邀請；production 設定不會被改動。HttpOnly/Secure cookie、Origin、CSRF、workspace membership 與 class scope 仍走正式程式碼路徑。

失敗時的 screenshot、video、trace 與 HTML report 位於 `output/playwright/`。需要觀察 browser 操作時可執行：

```bash
npx playwright test --headed
```

既有 `npm test` 仍只執行快速的 rules/import/auth/server/D1 tests，不會隱含啟動 browser；E2E 需明確執行 `npm run test:e2e`。

測試檔位於 `tests/e2e/`，目前的 regression coverage：

| 測試檔 | 保護的流程 |
| --- | --- |
| `authentication.spec.ts` | 登入成功／失敗、登出、無效 session、瀏覽器 cookie 到期後重新登入 |
| `workspace.spec.ts` | 建立／切換工作區、資料隔離、未授權工作區與班級的讀寫拒絕 |
| `class-and-teacher.spec.ts` | 新增班級／學生、CSV 名冊匯入、刪除學生、加減分、每日評語、學習證據 |
| `exam.spec.ts` | 建立考試、貼上匯入成績、超過滿分的輸入不得套用 |
| `permissions.spec.ts` | viewer 拒絕寫入、teacher 班級範圍、admin 新增班級、owner 移轉所有權、CSRF／Origin 拒絕 |
| `data-safety.spec.ts` | 已同步資料的工作區往返保護、真實 revision conflict、禁止不安全切換、草稿下載與重載後恢復同步、不污染另一工作區 |

可用 `npm run test:e2e -- tests/e2e/authentication.spec.ts` 執行單一檔案，或用 `npx playwright show-report output/playwright/report` 查看最近報告。suite 固定單一 worker；每個案例使用獨立、隨機命名的虛構帳號，透過正式 API 與邀請流程建立角色，不直接注入前端 store 或繞過權限檢查。資料安全案例僅攔截網路以製造延遲／斷線，衝突回應由真實 API 產生。不要將測試 server 暴露至網際網路；不要用真實師生資料執行測試或分享含 session 資訊的 trace。

範圍限制：此 suite 測試 Chromium + Node JSON repository，不等同 Cloudflare Worker／D1 的瀏覽器端 E2E；D1 仍由 `npm test` 中的既有整合測試保護。Email／Turnstile 外部服務沒有納入 browser suite；測試 process 使用既有選項關閉這兩項外部依賴，正式啟動設定完全不變。Linux 首次安裝 browser 如缺系統函式庫，可改用 `npx playwright install --with-deps chromium`。

#### 工作區往返資料安全修正（2026-09-05）

`workspace round-trip preserves already synchronized students` 已從紅燈回歸案例改為通過：在工作區 A 與 B 分別新增學生並完成同步，多次往返後，UI 與兩邊 API 快照都保持不變，切換動作也不會產生 PUT 或空白 pending draft。

同步層現在先停止舊工作區生命週期，再重設與載入新工作區；session generation 會讓舊讀取、儲存與重試失效，而每個 state request 會固定攜帶建立它的 workspace ID。切換仍須先完成既有儲存，衝突或斷線時會維持原工作區並保留本機草稿。

獨立重現：

```bash
npm run test:e2e -- tests/e2e/data-safety.spec.ts -g "workspace round-trip"
```

### Accessibility testing

沿用上述 Playwright 安裝步驟後執行：

```bash
npm run test:a11y
```

`playwright.a11y.config.ts` 繼承原 E2E 的隔離 server、真實登入、虛構帳號與 teardown，只改用 `tests/accessibility/` 及獨立報告目錄。`npm test` 與 `npm run test:e2e` 不會隱含執行 accessibility suite。兩組 browser suite 共用本機 port 3100，請依序執行，不要同時啟動。

涵蓋 Login（含欄位錯誤）、Classroom（孵化前／後）、Teacher Dashboard（學生／獎勵）、Student analytics（已儲存學習證據）、Exam（編輯／已儲存成績）、Settings，以及新增班級、加減分、刪除學生、刪除帳號對話框。另以鍵盤驗證 Tab／Shift+Tab 焦點循環、Escape、焦點返回、分頁方向鍵／Home／End、評語建議選取及小螢幕對話框。

axe 會掃描完整頁面的所有預設規則，包含 best practices，未關閉規則或排除元素。serious／critical violations 會使測試失敗；moderate／minor 與 `incomplete`（需要人工判讀）仍保留在 JSON／HTML 報告。對話框的背景由正式元件的原生 modal 行為隔離，不是測試程式隱藏。測試沒有使用正式師生資料，也沒有變更 production authentication、CSRF、角色權限或資料庫結構。

```bash
npm run test:a11y -- tests/accessibility/dialogs.spec.ts
npx playwright show-report output/playwright/accessibility/report
```

各掃描的 `axe-*.json`、畫面截圖及失敗 trace 位於 `output/playwright/accessibility/results/`。axe 無法證明整個產品已符合 WCAG；仍待解決的問題、人工檢查與覆蓋限制記錄在 [accessibility backlog](docs/accessibility-backlog.md)。目前只執行 Chromium 與繁體中文，其他瀏覽器、螢幕閱讀器及高風險遊戲狀態仍需補測。

## 專案結構

```text
src/
  App.tsx
  components/
    dashboard/
      BossRewardSettings.tsx
      DashboardDialogs.tsx
      DashboardRecordsPanel.tsx
      PointReasonSettings.tsx
      StudentAnalyticsPanel.tsx
  hooks/useBackendSync.ts
  services/backendApi.ts
  gameRules.ts
  main.tsx
  index.css
shared/
  education.ts
server/
  auth.ts
  api.ts
  contracts.ts
  repository.ts
worker/
  index.ts
  passwordResetEmail.ts
  projectionStatements.ts
  repository.ts
migrations/
  0001_create_workspaces.sql
  0002_auth_rbac.sql
  0003_core_entities.sql
  0004_workspace_class_assignments.sql
  0005_workspace_invitations.sql
  0006_projection_read_model.sql
.github/
  workflows/
    deploy.yml
index.html
vite.config.ts
wrangler.jsonc
```

## 資料保存

- 正式網站與 API：`https://epet-api.jtwen12345us.workers.dev/` 與同站 `/api/`
- Cloudflare D1 是連線時的主要資料來源；學生個資預設不寫入 `localStorage`
- 每次寫入帶有 `baseRevision`；版本不符時 API 回傳 `409`，避免靜默覆蓋
- 每次資料請求都先驗證 `__Host-epet_session` HttpOnly cookie，再驗證工作區 membership；工作區 ID 本身不是憑證
- 所有變更狀態的 API 都要求同站 `Origin` 與 double-submit CSRF token；session token 不提供給 JavaScript，也不保存於 Web Storage
- D1 保留最近 25 份 workspace revision 快照，供稽核與受控復原
- autosave 使用串行 queue、退避重試、版本衝突保護與 `sessionStorage` 未同步草稿；登出或切換工作區前會先 flush
- 核心班級、學生、考試、學習證據、加減分、處罰與魔王獎勵交易式雙寫至正規化表；驗證後預設由正規化投影讀取，`data_json` 僅保留為相容寫入與緊急回滾副本
- owner／admin 可邀請成員、管理角色與班級範圍；owner 可移轉所有權及雙重確認刪除工作區
- 帳號可自助刪除，但必須先移轉或刪除其擁有的工作區
- 刪除學生時會連同所有保留 revision 中的該生資料清除
- owner／admin 可在「資料治理」管理介面預覽並復原 revision、匯出單一學生的限縮資料集，以及依動作／操作人／對象／日期查詢 audit；audit 查詢本身也會留痕
- 可匯出為 JSON 備份
- 可匯入既有資料，系統會自動補齊新版欄位
- 找到舊版固定本機資料時，畫面只提供「下載備份／明確匯入／稍後」，不會自動掛到新帳號
- 舊的單一班級目標會自動遷移成新版目標清單
- 舊導師每日評語會遷移為獨立、可版本化的學習證據
- 未自訂競爭或懲罰規則的舊資料會啟用包容性模式；已有明確自訂規則者會保留原設定

完整會員、安全與舊資料上線設計見 [`docs/membership-and-p0-plan.md`](docs/membership-and-p0-plan.md)；學生資料盤點、保存／刪除與請求處理見 [`docs/privacy-data-governance.md`](docs/privacy-data-governance.md)。同站 session 切換見 [`docs/p1-same-origin-session-cutover.md`](docs/p1-same-origin-session-cutover.md)；Email 驗證、Turnstile 與通知切換見 [`docs/p1-account-security-cutover.md`](docs/p1-account-security-cutover.md)；資料治理管理操作與驗收見 [`docs/p1-data-governance-console.md`](docs/p1-data-governance-console.md)。

## Cloudflare 部署

D1 資料庫名稱為 `epet-production`。Cloudflare Workers Static Assets 會將前端與 API 發布成同一個不可分割的部署；順序為先 migration，再部署 Worker 與靜態資源。

正式環境要先設定寄件服務。`RESEND_API_KEY` 必須使用 Worker secret，不可寫入 `wrangler.jsonc`：

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put PASSWORD_RESET_FROM
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put TURNSTILE_SITE_KEY
```

`TURNSTILE_SECRET_KEY` 只能存在 Worker secret；site key 會透過公開 health config 提供前端，本身不是機密，但不可誤用其他 hostname 的 widget。`PUBLIC_APP_URL`、`EMAIL_VERIFICATION_REQUIRED`、`BOT_PROTECTION_REQUIRED` 與 `REGISTRATION_ENABLED` 可使用 Worker vars。同一組核准寄件者用於密碼重設、驗證信、工作區邀請與帳號生命週期通知。

專案預設 `EMAIL_VERIFICATION_REQUIRED=true`、`REGISTRATION_ENABLED=false`，並暫將 `BOT_PROTECTION_REQUIRED=false`，避免尚未配置正式 Turnstile 金鑰時鎖死登入。公開註冊的安全切換順序是：先設定並實測 Resend 與兩個 Turnstile binding，再把 `BOT_PROTECTION_REQUIRED=true`，確認 `/api/v1/health` 的 `botProtectionEnabled`、`emailVerificationEnabled`、`lifecycleNotificationsEnabled` 都為 `true`，最後才開啟 `REGISTRATION_ENABLED=true`。未完成時維持邀請制。

Worker 每日由 cron 清理到期驗證資料，並分批對帳／修復正規化投影。正式上線前還必須依 [`docs/p0-operations-runbook.md`](docs/p0-operations-runbook.md) 完成備份還原演練並核定 RPO／RTO；正規化切讀與 blob 退場見 [`docs/p1-normalized-read-cutover.md`](docs/p1-normalized-read-cutover.md)。GitHub Actions 的 production environment 必須設定 `CLOUDFLARE_ACCOUNT_ID` 與具 Workers／D1 部署權限的 `CLOUDFLARE_API_TOKEN`。

套用 migration：

```bash
npm run db:migrate:remote
```

部署 Worker 與前端靜態資源：

```bash
npm run deploy:worker
```

舊 GitHub Pages 網站不能再作為正式登入入口，因為 HttpOnly session 只接受同站 cookie。切換後應停用 Pages 或只保留導向正式網站的靜態頁，不可恢復前端可讀取的 Bearer token。
