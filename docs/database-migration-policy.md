# Database migration policy

更新日期：2026-10-01。適用於 `epet-production` D1、Cloudflare Worker，以及前端靜態資源的 production release。

## 現有流程的問題與這次調整

原本 `deploy.yml` 在同一次 job 中依序驗證、套用所有 pending D1 migrations、部署 Worker。D1 與 Worker 並非同一交易：migration 成功後若 Worker 部署失敗，舊程式仍可能使用新 schema；若 migration 移除舊程式需要的欄位、表或資料，production 就可能失效。

現在 application deploy 不執行 migration。它先驗證 migration 檔案與 checksum，再以唯讀查詢確認此 checkout 的 migrations 全部存在於 `d1_migrations`，最後才部署 Worker。缺少 migration、ledger 不存在／查詢失敗、ledger 有缺口或未知 migration 都會停止部署。

`database-expand.yml` 是獨立的 `workflow_dispatch` 流程，只能在 `main` 執行。它使用 `production` environment，與 application deploy 共用 `cloudflare-production` concurrency group，且不取消執行中的 job。它只允許已分類並驗證的 expansion，不發布 application。Production environment 的 required reviewers、branch rules 與 Cloudflare token 權限須由 repository 管理員設定；YAML 本身不會建立這些保護。

這次沒有變更任何現有 SQL migration、production schema、API 或遊戲規則，也沒有執行 remote migration／deployment。

## Expand → migrate → contract

| 階段 | 允許的改變 | 舊 application 的要求 | 執行方式 |
| --- | --- | --- | --- |
| Expand | 新表、非 unique index、nullable 欄位、具有相容 literal default 的欄位 | 在擴充後 schema 上，舊版的讀、寫、auth 與授權均可繼續運作 | 獨立手動 `database-expand.yml`；production deploy 不套用 schema |
| Migrate | Dual-write、分批 backfill、驗證完整性、逐步切換讀取來源 | 舊欄位與舊資料語意仍保留；rollback 版本仍能讀取新版寫入的資料 | 先部署 bridge application，再執行獨立且可恢復的資料操作 |
| Contract | 移除舊欄位／表、rename、table rebuild、刪除資料、收緊既有資料約束 | 所有 serving／可 rollback 版本均已停止依賴待移除的結構 | 獨立 maintenance change、明確 operator 核准；不進入 expansion 或 application workflow |

「Additive」只是必要條件。新 UNIQUE index、CHECK constraint、trigger、新值格式或預設值都可能破壞舊版寫入，即使沒有 `DROP`。Reviewer 必須提供舊版讀寫相容性的證據，不能僅憑 migration 名稱、metadata 或 SQL 檢查器判斷。

## Release 步驟

1. PR 記錄 migration 的目的、相容性矩陣、backfill／verification 計畫與 rollback window。對新的 expansion，在 `migrations/policy.json` 記錄 checksum、`compatibility` 與 `verification`。
2. 在獨立 staging／本機 D1 執行 migration，使用合成資料測試目前 serving 版本與新版本在擴充後 schema 的讀寫、登入、授權與 tenant isolation。不得讓 staging／preview 指向 production D1，也不得把 student PII 放入 CI fixture 或 logs。
3. 合併 expansion PR 後，application workflow 若發現 pending migration 會停止。核准並手動執行 `database-expand.yml`，再確認目前 serving Worker 的必要功能正常。
4. 重跑 `deploy.yml`，發布同時支援舊／新欄位的 bridge application。若需要切換來源，先保持 feature flag 關閉並 dual-write，驗證後才開啟新讀取路徑。
5. 使用獨立 backfill 操作搬移資料，核對筆數、tenant keys、revision 與資料語意。保留舊資料及 dual-write，直到新路徑穩定並經過 release 定義的 rollback window。
6. 以另一個 PR 移除 application 對舊結構的依賴，部署並確認沒有任何舊讀寫路徑。最後才核准獨立 contract 操作。

相容性矩陣至少應包含：

| Application / schema | S（原 schema） | S+（expansion 後） |
| --- | --- | --- |
| 目前 serving A | 讀寫成功 | 讀寫成功，包含新版本可能寫入的值 |
| Bridge B | 能維持舊路徑，或明確要求先 expansion | 讀寫成功、可 dual-write |
| 切換後 C | 由 release 計畫決定 | 讀寫成功；rollback 到 B/A 的資料語意仍相容 |

不能把 schema rollback 當成 application rollback 的一部分。若 A 無法讀取 B 寫入的資料，release 尚未完成 expand/migrate 的相容性要求。

