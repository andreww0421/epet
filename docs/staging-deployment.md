# Staging deployment

基線盤點日期：2026-10-28；CI/CD 增量更新：2026-10-31。Repository 已有 staging configuration、guard、workflow 與 smoke tests；使用者先前確認 `epet-staging` Worker／D1 尚未建立。2026-10-28 的 CLI 隔離修補沒有建立資源、讀取或填入真實 secret values、複製 production 資料或執行遠端 migration／deployment。下列既有服務狀態均附觀察日期，不代表目前 live isolation 已驗證；2026-10-30 的兩個 DR-only synthetic DB 沒有 application binding，不等於 staging application 已啟用。

## 環境邊界

| 項目 | Production | Staging |
| --- | --- | --- |
| GitHub branch／觸發 | `main` push／`deploy.yml` 手動執行 | `staging` push／在非 `main` branch 手動執行 `staging.yml` |
| GitHub environment | `production` | `staging` |
| Worker | **既有 `epet-api`，不改名** | `epet-staging` |
| D1 | `epet-production`，既有 ID 不變 | `epet-staging`；優先確認既有資源，必須使用不同 ID |
| Wrangler | `wrangler.jsonc`，既有設定不變 | `wrangler.staging.jsonc` template + ignored generated config |
| URL | 既有 `epet-api.jtwen12345us.workers.dev` | `epet-staging.<workers-subdomain>.workers.dev` |
| Concurrency | `cloudflare-production` | `cloudflare-staging` |
| 資料 | 真實使用者／學生資料 | 僅人工建立的 synthetic test data |

未把 production Worker 改名為 `epet-production`，因為改名會影響目前 URL、secrets、bindings 與部署歷史。新的 resource naming 已明確標示 staging；production D1 維持 `epet-production`。

採獨立 config，而不是在 production config 新增 `env.staging`：既有 production migration guard 刻意拒絕 named environments；分開檔案也避免省略 `--env` 後發布到 production。Staging 使用相同 Worker entry point、compatibility date、assets routing 與 API contracts，沒有額外的 frontend API host override。

