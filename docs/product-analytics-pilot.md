# 產品分析試點：事件、隱私與啟用契約

更新日期：2026-11-03。程式與合成測試環境實作；Production 收集維持關閉。這份文件延伸既有 [v1 事件設計](product-analytics.md)，不取代遊戲、教育分析或安全稽核紀錄。

## 量測定義

依使用者最新決定，新增跨登入的新教師完成率，以第一方帳號層的最小 onboarding 狀態去重。匿名流程事件另計操作嘗試，不能當作獨立教師人數。

目前建立班級需要既有 owner／admin 權限。產品中的「新教師」指符合新帳號 cohort、具有建立權限且成功加入量測 cohort 的教學使用者，不是 RBAC 中所有 `teacher` 成員。一般 teacher 權限不提升。

| 指標 | 分母／起點 | 完成條件 | 限制 |
| --- | --- | --- | --- |
| 跨登入新教師首次建立班級 | 啟用 cutoff 以後建立、帳號建立 5 分鐘內、首次教學寫入前，成功 opt-in enroll 的帳號 | 已 enroll 帳號的合法 State PUT 實際新增非預設班級，成功保存後更新 `backendPersisted` | 同一帳號跨登入只算一次；無法辨識多人共用帳號。沒有 enroll 的新帳號不是分母，不可稱所有新教師完成率。 |
| 新教師開始／本機完成 | 上述 enroll cohort | 首次建立流程的 started／local_completed 已由第一方 API 收到 | 與後端證據獨立；失聯可使 localReported 少於 backendPersisted。 |
| 匿名班級建立、名冊匯入、加分、減分、新考試完成率 | 同一隨機 attempt 的 started | 本機命令接受／前端確認該命令資料存在於成功 PUT 回應 | 同步合併不是操作次數；確認不是安全稽核、exactly-once transaction 或獨立教師數。 |
| 每週／考試報告完成率 | 報告準備流程 started | CSV 準備／列印文件產生成功 | 後端儲存率不適用；不能證明使用者保存檔案或完成列印。 |
| 其他使用事件 | 事件接收總數 | workspace_created、learning_evidence_created、boss_started、feature_opened | 只留固定事件名／導覽 enum；不保留 v1 的學生數等 metadata。 |

匿名 class_context 的 `first` 只表示這次已驗證 scope 的記憶體生命週期內第一次明確開始建立班級；取消也用掉該次 first。不是帳號第一次、不由預設班級或學生資料推論、不跨登入去重。真正跨登入分母來自獨立 onboarding。

onboarding 是查詢當下該 cohort 的累積進度，沒有固定七日轉換窗口；剛加入的 cohort 仍在進行，不能直接與較老 cohort 比較。非阻塞 enrollment 若晚於第一次教學寫入，該帳號會被保守排除，不回填分母；這也是 coverage 限制。

## 資料邊界與架構

1. UI／Store 建立隨機 UUID v4 attempt，送 started；成功本機命令送 local_completed。取消、驗證拒絕與無法確認分開記錄。記憶體上限 16、15 分鐘 TTL，不存 browser storage。
2. 商業同步 sidecar 在正常 API 層驗證特定操作的資料見證；只有目前授權 scope、正確 generation、成功 revision 與回傳資料吻合才送 backend_acknowledged。它不把 AppData、班級／學生 ID 放進事件。409 的遠端等價不算新 ACK，舊 request 不能確認新命令；草稿恢復不重播事件。
3. `firstParty.ts` 重新 sanitize 後 POST 固定同源 `/api/v1/product-analytics`，omit credentials、no-referrer、禁止 redirect。每次上限 1.5 秒、16 in-flight、每分鐘 120；不重試、不持久排隊、錯誤吞掉且不記錄 payload。
4. Worker 在建立 auth repository／Sentry reporter 前處理 write-only collector。2 KiB body、1.5 秒讀取上限、JSON／Origin／Sec-Fetch-Site／無 query 檢查；DNT／GPC 先於 quota、body、DB。沒有讀取事件或全站報表的公開 API。
5. collector 只使用獨立 `ANALYTICS_DB`，沒有 business DB fallback。固定 server environment 必須與 MONITORING_ENVIRONMENT 一致。IP 僅在 isolate 中以每分鐘換 salt 的雜湊作有界配額；不持久化原始 IP、hash、Cookie 或 UA。120／client／分鐘、1200／isolate／分鐘不是全球分散式防濫用。
6. onboarding 使用正常 session、CSRF、Origin、workspace access 與 admin gate；API 只能讀寫自己的 state。既有帳號 key 留在第一方核心 DB，不進 collector、匿名事件或 aggregate report。另存 cohort UTC day 與 started／localReported／backendPersisted 三個 boolean；不存班級、學生、成績、Email 或事件內容。