## Migration discovery 與分類

`wrangler.jsonc` 保留 `migrations_dir: "migrations"` 與預設的 `d1_migrations` ledger。Top-level `migrations/*.sql` 只能包含 frozen history 與經審查的 expansion；backfill／contract SQL 放在這個 discovery directory 以外，例如 `database-operations/migrate/`、`database-operations/contract/`。這些目錄是未來操作的規劃位置，本次沒有新增或執行 destructive SQL。

Production commands 經過 `scripts/d1-migrations.mjs`：

| Command | 行為 |
| --- | --- |
| `npm run db:validate:migrations` | 本機分類、檔名、checksum、expansion SQL 檢查；不連線 production |
| `npm run db:check:remote` | 唯讀查詢 applied names；任何 pending／未知／不完整 ledger 都阻止部署 |
| `npm run db:migrate:remote` | 驗證後只套用 pending expansions；任何 pending historical migration 都阻止寫入；完成後再查 ledger |
| `npm run db:migrate:local` | Wrangler 的本機 ledger-managed bootstrap，用於 fresh development database；不連線 production |

Expansion guard 採保守 SQL allowlist，只接受 `CREATE TABLE IF NOT EXISTS`、簡單的非 unique `CREATE INDEX IF NOT EXISTS`、nullable `ADD COLUMN` 或 `NOT NULL` 加上非 null literal default。它拒絕 `DROP`、`RENAME`、`UPDATE`、`DELETE`、`INSERT/REPLACE`、trigger、unique index、既有表的新 constraint 與 dynamic defaults。Comments／字串中的關鍵字不視為 SQL operation。超出 allowlist 的合理改變也需要獨立 review，不能加入 bypass flag。

Guard 與目前 production Wrangler database、discovery directory 及 ledger 綁定。更改 environment、migration pattern／table 或 config parsing 時，要連同 guard 與 tests 一起 review。目前 config 使用 JSONC 的 strict JSON subset。

新增 expansion 的 metadata 範例（checksum 必須從實際檔案產生）：

```json
{
  "sha256": "<actual SHA-256 of LF-normalized SQL>",
  "compatibility": "A 的 explicit-column INSERT 不需要新欄位；新欄位 nullable，A 的查詢仍讀原欄位。",
  "verification": "在 staging 執行 A/B 的讀寫與 authorization regression tests；附結果與版本。"
}
```

新增序號必須在既有歷史之後，名稱為四位數加描述，例如 `0008_add_optional_field.sql`。用以下唯讀指令計算 digest，將結果加入 `expansions`，保留 `historical` 原樣：

```bash
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {migrationDigest} from "./scripts/migration-policy.mjs"; console.log(migrationDigest(readFileSync(process.argv[1], "utf8")));' migrations/0008_add_optional_field.sql
```

## 歷史 migrations 的處理

`0001`–`0007` 原檔名與 SQL 全部保留，checksum 以 LF-normalized 內容固定，避免 Windows／Linux checkout 換行差異。Wrangler ledger 只記錄檔名，不記錄 checksum，因此不能編輯／改名已套用 migration，也不能修改 checksum 來掩蓋內容變動。

| 歷史 migration | 特性／風險 |
| --- | --- |
| `0001` | 建立 workspace 表／index |
| `0002` | 增加欄位、auth/RBAC、revision triggers 與 backfill；`ADD COLUMN` 不可 raw replay |
| `0003` | 建立正規化 projections 並 `INSERT OR REPLACE` backfill；在較新 schema 上 raw replay 可能造成 cascade 影響 |
| `0004` | 增加 class assignments、tenant guards 與一次性授權 backfill；不可重放 backfill 來恢復後來撤銷的權限 |
| `0005` | 增加 workspace invitations |
| `0006` | 增加 read model、sort columns 與 backfill；保留 blob 作為相容來源 |
| `0007` | 增加 email verification，並 copy/drop/rename 重建 rate-limit 表；需獨立操作審查 |

所有歷史 migration 若已記錄於 production ledger，guard 允許繼續部署，且不重新執行。若任何歷史 migration 仍 pending，或 ledger 不存在，workflow 會 fail closed。這時 operator 必須先盤點實際 schema／ledger、確認 serving app 相容性、staging rehearsal、backup/restore point 與 maintenance 計畫，再以獨立 reviewed bootstrap 完成所需歷史變更。禁止自動補 ledger、清空 ledger、或直接重放歷史 SQL；schema 與 ledger 不一致必須逐項確認。

