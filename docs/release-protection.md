# Main 與 Production 發布保護設定

日期：2026-10-25。這是管理員執行與驗收手冊；檔案存在、workflow 通過及 Environment 名稱均不代表外部政策已套用。實際狀態與測試結果見 `commercial-readiness-audit.md` 的 H05／V01。本任務不修改部署權限、Secrets 或 Production D1，也不合併或發布。

## PR 驗證與 Required Checks

新增 `.github/workflows/functional.yml`，在 main 的 PR／push 執行，沒有 paths／draft／actor 排除。`npm run verify` 涵蓋 TypeScript、Unit／API、本機 Miniflare D1、migration 契約、production build 與 Worker dry-run。`scripts/release-ci.mjs` 找出 E2E、Accessibility 及已存在的容量 spec；每個 spec 使用獨立 runner／本機 server／合成資料，保留登入限流。舊分支尚未引入容量 suite 時可不存在該目錄；存在但空白或不安全路徑會失敗。實際測試清單由 checkout 來源決定，不以先前 SHA 的成功代替。

| 必要 context（大小寫須完全一致） | 必要來源 | 內容 |
| --- | --- | --- |
| `PR required checks` | GitHub Actions，App ID **15368** | `discover`、`verify`、完整 `browser` matrix 都必須 success；failure／cancelled／skipped／缺項均失敗。 |
| `CodeQL` | GitHub Actions，15368 | 保留既有 JS／TS 分析與 security-events 最小 write scope。 |
| `Dependency review` | GitHub Actions，15368 | 保留 PR 的 high／critical 新依賴阻擋。 |
| `npm audit` | GitHub Actions，15368 | 保留 committed lockfile 全依賴稽核。 |

App ID 已從本 repository 的 check runs 讀取；套用前仍須以最新 PR check readback 核對名稱／App／SHA。一般 `Browser (...)` matrix 名稱會隨 spec 變化，Required Check 使用固定 aggregate；它不是可忽略 matrix 失敗的成功步驟。a11y 保留現有 serious／critical axe 門檻及 keyboard assertions，不宣稱涵蓋完整 WCAG AA 人工驗收。

Functional CI 只給 `contents: read`，checkout 不保留憑證，沒有 deployment Environment、Production secrets、`pull_request_target` 或特權 `workflow_run`。測試產物不自動上傳 cookies／Storage／trace。若 fork PR 需要 Actions approval，維持人工批准與低權限，不改用高權限事件。GitHub 官方說明指出 skipped job 可視為成功，且 Required Checks 必須針對最新 SHA；因此 aggregate 額外要求每個 dependency 真正成功。[Required Checks 行為](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)

本 workflow 預留 `merge_group`，但**尚不可啟用 Merge Queue**：現有 Security／Dependency review 尚無完整 merge-group 契約。四個 Required Checks 都在 merge-group SHA 產生正確結果前，使用 strict up-to-date PR 模式；不靠跳過 security checks 解決 pending。

## 管理員套用 Main Ruleset

1. 先審查 CI PR，在新 workflow 可執行的 PR SHA 觀察四個 context。不要為 bootstrap 放寬原有 Security，也不要直接 push main。若尚無可用 reviewer，先由管理員安排獨立、有 write 權限的 reviewer；不能自審冒充第二人。
2. Settings → Rules → Rulesets → New branch ruleset。可匯入已備妥的 `.github/rulesets/main-protection.json`；**此 JSON 是提案，CI 不會自動套用**。名稱 `main-reviewed-and-verified`，Enforcement **Active**，Include **`refs/heads/main`**，Exclude 空白。保留既有 `tutorops` 及其歷史，審查所有重疊規則及 bypass。
3. Require a pull request before merging：approvals **1**、dismiss stale approvals、require approval of most recent reviewable push、resolve all review threads。至少一位 reviewer 須獨立於作者／最後 pusher。為 `.github/**`、`scripts/release-ci.mjs`、`SECURITY.md`、migration／deployment policy 指定合格 CODEOWNERS 後再開 Require Code Owner Review；模板不假造 reviewer 身分。
4. Require status checks：加入上表四個 context，來源選 **GitHub Actions**；開 **Require branches to be up to date**。禁止 force push 與刪除。Bypass list 保持空白，包含 admin／write／maintain／DeployKey／Cloudflare App 都不加入。不要添加 Restrict updates 並以廣泛 bypass 讓一般 merge 通過。
5. Actions → General：預設 token read-only，保留 CodeQL job 的顯式最小例外；不允許 Actions 自行批准 PR。針對 fork 的 workflow approval 保留人工控制。確認各 workflow 的 check 名稱沒有同名偽造來源；App 綁定不能辨別同一 GitHub App 內兩個同名 workflow，因此 CI／政策檔案的獨立 review 仍是必要邊界。

