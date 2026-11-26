# ePet SaaS 工作區權益架構設計

日期：2026-11-25。狀態：**設計草案，尚未實作、尚未驗證市場或可販售容量**。

對象為台灣個人教師與小型補習班，產品維持教師主持的教學工作區。此文件只提出後續實作規格；沒有接入支付、取得金鑰、執行 SQL／migration、存取正式環境或使用真實學生個資。現有未提交的前端變更不屬於本文件工作範圍。

本次尚未取得可核實的客戶訪談、付費意願、續用及價格實驗證據，已核對樣本為 **0**；這不表示實際市場沒有客戶。下列價格、額度、試用與寬限期都是待訪談及合成容量測試驗證的假設，不能據此宣稱可立即銷售。

## 1. 決策與候選商業單位

以 **workspace** 作為方案、權益與付款訂閱的邊界。使用者可加入多個工作區，但 A 工作區的付款不授權 B 工作區；帳號的 active workspace／顯示角色也不能替代該工作區的 membership。

| 候選 | 月費假設 | Writer 席次假設 | 使用中學生 placements 假設 | 狀態 |
| --- | --- | --- | --- | --- |
| 免卡試用 | NT$0，14 天 | 1，含 owner | 30 | 不自動扣款；容量與轉換率未驗證 |
| 個人教師 | NT$299／workspace／月 | 1，含 owner | 30 | 訪談與容量證據皆未完成 |
| 小型教學團隊 | NT$899／workspace／月 | 3，含 owner | 100 | 等於 owner 加另外 2 位 writer；容量證據未完成 |

第一版不以遊戲入口分級，不增加學生／監護人登入，不自動升級、計超額費、做按比例計費或自動降級。試用到期不自動收費。付款處理商、發票／退款流程及費用均未選定或驗證。

本表的 NT$299／899 單位是 **TWD 元**。未來 catalog 與帳務 command 必須明確標註 amount unit；建議保存整數 `amountTwdYuan`，provider adapter 依其官方契約轉為所需單位，採精確整數轉換，不用浮點金額，也不能一律假設所有 provider 都要乘 100。只接受整數元的介接也不應收到「分」數字；金額／幣別／單位／planVersion 必須一起進 canonical hash、對帳與測試。

### 計數契約

- `writerSeatsUsed`：該 workspace 所有 `owner | admin | teacher` membership 數量；不因未登入、未指派班級、沒有操作或班級封存而減少。`viewer` 不計 writer 席次，但仍須另有技術防濫用邊界；無限 viewer 不是產品承諾。
- `activeStudentPlacementsUsed`：所有未封存班級的學生配置筆數，以 **`(workspaceId, classId, studentId)`** 為身分。A 班與 B 班各有 `studentId=s1` 時算 2 筆，不做跨班或全域去重，也不以姓名／email 比對自然人。
- 封存班級釋出使用中 placement 額度，資料仍在完整快照與歷史內，占儲存與處理成本。重新開班會重新消耗額度；匿名化保留學生配置，因此通常不減 placement。
- 發送邀請不預占席次。接受邀請時重新驗證期限、撤銷、使用者、角色、scope 與當時額度，並與 membership 建立一起原子提交。不能以發出時有空位作為接受保證。
- 兩個管理員同時邀請並接受最後一席，只能有一個成功；失敗方不能留下帳號建立、membership、class assignments、邀請已接受或成功 audit 等局部結果。
- 班級數目前只有輸入資源防護，不在上述方案增加另一個未驗證的商業班級額度。所有其他 technical limits 仍適用。
- Trial 起始／截止及 eligibility 由 server 的 enrollment／grant receipt 保存；重送註冊、切換工作區、換 owner 或重建本機資料不能重置已發出的 trial。多工作區可領取幾次 trial 的產品政策尚待驗證，正式自助入口前須另定防濫用規則，不承諾可無限開新工作區續試用。

## 2. 已實作現況與缺口：以程式為準

下列是本機來源的設計依據，不是正式環境驗收結果。路徑後的數字為本次檢視的行號。

