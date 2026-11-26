# 遊戲化功能與介面精簡

> 發布範圍註記（2026-11-17）：本文件的「未 push／未部署」描述原任務驗收當時狀態。使用者後續另行授權推送 GitHub main；推送與自動部署結果以 GitHub commit／Actions 記錄為準。本機驗收不等同正式部署驗證。

設計日期：2026-11-15。此文件區分「入口顯示政策」與既有遊戲規則；功能隱藏不會刪除資料、暫停時間流逝或重算遊戲結果。

## 2026-11-19 單一寵物活動入口

本次介面改為在上方「寵物活動 / Pet activities」集中提供互動名冊，取代原本上方「展示大廳」的預設入口。教師控制台的「寵物／對戰」保留規則說明與「開啟寵物活動」按鈕；「魔王管理」保留召喚、撤退與設定，透過同一按鈕進入參與活動，不再重複呈現互動寵物卡。排行榜保留個人／隊伍表格，不回退成互動寵物列表。

| 入口 | 目前責任 |
| --- | --- |
| 上方「寵物活動」 | 唯一互動寵物列表；沿用既有餵食、升級、孵化、個人／隊伍對戰及魔王參與動作，各自遵守功能旗標與資格 |
| 控制台「活動 → 寵物／對戰」 | 精簡說明與共用活動入口，不放第二份寵物卡 |
| 控制台「活動 → 魔王管理」 | 保留管理表單及活動入口；攻擊與參與集中在活動列表 |
| 控制台「活動 → 排行榜」 | 既有個人／隊伍排行及隱私政策；空名冊或隱藏個人排行時也不顯示互動寵物卡 |
| 活動頁「唯讀投影」／`#/presentation` | 保留既有隔離的展示模式與遮罩 allowlist DTO；不是互動活動頁 |

活動頁必須先取得目前帳號、工作區、角色與班級範圍的已驗證授權，確認當前班級在範圍內，且工作區已載入可安全操作的版本。只有可寫入角色能開啟；viewer 沿用原有唯讀控制台，不取得活動控制。個人隱藏偏好與工作區功能旗標仍共同生效，旗標不是後端權限的替代品。授權 generation、班級或功能政策改變時，活動組件會重新建立；離開頁面會卸載活動對話框。

同一列表每頁最多掛載 **24 張**寵物卡，支援班內搜尋與前後分頁。這只限制 DOM 掛載數，不截斷名冊、不修改保存資料；對戰／組隊仍使用完整且已授權的目前班級名冊。搜尋與分頁只在此頁的記憶體中存在。分頁後焦點移到列表標題，操作與結果數量提供可讀名稱及狀態文字。

返回控制台時保留原先分頁與尚未提交的編輯草稿；控制台在活動頁期間隱藏並停用其可見流程，不以重新掛載整個控制台換取精簡。Autosave、Revision Conflict、登入／工作區切換與草稿權限驗證仍由既有同步機制負責，不由活動頁另開寫入路徑。

這段是目前程式與驗收契約，**不是新一輪測試已全部完成的宣告**。效能基準、後測、E2E／無障礙結果與尚待人工驗證項目統一記錄於 [前端體驗稽核](frontend-experience-audit.md)；下方 2026-11-15 的通過數僅為歷史紀錄。

## 盤點與功能去留矩陣

A＝必須保留；B＝可合併入口；C＝可預設隱藏；D＝有條件可淘汰。分類可同時適用於不同層次。本次沒有任何遊戲能力或資料進入淘汰階段。

