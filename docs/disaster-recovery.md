# D1 災難復原與備份演練

初稿：2026-10-29；驗證更新：2026-10-30。狀態：本機自動檢查與小型遠端合成演練完成；正式 RPO／RTO、營運簽核與完整容量復原能力尚未驗收。

本文件補充 [database migration policy](database-migration-policy.md)、[P0 operations runbook](p0-operations-runbook.md)、[班級生命週期](class-archive-lifecycle.md)、[隱私治理](privacy-data-governance.md) 與 [staging 部署](staging-deployment.md)。Application revision restore、工作區 JSON 匯入、Worker rollback 與 D1 整庫復原是四種不同操作。前兩者不是資料庫備份；Worker rollback 也不回復 D1 schema、ledger 或資料。Cloudflare 明確說明 [Worker rollback 不改變連接資源](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)，舊程式仍須相容於實際資料。

本次沒有讀寫 Production D1、部署 Worker 或修改 production flags／secrets。2026-10-29 初次身分確認未登入；2026-10-30 使用者完成 Wrangler 登入並指定 Account ID 後，唯讀確認 OAuth／`d1:write` 及目標帳戶相符，再建立兩個全新、未綁定 Worker 的專用 synthetic D1，實際完成 Time Travel／undo 與 SQL 往返，證據見末節。這兩個 DR DB 不等於既有 staging application 已啟用；沒有更動其 config。OAuth 權限較廣，資源 UUID guard 不代表 provider IAM 已限制到單一 DB。不得把這次小型合成演練填成正式環境驗收。

## 平台能力與限制

下表是 2026-10-29 查閱的官方文件內容；實際 account 方案、database backend、權限與可用還原點仍須在核准的演練／事件中盤點。

