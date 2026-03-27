# 班級寵物養成系統

一個給班級經營使用的前端小遊戲。導師可以管理學生積分、警告與處罰；學生則能用積分餵食寵物、升級、對戰、抽扭蛋，並查看排行榜與寵物狀態。

## 直接使用

- GitHub Pages: [https://andreww0421.github.io/epet/](https://andreww0421.github.io/epet/)
- GitHub Repo: [https://github.com/andreww0421/epet](https://github.com/andreww0421/epet)

推送到 `main` 後，GitHub Actions 會自動重新部署網站。

## 目前功能

- 班級管理：新增班級、切換班級、刪除班級
- 學生管理：新增學生、刪除學生、手動加減分、降級
- 寵物養成：餵食、升級、扭蛋、免費升級換寵
- 對戰排行：對戰、勝敗統計、段位分排行榜
- 懲罰系統：警告、正式處罰、虛弱狀態
- 記錄系統：處罰記錄、加減分記錄
- 資料管理：JSON 匯出 / 匯入、localStorage 自動保存

## 遊戲規則摘要

### 學生端

- 每位學生起始有 `200` 積分與一顆神秘蛋
- 餵食會消耗積分，回復飽食度與心情
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
- 虛弱狀態中的學生不能發起對戰
- 平手不再算主動方獲勝
- 平手時雙方只會消耗部分飽食度，不會直接判定勝敗

### 導師端獎懲

- `記警告`：每次 +1，累積到 `3` 次會自動觸發一次處罰
- `正式處罰`：直接套用較重處罰
- 自動處罰後會進入 `24 小時` 虛弱
- 正式處罰後會進入 `48 小時` 虛弱
- 快速加減分與手動調整都會留下操作記錄

## 記錄面板

介面中的記錄面板可切換查看：

- `處罰記錄`
- `加減分記錄`

這兩種記錄都會依時間排序，方便導師快速追蹤班級狀況。

## 技術架構

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Lucide React

## 本機開發

安裝依賴：

```bash
npm install
```

啟動開發伺服器：

```bash
npm run dev
```

預設網址：

- `http://localhost:3000`

## 驗證

型別檢查：

```bash
npm run lint
```

正式建置：

```bash
npm run build
```

## 專案結構

```text
src/
  App.tsx
  gameRules.ts
  main.tsx
  index.css
.github/
  workflows/
    deploy.yml
index.html
vite.config.ts
```

## 資料保存

- 所有資料預設存在瀏覽器的 `localStorage`
- 可匯出為 JSON 備份
- 可匯入既有資料，系統會自動補齊新版欄位
