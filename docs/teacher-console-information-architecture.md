# Teacher Console information architecture

## Problem and direction

The former seven feature tabs mixed unrelated teaching tasks. Analytics contained evidence entry and exams; Activities combined weekly learning goals with boss management; Records combined daily comments, reports and ledgers. Settings appeared beside everyday work, while the current class selector was available only under Students.

The console starts at **首頁 / Today**. As of 2026-11-03, four primary work areas organize daily teaching: **首頁、班級、教學、活動** (Today, Class, Learning, Activities in English). **管理設定 / Settings** remains an independent administrator action. Analysis is available in its relevant workflow instead of a separate Insights area. There are no expandable menu trees. The existing indigo/slate visual language, editors and feature ownership remain in place.

## Destination map

| Area | Tasks | Existing functionality reused |
| --- | --- | --- |
| Today | Current class, quick actions, pending work, recent activity, important alerts | Read-only projections of existing feedback, goal, boss, evidence, exam and ledger data |
| Class / 班級 | Students, groups, **加減分**, daily comments, records; contextual student/class analysis | Enrollment/import, class administration, existing classroom teams, point and penalty actions, mentor comments, record ledgers; existing student competency and class/economy analysis |
| Learning / 教學 | Evidence, exams, goals, weekly feedback reports; contextual learning trends | Existing evidence editor, assessment/results and exports, weekly class goals, weekly A4/CSV feedback reports; evidence and competency trend indicators |
| Activities | Pets, boss, battle, game rewards, leaderboard | Same classroom pet/battle/boss controls and dialogs; boss management; existing boss reward history; individual and team leaderboards |
| Settings | Rules, reward settings, workspace/users, security/account, data governance | Game/calendar settings, point reasons/guardrails/participation/season rewards, summon-time boss reward drafts, RBAC/invitations, privacy/public display controls, exports/import, revision recovery, audit and account lifecycle |

`班級 > 加減分` replaces the ambiguous `Class > 獎勵` label and retains the same point feedback and penalty operations. `活動 > 遊戲獎勵` means recorded game outcomes. Configuration belongs in `管理設定 > 獎勵設定`. These are distinct tasks, not duplicated reward implementations.

Groups are the existing game teams, not a new classroom grouping model. Activities embed the existing classroom implementation; the standalone student presentation hall is still available from the application header. Pets and Battle retain shared pet-card actions rather than introducing alternate gameplay controls.

The existing usage guide remains available below the pet/battle controls so the selected task is immediately actionable.

Security routes directly to existing workspace access and governance/account-lifecycle controls. Password recovery remains on the sign-in screen. No new session-management or authentication API is implied.

## Responsibilities and state

- `features/teacher-console/model/navigation.ts`: typed, localized destination map and presentation capability filtering. It does not grant backend authorization.
- `TeacherConsoleNavigation`: four localized primary areas and one flat task tablist, active semantics and keyboard behavior. `WorkflowAnalysisLinks` adds lightweight analysis tabs as direct children of the same tablist, visually separated by an analysis caption. It does not create a nested navigation level.
- `TeacherClassContext`: persistent class context. Writers use the existing guarded switch action; viewers select a class locally without changing persisted workspace state.
- `TeacherTodayDashboard` (`TodayOverview` compatibility export) and `model/todayOverview.ts`: a bounded, non-mutating, action-oriented workbench. Pending counts are optional reminders, not invented deadlines or mandatory tasks. Daily comments use the class calendar timezone; weekly goals and point fairness retain their existing global calendar definitions. The summary refreshes immediately on data changes and every minute while visible. See [Teacher Today Dashboard](teacher-today-dashboard.md) for its action flow and reminder definitions.
- `ClassGroupsPanel`: adapts the existing team hook/dialog and canonical team membership helper.
- `ConsoleSecurityPanel`: links to existing security operations, without copying authentication logic.
- `DashboardView`: composition, navigation, capabilities and high-level shared drafts. It remembers the last task per area for the current mounted console.
- Existing Analytics, Records, Rewards, Boss and Settings components expose backward-compatible presentation modes (default `all`). One owner remains mounted for each editor. Hidden wrappers remove inactive controls from keyboard/accessibility traversal without discarding drafts. Heavy analytics/governance/game bundles load on first use.
- `ClassroomView` optionally embeds focused game surfaces, retaining the standalone default. Embedded dialogs open only while the surface is visible.

