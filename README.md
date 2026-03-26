# 班級寵物養成系統

一個用於班級經營的前端小工具。老師可以管理學生積分與班級資料，學生則能用積分餵養寵物、扭蛋、對戰，並查看排行榜。

## 直接開啟網站

GitHub Pages 部署網址：

- [https://andreww0421.github.io/epet/](https://andreww0421.github.io/epet/)

推送到 `main` 後，GitHub Actions 會自動重新部署網站。

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

安裝依賴：

```bash
npm install
```

啟動開發環境：

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

## 部署

這個專案已設定 GitHub Pages。

- production `base` 為 `/epet/`
- GitHub Actions workflow 會建置 `dist/`
- 成功後會自動發佈到 GitHub Pages

## 資料說明

- 所有資料都儲存在瀏覽器的 `localStorage`
- 可匯出成 JSON 檔備份
- 支援匯入舊版資料並自動轉換

## 專案結構

```text
src/
  App.tsx
  main.tsx
  index.css
.github/
  workflows/
    deploy.yml
index.html
vite.config.ts
```