| 領域 | 目前已實作 | 後續須新增的部分與來源 |
| --- | --- | --- |
| API 邊界 | Origin、session、CSRF、workspace membership，再進各功能 route | `server/api.ts:45,89,105,112,129–145`；目前 dispatch 沒有 subscription／billing／entitlement routes |
| RBAC／限班 | `owner > admin > teacher > viewer`；owner/admin 全工作區，teacher/viewer 明確班級 allowlist，空 scope 拒絕 | `server/auth.ts:55,731`、`server/middleware/authorization.ts:20–38`；權益不得替代這些授權 |
| Session | 回傳使用者、workspaces、activeWorkspaceId；依工作區取得 membership | `server/auth.ts:73–77,428–456,740–772`；目前沒有 entitlement view |
| State 同步 | GET 限班 snapshot；teacher PUT 驗 exact access 並合併授權班級；admin PUT 經班級生命週期保護與 revision CAS | `server/routes/workspaceRoutes.ts:117–147,161–180,206–245`；須在 server 合併後的完整候選資料上檢查權益與額度 |
| 匯入／還原 | admin 匯入確認取代、expectedRevision；revision restore 讀取來源前先綁定 current revision | `server/routes/workspaceRoutes.ts:80–112`、`server/routes/adminRoutes.ts:222–250`；兩者都是新增目前狀態，必須重新計 quota，不能繼承備份的方案 |
| 學習證據 | teacher role＋class scope，拒絕封存班級；成功後以 repository CAS 寫入 | `server/routes/learningRoutes.ts:27–39,50–71`；即使不是 `/state` 也要走同一權益閘門 |
| 班級／隱私 | admin 的 archive/reopen/delete；學生 export/delete/anonymize；workspace export；owner 才能刪 workspace | `server/routes/classRoutes.ts:12–24,49–54`、`server/routes/studentRoutes.ts:26–85`、`server/routes/adminRoutes.ts:282–317`、`server/auth.ts:1195–1227`；付費狀態不能封鎖合法資料治理 |
| Node 持久化 | mutation queue 中 clone、CAS、寫 temp file、atomic rename，成功後才公布記憶體 | `server/repository.ts:318–345,356–377`；新權益／usage／receipt 必須在同一 clone 與持久化邊界內 |
| D1 持久化 | snapshot revision CAS、projection write token、同批 projection／history purge／audit | `worker/repository.ts:763–787,849–953`；quota 不能只在交易外先讀一次 |
| 複合身分 | students 主鍵為 `(workspace_id,class_id,student_id)`；隱私差集也以班級＋學生 tuple 處理 | `migrations/0003_core_entities.sql:30–46`、`shared/domain/studentPrivacy.ts:15,23`；方案計數沿用此邊界 |
| UI 活動設定 | `GameFeatures` 控制 pets/battles/bosses/leaderboards 的 workspace UI availability，隱藏不清進度 | `shared/gameFeatures.ts:1–8`；不是訂閱權益或安全邊界 |
| Billing 缺口 | 現有 `migrations/0001`–`0008` 建立工作區、auth/RBAC、projections、scope、邀請、驗證與 onboarding | 未見計費帳戶、訂閱、付款事件、方案版本、權益、usage 原子閘門；`0008_product_onboarding.sql:3–9` 是 onboarding，不能當 trial ledger |

目前 409 通用 serializer 只回 revision／updatedAt，不回未限縮的 repository snapshot；413 只回公開 limit metadata（`server/middleware/errorResponse.ts:35–55`）。新 402、quota conflict 與 billing 錯誤必須維持同樣的資料最小化。

## 3. 權益與授權的分層

每項操作的最終許可為：**有效 session ∩ workspace RBAC ∩ class scope ∩ server entitlement ∩ domain／revision／容量條件**。順序先確認身分、角色及可見範圍，再作對應資料查詢／回應。付費不能讓 viewer 寫入，升級不能讓 teacher 讀其他班級，帳務 payer 身分不能讀教學資料。

建議新增純 server service `WorkspaceEntitlementService`，負責把 immutable plan version、有效期間、人工 grant、付款狀態及 committed usage 解析成有效權益。routes 取得可顯示 view；**repository 的 commit 仍須原子重驗**，避免 service 的 read-then-write race。所有 production writer、CLI／後台 provisioning／repair、邀請接受、角色變更、workspace creation、state、learning、boss、import、restore、archive/reopen 都須列入 writer inventory，不能只有 UI 或 `/state` 檢查。

不把權益寫進 `AppData.settings`、class snapshot、exported backup、`GameFeatures` 或 client localStorage 作為來源。備份可附「匯出時方案描述」供人閱讀，但匯入一律忽略，不可賦權。前端的 disabled button 是提示；server 始終重新判斷。

### 版本的不同意義

| 名稱 | 改變時機 | 不應造成的副作用 |
| --- | --- | --- |
| `planKey + planVersion` | 發布新的不可變商業規格；例如未來改價／改限額建立新版本 | 不覆寫已購版本，不自動把舊 workspace 套新價 |
| `entitlementRevision` | 此 workspace 的有效 grant、期間、override、狀態／binding 變動 | 不偽造教學資料 revision 或觸發學習衝突快照 |
| `usageRevision` | 席次或完整狀態的 quota source 提交，供併發閘門使用 | 不讓 member mutation 因 snapshot revision 不變而繞過 quota |
| `workspace.revision` | 既有教學快照成功提交 | 付款 webhook 不得透過 state PUT 變更它 |

Plan catalog 可先用 server 的版本化、唯讀設定＋hash 管理，無須為了本草案先建 plan table。實作時不允許修改舊版本內容；receipt／grant 保存引用與限額快照以便稽核。價格顯示的 catalog version、entitlement revision 與 snapshot revision 必須分開命名。

## 4. 狀態、到期與拒絕政策

以下是 MVP 設計候選，尚無實作或客戶驗證。`effectiveMode` 由 server 當下時間及 committed state 推導，不能只相信排程或 client clock。

