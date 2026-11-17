import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CloudUpload } from 'lucide-react';
import type { BackendSyncStatus } from '../../../hooks/useBackendSync';
import type { AppData, Language } from '../../../store/types';
import { getStoreSessionGeneration, useStore } from '../../../store/useStore';
import type { ConsoleDestination } from '../../teacher-console/model/navigation';
import type { LearningWorkflowStep } from '../model/learningWorkflow';

type Props = {
  step: LearningWorkflowStep;
  language: Language;
  studentName?: string;
  readOnly: boolean;
  syncStatus: BackendSyncStatus;
  data: AppData;
  flushChanges: () => Promise<boolean>;
  onNavigate: (destination: ConsoleDestination) => void;
  onExamReport: () => void;
};

/** Connects the existing editors and reports without copying their data or calculations. */
export const LearningWorkflow = ({ step, language, studentName, readOnly, syncStatus, data, flushChanges, onNavigate, onExamReport }: Props) => {
  const english = language === 'en';
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [confirmedData, setConfirmedData] = useState<AppData | null>(null);
  const [failed, setFailed] = useState(false);
  const confirmSave = async () => {
    if (pending.current || readOnly) return;
    const generation = getStoreSessionGeneration();
    pending.current = true;
    setBusy(true);
    setFailed(false);
    setConfirmedData(null);
    try {
      const saved = await flushChanges();
      if (getStoreSessionGeneration() !== generation) return;
      if (saved && useStore.getState().data === data) setConfirmedData(data);
      else setFailed(true);
    } catch {
      if (getStoreSessionGeneration() === generation) setFailed(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const healthy = syncStatus === 'connected' || syncStatus === 'saving';
  const confirmed = healthy && confirmedData === data;
  const message = busy
    ? (english ? 'Confirming cloud save…' : '正在確認雲端保存')
    : confirmed ? (english ? 'Workspace changes are confirmed saved to the cloud.' : '工作區變更已確認保存至雲端')
      : failed || !healthy ? (english ? 'Cloud save is not confirmed. Your workspace draft is retained; check the sync message above.' : '尚未確認雲端保存。工作區草稿仍保留，請查看上方同步訊息。')
        : syncStatus === 'saving' ? (english ? 'Workspace changes are syncing. Keep this page open.' : '工作區變更正在同步，請保留此頁。')
          : (english ? 'Workspace changes autosave. Confirm cloud save before leaving or sharing reports.' : '工作區變更會自動同步；離開或分享報告前，可先確認雲端保存。');
  const steps = [
    { id: 'record', destination: 'evidence', label: english ? '1. Record learning' : '1. 記錄學習表現' },
    { id: 'progress', destination: 'trends', label: english ? '2. Review progress' : '2. 查看學習進度' },
    { id: 'report', destination: 'reports', label: english ? '3. Prepare feedback' : '3. 產生回饋報告' },
  ] as const;
  return (
    <section aria-label={english ? 'Learning workflow context' : '學習流程脈絡'} className="mb-5 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-slate-900">{english ? 'Record → Progress → Feedback' : '記錄 → 進度 → 回饋'}</h3>
        <p className="min-w-0 max-w-full break-words text-sm font-semibold text-indigo-900">{english ? 'Current learner: ' : '目前學生：'}{studentName || (english ? 'No learner selected' : '尚未選擇學生')}</p>
      </div>
      <nav aria-label={english ? 'Learning workflow' : '學習流程'} className="grid gap-2 sm:grid-cols-3">
        {steps.map((item) => (
          <button key={item.id} type="button" aria-current={item.id === step ? 'step' : undefined}
            disabled={readOnly && item.id === 'record'} onClick={() => onNavigate(item.destination)}
            className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 ${item.id === step ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            {item.label}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        ))}
      </nav>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {!readOnly && <button type="button" onClick={() => onNavigate('comments')} className="min-h-11 text-left text-sm font-semibold text-indigo-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-indigo-700">{english ? 'Record a daily comment' : '記錄每日評語'}</button>}
        <button type="button" onClick={onExamReport} className="min-h-11 text-left text-sm font-semibold text-indigo-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-indigo-700">{english ? 'Individual exam report' : '考試個別報告'}</button>
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-600">{english ? 'Daily comments already create linked evidence. Class weekly reports cover the whole class; individual PDFs use the selected learner and exam. Game points and pet levels are separate from learning assessments.' : '每日評語會自動連結學習證據，無須再輸入一次。班級週報涵蓋全班；個別 PDF 使用所選學生與考試。遊戲積分、寵物等級與學習評量分開。'}</p>
      {!readOnly && <div className="mt-3 border-t border-slate-200 pt-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p role="status" aria-live="polite" className={`flex items-start gap-2 text-sm ${failed || !healthy ? 'text-amber-900' : 'text-slate-700'}`}>
            {confirmed && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />}{message}
          </p>
          <button type="button" onClick={() => void confirmSave()} disabled={busy || !healthy} aria-busy={busy}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-indigo-700 px-3 py-2 text-sm font-bold text-indigo-900 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
            <CloudUpload className="h-4 w-4" aria-hidden="true" />{english ? 'Confirm cloud save' : '確認雲端保存'}
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-600"><span>{english ? 'Content still in a form must first be added using that form’s save button.' : '尚在表單中的內容，請先按各表單的保存按鈕。'}</span>{' '}{english ? 'This tab can recover form drafts from the last 30 minutes after the same account and permissions are reverified. Save before reloading or switching account or workspace.' : '此分頁在相同帳號及權限重新驗證後，可恢復 30 分鐘內的暫存。重整、切換帳號或工作區前請先保存。'}</p>
      </div>}
    </section>
  );
};
