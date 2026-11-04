# 工作區容量與同步重試

更新：2026-10-24。此契約對應 H04 本機修補；正式部署與環境驗收須另走發布流程。

## 容量契約

| 邊界 | 限制與行為 |
| --- | --- |
| D1 Workspace Snapshot | 正規化後的完整 Workspace JSON，以 UTF-8 計算，最多 **921,600 bytes（900 KiB）**；等於上限可儲存，超過回 `413 PAYLOAD_TOO_LARGE`，在 blob、revision、projection、audit 寫入前拒絕。 |
| 一般 HTTP Request Body | 保留原本 **2 MiB** 上限；既有較小入口的 **16 KiB** 上限也不變。請求可通過 HTTP 上限，仍可能超過 D1 Snapshot 上限。 |
| Node JSON Repository | 沒有新增 900 KiB 儲存限制；共用 HTTP／Runtime Schema／Revision 保護不變。不可據 Node 的成功推定 D1 能容納相同資料。 |
| 413 Metadata | 僅提供公開的 `limitBytes` 及 `limitKind: workspace_snapshot | request_body`。不回傳完整 Workspace、其他班級、合併後實際大小或內部錯誤。 |

前端只量測目前授權草稿的 JSON UTF-8 大小，標示「目前授權範圍草稿大小」。限班教師的資料不包含其他班，因此此數字不代表整個 Workspace 大小；D1 的 900 KiB 限制適用於 server 合併後的完整 Snapshot。沒有變更 Schema、容量上限、資料保留或自動刪除歷史。

## 重試政策

| 結果 | 自動處理 |
| --- | --- |
| 400／422 | 暫停，顯示資料驗證失敗；不重送相同無效草稿。 |
| 413 | 暫停，顯示容量訊息與安全的限制資訊；不重送相同超限草稿。 |
| 401／403 | 保留既有登入失效／撤權處理，隔離舊 Store 與草稿；不以重試繞過權限。 |
| 真實 Revision 409 | 保留原衝突恢復與 CAS；不強制覆寫。詳見[版本衝突恢復](workspace-conflict-recovery.md)。 |
| 網路／逾時、408／425／500／502／503／504／520–524 | 原始請求後最多 **5 次自動重試**，退避 1、2、5、10、30 秒；總共最多 6 次失敗寫入後暫停。 |
| 429 | 同樣有 5 次預算；等待 `max(退避, Retry-After)`，支援秒數及 HTTP 日期。手動重試、flush、重整不得提早重送。 |
| 其他 HTTP 錯誤 | 暫停為永久拒絕；例如 404／405／501 不當成斷線無限重試。 |

預算、暫停原因與下次允許時間保存於既有 v2 草稿的 optional `syncState`；舊 v2 草稿仍相容。重整或同 scope 重新登入不會重設失敗預算，也不會讓 400／413 再次自動送出。延遲超過安全 timer 或草稿剩餘 TTL 時暫停，不縮短 server deadline，也不讓 timer overflow 變成立即重送。讀取／重試不延長既有 24 小時 TTL。

暫時失敗預算耗盡後，可由使用者點「重試同步」開始新一輪有界重試；仍須遵守 Retry-After。容量／驗證／其他永久拒絕不提供重送相同草稿的按鈕。成功確認寫入後清除失敗狀態，新的合法修改使用新的 Revision；回應遺失的 idempotent 比對與 queued edit 保護仍保留。

## 教師與管理員操作

1. 遇到容量或驗證錯誤，畫面明確說明草稿仍保留且同步已停止；一般重新整理不代表同意丟棄。
2. 可確認「保留草稿並登出」，或確認保留後切換工作區。必須成功寫入原 user／workspace／role／class scope 的 sessionStorage，才能安全離開；儲存受限或 TTL 已過則拒絕宣告保留成功。
3. owner／admin 可「下載本機草稿」。下載前重新驗證 Session 與 exact scope；限班 teacher 不提供完整草稿下載。下載不等於授權匯入、不覆寫雲端。
4. 「採用雲端最新版本」須確認丟棄本機修改。先重新取得並驗證雲端與授權，再成功清除對應草稿，最後重設 Memory／Store 暫態、Queue、Timer、Request ID 與 Base Revision。讀取或 storage 清除失敗，草稿仍保留。
5. 採用後可繼續合法操作。若雲端本身仍接近上限，新增大量紀錄可能再次超限；管理員可先備份，再經資料治理工具清理及確認匯入較小資料。已保留的草稿可供管理員人工整合；匯入仍需權限、明確取代確認與 expected Revision，不能在暫停期間略過 flush 強行取代。

資料清理由使用者選擇內容，不自動刪除歷史、學生或其他班級以避開 413。採用雲端本身沒有寫入，也不覆寫其他使用者已保存資料。恢復後若有新的併發修改，原 409 保護繼續生效。

## 匯入、還原與限制

Import／Restore 在共用 Runtime Schema 與 repository 容量檢查後才寫入；400／413 明確顯示失敗，不自動重試，也不部分取代資料。超限的既有歷史版本保持原狀；不得透過 Restore 靜默裁切成可接受版本。必須由有權限者在備份、審查後匯入明確較小版本。

sessionStorage 不是跨裝置備份，關閉分頁、TTL 到期、瀏覽器清除或拒絕儲存均可能失去草稿。此修補沒有自動合併、容量預警／配額儀表板、增量寫入或儲存模型擴容；這些仍須獨立設計與容量驗收。D1 本機合成測試不能代替正式 Worker CPU／延遲／實際容量比例的測量。

驗證入口：`npm run test:sync-reliability`、`npm run test:e2e:capacity`、原有 Conflict／Draft／Data Safety／Permissions E2E 與 `npm run verify`。容量 E2E 固定本機 `127.0.0.1:3100`，使用真實 Miniflare D1、合成帳號與紀錄；詳見[商業化稽核 H04](commercial-readiness-audit.md)。