| 功能 | 分類 | 介面處理 | 必須保留的行為與來源 |
| --- | --- | --- | --- |
| 寵物養成 | A、B | 作為單一寵物入口，整合既有照護動作；教學模式可隱藏 | 寵物種類、等級、徽章、既有狀態完整保留；`src/features/pets/model/petCardModel.ts`、`src/components/PetCard.tsx` |
| 餵食與升級 | A、B | 保留於寵物卡，不在首頁建立另一套控制；精簡模式仍可使用 | 餵食、玩耍、升級資格與支出不變；`src/domain/game/feedingRules.ts`、`upgradeRules.ts` |
| 扭蛋 | A、B、C | 與寵物入口一起顯示或隱藏，不拆出重複活動入口 | 蛋的首次孵化、200 積分成本及已取得的升級獎勵資格保留；升級換寵會改變等級及狀態，不能在套用介面方案時自動觸發；`src/store/useStore.ts` 的 `gachaPet`、`rerollPetFromUpgrade` |
| 個人對戰 | A、B、C | 與隊伍對戰共用單一寵物活動列表；控制台保留入口，新工作區預設隱藏 | 勝敗、消耗、資格、對戰模式和歷史不變；`src/domain/game/battleRules.ts` |
| 隊伍對戰 | A、B、C | 與個人對戰共用開關；相關組隊按鈕一起隱藏 | 隊伍 ID、成員、既有對戰統計不移除；`src/features/classroom/model/classroomModels.ts`、`src/store/useStore.ts` 的 `setTeammate` |
| 魔王副本 | A、B、C | 新工作區預設隱藏；控制台保留管理，參與與攻擊集中在單一寵物活動列表；獎勵設定沿用現有組件 | 現役魔王、貢獻、恢復、已設定獎勵與發獎紀錄保留，不因隱藏而撤退；`src/features/boss/components/BossManagementSection.tsx`、`src/domain/game/bossRules.ts`、`rewardRules.ts` |
| 排行榜 | A、B、C | 個人與隊伍排行集中；新工作區預設隱藏入口 | 公開姓名、包容模式和公開排行限制仍優先，不能由介面開關放寬；`ClassroomLeaderboard.tsx`、`ClassroomTeamLeaderboard.tsx`、`src/features/classroom/model/classroomPresentation.ts` |
| 遊戲經濟與獎勵設定 | A、B、C | 管理員以方案和功能選擇開始；詳細成本、消耗、賽季、獎勵參數放進可展開的進階設定 | 積分餘額、經濟事件、獎勵語意及既有數值不重算；`src/features/settings/components/GameRuleSettings.tsx`、`src/domain/game/economyRules.ts` |
| 懲罰與寵物狀態 | A、C、D（僅未來重複入口） | 保留現有友善模式；高複雜度參數收進進階設定。未來只有經使用證據確認的重複操作入口可淘汰 | 警告、處分紀錄、反向操作、休息／死亡語意完整保留；`src/domain/game/penaltyRules.ts`、`petRules.ts`。本次不移除任何懲罰能力 |

## Feature Toggle 契約

第一階段先建立純函式政策模型與回歸測試，再由第二階段的介面使用同一個解析結果。

- 工作區設定 `gameFeatures` 為可選的完整物件：`pets`、`battles`、`bosses`、`leaderboards`，每一項都是布林值。持久化時必須完整且通過輸入驗證，不接受部分物件或未知欄位。
- 未含此欄位的歷史工作區、舊備份和匯入資料，保留原有功能可見性（四項皆可見）；原本的 `battleEnabled`、`battleMode`、公開排行榜及其他規則仍各自生效。
- 只有新建立的工作區使用低複雜度入口預設：寵物顯示，對戰、魔王、排行榜隱藏。不能根據「學生人數為零」推斷舊工作區為新客戶。
- 「簡約養成（建議）」方案為寵物顯示，其餘隱藏；「完整活動」顯示全部；「專注教學」隱藏全部。管理員仍可逐項調整。方案只影響入口，不調整遊戲規則。
- `pets=false` 時隱藏控制台寵物分頁、照顧、每日領取與升級操作；若個別開啟對戰或魔王，共用活動列表仍呈現參與所需的寵物卡。上方入口只要有任一遊戲功能開啟且個人未隱藏時即可顯示，不把寵物開關當作其他獨立功能的前置條件。蛋的初次孵化保留為活動前置操作，成本與資格不變，不自動孵化或補充寵物。只有排行榜開啟時不顯示可寫入的寵物操作。
- `battles=false` 同時隱藏對戰頁、遊戲分組與卡片組隊／對戰按鈕及相關停用提示。`bosses=false` 隱藏魔王管理、卡片攻擊與遊戲獎勵捷徑；歷史仍在班級紀錄中。`leaderboards=false` 隱藏教師控制台的個人與隊伍排行入口，不改班級展示政策。
- 開關不變更 `battleEnabled`、`inclusiveMode`、`petCareMode`、公開姓名與排行榜模式、任何經濟數值、時間戳記、等級、隊伍、勝敗、魔王進度或歷史紀錄。
- 現有個人 `TeacherSetupState.gameMode` 保留為個人介面偏好。個人偏好可以進一步隱藏入口，不能重新顯示工作區政策隱藏的入口。
- 設定入口只提供管理員使用；後端既有工作區設定寫入權限仍是權威，教師提交的設定變更必須遭拒。功能顯示政策不是後端遊戲操作禁令，也不是授權邊界。

