# 工作區版本衝突恢復

更新：2026-10-23。H03 本機修補與驗證完成；尚未部署，正式環境發布狀態以稽核報告為準。

多人同時修改同一工作區時，先儲存成功的版本保留在雲端；使用舊 Revision 的另一筆修改會收到 HTTP 409。系統保留該分頁尚未同步的草稿，暫停編輯與重送，不會自動合併或覆寫雲端。

## 使用者操作

看到「資料版本衝突」後，可選擇：

1. **保留草稿，稍後處理。** 留在此頁不會丟棄修改。可選「保留草稿並登出」，或透過工作區選單切換；系統會要求確認保留草稿，成功寫入此分頁的 sessionStorage 後才離開。取消則留在原工作區。回到原工作區／重新登入時，只有相同帳號、角色及班級權限，且在最後編輯 24 小時內，才能恢復此草稿；真正衝突仍需選擇採用雲端版本。
2. **下載備份。** Owner／Admin 可下載目前草稿，下載前重新驗證目前帳號、工作區、角色與班級權限。Teacher／Viewer 不提供完整工作區草稿下載；Teacher 的正常班級報表仍依原本授權範圍匯出。下載不會自動丟棄或提交草稿，也不會把草稿變成強制覆寫的匯入權限。
3. **採用雲端最新版本。** 點擊後會顯示明確的丟棄確認；若需要原修改，先備份或取消。確認後，系統重新取得並驗證雲端版本，成功清除本工作區這個授權範圍的草稿後，才載入雲端資料並恢復編輯。其他使用者／工作區／權限範圍的草稿不會被清除。

採用雲端後可重新進行需要的操作；新的修改會以新 Revision 正常 Autosave。採用動作本身只讀取雲端，不寫入、不建立新 Revision，也不覆寫另一位使用者的更新。若讀取後又有人成功儲存，下一次修改仍可能收到新的 409，需再次選擇恢復方式。

## 失敗與資料保留

- 一般重新整理會保留並重新驗證草稿，不能視為「同意丟棄」。衝突狀態仍提供採用雲端的入口，不再用無限重新整理作為恢復方式。
- 採用過程若網路中斷，草稿、Store 及原 Base Revision 保留，可重試。若 session 失效或權限改變，立即撤銷舊畫面的讀寫與下載權限，草稿留在原 namespace 隔離，不能由降權者載入。
- 瀏覽器若拒絕刪除舊草稿，採用操作不宣告成功，不會讓舊草稿在重整後悄悄復活；保留草稿並提示檢查瀏覽器儲存權限後重試。
- 瀏覽器若拒絕保存草稿，仍有目前文件的記憶體 fallback，但不能保證重新整理／關閉分頁後留存。保留草稿的登出／切換會被拒絕並說明原因；請保持此分頁開啟，修復儲存權限或由有權限者下載後再處理。
- 草稿使用 sessionStorage，請勿關閉分頁；讀取／重試不延長 24 小時期限。此功能不是跨裝置備份，也不是多人自動合併。
- 一般離線／尚在寫入的操作仍須完成原有 flush。後續 H04 對容量／驗證永久拒絕及重試耗盡提供明確暫停與受控保留；完整政策見[工作區容量與同步重試](workspace-capacity-and-retry.md)。

## 技術契約

`useBackendSync` 的 `adoptRemote` 只在已載入且確定衝突，或 H04 已明確暫停的失敗狀態執行，並拒絕重複恢復。先停止 debounce／retry、等待已發出的寫入結束，再以固定 workspace／expected user 讀取 `/state`，驗證 server-derived access 與目前 exact scope 相同；不直接信任舊 409 snapshot 作恢復授權。

遠端資料可安全載入且草稿移除成功後，才解除 Store 訂閱、清除 pending／in-flight queue、舊 request ID 與 retry 狀態，重設 Store 的資料及學生相關暫態／undo，更新 session generation 與 Base Revision，再重新建立訂閱。此順序同時支援「正在使用時遇到 409」及「重新整理後恢復衝突草稿」兩條路徑，不會把 hydration 當成新的本機修改。舊下載的成功與失敗結果都受 generation／草稿生命週期約束，不能在完成恢復後回傳已丟棄的草稿，或把新畫面改回離線／撤銷新 session。

`preserveConflictDraft` 允許明確衝突或 H04 已暫停的草稿，在原身分／工作區／scope namespace 成功寫入 storage 後供已確認的導覽使用。`clearPendingDraft` 回報 storage 移除是否成功；移除失敗時不刪除較新的記憶體 fallback。

沒有修改 AppData、server Revision／CAS、資料庫 Schema、CSRF、RBAC 或 Tenant Isolation 契約。舊 v2 草稿繼續相容；缺少可信身分的 v1 草稿仍依 M01 隔離，不自動遷移或歸屬。

驗證入口：`npm run test:draft-security`、`npm run test:e2e -- tests/e2e/conflict-recovery.spec.ts tests/e2e/data-safety.spec.ts tests/e2e/draft-recovery.spec.ts`、`npm run verify`。實際結果與證據記錄於 `commercial-readiness-audit.md` 的 H03。
