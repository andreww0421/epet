# Learning：記錄 → 進度 → 回饋

> 發布範圍註記（2026-11-17）：本文件的「未 push／未部署」描述原任務驗收當時狀態。使用者後續另行授權推送 GitHub main；推送與自動部署結果以 GitHub commit／Actions 記錄為準。本機驗收不等同正式部署驗證。

規劃日期：2026-11-14；整合驗證：2026-11-15（Asia/Taipei）。基準為 main `422ca70cf9206e6b7880d30f700c3e2811ecd149`，實作分支 `codex/learning-flow-20261114`。

狀態：**Completed（本機實作與回歸驗證）**；尚未 push、合併或部署。

## 盤點與整合規劃

| 既有能力／重複操作 | 整合方式 | 必須保留的語意 |
| --- | --- | --- |
| 學習證據、每日評語、考試各自選學生 | Dashboard 共用目前班級／學生選擇；各原有 selector 可繼續操作 | 學生身分包含班級；跨班相同 ID 不共用草稿 |
| 每日評語與手動證據都有 competency、assessment、文字 | 重用 competency labels、沿用每日評語既有自動 evidence 連結 | 每日評語是一日一筆更新，160 字；手動證據是獨立紀錄，摘要 100／備註 500 字，不能雙寫 |
| 考試評語與每日評語看似相似 | 共用學生脈絡與導覽，保留各自表單 | 不自動複製評語、不由分數產生 evidence level，日期與歷史範圍不混用 |
| 學習趨勢、學生／班級分析分散 | 以三步導覽直接進入既有進度畫面 | 原計算、期間及來源標示保持原樣 |
| 班級週報與考試個別報告分散 | 流程可直接開啟週報或聚焦同一份考試的既有報告控制項 | 週報涵蓋全班，不能因所選學生縮小分母；個別 PDF 使用學生、考試及獨立報告範圍 |
| 「已保存」可能只是本機 Store 更新 | 顯示「已加入工作區」，提供明確的雲端保存確認 | 只有既有 `flushChanges()` 完成、session 未變、工作區資料未再修改，才確認雲端保存 |

小型變更順序：先接三步導覽與共用選擇；再保護未提交草稿與完成提示；最後調整手機控制項並執行回歸。沒有建立第二套編輯器、分析或 PDF／CSV 實作。

## 使用流程

1. **記錄學習表現**：沿用學習證據、每日評語、考試表單。每日評語會自動連結 canonical learning evidence，不需另輸入一次。
2. **查看學習進度**：同一學生直接進入既有學習趨勢；個人／班級分析入口仍保留。尚未提交的其他表單草稿不會因切換步驟而被清掉。
3. **產生回饋報告**：查看全班週報並下載 CSV，或選擇考試個別報告，直接聚焦既有報告範圍、評語與 A4 PDF 控制項。

流程可以往返，不強迫線性完成。原有 23 個 destination IDs、權限條件與入口不刪除；viewer 可閱讀進度及既有報告，記錄步驟與寫入控制維持停用。

共用的是學生與班級脈絡，沒有把不同用途的日期、文字或評量等級硬合成同一份欄位。遊戲積分、RP、寵物等級維持獨立；新流程不由遊戲狀態推論學習能力。原本舊資料的 point-feedback fallback 與週報來源提示仍保留，沒有重寫分析演算法。

## 草稿、同步與資料完整性

- 表單草稿只在此瀏覽器執行階段的記憶體保留，不新增未綁定身分的 localStorage／sessionStorage。短暫離線使 Dashboard 卸載時，草稿仍可於同一已驗證 session 恢復。
- 草稿 cache 綁定已驗證的 user／workspace／role／class scope 與 Store generation；重新驗證期間立即禁止讀寫，只有新的後端授權與當前 generation 相符且完整 scope 相同，才可恢復最近 30 分鐘的記憶體暫存。不同帳號、Workspace、角色／班級範圍會清除原暫存；明確採用遠端版本也會清除，避免重播舊表單。不同編輯器使用獨立 namespace，學習證據另綁班級／學生，每日評語另綁當天日期，考試編輯器綁班級。
- 切換學生／班級時不顯示另一人的輸入，切回同一安全範圍可繼續。考試換另一份歷史紀錄或新增考試前，dirty draft 必須明確確認丟棄；取消保留。
- 手動證據、每日評語及考試只有真正寫入目前班級的本機 Store 才顯示新增成功或清除 dirty／輸入。拒絕寫入仍保留草稿。
- 「確認雲端保存」只確認已提交至工作區的內容，不會自動提交未完成的表單。等待真實 ACK 時顯示進行中，409、容量、權限或網路問題沿用既有同步恢復控制，不建立另一條 API 寫入路徑。
- 未提交表單不跨完整重整持久保存，也不轉移到其他帳號、Workspace 或授權範圍。介面明確提醒先按原表單保存，再確認同步；相同帳號／scope 於此分頁重新驗證後，僅可在期限內安全恢復記憶體暫存，不新增磁碟保存。