### 相容性與資料隔離

`gameFeatures` 是 Snapshot 中的可選設定，不需要 SQL schema migration；必須保留 Node JSON、D1、備份／匯入的通用驗證和正規化路徑。對缺少此欄位的舊資料，不得在讀取時改成新客戶方案。

目前預設已含包容模式、休息而非死亡、假日暫停衰減、遮罩姓名、隱藏公開個人排行榜，以及可恢復魔王攻擊。沿用這些友善規則，不另外建立一套數值預設或擅自改寫既有工作區。

教學加減分、正式學習證據、考試、回饋、學生／班級分析不受遊戲入口開關影響。寵物等級與 RP 仍只代表遊戲進度，不推論正式學習能力。

### 班級展示模式

既有班級展示能力保留於活動頁的「唯讀投影」與明確的 `#/presentation` 路徑。原上方入口改為私有互動活動頁；兩者的生命週期分開，不能因切到寵物列表便自動啟用投影旗標。展示仍沿用 `buildClassroomPresentation` 的 allowlist DTO，只有經遮罩的顯示名稱、可信任寵物類型、等級、受政策限制的 RP 與魔王 HP；沒有互動寫入 callback。重新載入、返回與登入失效的既有投影保護仍保留，不會擴大展示資料或放寬公開隱私設定。

## 分階段介面調整

1. 政策模型、舊資料兼容、新資料預設及範圍驗證先完成測試；不碰遊戲公式。
2. 管理員設定提供可理解的方案與四個入口選擇；沿用既有保存流程；高複雜度數值收進鍵盤可操作的進階設定。
3. 教師導覽、寵物卡、對戰／組隊、魔王與個人／隊伍排行使用同一份政策，選中入口關閉後導向仍可用的位置，避免殘留可寫入的對話框。
4. 驗證小螢幕、鍵盤、保存／重載及權限變更。後續才以匿名使用證據評估重複入口是否能淘汰；本次不淘汰功能。

## 教師操作比較

| 任務 | 原先 | 調整後目標 |
| --- | --- | --- |
| 新工作區活動導覽 | 5 個活動分頁：寵物、魔王、對戰、遊戲獎勵、排行榜 | 1 個寵物分頁；教學入口照常，管理員可恢復全部活動 |
| 管理員選擇遊戲複雜度 | 搜尋多組數值及規則，逐項理解 | 選一個介面方案或逐項開關，再保存 |
| 管理員調整對戰消耗 | 直接面對所有參數 | 展開進階設定後使用原欄位 |
| 查看魔王並選學生攻擊 | 寵物、對戰、魔王頁各自顯示寵物卡 | 上方寵物活動：1 次；從魔王管理按「開啟寵物活動」也到同一列表，不新增另一套攻擊規則 |
| 停用與恢復活動入口 | 分散在個人偏好、對戰與公開排行規則 | 由管理員政策統一控制入口；重新顯示即沿用原進度與歷史 |

活動入口使用獨立的「儲存活動入口」按鈕，只提交四個入口欄位；不連帶保存其他頁的規則或經濟草稿。介面明確區分已加入本機工作區與上方雲端同步狀態。魔王攻擊集中於共用寵物活動列表，魔王管理頁不再複製卡片。切換離開活動頁或政策變更會卸載互動對話框，重新開啟不會復活舊的對戰選擇。

## 修改範圍