| 狀態／情境 | 一般教學寫入 | 增加席次／placement | 合法讀取、匯出與受控清理 |
| --- | --- | --- | --- |
| trialing，尚未達 trialEndsAt | 允許 | 在額度內允許 | 依既有 RBAC／scope |
| active，`used < cap` | 允許 | 在額度內允許 | 依既有 RBAC／scope |
| **quota_reached，`used == cap`** | **允許**；記錄成績、評量、點數等有效教學仍可用 | 只拒絕會超額的候選操作 | 依既有 RBAC／scope |
| 候選寫入的 `proposedUsed > cap` | 這次操作回 402，整批不提交 | 拒絕，不自動升級 | **不能把 committed workspace 標為 over_limit**；其他合法教學仍可用 |
| committed usage 已大於有效 grant（`over_limit`） | read_only | 拒絕 | 保留以下受控清理；降回額度內且期間有效才恢復 |
| past_due 且在明確 graceUntil 之前 | 候選維持最後有效的有界 grant | 只在該 grant 內允許 | 依既有 RBAC／scope |
| graceUntil 已到、trial 到期、已到期的取消、無有效 grant | read_only，回 402 | 拒絕 | 保留以下受控清理 |
| 權益服務／enrolled tenant 的資料讀取失敗 | 不猜測免費／付費，回 503；現有有界 transient retry 適用 | 拒絕 | 原授權讀取／export／privacy 路徑保持可用，不能要求先付款修復 |

Past-due **7 天**僅為待驗證寬限假設，須以 server 保存的 `graceUntil` 截止；不能每次重試重新延長。試用及 cancel-at-period-end 到指定期限立即唯讀；若要延長必須有獨立、可稽核、明確起訖的人工 grant，不從 webhook 延遲推論無限寬限。

MVP 的 downgrade 只能在 current usage 已符合目標方案時套用，或排定到期後先重新驗 usage 再套用；不在背景自動刪學生／降角色來符合方案。不符合就拒絕或留待 owner 明確處理，不自動向較高方案扣款。Owner 的取消續約入口即使到期、超額或付款失敗也可操作；取消失敗須顯示可追蹤的狀態，不能顯示已取消而繼續自動續約。

### 唯讀期間的受控例外

- 保留原本可讀範圍、admin/owner 已有的 workspace／student export、隱私刪除、匿名化、owner workspace/account 刪除與安全退出。**「不因付費阻擋」不等於新增 teacher 權限**：目前 student privacy API 仍為 admin，限班教師不能因此取得完整工作區 export。
- 明確的班級 archive、學生／班級 delete、成員 remove 或 writer→viewer 的降權可作為 quota cleanup，仍須既有角色限制、確認、last-active-class 規則、scope、CAS、retained-history purge 與 audit。
- 同席次或減少席次的 owner transfer 可用；既有轉移會把原 owner 降為 admin。若 target 原為 viewer，writer 數會增加 1，仍須 quota 檢查，不能假設所有轉移淨額都是 0。若要支援「轉移並離開」，另設顯式原子命令與確認，不暗改既有操作語意。
- **任意 `PUT /state` 絕不被當作 cleanup**。即使學生數或 bytes 下降，payload 仍可改寫評量、點數、設定或其他內容；只憑 count delta 不構成清理授權。readonly 下匯入、restore、reopen、一般 learning/boss/game 寫入都拒絕。
- 清理例外由 server 的 typed operation／既有特定 route 指定並推導結果，不接受 client 自報 `cleanup=true`。匿名化可能不降低計數仍可用；未增加 quota 不表示可以任意改寫。
- 900 KiB 等儲存防護不因付費狀態放寬。若既有資料狀態使合法清理無法提交，須走另行審查的受控修復，不提供一般 PUT bypass。

## 5. 最小資料模型提案：只有規格，沒有 SQL 檔案

先完成 manual grant／synthetic pilot，再決定是否實作支付。下列為未來資料表與 adapter 設計，**本次不建立任何 migration，也不執行 SQL**。