onboarding enrollment 在 fresh verified scope 後執行，後續 callback 以 generation 防止跨帳號／切換 scope 重播。既有 cohort 可跨登入恢復；舊帳號、過期 enroll、已發生 state.put／privacy.import 的未 enroll 帳號不回填。DNT／GPC 同時在瀏覽器與伺服器檢查。新 opt-out 停止後續收集，不等於刪除已合法收到的資料。

後端 onboarding confirmation 是成功 business PUT 後的 best-effort background task；沒有把分析 SQL 放進 CAS／projection transaction。分析故障、缺表、延遲或 observer 拒絕不得改變教師的 200、revision、學生或班級資料。代價是 confirmation 可能遺失，因此此率是觀察到的完成率，不是完整帳務證據。匯入、restore、預設班級、未 enroll 帳號與失敗 CAS 不偽造完成。

## 彙總、保存與存取

匿名 attempt 的接收旗標單調、環境與 flow/context 固定；重複／亂序不捏造先前階段。24 小時後才進成熟分母，避免拿剛開始操作與成熟 cohort 混算。沒有 started 的 ACK 是 orphan。未成熟資料另列，沒有分母或受到抑制時 rate 為 null。

`ProductAnalyticsRepository.readReport` 只輸出每日／固定 flow/context 彙總；`summarizeProductOnboarding` 僅回傳每日 cohort counts，再經 `buildProductOnboardingReport` 抑制。兩者不接收／輸出學生或 account ID，沒有提供給一般 workspace 管理者的跨租戶全站查詢 endpoint。營運者仍須經核准的受限 DB／腳本存取；不能把原始 SQL 權限當成安全報表權限。

報表 privacy floor 為 k=10，只能提高；小正數與可推算的小補集會抑制整格。這不是 differential privacy：多次查詢、日期交集、其他外部資訊仍可能推測差異。限制 operator、固定發布週期、避免原始 query 分享，試點小樣本可整份不發布。

| 類別 | 實作／建議 | 啟用前必須確認 |
| --- | --- | --- |
| 匿名 attempt | 邏輯期限 24h；成功 bounded finalization 原子彙總＋刪除 | 不是硬性 24h 實體抹除 SLA。既有每日 Cron 只清 bounded batch，失敗或流量過大會 backlog；需依合成負載設定 cleanup 頻率／批次與 backlog 告警後才啟用。 |
| 每日匿名彙總 | cleanup 保留目前 UTC day＋前 29 天 | 刪除依成功 maintenance；若 Cron 未運作，不宣稱準時清除。 |
| 帳號 onboarding | 目前隨帳號刪除；沒有自動 90 天 purge | 建議試點目的結束／cohort 90 天後，先產出合規彙總，再核准有界清除；尚未實作／實測該 purge，不得聲稱已到期刪除。 |
| Backup／Time Travel | 不等同 live table deletion | 核對供應商保留期間與刪除／受控復原政策；復原後重做刪除與 projection 檢查，不承諾此功能可擦除所有平台備份。 |

重用／偽造 UUID、非瀏覽器偽造 Origin、公開 endpoint poisoning、瀏覽器阻擋、離線、配額、DNT／GPC 選擇偏差、async observer 遺失均會影響品質。nonce 刪除後不再全域去重；超時遲到 ACK 可變 orphan。沒有 visitor profile、DAU、session replay 或學生成績分析。

