# Workspace Ownership 一致性契約

更新：2026-10-23；M03 本機修補與驗證完成，尚未部署。

受支援的有效 workspace 恰有一位 owner，且既有 `workspace_claims` 指向該 owner。真正尚未認領的 legacy workspace 可以同時沒有 owner／claim；已存在唯一 owner 而缺少 claim 的舊資料，可由合法 Transfer 原子建立 claim。多 owner 或 claim／role 不一致的資料，Transfer 一律回衝突，不能猜測、刪除或自動降權來修復。

原始 race：D1 在 transaction 外讀 source／target，然後 batch 中先清 scope、條件式 demote source、無條件 promote target／寫 claim／audit。兩個 A→B、A→C 都看到 A 是 owner；第二個 batch 的 demotion 影響 0 rows，其他寫入卻繼續，留下 B、C 兩位 owner。Node 的角色檢查原本已在 mutation queue 內，因此不會重現同一個角色 race，但 loser 沒有專用的可處理錯誤。

選擇沿用既有資料表，沒有 Schema Migration：

| 方案 | 評估 |
| --- | --- |
| Partial UNIQUE owner index | 能約束最多一位，不能單獨保證至少一位；需先盤點既存重複資料，亦會涉及 constraint tightening／既有 SQL 更新順序及 migration policy。不能修改已鎖定 checksum 的 `0002`，或自動清理重複 owner。 |
| 新增 authoritative owner pointer，改寫授權模型 | 需要同步所有 provisioning／claim／auth／刪除路徑及舊資料轉換，超出本次必要修補。 |
| **既有 claim pointer 作原子 CAS + 同 transaction 角色與副作用閘門** | 可在目前有效資料與角色模型上維持 invariant，無新欄位、索引或資料遷移；本次採用。pointer 不取代 membership RBAC。 |

D1 `transferWorkspaceOwnership` 使用一個 `database.batch` transaction，四個 statement 的順序不得插入其他會改變 `changes()` 的 statement：

1. Claim UPSERT／CAS：在同一 SQL 中驗證 source 是該 workspace **唯一** owner、target 是同 workspace 的不同非 owner 成員；既有 claim 必須仍指向 source。缺少 claim 時，只有這個有效狀態可插入。成功影響 1 row，其他情況 0 rows。
2. 一個 membership `CASE UPDATE` 同時 demote source 為 admin、promote target 為 owner；要求上一個 statement `changes() = 1`。不在每一列更新時重新查 source 角色；CAS 的成立加上 transaction 隔離保證兩列仍符合條件，更新 2 rows。target 的 `created_by_user_id` 記錄移轉者。
3. Ownership audit `INSERT … SELECT` 要求緊鄰上一個 statement `changes() = 2`，只寫一筆成功事件。
4. 清除 source／target 的班級指派要求上一個 audit `changes() = 1`；無關成員的 scope 不變。任一 SQL／constraint／audit／cleanup 失敗會使整個 batch 回滾。

方法檢查結果 1／2／1 後回傳成功；0／0／0 代表 lost CAS，拋 `WorkspaceOwnershipConflictError`，API 回 `409 {"error":"OWNERSHIP_CONFLICT"}`。**事後的 row count 檢查不能回滾 transaction，也不是正確性的來源**；正確性來自同 transaction 的 CAS predicate、兩列更新及直接相連的成功閘門。維護時須保留此條件，不能用外部 read-then-write 取代。

Node JSON 在既有單一 repository 的 mutation queue 內重新檢查同一 invariant，在 clone 上一起更新 roles、claim、assignments、audit；只有 atomic file replacement 成功後才發布新記憶體狀態。持久化失敗時，記憶體與原檔都保留舊狀態。這與 Node server 既有單一 repository 實例的部署模型相符；不支援多個 process／repository 同時共用 JSON 檔案作資料庫。D1 的保護由資料庫 transaction 提供，測試使用兩個 repository 共用同一合成 D1。

API 行為與相容性：

- 兩個都已通過授權、進入 repository 的並行操作：一個成功，一個 409，恰一 owner／claim／成功 audit；loser 不寫 scope、membership 或 audit。整個 workspace 資料／revision 不變。
- 舊 owner 降權後才抵達授權邊界的新請求：維持 `403 FORBIDDEN`，不為了統一 409 放寬 RBAC。
- 仍可轉給任何既有非 owner（含 teacher／viewer）；升為 owner 後清除其 scope，source 成為 admin。角色名稱與權限定義不變。
- 錯誤回應沒有 snapshot 或其他成員資料；UI 對 ownership conflict 顯示重新載入成員與權限的提示。AuthService 只有在 repository 成功後才通知雙方，不寄出失敗移轉通知。
- Legacy Claim 也在 SQL／JSON mutation 內拒絕另一位既有 owner，不能利用缺少 claim 建立第二位 owner。真正 ownerless／unclaimed 的 workspace 仍可認領一次。

發布前應透過授權、唯讀盤點辨識多 owner、claim 與 owner 不符、以及缺少 claim 的舊狀態；本次未讀取正式 Membership。異常資料需個別核對合法擁有者及處理紀錄，不得自動任選一人或 silent-drop。任意直接 SQL、外部管理工具及未來新增 owner writer 不受此應用層契約自動保護，新增路徑必須遵守相同 invariant。

驗證入口：`npm run test:ownership`、`npm run test:auth`、`npm run test:server`、`npm run verify`。合成測試覆蓋雙 repository 的可控併發、RBAC／CSRF／租戶、相同輸入／時間戳重播、missing／mismatched claim、多 owner fail-closed、合法連續移轉及 JSON／D1 晚期失敗回滾。沒有新增 dependency、lockfile 或 migration，也沒有部署或修改正式會員。
