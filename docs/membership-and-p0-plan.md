# ePet 會員系統與 P0 上架計畫

日期：2026-08-23

## 目前落地狀態

已完成可供封閉教師試點驗證的會員與資料安全底座：

- Email／密碼註冊、登入、登出、session 復原及忘記／重設密碼。
- opaque token 雜湊保存、持久 rate limit、短效一次性 reset token。
- owner／admin／teacher／viewer 的伺服器 RBAC 與 workspace 租戶隔離。
- legacy cloud workspace 明確 opt-in 認領；舊本機資料下載／明確匯入。
- D1／JSON repository 最近 25 份可復原 revision snapshot、actor audit context。
- 核心班級、學生、考試、證據、事件與魔王獎勵正規化 D1 表、舊 blob 回填與交易式 staged dual-write。
- 學生個資本機快取預設關閉、完整工作區與單一學生 admin 匯出、學生 live-state 級聯刪除。
- revision 查詢／復原 API，以新 revision 保留復原軌跡；處罰／降級防重複與補償式撤銷 ledger。
- 串行 autosave、指數退避重試、sessionStorage 未同步草稿、離開前警示與丟失回應後的幂等復原。
- Email 工作區邀請（一次性 token hash／7 日到期／撤銷／防重放）與班級範圍管理。
- 成員角色變更、移除、owner 移轉、工作區與帳號雙重確認刪除。
- 刪除學生時同步清除所有保留 revision 與正規化投影中的該生資料。
- Worker cron 與 Node 每日清理到期／撤銷 session、reset token、rate limit 與邀請。

這不等於已達公開商業上架。下列仍是需要外部決策或正式環境的 release blocker：

- 公開註冊的 Email 驗證與 bot 防護；完成前必須維持 `REGISTRATION_ENABLED=false` 並使用邀請制。
- 正規化表與相容 blob 的全量對帳、切換讀取來源及 blob 退場計畫。
- revision 復原、單生匯出與稽核查詢的管理 UI，以及 D1 備份還原演練與核定的 RPO／RTO。
- 同站 `HttpOnly` cookie 與完整 WCAG 2.2 AA 核心流程驗證。
- 法定營運者、隱私窗口、保留期限、學校資料處理協議與正式寄件者身分核准。

隱私盤點、保留／刪除缺口與資料請求 runbook 見
[`privacy-data-governance.md`](privacy-data-governance.md)。

## 目標

把目前以瀏覽器 `workspace id` 當作能力金鑰的單機式同步，改成正式的會員、租戶與角色權限模型。完成後：

- 未登入者不能讀取或寫入班級、學生、成績、評語與獎懲資料。
- 工作區 ID 只用於選擇班級空間，不能單獨作為憑證。
- 同一會員可以加入多個工作區；每個工作區都有獨立角色。
- 忘記密碼不洩露帳號是否存在，重設連結短效、一次性，成功後撤銷既有登入。
- 舊使用者可在原瀏覽器註冊後，一次性認領既有雲端工作區。
- 登出或切換帳號後，不會看到或上傳上一位老師的本機快取。

## 會員流程

### 註冊

1. 輸入姓名、Email、密碼。
2. 後端正規化 Email、檢查密碼政策並建立帳號。
3. 若瀏覽器持有尚未被認領的舊雲端工作區，明確提示後進行一次性認領。
4. 否則建立新的工作區，將使用者設為 `owner`。
5. 建立短效 session，回到教師工作台。

公開註冊上線前仍要加入 Email 驗證與機器人防護；封閉試點可先採邀請制。

### 登入

1. Email 與密碼送往後端。
2. 成功後建立隨機 session token；資料庫只保存 token 的 SHA-256。
3. 所有資料 API 都先驗 session，再驗工作區 membership 與角色。
4. 失敗一律使用通用錯誤，不回傳「帳號不存在」等可枚舉訊息。

### 忘記密碼

1. 使用者輸入 Email。
2. 不論帳號是否存在，畫面與 API 都回覆相同訊息。
3. 若帳號存在，後端產生 32-byte 隨機 token，只保存 token hash，有效 30 分鐘。
4. Resend 寄出重設連結；正式環境不在 API、log 或分析事件中回傳 raw token。
5. 使用者設定新密碼後，token 標記已使用，該帳號所有既有 session 立即撤銷。
6. 重設頁載入 token 後立刻從網址移除，並使用 `Referrer-Policy: no-referrer`。

### 登出與切換工作區

- 登出會撤銷伺服器 session、清除前端 session token、停止 autosave 並清空記憶體中的學生資料。
- 切換工作區會先停止舊 revision 的同步，再載入新工作區，不沿用舊 autosave queue。
- 不同工作區的 revision、快取與錯誤狀態不可共用。

### 成員邀請與帳號生命週期

封閉試點只開教師型帳號，不提供學生或家長登入。目前已實作：

1. `owner/admin` 輸入教師 Email、角色與班級範圍，後端建立七日有效的一次性 invitation token；
   資料庫只保存 token hash。
2. 受邀者必須持有 Email 內的一次性連結；邀請過期、撤銷或使用後不可重放。
3. `admin` 可邀請／移除 `teacher/viewer`，只有 `owner` 可管理 `admin`。
4. 移除成員會立即撤銷其該 workspace 存取、清除 session 的 active workspace，並保留 actor、前一角色與時間的 audit event。
5. 刪除帳號前先處理其擁有的 workspace：移轉唯一 owner、刪除，或取消操作；
   不允許產生沒有 owner 的工作區。

帳號停用、Email 變更與所有權移轉安全通知尚未實作；導入學校身分系統前不開放 Email 變更或帳號停用 UI。

