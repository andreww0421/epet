# DashboardView refactor

> 後續更新（2026-10-02）：下文保留當時 feature-oriented refactor 的背景；目前 Teacher Console 的導覽、模式拆分及功能位置請見 [information architecture](teacher-console-information-architecture.md)。原本七個 feature tabs 已由五個主工作區＋secondary Settings 取代，feature ownership、domain/API 與權限邊界維持不變。

## 原本問題

`src/components/DashboardView.tsx` 原本有 2,682 行，同時負責頁面導覽、權限顯示、表單草稿、資料匯入／匯出、學生與班級管理、獎懲、學習目標、Boss、設定與紀錄。這造成幾個問題：

- 功能邊界不清楚；修改單一功能時需要理解整個 dashboard。
- 大量 feature-specific state 與事件處理集中在頁面 component，難以個別測試。
- 顯示、表單協調與可重用的 domain transformation 混在一起。
- 既有專用面板雖已拆檔，仍集中在 `src/components/dashboard/`，無法從目錄判斷其 domain owner。
- 權限與唯讀模式的條件分散，增加日後誤顯示寫入操作的風險。

本次採取漸進式重構，沒有重新設計 UI，也沒有更動 API contract、資料格式或 database schema。既有大型面板以搬移和薄包裝為主，避免在同一次變更中重寫已運作的互動。

## 新 architecture

```text
src/
├─ components/
│  ├─ DashboardView.tsx              # page shell
│  └─ ui/
│     ├─ DashboardTabs.tsx           # accessible tab navigation
│     └─ DeleteConfirmationDialog.tsx # 共用刪除確認 dialog
├─ studentEnrollment.ts              # canonical student enrollment defaults
└─ features/
   ├─ analytics/components/          # 學生與班級分析、經濟指標
   ├─ boss/components/               # Boss 操作與獎勵設定
   ├─ exams/{components,model}/      # 考試評量流程與 draft transformation
   ├─ learning/{components,model}/   # 學習目標、證據導引、能力標籤
   ├─ penalties/components/          # 處罰狀態、操作與復原提示
   ├─ records/{components,model}/    # 日常紀錄、導師回饋、週報與 typed 彙整
   ├─ rewards/{components,model}/    # 點數、獎勵、公平性與原因選項
   ├─ settings/{components,hooks}/   # 設定畫面與 draft/save orchestration
   ├─ students/{components,model}/   # 班級、學生與名冊匯入
   └─ workspace/{components,hooks}/  # header、匯入匯出、治理、權限與 mutation guard
```

Domain 計算仍使用既有的 `gameRules`、`educationInsights`、`economyInsights`、`weeklyFeedbackReport` 與 Zustand store actions，沒有複製既有規則。新的 `model` modules 只承接原本位於 React component 內的純資料轉換：考試 draft 建立／複製／結果更新、點數原因排序／在地化，以及 records 的歸屬與排序。學生註冊預設則集中在 React-independent 的 `src/studentEnrollment.ts`，供 dashboard 單筆新增與 store／名冊匯入共用。

原本 `src/components/dashboard/*` 的 module paths 保留為薄 re-export compatibility shims；實作與內部 imports 已移至 feature owner。這讓既有 consumer 不需同步改 import，又不會產生兩份邏輯。

`DashboardView` 由 2,682 行降至 185 行，現在只負責：

- 組合 dashboard page 與 lazy-loaded sections。
- 管理目前導覽 section。
- 協調唯讀班級、workspace capability，以及跨 feature 才需要的 language／pet-care drafts。
- 將可見狀態與高層 context 傳給 feature sections。

唯讀模式仍只開放 analytics 與 records。Records 的導師回饋 callback 也保留 `runWorkspaceMutation` guard，避免僅靠隱藏 UI 來阻止寫入。

可編輯 feature 在 tab 或權限切換時會保持掛載，以保留既有 draft lifecycle；`useWorkspaceMutationGuard` 會在 capability 改變後攔截所有殘留 callback 並顯示既有唯讀錯誤，不能只依賴 CSS 隱藏控制項。

## Component responsibilities

