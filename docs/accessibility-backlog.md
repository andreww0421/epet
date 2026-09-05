# Accessibility baseline and backlog

更新：2026-09-04。依實際 React 元件與本機 Chromium／axe-core 4.13.0 結果建立，不以 README 的功能描述推定已通過。

## 範圍與門檻

執行 `npm run test:a11y`。測試繼承現有 Playwright 的本機同站 Node server、獨立暫存 repository、真實 cookie／CSRF／角色檢查與虛構 `example.test` 帳號，不連線 production Worker／D1。`npm test` 的範圍沒有改變。

- `tests/accessibility/pages.spec.ts`：登入及欄位錯誤、寵物孵化前後、學生與獎勵控制台、已新增學習證據的個人分析、考試編輯及保存、規則／校曆／權限設定。
- `tests/accessibility/dialogs.spec.ts`：新增班級、加減分及評語建議、刪除學生、刪除帳號。包含初始焦點、Tab／Shift+Tab 循環、Escape、取消後焦點返回；刪除測試不實際刪除帳號。
- 新增班級另驗證 IME 組字 Enter 不送出，以及正常 Enter 儲存後不會因焦點返回而重新觸發開啟按鈕；此回歸由原有功能 E2E 抓到並修正，未放寬舊測試。
- `tests/accessibility/keyboard.spec.ts`：分頁 roving tabindex、方向鍵／Home／End、tabpanel 關聯、375 × 667 對話框尺寸及可見鍵盤焦點。
- 12 個案例、17 個 axe 掃描狀態。axe 使用所有預設規則，包含 best practices，沒有 `disableRules`、元素排除或規則白名單。serious／critical violations 阻擋測試；moderate／minor 與 incomplete 保留報告，不能解讀為不存在問題。

報告位於 `output/playwright/accessibility/report/`；每個狀態的 `axe-*.json`、截圖與失敗 trace 位於 `output/playwright/accessibility/results/`。重新執行會替換上次報告。資料僅供本機測試，仍不要公開含 session 的 trace。

## 本輪修正

| 問題與影響 | 實際修正 |
| --- | --- |
| 新增班級／刪除／加減分原為一般 `div`，缺少 dialog 名稱、背景隔離、Escape 與焦點管理 | 共用 `src/components/ModalDialog.tsx`，使用原生 `showModal()`、可存取名稱／描述、Tab 首尾循環、關閉後返回觸發按鈕；刪除操作優先聚焦取消。帳號刪除仍維持 busy 時禁止關閉及原有密碼／確認／同步檢查。 |
| 控制台及資料治理分頁只有 `role=tab`，缺少鍵盤操作與 panel 關聯 | 共用 `tabKeyboard.ts`，增加 roving tabindex、方向鍵／Home／End、tab／tabpanel id 關聯；只在已渲染且未 disabled 的分頁間移動，沒有改變角色過濾。 |
| 評語 combobox 指向未顯示的 listbox、建議僅能滑鼠選取 | 僅在 listbox 存在時設定 expanded／controls；使用 active-descendant、方向鍵與 Enter 選取；Escape 先收起建議，再關閉對話框。既有搜尋、歷史與學習能力對應保持不變。 |
| 固定評語選單只有 title | 新增可見且明確關聯的 label，不再依賴滑鼠提示。 |
| 小字／按鈕對比不足 | 調整寵物頁選取按鈕、寵物等級／RP／互動警語、導師空投按鈕、常用原因徽章、分析空狀態、成績表與設定說明的前景／背景；深色表頭保留淺色文字。 |
| 頁面 h1 跳接 h3、設定子區塊及名冊匯入標題跳級 | 調整 Dashboard 與相關設定、匯入、公平性子元件的 heading 層級，不改變樣式或業務流程。 |

本輪只新增測試及 UI accessibility 行為；沒有改動 store、同步協定、認證／授權、API、Worker 或資料庫 schema。未修復既有工作區切換資料遺失問題，也沒有把它標成預期失敗。

### 變更檔案

- 測試與設定：`package.json`、`package-lock.json`、`playwright.a11y.config.ts`、`tests/accessibility/fixtures.ts`、`pages.spec.ts`、`dialogs.spec.ts`、`keyboard.spec.ts`。
- 共用介面：`src/components/ModalDialog.tsx`、`tabKeyboard.ts`、`AccountDeletionDialog.tsx`、`DashboardView.tsx`、`ClassroomView.tsx`、`PetCard.tsx`。
- 控制台子元件（`src/components/dashboard/`）：`DashboardDialogs.tsx`、`DataGovernancePanel.tsx`、`DailyTaskCalendarSettings.tsx`、`WorkspaceAccessPanel.tsx`、`EconomyDashboardPanel.tsx`、`ExamAssessmentPanel.tsx`、`PointReasonSettings.tsx`、`PointGuardrailPanel.tsx`、`RosterImportPanel.tsx`。
- 文件：`README.md` 與本文件。原有尚未提交的 E2E infrastructure 與 architecture audit 保留，不在本輪刪除或重寫。

## 尚未解決／尚未驗證

下列優先級是後續工作安排，不是 axe impact 的重新命名。已確認的程式碼問題與待人工驗證項目分開列出。此 baseline 不代表全站 high-impact 問題已全部清除，更不是 WCAG 認證。

