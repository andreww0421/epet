import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, ArrowDownToLine, Database, FileClock, LoaderCircle, ShieldAlert } from 'lucide-react';
import { MAX_STORED_REVISIONS } from '../../../../shared/domain/repositoryPolicy';
import { CLASS_ARCHIVE_CONFIRMATIONS, getActiveClasses, isArchivedClass } from '../../../../shared/domain/classArchive';
import { useAuth } from '../../../auth/AuthProvider';
import { ModalDialog } from '../../../components/ModalDialog';
import { exportWorkspacePrivacyData, manageClassArchive, type WorkspacePrivacyExport } from '../../../services/backendApi';
import type { ClassData, Language } from '../../../store/types';
import { useWorkspacePrivacyOperation } from '../hooks/useWorkspacePrivacyOperation';
import { downloadPrivacyJson } from '../model/privacyDownloads';

type WorkspaceDataPanelProps = {
  classes: ClassData[];
  language: Language;
  flushChanges: () => Promise<boolean>;
  onSensitiveActionComplete?: () => void;
};

/** Admin-only workspace export and an honest account of the implemented lifecycle. */
export const WorkspaceDataPanel = ({
  classes,
  language,
  flushChanges,
  onSensitiveActionComplete,
}: WorkspaceDataPanelProps) => {
  const { session } = useAuth();
  const { allowed, busy, error, execute } = useWorkspacePrivacyOperation(language, flushChanges);
  const [message, setMessage] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [classAction, setClassAction] = useState<{ kind: 'archive' | 'reopen'; classroom: ClassData } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const zh = language === 'zh';
  const archivedClasses = classes.filter(isArchivedClass);
  const activeClasses = getActiveClasses(classes);
  const classConfirmation = classAction ? CLASS_ARCHIVE_CONFIRMATIONS[classAction.kind] : '';

  useEffect(() => {
    setMessage('');
    setDownloadError('');
    setClassAction(null);
    setConfirmation('');
  }, [session?.activeWorkspaceId]);

  const exportWorkspace = async () => {
    if (!allowed || busy) return;
    setMessage('');
    setDownloadError('');
    const exported: { value?: WorkspacePrivacyExport } = {};
    const completed = await execute(async (workspaceId) => {
      const result = await exportWorkspacePrivacyData(workspaceId);
      if (result.activeWorkspace.id !== workspaceId) throw new Error('WORKSPACE_CHANGED');
      exported.value = result;
    }, false);
    if (!completed || !exported.value) return;
    try {
      downloadPrivacyJson(exported.value, `epet-workspace-privacy-${new Date().toISOString().slice(0, 10)}.json`);
      setMessage(zh
        ? '工作區檔案已產生；匯出動作已由伺服器記入稽核紀錄。'
        : 'Workspace file prepared. The server has recorded the export in the audit trail.');
      onSensitiveActionComplete?.();
    } catch {
      setDownloadError(zh
        ? '匯出已記入稽核，但瀏覽器下載未完成。請檢查下載設定後再試。'
        : 'The export was audited, but the browser download did not complete. Check download settings before retrying.');
    }
  };

  const closeClassAction = () => {
    if (busy) return;
    setClassAction(null);
    setConfirmation('');
  };

  const confirmClassAction = async () => {
    if (!classAction || busy) return;
    const phrase = CLASS_ARCHIVE_CONFIRMATIONS[classAction.kind];
    if (!allowed || confirmation !== phrase) return;
    const target = classAction;
    await execute((workspaceId, revision, data) => {
      const latestClass = data?.classes.find((item) => item.id === target.classroom.id);
      if (!latestClass || latestClass.name !== target.classroom.name ||
          isArchivedClass(latestClass) !== isArchivedClass(target.classroom)) {
        throw new Error('TARGET_CHANGED');
      }
      return manageClassArchive(target.classroom.id, target.kind,
        { expectedRevision: revision, confirmation }, workspaceId);
    });
  };

  if (!allowed) return <p role="alert" className="p-6 text-sm font-bold text-slate-700">
    {zh ? '只有目前工作區的管理員或擁有者可以管理資料。' : 'Only an admin or owner of the current workspace can manage data.'}
  </p>;

  return <div className="p-5 sm:p-7 lg:p-9">
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section aria-labelledby="workspace-data-export-title">
        <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-cyan-800">WORKSPACE DATA</p>
        <h3 id="workspace-data-export-title" className="mt-2 font-serif text-3xl font-black text-slate-950">
          {zh ? '工作區資料匯出' : 'Workspace data export'}
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          {zh
            ? '包含目前工作區的班級、學生、學習證據、評量結果與設定，以及匯出者與 revision 摘要。先同步最新變更，再由伺服器檢查權限並記錄匯出。'
            : 'Includes current workspace classes, students, learning evidence, assessment results and settings, plus exporter and revision summaries. Changes are synchronized before the server checks permission and records the export.'}
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-300 bg-slate-300">
          <div className="bg-white p-4"><dt className="text-xs font-bold text-slate-500">{zh ? '班級' : 'Classes'}</dt><dd className="mt-1 text-2xl font-black text-slate-950">{classes.length}</dd></div>
          <div className="bg-white p-4"><dt className="text-xs font-bold text-slate-500">{zh ? '學生' : 'Students'}</dt><dd className="mt-1 text-2xl font-black text-slate-950">{classes.reduce((sum, classroom) => sum + classroom.students.length, 0)}</dd></div>
        </dl>
        <button type="button" onClick={() => void exportWorkspace()} disabled={busy}
          className="mt-6 inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-slate-950 px-6 text-sm font-black text-white shadow-lg shadow-slate-900/10 transition hover:bg-cyan-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800 disabled:bg-slate-400">
          {busy ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <ArrowDownToLine className="h-5 w-5" aria-hidden="true" />}
          {busy ? zh ? '產生匯出檔…' : 'Preparing export…' : zh ? '下載工作區隱私資料 JSON' : 'Download workspace privacy JSON'}
        </button>
        {message && <p role="status" className="mt-4 text-sm font-bold leading-6 text-cyan-900">{message}</p>}
        {(downloadError || (error && !classAction)) && <p role="alert" className="mt-4 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm font-bold leading-6 text-rose-900">{downloadError || error}</p>}
      </section>
      <aside className="rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:p-6">
        <ShieldAlert className="h-7 w-7 text-amber-800" aria-hidden="true" />
        <h4 className="mt-3 text-base font-black text-slate-950">{zh ? '匯出後的保護責任' : 'Protect the exported copy'}</h4>
        <p className="mt-3 text-sm leading-7 text-amber-950">{zh
          ? '下載檔含敏感教育資料，請只儲存於核准的加密位置。不要放入公開分享、分析服務或一般雲端筆記；案件完成後依機構期限刪除。'
          : 'The file contains sensitive educational data. Store it only in an approved encrypted location. Do not publish it or upload it to analytics services or general cloud notes; remove it according to your institution’s retention rules.'}</p>
        <p className="mt-3 text-xs leading-6 text-amber-950">{zh
          ? '伺服器上的刪除或匿名化，不會撤回已下載、列印或由其他系統保存的副本。'
          : 'Server deletion or anonymization does not recall downloaded, printed or externally stored copies.'}</p>
      </aside>
    </div>

    <section aria-labelledby="workspace-retention-title" className="mt-8 border-t border-slate-300 pt-7">
      <h3 id="workspace-retention-title" className="flex items-center gap-2 text-xl font-black text-slate-950"><FileClock className="h-5 w-5 text-cyan-800" aria-hidden="true" />{zh ? '目前資料保存行為' : 'Current retention behavior'}</h3>
      <dl className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-300 bg-white p-5"><dt className="font-black text-slate-950">{zh ? 'Revision 復原紀錄' : 'Revision recovery history'}</dt><dd className="mt-2 text-sm leading-7 text-slate-600">{zh ? `每個工作區最多保留 ${MAX_STORED_REVISIONS} 個 revision；這是版本數上限，不是 ${MAX_STORED_REVISIONS} 天。` : `Each workspace retains at most ${MAX_STORED_REVISIONS} revisions. This is a version-count limit, not ${MAX_STORED_REVISIONS} days.`}</dd></div>
        <div className="rounded-xl border border-slate-300 bg-white p-5"><dt className="font-black text-slate-950">{zh ? '使用中資料與稽核紀錄' : 'Live data and audit records'}</dt><dd className="mt-2 text-sm leading-7 text-slate-600">{zh ? '目前沒有自動依資料年齡刪除班級、學生或稽核紀錄的期限。機構需訂定保存政策，並由有權限的人員處理資料請求。' : 'No automatic age-based expiry is currently configured for classes, students or audit records. Institutions must define a retention policy and have authorized staff handle data requests.'}</dd></div>
      </dl>
      <p className="mt-4 flex items-start gap-2 text-xs leading-6 text-slate-600"><Database className="mt-1 h-4 w-4 shrink-0 text-cyan-800" aria-hidden="true" />{zh ? '平台備份、復原窗口及外部副本有各自的保存機制；此介面不承諾即時清除 Cloudflare 備份或任何外部副本。' : 'Platform backups, recovery windows and external copies have separate retention mechanisms. This interface does not promise immediate erasure of Cloudflare backups or external copies.'}</p>
    </section>

    <section aria-labelledby="archived-classes-title" className="mt-8 border-t border-slate-300 pt-7">
      <h3 id="archived-classes-title" className="flex items-center gap-2 text-xl font-black text-slate-950"><Archive className="h-5 w-5 text-cyan-800" aria-hidden="true" />{zh ? '封存班級' : 'Archived classes'}</h3>
      <p className="mt-3 text-sm leading-7 text-slate-600">{zh
        ? '封存會將班級移出日常教學與公開投影的選單，以唯讀快照保留學生、學習與遊戲資料（不執行自動寵物衰減），仍包含於匯出與保存政策中。封存不是刪除，可由管理員或擁有者重新開啟。'
        : 'Archiving removes a class from daily teaching and public display selectors and keeps student, learning and game data as a read-only snapshot (without automatic pet decay). Archived data remains included in exports and retention policy. Archiving is not deletion; an admin or owner can reopen the class.'}</p>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="active-class-list-title">
          <h4 id="active-class-list-title" className="text-sm font-black text-slate-800">{zh ? '使用中的班級' : 'Active classes'} · {activeClasses.length}</h4>
          <ul className="mt-3 space-y-3">{activeClasses.map((classroom) => <li key={classroom.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white p-4">
            <div className="min-w-0"><p className="break-words text-sm font-black text-slate-950">{classroom.name}</p><p className="mt-1 text-xs text-slate-500">{classroom.students.length} {zh ? '位學生' : 'students'}</p></div>
            <button type="button" disabled={busy || activeClasses.length <= 1} aria-label={`${zh ? '封存班級' : 'Archive class'} ${classroom.name}`} onClick={() => { setClassAction({ kind: 'archive', classroom }); setConfirmation(''); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 hover:border-cyan-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800 disabled:opacity-50"><Archive className="h-4 w-4" aria-hidden="true" />{zh ? '檢查封存影響' : 'Review archive'}</button>
          </li>)}</ul>
          {activeClasses.length <= 1 && <p className="mt-3 text-xs leading-6 text-slate-600">{zh ? '至少保留一個使用中的班級。' : 'At least one class must remain active.'}</p>}
        </section>
        <section aria-labelledby="archived-class-list-title">
          <h4 id="archived-class-list-title" className="text-sm font-black text-slate-800">{zh ? '已封存班級' : 'Archived classes'} · {archivedClasses.length}</h4>
          {archivedClasses.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-slate-400 bg-white/60 p-5 text-sm text-slate-600">{zh ? '目前沒有封存班級。' : 'There are no archived classes.'}</p> : <ul className="mt-3 space-y-3">{archivedClasses.map((classroom) => <li key={classroom.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-300 bg-[#dfd8c8]/40 p-4">
            <div className="min-w-0"><p className="break-words text-sm font-black text-slate-950">{classroom.name}</p><p className="mt-1 text-xs text-slate-600">{classroom.students.length} {zh ? '位學生 · 資料仍保留' : 'students · data retained'}</p></div>
            <button type="button" disabled={busy} aria-label={`${zh ? '重新開啟班級' : 'Reopen class'} ${classroom.name}`} onClick={() => { setClassAction({ kind: 'reopen', classroom }); setConfirmation(''); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-400 bg-white px-4 text-sm font-black text-slate-700 hover:border-cyan-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800 disabled:opacity-50"><ArchiveRestore className="h-4 w-4" aria-hidden="true" />{zh ? '重新開啟' : 'Reopen'}</button>
          </li>)}</ul>}
        </section>
      </div>
    </section>
    {classAction && <ModalDialog labelledBy="class-lifecycle-title" describedBy="class-lifecycle-impact" onClose={closeClassAction} closeDisabled={busy} className="max-w-lg rounded-2xl p-6 sm:p-7">
      <ShieldAlert className="h-8 w-8 text-amber-800" aria-hidden="true" />
      <h3 id="class-lifecycle-title" className="mt-3 font-serif text-2xl font-black text-slate-950">{classAction.kind === 'archive' ? zh ? '確認封存班級' : 'Confirm class archive' : zh ? '確認重新開啟班級' : 'Confirm class reopening'}</h3>
      <p className="mt-2 break-words text-sm font-black text-slate-800">{classAction.classroom.name}</p>
      <p id="class-lifecycle-impact" className="mt-3 text-sm leading-7 text-slate-600">{classAction.kind === 'archive'
        ? zh ? '此班級將不再出現在日常教學與投影選單。所有學生、學習、評量與遊戲資料仍保留，可日後重新開啟。伺服器會檢查權限、檢查 revision 並記錄操作；至少保留一個使用中的班級。' : 'The class will no longer appear in daily teaching or presentation selectors. All student, learning, exam and game data is retained and can be reopened later. The server checks permission and revision and records the action; at least one class must remain active.'
        : zh ? '此班級會重新出現在日常教學與投影選單，原有資料保持不變。請確認重新使用符合目前的保存政策與投影隱私設定。伺服器會檢查權限、檢查 revision 並記錄操作。' : 'The class will return to daily teaching and presentation selectors with its existing data unchanged. Confirm that reopening meets current retention policy and presentation privacy settings. The server checks permission and revision and records the action.'}</p>
      {error && <p role="alert" className="mt-4 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm font-bold leading-6 text-rose-900">{error}</p>}
      <label className="mt-5 block text-sm font-black text-slate-800">{zh ? '輸入 ' : 'Type '}{classConfirmation}
        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm" />
      </label>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button autoFocus type="button" onClick={closeClassAction} disabled={busy} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800 disabled:opacity-50">{zh ? '取消' : 'Cancel'}</button>
        <button type="button" onClick={() => void confirmClassAction()} disabled={busy || confirmation !== classConfirmation} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-900 px-4 text-sm font-black text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800 disabled:bg-slate-400">{busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}{busy ? zh ? '處理中…' : 'Processing…' : classAction.kind === 'archive' ? zh ? '確認封存' : 'Confirm archive' : zh ? '確認重新開啟' : 'Confirm reopen'}</button>
      </div>
    </ModalDialog>}
  </div>;
};
