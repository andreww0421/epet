import { useId, useState } from 'react';
import { LoaderCircle, ShieldAlert } from 'lucide-react';
import { CLASS_ARCHIVE_CONFIRMATIONS, CLASS_DELETE_CONFIRMATION, getClassDeletionImpact } from '../../../../shared/domain/classArchive';
import { ModalDialog } from '../../../components/ModalDialog';
import type { ClassData, Language } from '../../../store/types';
import type { ClassLifecycleAction } from '../hooks/useClassLifecycleAction';

type Props = {
  classroom: ClassData;
  action: ClassLifecycleAction;
  language: Language;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (confirmation: string, acknowledged: boolean) => void;
};

/** Confirmation UI only; lifecycle decisions and mutation authorization remain outside it. */
export const ClassLifecycleDialog = ({ classroom, action, language, busy, error, onClose, onConfirm }: Props) => {
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const titleId = useId();
  const impactId = useId();
  const cancelId = useId();
  const zh = language === 'zh';
  const deleting = action === 'delete';
  const phrase = deleting ? CLASS_DELETE_CONFIRMATION : CLASS_ARCHIVE_CONFIRMATIONS[action];
  const impact = getClassDeletionImpact(classroom);
  const title = deleting ? zh ? '永久刪除班級' : 'Permanently delete class'
    : action === 'archive' ? zh ? '確認封存班級' : 'Confirm class archive'
      : zh ? '確認重新開啟班級' : 'Confirm class reopening';
  const label = deleting ? zh ? '確認永久刪除' : 'Confirm permanent deletion'
    : action === 'archive' ? zh ? '確認封存' : 'Confirm archive'
      : zh ? '確認重新開啟' : 'Confirm reopen';
  return <ModalDialog labelledBy={titleId} describedBy={impactId} initialFocusId={cancelId} onClose={onClose} closeDisabled={busy} className="max-w-lg rounded-2xl p-6 sm:p-7">
    <ShieldAlert className={`h-8 w-8 ${deleting ? 'text-rose-700' : 'text-amber-800'}`} aria-hidden="true" />
    <h3 id={titleId} className="mt-3 font-serif text-2xl font-black text-slate-950">{title}</h3>
    <p className="mt-2 break-words text-sm font-black text-slate-800">{classroom.name}</p>
    <div id={impactId} className="mt-3 text-sm leading-7 text-slate-600">
      {deleting ? <>
        <p className="font-bold text-rose-900">{zh ? '這不是封存。刪除會永久移除整個班級，無法使用應用程式 revision 復原。' : 'This is not archiving. Deletion permanently removes the class and cannot be undone using application revisions.'}</p>
        <p className="mt-2">{zh
          ? `影響 ${impact.studentCount} 位學生、${impact.evidenceCount} 筆學習證據、${impact.examCount} 份考試，以及所有評語、目標、積分、處罰、對戰與魔王紀錄。資料也會從保留的應用程式 revision 清除；稽核資訊仍保留。`
          : `Affects ${impact.studentCount} students, ${impact.evidenceCount} evidence records and ${impact.examCount} exams, plus all comments, goals, points, discipline, battle and boss history. Retained application revisions are purged; audit information remains.`}</p>
        <p className="mt-2">{zh ? '建議先封存或下載核准的匯出。此操作不會撤回外部下載、列印或平台備份；至少保留一個使用中的班級。' : 'Prefer archiving or an approved export first. This does not recall external downloads, printouts or platform backups. At least one class must remain active.'}</p>
      </> : action === 'archive' ? <p>{zh
        ? '此班級將不再出現在日常教學與投影選單。學生、學習、考試分析與歷史資料仍保留；積分、對戰與魔王等教學操作會被拒絕，可日後重新開啟。伺服器會檢查權限、revision 並留下稽核紀錄；至少保留一個使用中的班級。'
        : 'The class leaves daily teaching and presentation selectors. Students, learning records, exam analytics and history remain available read-only. Points, battle and boss operations are rejected. It can be reopened later. The server checks authorization and revision and records an audit; at least one class must remain active.'}</p>
        : <p>{zh ? '還原會讓班級重新出現在日常教學與投影選單，原有資料保持不變。請確認保存政策與投影隱私設定。伺服器會檢查權限、revision 並留下稽核紀錄。' : 'Restoring returns the class to teaching and presentation selectors with its retained data. Review retention and presentation privacy settings. The server checks authorization and revision and records an audit.'}</p>}
    </div>
    {error && <p role="alert" className="mt-4 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm font-bold leading-6 text-rose-900">{error}</p>}
    {deleting && <label className="mt-5 flex items-start gap-3 text-sm font-bold leading-6 text-rose-950">
      <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
      {zh ? '我了解所有班級資料將永久刪除，且無法透過 revision 復原' : 'I understand all class data will be permanently deleted and cannot be recovered from revisions'}
    </label>}
    <label className="mt-5 block text-sm font-black text-slate-800">{zh ? '輸入 ' : 'Type '}{phrase}
      <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm" />
    </label>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <button id={cancelId} type="button" onClick={onClose} disabled={busy} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800 disabled:opacity-50">{zh ? '取消' : 'Cancel'}</button>
      <button type="button" onClick={() => onConfirm(confirmation, acknowledged)} disabled={busy || confirmation !== phrase || (deleting && !acknowledged)} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800 disabled:bg-slate-400 ${deleting ? 'bg-rose-800' : 'bg-cyan-900'}`}>
        {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}{busy ? zh ? '處理中…' : 'Processing…' : label}
      </button>
    </div>
  </ModalDialog>;
};