Settings still has one shared draft/save owner. Save applies pending rule, reward and governance drafts together, exactly as before; a visible hint makes that clear. Boss reward settings remain summon-time drafts and take effect on the next summon, not an independent settings save.

## Accessibility and responsive behavior

Primary navigation uses native buttons in the `Teacher Console` landmark with `aria-current="page"`. Task tabs use `aria-selected`, one roving tab stop, arrows, Home/End, and an associated focusable panel. Active state is expressed through shape/border/weight as well as color. Keyboard focus remains visible.

The four primary actions fit one compact mobile row; administrator Settings is on a separate mobile row and beside the primary navigation on desktop/tablet. Viewers see only the three areas with authorized read functions. Task tabs wrap instead of creating deep mobile menus. Analysis tabs share the same Arrow Left/Right and Home/End sequence as work tabs, with exactly one selected tab and roving tab stop. New navigation targets are at least 44px high. Class context and Today cards stack on narrow screens.

Owner/admin Settings gates, teacher class assignments, viewer read-only restrictions and backend RBAC are unchanged. Viewers retain analytics, records, saved exams and reports. They do not see mutation destinations or Settings. APIs, database schema, persisted data, game values, CSRF and authorization contracts are untouched.

## 2026-11-03 導覽調整與操作對照

先檢查原有五區導覽與既有 Today 快捷操作，再調整入口；沒有重做已存在的加減分、考試、評語、報告或分析功能。

| 原入口 | 新入口 | 保留的功能 |
| --- | --- | --- |
| Today | 首頁 | 現有六個每日快捷操作、摘要、提醒與最近活動 |
| Class／獎勵 | 班級／加減分 | 原本的積分回饋、處罰與相關操作；只修改入口名稱 |
| Learning | 教學 | 學習證據、考試分析、本週學習目標、每週回饋報告 |
| Activities | 活動 | 寵物、魔王管理、對戰、遊戲獎勵與排行榜 |
| Insights／個人分析、班級分析 | 班級／分析入口 | 同一個既有 analytics owner 與 student／class mode |
| Insights／學習趨勢 | 教學／分析入口 | 既有 trends mode，沒有加入新學生成績分析資料 |
| Settings | 管理設定 | 獨立管理入口，原 owner／admin gate 與 shared save 維持 |

主要導覽由五區減為四區；23 個 destination ID、產品事件 enum 與功能存取條件完全保留。分析入口在相關工作區內以較輕的視覺層級呈現，沒有第三層選單。繁體中文畫面使用首頁／班級／教學／活動／管理設定，English 設定則保留 Today／Class／Learning／Activities／Settings。

操作步數只計切換功能的點擊，不計輸入、保存或瀏覽器下載確認；假設從指定畫面開始、舊 Insights 尚未記住其他分頁：

| 任務與起點 | 修改前 | 修改後 |
| --- | --- | --- |
| 首頁快速給分／扣分 | Today → 給予／扣除積分：1 次 | 首頁 → 同一快捷操作：1 次；保留原有快速流程 |
| 班級學生頁開啟加減分 | 獎勵：1 次 | 加減分：1 次；入口直接描述任務 |
| 班級工作中查看班級分析 | Insights → 班級分析：2 次 | 分析入口 → 班級分析：1 次；維持目前班級脈絡 |
| 教學工作中查看學習趨勢 | Insights → 學習趨勢：2 次 | 分析入口 → 學習趨勢：1 次 |
| 首頁建立考試 | 建立／匯入考試：1 次 | 同一快捷操作：1 次 |
| 教學中準備回饋報告 | 每週回饋報告：1 次 | 同一分頁：1 次；與考試／學習證據並列 |
| 管理員進入規則設定 | Settings → 規則：最多 2 次 | 管理設定 → 規則：最多 2 次；非管理員仍不可見 |

每區原有「記住上次功能」仍保留，實際步數可能因已記住的分頁減少。不是所有流程都減少點擊；本次改善重點是命名、分類與分析工作脈絡。