| 提議資料表 | 最小欄位與約束 | 用途與界線 |
| --- | --- | --- |
| `workspace_entitlements` | PK `workspace_id`；plan_key/version、immutable limits snapshot/hash、state、trial/period/grace 起訖、cancel_at_period_end、grant_source、enrollment_mode、entitlement_revision、usage_revision、writer_seats_used、active_placements_used、usage_snapshot_revision、updated_at、最後成功操作 token | 一 workspace 一份權威 grant＋quota gate；非負整數／日期序與 enum 約束；FK workspace。counts 只能由同交易 domain writer 更新，不能由瀏覽器寫入 |
| `saas_operation_receipts` | 複合 PK `(workspace_id, operation_id)`；operation_kind、actor、canonical request hash、base／result snapshot revision、entitlement revision、結果代碼、created_at | 配額相關 domain／人工 grant／billing command 的 idempotency；同 key 不同 payload 拒絕。不能把 caller request ID 直接當全域 audit PK；保留期限尚待運維定義 |
| `billing_accounts` | PK billing_account_id；可解除連結的 payer principal、provider、provider_environment、opaque customer_ref、consent/version/time、status | payer 與 workspace owner 分離；`UNIQUE(provider,environment,customer_ref)`。不存卡號／安全碼，不把 customer_ref 當授權憑證 |
| `workspace_billing_links` | PK workspace_id；billing_account_id、provider/environment、subscription_ref、binding_revision、payer_consent、owner_acknowledgement、current_provider_state_version／reconcile watermark、updated_at | `UNIQUE(provider,environment,subscription_ref)`（有值時），FK workspace／billing account；一 workspace 一個目前 subscription binding，sandbox/live 不能混用；付款人可有多 workspace，不能讓其中 owner 看到整個 payer account |
| `billing_event_inbox` | 複合 PK `(provider,environment,event_key)`；allowlisted event type、object ref、canonical payload hash、received_at、processing state、attempts、reconcile generation、applied entitlement revision、last safe error code | event_key 優先用原生事件 ID；無 ID 時由 adapter 的現行契約定義穩定鍵，不能只用 body hash。重複事件最多套用一次；收到、驗簽、持久保存不等於已發權益。記錄最小化 normalized metadata，不保存學生資料或任意 raw payload 到 logs |
| `billing_financial_facts` | 複合 PK `(provider,environment,fact_type,external_fact_id)`；最小 payment／invoice reference、整數 amount＋currency＋明確 unit、發生時間、可解除的 account/workspace link、retention purpose/policy version | 支付後必要的不可變事實 ledger；更正／退款以新事實關聯原事實，不覆寫已開憑證；不以 workspace/user FK cascade 刪除，保存期限經獨立 signoff |

Manual-only pilot 可先不建立最後四張付款相關表；具備支付來源後才需要。現有 membership、classes/students projection、workspace revisions 仍是其 domain 來源，不再新增一份「按自然人去重的學生計費表」。Usage counters 是有來源 revision 的交易物化狀態，不能只靠 nightly count 修正超賣。

新表的 unique/check/FK 也須相容性審查，不能因為「是新表」就宣稱 migration 安全。禁止在舊 membership／student 表直接加未盤點的 unique index，禁止改寫 checksum 鎖定的歷史 migrations。帳務資料刪除／憑證保存的法務與營運期限尚待確認，不能與學生資料保留或 workspace owner 權限混在一起。

有支付後，`billing_financial_facts` 的必要欄位由未來 provider／發票 adapter 再細化，不能只有可覆寫的 current subscription status。**Workspace／user／billing account 刪除不得以 FK `ON DELETE CASCADE` 一併銷毀依法或已核定目的仍須保留的付款／發票事實**；以 nullable principal/workspace link、最少 opaque billing reference 與獨立 retention policy 解耦。反之，也不能以保存憑證為由保留學生 snapshot。保存目的、期限、存取權、匿名化／銷毀方式須經營運／隱私及必要法務 signoff，目前不虛構年限或宣稱已符合特定法規。

### Node／D1 共用介面提案

未來在 `server/contracts.ts` 增加獨立 repository capability，避免把可選的 analytics observer 用作權益判定：

```ts
// 設計示意，非本次已存在的 TypeScript API。
type EntitlementRead = { workspaceId: string; entitlementRevision: number; usageRevision: number };
type CommitAuthority = { actorUserId: string; operationId: string; expectedEntitlementRevision: number };
interface WorkspaceEntitlementRepository {
  readEntitlement(workspaceId: string): Promise<EntitlementRead>;
  commitWorkspaceWithEntitlement(command: ScopedWorkspaceCommand, authority: CommitAuthority): Promise<CommitReceipt>;
  commitMembershipWithEntitlement(command: MembershipCommand, authority: CommitAuthority): Promise<CommitReceipt>;
  applyGrant(command: VerifiedGrantCommand): Promise<CommitReceipt>;
}
```

`ScopedWorkspaceCommand` 是 server 已驗角色／scope 後形成的封閉操作集合；不能讓 browser 用任意 string 宣告 privileged cleanup。有效期間、plan、limits、counts、policy 皆由 repository/service 重讀。相同 interfaces 的 Node／D1 contract tests 要檢查完整 persisted state 與失敗無副作用。

## 6. 原子 quota 與併發提交協定

### 完整狀態寫入

