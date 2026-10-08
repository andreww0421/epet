import { ArrowUpRight, Database, FileClock, Monitor, ShieldCheck } from 'lucide-react';
import { MAX_STORED_REVISIONS } from '../../../../shared/domain/repositoryPolicy';
import { useAuth } from '../../../auth/AuthProvider';
import { canAdministerWorkspace } from '../../../auth/workspaceAccess';
import type { AppData, Language } from '../../../store/types';

type PrivacyInformationPanelProps = {
  language: Language;
  settings: AppData['settings'];
  onOpenDisplaySettings: () => void;
};

/** Explains the real storage boundary; links to the one existing settings owner. */
export const PrivacyInformationPanel = ({
  language,
  settings,
  onOpenDisplaySettings,
}: PrivacyInformationPanelProps) => {
  const { session, status } = useAuth();
  const workspace = session?.workspaces.find((item) => item.id === session.activeWorkspaceId);
  const allowed = status === 'authenticated' && canAdministerWorkspace(workspace?.role);
  const zh = language === 'zh';

  if (!allowed) return <p role="alert" className="p-6 text-sm font-bold text-slate-700">
    {zh ? '只有目前工作區的管理員或擁有者可以管理隱私。' : 'Only an admin or owner of the current workspace can manage privacy.'}
  </p>;

  return <div className="space-y-8 p-5 sm:p-7 lg:p-9">
    <section aria-labelledby="privacy-storage-title">
      <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-cyan-800">PRIVACY BOUNDARIES</p>
      <h3 id="privacy-storage-title" className="mt-2 flex items-center gap-3 font-serif text-3xl font-black text-slate-950"><Database className="h-6 w-6 shrink-0 text-cyan-800" aria-hidden="true" />{zh ? '資料儲存說明' : 'How data is stored'}</h3>
      <p className="mt-3 text-sm leading-7 text-slate-600">{zh
        ? '正式環境由 Cloudflare Worker 處理已驗證的請求，工作區教育資料儲存於對應的 D1 database。本機開發使用檔案 repository；staging 與正式環境使用不同資源，不應共用正式學生資料。'
        : 'In production, Cloudflare Worker handles authenticated requests and workspace educational data is stored in the corresponding D1 database. Local development uses a file repository. Staging and production use separate resources and must not share production student data.'}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-slate-300 bg-white p-5">
          <h4 className="text-sm font-black text-slate-950">{zh ? '瀏覽器與同步草稿' : 'Browser and synchronization drafts'}</h4>
          <p className="mt-2 text-sm leading-7 text-slate-600">{zh
            ? '已載入的資料會存在瀏覽器記憶體；一般本機長期快取預設關閉。為避免同步失敗造成資料遺失，未同步的工作區草稿目前會暫存於此分頁的 session storage，完成同步或登出後移除。部署若另外啟用本機資料快取，也會產生長期瀏覽器副本。'
            : 'Loaded data exists in browser memory; normal persistent local caching is disabled by default. To prevent data loss during synchronization failures, unsynchronized workspace drafts currently use this tab’s session storage and are removed after synchronization or sign-out. A deployment that explicitly enables local data caching also creates persistent browser copies.'}</p>
          <p className="mt-3 text-xs font-bold leading-6 text-amber-900">{zh
            ? '不要共用已登入的瀏覽器帳號。學校共用裝置應登出並遵循機構的瀏覽器資料清除政策。'
            : 'Do not share a signed-in browser account. Sign out on shared school devices and follow your institution’s browser-data clearing policy.'}</p>
        </article>
        <article className="rounded-xl border border-slate-300 bg-white p-5">
          <h4 className="text-sm font-black text-slate-950">{zh ? '下載與外部服務' : 'Downloads and external services'}</h4>
          <p className="mt-2 text-sm leading-7 text-slate-600">{zh
            ? '匯出、列印與報告是由使用者保存的副本，不會隨伺服器刪除自動撤回。產品使用分析與錯誤監控有集中式資料清理，不應傳送學生姓名、評量分數、導師評語、學習證據內容或驗證 token。'
            : 'Exports, prints and reports are user-held copies and are not recalled by server deletion. Product analytics and error monitoring use centralized data filtering and must not send student names, exam scores, teacher comments, learning-evidence content or authentication tokens.'}</p>
        </article>
      </div>
    </section>

    <section aria-labelledby="privacy-retention-title" className="border-t border-slate-300 pt-7">
      <h3 id="privacy-retention-title" className="flex items-center gap-2 text-xl font-black text-slate-950"><FileClock className="h-5 w-5 text-cyan-800" aria-hidden="true" />{zh ? '資料保存政策' : 'Data retention policy'}</h3>
      <div className="mt-4 border-l-4 border-amber-500 bg-amber-50 px-5 py-4 text-sm leading-7 text-amber-950">
        {zh
          ? `目前每個工作區最多保留 ${MAX_STORED_REVISIONS} 個 revision，並沒有依天數自動刪除使用中資料或稽核紀錄的期限。這不是機構的法律保存承諾；正式保存與稽核期限須由工作區擁有者依機構政策確認。`
          : `Each workspace currently retains at most ${MAX_STORED_REVISIONS} revisions; there is no automatic age-based expiry for live data or audit records. This is not a legal retention commitment. Workspace owners must confirm operational and audit retention periods under their institution’s policy.`}
      </div>
      <p className="mt-4 text-sm leading-7 text-slate-600">{zh
        ? '班級封存只是停止日常使用，不會刪除資料。刪除與匿名化的具體影響，請在「學生資料」操作前逐項檢查。雲端備份、復原窗口與已下載副本有不同保存機制，本介面不承諾立即清除全部外部副本。'
        : 'Class archiving stops daily use but does not delete data. Review the exact deletion and anonymization scope in Student data before acting. Cloud backups, recovery windows and downloaded copies use separate retention mechanisms; this interface does not promise immediate erasure of every external copy.'}</p>
    </section>

    <section aria-labelledby="privacy-display-title" className="border-t border-slate-300 pt-7">
      <h3 id="privacy-display-title" className="flex items-center gap-2 text-xl font-black text-slate-950"><Monitor className="h-5 w-5 text-cyan-800" aria-hidden="true" />{zh ? '教室公開投影設定' : 'Classroom public display settings'}</h3>
      <p className="mt-3 text-sm leading-7 text-slate-600">{zh
        ? '請使用明確的投影模式給全班觀看；投影只顯示允許的學生名稱與遊戲展示資料，不顯示私人紀錄、詳細評量結果、導師分析、帳號或工作區管理。退出投影須再次確認，姓名遮罩與包容性選項只能加強工作區的隱私限制。'
        : 'Use explicit presentation mode for whole-class projection. It displays only allowed student names and game presentation data, excluding private records, detailed exams, teacher analytics, account settings and workspace administration. Leaving presentation requires confirmation, and local masking or inclusive options can only strengthen workspace privacy limits.'}</p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-300 bg-white p-5"><dt className="text-xs font-bold text-slate-500">{zh ? '已儲存的學生姓名設定' : 'Saved student-name setting'}</dt><dd className="mt-2 text-base font-black text-slate-950">{settings?.publicNameMode === 'full' ? zh ? '完整姓名' : 'Full names' : zh ? '姓名遮罩' : 'Masked names'}</dd></div>
        <div className="rounded-xl border border-slate-300 bg-white p-5"><dt className="text-xs font-bold text-slate-500">{zh ? '已儲存的排行榜設定' : 'Saved leaderboard setting'}</dt><dd className="mt-2 text-base font-black text-slate-950">{settings?.publicLeaderboardMode === 'rank' ? zh ? '遊戲排名' : 'Game ranking' : settings?.publicLeaderboardMode === 'growth' ? zh ? '包容性展示' : 'Inclusive display' : zh ? '隱藏排行榜' : 'Hidden leaderboard'}</dd></div>
      </dl>
      {settings?.inclusiveMode !== false && <p className="mt-4 flex items-start gap-2 text-sm font-bold leading-7 text-cyan-900"><ShieldCheck className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />{zh ? '包容性教育模式已啟用：投影會強制姓名遮罩與非競爭性展示，不會因上述草稿或投影選項解除。' : 'Inclusive education mode is enabled: presentation enforces masked names and non-competitive display; settings drafts or local presentation options cannot lift these limits.'}</p>}
      <button type="button" onClick={() => { if (allowed) onOpenDisplaySettings(); }} className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-cyan-800 bg-white px-5 text-sm font-black text-cyan-950 transition hover:bg-cyan-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800">
        {zh ? '管理學生顯示與隱私設定' : 'Manage student visibility and privacy settings'}<ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </button>
      <p className="mt-3 text-xs leading-6 text-slate-600">{zh ? '變更設定後請按「儲存設定」，完成同步後再開始公開投影。' : 'After changing settings, select Save settings and finish synchronization before starting public presentation.'}</p>
    </section>
  </div>;
};
