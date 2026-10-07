# Staging deployment

更新日期：2026-10-01。這次只建立 configuration、guard、workflow 與 smoke tests；沒有建立 Cloudflare 資源、填入 secrets、複製 production 資料或執行遠端部署。

## 環境邊界

| 項目 | Production | Staging |
| --- | --- | --- |
| GitHub branch／觸發 | `main` push／`deploy.yml` 手動執行 | `staging` push／在非 `main` branch 手動執行 `staging.yml` |
| GitHub environment | `production` | `staging` |
| Worker | **既有 `epet-api`，不改名** | `epet-staging` |
| D1 | `epet-production`，既有 ID 不變 | 新建 `epet-staging`，必須使用不同 ID |
| Wrangler | `wrangler.jsonc`，既有設定不變 | `wrangler.staging.jsonc` template + ignored generated config |
| URL | 既有 `epet-api.jtwen12345us.workers.dev` | `epet-staging.<workers-subdomain>.workers.dev` |
| Concurrency | `cloudflare-production` | `cloudflare-staging` |
| 資料 | 真實使用者／學生資料 | 僅人工建立的 synthetic test data |

未把 production Worker 改名為 `epet-production`，因為改名會影響目前 URL、secrets、bindings 與部署歷史。新的 resource naming 已明確標示 staging；production D1 維持 `epet-production`。

採獨立 config，而不是在 production config 新增 `env.staging`：既有 production migration guard 刻意拒絕 named environments；分開檔案也避免省略 `--env` 後發布到 production。Staging 使用相同 Worker entry point、compatibility date、assets routing 與 API contracts，沒有額外的 frontend API host override。