學習證據與成績仍由原 Store／autosave、Revision CAS、RBAC、CSRF 及 tenant/class scope 管控。沒有新增 API、變更資料庫欄位或 migration，沒有修改歷史紀錄或合併學生身分。

每日評語更新維持原本的 revision 歷史：reflection／sourceId 相同，新增 revision 2 時保留 revision 1 的原始內容與 ID；既有 `getActiveLearningEvidence` 只取該來源最新版本。兩個歷史版本不是兩次重複輸入，也不能為了斷言「一筆」而刪掉舊版。新 E2E 同時驗證歷史完整與有效來源去重。

## 新舊教師操作對照

步數只計功能入口及學生選擇，不計填字、保存、捲動、瀏覽器下載確認；從已開啟某位學生的學習證據畫面開始。

| 任務 | 原流程 | 新流程 |
| --- | --- | --- |
| 證據 → 同一學生進度 → 班級週報 | 選學習趨勢 → 每週回饋報告，2 次 | 流程第 2 步 → 第 3 步，2 次；步數相同，但有連續脈絡與清楚範圍 |
| 證據學生 Bea → 每日評語 | 班級 → 每日評語 → 重選 Bea，3 次 | 記錄每日評語，1 次，沿用 Bea |
| 證據學生 Bea → 考試個別報告 | 考試分析 → 重選 Bea → 尋找報告控制項 | 考試個別報告，1 次並聚焦原報告控制項 |
| 每日評語再填同樣學習證據 | 原本已自動生成，手動再填會造成不同手動紀錄 | 顯示自動連結提示，不要求第二次輸入 |
| 確認已持久保存 | 原本表單 toast／已保存容易與 backend ACK 混淆 | 表單本機完成提示 → 確認雲端保存，明確等待既有同步完成 |
| 換學生／班級後回來繼續未存輸入 | 證據可能沿用他人文字、日評／考試可能清空 | 以安全身分範圍恢復自己的記憶體草稿 |

不是每個任務都減少點擊；保存確認是增加一個可選、可驗證的操作。PDF 仍使用系統列印的「另存為 PDF」，CSV 仍保留原格式、安全 escaping 與歷史／項目範圍。

## 測試與驗收

| 檢查 | 命令／實際範圍 | 結果 |
| --- | --- | --- |
| TypeScript | `npm run lint` | 最終版本 exit 0 |
| Dashboard／流程／草稿權限 model | `npm run test:dashboard` | 46 pass／0 fail／0 skip，含新流程、身分碰撞、授權重驗／降權／TTL／明確丟棄等測試 |
| 完整本機驗證 | `npm run verify` | exit 0；744 Node tests＋94 legacy rule checks＝838 pass，0 fail／0 skip；migration policy、TypeScript、build、Worker dry-run 均成功，包含 Node／本機 D1 安全與隱私測試 |
| 新 Learning 流程 | `EPET_CI_KIND=e2e`、`EPET_CI_SPEC=tests/e2e/learning-workflow.spec.ts`、`node scripts/release-ci.mjs browser` | 10 pass／0 fail／0 skip |
| 既有相關 E2E | 下列八份既有 specs，各以 release runner 與獨立 server 執行 | 51 pass／0 fail／0 skip |
| 全部既有 a11y | 下列五份 specs，各以 release runner 執行 | 21 pass／0 fail／0 skip |
| D1 容量／同步恢復 | `EPET_CI_KIND=capacity`、`EPET_CI_SPEC=tests/e2e-capacity/capacity-recovery.spec.ts`、同一 release runner | 9 pass／0 fail／0 skip；真實本機 D1 413、400、429、重試及限班隔離 |

末次「缺少已驗證授權即撤銷 lease」補強後，另重跑 Dashboard 46 項、最終 TypeScript、Learning 10 項與容量 9 項，全部通過；verify 的最末 build／Worker dry-run 也包含該補強。計數依每份 spec 的最終結果去重；本輪選定 E2E 共 61 項，加全部 a11y 21 項及 capacity 9 項，沒有宣稱跑過所有既有 E2E。

PowerShell 重現新流程測試：

```powershell
$env:EPET_CI_KIND = 'e2e'
$env:EPET_CI_SPEC = 'tests/e2e/learning-workflow.spec.ts'
node scripts/release-ci.mjs browser
```