學生／家長入口等資料分享、法源、可見範圍與撤銷流程確定後再獨立設計，
不可直接沿用教師的完整 workspace 權限。

## 角色與權限

| 能力 | owner | admin | teacher | viewer |
| --- | --- | --- | --- | --- |
| 查看班級與分析 | 是 | 是 | 是 | 是 |
| 修改學生、積分、證據、考試與魔王 | 是 | 是 | 是 | 否 |
| 邀請或移除 teacher/viewer | 是 | 是 | 否 | 否 |
| 管理 admin | 是 | 否 | 否 | 否 |
| 移轉所有權、刪除工作區 | 是 | 否 | 否 | 否 |
| 匯出完整個資 | 是 | 是 | 依校方政策 | 否 |

前端隱藏按鈕只改善 UX；真正權限必須由 API 在每次請求執行。

## 資料模型

P0 新增：

- `users`：會員基本資料、狀態與可升級的密碼雜湊參數。
- `workspace_memberships`：使用者、工作區與角色。
- `auth_sessions`：只保存 session token hash、到期與撤銷時間。
- `password_reset_tokens`：一次性 reset token hash、到期與使用時間。
- `workspace_claims`：防止同一舊工作區被重複認領。
- `workspace_revisions`：每次保存的版本快照，支援稽核與復原。
- `audit_events`：登入、登出、密碼重設、會員與資料異動的安全事件。
- `auth_rate_limits`：登入、註冊與忘記密碼的濫用限制。
- `workspace_invitations`：一次性邀請 token hash、角色、班級範圍、到期、接受與撤銷狀態。

現有 `workspaces.data_json` 保留為相容讀取層；P0 已依下列順序回填並建立交易式 dual-write：

1. `classes`、`students`
2. `exam_records`、`exam_results`
3. `learning_evidence`
4. `point_adjustments`、`discipline_records`
5. `boss_events`、`boss_rewards`

寫入以 revision gate 與 D1 batch 確保 blob、投影表及 audit 同成同敗。目前仍由 blob 讀取；全量對帳後才能切換讀取來源，不可直接刪除舊 blob。

## 密碼與 session 基線

- 密碼長度：12–128 字元，允許密碼管理器與貼上，不強制週期性更換。
- 現階段使用 Web Crypto `PBKDF2-HMAC-SHA256`、每位使用者獨立 salt、600,000 iterations；參數跟著帳號保存，之後可升級。
- session 與 reset token 都由 CSPRNG 產生，資料庫不保存 raw token。
- 登入、註冊、忘記密碼與 reset 都要有持久化 rate limit。
- 所有錯誤使用穩定錯誤碼，不把 SQL、stack 或帳號存在狀態送到前端。

## 部署架構

目前 GitHub Pages 與 `workers.dev` 是跨站來源。階段性版本使用：

- `Authorization: Bearer` 的 opaque session。
- token 只放 `sessionStorage`，不放 `localStorage`。
- 嚴格 CSP、短效 session、後端可撤銷。

公開商業上架前應改成同站部署：

- `https://app.<domain>/` 提供前端。
- `https://app.<domain>/api/` 由同一 Cloudflare Worker 處理。
- session 改為 `__Host-`、`HttpOnly`、`Secure`、`SameSite=Lax` cookie。
- 寫入請求加入 CSRF token 或嚴格 Origin 驗證。

## 舊資料遷移

- 不自動把固定 `localStorage` 的學生資料掛到新登入帳號。
- 原瀏覽器持有合法舊 workspace ID 時，可在註冊時一次性認領「尚無會員」的工作區。
- `local-demo`、格式錯誤或已被認領的工作區不可認領。
- 純本機資料提供三個選項：匯入目前帳號、先下載 JSON、稍後處理。
- 只有伺服器確認保存完成後才寫入 migration marker；原資料不在同一步驟刪除。

## 上線順序

1. 先套用 D1 migration。
2. 部署同時支援新 auth API 與舊資料格式的 Worker。
3. 驗證註冊、登入、租戶隔離、forgot/reset、舊工作區認領。
4. 再部署有 Auth Gate 的前端。
5. 觀察錯誤率後關閉未登入 workspace 能力金鑰路徑。
6. 最後才把 `REGISTRATION_ENABLED` 從預設的 `false` 改為 `true`，開放公開註冊與付費方案。

若前端先上線或 Worker 未先 migration，會造成所有現有使用者無法同步，因此不可反向部署。

## P0 驗收

- 匿名請求讀寫資料均為 `401`。
- A 工作區會員不可讀寫 B 工作區，回覆不洩露 B 是否存在。
- `viewer` 寫入為 `403`，`teacher` 的合法寫入仍可使用。
- 錯誤密碼、過期／撤銷 session、過期／重複 reset token皆有回歸測試。
- 存在與不存在帳號的 forgot 請求皆為相同 `202` 回覆。
- reset 成功後舊 session 不可再使用。
- 登出與帳號切換後，畫面及 autosave 不保留前一工作區資料。
- 斷線保存可重試；切換工作區、登出或刪除帳號前必須先 flush 成功。
- 邀請過期／撤銷／重複使用失敗；admin 不能管理 admin，只有 owner 可移轉所有權。
- 沒有 owner 的工作區不可產生；工作區／帳號刪除需密碼與明確確認字串。
- 刪除學生後，所有保留 D1／JSON revision 都不再含該 student ID。
- 舊資料正規化、魔王獎勵拆分與規則測試全部通過。
- `lint`、`test:rules`、`test:auth`、`test:server`、`test:d1-core`、`build`、Worker dry-run 全部通過。