Cloudflare 的 [bindings/environment variables 必須依 environment 設定](https://developers.cloudflare.com/workers/wrangler/environments/)，[secrets 屬於各 Worker](https://developers.cloudflare.com/workers/configuration/secrets/)。本專案用不同 Worker 與不同 config 明確定義完整 bindings；不依賴 production bindings 的 inheritance。

## 首次設定（管理員操作）

1. 建立全新的 D1 `epet-staging`。可用 Cloudflare dashboard 或經 staging credentials 授權的 `wrangler d1 create epet-staging`。不要 clone、export/import 或 restore production database；連匿名化 production student data 都不作為 staging fixture。
2. 在 GitHub 建立 `staging` environment，設定 required reviewers 與 deployment branch rules。允許受信任的 `staging`／指定測試 branches，禁止 `main`／tags。Workflow 自己也會拒絕 `main` 與 tag。
3. 設定下列 environment variables／secrets。使用 environment scope，**不要在 repository／organization scope 存同名 staging secrets**。GitHub 的 fallback scope 不能由 YAML 證明隔離，需管理員確認。
4. 建立獨立的 Turnstile widget，只允許 staging hostname；建立獨立 email provider key／sender，僅寄送至測試信箱。不要重用 production Turnstile／Resend key。
5. 從 `staging` 或經核准的非 `main` branch 執行 workflow。首次會在新 staging D1 以 ledger-managed migrations bootstrap schema，再用 staging secrets 發布新 Worker。
6. Smoke 通過後才考慮 merge 至 `main`；staging 不會自動 promote 或觸發 production deploy。

`production` environment、目前 secrets 名稱與 `deploy.yml`／`database-expand.yml` 保持原樣。Required reviewers、branch rules 與 Cloudflare token scopes 都是管理員設定，不會因新增 YAML 自動建立。

### GitHub staging variables

| Variable | 值／用途 |
| --- | --- |
| `STAGING_D1_DATABASE_ID` | 新建 `epet-staging` 的 UUID；guard 拒絕 production ID（包含大小寫差異） |
| `STAGING_BASE_URL` | `https://epet-staging.<workers-subdomain>.workers.dev`；不能含 credentials/path/query/fragment |
| `STAGING_PASSWORD_RESET_FROM` | 已驗證的 staging-only email sender，例如 `Epet Staging <staging@your-test-domain>` |

### GitHub staging secrets

| Secret | 用途 |
| --- | --- |
| `STAGING_CLOUDFLARE_ACCOUNT_ID` | Staging Cloudflare account |
| `STAGING_CLOUDFLARE_API_TOKEN` | 獨立 deployment token；只授予必要的 Workers Scripts／D1 權限，依帳號可用能力限縮資源 |
| `STAGING_TURNSTILE_SITE_KEY` | Staging widget public site key，傳至 staging Worker |
| `STAGING_TURNSTILE_SECRET_KEY` | Staging widget verification secret |
| `STAGING_RESEND_API_KEY` | Staging email provider credential；建議 sender／recipient sandbox policy |

可使用獨立 Cloudflare account 增強隔離；在同帳號時，某些 token 權限可能是 account-wide，不能宣稱 YAML／resource naming 等於 IAM 隔離。對可執行 deployment 的 branches 必須有 review 與保護：branch 上的程式碼會取得 staging secrets，不要從未受信任 PR／fork 執行具 secrets 的 job。Workflow 沒有 `pull_request_target` 或 arbitrary checkout-ref input。

Worker runtime secret 名稱仍是 `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`、`RESEND_API_KEY`，不改 application contracts。Deploy script 只讀 `STAGING_` prefixed settings，把 Worker secrets 寫入受限權限的 temporary JSON，以 Wrangler 的 [deploy `--secrets-file`](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code) 同 code 一起傳送，完成／失敗後清除。Secrets 不寫入 config、stdout 或 artifacts；CI runner 必須為 ephemeral。若本機 process 被強制終止，需檢查並清除該次 `epet-staging-secrets-*` temporary directory，不分享其中內容。

## 部署流程

`staging.yml` 的 verify job 不讀 Cloudflare credentials，執行完整驗證與 staging dry-run。通過後，獨立的 `staging` environment job：

1. Build assets、安裝 Chromium。
2. 本機 preflight：所有必要 staging settings 缺失即失敗；不 fallback 至 production credentials。
3. 讀取 staging ledger 狀態；拒絕未知／缺口 ledger。全新 synthetic-only staging 可建立 ledger 並 bootstrap frozen historical migrations；已有成功紀錄不重放。
4. Migration 完成後再確認 ledger。
5. 確認 Cloudflare authentication、重新確認 staging ledger，再部署 `epet-staging` 與 staging-only secrets。
6. 執行唯讀 E2E smoke；失敗即 workflow failure，不觸發 production 或自動資料回復。

Staging template 沒有可用的 D1 ID／URL，因此直接使用 template 不能成功部署；所有 npm staging commands 由 guard 產生 repository-root 的 `wrangler.staging.generated.jsonc`，並固定 `--config`。生成檔不含 secrets，已 gitignore。它置於 root 是為了讓 Wrangler 的 `main`、assets 與 migration path 正確解析；不能搬到子目錄而不調整 guard/tests。

Guard 拒絕 production D1 ID／Worker 名稱、額外 bindings、preview database、routes/custom domains、named environments 與 command-line overrides。Wrangler command 固定 empty env-file，不自動讀取通用 `.env`；child process 也移除一般／legacy Cloudflare credentials 與通用 application secrets，再設定明確 staging credentials。Staging scheduled maintenance 使用獨立 cron（UTC 03:47），只透過 staging DB binding 操作 synthetic data。Preview URLs 關閉，避免產生未納入 smoke 的額外公開入口。

Production 的 expand／migrate／contract 規範完全不變，見 [database migration policy](database-migration-policy.md)。Staging 的歷史 bootstrap 不是 production destructive migration bypass；新 migration 仍須通過相同 checksum／分類與 expansion SQL policy。Contract operations 仍需獨立 review，不能放入自動 migration discovery directory。

## Commands

| Command | 是否連線遠端 |
| --- | --- |
| `npm run staging:validate` | 否；驗證 checked-in template 與 migration catalog |
| `npm run check:worker:staging` | 否；dummy UUID／inert URL 僅用於 Wrangler dry-run，不可 deploy |
| `npm run staging:preflight` | 否；驗證必要的 staging settings／secret 存在，不輸出值 |
| `npm run db:migrate:staging` | 是；只有明確 staging ID／URL／credentials 時才套用 staging migrations |
| `npm run db:check:staging` | 是；唯讀檢查 staging ledger |
| `npm run deploy:staging` | 是；檢查 staging auth／ledger，再部署 staging Worker 與 secrets |
| `npm run test:e2e:staging` | 是；只接受 dedicated staging origin 的 smoke |
| `npm run test:staging-policy` | 否；config、credential、URL、workflow 與 injected command regression tests |

本機遠端操作也必須明確提供 `STAGING_` settings；script 不讀一般 `CLOUDFLARE_*` 值作為 staging credential。不要把 secrets 放入 shell history、npm arguments 或 tracked dotenv。`.env*`、`.dev.vars*` 均 gitignore，生成 config 不載入 application credentials；本機 secrets 的實際存取權限仍須由操作者管理。

## Smoke coverage 與限制

獨立的 `playwright.staging.config.ts` 不啟動本機 fixture server、不執行既有 global teardown、不匯入 storageState，也不 seed 帳號。現有 `test:e2e`／a11y suite 繼續在本機 synthetic repository 執行，不可將完整資料修改 suite 的 base URL 改成 remote。

目前三項 smoke 驗證 health contract／security headers／auth flags、anonymous session/state/workspace 必須 401，以及真實前端 assets 與 login UI。Staging 保持 Secure HttpOnly host-only cookie、Origin／CSRF／RBAC、email verification；另外開啟真實 staging Turnstile，關閉公開註冊。

Smoke 不登入、不寫資料、不寄信；因此不能證明 authenticated D1 workspace／student／exam 流程或 Turnstile challenge 成功。這些仍由本機 E2E、D1 integration tests 與每次 release 的人工 staging check 補足。未提供已驗證 synthetic 帳號／安全 cleanup 規範前，不自動 bypass protections 來增加 authenticated smoke。

Remote requests 不 follow redirects；browser 限 staging GET/HEAD，以及 Turnstile dependency，拒絕跨 origin／redirect navigation 到 production。Trace、screenshots、video、storage state 與 HTML artifacts 關閉，避免意外保存 session／PII。Smoke 沒有 Cloudflare API token 或 Worker secrets。

## 驗證與未完成設定

Configuration／unit tests 與兩個 Worker dry-run 可在沒有 staging resources 的情況下驗證。真正的 staging deploy／remote smoke 必須等管理員建立 D1、GitHub environment、獨立 secrets 與 widget 後才能執行；這次沒有聲稱已驗證 live staging。Worker deploy 非 database transaction，staging failures 仍需確認實際 serving version／ledger，再重試，不自動影響 production。

兩份 config 的 common entry point／assets／compatibility date 刻意用 regression tests 維持一致，不建立會自動帶入 production bindings 的 inheritance。將來改動這些共用設定或新增 Cloudflare binding 時，需同時 review staging template 與 guard allowlist；否則驗證會 fail closed，而不是偷偷 fallback。

目前 smoke 不驗證 serving build SHA，只確認該 staging origin 的 critical startup/security behavior。本機 staging 指令共用 generated config path，不能同時執行；CI 使用獨立 runner，且所有 staging runs 由同一 concurrency group 序列化。External operator 操作也應自行遵循相同序列化規範。