改動限四個產品檔：`src/components/DashboardView.tsx`、`model/navigation.ts`、`components/TeacherConsoleNavigation.tsx`、新增 `components/WorkflowAnalysisLinks.tsx`（後三者位於 `src/features/teacher-console/`）。其餘修改為導覽／流程測試及本文件。沒有改 API、schema、遊戲運算、Store、AuthProvider 或工作區／班級切換 guard。

本機合成基準已拍攝並檢視：[首頁桌面](../output/console-refresh/before-today-desktop.png)、[班級桌面](../output/console-refresh/before-class-desktop.png)、[原 Insights](../output/console-refresh/before-insights-desktop.png)、[375px 首頁](../output/console-refresh/before-today-mobile-375.png)。原 375px 導覽沒有水平溢出；不是憑想像新增 responsive 問題。新版本需再以相同尺寸與合成資料檢查。

### 本次實際驗證結果

狀態：**Completed（本機實作與驗證）**。只使用合成資料；未部署、未執行遠端 migration 或變更正式資料／Secrets。

| 命令／檢查 | 結果 |
| --- | --- |
| `npm run lint` | exit 0，產品與測試 TypeScript 通過 |
| `npm run test:dashboard` | 22 pass／0 fail／0 skip；含四區、23 個 ID、權限及分析分組回歸 |
| `npm run test:rules` | 94 legacy rules＋2 architecture cases 通過，0 fail |
| `npm run test:analytics` | 84 pass／0 fail／0 skip；固定事件 enum、Node／D1 onboarding 與 actual Worker 等既有契約保留 |
| 下列主要流程 E2E | 29 pass／0 fail／0 skip；新導覽、草稿、加減分／undo、成績匯入、報告、角色、workspace／class scope、產品事件與展示模式等 |
| 鎖定依賴下四個導覽核心 E2E 重驗 | 4 pass／0 fail／0 skip；是上述 29 案的重驗，不能加總為 33 個獨立案例 |
| `npm run test:a11y` | 20 pass／0 fail；48 個不同 axe 掃描狀態、0 confirmed violations；23 個狀態有 color-contrast incomplete，仍需人工確認 |
| `npm run build` | exit 0；production artifact guard 通過，沒有合成 analytics hook |
| 修改前後截圖 | 同一合成情境、相同尺寸對照；8 個新畫面均已檢視，沒有觀察到水平溢出／裁切 |

主要流程 E2E 的實際命令：

```text
npx playwright test tests/e2e/teacher-console-navigation.spec.ts tests/e2e/dashboard-refactor.spec.ts tests/e2e/exam.spec.ts tests/e2e/product-analytics.spec.ts tests/e2e/workspace.spec.ts tests/e2e/permissions.spec.ts
```

工作區既有 Vite 為 8.1.5，與 lockfile 的 8.1.6 有 patch 差異；React 19.2.8、Tailwind 4.3.3、Playwright 1.62.1 一致。因此 analytics／production build 與最終截圖採用先前已 `npm ci` 的隔離副本，再以該 lockfile 依賴重跑：

```text
npx playwright test tests/e2e/teacher-console-navigation.spec.ts --grep 'task areas are primary|four-area navigation|analysis entries stay|drafts survive'
```

沒有為本次更新依賴、移除測試或調低 axe／安全條件。29 項 E2E 與 20 項 a11y 是工作區依賴下的完整指定套件；4 項是乾淨依賴下的關鍵重驗，不混淆其覆蓋範圍。本次沒有重跑整套 `npm run verify` 或所有 E2E，不沿用先前任務的完整驗證數字作為本次證據。

本機保存 `output/console-refresh/validation-20261103.json`、各 command logs、axe reports 與截圖。15 個產品／測試驗證輸入與隔離副本 SHA-256 相同；60 個 backend／Worker／migration／domain／Store 程式檔前後 SHA-256 全部不變。僅 Docs 最後補登證據。

新增／更新的測試檔：`tests/teacherConsole.test.ts`；`tests/e2e/support/fixtures.ts`；`tests/e2e/{teacher-console-navigation,class-lifecycle,data-safety,permissions,privacy-management,product-analytics}.spec.ts`；`tests/accessibility/{class-lifecycle,keyboard,pages}.spec.ts`。其中部分僅更新入口位置與可見文字，原資料／安全斷言保留。

### 畫面對照與限制