| Component / module | Responsibility |
| --- | --- |
| `DashboardView` | Page composition、navigation、capability 與跨 feature 高層 state coordination。 |
| `DashboardTabs` | Tab 清單、鍵盤導覽、ARIA 關聯與角色／唯讀可見性。 |
| `DashboardHeader` | Dashboard 標題及現有 JSON import/export 流程。 |
| `StudentManagementSection` | 班級選擇、新增／刪除／重設、學生新增與名冊匯入 UI orchestration。 |
| `AddClassDialog` | Students feature 的新增班級輸入與送出互動。 |
| `createDashboardStudent` / `createEnrolledStudent` | UI enrollment adapter 與跨單筆／名冊匯入共用的 canonical Student 預設資料。 |
| `RewardsSection` | 學生點數表、單人／批次／全班調整 dialogs、原因設定與公平性摘要。 |
| `PointAdjustmentDialog` | Rewards feature 的單人、批次與全班點數調整表單。 |
| `buildPointReasonOptions` | 純函式處理原因選項的在地化、釘選與最近使用排序。 |
| `StudentPenaltyStatus` / `StudentPenaltyControls` | 警告與處罰狀態、解除操作、正式操作確認與 cooldown 顯示。 |
| `DashboardUndoNotices` | Point 與 safety action 的 undo notices。 |
| `LearningActivitiesSection` | 每週學習目標表單、進度指標與學習證據操作說明。 |
| `LearningEvidenceForm` | 手動學習證據 draft 與既有 store mutation orchestration。 |
| `BossManagementSection` | Boss 設定、攻擊、獎勵草稿與結果呈現。 |
| `StudentAnalyticsSection` / `StudentAnalyticsPanel` | 學生分析、學習證據及考試／經濟分析的組合。 |
| `ExamAssessmentPanel` | 既有考試建立、作答與評量流程。 |
| `examDraft` model | 考試 draft 建立、深層複製、學生結果更新與輸出格式的純函式。 |
| `DashboardRecordsSection` | 選取班級的 records adapter，以及唯讀 mutation guard。 |
| `DashboardRecordsPanel` | 紀律、點數、導師回饋與 Boss 紀錄呈現。 |
| `buildDashboardRecordCollections` | 純函式處理跨學生紀錄歸屬、排序與顯示數量上限。 |
| `WeeklyFeedbackReportPanel` | 週回饋報表選擇、呈現與既有 CSV 匯出。 |
| `DashboardSettingsSection` | Settings feature 的 presentation composition。 |
| `useDashboardSettings` | 設定 drafts、presets、impact preview 與既有 save actions 的協調。 |
| `SettingsOverview` | Preset、影響摘要、安全與隱私設定 presentation。 |
| `GameRuleSettings` | 一般、經濟、Boss、戰鬥、排名與賽季設定 presentation。 |
| `DailyTaskCalendarSettings` | 現有每日任務行事曆設定。 |
| `DataGovernanceSection` / `DataGovernancePanel` | Workspace 資料治理與稽核操作。 |
| `WorkspaceAccessPanel` | Workspace 成員及角色管理。 |
| `useWorkspaceMutationGuard` | 在 feature 邊界統一執行唯讀檢查及既有拒絕提示。 |
| `DeleteConfirmationDialog` | 共用、具標題與描述關聯的刪除確認 dialog。 |

## 尚未處理的 tech debt

- `ExamAssessmentPanel`、`DataGovernancePanel` 與 `DashboardRecordsPanel` 仍然偏大。考試 draft 純函式已先抽出，其餘後續可在各 feature 內再依 workflow 拆分，但應逐一配合 E2E 測試，避免 massive rewrite。
- `RewardsSection` 仍同時協調選取狀態與數個 dialog。若未來新增更多獎勵流程，可抽出 feature-local controller hook；目前保留在同一 section 以維持互動狀態與 DOM behavior。
- `useDashboardSettings` 集中許多既有設定 draft。它已與 presentation 分離，但可在新增設定類別時依 general/economy/battle/season 拆成較小 hooks。
- 現有單元測試涵蓋 enrollment、exam draft、point reason 與 records 純 model；E2E 直接保護 learning goal、settings save、Boss 建立、全班 reward 與 undo，既有 suite 另涵蓋名冊匯入與資料同步。尚未建立 component-test runner，因此 feature-local draft 與 capability prop 的細粒度 lifecycle 目前以 code review、mutation guard 與 browser flow 間接保護。
- Feature modules 仍直接使用 Zustand selectors/actions。若未來需要替換 state layer，可再引入 feature service adapters；本次沒有新增抽象層，以免複製 store 的既有 business logic。
