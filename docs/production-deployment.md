# Production application deployment

更新日期：2026-11-05。適用於 GitHub Actions 的 `deploy.yml`、既有 `epet-api` Worker 與同次發布的 static assets。2026-10-31 的流程修改僅使用 mock／本機驗證；本次新增既有失敗 run 的唯讀診斷及操作計畫。正式操作需另外取得授權，實際命令與結果以各自的 workflow runs 為準，不能把文件中的操作步驟視為已執行。

## 2026-11-05：PR #21 合併後的 schema gate 阻擋

已從 GitHub 唯讀核對：[#21](https://github.com/andreww0421/epet/pull/21) 已於 2026-11-04 合併為 `47e07ce62f88cf0bf12cd106c4301ad61d5cdb1a`。其 PR 及合併後 main 的 Functional CI／Security 均成功；這不是 push 或功能測試失敗。[Production deployment run](https://github.com/andreww0421/epet/actions/runs/41817942605) 在 `Verify required D1 migrations are already applied` 失敗，明確回報 pending `0008_product_onboarding.sql`，`deploy` 與 `smoke` steps 均為 skipped。

這是必要的發布前阻擋。不得刪除 ledger gate、將 pending 改成 warning、修改 migration checksum、手動偽造 ledger，或把 schema apply 加進一般 application deploy。該 run 沒有執行 Worker 部署；它不能證明 Cloudflare 原生 Builds 或其他發布來源的 serving 狀態。

### 正式操作計畫與授權紀錄

計畫建立後，使用者已於 2026-11-05 明確授權透過既有 workflows 套用 `0008`，核對 ledger 成功後再部署，不啟用分析、不改 Secrets、不建立學生資料。已啟動 [expansion run 41875580999](https://github.com/andreww0421/epet/actions/runs/41875580999)，固定 main `47e07ce62f88cf0bf12cd106c4301ad61d5cdb1a`。是否完成 expansion、後續部署及 smoke，須讀取實際 runs 的最終結論，不能以 dispatch 成功代替操作完成。

這次唯讀核對 `production` Environment 的 `protection_rules` 為空、`deployment_branch_policy` 為 null，尚未建立 Required Reviewers／Environment 分支政策。H05／V01 維持 Open；本次以使用者明確授權執行既有 main job guard、migration gate 及 concurrency，沒有新增、移除或宣稱已完成外部權限保護。

1. Release owner 核對實際 serving Worker version、可回復的相容版本、Production D1 identity 與平台復原 bookmark／保留狀態。只記錄資源與版本 metadata，不下載或複製正式學生資料。確認 production Environment 的獨立 reviewer、main branch policy 與既有 `cloudflare-production` concurrency 均適用；先排除其他發布者同時修改 schema／serving version。
2. 核對 `migrations/0008_product_onboarding.sql` 與 `migrations/policy.json` 的 LF-normalized SHA-256：`b235b0393b6446ce67bca5e72d428d34a0487e560cf5ea1f69ab10dcbf1bef83`。它只新增 optional `auth_product_onboarding` 表及非 unique cohort index；不 backfill 現有會員、不修改學生／班級／歷史資料。Production 分析旗標維持關閉。採用與 serving 版本相容性、合成 D1／auth／privacy／CAS 測試證據，不能因為是新增表就略過審查。
3. 取得明確的 Production schema 變更授權後，在 GitHub **Actions → Expand production D1 schema → Run workflow → Branch: main** 執行既有 `database-expand.yml`。它會重新安裝 locked dependencies、跑 verify、僅套用已審查的 pending expansions，並再核對 ledger。預期本次只有 `0008`；若出現其他 pending、未知或 ledger gap，停止並重新審查。不要改跑 raw SQL、重播 `0001`–`0007`，也不要向 business DB 套用 `analytics-migrations/0001_product_analytics.sql`。
4. Expansion 成功後核對 ledger、既有 serving version 與核准的唯讀 health／security 檢查。紀錄實際 workflow run 與結果；不得以匿名 health 成功推論 authenticated D1／tenant 路徑已完整驗收。
5. 另外取得 application release 授權及 Environment approval 後，在 **Actions → Deploy to Cloudflare Worker → Run workflow → Branch: main** 執行 `deploy.yml`，或明確核准重跑上述失敗 run。前者發布當時的 main，後者重跑原 commit；必須在操作前記錄及核准確切 commit，不可混稱。核對 preflight、ledger、deploy 與唯讀 smoke 全部結果，再核對實際 serving version。不要透過新的 main push 只為繞過這個阻擋。

### 中止與回復

- Expansion 前失敗：保持原 schema／Worker，修正 prerequisite；不重跑 application deploy 直到 ledger 已驗證。
- Expansion 部分失敗或 ledger 未完成：停止部署、保留已產生的 additive schema，依既有 migration policy 查證；不刪表、不直接補 ledger、不自動 Time Travel。
- Expansion 成功但 application 失敗：保留 additive 表及關閉的分析旗標，依核准計畫維持／回復相容 Worker；不對 D1 做 schema rollback。若復原資料庫確有必要，另走已核准的 DR／個資刪除 replay 程序。

此計畫與授權紀錄不代表正式部署成功。外部 schema 與 application release 的證據須以授權後實際 runs 的最終結果核對，不能把本機程式測試標示成正式部署已恢復。部署後狀態及 serving version 亦須另外核對，不能僅從這份文件推論。

## 發布流程與不變條件

`main` push 或選擇 `main` 的 `workflow_dispatch` 可進入 application workflow。Job 保留 `production` environment、`contents: read` 與 `cloudflare-production` concurrency group；不取消進行中的正式發布，並與獨立的 `database-expand.yml` 序列化。

發布順序如下；任一步驟失敗，不執行後續發布步驟：

1. Checkout 同一個 immutable commit，停用 checkout credential persistence，使用既有 SHA-pinned Actions 與 Node 24。
2. `npm ci` 安裝 lockfile 指定的 dependencies。
3. `npm run verify`：migration checksum／分類、TypeScript、所有納入 `npm test` 的單元／API／D1／安全測試、production build／analytics boundary，以及 Worker dry-run。這裡只執行離線測試，不把正式 URL 提供給會寫資料的本機 E2E suites。
4. 驗證 Cloudflare authentication，執行 `npm run db:check:remote` **唯讀**核對 migration ledger。缺少、未知、不完整或無法查證的 ledger 必須阻止發布，不補寫 ledger 或在此 job 自動套用 schema。
5. `npm run deploy:worker` 發布同次 build 的 Worker 與 assets。
6. `npm run smoke:production` 執行下述無帳號、唯讀檢查。失敗使 workflow 保持 failure；它是發布後偵測，不能阻止已發布版本繼續 serving。

一般 PR 的 Functional CI／Security workflows 繼續獨立執行。Functional CI 包含本機 synthetic E2E、Accessibility 與容量 suites；production job 的 `npm run verify` 不等同完整 browser matrix。管理員必須把 `PR required checks` 及既有安全檢查設為 merge gates，不能假設部署 job 等待了其他獨立 workflow。

Schema release 維持 [database migration policy](database-migration-policy.md)：先獨立核准相容 expansion，再 application deploy；backfill／contract 是另外的受控作業。Application rollback 不包含 D1 rollback。這次不增加 migration、runtime flags 或 Secret 名稱。

## Production 唯讀 smoke 契約

指令只使用 checked-in production config 所對應的既有 HTTPS Worker origin，拒絕任意 URL／CLI override。Workflow 的 smoke step 不注入 Cloudflare token、應用 Secret、會員 cookie 或 synthetic login credential。它不登入、不建立帳號／學生、不提交表單、不執行 mutation API，也不呼叫 D1 CLI。

| 檢查 | 成功條件／安全邊界 |
| --- | --- |
| 首頁 | GET `/` 為 200、HTML MIME、預期 app shell，沒有 redirect；資源引用符合這次本機 build。 |
| 入口 static assets | 只讀取這次 `dist/index.html` 指向的同源 fingerprinted JS／CSS；驗 200、正確 MIME、內容與本機 build 相符。禁止以遠端文件提供的外站或任意路徑作為請求目標。 |
| Health | GET `/api/v1/health` 為 200、JSON、`ok:true`、`service:epet-api`、`version:1`，並核對現有 auth／registration／email／bot configuration 契約。 |
| 未登入保護 | GET `/api/v1/auth/session`、`/api/v1/state`、`/api/v1/workspaces` 均為預期的 401；不保存或列印這些 response bodies。意外 200、redirect 或 5xx 都不能當作正常拒絕。 |
| Security headers | 檢查既有文件 CSP／HSTS／nosniff、API 的 no-store 與共用安全 headers，以及 assets-first 路徑適用的 `_headers` policy；不為讓 smoke 通過而減少保護。 |
| 資源與錯誤 | 有界 request／整體時間、回應大小與重試；禁止 redirect、cookie／Authorization 傳遞及不受控網路目標。只輸出固定檢查代碼與摘要，不列印遠端 HTML／JSON、cookie、token 或原始 provider error。 |

目前 script 契約：每個 request 最多 10 秒，整次 smoke 最多 90 秒；HTML 最多 256 KiB、health JSON 最多 16 KiB，每個 asset 最多 8 MiB，最多 16 個入口 JS／CSS／modulepreload assets、總計最多 32 MiB。它以 `credentials: omit`／manual redirect 送出 GET，遇到任何 3xx 即失敗。

每項請求最多 3 次嘗試；只有網路錯誤、408、429、500、502、503、504 可重試，退避 1／2 秒。有效 `Retry-After` 不得提早重送；所需等待超過剩餘整體預算就失敗，而非縮短等待。其他錯誤狀態、內容／digest／安全 headers 不符直接失敗，不能藉重試把明確失敗轉成不斷等待。這是唯讀部署探測的有限重試，沒有重送 application writes。

正式 `BOT_PROTECTION_REQUIRED` 目前在 repository config 為 `false`，smoke 不會擅自把它改成 `true`。Health 的 `botProtectionEnabled` 表示 verifier 設定能力，並非 mandatory flag；mandatory 關閉時允許能力為 true 或 false，開啟時必須有能力與公開 site key，但不把它當作真實 Siteverify 成功證據。公開註冊持續關閉；任何 flags／provider 切換仍依 [account security cutover](p1-account-security-cutover.md) 獨立核准。

`server/routes/systemRoutes.ts` 的 health handler 不查 D1。沒有 cookie 的 401 可在 repository 查詢前產生，因此 health＋anonymous smoke **不能證明**正式 D1 binding、schema、authenticated RBAC／tenant isolation、登入、寄信、cron 或 Turnstile 可用。Assets 比對可發現靜態檔錯版，但不證明 serving Worker code 的 commit identity；仍須核對 Cloudflare 部署 version 與 CI commit。不得為擴大 smoke 覆蓋而對 Production 進行正式資料寫入。

本機測試使用 injected transport／合成回應驗證正常與錯誤路徑；不把完整本機 E2E 的 base URL 換成 Production。`npm run smoke:production` 會讀取正式公開入口，不是離線測試指令。收尾曾因 mock preload 順序錯誤意外讀取一次正式首頁，並未完成 live smoke；修正與範圍見下方紀錄。

## 失敗通知與值班接手

Workflow 對失敗提供 error annotation、step outcomes 及 GitHub job summary，附 run／logs 與本 Runbook。摘要區分發布前阻擋、已嘗試發布但結果不明，以及發布成功後 smoke 失敗；不把 failure 改為 success，也不使用 `continue-on-error` 掩蓋問題。Runner 被強制終止、job timeout 或取消時，最後的摘要步驟可能無法執行；Actions 的最終狀態仍須納入人工監看。

這些 annotation／summary 是可讀證據，**不是通知已送達值班人**。管理員需指定 primary／backup owner，記錄接手與升級方式：

1. 值班者在 GitHub **Settings → Notifications → System → Actions** 選擇 On GitHub／Email，依政策選 Only notify for failed workflows 並儲存；確認 repository watching 設定及收件信箱可用。實際選項以 [GitHub Actions notification settings](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications) 為準。
2. GitHub 說明原生通知涵蓋使用者自己觸發的 workflow，不能推定其他人、merge bot 或所有 deployment 都會通知同一位值班者，見 [workflow notification scope](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)。若需要集中值班通知，由管理員另外核准既有 GitHub integration／受控服務的訂閱與事件範圍；本次沒有新增 webhook Secret、外部訊息或通知權限。
3. 在 mock CI／已隔離的 staging 進行一次故意失敗的 smoke，包含另一位操作者或 bot 的觸發情境，核對 primary 與 backup 收到失敗狀態、run link，且確實能接手。保留不含秘密的 receipt 時間／結果；不能用 mock summary 測試取代實際送達驗收。
4. 通知尚未通過演練前，發布窗口安排指定人員持續觀看 Actions 與 Cloudflare serving 狀態，不宣稱無人值守發布或已建立全天候告警。

## 失敗、重跑與人工回復

所有正式操作均須有 incident／release owner 的明確核准。此文件不授權立即部署、修改 production settings 或還原資料庫。

| 失敗位置 | 必須先確認 | 後續處理 |
| --- | --- | --- |
| `npm ci`／verify／preflight／ledger | deploy step 未執行；另查其他發布者是否改變 serving version | 修正 PR、完成既有驗證；migration 缺口依獨立 expansion policy 解決。不要為繞過失敗直接 publish。 |
| Deploy 失敗／timeout／取消 | Cloudflare 是否已接收 upload 或切換 serving version，包含 assets／bindings／其他並行發佈者 | 保留 logs 與實際版本；不能由 CLI 非零或 timeout 推定「完全沒部署」。先 review 狀態再決定 forward fix／明確核准的相容 rollback。 |
| Deploy 成功、smoke 失敗 | 目前實際 serving version、影響範圍、錯誤類型、是否為有限傳播／網路問題 | 失敗版本可能仍服務。不要直接 rerun 整個 workflow，避免再次 publish；先只在核准下重跑有界唯讀 smoke 或選擇下述回復。 |
| Smoke 通過後才發現功能問題 | Authenticated D1／權限／寄信／資料相容性及監控 | Smoke 不取代功能驗收；按事故流程停住後續發布並處理，不能因綠燈忽略問題。 |

人工回復程序：

1. 指派 incident owner，暫停尚未核准的 application／database release 與其他發布來源；必要的停寫／維護隔離按已核准事故程序執行。本次 workflow 不自動更改 flags、Secrets 或切斷服務。
2. 記錄 run URL、commit、時間、操作者、實際 Worker／deployment version、assets 與 binding、ledger 檢查結果、前一個已驗收版本及影響。只保存 aggregate error／check codes，不附正式學生資料、cookie 或 Secret。
3. 選擇 reviewed forward fix，或核准一個**明確的既有 Worker version**。先證明它仍相容目前 schema、現有資料語意、bindings 與 auth/security 修補；若回退會重開已修補安全問題，先評估隔離與 forward fix。無可用相容版本時停止 rollback，不能嘗試 D1 清空、舊 dump 覆蓋或補 ledger。
4. 經獨立核准後，操作者於 Cloudflare **Workers & Pages → epet-api → Deployments** 核對 account／Worker／精確 version，再使用該 version 的 Rollback。這會立即切換服務；本次未執行。依 [Cloudflare rollback limitations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)，connected resources／data 不隨 code 回復，且 resource／binding 或資料結構變動可能使舊版本不相容／無法回復。
5. 使用與選定回復版本相同的可信 checkout、lockfile 與 build settings 建立 smoke 的本機預期檔案，重新核對 version／bindings 並執行有界唯讀 smoke。不能以最新版的 assets manifest 判斷舊版 rollback。復原成功後持續觀察 5xx／D1／安全事件，記錄 recovery 與後續補修。
6. Schema 問題維持 reviewed forward migration；資料毀損另開 [disaster recovery](disaster-recovery.md) 事件，先隔離、核准還原點與 privacy/security replay。**不把 D1 Time Travel、SQL restore、schema rollback 或刪除資料放入部署失敗的自動處理。**

## 外部設定與發布檢查清單

以下均為管理員／operator 需實際核對的設定，本次沒有透過後台變更或重新驗證生效狀態：

- [ ] GitHub Ruleset／Branch protection 真正涵蓋 `main`，禁止一般協作者直接 push，要求 PR review 與 required checks；檢查 bypass 對象與 emergency audit trail。既有 `PR required checks`、CodeQL、Dependency review、npm audit 等 check 名稱以實際 PR context 為準，不因新增 smoke 刪除或降低條件。
- [ ] GitHub **Settings → Environments → production** 已有 required reviewers、Prevent self-review、停用不必要的 administrator bypass，Deployment branches 僅允許受保護的 `main` branch；核對實際 plan 支援。YAML 的 `environment: production` 不會自動建立上述保護。先前 2026-10-28 的觀察尚未有完整保護，不能當作本次已修復。
- [ ] CI token 只持有既有 Worker 發布與 ledger 唯讀查核所需的最小權限；D1 expansion 依獨立權限／流程核准。Production／staging environment secrets、provider keys、Worker 與 DB binding 獨立且有記錄，不讀出或比較 Secret 值。
- [ ] 使用者已確認 Cloudflare 原生 Workers Builds 僅 `main` 可發布、PR／其他分支不能操作正式 Worker／D1；但這不證明它遵循 GitHub environment approval 或本次 smoke。管理員盤點其他 publisher／deploy hook，核准單一正式發布來源，或為保留的原生 Builds 建立等效 verify／approval／smoke／序列化與紀錄。只修改 GitHub YAML 無法阻止另一條部署路徑繞過 gates；本次沒有停用 Builds 或變更部署權限。
- [ ] 核對 release commit、目前版本、可回復的相容版本、已套用 ledger、build monitoring settings；無 schema 變更仍要保留 ledger gate。不得在一般 PR 暴露 Production Secrets。
- [ ] 真正的 `epet-staging` Worker／D1／provider 隔離及 GitHub staging environment 已驗收後，先在 staging 驗證發布、smoke failure／通知接手與手動相容回復。2026-10-30 的兩個 DR-only synthetic DB 沒有 application binding，不能當作 staging application 已啟用。
- [ ] 記錄 mock／本機 tests 的命令、commit、pass／fail／skip，分開記錄首次 staging 與 Production live smoke、通知 receipt 及回復演練；尚未執行的欄位保留未驗證。
- [ ] 正式發布取得授權後才執行，smoke 不建立正式測試帳號或學生、不寫入正式資料；觀察 smoke／serving version 後由 release owner 決定結案。

## 本次驗收紀錄

新增 27 項部署回歸已通過：9 項 workflow contract／實際 failure-summary shell tests，18 項 mock／實際本機 Worker／HTTP transport tests。涵蓋 GET-only／憑證隔離、阻擋 redirect／任意路徑、build assets manifest／digest、health 契約與能力 flags、401 body 不讀取、terminal errors／有限退避／Retry-After、回應上限、真實 abort events 與本機 gzip 解壓。壓縮回應保留 encoded wire size guard，另對 decoded stream 執行原本上限及 hash 檢查，沒有放寬 decoded 限制。

開發期曾修正測試的 verify 階段計數、合成 mailer 設定與 literal shell block 抽取；既有 Windows junction 測試在 sandbox 的 EPERM 以隔離副本核准執行處理，沒有刪測試、skip 或改低安全條件。唯讀複核提出的小檔 gzip Content-Length 邊界已修正並補回歸；複核者未完成的 loopback probe 不列作通過證據。

| 實際命令／驗證 | 結果 |
| --- | --- |
| 隔離副本 `npm ci` | exit 0，沿用 lockfile，無 dependency 變更。 |
| `npm run verify` | exit 0；**724 pass（94 legacy rules＋630 Node cases）、0 fail/skip**；包含新 27 項部署測試、TypeScript、所有既有 API／D1／隱私回歸、build、analytics boundary 與 Worker dry-run。 |
| 最終 `npm run test:deployment` | **27 pass／0 fail/skip**；完整 verify 後強化同一 CLI 測試，加入獨立 preload、有效 CLI 子程序及固定合成 route map，另修 Windows `--import` 的 file URL 格式後重跑通過。應用與 smoke runtime 未因該 test 強化再改動。 |
| 實際 build＋本機 Worker 的 mock CLI | exit 0；5 assets、10 mocked GET、0 retry，首頁／asset bytes／health／401／headers 通過。Bootstrap 在動態 import 前先封鎖 fetch，之後只允許 in-process Worker transport；任何 DB access／background work 都會拋錯。 |
| `npm run check:worker:staging` | exit 0；既有 dummy UUID／inert URL dry-run，沒有建立或部署遠端 staging。 |
| 既有 Playwright bundled parser 的 YAML 1.2 syntax check | `deploy.yml`、`staging.yml`、`database-expand.yml` 共 3 份通過、0 parse error；不宣稱等同在 GitHub runner 已執行 workflow。 |

完整 verify log SHA-256：`795ee5da30d9bf2df268127c1bb4e4a82f7ebbb6b62e9bd1d2ee59c8eedd51e8`。完整驗收及剩餘 gates 見 [稽核增量紀錄](commercial-readiness-audit.md#14-production-cicd-增量驗收2026-10-31)。測試範圍有重疊，不將 suite 重跑累加成額外通過數。既有 Sentry optional Node built-in 及 SQLite experimental warnings 保留，未因此更改 compatibility flags 或驗證門檻。

**收尾誤觸紀錄：** 第一版臨時 bootstrap 為了讀取 build helper 而 import CLI module；當 `argv` 指向同一 module 時，CLI 在 mock 安裝前就執行。正式首頁收到一次無憑證 GET，因 `ASSET_MANIFEST_MISMATCH` 立即停止，未發送 asset／API 請求、讀寫 D1、建立帳號／學生或部署。這次失敗保留為 harness 證據，不能記為正式 smoke 通過。已改為先封鎖 fetch、bootstrap 不 import CLI，再由 entrypoint 執行；永久 regression 也以不 import CLI 的 preload 在獨立合成目錄啟動真 CLI，確認 7 次 request 全被 mock 接收。修正後的實際 build mock 結果才列入上表。

沒有執行 Production deployment、完整 live smoke、通知送達或 rollback 演練。外部環境保護、Cloudflare 原生 Builds gates、token IAM 及 staging application 啟用狀態保持未驗證；不可將僅通過程式測試的項目標示為正式營運 Closed。