Cloudflare 的 [bindings/environment variables 必須依 environment 設定](https://developers.cloudflare.com/workers/wrangler/environments/)，[secrets 屬於各 Worker](https://developers.cloudflare.com/workers/configuration/secrets/)。本專案用不同 Worker 與不同 config 明確定義完整 bindings；不依賴 production bindings 的 inheritance。

## 管理員設定：先盤點，再建立缺少資源

1. 在指定 Cloudflare account 盤點 `epet-staging` Worker、同名 D1、Worker 的 `DB` binding、Workers subdomain、版本與 migration ledger。若已有用途明確且僅含 synthetic data 的 staging，保留並重用；記錄 account／Worker／D1 ID 與查核日期。若名稱或資料來源不明、含既有實際資料，先停止寫入並請管理員確認，不刪除、重建或替換資源。
2. 確認 Worker 不存在後，由管理員先建立 `epet-staging`，可使用不綁定 production 資源的最小 placeholder。之後 CI 只取得這個既有 Worker 的 **Editor** 權限。依 [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/)，per-Worker scope 只能選擇已存在的 Worker；Editor 可更新與部署，但不能建立或刪除 Worker，因此不能為了首次建立而讓 CI 長期持有整個 account 的 Workers Admin。
3. 確認 D1 不存在後，再於指定 staging account 建立全新的 `epet-staging`。記錄其 UUID，與 `wrangler.jsonc` 的 production UUID 比對；兩者必須不同。不要 clone、export/import 或 restore production database，連匿名化 production student data 都不作為 staging fixture。既有 D1 若沒有 `d1_migrations`，也不能據此判定為空白：先檢查 schema 與來源；已有 application tables／資料卻沒有可信 ledger 時停止，不清空資料或重放歷史 SQL 修復。
4. 在 Cloudflare 的 Account API Tokens 建立專用 CI token：Workers scope 選 **Specified Workers → epet-staging → Editor**，加上 ledger 查詢與 migration 所需的最少 D1 權限，限定 staging 資源／account。不要授予 production Worker、Workers product 全域 Editor／Admin、zone routes 或其他不需要的資源。若 D1 權限介面只能限制到 account，不能把同 account 的不同 D1 UUID 當作 IAM 隔離；優先使用獨立 staging account，並記錄實際可存取範圍。
5. 在 GitHub **Settings → Environments** 先盤點並設定獨立 `staging` environment，新增 required reviewers、啟用 **Prevent self-review**，並關閉 administrator bypass。Deployment branches 選 **Selected branches and tags**，只新增 branch 類型的 `staging`／明確核准且受保護的測試 branches；不新增 `main`、tag 或通配全部 branches 的規則。Workflow 本身也會拒絕 `main`／tags，但非 `main` 檢查不等於 trusted branch allowlist。依 [GitHub environment 設定文件](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) 儲存保護規則後，再填入下列 environment-only variables／secrets；不要沿用 production environment 的設定，也不要讓 workflow 隱式建立一個沒有保護的 environment。
6. 建立獨立 staging Turnstile widget，只填完整的 `epet-staging.<workers-subdomain>.workers.dev` hostname，關閉 **Any Hostname**，不加入 production、父網域或 localhost。Cloudflare 的 [hostname 規則](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/) 也會允許所填 hostname 的子網域，因此應填最窄的 staging hostname。另建立獨立 Resend key，選 `sending_access` 並限制 staging 的寄件 domain，搭配該 domain 下已驗證的 staging sender。依 [Resend API key 規則](https://resend.com/docs/api-reference/api-keys/create-api-key)，domain restriction 限制的是寄件來源，不能宣稱它限制收件者。
7. 只使用管理員控制的 synthetic 帳號與測試信箱。Application 目前沒有 staging recipient filter；測試信箱／mail sink 或 provider 收件限制尚未確認前，延後會寄信的自動化。完成下方執行前 checklist 後，才從受信任 branch 執行 workflow，對已確認空白的新 D1 bootstrap，或對可信既有 ledger 套用核准的 pending migrations，再部署 staging Worker。Smoke 通過後才考慮 merge 至 `main`；staging 不會自動 promote 或觸發 production deploy。

2026-10-28 的基線保留 `production` environment、Secrets 名稱與 `deploy.yml`／`database-expand.yml`；2026-10-31 的 application workflow 增量見 [production deployment](production-deployment.md)，不更動獨立 expansion policy。Required reviewers、branch rules 與 Cloudflare token scopes 都是管理員設定，不會因新增 YAML 自動建立。

### GitHub staging variables

| Variable | 值／用途 |
| --- | --- |
| `STAGING_D1_DATABASE_ID` | 已盤點或新建的 `epet-staging` UUID；guard 拒絕 production ID（包含大小寫差異） |
| `STAGING_BASE_URL` | `https://epet-staging.<workers-subdomain>.workers.dev`；不能含 credentials/path/query/fragment |
| `STAGING_PASSWORD_RESET_FROM` | 已驗證的 staging-only email sender，例如 `Epet Staging <staging@your-test-domain>` |

### GitHub staging secrets

| Secret | 用途 |
| --- | --- |
| `STAGING_CLOUDFLARE_ACCOUNT_ID` | Staging Cloudflare account |
| `STAGING_CLOUDFLARE_API_TOKEN` | 獨立 token；只選既有 `epet-staging` Worker Editor，加上 staging 所需最少 D1 權限 |
| `STAGING_TURNSTILE_SITE_KEY` | Staging widget public site key，傳至 staging Worker |
| `STAGING_TURNSTILE_SECRET_KEY` | Staging widget verification secret |
| `STAGING_RESEND_API_KEY` | 獨立 `sending_access` key，限制 staging 寄件 domain；收件控制需另行確認 |

所有 `STAGING_` values 只放在 GitHub `staging` environment。管理員應檢查 repository／organization scope 是否有同名 secrets 或 variables，避免缺少 environment value 時 fallback 至其他 scope；檢查名稱、scope 與 provider metadata 即可，不讀出、列印或比較 secret values。不同 secret slot／`STAGING_` 名稱只證明輸入位置分開，不能證明實際 key 獨立：另核對 Cloudflare token 的資源 policy、Turnstile widget ID／hostnames，以及 Resend key ID／permission／domain 與建立紀錄，確認未重用 production credentials。

可使用獨立 Cloudflare account 增強隔離；在同帳號時，D1 token 權限可能是 account-wide，不能宣稱 YAML／resource naming 等於 IAM 隔離。對可執行 deployment 的 branches 必須有 review 與保護：branch 上的程式碼會取得 staging secrets，不要從未受信任 PR／fork 執行具 secrets 的 job。Workflow 沒有 `pull_request_target` 或 arbitrary checkout-ref input。

Worker runtime secret 名稱仍是 `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`、`RESEND_API_KEY`，不改 application contracts。Deploy script 只讀 `STAGING_` prefixed settings，把 Worker secrets 寫入受限權限的 temporary JSON，以 Wrangler 的 [deploy `--secrets-file`](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code) 同 code 一起傳送，完成／失敗後清除。Secrets 不寫入 config、stdout 或 artifacts；CI runner 必須為 ephemeral。若本機 process 被強制終止，需檢查並清除該次 `epet-staging-secrets-*` temporary directory，不分享其中內容。

## 部署流程

`staging.yml` 的 verify job 不讀 Cloudflare credentials，執行完整驗證與 staging dry-run。通過後，獨立的 `staging` environment job：

1. Build assets、安裝 Chromium。
2. 本機 preflight：所有必要 staging settings 缺失即失敗；不 fallback 至 production credentials。這只驗證輸入存在及格式，不驗證 provider credential 有效、IAM scope、widget hostname 或收件限制。
3. 讀取 staging ledger 狀態；拒絕未知／缺口 ledger。管理員確認全新空白且 synthetic-only 的 D1 才能 bootstrap frozen historical migrations；已有成功紀錄不重放。自動 guard 的「ledger 不存在」判斷不取代這項空白／來源檢查。
4. Migration 完成後再確認 ledger。
5. 確認 Cloudflare authentication、重新確認 staging ledger，再部署 `epet-staging` 與 staging-only secrets。
6. 執行唯讀 E2E smoke；失敗即 workflow failure，不觸發 production 或自動資料回復。

Staging template 沒有可用的 D1 ID／URL，因此直接使用 template 不能成功部署；所有 npm staging commands 由 guard 產生 repository-root 的 `wrangler.staging.generated.jsonc`，並固定 `--config`。生成檔不含 secrets，已 gitignore。它置於 root 是為了讓 Wrangler 的 `main`、assets 與 migration path 正確解析；不能搬到子目錄而不調整 guard/tests。

Guard 拒絕 production D1 ID／Worker 名稱、額外 bindings、preview database、routes/custom domains、named environments 與 command-line overrides。Wrangler command 固定 empty env-file，不自動讀取通用 `.env`；child process 以不分大小寫的名稱過濾一般／legacy Cloudflare credentials、通用 application secrets，以及可覆寫 Worker 名稱、environment 或 API endpoint 的 ambient Wrangler 設定，再設定明確 staging credentials，並固定 `WRANGLER_LOG_SANITIZE=true`。這些限制防止呼叫環境意外改變命令目標；無法限制具 secrets 權限的惡意 branch code，仍須依賴 trusted branches、review 與 token IAM。

Staging scheduled maintenance 使用獨立 cron（UTC 03:47），只透過 staging DB binding 操作 synthetic data。Preview URLs 關閉，避免產生未納入 smoke 的額外公開入口。

Production 的 expand／migrate／contract 規範完全不變，見 [database migration policy](database-migration-policy.md)。Staging 的歷史 bootstrap 不是 production destructive migration bypass；新 migration 仍須通過相同 checksum／分類與 expansion SQL policy。Contract operations 仍需獨立 review，不能放入自動 migration discovery directory。

## Commands

| Command | 是否連線遠端 |
| --- | --- |
| `npm run staging:validate` | 否；驗證 checked-in template 與 migration catalog |
| `npm run check:worker:staging` | 否；dummy UUID／inert URL 僅用於 Wrangler dry-run，不可 deploy |
| `npm run staging:preflight` | 否；驗證必要的 staging settings／secret 存在及設定格式，不輸出值；不驗證 provider 權限或 credential 有效性 |
| `npm run db:migrate:staging` | 是；只有明確 staging ID／URL／credentials 時才套用 staging migrations |
| `npm run db:check:staging` | 是；唯讀檢查 staging ledger |
| `npm run deploy:staging` | 是；檢查 staging auth／ledger，再部署 staging Worker 與 secrets |
| `npm run test:e2e:staging` | 是；只接受 dedicated staging origin 的 smoke |
| `npm run test:staging-policy` | 否；config、credential、URL、workflow 與 injected command regression tests |

本機遠端操作也必須明確提供 `STAGING_` settings；script 不讀一般 `CLOUDFLARE_*` 值作為 staging credential。不要把 secrets 放入 shell history、npm arguments 或 tracked dotenv。`.env*`、`.dev.vars*` 均 gitignore，生成 config 不載入 application credentials；本機 secrets 的實際存取權限仍須由操作者管理。

## Smoke coverage 與限制

獨立的 `playwright.staging.config.ts` 不啟動本機 fixture server、不執行既有 global teardown、不匯入 storageState，也不 seed 帳號。現有 `test:e2e`／a11y suite 繼續在本機 synthetic repository 執行，不可將完整資料修改 suite 的 base URL 改成 remote。

目前三項 smoke 驗證 health contract／security headers／auth flags、anonymous session/state/workspace 必須 401，以及真實前端 assets 與 login UI。設定維持 Secure HttpOnly host-only cookie、Origin／CSRF／RBAC、email verification，要求 staging Turnstile，並關閉公開註冊；這些配置要求不能當作 live 驗證結果。

Health handler 不查詢 D1；anonymous session 的 401 可在沒有 token 時直接返回。因此 smoke 通過不能證明 live D1 連線、schema 完整或 Worker 的 DB binding 確實指向預期資源。Smoke 不登入、不寫資料、不寄信，也不能證明 authenticated workspace／student／exam 流程、Turnstile challenge／server verification 成功、email delivery 或 serving build SHA。這些仍由本機 E2E、D1 integration tests 與每次 release 的人工 staging check 補足；本機測試也不能證明 live provider 設定。未提供已驗證 synthetic 帳號／安全 cleanup 規範前，不自動 bypass protections 來增加 authenticated smoke。

Remote requests 不 follow redirects；browser 限 staging GET/HEAD，以及 Turnstile 的非 top-level dependency，拒絕其他 origin／redirect navigation。網路 policy 使用 injected stubs 驗證 method、origin、Turnstile frame、3xx 與 malformed URL 的封鎖；另直接讀取 staging Playwright config 驗證沒有本機 fixture／teardown、storage state 或 retained browser artifacts。Trace、screenshots、video 與 HTML artifacts 關閉，避免意外保存 session／PII。Smoke step 不注入 Cloudflare API token 或 Worker secrets。

## 驗證與未完成設定

| 項目 | 已知狀態／觀察日期 | 尚需完成 |
| --- | --- | --- |
| Staging Worker／D1 | 使用者最近回覆「尚未」；截至本次查核未建立或寫入 Cloudflare 資源 | 管理員重新盤點；只建立缺少的 `epet-staging` 資源並核對 binding／UUID |
| GitHub `staging` environment | 2026-10-28 唯讀 API 重查仍為 404；不推定其他權限範圍也不存在 | 管理員確認／建立 environment、reviewers、self-review／bypass 與 branch rules |
| `staging.yml` live runs | 2026-10-28 API 重查 `total_count: 0` | 完成前置設定後，記錄第一次 staging-only workflow run、commit SHA 與結果 |
| Production environment protections | 2026-10-28 唯讀結果仍為 `protection_rules: []`、`can_admins_bypass: true`、`deployment_branch_policy: null`；本次未更動 | 此為當日觀察，不宣稱 production 已有 deployment approval；staging 必須獨立設定保護 |
| Cloudflare／Turnstile／Resend independence | 未讀取 secret values；輸入名稱分離不代表 provider credentials 已分離 | 管理員核對 token／widget／key metadata、scope、hostname、sender 與收件控制 |
| Remote ledger／deploy／smoke | 未執行 | 確認 synthetic-only 資源後執行並保存不含 secrets／PII 的結果 |
| Authenticated D1／Turnstile／email／build SHA | 未驗證 | 依下列 checklist 以受控 synthetic 帳號人工確認 |

Configuration／unit tests 與兩個 Worker dry-run 可在沒有 staging resources 的情況下驗證；命令結果應記在該次 release 紀錄，不能列為 live staging 的證據。真正的 remote migration、deploy 與 smoke 須等管理員完成上述設定，並重新確認有日期的觀察是否仍成立。

### 2026-10-28 本機驗證結果

| 命令 | 實際結果 | 範圍 |
| --- | --- | --- |
| `npm run test:staging-policy` | **34/34 通過**，0 fail／skip／cancel | 實際 CLI child process 使用完全離線 fake Wrangler，涵蓋 Worker／D1／API target、一般／legacy 憑證、Windows 大小寫 alias、logging、成功／失敗 cleanup；另含 smoke methods／origin／redirect 與 config invariants。 |
| `npm run verify` | **659/659 通過**（94 rules + 565 Node） | 含所有現有本機修復的隔離副本；TypeScript、API／D1、安全回歸、migration policy、build 與 production config 的 Worker **dry-run**，不是正式部署。不能據此認定未提交修補已在 main。 |
| `npm run staging:validate` | exit 0 | template、不同 UUID／Worker 與 migration catalog。 |
| `npm run check:worker:staging` | exit 0 | 真實 Wrangler **offline dry-run**；刻意帶入混用大小寫的 `epet-api`／production env 覆寫、合成錯誤 token／API URL，仍使用 dummy staging binding，沒有發出遠端資源寫入。 |
| `npm run test:e2e:staging -- --list` | 成功列出 **3 項** | 使用 synthetic offline-check origin，僅驗證 config／suite 載入，**沒有執行 remote smoke**。 |

修補前新增 CLI 測試先重現 4 項失敗；第一次修補後又以 lowercase／mixed-case aliases 重現 2 項 Windows 邊界失敗，最終改為先不分大小寫過濾，再設定唯一 canonical credentials／CI／sanitization。保留全部測試與原有限制，沒有用 skip 或降低條件取得通過。獨立複核確認 alias 問題已關閉；沒有宣稱已做完整 live review。既有 Sentry optional `node:*` dry-run warnings 保留，未為使測試通過而增加 compatibility flags。Production config／兩份 deployment workflows／獨立 expansion workflow 均沒有本次修改；本次未 deploy、migrate、改 Secrets 或使用正式學生資料。

### 執行前 checklist

- [ ] 記錄查核日期、Cloudflare account、`epet-staging` Worker／D1 ID、預期 origin 與 Worker `DB` binding；確認沒有 production binding 或實際使用者資料。
- [ ] 確認新 D1 為空白，或既有 schema／ledger 可信且完整；缺 ledger 卻有 application tables／資料，或來源不明時停止 migration，不 reset／補寫 ledger／重放歷史 SQL。
- [ ] 確認 CI token 只有指定 Worker Editor 與必要 staging D1 scope；若 D1 僅能 account-wide 授權，使用獨立 staging account 或先交由管理員評估剩餘範圍。
- [ ] 確認 GitHub staging environment 有獨立 reviewer、Prevent self-review、禁止 bypass 與明確 branch allowlist，且 `STAGING_` values 沒有 repo／org fallback。
- [ ] 以 provider metadata 確認 widget／key 獨立；Turnstile 只列 staging hostname、無 Any Hostname；Resend 使用 sending-access／staging domain 與 sender。先確認受控測試信箱／mail sink；未確認就不自動寄信。
- [ ] 本機 preflight 通過後，先以 staging credentials 查 ledger／確認狀態，再依已核准的 bootstrap 或 pending expansion 計畫執行；記錄 apply 前後 migration filenames，不輸出資料內容。

### 首次驗收與 release 紀錄

- [ ] 部署後核對 Cloudflare 實際 serving version／bindings 與 workflow commit SHA 的對應，再執行唯讀 smoke；現有 health 不回傳 build SHA，不能僅靠 smoke 判定版本。
- [ ] 人工使用已驗證 synthetic 帳號完成 Turnstile 登入、D1 讀寫／權限與 tenant isolation 檢查；所有測試資料使用明確 synthetic 標記，cleanup 僅依核准範圍執行。
- [ ] 確認收件控制後，才人工測試 verification／password reset 寄送及 staging link origin；記錄成功／失敗與 provider delivery metadata，不保存 token、session 或信件內的敏感連結。
- [ ] 將上述證據與未完成項目記入 release 紀錄，包含測試 commit、Worker version、ledger、執行者與時間；不將 unit／dry-run 的通過填入 live 驗證欄位。

兩份 config 的 common entry point／assets／compatibility date 刻意用 regression tests 維持一致，不建立會自動帶入 production bindings 的 inheritance。將來改動這些共用設定或新增 Cloudflare binding 時，需同時 review staging template 與 guard allowlist；否則驗證會 fail closed，而不是偷偷 fallback。

目前 smoke 不驗證 serving build SHA，只確認該 staging origin 的 critical startup/security behavior。本機 staging 指令共用 generated config path，不能同時執行；CI 使用獨立 runner，且所有 staging runs 由同一 concurrency group 序列化。External operator 操作也應自行遵循相同序列化規範。

## Staging 失敗、重跑與 application rollback

Worker deploy 與 D1 migration 不是同一交易。失敗或 timeout 時，先停止其他 staging writer，查明實際 serving version、binding 與 ledger；不能根據 CLI exit code 猜測是否已部署或全部 rollback。所有操作只限同一個已確認的 staging account／Worker／D1，不執行 production 指令或修改 production secrets／config。

- Migration 失敗：保留已成功的 ledger／schema／synthetic data，確認失敗位置及目前 Worker 是否仍相容，再 review forward migration fix。重跑只用 ledger-managed operation；不刪資料庫、清空 ledger、手動補 migration 名稱或重放 frozen history。
- Deploy 失敗或 smoke 失敗：先核對實際 serving version；修正 application／設定後再執行 staging guard、ledger check、部署與 smoke。重跑不得換成 production config／credentials，也不自動 restore D1。
- 必須 application rollback 時：由操作者明確核准先前已記錄的 **staging Worker version**，確認該版可使用現有 schema／bindings／secret 設定後才切換。Worker rollback 不恢復 D1 資料或 schema；保留現有 ledger／data，schema 問題以 reviewed forward fix 處理。沒有相容版本就先停止測試並修正，不自動執行 destructive recovery。版本與 rollback 限制見 [Cloudflare Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。

## 2026-10-31 CI/CD 增量

Staging 沿用既有的三項唯讀 browser smoke 與獨立 URL／method／redirect policy；不把 Production smoke 的固定 origin 改成可任意設定的遠端 target，也不重建 staging 資源。Workflow 的失敗 annotation／job summary 提供 run link、驗證／發布／smoke 的結果與回復文件；smoke 失敗仍使 job 失敗，不自動 restore D1 或發布到 Production。

Production 新增的 `npm run smoke:production` 只供正式發布後的無帳號唯讀檢查，契約與人工回復見 [production-deployment.md](production-deployment.md)。它不取代 staging 的 login UI smoke 或受控 synthetic 功能驗收。當正式／staging deploy 已嘗試而結果不明，或 publish 成功但 smoke 失敗時，先確認實際 serving version／bindings；不能直接 rerun 整個 workflow 來推定沒有副作用。

通知的 annotation／summary 不代表值班人已收到通知。依 [通知與接手程序](production-deployment.md#失敗通知與值班接手)，管理員核對 GitHub Actions preferences／觸發者範圍，並先在 mock CI 或真正隔離的 staging 故意讓 smoke 失敗，確認 primary／backup 的 receipt。尚未實測的 delivery、GitHub environment approval、IAM 與 live staging 維持未驗證，本次沒有為此部署或改 Secrets。
