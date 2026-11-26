# Frontend experience audit

基準日期：2026-11-18；驗收作業日期：2026-11-19–20。範圍：首頁、Teacher Console、互動寵物列表、手機／平板與核心鍵盤操作。本次不部署、不修改 API、資料 schema、遊戲規則或正式資料。

狀態：**Completed（本次工程、自動驗收與本機量測）**。正式環境效能、實機輔助科技與完整 WCAG 2.2 AA 合規仍待人工驗證，未標為 Closed。

## 實作前計畫

1. 在修改產品程式前，以相同版本的本機 production build、真實 Chromium/CDP、300 位合成學生建立基準。正常 build 的載入量測與額外開啟 React Profiler 的 build 分開，不混用數字。
2. 將上方「展示大廳」改為私有「寵物活動」，集中餵食、升級、對戰與魔王互動。Teacher Console 的寵物／對戰提供同一入口，魔王管理保留設定，排行榜只呈現排行。保留明確 `#/presentation` 的唯讀投影隔離。
3. 只根據量測改善列表與載入；保留完整名冊與對手／隊伍資料，畫面分頁不改持久化資料。離開班級、帳號或權限範圍時關閉活動對話框。
4. 沿用原生 `ModalDialog` 修正升級獎勵的焦點管理，檢查短螢幕、長姓名、繁中／英文 reflow 與操作尺寸。
5. 在相同條件重測，執行現有回歸與新增導航、資料隔離、分頁及鍵盤測試。自動化檢查不代表完整 WCAG 認證。

## 導覽對照與安全邊界

| 原入口 | 預定行為 |
| --- | --- |
| 上方展示大廳 | 寵物活動：目前已驗證班級範圍的唯一互動寵物列表 |
| 活動 > 寵物／對戰 | 前往相同寵物活動入口，不重複掛載列表 |
| 活動 > 魔王管理 | 保留管理與設定；提供寵物活動捷徑 |
| 活動 > 排行榜 | 保留排行，沒有互動寵物卡片 |
| 明確 `#/presentation` | 保留獨立、唯讀、遮罩及無教師操作的投影模式 |

互動入口仍要求可寫入角色、已驗證且目前有效的 workspace／class scope、可用的同步狀態、個人顯示偏好與工作區 feature flags。後端 RBAC、CSRF、租戶隔離及 Revision Protection 不變。

## 修改前實測

基準版本 `7c7f9a9f3a608b2372df2d676751780fdd02b13d`。本機 production build、Playwright 真實 Chromium、1280×900、zh-TW、Asia/Taipei、reduced motion、停用 browser cache、無人工 CPU／網路節流、loopback HTTP、300 位合成學生。正常 build 與特別開啟 `react-dom/profiling` 的 build 各量測三次，修改產品程式前完成並凍結產物。

| 正常 build 指標 | 中位數 | 範圍 |
| --- | ---: | ---: |
| 登入頁可操作 | 970 ms | 773–1,139 ms |
| 已登入 Today 可操作 | 1,919 ms | 1,634–2,195 ms |
| 活動 → 寵物顯示 | 3,824 ms | 3,215–4,007 ms |
| 餵食 → 真實 State PUT 200 | 1,691 ms | 1,651–1,738 ms |
| 餵食 → UI 同步及兩個 animation frames | 2,050 ms | 2,042–19,485 ms |

保留最後一項的 19.48 秒 outlier，不以刪除慢樣本改善結果。上述時間包含 Playwright 操作與等待，不是 field INP。登入頁最後觀察到的 LCP 為 644–1,004 ms，CLS 三次均為 0.4341；觀察窗口不能代表整段使用工作階段。

確認的瓶頸：Today 已掛載 24,347 個 DOM elements；寵物頁 60,770 個，含 300 張寵物卡及一篇隱藏文章。對戰與魔王頁各重複掛載 300 張卡。寵物導航每次三個 long tasks，總時間 2,425–3,112 ms。React profiling 的餵食三次均只 render 兩張 PetCard，故本次保留既有 Store 訂閱，沒有把整份名冊重繪當成已確認問題。