新 E2E 驗證：同一學生連續進度／報告、整班 CSV、個別 PDF HTML 與 escaping、每日評語 revision 歷史／有效來源、同 ID 跨班草稿、延遲真實 PUT ACK、真實斷線卸載後恢復、dirty 考試換歷史／新增／切班、限班 teacher／viewer、375／768／1280px 鍵盤／局部捲動、同權限重新驗證與同一分頁跨帳號隔離。

既有 E2E specs：`exam`、`teacher-console-navigation`、`class-and-teacher`、`permissions`、`data-safety`、`product-analytics`、`draft-recovery`、`conflict-recovery`，均在 `tests/e2e/` 且檔名為 `.spec.ts`。原有資料、安全與遊戲斷言保留；`exam.spec.ts` 僅將保存狀態文案更新為「已加入工作區」，原 PUT 200 與成績斷言未變。

a11y specs：`tests/accessibility/{class-lifecycle,dialogs,keyboard,pages,privacy}.spec.ts`。既有 axe gate 檢查 critical／serious；低影響、`incomplete`、人工對比與螢幕閱讀器不能由自動通過代替驗收。

迭代初輪曾因巢狀 select／textarea 的 exact label 定位，以及「更新評語只留一筆歷史」的錯誤預期而失敗。定位改用精確 accessible role／name；歷史測試改為同時要求 revision 1 不變、revision 2 新增、sourceId 不變且有效來源只有一份。沒有刪除測試、降低安全門檻，或修改領域計算去符合錯誤預期。重跑與針對性檢查可能重複相同案例，不能加總為獨立測試數。

本機截圖：`output/learning-flow/after-{375,768,1280}.png`；已檢視手機／平板，未觀察到整頁溢出。考試比較表保留局部橫向捲動；保留原工具分頁，沒有宣稱整體手機捲動高度減少。測試紀錄與逐 spec 結果在 `output/learning-flow/`，不包含正式資料，未上傳。

驗證限制：PDF 測試確認原報告 HTML、A4 設定、escaping 與選取範圍，沒有操作 OS 列印對話框或驗證最後輸出的 PDF 檔；Firefox／WebKit、實機與完整螢幕閱讀器驗收仍需後續處理。未提交表單的跨完整重整保存不在此版範圍，介面已有提醒。

## 修改檔案與發布影響

| 檔案 | 用途 |
| --- | --- |
| `src/components/DashboardView.tsx` | 三步流程、共用學生選擇、原 destination 協調與報告聚焦請求 |
| `src/features/learning/components/LearningWorkflow.tsx` | 中英流程 UI、報告範圍說明、真正完成後的雲端確認 |
| `src/features/learning/components/LearningEvidenceForm.tsx` | 身分綁定草稿、真實 local acceptance 後才清欄位、完成／拒絕提示 |
| `src/features/learning/hooks/useScopedLearningDraft.ts`、`model/learningDraftMemory.ts` | 經驗證 scope、generation、期限及編輯器 namespace 的記憶體恢復；拒絕未驗證／過期／舊事件 |
| `src/features/learning/model/learningWorkflow.ts` | 流程映射與 class＋student 選擇驗證 |
| `src/features/analytics/components/StudentAnalyticsPanel.tsx` | 接共用學生與原考試報告請求、重用 competency labels |
| `src/features/exams/components/ExamAssessmentPanel.tsx` | 原評量草稿與報告控制項整合、dirty 確認、局部捲動及本機保存提示 |
| `src/features/records/components/DashboardRecordsPanel.tsx`、`DashboardRecordsSection.tsx` | 共用學生、按身分保留日評、pristine 更新／dirty 保留、本機寫入結果驗證 |
| `src/hooks/useBackendSync.ts`、`src/App.tsx` | 將已驗證授權與當次 generation 成對交付 UI；過期 scope 不可恢復表單 |
| `src/store/useStore.ts` | 僅增加非持久化的 reset reason，讓明確採用遠端版本同時丟棄舊表單；不改 AppData 或評量 action |
| `tests/teacherConsole.test.ts`、`tests/e2e/learning-workflow.spec.ts`、`tests/e2e/exam.spec.ts` | 新流程／安全恢復 unit 與 E2E，以及相符的保存文案斷言 |
| `docs/learning-workflow.md` | 本規劃、資料契約、操作比較與驗證證據 |

不需要 schema migration、新 Secrets、Cloudflare 或 GitHub 設定。原有 CI discovery 會自動發現新 E2E spec。本輪尚未 push、建立 PR、合併或部署；本機通過不代表遠端 CI 或正式發布已驗收。

測試使用 localhost 合成資料；不使用或複製正式學生資料，不部署 Production、不更動正式 Secrets 或 D1。已知正式環境的驗證信 health 契約問題不屬於本次 Learning 修改，也未透過降低 smoke 條件處理。
