# 班級寵物養成系統

一個給班級經營使用的教育遊戲化系統。導師可以管理學生積分、學習證據、警告與處罰；學生則能用積分餵食寵物、升級、對戰、抽扭蛋，並查看排行榜與寵物狀態。正式環境使用 Cloudflare Worker API 與 D1 保存資料。

## 直接使用

- GitHub Pages: [https://andreww0421.github.io/epet/](https://andreww0421.github.io/epet/)
- GitHub Repo: [https://github.com/andreww0421/epet](https://github.com/andreww0421/epet)

推送到 `main` 後，GitHub Actions 會自動重新部署網站。

## 目前功能

- 班級管理：新增班級、切換班級、刪除班級
- 學生管理：新增學生、刪除學生、手動加減分、降級
- 寵物養成：餵食、升級、扭蛋、免費升級換寵
- 對戰排行：對戰、勝敗統計、段位排行與近 7 日成長回饋榜
- 魔王副本：輸出貢獻排行、參與與進步獎勵、名次獎勵自動遞減設定
- 懲罰系統：警告、正式處罰、虛弱狀態
- 記錄系統：處罰記錄、加減分記錄、導師每日評語與常用原因歷史
- 教育連結：五種能力標籤、每班最多三個學習目標、學生下一目標與導師每日評語
- 學習證據：觀察、作業、反思、專題與評量紀錄，與遊戲積分完全分開
- 個人分析：學生能力概況、最近證據、支持需求、證據趨勢與遊戲狀態對照
- 教育指標：證據覆蓋、進展／精熟率、目標對齊、支持後進展與能力涵蓋
- 公開安全：可切換的包容性模式、姓名遮罩、排行榜模式、週末暫停衰減與友善照護
- 資料管理：Cloudflare D1 同步、revision 衝突保護、localStorage 離線快取與 JSON 匯出 / 匯入

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

這兩種記錄都會依時間排序，方便導師快速追蹤班級狀況。

## 技術架構

- 前端：React 19、TypeScript、Vite、Tailwind CSS 4、Zustand、Lucide React
- 共用領域層：學習證據分析、魔王公平排名與資料正規化
- 本機後端：Node HTTP API、JSON repository、revision 衝突控制
- 正式後端：Cloudflare Workers、D1、條件式 revision 更新
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

## 驗證

完整執行型別檢查、規則測試、後端整合測試、前端建置及 Worker dry-run：

```bash
npm run verify
```

## 專案結構

```text
src/
  App.tsx
  components/
    dashboard/
      BossRewardSettings.tsx
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
  api.ts
  repository.ts
worker/
  index.ts
  repository.ts
migrations/
  0001_create_workspaces.sql
.github/
  workflows/
    deploy.yml
index.html
vite.config.ts
wrangler.jsonc
```

## 資料保存

- 正式 API：`https://epet-api.jtwen12345us.workers.dev`
- Cloudflare D1 是連線時的主要資料來源，瀏覽器 `localStorage` 是離線快取
- 每次寫入帶有 `baseRevision`；版本不符時 API 回傳 `409`，避免靜默覆蓋
- 正式網站會為每個瀏覽器產生高熵 workspace 能力金鑰，不使用公開的 `local-demo`
- 可匯出為 JSON 備份
- 可匯入既有資料，系統會自動補齊新版欄位
- 舊的單一班級目標會自動遷移成新版目標清單
- 舊導師每日評語會遷移為獨立、可版本化的學習證據
- 未自訂競爭或懲罰規則的舊資料會啟用包容性模式；已有明確自訂規則者會保留原設定

目前的能力金鑰同步適合單一導師、單一瀏覽器的初期部署，不等同完整帳號系統。正式提供多校、多導師或跨裝置使用前，應加入身分驗證、角色權限、workspace 金鑰復原與稽核記錄。

## Cloudflare 部署

D1 資料庫名稱為 `epet-production`。首次建立環境或新增 migration：

```bash
npm run db:migrate:remote
```

部署 Worker：

```bash
npm run deploy:worker
```

GitHub Pages 的 production build 已設定 `VITE_API_BASE_URL`，推送 `main` 後會連到正式 Worker。