登入需要的 JS（entry + shared runtime）為 572,897 raw bytes、181,977 gzip bytes；CSS 107,976 raw bytes。Dashboard 原已是登入後才載入的 lazy chunk，332,476 raw bytes、86,772 gzip bytes。本機伺服器未使用傳輸壓縮，gzip 數字為實際檔案離線壓縮大小，不是宣稱 production transfer size。

原始證據保存在 `output/frontend-experience/baseline-{report,summary,normal-bundles}.json`、`baseline-methodology.md`、`benchmark-baseline-frozen.ts` 及正常／profiling 的獨立 dist。這些 output 是本機驗證產物，正式程式不會載入測量插碼。

## 已實作的改善

- 學生管理、紀錄、管理設定及魔王設定在首次進入時才載入；首次掛載後保留 editor state。切到寵物活動時控制台保留於 hidden 容器，並暫停其可見性相關效果。
- 首輪重測保留為 `after-*`：寵物 DOM 降至 25,813，但 Today 仍有 22,813，載入中位數約 1,919 ms，尚未改善。追查確認隱藏的加減分表格仍建立整班資料列，因此再限制隱藏／設定模式不建立 tbody rows；保留控制器、快捷 dialog、固定原因及勾選 state，不以整個表格 owner 卸載處理。新增「Today 不掛載隱藏資料列、返回仍保留原因／勾選／indeterminate」的實際 UI 回歸。
- Today 的「開始活動」直接開啟同一個 hub，保留既有一步開始活動的操作，不繞經管理頁 launcher。
- 唯一互動名冊每頁最多 24 張卡，支援目前班級姓名搜尋、總數／範圍 live status、鍵盤分頁及焦點回到名冊標題。對戰與隊伍仍使用完整授權名冊，沒有修改或截斷持久化資料。
- 登入的公開表單於 session／policy discovery 期間保留相同版面，保持 inert、submit disabled 及 handler guard；不在 Turnstile／登入政策確認前送出。
- 升級獎勵沿用 native `ModalDialog`：背景 inert、初始焦點、Tab 循環、明確 Esc 保留原寵物語意、回到穩定標題。原保留／抽取 action 不變。
- 長姓名換行、手機 action 44 px 設計目標、短螢幕 dialog 可捲動；徽章使用正常文件流，避免遮住長姓名。新增 axe 情境發現魔王空排行榜文字、選中隊員文字與 Available 徽章的對比不足，依實際報告調整色彩，未停用規則。

## 最終前後比較

最終使用 `node --import tsx scripts/measure-frontend.ts after-final`，正常及 profiling build 各三次，Chromium **153.0.8010.12**。名冊、viewport、locale、時區、reduced motion、停用 cache 及不節流條件與基準一致。使用同一台 Windows 主機，但跨日期、背景 OS 負載未鎖定，以下只代表此組本機樣本，不能外推正式 Cloudflare D1 或手機的速度。

| 正常 build 指標 | 修改前中位數（min–max） | 最終中位數（min–max） |
| --- | ---: | ---: |
| 登入頁可操作 | 970 ms（773–1,139） | 580 ms（565–2,023） |
| Today 可操作 | 1,919 ms（1,634–2,195） | 1,084 ms（1,065–1,109） |
| 寵物任務入口可操作 | 3,824 ms（3,215–4,007） | 532 ms（496–560） |
| 餵食 → State PUT 200 | 1,691 ms（1,651–1,738） | 795 ms（768–835） |
| 餵食 → 同步 UI 及兩個 frames | 2,050 ms（2,042–19,485） | 854 ms（823–879） |
| Today DOM elements | 24,347（三次相同） | 1,913（三次相同） |
| 寵物頁 DOM elements | 60,770（三次相同） | 4,913（三次相同） |
| 可見互動寵物卡 | 300 | 24；其餘可搜尋／分頁 |
| 登入頁觀察窗口的 CLS | 0.4341（三次相同） | 0（三次相同） |
| 寵物導航窗口 long tasks 總時長 | 2,925 ms（2,425–3,112） | 0 ms（三個所測窗口） |

