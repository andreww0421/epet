# 班級寵物養成系統

這是一個用於班級經營的前端小工具，老師可以管理學生積分，學生則能透過積分餵養寵物、扭蛋、對戰與查看排行榜。

## 功能

- 新增、刪除學生與班級
- 調整學生積分
- 餵食寵物、寵物升級、扭蛋孵化
- 學生對戰、勝敗紀錄與段位分
- 排行榜與徽章系統
- 匯出 / 匯入 JSON 資料
- 使用 `localStorage` 自動保存資料

## 技術

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Lucide React

## 本機執行

先安裝依賴：

```bash
npm install
```

啟動開發環境：

```bash
npm run dev
```

預設會在 `http://localhost:3000` 啟動。

## 驗證指令

型別檢查：

```bash
npm run lint
```

正式建置：

```bash
npm run build
```

## 資料說明

- 所有資料都儲存在瀏覽器的 `localStorage`
- 匯出後可保存成 JSON 檔，之後再匯入回系統
- 系統支援舊版資料結構的匯入與自動轉換

## 專案結構

```text
src/
  App.tsx
  main.tsx
  index.css
index.html
vite.config.ts
```