| 檔案 | 用途 |
| --- | --- |
| `shared/gameFeatures.ts`、`src/store/types.ts` | 型別、嚴格解析與不可變方案定義 |
| `src/store/utils.ts`、`shared/validation/workspaceValidation.ts` | 新工作區預設、舊 Snapshot 缺省相容、匯入／還原／API 一致驗證 |
| `src/store/useStore.ts` | 在原有設定寫入中複製政策物件，避免共用可變參照；保留前一任務的 session metadata 修改 |
| `src/features/settings/components/GameFeatureSettings.tsx`、`DashboardSettingsSection.tsx` | 管理員入口選擇、獨立保存、原數值表單的原生進階展開 |
| `src/features/teacher-console/model/navigation.ts`、`TeacherTodayDashboard.tsx`、`TeacherSetupGuide.tsx` | 導覽與首頁捷徑遵守工作區政策，個人偏好說明 |
| `src/App.tsx`、`src/components/DashboardView.tsx`、`ClassroomView.tsx`、`src/features/teacher-console/components/TeacherClassContext.tsx` | 私有共用活動入口、保留控制台草稿、已驗證班級選擇、獨立投影路徑與活動對話框生命週期 |
| `src/features/classroom/components/ClassroomStudentGrid.tsx` | 24 張卡片分頁、班內搜尋與列表焦點／結果提示；完整名冊仍供原有活動規則使用 |
| `src/components/PetCard.tsx`、`src/features/pets/hooks/usePetCardStore.ts`、`model/petCardModel.ts`、`components/PetActions.tsx`、`PetActionWarnings.tsx` | 傳遞入口政策、隱藏非必要操作及相關提示；不改資格／成本計算 |
| `tests/gameFeatures.test.ts`、`tests/gameFeaturePersistence.test.ts`、`tests/e2e/game-features.spec.ts`、`package.json` | 政策、API、Node／D1 持久化與瀏覽器回歸，納入既有 verify |
| `tests/e2e/teacher-console-navigation.spec.ts`、`dashboard-refactor.spec.ts`、`class-lifecycle.spec.ts`、`tests/e2e-capacity/capacity-recovery.spec.ts`、`tests/accessibility/fixtures.ts` | 既有完整活動案例明確設定全功能；數值案例先展開進階設定，保留原斷言 |

工作目錄原有的 Learning 流程修改及其他未提交文件保留，並非本次新增遊戲行為。沒有修改遊戲公式、Server／Worker 權限實作、D1 SQL migrations、正式學習分析與報告計算。

## 啟用、回復與後續工作

1. 本機驗收後以 PR 審查程式與文件；本次不自行 push、merge 或部署。
2. 既有工作區不需 migration 或設定搬移，也不會自動套用新方案。管理員到「管理設定 → 規則 → 遊戲化活動入口」選擇方案或單項調整，再按「儲存活動入口」。
3. 要恢復入口，重新勾選或選「完整活動」後保存；原玩家進度與歷史直接沿用。個人偏好若隱藏，需在首頁重新顯示個人介面。
4. 規則與經濟沿用原有設定預設及進階欄位。入口開啟不會越過 `battleEnabled`、既有資格或公開隱私限制。所有入口隱藏不會停止時間衰減或其他既有機制；如需真正暫停規則，須另行設計資料及事件語意。
5. 不需要新 Secrets、Cloudflare 資源或 D1 schema 變更。若日後回復到尚不認識 `gameFeatures` 的舊版程式，舊 Normalizer 可能忽略新入口政策；部署回復計畫需先保留設定備份，不能假設舊版會強制維持新入口限制。
6. 使用合成班級進行真機觸控、螢幕閱讀器及教師試用。後續依匿名使用證據評估重複入口；任何實際淘汰須先完成相容與資料保存評估。本次沒有淘汰功能或更動歷史資料保存政策。

## 2026-11-15 歷史驗收紀錄

驗收日期：2026-11-15。狀態：**Completed（本機程式、自動化驗收及畫面檢視）**。這不是正式環境上線或完整 WCAG 符合性宣告。基底 commit：`422ca70cf9206e6b7880d30f700c3e2811ecd149`。