登入第一個最終樣本 2,023 ms 與舊的 19,485 ms 同步 outlier 都保留，沒有排除慢樣本。舊寵物量測明確點擊「活動 → 寵物」，新量測點擊上方「寵物活動」，導航步驟不同；這是固定任務路徑比較，不能當成純 render 加速比例或 INP。舊介面活動預設為寵物時，也可能只需要一次點擊。

| JS 大小（實際檔案，各 chunk gzip 後加總） | 修改前 | 最終 |
| --- | ---: | ---: |
| 登入頁靜態依賴圖 raw / gzip | 572,897 / 181,977 bytes | 577,396 / 184,410 bytes |
| Today 額外靜態依賴 raw / gzip，排除已載入 entry graph | 340,587 / 89,819 bytes | 183,368 / 51,551 bytes |
| Dashboard chunk 本身 raw / gzip | 332,476 / 86,772 bytes | 105,107 / 30,001 bytes |

登入初始 JS 稍增，沒有宣稱整包或登入 bundle 全面縮小。改善來自降低 Today 的額外載入與不必要 DOM；所有功能進入後仍需要其程式。Node lab 未使用 HTTP gzip，表中 gzip 為離線檔案大小，實際 ResourceTiming 亦保留。

獨立 production React Profiler 的中位數：寵物導航 App tree `actualDuration` 加總 **1,402.3 → 80.3 ms**、PetCard render calls **322 → 24**；餵食 App render 加總 **406.7 → 97.6 ms**、PetCard calls **2 → 1**。這些是帶 profiling 額外成本的 render 統計，不混入上表正常 build 時間。既有 focused Zustand subscriptions 保留，沒有導入新的 Store 抽象或改變 timer／decay／reward 計算。

最終證據：`after-final-{report,runs,normal-bundles,profiling-bundles}.json`、`comparison.json`、`after-final-20261120.log`；來源為 `7c7f9a9` 加本機修改，量測前後 tracked diff SHA-256 一致：`5cf1653c091d2c3a6f25fea46fa89b85dce715305a2d4edd53c0928251125b53`。該 hash 不包含 untracked 文件／測試／量測腳本，範圍已在 metadata 註明。

## 教師操作比較

| 任務 | 原流程 | 新流程與取捨 |
| --- | --- | --- |
| Today 開始活動 | 快捷按鈕直接進活動 | 同樣一次按鈕直接開啟唯一寵物列表 |
| 找到學生並餵食／升級 | 活動／寵物的整班長列表 | 上方寵物活動 → 班內搜尋或分頁 → 原操作；不改資格或成本 |
| 個人／隊伍對戰 | 寵物卡可對戰，另有重複的對戰列表 | 保留同一卡片的對戰／組隊操作，管理頁提供相同 hub 入口 |
| 魔王設定及討伐 | 管理設定下重複整班卡片 | 設定保留；透過 hub 進入討伐，多一個明確入口但減少管理頁負擔 |
| 全班／指定學生加減分 | 加減分 → 原全選／勾選 → 調整 dialog | 操作與全班範圍不變；離開時不保留資料列 DOM，返回時恢復選取與原因 |
| 唯讀展示 | 上方展示大廳 | 寵物活動 → 唯讀投影；低使用功能多一層入口，舊 `#/presentation` 仍有效且隔離教師 DOM |

## 驗證紀錄

以下是已完成的本機實測及驗證紀錄；效能數字僅適用本文列出的合成負載與測試環境，不代表正式環境成效或完整 WCAG 符合性。

先前執行紀錄均保留：