1. 維持 session／Origin／CSRF／workspace role／class scope；驗 body 與 schema，再讀目前完整 snapshot。teacher payload 先按既有 `mergeTeacherWorkspaceData` 合併，只在 server 對完整候選狀態計 active placements。
2. 讀 grant 與 usage 來源版本；以 server 提交時間判斷期限，計算 proposed usage。避免從教師 partial snapshot 推導 workspace usage，也不只拿增加量與可能過時的 counter 相加。
3. 提交條件同時綁定 `workspace.revision=R`、`entitlementRevision=E`、`usageRevision=U`、usage_snapshot_revision 與當時角色／scope，並檢查該命令 capability。Quota growth predicate 與 domain write 必須在同一 atomic transaction；不能先寫資料再非同步補 usage。
4. 成功一起寫 snapshot R+1、projections、retained revisions／必要 purge、usage counters／U+1、receipt、audit；失敗全不寫。不相干的付款變更不得被舊 snapshot 寫回覆蓋。
5. lost response 以 operation receipt＋request hash 確認結果；不可因重送最後一席而再算一次。真正 snapshot CAS loss 維持既有 409 恢復流程，quota rejection 則回 402；單純 entitlement stale 回 metadata-only `409 ENTITLEMENT_CHANGED`，先刷新權益後再由使用者檢查，不無限重送舊草稿。

### Membership／邀請與 owner transfer

Membership write 不一定改 workspace snapshot revision，因此必須加入共用 usage gate。邀請接受、viewer→teacher/admin、remove/demotion、ownership transfer 都在**同交易**重讀／斷言舊 membership、角色、scope、邀請狀態與 E/U，更新 counter 與 membership。並行「接受最後一席」與「teacher→viewer」也須有確定順序，不得 temporary oversell 或漏釋席位。Owner 唯一性／claim CAS 與既有成功 audit invariant 繼續保留；額度檢查不能拆開 ownership transaction。

### Adapter 執行邊界

- **Node JSON**：所有 grant、seat／placement 與 receipt 更新在現有單一 repository mutation queue 的同一 database clone 內重新驗證，最後同一次 atomic file replacement。持久化失敗不得公布新 usage 或新權益；不宣稱支援多 process 共用同 JSON 檔。
- **D1**：沿用條件式 mutation＋同一 batch 的 write-token gate；將 E/U、期限與 quota predicate 納入真正 SQL mutation 條件，再讓所有後續 usage/projection/audit/receipt 受該次成功 token 約束。Membership 操作若以 gate 先更新，gate 必須同時驗證完整舊 domain 狀態，後續 mutation 受同 token 保護；需以測試證明不可能「gate 成功但 domain 0-row 卻提交 usage」。
- D1 的 0-row CAS 是一般結果，**不是自動 rollback**。事後讀 `meta.changes` 並拋錯不能回滾已提交 batch。必須在交易內建立成功／失敗 gate，並對非預期 invariant failure 使用能使整批失敗的 constraint 機制或等效交易設計；新增 SQL 的 exact 行為留待合成 D1 proof，未完成不得啟用。
- 不用程序內 mutex 當 D1 correctness；至少用兩個 repository instance 共用同一合成 D1，控制 barrier 使 read/precheck 都先通過，再驗證真實 transaction 只有一方可成功。
- Reconciliation 可偵測 counters 與 source 不一致，發出 aggregate 告警並封鎖增加量；不能在旁路直接修 counters、吞掉錯誤、讓已過期 grant 永久續命。修復需有 workspace/source revision 前置條件、稽核與可重跑 receipt。

## 7. Session、同步與錯誤 DTO

建議新增 `GET /api/v1/workspace/entitlements`，並在 session active workspace view／`GET /state` 的 server response 加可選、版本化 entitlement DTO。仍以原 `WorkspaceAccess` 的 user/workspace/role/class allowlist 綁定草稿；entitlement 是另外的可變狀態，不能把 role 改成付費角色或把方案藏進 access digest。

| 接收者 | 可見內容 | 不可見內容 |
| --- | --- | --- |
| owner | 有效方案／期間、公開限制、workspace aggregate usage、可執行 billing actions；帳單內容仍依 payer consent | 未授權 payer 付款工具與其其他 workspace 帳單 |
| admin | 可教學／readonly、限制與 workspace aggregate usage，供成員／資料治理 | checkout／付款工具／payer invoices，除非未來另有明確授權設計 |
| 限班 teacher/viewer | 自己的 role/scope、canWrite、通用到期／額度訊息、允許的下一步 | workspace usage、剩餘席次／學生數、其他班級數、合併後 bytes、payer資料；不能藉 quota response 推知其他班級 |

402 設計回應可含 `error: ENTITLEMENT_REQUIRED`、bounded reason（`expired | quota_exceeded | workspace_read_only`）、entitlementRevision 及自己的可用 actions；不得含 current snapshot、被拒 payload、實際合併大小或其他班級 usage。Teacher 僅看「工作區目前無法新增，請聯絡擁有者」等必要資訊。401／403 優先保持既有撤權／登入隔離，不能降格成付款問題。

目前 `src/services/syncRetryPolicy.ts:44–52` 將未列入 transient 的 HTTP 錯誤視為 permanent，因此 **402 原已落入不自動重試類型**，但尚無 entitlement-specific UI。後續可新增 typed entitlement failure，必須保留 terminal 語意；5 次 transient 預算與 429 deadline 行為不變。

### 到期時尚有未同步草稿

`src/services/workspaceDrafts.ts:6–21,62–88` 的 v2 草稿以原 scope 保存，TTL 為 **24 小時**；`src/hooks/useBackendSync.ts:158–164,225–227,401–423,444–474,506–534` 已有 exact access／失敗暫停／受控恢復邊界。