- [x] 新工作區簡約預設；舊資料缺少政策仍維持原有入口，匯入及歷史 Restore 不注入新客戶預設。
- [x] 完整契約、錯誤型別、部分物件和未知欄位拒絕；16 種旗標組合保持遊戲、教學與展示資料不變。
- [x] 教師偽造政策寫入遭 403 拒絕且無部分寫入；合法授權班級操作可保存，跨班／跨工作區與 CSRF 保護維持。
- [x] Node JSON／本機合成 Miniflare D1 的 Snapshot、Normalized Projection、重新載入、匯入、受控 Revision Restore 及歷史資料保留驗證。
- [x] 個人偏好不能重新開啟管理員隱藏的入口；目前活動被關閉時退回首頁且關閉對話框，重新開啟不復活舊對戰選擇。
- [x] 隱藏遊戲入口時班級展示仍維持原有遮罩／allowlist DTO，沒有私密學習內容或互動寫入按鈕。
- [x] 375px 手機、768px 平板實際瀏覽器截圖檢視；無整頁橫向溢位，新設定操作區至少 44px；鍵盤可展開／收合進階設定。
- [x] `npm run verify`、相關 E2E、既有無障礙及容量恢復測試通過。
- [ ] 真機觸控、螢幕閱讀器與教師試用，依啟用清單進行人工驗收。

### 實際命令與結果

| 命令／範圍 | 通過 | 失敗 | 說明 |
| --- | ---: | ---: | --- |
| `npx tsx --test tests/gameFeatures.test.ts` | 9 | 0 | 最終政策／導覽測試，包含 16 種組合、權限及相容性 |
| `npx tsx --test tests/gameFeaturePersistence.test.ts` | 8 | 0 | Node 4、合成 D1 4；已納入 verify，不重複計入總數 |
| `npm run verify` | 855 | 0 | 761 項 Node 測試＋94 項既有規則檢查；0 skipped；8 個 migration checksum 驗證、typecheck、build、分析隔離檢查及 Worker dry-run 成功 |
| `npm run lint`（最終來源） | exit 0 | 0 | 最後介面生命週期修改後重新檢查 |
| `EPET_CI_KIND=e2e EPET_CI_SPEC=<spec> node scripts/release-ci.mjs browser`（逐檔） | 48 | 0 | 7 個 spec；見下表。此為環境變數表示法，在 PowerShell 以 `$env:EPET_CI_KIND`／`$env:EPET_CI_SPEC` 設定 |
| 同上，`EPET_CI_KIND=a11y` | 21 | 0 | pages 9、dialogs 4、keyboard 2、class-lifecycle 4、privacy 2 |
| 同上，`EPET_CI_KIND=capacity` | 9 | 0 | 真實本機 D1 413、409、網路恢復、草稿保存與班級範圍限制 |
| `git diff --check`、核心路徑差異檢查 | exit 0 | 0 | 遊戲公式、教育分析、展示 DTO、Server／Worker 與 SQL migrations 無修改 |

| E2E spec（`tests/e2e/`） | 通過 |
| --- | ---: |
| `game-features.spec.ts` | 8 |
| `teacher-console-navigation.spec.ts` | 15 |
| `dashboard-refactor.spec.ts` | 2 |
| `class-lifecycle.spec.ts` | 6 |
| `privacy-management.spec.ts` | 5 |
| `permissions.spec.ts` | 2 |
| `learning-workflow.spec.ts` | 10 |

無障礙測試沿用原有 axe 規則及 critical／serious gate，沒有降低條件或移除規則；較低影響及人工判讀項目留在 axe 報表，不代表完整 WCAG 驗證。瀏覽器套件依序執行，沒有放寬正式 rate limit 或權限條件。

迭代中曾發現簡約方案仍顯示遊戲獎勵捷徑，已修正政策映射；測試也修正了空名冊前置條件與既有「討伐 (-20)」的精確定位。原斷言保留，額外強化展示模式不得出現討伐按鈕的斷言，最終完整重跑 `game-features.spec.ts` 為 8/8 通過。最初受 sandbox loopback 限制造成的 D1 `EACCES`，以允許本機測試網路的執行環境重跑後 8/8 通過，沒有改用 mock 取代 D1。

本機證據保存在忽略追蹤的 `output/game-ux/`：`verify.log`、`verify-exit.txt`、`policy-final.log`、`persistence-final.log`、`acceptance-game-features.log`、`final-*.log`、`acceptance-summary.json`、`settings-375.png`、`settings-768.png`。summary 保留初次瀏覽器結果與最終重跑來源，不將中間失敗覆寫為通過。

本次不發布 Production、不更改正式會員／學生資料、不修改 Secrets，也不執行遠端 D1 操作。