- 新增寵物 a11y 第一輪 0/6、第二輪 4/6，修正三處實際對比問題與兩項合成 fixture 設定錯誤後 6/6。其後追加徽章正常文件流及不重疊斷言，仍須完成最終全套驗證。
- 新增 5 項 E2E 第一輪 3/5，因 fixture 未明確關閉 inclusive mode 而正確被遮罩；測試 owner 明確選擇全名後 5/5。跨班資料與 Request Body 的隔離斷言都保留。
- 將 97 項 E2E 共用一個 server／DB 執行得到 59 passed、13 failed、25 did not run。trace 確認多項失敗尚未進入功能即收到 login／register 429；另修正兩處舊導覽入口。後續沿用既有 CI 的 `EPET_CI_KIND`／`EPET_CI_SPEC` + `node scripts/release-ci.mjs browser`，每個 spec 使用新的合成 server／DB，不提高或停用限流。
- 第一輪 `npm run verify` 在 D1 onboarding 遇到 ECONNRESET；同一原子性測試隔離重跑 1/1。第二輪在 Wrangler dry-run 子程序 60 秒未退出而失敗；Worker 真實 bundle 測試隔離重跑 2/2。不能據此宣稱環境問題已根治。測試 fixture 排除 Codex agent detection 並隱藏 Wrangler banner 的額外版本查詢，保留 metrics 關閉、60 秒逾時、實際 bundle 與所有 runtime／隱私斷言。未修改 Wrangler 套件、Node compatibility flags、Secrets 或正式設定。

完整 `npm run verify` 最終已通過（`verify-20261119-acceptance.log`）：795 Node tests、94 legacy rule checks，0 failed、0 skipped；8 個 migration checksum 驗證、TypeScript、production build／無測試分析 hooks 檢查、Worker dry-run 均成功。執行時僅在本機子程序暫時移除 `CODEX_THREAD_ID`、設定 `WRANGLER_HIDE_BANNER=true`，結束後還原；沒有停用測試或更動任何安全條件。隔離 fixture 修改途中另一次被 TypeScript 擋下，已以 `NodeJS.ProcessEnv` 明確型別修正，未跳過編譯。

最終瀏覽器覆蓋 **139 項、0 failed／skipped／didNotRun**：103 E2E、27 Accessibility、9 local D1 capacity。先完成整個 25-spec CI 矩陣，最後兩行 tbody 修正再跑 55 項相關 E2E 與全部 27 項 a11y。導航套件曾有一次 `Page.captureScreenshot: Unable to capture screenshot`；保留截圖與所有斷言不變，完整 15 項在新資料庫重跑皆通過。每個 spec 都使用既有 `node scripts/release-ci.mjs browser` 與其 `EPET_CI_KIND`／`EPET_CI_SPEC`，未共用限流配額或關閉保護。

最終合併證據為 `output/frontend-experience/browser-matrix/acceptance-summary.json`，逐 job 標明原完整矩陣、最後相關重測與導航確認的來源階段。最新 a11y jobs 的 **67 份唯一 axe reports 為 0 violations（所有 severity）**；37 份仍有 **204 次 color-contrast incomplete 節點紀錄**，含漸層、偽元素及背景遮蔽，並非 204 個獨立缺陷或已通過。

已實際驗證：限班 Teacher 的 DOM／搜尋／State PUT 只含授權班級，另一班相同 student ID 的資料不變；Viewer 沒有互動入口；班級切換、feature flags、投影 canaries、登入政策載入前 inert、未完成編輯、分頁後全部對手、真正保存／重載、conflict／draft recovery、匯入／CSV／報告及既有遊戲結果。最終 tbody 改動後 `npm run lint`、`npm run build`、`npm run check:worker` 另行成功（`*-final-20261120.log`）。

## 修改檔案與相容性