修改後證據：[桌面首頁](../output/console-refresh/after-today-desktop.png)、[桌面班級](../output/console-refresh/after-class-desktop.png)、[班級分析](../output/console-refresh/after-class-analysis-desktop.png)、[375px 首頁](../output/console-refresh/after-today-mobile-375.png)、[375px 班級](../output/console-refresh/after-class-mobile-375.png)、[768px 教學](../output/console-refresh/after-learning-tablet-768.png)。另檢查 812px 橫向與 375px English，layout measurements 見 `after-layout.json`。

相同 1440px 桌面情境中，首頁完整高度 1330 → 1269px；班級頁 1032 → 1064px，增加的 32px 換來兩個工作流程內分析入口。375px 首頁維持 1894px，沒有宣稱減少手機捲動。保留原配色、icon、表單與編輯器；這次改善是入口辨識與任務脈絡，不是整套視覺重設。

無障礙自動檢查不構成完整 WCAG AA 或 screen-reader 驗收。48 份原始 axe 報告另有 attachment 複本，統計時已排除重複；23 個 contrast incomplete 狀態不等於 23 個已確認違規。實際螢幕閱讀器、200／400% zoom、Firefox／WebKit、既有 modality／人工 contrast backlog 仍未完成；不能因此關閉其他 a11y Finding。下列 2026-10 歷史結果只作沿革。

## Historical verification and follow-up debt

Regression coverage includes destination/capability mapping, school-timezone reminders, immutable bounded summaries, primary/mobile/keyboard navigation, editor draft retention without writes, relocated settings/export functionality, team editing and embedded game workflows, and viewer saved-exam review with server write denial. Existing E2E and axe checks are retained and updated to the new task locations.

Leaderboard coverage explicitly checks the default hidden individual board and the existing team board before opting into growth display through the real Settings UI. Neither production privacy defaults nor gameplay values were changed to satisfy the test.

The new console suite and existing dashboard/workspace suites reuse real registered owners with separately created workspaces. This reduces setup registrations while retaining real cookies, CSRF, backend authorization, independent browser contexts and workspace data isolation. Production rate limits are unchanged. As of the 2026-10-03 Today implementation, login and workspace session reset start at Today; the standalone presentation hall remains available from the header.

TypeScript excludes generated `dist`, browser reports under `output`, coverage, and Wrangler artifacts. Application, server, shared domain, scripts and tests remain checked; no diagnostics are suppressed or rule checks disabled.

Final local verification on 2026-10-02:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed; application and test TypeScript checked |
| `npm test` | 230 checks passed, including game rules, authentication, server and D1 regressions |
| `npm run test:dashboard` | 11/11 passed, including five new console model regressions |
| `npm run build` | Passed; browser suites also rebuild the current production bundle |
| `npm run check:worker` | Passed; dry-run only, no deployment |
| `npm run test:e2e` | 26/26 passed, including six new Teacher Console scenarios |
| `npm run test:a11y` | 13/13 passed; 25 distinct axe scan states, zero confirmed violations |
| `git diff --check` | Passed |

Desktop Today/Class/Boss/Settings and mobile screenshots were reviewed. Six axe states still have color-contrast `incomplete` findings; these are manual-review work, not evidence of conformance. See [accessibility backlog](accessibility-backlog.md) for the remaining accessibility and screen-reader work. E2E and accessibility run sequentially against isolated local test data on port 3100, never production Worker/D1.

The subsequent Teacher Today implementation was verified on 2026-10-03: `npm test` 240 checks, E2E 29/29, axe 13/13 with 29 distinct states and zero confirmed violations, lint/build/Worker dry-run all passed. The six existing contrast-incomplete states remain. See [Teacher Today Dashboard](teacher-today-dashboard.md) for the changed-file inventory, action flows and reminder definitions.

Remaining deliberate boundaries:

- Navigation remains in-memory, matching the previous console. URL deep links/history restoration require a separate routing change.
- Learning trends reuse existing indicators, not a newly invented historical time-series dataset.
- Governance retains its existing internal revision/export/audit/lifecycle tab strip. Flattening that complex workflow can be a later scoped change.
- Settings saves all shared drafts; independent per-task saving would change existing behavior and needs a separate design decision.
- Some existing dense tables and legacy form controls still use their original responsive layout/touch sizing; this change does not redesign every feature panel.