1. 到期前建立的草稿在到期後送出，server 仍回 402；建立時間不是繼續寫入的授權。停止 queue/timer、自動重試、flush 與相同草稿重送，保留原始到期時間及 failure。
2. 重整、登出再登入、切工作區、修改 client clock 或失敗重送，都不能重設 TTL、重新開始 trial 或洗掉 terminal pause。舊草稿缺 entitlement metadata 也必須經 server 現行規則。
3. 保留原 user/workspace/role/class scope；撤權後不渲染、不匯出、不挪到新 scope。付款成功也不擴大資料授權。Teacher 不能因付款問題得到完整 draft/export。
4. Owner/admin 的本機草稿下載延續目前重新驗 session＋exact scope 的規則。保留後登出／切換仍須先成功寫 sessionStorage；失敗不得宣稱已安全保留。
5. 付款／人工 grant 生效後，先重新驗 session、scope、有效 entitlement 與最新 snapshot，處理 revision 差異。**不得 webhook 一到便自動重播所有舊草稿**；使用者明確恢復前先檢查當前額度及 TTL。採用雲端須明確同意丟棄本機內容。

## 8. Owner、payer 與付款事件

Billing 預設 owner-only，不把 admin 教學管理權自動擴張為付費授權。最簡 pilot 是 owner 自己付款；如小補習班由另一人付款，須有獨立 payer principal、付款範圍／持續扣款 consent 與 owner acknowledgement。Payer 取得狹義付款能力，不因此取得 workspace membership 或學生資料。Owner 可以取消該工作區續約；對付款工具及 payer 全部發票的存取仍須其明確 consent。

**Ownership transfer 不轉移卡片、customer account、invoice 存取、payer consent 或法律付款義務。** 轉移後新 owner 只先取得工作區管理與必要訂閱狀態；付款工具／帳單能力須重新連結或核准，原付款人可撤回未來付款授權。不得把 provider customer portal 的整個帳戶 URL 交給新 owner，造成其看到 payer 其他工作區帳單。歷史 invoices 不因換 owner 就改寫抬頭或歸屬。

Workspace／account 隱私刪除須停用應用內未來計費意圖、撤回 binding／自動重試資格，建立可追蹤的 provider cancellation pending 操作，再按原授權清除教學資料。若 provider 暫時不可用，取消由受控工作與支援追蹤至確認，不能無限阻擋隱私刪除，也不能在未確認外部取消時宣告不再扣款。僅保留完成取消／對帳與核定憑證目的所需的最小帳務識別，禁止另留學生資料作為取消重試條件。

### 未來支付 adapter 的必要協定

1. Checkout／cancel 等 owner command 先產生 operation receipt／provider idempotency key，server 綁定 workspace、planVersion、amount/currency 與環境；不能相信 client 回傳已付款或成功頁 redirect。UI 只能顯示 pending，權益由驗證結果生效。
2. Webhook 與 cookie API 分開 authentication。由 provider adapter 驗證簽章、環境、期限／replay 條件及物件 binding，先 durable inbox，再回 bounded acknowledgement；未驗簽不得改權益。本次不提供 URL、金鑰或接入程式。
3. `(provider,environment,event_key)` 去重；有原生事件 ID 時優先採用，否則 adapter 依現行規格組合交易／委託、期次與事件種類等穩定識別，驗證不會把不同合法事件合併；不能只用整包 body hash。相同鍵的 canonical 語意 hash 不同時隔離並查證，不直接覆蓋。事件重送不重複 grant／退款／通知。收到事件與外部 reconcile 之間 crash 必須可重跑，不能先標 processed 再做副作用。
4. **Idempotency 不解決亂序**。invoice paid、payment failed、cancel、refund、subscription updated 可延遲或交錯；不能單純「最後到達事件勝出」，也不能只比 event.createdAt。取得 provider 權威 subscription／invoice 狀態與其 object version（若有），以 binding revision＋reconcile generation/CAS 套用規範化狀態；無可靠單調版本時序列化該 subscription 的 reconcile，舊 fetch 結果不得覆蓋新決策。
5. 外部 fetch 不可包在長 D1 transaction：先做 I/O，再以 E／binding revision 做短交易；CAS loss 重新 reconcile。權益與 inbox applied marker 同交易；重複 crash/retry 最終只生效一次。
6. Provider 狀態不明時保留有期限的最後有效 grant，不擴限、不任意新增 grace，不根據失敗事件直接刪教學資料。Owner cancel、provider late-paid、退款／dispute 的優先序須明訂並用 sandbox 合成事件驗收；本草案未承諾具體退款政策。
7. Reconciliation job 以最小 metadata 比對 pending inbox、綁定與 entitlement；告警／audit 不含學生、卡片或原始事件全文。事件 payload、帳務憑證與 receipt 保存期限尚待供應商／營運／隱私決策。