| 檔案 | 用途 |
| --- | --- |
| `src/App.tsx` | 私有 hub、驗證授權／scope gates、投影分離、唯一 selector ID、native reward modal |
| `src/components/AuthScreen.tsx` | 穩定公開登入版面；政策未確認前保持 inert／disabled／submit guard |
| `src/components/DashboardView.tsx` | 按需載入及保留草稿、管理 launcher、Today 直達、背景可見性控制 |
| `src/components/ClassroomView.tsx` | 共用 activities 模式；排行榜不再回退為互動卡片；保留隊伍排行 |
| `src/features/classroom/components/ClassroomStudentGrid.tsx` | 授權班級內搜尋、24 張分頁、狀態提示與鍵盤焦點 |
| `src/features/rewards/components/RewardsSection.tsx` | 隱藏時不建立整班資料列，保留 owner state 與 Today 快捷 dialog |
| `src/features/classroom/components/Classroom{BattlePanel,TeamDialog,BossPanel}.tsx` | 捲動與短螢幕可用性、實測文字對比 |
| `src/features/pets/components/Pet{CareActions,BattleActions,EvolutionAction,CardHeader,Badges}.tsx` | 操作尺寸、換行、對比、徽章不遮蔽姓名 |
| `src/features/teacher-console/components/TeacherClassContext.tsx`、`src/i18n/translations.ts` | 保留既有對外預設值；hub 使用獨立 ID 與繁中／英文名稱 |
| `tests/e2e/pet-activities.spec.ts`、`tests/accessibility/pet-activities.spec.ts` | 新增 6 項流程／授權／登入政策／選取保留及 6 項雙語 responsive／keyboard／axe 測試 |
| 既有 `dashboard-refactor`、`game-features`、`privacy-management`、`product-analytics`、`teacher-console-navigation`、`teacher-onboarding`、a11y `pages` 與 E2E fixtures | 更新真實新入口；保留原有資料、隱私與遊戲斷言 |
| `tests/workerMonitoringRuntime.test.ts` | 隔離乾跑測試的額外 CLI 查詢，不變更 runtime 防護或斷言 |
| `scripts/measure-frontend.ts` | 可重複的本機 production／profiling 實測，僅合成資料與固定 loopback target |
| 本文件、`docs/gamification-experience.md`、`docs/teacher-console-information-architecture.md` | 新流程、安全邊界、基準及驗收證據 |

沒有修改 domain、Store 持久化、Repository、API、Migration、workflow、依賴版本或正式設定。既有會員、學生、班級、歷史評量、遊戲經濟與進度資料格式維持不變；搜尋與分頁僅限制畫面掛載量。無 Schema Migration、Secrets 或 Cloudflare／GitHub 設定需求。未推送、未部署、未讀寫正式學生資料。

## 人工驗證範圍

NVDA／VoiceOver、真實觸控裝置、瀏覽器 200%／400% 縮放、真實網路與正式環境的 Core Web Vitals 仍需另行驗證。320 CSS px reflow、axe 與 Chromium 鍵盤測試不能取代上述檢查。

| 檢查範圍 | 已驗證 | 尚需人工／外部驗證 |
| --- | --- | --- |
| Reflow、語意、狀態提示 | 320／768 px、繁中／英文長姓名、labels／headings／live status、axe | 真正 200%／400% zoom、Safari／iOS、NVDA／VoiceOver |
| Keyboard／focus | native modal、Tab wrap、Escape 保留原寵物、回焦、分頁標題、可見 footer | 實體鍵盤、螢幕閱讀器公告、觸控切換方向 |
| Contrast／targets | 三處已確認對比修正；寵物主要 actions 高度至少 44 px | 204 次 incomplete 的實際背景／漸層人工對比；不要把 44 px 當成 AA 唯一門檻 |
| 性能與容量 | 300 人 Node JSON lab、local D1 容量與恢復測試 | 真實網路、較弱手機、含大量歷史的 synthetic staging；未量測 Production D1 速度 |

登入 CLS 測試使用關閉 Turnstile 的合成設定；正式啟用且金鑰已驗證的 Turnstile widget、Email 驗證等營運配置，仍須在 staging 檢查版面與登入。初始 JS 仍包含既有 SDK，明確開啟的完整加減分名冊與唯讀投影也尚未虛擬化；本次不為降低 DOM 而截斷操作對象或投影內容。先前本機 D1 連線中斷與 CLI 程序逾時的完整根因未被證實，本次隔離驗證成功不代表已根治所有工具環境問題。

參考：[React Profiler](https://react.dev/reference/react/Profiler)、[WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)、[WCAG AA target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)、[Web Vitals](https://web.dev/articles/vitals)。AA 指標的最小觸控目標為 24 CSS px（含例外）；本次行動操作以 44 px 作為介面設計目標，不把小於 44 px 一律判為 AA 失敗。