| 優先級 | 狀態 | 問題、位置與完成條件 |
| --- | --- | --- |
| P1 | 程式碼確認；尚未納入 browser suite | `src/components/ClassroomView.tsx` 的對戰／組隊彈窗仍使用一般 overlay，關閉 X 只有圖示，部分選取使用 `div` click。需遷移到共用 dialog、補標籤及原生可鍵盤選取控制，再加上選取／取消／送出測試；不可改變戰鬥與隊伍規則。 |
| P1 | 程式碼確認；尚未納入 browser suite | `src/components/dashboard/DataGovernancePanel.tsx` 的 revision 復原彈窗及 `src/App.tsx` 的升級獎勵彈窗仍有各自的 focus 實作或缺口；`role=dialog` 本身不會限制焦點。需遷移並驗證初始焦點、Tab、Escape、busy 狀態及焦點返回；復原需持續保留確認字串、revision conflict、同步與權限檢查。 |
| P1 | axe incomplete；需人工量測 | Login 的 `AuthScreen.tsx`／`src/index.css` 裝飾性 `::before` 圖層讓 axe 無法判定多個元素的背景。需對實際合成畫面量測文字與背景對比；不得直接刪除／隱藏圖層或關閉 color-contrast 規則來宣稱通過。 |
| P1 | axe incomplete；需人工判讀 | 帳號刪除說明、刪除確認文字、評語建議展開時被覆蓋的提示／選單，以及寵物卡漸層或重疊內容，可能回報背景無法判定。截圖與 JSON 保留 target；需在桌面、200% 縮放與小螢幕檢查可讀性、遮擋與 focus-not-obscured。incomplete 並非已通過，也不自動代表已確定違規。 |
| P1 | 程式碼確認；需輔具驗證 | `src/App.tsx` 登入後主畫面沒有 skip-to-main link；切換展示大廳／控制台時也未明確移動焦點至新頁內容。需加入略過導覽入口，並驗證 SPA 換頁焦點不打斷編輯或同步衝突提示。 |
| P1 | 覆蓋缺口 | 使用 NVDA＋Chrome／Firefox、VoiceOver＋Safari 人工測試登入、錯誤朗讀、分頁、對話框、同步狀態、考試輸入與學習證據。axe 與鍵盤 DOM 斷言不能驗證實際朗讀順序、品質及虛擬游標行為。 |
| P2 | 程式碼確認；未掃描分支 | Classroom 空狀態／排行榜仍有 h1 接 h3 的分支；`DashboardRecordsPanel.tsx` 有小字 `text-slate-400`。需補足空資料、長資料與紀錄頁掃描後逐項修正，不用全域 CSS 強制覆蓋所有顏色。 |
| P2 | 覆蓋缺口 | 補 Firefox／WebKit、英文、200%／400% 文字放大、forced-colors、reduced-motion、觸控尺寸及完整手機頁面。現在只有 Chromium、繁體中文、單一 owner 測試身分與一種手機尺寸對話框。 |
| P2 | 覆蓋缺口 | 補 viewer／teacher 的實際 a11y 頁面、邀請與密碼重設、Turnstile 外部 widget、revision／匯出／稽核各子頁、長評語建議、歷史考試、戰鬥／boss／死亡／休息／高階寵物狀態。現有 E2E 有權限 regression，但不等於這些狀態已通過 axe。 |
| P2 | 覆蓋缺口 | 對分析圖表與成績表做螢幕閱讀器表格導覽及資料替代呈現檢查；特別驗證動態排序、趨勢與空值是否有足夠文字脈絡，而非只測有 label。 |
| P2 | 流程改善 | 加入獨立 CI accessibility job、artifact 保存與人工覆核責任人；目前新 script 為本機明確執行，沒有修改 deployment workflow，也沒有把未涵蓋頁面宣稱為已驗收。 |

## 驗證與限制

- 最後一次完整 `npm run test:a11y`：12/12 通過，17 個掃描狀態均為 0 confirmed violations（含 moderate／minor）；其中 7 個狀態仍有 color-contrast incomplete，詳見上方人工量測項目。已查看帳號刪除與評語建議的真實 browser 截圖，但未進行螢幕閱讀器驗收。
- 前後均執行原有測試。初次測試曾受主機休眠干擾而停滯，清理該測試程序後重新執行：132 個 rules／imports／auth／server／D1 測試通過。
- `npm run lint`、`npm run build` 與 `npm run check:worker` 通過；Worker 命令僅 dry-run，不部署。
- 2026-09-03 accessibility 工作完成時 `npm run test:e2e` 為 14/15；當時唯一失敗的工作區往返資料缺陷已於 2026-09-05 修正，並加入重複往返、儲存中切換、延遲載入與重新登入的資料安全回歸案例。
- 兩組 browser suite 共用 port 3100，請依序執行。本機 fixture 關閉外部郵件驗證／bot 依賴僅沿用測試 process 的設定，production security 沒有降低。

## 依據

使用 [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) 的 axe integration 與測試報告方式；焦點及鍵盤行為參照 [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) 與 [tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)。自動掃描只能涵蓋可機器判定的子集，人工鍵盤與輔具驗收不可省略。