Snapshot import／revision restore 不能恢復 entitlement、payer binding、consent 或舊 grant。整庫災難復原則須在隔離狀態以獨立且未隨資料庫回退的刪除／取消紀錄及 provider 權威狀態重新 reconcile，驗證後才允許計費與授權；舊 backup 內的 active grant 或已處理事件標記不能作唯一證據。復原不得重新啟動已取消訂閱、重放扣款、復活已刪 workspace／帳號的付款同意；獨立 journal／實際演練仍是後續營運交付，參照 `docs/disaster-recovery.md`，不是本次已建能力。

## 9. 容量證據是販售前置條件

**900 KiB 是目前 application 的完整 D1 workspace snapshot 上限，不是宣稱 D1 平台的單 row 上限。** HTTP 上限是另一層；付費方案也不能繞過 application guard。

| 既有限制 | 來源 | 對商業承諾的意義 |
| --- | --- | --- |
| 完整正規化 workspace UTF-8 JSON ≤ 921,600 bytes（900 KiB） | `shared/domain/repositoryPolicy.ts:2`、`worker/repository.ts:194–215` | 含所有 active／archived classes 與內嵌教學歷史；超過回 413，不能用增加 paid seats 解決 |
| 一般 request body ≤ 2 MiB；部分 auth／隱私入口 16 KiB | `server/http/body.ts:3–16` | request 可通過仍在合併後超過 snapshot 上限；不是每 workspace 可販售 2 MiB |
| 200 classes、每班 500、合計 5,000 students，外加 nodes／depth／array／string 預算 | `shared/validation/workspaceValidation.ts:7–20,227–242` | 防濫用／相容輸入上限；**不是方案、性能或可用容量證明** |
| 最多 25 stored revisions | `shared/domain/repositoryPolicy.ts:1`、`migrations/0002_auth_rbac.sql:152–160,187–195` | 是筆數而非天數；付款層不承諾按天恢復或無限歷史 |
| Node 沒有相同 900 KiB guard | `server/repository.ts:356–362`、`docs/workspace-capacity-and-retry.md:9–14` | Node 成功不能證明 D1 可用，合成 D1 必須獨立驗收 |

30／100 placements 都尚未證明在完整教學歷史下可安全使用。不能以空白學生 fixture、初始 JSON bytes 或一次 happy-path save 對外承諾容量。

販售前每個候選 planVersion 至少產出可重跑的合成 evidence：中文多字元姓名與文字、實際介面允許的評量題項／成績／評語、learning evidence、每日紀錄、點數／懲戒／economy／boss histories、封存跨學期與 reopen，搭配 25 retained revisions、projection、privacy purge／restore／export 的完整路徑。採用的歷史長度必須來自預期教學使用情境並記錄，不能故意只放空歷史。

量測完整 merged snapshot 的 p50/p95/max bytes、歷史成長曲線、save/GET/restore/export/purge 的 latency／Worker CPU/memory、request bytes、D1 statements/row work 與失敗後無副作用；合成資料與測試環境規格可公開，無學生 PII。保留有依據的容量餘裕與成本預算，門檻數值目前待實測制定。

若候選達不到 gate，先縮小承諾、調整產品資料模型或另提拆分儲存架構，再重新測試；不能靜默截斷歷史、刪資料、抬高 guard，或把技術 failure 文案改成要求升級。**402 商業拒絕與 413 技術容量拒絕必須分開**。

## 10. Expand → migrate → contract 與既有租戶

遵循 `docs/database-migration-policy.md:15–23,27–41,46–59,79–91,124`。本文只規劃，沒有新增 migration、改歷史 checksum、連 remote D1、backfill 或 deploy。

1. **盤點／設計**：建立完整 writer inventory、資料來源版本與合成 quota proof。先決定既有 workspace 的人工 legacy grant、期限／通知與責任人；不能把缺 entitlement row 自動解讀成「試用已過期」、重啟 14 天試用或直接套新付費方案。
2. **Expand 提案**：後續另開 schema PR，只有審查通過的新表／相容欄位。新 UNIQUE/CHECK、constraint failure 機制是否符合既有 expansion guard 必須實際驗證；不合 allowlist 走獨立 review，禁止 bypass。現有 `0001`–`0008` 不編輯；序號依當時 repository 的下一個可用值，不在本文預先建立 SQL。
3. **Bridge／observe**：舊 serving A 與 bridge B 在 expanded schema 上都能正常登入、auth、讀寫。新增表缺失或 tenant 未 enrollment 時沿既有授權行為並產生 bounded 觀察訊號；只有明確 enrolled cohort 才可依政策 fail-closed，不能全域開 flag 使舊租戶突然 402。
4. **Migrate**：獨立、可恢復的操作按 workspace keyset cursor 計算 usage，記錄 source snapshot revision／membership 狀態與 checkpoint。與新 writer 併發時必須 CAS／重算，不能覆蓋較新 counters。手動核對 legacy grants，記錄選擇與通知，不自動轉 card／payer。
5. **Shadow 比對**：新 writer dual-write usage／receipts，server gate 先只觀察「would deny」；核對 snapshot／membership 與 counter 無 drift、合成繞過全被辨識、false denial 為可接受且有證據。這不取代容量 gate。
6. **分 cohort enforcement**：僅對明確加入 trial／manual pilot 的工作區啟用；grant 到期、告知、export/cleanup、support 與 rollback owner 都具備證據後，再另行決定舊租戶切換。未取得這些條件不得 silent migration。
7. **Rollback／contract**：rollback 版本若會忽略 quota，不可在 enforcement cohort 上直接 serving；需維持 bridge、暫停相關 enrollment 或顯式受控撤回 enforcement。保留相容資料與 receipt，完成核准 rollback window 後才另提 contract；不以 app rollback 回復 schema，不刪 ledger、不自動 Time Travel。