## 合成環境驗證與報表

執行 `npm run analytics:report:local`：固定新建 in-memory Miniflare D1，套用獨立 analytics migration，為七個流程建立合成資料，產出 `output/product-analytics/synthetic-report.json`。不接受 target、SQL、remote 或帳號參數；不讀 business DB。示範 onboarding 使用明確標示的固定 cohort aggregate counts，真實 Node／D1 帳號持久化由 regression tests 驗證。

執行 `npm run test:analytics`、`npm run verify` 及 `npx playwright test tests/e2e/product-analytics.spec.ts`。驗證結果與外部未完成事項記錄於 [商業化稽核](commercial-readiness-audit.md) 本次日期段落。測試必須保持既有 v1 privacy contract、合成 hook 不可進 deployment dist、RBAC／CSRF／revision 等斷言。

## 啟用與回復 Runbook（尚未執行）

目前兩份 Wrangler 設定 `PRODUCT_ANALYTICS_ENABLED=false`；沒有 `ANALYTICS_DB`、cutoff 或 Vite enable flag。既有 staging policy 明確拒絕私自啟用或加入額外 binding，不能只在 GitHub UI 設 flag 就視為可發布。

1. 管理員確認 app staging 先具備獨立 Worker／business D1。DR-only DB 不能代替 app staging；只建立 synthetic accounts／classes。
2. 經 privacy／營運核准 cohort 定義、告知、operator、保留／清除、平台 logs 與備份政策。不要開 Replay、autocapture 或 Sentry breadcrumbs 來補數據。
3. 在隔離 staging business DB 依既有 expand release policy 套 `migrations/0008_product_onboarding.sql`，歷史七份 SQL 與 ledger 不改。Node JSON 欄位為 optional，舊資料不回填。
4. 另外建立 staging 專用 analytics D1（建議 `epet-product-analytics-staging`），用專用 config 的 `ANALYTICS_DB` binding、`analytics-migrations` directory 套 `0001_product_analytics.sql`。不得向 production/business DB 套這份 SQL。記錄 UUID／帳戶／環境；不同環境和 business DB 的 UUID、名稱必須完全不同。
5. 在 reviewed PR 加入該可選 binding 的嚴格靜態 ID／名稱／環境隔離檢查、擴充現有 staging policy 的單 DB 限制與回歸測試。runtime 的物件不相等檢查無法證明兩個不同 binding 沒有指向同一遠端 UUID，必須檢查實際資源設定。現在未建置該遠端資源／啟用變更，這是明確 gate。
6. staging server 設 `PRODUCT_ANALYTICS_ENABLED=true`、`PRODUCT_ANALYTICS_ENVIRONMENT=staging`、`PRODUCT_ANALYTICS_COHORT_START=YYYY-MM-DD`（有效非未來 UTC 起始日）；建置對應 `VITE_PRODUCT_ANALYTICS_ENABLED=true`／`VITE_PRODUCT_ANALYTICS_ENVIRONMENT=staging`。client/server 必須同時核對；frontend-only flag 不算啟用成功。
7. 設定並實測 cleanup 容量／backlog、edge 分散式濫用配額、報表存取與失敗不含敏感資訊的告警；實測新的 synthetic 帳號 enroll、登出重登入同一列、成功建立班級、409、離線、DNT／GPC、分析 DB 故障、刪帳。報表 k 抑制不可關閉。
8. 必須有完整 staging evidence、privacy signoff、必要 Environment approval 與獨立 migration 核准後，才另提 Production 切換；本任務未建立 Production 資源、修改 Secrets、套 migration 或部署。

停止／回復：先關 client build flag 與 server enabled flag，阻止新收集並取消舊 scope 的本機 pending。保留 additive 表，不 drop／rollback D1 或重寫 migration ledger；必要時將 Worker 回復到與已擴充 schema 相容的已審版本。分析不可用時教師功能繼續運作；排查只看固定狀態／計數，不輸出 request body、Cookie、Token、學生資訊或 raw exception。保存政策所需清除另走核准程序，不能為修復數字重播使用者草稿或回填歷史學生資料。