`worker/repository.ts` 的 blob fallback 只涵蓋部分讀取。寫入 projections、建立帳號與 email verification 仍需要對應 schema；不能將 fallback 當成缺少 migration 的通用復原能力。

## 安全重跑與 backfill

[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) 以 `d1_migrations` 的 applied filenames 略過成功檔案。Production 重跑指的是重新執行 ledger-managed operation，而非把每個 SQL 檔再次執行。`ALTER TABLE ADD COLUMN` 不需、也通常無法逐句 idempotent；成功 migration 已記錄，就不重放。

依 [D1 apply 的錯誤語意](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply)，失敗的 migration 會 rollback，但先前成功的 migrations 保留。Runner 重跑會先讀 ledger，只套用其餘已核准的 expansion。如果 HTTP timeout 使結果不確定，先重新查 ledger／schema；不得猜測全部成功或全部 rollback。

Backfill 必須獨立於 schema deploy，使用穩定主鍵／keyset cursor、bounded batches、checkpoint 與明確 revision 條件，避免覆蓋併發的新寫入。重跑應略過已完成 rows，或以同一 input revision 得到相同結果。對 tenant 資料必須同時使用 workspace/class/student keys。檢查筆數／revision／完整性可以輸出 aggregate counts，不能輸出學生姓名或原始資料。

不要使用歷史 `0003` 的 `INSERT OR REPLACE` 作為任意修復腳本。需要 repair 時應使用已有 projection repair 抽象或另寫具前置條件與測試的 operation。

## 部署失敗時的處理

- Expansion 失敗：application workflow 尚未部署新程式；先查 ledger，成功 expansion 留在原處，確認 serving Worker 可正常讀寫後再重試。
- Expansion 成功、Worker 尚未啟用就失敗：保留擴充後 schema與原 serving 版本，修正 release 後重跑。不要執行逆向 schema migration。
- Worker 已啟用、後續 routes／triggers 更新失敗，或 CLI timeout：查 Cloudflare deployments 與 health／必要讀寫，確認目前實際 serving 版本。不能用 exit code 推定舊版仍在 serving。
- 新版本已 serving 且功能失敗：從記錄的 last-known-good version 選擇相容的 application rollback 或 forward fix；rollback 前確認 bindings／資源仍存在，以及舊版可讀取新增資料。

[Worker versions/deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) 不包含 D1 storage state；[Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) 不回復 schema／資料。這套策略降低 schema 改變造成的 deployment outage，並不保證所有平台、程式或 resource 更新失敗都維持可用。

D1 Time Travel／restore 是獨立 disaster-recovery 操作，可能遺失 restore point 之後的寫入。必須依既有 operations runbook 核定 RPO/RTO、備份與維護窗口，不能在 deploy failure handler 自動還原。

## Contract 操作的核准條件

Destructive migration 不加入 `deploy.yml` 或 `database-expand.yml`，也不放入 `migrations/*.sql`。每次 contract 都使用獨立 PR、明確選定檔案、maintenance 執行紀錄，必要時才建立專用 workflow；不能重用無條件的 `migrations apply` 跑 contract。

執行前必須確認：backfill 已完成並驗證；所有 serving 版本與可 rollback 版本已不依賴舊結構；舊 reader/writer/cron 已停止；rollback window 已結束；backup/restore rehearsal 完成；資料刪除與隱私要求已確認。記錄 operation ID、checksum、preconditions/postconditions、操作者與時間；若需要可重跑，須建立獨立 operation ledger 或具等價效果的狀態檢查。禁止修改既有 `d1_migrations` 來偽造執行結果。

Contract 失敗／中斷後，先確認真實 schema/data state 再決定 recovery。`DROP`、rename、資料刪除或 constraint tightening 不能僅憑一句 `IF EXISTS` 就宣稱安全重跑。

## Automated verification 與限制

`tests/migrationPolicy.test.mjs` 測試 checksum／分類、SQL allowlist、ledger validation、pending history 阻擋、唯讀 application gate、套用後確認與安全 rerun，並在 Miniflare D1 上驗證擴充後的舊式讀寫。既有 D1 tests 繼續驗證 schema、tenant constraints、auth lifecycle 與 projection rollback。

本機測試不取代每次 release 的舊 serving artifact/staging compatibility test。SQL allowlist 不能證明業務語意相容、歷史 checksum 不能驗證 live database drift、GitHub concurrency 也不限制外部 operator 的 CLI 操作。所有 production schema 操作都應遵循相同的序列化與審查規範。
