# ClassroomView feature-oriented refactor

> 2026-10-03 audience boundary update: 展示大廳入口與未指定 `consoleMode` 的 `ClassroomView` 現在使用獨立唯讀投影；原有遊戲互動、學習成長榜與隊伍榜保留在 Teacher Console 的 Activities。下列重構紀錄描述原有互動元件拆分；最新公開資料 allowlist、投影選項及退出機制見 [Classroom presentation boundary](classroom-presentation-boundary.md)。

## 原本問題

`src/components/ClassroomView.tsx` 原本有 1,041 行，單一 React component 同時處理：

- 展示大廳三種檢視的導覽與切換
- 學生卡片清單與空狀態
- 個人學習成長、競技排名、隊伍排名的資料轉換及 UI
- 班級學習目標的週期、進度與涵蓋率計算
- Boss 狀態、班級攻擊、恢復狀態、貢獻排名與勝利結果
- 個人／隊伍戰的出戰資格、對手篩選、設定文案與 modal 狀態
- 組隊候選人、選取草稿、清除與儲存 modal 狀態
- 公開姓名遮罩與排名視覺資訊

這使 presentation、互動協調與 domain-derived data 緊密耦合；同一批學生資料也在多個 JSX 分支中重複遍歷。大型 component 很難針對單一功能做回歸測試，也容易在修改排行榜時意外影響戰鬥或 Boss 畫面。

## 新 architecture

`ClassroomView` 保留既有 public import path，縮減為約 215 行的 page composition layer。它只訂閱頁面需要的 store slice、協調目前 view mode、建立穩定的公開姓名／規則設定，並組合 feature components。

```text
src/components/ClassroomView.tsx
  └─ src/features/classroom/
     ├─ components/
     │  ├─ ClassroomHeader.tsx
     │  ├─ ClassroomStudentGrid.tsx
     │  ├─ ClassroomStudentCard.tsx
     │  ├─ ClassroomLeaderboard.tsx
     │  ├─ ClassroomTeamLeaderboard.tsx
     │  ├─ ClassroomActivityPanel.tsx
     │  ├─ ClassroomBossPanel.tsx
     │  ├─ ClassroomBossVictoryDialog.tsx
     │  ├─ ClassroomBattlePanel.tsx
     │  └─ ClassroomTeamDialog.tsx
     ├─ hooks/
     │  ├─ useClassroomBattleDialog.ts
     │  ├─ useClassroomTeamDialog.ts
     │  ├─ useClassroomRecoveryClock.ts
     │  └─ useClassroomRankInfo.ts
     ├─ model/classroomModels.ts
     ├─ types.ts
     └─ index.ts
```

純 model 保持 React-independent，重用現有 `gameRules`、`educationInsights` 與 `store/utils`，沒有複製戰鬥或學習規則。這次沒有修改 API contract、Zustand persisted data structure 或 database schema。

Memoization 只放在有實際成本或 reference-stability 需求的位置：學生／證據集合的排名與統計、Boss 貢獻、恢復人數、對手資格、隊伍聚合，以及傳給已 memoized `PetCard` 的 callback。單純字串與小型 label map 保持直接計算。

所有 dialogs 重用既有 `ModalDialog`，因此取得一致的 native modal semantics、Escape 關閉、focus containment 與關閉後 focus restoration；內容、操作順序、顏色與既有文案保持不變。

## Component responsibilities

| Component / module | 單一責任 |
| --- | --- |
| `ClassroomView` | page composition、view navigation state、store action wiring |
| `ClassroomHeader` | 標題與 grid / leaderboard / teams view navigation |
| `ClassroomStudentGrid` | 空狀態或依 persisted 順序排列學生卡片 |
| `ClassroomStudentCard` | 將 classroom interactions 接到既有 `PetCard`，不重寫卡片邏輯 |
| `ClassroomLeaderboard` | growth 或 rank 個人排行榜的呈現 |
| `ClassroomTeamLeaderboard` | 隊伍摘要、空狀態及隊伍排行榜呈現 |
| `ClassroomActivityPanel` | 目前作用中班級學習目標與週進度呈現 |
| `ClassroomBossPanel` | 作用中 Boss、HP、攻擊回饋、恢復與貢獻排名 |
| `ClassroomBossVictoryDialog` | Boss 結算 standing 與獎勵明細 |
| `ClassroomBattlePanel` | 對戰規則說明、對手選取及開始／取消操作 |
| `ClassroomTeamDialog` | 組隊草稿、候選人、清除及儲存操作 |
| `useClassroomBattleDialog` | 戰鬥 dialog 的局部狀態及 eligible opponent coordination |
| `useClassroomTeamDialog` | 組隊 dialog 的局部 draft state 與 persisted team synchronization |
| `useClassroomRecoveryClock` | 僅在存在 recovery 狀態時更新時間基準 |
| `useClassroomRankInfo` | 穩定的 rank-to-visual presentation mapping |
| `classroomModels` | battle setting normalization、對手資格、隊伍統計、排名與班級目標 view models |

## Regression coverage

`tests/classroomRefactor.test.ts` 固定時間測試：

- legacy battle-cost fallback 與每個角色的 override
- solo / team / both 對手資格及同隊排除
- 隊伍上限、聚合統計、公開姓名遮罩與 deterministic sorting
- rank sort 不 mutate persisted student order
- active weekly goal 的進度、涵蓋率與日期 label

`tests/e2e/dashboard-refactor.spec.ts` 在既有登入工作區內驗證：

- grid / growth / team leaderboard navigation state
- 公開姓名仍套用 masked mode
- team dialog 建隊後資料同步與 leaderboard wiring
- battle dialog 選取對手、執行後 persisted stats 更新

既有 Dashboard E2E 也加入 classroom goal 與 active Boss panel wiring assertion。

## 尚未處理的 tech debt

- `PetCard.tsx` 本身仍是一個大型、store-aware component，包含寵物照護、每日任務、Boss 攻擊與視覺狀態。這次用薄 adapter 保持行為與風險邊界；後續應另案按 card sections 與 typed selectors 漸進拆分。
- 部分隊伍／戰鬥文案仍直接在 component 內提供中英文分支，應移入 translations catalog，但本次為保持既有 copy 與避免擴張翻譯範圍而未搬動。
- Store 的 Boss attack feedback 保存 target display names；非 recoverable 回饋沿用既有顯示方式。未來若要強化公開投影一致性，應將 feedback 改為 student IDs，再於 UI 依 `publicNameMode` 投影，這會涉及 store contract／persisted compatibility 評估。
- `ClassroomStudentCard` 目前是 migration seam，而不是 PetCard 內部責任已完全 feature 化；不能把這次重構視為完成所有 classroom 子功能的最終分層。
