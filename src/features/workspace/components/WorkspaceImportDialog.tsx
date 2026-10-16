import { useId, useState } from 'react';
import { ModalDialog } from '../../../components/ModalDialog';
import type { Language } from '../../../store/types';
import type { WorkspaceImportReview } from '../hooks/useWorkspaceImportReview';
import type { WorkspaceImportImpact } from '../../../imports/workspaceImport';

type Props = {
  review: WorkspaceImportReview;
  language: Language;
  busy: boolean;
  error: string;
  returnFocusId?: string;
  onClose: () => void;
  onReplace: (confirmation: string, acknowledged: boolean) => void;
};

const impactText = (impact: WorkspaceImportImpact, zh: boolean) => zh
  ? `${impact.classes} 個班級（${impact.archived} 個已封存）、${impact.students} 位學生、${impact.evidence} 筆學習證據、${impact.exams} 份考試`
  : `${impact.classes} classes (${impact.archived} archived), ${impact.students} students, ${impact.evidence} evidence records and ${impact.exams} exams`;

/** Explicit high-risk confirmation for the existing complete-backup import. */
export const WorkspaceImportDialog = ({ review, language, busy, error, returnFocusId, onClose, onReplace }: Props) => {
  const titleId = useId();
  const descriptionId = useId();
  const cancelId = useId();
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const zh = language === 'zh';
  return <ModalDialog labelledBy={titleId} describedBy={descriptionId} initialFocusId={cancelId} returnFocusId={returnFocusId}
    onClose={onClose} closeDisabled={busy} className="max-w-lg rounded-2xl p-6 sm:p-7">
    <h2 id={titleId} className="font-serif text-2xl font-black text-slate-950">{zh ? '檢查工作區匯入' : 'Review workspace import'}</h2>
    <div id={descriptionId} className="mt-3 space-y-2 text-sm leading-7 text-slate-700">
      <p className="break-words font-bold">{review.workspaceName}</p>
      <p>{zh ? '目前資料：' : 'Current data: '}{impactText(review.currentImpact, zh)}</p>
      <p>{zh ? '備份資料：' : 'Backup data: '}{impactText(review.incomingImpact, zh)}</p>
    </div>
    <div className="mt-5 space-y-4 text-sm leading-7 text-rose-950">
      <p className="rounded-xl border border-rose-300 bg-rose-50 p-4">{zh
        ? '高風險操作：目前所有班級、學生、學習／考試與遊戲資料及設定都將由備份取代；備份中的封存狀態也會還原。被移除的班級與學生會從保留 revisions 清除，無法依靠 revision 復原。外部備份可能重新引入先前刪除的資料，請先確認授權與保存政策。原有稽核紀錄保留。'
        : 'High risk: the backup replaces all current classes, students, learning, exams, game data and settings, including archive status. Removed classes and students are purged from retained revisions and cannot be recovered there. External backups can reintroduce previously deleted data; verify authorization and retention policy. Existing audit records remain.'}</p>
      <label className="flex items-start gap-3 font-bold"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1.5" />{zh ? '我了解目前工作區資料會被取代及清除' : 'I understand current workspace data will be replaced and purged'}</label>
      <label className="block font-bold">{zh ? '輸入 IMPORT WORKSPACE' : 'Type IMPORT WORKSPACE'}<input value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-slate-900" /></label>
    </div>
    {error && <p role="alert" className="mt-4 text-sm font-bold text-rose-900">{error}</p>}
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <button id={cancelId} type="button" disabled={busy} onClick={onClose} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700">{zh ? '取消' : 'Cancel'}</button>
      <button type="button" disabled={busy || !acknowledged || confirmation !== 'IMPORT WORKSPACE'}
        onClick={() => onReplace(confirmation, acknowledged)} className="min-h-12 rounded-xl bg-rose-800 px-4 text-sm font-black text-white disabled:bg-slate-400">
        {busy ? zh ? '處理中…' : 'Processing…' : zh ? '確認取代工作區' : 'Confirm workspace replacement'}</button>
    </div>
  </ModalDialog>;
};