| 項目 | 可依賴的文件行為 | 對本專案的意義 |
| --- | --- | --- |
| Time Travel | Production backend 自動啟用、建立 bookmarks，無須啟用排程備份。[官方說明](https://developers.cloudflare.com/d1/reference/time-travel/) | 不能據此宣稱已查驗 `epet-production` 的 backend 或歷史。`version: alpha` 不使用這套流程。 |
| 保留窗口 | Workers Free **7 天**、Workers Paid **30 天**；每 DB 每 10 分鐘最多 10 次 restore。[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) | 方案未確認前不承諾 30 天。窗口是可回溯長度，不是本產品 RPO／RTO 或備份的法定保存期限。 |
| 精度與選點 | 文件以「任一分鐘」描述 Time Travel。Bookmark 代表狀態；timestamp 查詢取得該時間或之前最近的 bookmark。[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[bookmark API](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/get_bookmark/) | 變更前先擷取 bookmark、UTC 時間與基線；事故時將 timestamp 解析成 bookmark 並審查。接受秒／毫秒格式不代表保證同等復原精度，也不保證零筆寫入遺失。 |
| 復原範圍 | Time Travel **原地覆寫整個 DB**，取消 in-flight queries／transactions；目前不提供以此操作 clone／fork 到新 DB。[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) | 同一 DB 內其他租戶、auth、安全狀態與 audit 都回到舊時點。不能只回復單一班級，也不能將來源 bookmark 套到另一 DB 當複製。 |
| 撤回復原 | Restore 回傳新 bookmark 與 `previous_bookmark`，後者可再做 restore 以回到復原前狀態。[restore API](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/restore/) | 操作前／後均記錄 bookmark。Undo 也是另一次覆寫，受保留窗口與核准約束；其後的新寫入同樣可能遺失，不是自動安全網。 |
| SQL export／import | Export 產生 SQL；import 執行 SQL，不能直接餵 `.sqlite3`。Export 期間阻塞其他 requests；含 virtual tables／FTS5 的 DB 不支援 export。Import 單檔上限文件寫 5 GiB。[import／export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) | 不對 live DB 刪 FTS 以求 export。未來新增 FTS 時停止既有備份路徑並另作設計。另核對目的 DB 容量與 SQL／row 限制；不能將 5 GiB 當 DB 容量。 |
| Import 阻塞 | Import 在執行期間阻塞 D1。[import API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/) | 只在專用隔離目的 DB 演練。`d1 execute --file` 是執行內容，不是自動 replace／merge；不直接匯入已存在 application schema／資料的 DB。 |
| Foreign keys／triggers | D1 預設強制 foreign keys；不能靠 `PRAGMA foreign_keys=OFF` 關閉，`defer_foreign_keys` 只延至交易結束，仍須符合約束。[foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) | 還原須比對 FK／index／trigger definitions，檢查 import 次序與 trigger side effects。SQL 檔存在、exit 0、row counts 相同都不足以證明完整還原。 |

Export 的大整數還有 JavaScript 精度限制，見 [官方已知限制](https://developers.cloudflare.com/d1/best-practices/import-export-data/#known-limitations-1)。備份設計須檢查實際欄位範圍，不能把成功輸出檔案當成無損證明。此 repo 的 frozen migrations 有 revision 與 class-assignment triggers，但沒有據此證明 live DB 沒有 drift／virtual tables；要以實際盤點與 round-trip 結果確認。官方說明沒有替本專案保證 trigger 順序、revision 保留與 normalized projections 的往返語意。

另有直接影響本專案容量的限制：application 容許單份 workspace snapshot 達 **900 KiB**（`shared/domain/repositoryPolicy.ts`），但 [D1 單一 SQL statement 上限為 **100,000 bytes**](https://developers.cloudflare.com/d1/platform/limits/)。SQL dump 的每列 `INSERT` 可能將整個 workspace／retained revision／class record 寫成一段 literal，合法的大型資料也可能超限；SQL escape／UTF-8 bytes 亦須計入。只減少每批 rows 或拆分檔案，不能拆掉一列本身過大的 statement。

因此本輪純 SQL 往返路徑只適用於檢查後在上限內的小型 synthetic fixtures，**尚未證明可復原 application 完整容量**。匯入前必須解析並量測每個完整 statement 的 UTF-8 bytes，在任何目的 DB 寫入前拒絕超限檔案，不可等寫入部分資料才失敗。大型 rows 應評估有效窗口內的 hosted 原地 Time Travel，或另行審查 parameterized import／chunk staging 策略；後兩者尚未實作或 remote 驗證。不能截斷、略過 rows、降低 application 容量或默默丟資料以取得通過。

## RPO／RTO 與保存政策提案

以下全是**未核准、未量測的規劃目標**，不是 SLA、已完成設定或平台保證。營運者、隱私負責人與校方須填定簽核人及日期；尚無成功的計時 remote 演練，因此目前實際 RPO／RTO 均為「未知」。

| 情境 | 規劃目標 | 前提與限制 |
| --- | --- | --- |
| 保留窗口內的誤刪／不當 schema 寫入，Time Travel 可用 | RPO ≤ **15 分鐘**；RTO ≤ **4 小時** | 選到可信未受損點，完成全體租戶影響審查、停寫、刪除重套、安全撤銷及驗收。若損壞已持續數小時，必要的舊點可能超過 RPO；應記實際損失，不選已損壞點以湊目標。 |
| Time Travel 無法使用、DB 已刪除或窗口外，只能取獨立 SQL 備份 | RPO ≤ **24 小時**；RTO ≤ **1 個工作日** | 須先完成獨立備份排程、儲存及權限設計，並有可還原成功的檔案；目前均未建置。900 KiB snapshots 可能超出 dump 的單 statement 上限，完整容量的 SQL fallback 尚未成立；本目標亦未獲容量可行性驗證。DB 遺失時不假設其 Time Travel 仍可存取。 |
| 個別 workspace／student 邏輯修復 | 逐案決定；不沿用整庫目標 | 優先評估授權的 revision／資料修復；不能為單一租戶便利而將整庫回退，犧牲其他租戶後續寫入。 |

計時口徑固定為：`T0` 首次服務中斷／需復原的損壞時間、`T1` 發現、`T2` 核准並開始隔離、`T3` 最後成功寫入與停寫證據、`T4` 選定還原點、`T5` restore／import 完成、`T6` 隱私與 auth 清理完成、`T7` 驗收後恢復可用。記錄 `T7−T0` 的服務影響；另記 `T7−T1`／`T7−T2`，不能只報 provider restore 花費。RPO 以受影響期間「最後已確認寫入」到實際保留點的落差及遺失操作數估算，包含無法重播的教學／授權變更；事故發現時間不能代替資料損壞起點。

建議獨立備份候選政策：每日一次、重大維護前額外一次，初步保留 **7 天**；每季一次 remote synthetic 演練，涉及 schema／備份工具改動時加做。這些頻率、保存天數、成本與刪除例外都尚待核准，沒有排程或 R2 bucket 因本文件而建立。不得用 Time Travel 的 30 天保留說明替代外部 SQL 檔到期銷毀政策。

## 備份與刪除／安全抑制紀錄

正式備份只在另行核准的 production 備份設計中操作。備份內容包括教師 Email、password hashes、token hashes 與學生資料，仍屬敏感資料；不放 Git、CI artifacts、一般工單、公開 URL 或一般 staging。**不匯出／還原 production 到 staging，連匿名化 production student data 也不作演練 fixture。**

每份正式備份須在受控的 manifest 記錄：operation ID、account／DB UUID、UTC 時間、工具版本、application commit／Worker version、migration filenames 與 catalog checksum、來源 bookmark（如可取得）、schema object 清單／digest、各表 aggregate counts、檔案 bytes／SHA-256、加密與金鑰引用、受限儲存位置、存取權限、到期日、核准人，以及獨立 suppression journal 的連續序號。SHA-256 證明檔案是否改變，不證明資料正確或來源可信。簽名／完整性保護、加密、輪替、跨 account／故障域保留、存取稽核及到期刪除均須真正實作後才可列為已完成。

必須在**不會隨該 DB restore 回退的獨立系統**保存刪除與安全抑制紀錄；同一 D1 的 `audit_events`、同份 SQL backup 或工作區 revisions 不是這份依據。紀錄只含重套所需的受限識別鍵、案件／operation ID、序號與 UTC 時間、刪除／去識別化／帳號停用／授權撤回／憑證變更類型、範圍、完成狀態與核准資訊，不存姓名、評語、明碼密碼或 raw tokens。識別鍵亦須視為敏感資料。需有不可任意改寫或可驗證完整性的保存方式、重複執行規則及明確保存期限。

在機制尚未建置前，現有 audit events 不足以保證備份後刪除都能重套；這是正式復原與隱私承諾的未完成項。Journal 的保存至少須涵蓋仍可被復原的所有備份／Time Travel 歷史；實際期限及例外由隱私負責人核定。若 journal 有缺口、無法核對時點或重套失敗，保持隔離，不恢復流量。不能承諾「所有備份皆已永久刪除」。

## 執行前隔離與 context guard

本節是任何未來 remote 演練的必要前置，不代表目前具備自動 remote DR guard。現有 staging guard 只適用既有 staging commands，不保護任意 Wrangler 指令。

1. 建立演練單，記錄操作者／獨立核對者、核准時間、計畫、停止條件及預計費用。管理員先重新盤點資源，再另行核准建立**兩個全新、專用、空白、synthetic-only 的 non-production DB**，例如 `epet-dr-source-<run-id>` 與 `epet-dr-target-<run-id>`；以新 UUID 證明彼此不同，亦不同於 production、staging 及其他既有 DB。不能只靠名字判斷安全。
2. 優先獨立 non-production account。核對 token 的 provider metadata／實際 scope，限必要 D1 權限；D1 權限若只能 account-wide，就把該 account 其他資源列為剩餘風險，不宣稱 UUID allowlist 是 IAM 隔離。不得借用 production token、Secrets、auth state 或學生資料。
3. 專用 DR config 僅列已核准 account、兩個 DB bindings `DR_SOURCE`／`DR_TARGET` 與 UUID；不引用 repo 的 `wrangler.jsonc`、generated staging config、production preview binding、named env、routes、assets、cron、Worker entry point 或外部服務。將 config、UUID／account、CLI 版本與核准單逐一交叉核對；未知欄位、target 不同或來源不明即停止。
4. 使用受控的獨立 process／credential context；只注入核准的 non-production credential，檢查並移除一般／legacy credentials、大小寫 aliases、Wrangler account／environment／profile／API endpoint 覆寫與 dotenv fallback。指定空的 env-file 與明確 config，不把 Secrets 填進命令、文件或 logs。`--config` 本身不能證明 ambient settings 不會改變目標。
5. **兩 DB 均不綁定任何 serving Worker**，所以沒有登入、Email、cron、API 或使用者寫入。若後續要做 Worker 驗收，先另行建立受存取控制的 quarantine Worker：明確無寄信 credentials／外部發送、無 scheduled triggers／queue consumer／public routes，且 auth／所有一般寫入都封閉。僅 `REGISTRATION_ENABLED=false` 或移除前端按鈕不構成維護隔離；目前 repo 沒有可宣稱已驗證的完整 maintenance switch。
6. 先驗證本機 fixture、validation 與 suppression 流程。Synthetic Email 使用不會投遞的 reserved domain；不得呼叫 Email provider 或以繞過登入保護建立真實帳號。Remote 只載入已審查的 synthetic fixture，不複製現有 DB。本輪沒有提供 remote fixture loader、migration bootstrap runner 或 remote validator CLI；演練前須另備受審查、固定指向這兩 DB 的 operator adapter／隔離 harness，不能將 local drill 改旗標指向遠端。

以上任一項未完成，remote 計畫維持待執行；本機工作不必等遠端資源而停止。

## 演練 A：SQL 備份與空白目的 DB 往返

此演練驗證 export／import，**不驗證 Time Travel**。使用上述兩個專用 DB；來源可使用經審查的 frozen migration bootstrap 建立 schema，目的 DB 必須維持空白，由 SQL backup 建立 schema。不能先對目的 DB 跑全套 migrations 再匯入整份 schema。

1. 在來源 bootstrap 前確認實際為空白，並以 ledger-managed 操作套用已審查的 migrations。歷史 migration 只可在這個確認空白的新 synthetic DB bootstrap，不 raw replay 到既有資料庫，也不補寫／清空 ledger。保存實際 migration list 與 digest。
2. 載入兩個 workspace、各自 users／roles／class assignments、重複但分屬不同租戶的 class／student IDs、active／archived 班級、exam／learning／game records、多個 revisions、audit 與各類合成 auth tokens。Fixture manifest 固定預期 counts、revision、schema objects、canonical digest 及 tenant isolation 結果；不只建一張測試表。
3. 來源停寫後，擷取 UTC 時間、bookmark、ledger、schema／FK／index／trigger 清單、aggregate counts、canonical digests，匯出完整 SQL，計算 bytes／SHA-256。Export 會阻塞 DB；時間算入演練。Raw SQL 僅保存在此次受控暫存區，限制存取並訂 cleanup 範圍，不加到報告。
4. 來源繼續做受控「備份後變更」：更新一筆 synthetic 成績、新增一筆有獨立 operation ID 的寫入；刪除／匿名化 synthetic student、永久刪 class／workspace／account；撤銷 membership／class scope、session／invitation，消耗 reset／verification token，變更密碼或停用帳號。將這些刪除／安全事件寫入**獨立於兩 DB** 的 synthetic journal，以便證明舊副本確實會使它們復活。
5. 先以經驗證的 pre-import guard 解析並檢查每個 SQL statement 的 UTF-8 bytes ≤ 100,000；任何超限、無法完整解析或不支援的內容均停止，**不對目的 DB 執行任何寫入**。此 guard 也須在 remote operator adapter 中明確接入，不能假設下方 raw Wrangler 範例自帶保護。通過後才重新確認目的 DB 空白／UUID，將檔案匯入目的。Import 失敗／timeout 時先讀實際 schema／狀態與 provider job 結果，不猜測全部 rollback，不對部分目的 DB 盲目重跑；保持隔離，記錄失敗，另行核准新的空白目的 DB 或修復計畫。
6. **先驗證未清理的目的符合備份基線**：schema object definitions／ledger、所有表 counts／digest、FK integrity、workspace blob／normalized projections／projection documents、revision 原值及留存數、audit。以 synthetic fixture 證明備份後新增的寫入不存在，舊的已刪／已撤銷資料可能回來。只在此時比較與基線相同；下一步有意清理後不再要求所有 digest 相同。
7. 依下一節重套 journal、清理 auth，驗證預期的 post-scrub manifest。再驗證跨租戶拒絕、teacher／viewer class scope、archived 唯讀、永久刪除不能由 revision 取回、一次性 token 不可重放、舊 session 失效、revision CAS 與 projection 寫入 rollback。用新的 synthetic auth state，且不連接 Email provider。
8. 保存分段時間、來源／目的 metadata、manifest hashes、驗證結果與失敗原因；量測 lost writes。記錄成功後才能將此**特定工具／fixture 規模的 remote SQL 往返**列為通過，不外推 production RTO。Cleanup 只按核准清單刪除這次專用資源／暫存檔，事前重核 UUID／絕對路徑；不通配刪除、不碰一般 staging。

匯出／匯入的命令形狀如下，**只有 context guard 與演練核准完成後**，操作者才可把所有 `<...>` 換成核准值執行。此文件未執行它們；不使用 `--yes`／skip-confirmation。各命令固定使用同一份已核對 config／空 env-file；不要省略 flags 回到 repo 的預設 production config。語法依 [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/)；先用本機鎖定版本的 `--help` 對照。

```powershell
$drConfig = '<ABSOLUTE_APPROVED_DR_CONFIG.jsonc>'
$drEmptyEnvFile = '<ABSOLUTE_EMPTY_ENV_FILE>'
$drSqlFile = '<ABSOLUTE_SYNTHETIC_ONLY_BACKUP.sql>'

npx --no-install wrangler --config $drConfig --env-file $drEmptyEnvFile d1 info DR_SOURCE --json
npx --no-install wrangler --config $drConfig --env-file $drEmptyEnvFile d1 info DR_TARGET --json
npx --no-install wrangler --config $drConfig --env-file $drEmptyEnvFile d1 time-travel info DR_SOURCE --json
npx --no-install wrangler --config $drConfig --env-file $drEmptyEnvFile d1 export DR_SOURCE --remote --output $drSqlFile
Get-FileHash -LiteralPath $drSqlFile -Algorithm SHA256
# Raw Wrangler 不含 statement guard；先完成每個 statement UTF-8 bytes 的阻擋檢查。
# 僅在檢查通過，並另一次核對目的 DB 空白與其 UUID 後執行：
npx --no-install wrangler --config $drConfig --env-file $drEmptyEnvFile d1 execute DR_TARGET --remote --file $drSqlFile
```

可在已核准的專用 DB 上以同樣固定 config／env-file 的 `d1 execute ... --remote --command <SQL>` 進行下列唯讀盤點。`quick_check(1)` 應只有 `ok`，它是限制回報錯誤數的快速檢查，**不是完整 `integrity_check`**；`foreign_key_check` 應無列。Schema definitions 必須對照由可信 migrations 建立的另一份 pristine DB 基準，不能只對照候選 DB 自己的 schema；ledger／counts 另對照受信 manifest。這些查詢不取回學生／auth records，但仍僅在受控日誌記錄；它們不能取代 repository 語意驗證。[D1 支援的 SQL／PRAGMA](https://developers.cloudflare.com/d1/sql-api/sql-statements/)

```sql
PRAGMA quick_check(1);
PRAGMA foreign_key_check;
PRAGMA table_list;
SELECT type, name, tbl_name, sql
FROM sqlite_schema
WHERE substr(name, 1, 7) <> 'sqlite_'
  AND substr(name, 1, 4) <> '_cf_'
ORDER BY type, name;
SELECT name FROM d1_migrations ORDER BY id;
SELECT 'workspaces' AS entity, COUNT(*) AS total FROM workspaces
UNION ALL SELECT 'memberships', COUNT(*) FROM workspace_memberships
UNION ALL SELECT 'classes', COUNT(*) FROM classes
UNION ALL SELECT 'students', COUNT(*) FROM students
UNION ALL SELECT 'revisions', COUNT(*) FROM workspace_revisions;
```

對 table／index definitions 的全部細節另核對 `PRAGMA table_xinfo`、`foreign_key_list`、`index_list`／`index_xinfo`；aggregate counts 範例不是「所有表已驗證」。目的 DB 缺少 `d1_migrations` 是停止訊號，不是跳過該查詢或自動補 ledger 的理由。Ledger ID 須為正數且嚴格遞增、filenames 符合受信 migration 順序；ID 有缺號本身不代表損壞，不要求 ID 連號。

若 export 內容的 table／trigger 順序使乾淨匯入失敗，或 revision trigger 在 import 時重建／修剪歷史，演練判定失敗。先保存不含資料的診斷，再以明確審查的備份格式／import 次序修復；不得以刪除 constraints／triggers、清空 ledger、重放歷史 backfill、放寬驗收或以 row counts 相同掩蓋。目的 DB 的已知少量資料變更也不是安全 append 的證明。

## 演練 B：synthetic DB 原地 Time Travel

此演練使用已核准、沒有 Worker binding 的 `DR_SOURCE`，其所有內容可被覆寫；它與演練 A 分別記錄結果。必須明確核准這次 **in-place destructive restore**。Time Travel commands 自身就是 remote 操作，沒有加 `--remote` 並不表示本機。

1. 保存與演練 A 相同的完整基線與 schema／data manifest，取得 bookmark `B0`、UTC 時間；先確認 backend／方案與 `B0` 在有效窗口內。另用 timestamp 查 bookmark，記錄兩者選點差異；不可只憑牆鐘猜測 marker 寫入是否已被涵蓋。
2. 做有序號的 synthetic 新增、修改、刪除與 security lifecycle 變更；把必要 suppression events 寫入獨立 journal，保存每次已確認 commit 的時間。取得復原前 bookmark `B1` 及變更後基線，停止所有 DB writers。
3. 核對來源 UUID、`B0`、影響與核准，執行原地 restore。保存 provider 回傳的 `bookmark`／`previous_bookmark`；失敗或 timeout 時先查 bookmark 與狀態，不重複猜測操作。切勿把 `B0` 提供給 `DR_TARGET`。
4. 先確認資料符合 `B0`，用 sentinel 與 manifest 證明 `B0` 後寫入遺失及刪除／撤銷復活；再執行隔離清理與完整驗收。保存平台復原時間及全部清理／驗收時間。
5. 如需測試 undo，須在仍隔離的同 DB 另行核准，使用實際回傳的 `previous_bookmark` 原地 restore，確認 `B1` 變更後基線。Undo 後也須重新重套 journal／auth scrub；不能把已回來的刪除資料留到後續測試。為保持證據清楚，undo 與後續 scrub 各自記錄。

```powershell
# 僅限已完成上述核准與 UUID 核對的 dedicated synthetic DB。
$drRestoreBookmark = '<APPROVED_B0_FROM_THIS_DATABASE>'
npx --no-install wrangler --config $drConfig --env-file $drEmptyEnvFile d1 time-travel restore DR_SOURCE --bookmark $drRestoreBookmark --json
```

不能宣稱 import 到另一 DB 等同平台 Time Travel，或本機模擬 rewind 等同這次 remote 演練。DB／account 不可用、授權失效與超出窗口的失敗路徑須另記，不能由成功 happy path 推定已涵蓋。

## 還原後隔離清理與驗收

這是任何舊副本回復後、重新連接 auth／流量前的必要步驟。正式資料的操作仍須獨立 production 核准與可審查的清理腳本；以下不是可以直接在 production 貼上執行的 SQL。

1. 在隔離中重套選點之後至現在的 suppression journal；重確認選點之前已存在的 suppression 也未遺漏。涵蓋學生刪除／匿名化、整班／工作區刪除、帳號刪除／停用、成員角色／班級指派撤銷；清理 workspace blob、normalized tables、projection documents、**所有 retained revisions** 與相關 audit targets。使用現有 repository 的原子 purge／CAS 邏輯或經驗證等價操作，不只刪 `students` 一表。再核對 journal 完整序號與處理結果。
2. 不信任被還原的 `auth_sessions`。在維持流量封鎖時撤銷全部舊 sessions，清除／失效化 `password_reset_tokens`、`email_verification_tokens` 與仍可接受的 `workspace_invitations`，避免 used／revoked 狀態倒退。只保存 token hash 仍會讓使用者手上的 raw token 再度有效；不靠 TTL 或每日 cron 等待失效。
3. Password hash、`email_verified_at`、user status、roles／claims 也可能回退；撤銷 session **不會阻止舊密碼重新登入**。依獨立 security journal 恢復可信的撤銷狀態；無法證明的帳號保持 disabled／登入隔離，經身分驗證後才走核准的憑證重設／Email 驗證流程。必要的復原管理員使用另行核准的安全 bootstrap，不能還原舊 owner token 當存取手段。不得擅自寄發 reset／邀請信或復活舊 membership 以便測試。
4. 核對 ledger 與 schema，對照 serving／待恢復 application 的相容性矩陣。還原點可能在 migration 之前，不能以最新 checkout 自動重放 `0002`–`0007` backfill／contract。先選相容 artifact 或審查 forward fix，遵循 [migration policy](database-migration-policy.md)。不能補 ledger 讓 deploy gate 通過。
5. 以預期變更後 manifest 驗證 FK、所有 schema objects、revision 完整性／CAS、projection counts／checksums，及 student／class purges 不可由任何 retained revision 取回。`workspace_class_assignments` 含 trigger-based tenant guard，FK check 單獨通過仍不足夠。Blob fallback 不是 schema 缺損的通用復原方案。
6. 在受控 synthetic 帳號上測試 session／CSRF／Origin、越權與跨租戶、teacher／viewer 範圍、archived 唯讀、舊 token 重放、新資料寫入與 revision conflict。Email／cron 持續關閉；需驗證寄信時先另核准 test sink／收件控制。既有 health handler 不查 D1，anonymous 401 也不能證明 DB binding／schema 正確。
7. 復原會使 revision 值與瀏覽器已讀狀態倒退；要求重新驗證、重新載入最新雲端狀態並人工處理未同步草稿。不要把舊分頁／sessionStorage 草稿或中斷重試直接重播。只對已核對授權、去重 operation ID 與 revision 條件的合法遺失寫入做 reviewed recovery；刪除／安全撤銷優先，不以重播恢復已撤銷權限。
8. Operator 與獨立核對者確認沒有殘留敏感副本／auth resurrection、journal 全數完成、相容 application 和資料可用後，才另行核准解除維護隔離；逐步監看 D1 errors、權限、Email 與 cron。記錄重開時間、必要通知、lost writes／不可重播項目及最後 bookmark。驗收失敗保持隔離並評估 forward fix 或已記錄的 undo；不自動還原 production。

## 正式事件的未來核准清單

正式事故先由 incident owner 確認範圍與持續損壞，保留受限證據並停止所有相關 writers（含 API、auth、cron、外部 jobs 與部署）。**本文件沒有授權現在操作 production**；以下須成為每次可審查的事件變更單。

- [ ] 記錄事件、操作者、核准者、隱私窗口、account／DB UUID、租戶影響、損壞／發現時間、選定 bookmark／backup 與可信理由；資料遺失範圍和其他租戶寫入取捨由責任人核准。
- [ ] 確認實際 Free／Paid、backend、可用歷史及 token scopes；復原點仍有效。明確選擇「同 DB Time Travel」或「隔離的新正式 recovery DB SQL import」，不可指向一般 staging。
- [ ] 驗證維護隔離真的封鎖 auth／所有 writers／Email／cron；記錄停止前最後寫入與復原前 bookmark。保存可用的受控證據／備份，考量 export 的服務阻塞，不為備份擅自修改 schema。
- [ ] 備份／manifest hash、schema／ledger、synthetic rehearsal、獨立 journal、auth scrub 腳本與操作 rollback／forward fix 已審查；有明確停止條件。若須使用新 recovery DB，另核准其正式資料存取、隔離、binding cutover 與保存／銷毀，不能沿用 synthetic 演練授權。
- [ ] 清理與所有資料／權限驗收通過，選定的 Worker artifact 相容；必要通知、草稿處理與合法寫入重建已有責任人。最後核准才恢復流量與有副作用的服務。
- [ ] 結案記錄實際 RPO／RTO、各階段時間、遺失／恢復操作數、journal 完整性、失敗與例外、最終版本／bookmark 及後續補救。僅保存 aggregate 證據；不將 raw SQL、PII、password hashes 或 token 內容放工單。

## 本機驗證、紀錄與未完成事項

本機 Miniflare 的 isolated D1 可驗證 synthetic schema／snapshot round-trip、repository invariants、刪除重套與 auth scrub；它使用不同的本機 state，**不能驗證 Cloudflare Time Travel、帳號方案／retention、live export／import、IAM 或實際復原時間**。本機計時標為 local execution time，不填入 production RTO 欄。

```powershell
npm run test:recovery
npm run db:drill:local
```

`test:recovery` 執行 recovery validator 與本機演練的回歸；`db:drill:local` 執行 `scripts/disaster-recovery.ts`，僅建立兩個新的 ephemeral Miniflare D1，透過 Wrangler 本機使用的 `PRAGMA miniflare_d1_export` 產生 SQL、匯入空白目的 DB 並驗證。它不接受 DB target、URL、config 或 remote flags，不讀 remote credentials；它不是 `wrangler d1 export --remote` 實測，沒有量測 Time Travel／RPO／RTO。

重複遠端演練時可用同一個固定合成 fixture，不需手工建立或複製正式資料。在 repository root 執行下列程式化匯出；它仍會跑完本機還原檢查，沒有接受現有 DB 或外部資料的參數。命令失敗時不得使用已產生的部分輸出；每次另建空白目錄，將 SQL 當敏感測試產物保存在受控位置，不提交 Git。

```javascript
// node --import tsx --input-type=module (stdin)，或核准的本機操作檔
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runSyntheticD1RecoveryDrill } from './scripts/disaster-recovery.ts';
const directory = join('.wrangler', `dr-fixture-${crypto.randomUUID()}`);
await mkdir(directory, { recursive: true });
await runSyntheticD1RecoveryDrill(async ({ sql, expectedMigrations, expectedSchema }) => {
  await writeFile(join(directory, 'baseline.sql'), sql, { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'trusted-schema.json'),
    JSON.stringify({ expectedMigrations, expectedSchema }), { flag: 'wx', mode: 0o600 });
});
console.log(directory); // 只輸出路徑，勿印 SQL／fixtures
```

本機演練的 pre-import guard 與大型 synthetic export 回歸必須證明：合法大型 snapshot 的 dump 若有超限 statement，會在任何目的 DB 寫入前阻擋，並保留原 application 容量。新增檢查的實際結果依該次執行紀錄另記，此文件不提前記為通過；小型 fixture 成功不能延伸為大型資料可還原。

`worker/recoveryValidation.ts` 的 `validateD1Recovery` 要求 caller 提供受信的 `expectedMigrations`；`expectedSchema` 必須來自另一個以可信 migrations 建立的 pristine DB，包含預期 table／index／trigger definitions，不能從待驗證的候選 DB 自己產生。缺少 schema 證據不能得到 `structurally_valid`；ledger 的正數 ID 嚴格遞增即可，允許缺號，migration filenames 仍須符合預期順序。底層使用 `PRAGMA quick_check(1)` 與 FK／語意檢查，沒有宣稱完成完整 `integrity_check`。

Validator 只回報 `status: structurally_valid | blocked`、`privacyStatus: not_verified`、`checkedWorkspaces`、`legacyUnclaimedWorkspaces`、`truncated` 與 `issues: [{ code, count }]`。它檢查可見結構／資料關係與 projection，不會判定 production ready，也無法證明選點後的刪除已重套；`truncated` 或任一 issue 都不能當作驗收通過。`inspectWorkspaceProjection` 只比較重建內容，完整 validator 另核對冗餘父紀錄及索引 scalar；不要單獨把 helper 或會寫 status 的 reconcile 當成完整驗收。驗證需要 quiescent／隔離狀態；不是 live DB 跨多查詢的一致性快照。未接任何 public endpoint 或通用 remote CLI；維護 adapter 應依平台 query／CPU 限額分段，不宣稱單次 Worker invocation 能掃完整 DB。

超過現行 current-workspace schema／容量的舊資料會回 `blocked`，保持原件及備份，再進行有授權的離線盤點與相容修復；不自動 normalize／clamp／丟棄。歷史則檢查既有 privacy purge 所需的容器形狀，保留無關的舊 scalars、null optional fields 與擴充欄位，不強套目前 warningPoints 等新範圍。

每次演練的可分享報告只記 synthetic run ID、模式（local／remote SQL／remote Time Travel）、commit／工具版本、時間戳與分段耗時、fixture 版本／hash、aggregate counts／digests、baseline／post-restore／post-scrub 驗證、刻意遺失寫入數、撤回測試結果、執行者／核准引用、通過／失敗／未測項。不保存 SQL／原始資料、Email、密碼 hash、raw tokens、cookie、秘密值或未消毒 provider error。

| 項目 | 目前已知／尚未驗證 | 完成證據 |
| --- | --- | --- |
| 本機資料／restore 驗證 | 依該次自動測試與 local drill 報告另記；不預填成功 | 實際命令、commit、結果與無敏感資訊的 report |
| Remote staging／DR DB | 已建立並演練下列兩個專用 DR DB；既有 staging application 尚未啟用 | 本節實際 UUID、空庫檢查、provider 結果；不擴大為其他資源的驗收 |
| Production 方案／backend／history | 本次未查 provider，retention 與可用 bookmark 未知 | 日期化 provider metadata；Free 7 天／Paid 30 天的實際適用確認 |
| Token IAM／ambient context | 本次未讀／變更 secrets，無 live scope 驗證 | Provider policy metadata、獨立 context／target 核對 |
| Cloudflare authentication | 2026-10-30 OAuth 已登入、指定 account 相符、具 `d1:write`；未改 Secret／token policy | 本次使用人員 OAuth、權限較廣；日後排程須另設最小 scope／獨立 account，不宣稱 DB 級 IAM 已驗證 |
| 外部備份與保存 | 未建立排程、加密儲存、金鑰管理、存取稽核、到期銷毀或失敗警示 | 核准政策、設定與成功備份／還原／到期銷毀紀錄 |
| 獨立 suppression journal | 尚未建置正式系統／連續性監測 | 核准設計、保留期、完整性／重套測試與事件接收證據 |
| Production 隔離與 auth scrub | 尚無 live 維護隔離、可審查正式清理操作及帳號重設流程驗收 | 演練過的封鎖／重開程序、scrub 範圍與獨立 review |
| SQL round-trip／triggers／FK／大整數 | 小型遠端合成 SQL 往返、23 表及 schema／ledger 精確比對已通過；正式 drift、超大整數與完整容量未驗證 | 本節結果；超出 53-bit 數值與大 row 不能據此認定安全 |
| 大型 row／SQL dump 容量 | Application 900 KiB 上限不等於 SQL dump 可還原；單 statement 100,000 bytes 護欄與新增回歸結果另記，完整容量 fallback 未證實 | 任何目的寫入前拒絕超限；另行審查並驗證大型 row 的 Time Travel 或 parameterized／chunk import 路徑 |
| Time Travel／undo | 專用 source 的 bookmark restore、previous-bookmark undo、再次回基準已實測 | 僅小型 synthetic source；正式負載、停寫／重開、scrub 仍須完整演練 |
| RPO／RTO 與責任人 | 上述值全為未核准且未量測提案 | 簽核人／日期、成功計時 remote 演練及適用資料量 |

本文件及離線工具不會自動建立以上能力；所有「未驗證」在相應證據補齊前維持未驗證。

## 2026-10-30 實際演練證據

執行環境：Node 24.13.0、Wrangler 4.115.0、Miniflare 4.20260722.1；使用者指定 account（末六碼 `6007de`），沒有查詢 Production D1。專用設定檔沒有 Worker entry point、routes、assets、cron、正式 binding 或 mail／Turnstile Secrets；每次 child process 清除 ambient Cloudflare／Wrangler overrides、固定 account／UUID 並指定空 env-file。沒有發布 Worker。

| 角色 | 新建資源名稱 | UUID |
| --- | --- | --- |
| Synthetic source | `epet-dr-source-20261030-fc2c0986` | `75e9e6cd-7d20-4f92-b642-eec1bab873fd` |
| Synthetic target | `epet-dr-target-20261030-fc2c0986` | `dc79cafa-da74-4dd6-9969-ceaeabf565b5` |

兩者建立後先查 application table count＝0。Source 匯入固定合成 fixture，包含 2 個 workspace、不同角色與班級、跨班重複 Student ID、封存 metadata、教學紀錄、retained revisions、hashed auth tokens 與 7 筆 migration ledger；不是正式資料的去識別副本。

- 本機 `npm run test:recovery`：**19/19 通過、0 fail/skip**；涵蓋精確 schema、ledger 順序／default／unique、quick-check／FK、所有 projection／scalar、歴史可清理形狀、legacy scalars、ownership／scope、只讀、truncation、去敏錯誤、SQL byte guard、完整還原及 privacy／auth replay。新 fixture 匯出 callback 另由相同整合測試驗證，不能修改 drill 內部 trusted schema。
- `npm run verify`：**exit 0，697/697（94 legacy rules＋603 Node cases）、0 fail/skip**；包含 migration checksum、TypeScript、所有 API／D1／隱私／安全 suites、build／analytics boundary 與 Worker dry-run。最終 `npm run lint`、4 個 fixture／容量／CLI 測試及 `npm run db:drill:local` 另通過；Sentry optional Node built-in warnings 保留，沒有為此改 compatibility flags。68 個變更 source/test/config 檔與驗證副本 SHA-256 相符；既有 lockfile、migrations、projection write SQL、Wrangler config 及部署 workflows 沒有本次變更。
- 遠端 baseline bookmark：`00000002-00000002-00005114-1a0be16d4222fecaa1e3f1cb386644c5`。刻意新增一筆帶 revision 的合成變更，舊 revision 更新 `changes=0`。還原 bookmark 後該變更不存在；以回傳 `previous_bookmark` undo 後變更重新出現；最後再還原 baseline。三次 restore 均成功，不用 timestamp 推定零損失。
- 遠端 source export → 原本空白的 target import → target export 成功；target `quick_check(1)=ok`、FK violations＝0、migrations＝7、workspace＝2。固定小型 fixture 匯出 54,334 bytes，本機最大 statement 2,185 bytes；遠端匯入前另確認整檔小於 100,000 bytes，沒有裁切資料。
- 三份 SQL（原始本機 baseline、Time Travel 後遠端 source、SQL restore 後遠端 target）各匯入新的本機隔離 D1。使用獨立 pristine schema／migration 基準的 readonly validator，皆 `structurally_valid`、2 workspaces、0 issues／truncation；**23 個 application tables 的全部 rows／schema／ledger 精確相同**。此步是對 remote exports 的本機驗證，不冒充在遠端 Worker 執行了完整 validator。
- 相同 canonical manifest SHA-256：`6e6c82e5e0322f4dc56c7df8c2f59ad6df35c91e9ceb1875f27908620404ed64`。三份均保留 `privacyStatus:not_verified`：舊 Alice／舊權限仍是 restore point 的內容，必須補償後才能重開。
- 刪除、匿名化、空班刪除、同 ID 的 Bob／另一租戶不變、history scrub、重複 replay、舊密碼／Session／reset／invitation token 拒絕與合法限 A 班 Teacher，已在實際本機 D1 演練驗證；**尚未在這兩個 remote DB 執行完整 journal／auth scrub 或部署登入驗收**。正式 independent journal 仍未建立。

一次 CLI import 成功後，runner 因進度訊息前綴而無法直接 JSON.parse；先重新唯讀核對 source 已有 2 workspaces／7 migrations、target 仍空白，再接續，沒有重播歷史 SQL。另一次 export 的 `--yes` 被 CLI 在執行前拒絕，改用該版本支援的 `--skip-confirmation` 後成功；不是平台 restore 失敗，亦未降低資料／驗收條件。

兩個合成 DB 目前保留供覆核，未綁定 application；不當正式備份或長期 staging。覆核後由 operator 依上述名稱／UUID、account 與沒有被綁定的事實核對再刪除，不能以 prefix 模糊刪除其他 DB。此為尚未執行的清理步驟，沒有設定自動刪除或保留期限。可分享證據只留 aggregate report／schema／digest，合成 SQL 也不提交 Git。

**H06／V04 保持 Open（已有本機與小型遠端證據）。** Formal RPO／RTO、完整容量／大 row fallback、獨立備份排程與加密保存、journal、正式隔離／scrub、值班與營運簽核仍需完成。這次 provider 操作耗時只是小型合成階段時間，不是正式 RTO 或可對客戶承諾的 RPO。

驗證及 remote aggregate evidence 保存在 Codex Security standalone `artifacts/disaster-recovery-2026-10-30/`。完整 verify log SHA-256：`033652e5ca7aeac376b38679b019f72de9f9b0579510d61d5411ec55498edc28`。原始合成 SQL 不提交 Git，也沒有保存任何真實學生資料。