Rulesets 會疊加；新規則無 bypass 不代表應刪除其他規則。若只能使用 classic Branch Protection，對 exact `main` 設相同 PR／checks／strict／conversation，開 enforce admins／禁止 bypass／force push／deletion；不要以 legacy API 的 404 單獨判定 Ruleset 未生效。[GitHub 規則說明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

管理員唯讀 readback（需要有效的管理連線；不要輸出 token）：

```bash
gh api repos/andreww0421/epet/branches/main
gh api 'repos/andreww0421/epet/rulesets?includes_parents=true'
gh api repos/andreww0421/epet/rules/branches/main
gh api repos/andreww0421/epet/rulesets/ACTUAL_RULESET_ID
```

驗收須保存 `enforcement=active`、main include、review 參數、四個 context／integration_id、strict、無 bypass，以及有效 main 規則結果；只看 ruleset 名稱或本機 JSON 不算完成。

## Production Environment 與其他發布入口

Settings → Environments → **production**：

1. Required reviewers 選既有、經核定的人員，至少能找到一位獨立於該次 initiator 的 reviewer；開 **Prevent self-review**。GitHub 清單中只需一位 reviewer 批准，不是列兩人就強制兩人批准；若營運要求雙人核准，另配置可驗證的流程。
2. 關閉 **Allow administrators to bypass configured protection rules**（期望 `can_admins_bypass=false`）。
3. Deployment branches and tags 使用 **Selected branches and tags**，只新增 type **branch**／pattern **main**。不准 `*`、tags、`refs/pull/*`。不要單靠 Protected branches only：當沒有 branch protection 時，這個選項有不同語意，不能視為 exact-main 控制。
4. 核對應用 `deploy.yml` 與 `database-expand.yml` 都使用同一受保護 Environment、main-only、共用 `cloudflare-production` concurrency。D1 expansion 仍為獨立 manual-only 流程，應用 deploy 只讀 migration ledger，不套用 schema。
5. Production credential 僅存於受保護 Environment。盤點 Repository／Organization 同名 secret 的 fallback 或其他 Publisher；不要下載、印出或複製 secret 值作稽核。本次不搬移或輪替 Secrets。

唯讀核對：

```bash
gh api repos/andreww0421/epet/environments/production
gh api repos/andreww0421/epet/environments/production/deployment-branch-policies
```

保存 required_reviewers、`prevent_self_review=true`、`can_admins_bypass=false`、`deployment_branch_policy` 與 actual branch list。YAML `environment: production` 只會引用服務端政策，不會建立上述保護。[Environment 政策](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

另盤點 Cloudflare **Workers Builds**、Git integration、dashboard／CLI／其他 GitHub Apps。它們的 Production 發布不會自動受 GitHub Environment 審批。若保留原生 Builds，須具獨立等效核准或經明確授權改成只走受審批的 GitHub Actions；確認 main-only 仍不能代替人工發布核准。本次僅接受使用者確認「只有 main 能發布，PR／其他分支不能操作 Production」作為安全建立測試 PR 的前提，沒有修改 provider 設定。

## Cloudflare Token 最小權限盤點

本機只能看 workflow 引用，不能據 `whoami`、token 名稱或 secret 存在宣稱 least privilege。由 Cloudflare 管理員提供 **token policy／permission groups／resource scopes／到期日／owner 的遮罩證據**，不提供 token value。部署與 expansion 目前引用同一 production Environment 的 `CLOUDFLARE_API_TOKEN`，須由管理員確認實際政策。

| 用途 | 目標配置及驗證 |
| --- | --- |
| 現有 Worker 發布 | 僅目標 account／既有 Worker 的 Editor；目前 workers.dev 部署不隨意添加所有 zone 的 DNS／Routes Write。若 deployment 真需修改 routes，僅指定 zone 的 Routes Write。 |
| migration ledger check | 額外直接查 D1 時使用 D1 Read；在合成資料庫驗證現用 Wrangler 的 ledger SELECT 可執行，寫入被拒絕。不要因 SQL 是 SELECT 就省略實際權限查驗。 |
| 獨立 schema expansion | 專用 D1 Write／Edit policy；限 provider 可支援的最小 account／database 範圍、不加 Worker 發布能力。建議另用受審批 migration Environment／token，在核定、供應與相容測試後才修改引用。 |
| staging | 不同 token、Worker、D1、origin；只作用合成 staging。既有 preflight 拒絕 Production DB ID 的控制保持。 |

Workers 的綁定資源部署與直接查詢是不同權限：不能把「能部署綁定 D1 的 Worker」等同 D1 SQL 寫入權。若方案不支援 database 級隔離，記錄 account 級剩餘範圍與隔離帳號方案，不假造精細權限。[Workers 授權](https://developers.cloudflare.com/workers/authorization/workers/)、[D1 Query 權限](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)

可選未來名稱為 `CLOUDFLARE_WORKER_DEPLOY_TOKEN`／`CLOUDFLARE_D1_MIGRATION_TOKEN`；此文件未建立 Secrets、未改現有引用，禁止以測試名義輪替正式 token 或執行 Production SQL。

## Emergency 與 Audit Trail

預設無 standing bypass。事故採 expedited PR，仍需獨立 review、四個 checks 成功與 Environment approval。未通過的測試不能用 skip、關 rule、偽造 status 或 all-admin bypass 處理。

若未來確實需 break-glass，先取得另一次明確授權；由獨立人員批准 incident／風險接受／actor／有效期限及回復計畫。不要把正式 Required Checks 與 integrity rules 加入可 bypass 的規則組；如建立緊急 reviewer 例外，僅限單一受控 actor／PR-only、隔離 review rule，其他 integrity／checks／Environment 仍適用。User-owned repository 沒有 organization team，不以不存在的 team 配置冒充已限縮。

保存 incident ID、PR／head SHA／merge SHA、check run URLs／app、reviewer 與 deployment approver、前後 ruleset／Environment JSON、rule evaluation／bypass 記錄、時間與到期移除證據、Cloudflare build／deployment IDs。使用 repository Ruleset Insights／PR timeline／deployment history；只有帳號方案支援時才引用 organization audit log。事後由另一人確認權限撤回與檢查未降低。

## 正反向驗收順序（不可自動觸發 Production）

1. **正常 PR**：僅 CI／policy 改動，跑四個 checks；未 review 必須顯示阻擋，獨立 review 後才允許 merge。驗證新 push 使舊 review 失效。記錄 SHA；不實際 merge 本次測試 PR。
2. **故意失敗 PR**：從正常候選建立獨立 branch，在既有 `tests/gameRules.test.ts` 附加合成失敗 assertion；讓正常 `npm run verify` 自然失敗，不使用專門跳過的 label。`Application verification` 與 `PR required checks` 應失敗，merge box 必須顯示 Required Checks 阻擋。只看到紅色 check，尚不能證明 ruleset 已生效；Draft PR 也不能作為 review 阻擋證據。
3. **直接 push**：先由管理員讀回生效規則、確認 Production publisher 具審批，再用真正無 bypass 的一般 write collaborator，推含合成 probe commit 到 main，必須被 server 拒絕且 main SHA 不變。若未保護，這個測試可能發布，**本任務禁止執行**；`git push --dry-run`／admin 帳號的結果不能冒充實際拒絕證據。
4. **Security 失敗**：在受控分支測試既有 security check 拒絕時仍不能 merge，不停用掃描、不引入真實惡意依賴；CodeQL 掃描成功與「沒有未解決 alert」亦須分開判讀。
5. **Production approval**：管理員在 Policies 已套用後，以不含 Secrets、不部署、不執行 SQL 的獨立 noop probe workflow 引用 `production`，確認 pending、initiator 不可自批、非 reviewer 被拒、授權 reviewer 批准後才能執行，非 main／tag 被拒。它只測 Environment policy，不能宣稱已驗證真實部署成功。真實應用及 D1 expansion 的 approved-path 需另次明確發布授權與 staging 演練；本次不 dispatch 現有發布／migration workflows。

只有外部 readback 與以上負向拒絕、正向 review／approval 都有證據後，H05／V01 才能 Closed。本機 policy unit test、actionlint、E2E 或 `verify` 成功均不能代替這些外部驗收。