## 11. 未來驗收矩陣：目前均未實作／未執行

以下是開發及上線 gate，並非本次測試結果。本次只校對來源與文件；不因文件完成而把能力標示為已交付。

| 編號 | 必須證明的案例 | 驗收結果要求 |
| --- | --- | --- |
| E01 計數 | owner/admin/teacher、viewer、多班同 studentId、跨 workspace、archive/reopen、匿名化 | writer owner included；跨班同 ID 算 2；匿名化不憑名稱釋額；archive 仍占 bytes |
| E02 最後一席 | Node queue；兩個 D1 repository；並行接受邀請、role promotion、owner viewer transfer | 恰一成功；loser 無帳號／membership／scope／invite accepted／audit／counter 副作用 |
| E03 最後 placement | 不同班同時新增、teacher partial merge、admin import／restore／reopen | 完整 workspace quota 原子；跨班 race 不超賣；scope 不變 |
| E04 用滿與超額 | current==cap 正常教學；提議 cap+1；真正 legacy usage>grant | 用滿仍可教學；拒絕一筆 growth 不 latch readonly；真超額只容許明確 cleanup |
| E05 期限 race | 時鐘邊界、草稿跨期限、延遲 webhook、past_due grace 截止、cancel-at-end | server commit 決策；沒有 client-clock／重試／事件延遲延長 grant |
| E06 受控清理 | readonly export/delete/anonymize/archive/member remove；任意減少 count 的 PUT | 既有 RBAC／scope／確認／CAS／privacy purge 全保留；任意 PUT 仍 402；取消續約可用 |
| E07 錯誤隱私 | teacher A 班的所有 402/409/413/503 與 quota precheck/commit loss | 無 B 班資料、counts、remaining、merged bytes、payer 或 unscoped snapshot；admin aggregate 界線正確 |
| E08 草稿相容 | 舊 v2 草稿、402 reload/logout/switch、scope 改變、24h TTL、付款後恢復 | terminal pause 不重送、不延 TTL；原 scope 隔離；恢復先驗雲端／session／grant並明確操作 |
| E09 交易失敗 | Node rename failure；D1 gate loser、projection/audit/receipt/usage 晚期 failure、lost response | 沒有部分提交／counter drift；相同 operation/hash 最多一次；不同 hash 重用 key 拒絕 |
| E10 事件與 payer | duplicate、亂序、同 timestamp、舊 fetch 晚回、crash-before-marker、sandbox/live、owner transfer、金額元／provider單位、provider down時隱私刪除、整庫restore | 最終狀態符合權威 reconcile；精確金額不乘錯單位；舊結果不能覆寫新 grant；卡／invoice／consent 不自動轉移，刪除不cascade憑證也不復活grant |
| E11 容量 | 30/100 完整歷史、中文、archive、多學期、import/restore/purge/export、25 revisions | 合成 D1 實測在所有 guard 與預算內；記錄 raw 結果與版本；未達標不販售該容量 |
| E12 遷移與 legacy | A/S、A/S+、bridge/S+；backfill race/restart；missing row；legacy grants；rollback artifact | 舊租戶不突變試用／402；schema/ledger不造假；counts來源一致；新舊版本可相容 rollback |

所有新 gate 測試須延續既有 API／auth／privacy／ownership／workspace sync／D1 regression；使用合成資料、本機或隔離 staging，不能把學生個資放入 fixture/log，不以 production 試跑證明正確。支付 sandbox 驗收需在未來另行授權與選定 provider 後進行。

## 12. 待決定事項與完成定義

價格、30／100 容量、14 天試用、7 天 past-due grace、viewer 防濫用界線、候選 plan 的有效歷史範圍、receipt／webhook／帳務資料保存期限、退款／dispute、供應商與舊租戶 grant 均待驗證或營運決策。**沒有數字的保留政策就保持未定**：不為了填表發明「到期後 N 天刪資料」，也不把 25 revisions 宣稱為固定天數備份。

商業化完成條件是取得目標教師／小補習班的需求與付費證據、通過容量與交易矩陣、完成支援／隱私／復原責任與明確 enrollment，再以獨立 implementation／schema／release 工作交付。這份文件本身只完成可審閱的架構設計。
