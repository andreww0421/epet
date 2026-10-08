import { useId, useState } from 'react';
import { ArrowDownToLine, LoaderCircle, ShieldAlert, Trash2, UserRoundCog } from 'lucide-react';
import { STUDENT_PRIVACY_CONFIRMATIONS, type StudentPrivacyAction } from '../../../../shared/domain/studentPrivacy';
import { isArchivedClass } from '../../../../shared/domain/classArchive';
import { ModalDialog } from '../../../components/ModalDialog';
import { exportStudentPrivacyData, manageStudentPrivacy } from '../../../services/backendApi';
import type { ClassData, Language } from '../../../store/types';
import { useWorkspacePrivacyOperation } from '../hooks/useWorkspacePrivacyOperation';
import { downloadPrivacyJson } from '../model/privacyDownloads';

type Props = { classes: ClassData[]; language: Language; flushChanges: () => Promise<boolean> };
type ReviewedStudent = { classId: string; studentId: string; name: string; action: StudentPrivacyAction };

/** Scoped exports and reviewed privacy operations, separate from teacher roster editing. */
export const StudentDataPanel = ({ classes, language, flushChanges }: Props) => {
  const en = language === 'en';
  const { allowed, busy, error, execute } = useWorkspacePrivacyOperation(language, flushChanges);
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [studentId, setStudentId] = useState(classes[0]?.students[0]?.id ?? '');
  const [review, setReview] = useState<ReviewedStudent | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [message, setMessage] = useState('');
  const titleId = useId();
  const descriptionId = useId();
  const classroom = classes.find((item) => item.id === classId) ?? classes[0];
  const student = classroom?.students.find((item) => item.id === studentId) ?? classroom?.students[0];
  if (!allowed) return <p role="alert">{en ? 'Owner or admin access is required.' : '僅限工作區擁有者或管理員使用。'}</p>;

  const beginReview = (action: StudentPrivacyAction) => {
    if (!classroom || !student || busy) return;
    setMessage('');
    setUnderstood(false);
    setConfirmation('');
    setReview({ classId: classroom.id, studentId: student.id, name: student.name, action });
  };
  const confirm = async () => {
    if (!review || !understood || confirmation !== STUDENT_PRIVACY_CONFIRMATIONS[review.action]) return;
    const target = review;
    await execute((workspaceId, expectedRevision, data) => {
      const latestStudent = data?.classes.find((item) => item.id === target.classId)
        ?.students.find((item) => item.id === target.studentId);
      if (!latestStudent || latestStudent.name !== target.name) throw new Error('TARGET_CHANGED');
      return manageStudentPrivacy(target.classId, target.studentId, target.action,
        { expectedRevision, confirmation }, workspaceId);
    });
  };
  const exportStudent = async () => {
    if (!classroom || !student) return;
    const target = { classId: classroom.id, studentId: student.id };
    let exported: Awaited<ReturnType<typeof exportStudentPrivacyData>> | undefined;
    const completed = await execute(async (workspaceId) => {
      exported = await exportStudentPrivacyData(target.classId, target.studentId, workspaceId);
    }, false);
    if (completed && exported) {
      try {
        downloadPrivacyJson(exported, `epet-student-export-${new Date().toISOString().slice(0, 10)}.json`);
        setMessage(en ? 'Scoped JSON downloaded. The server recorded the export in the audit trail.' : '已下載限縮 JSON，伺服器已記錄此次匯出。');
      } catch {
        setMessage(en ? 'The export was audited, but the browser download did not complete. Check download settings before retrying.' : '匯出已記入稽核，但瀏覽器下載未完成。請檢查下載設定後再試。');
      }
    }
  };

  return <div className="space-y-6 p-5 sm:p-8">
    <header>
      <h3 className="font-serif text-2xl font-black">{en ? 'Student data requests' : '學生資料請求'}</h3>
      <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">{en ? 'Verify the requester and school authorization first. Exports contain only the selected student. Privacy operations are checked and audited on the server.' : '請先驗證請求人身分與校方授權。匯出只包含所選學生；刪除與匿名化皆由伺服器檢查權限並留下稽核紀錄。'}</p>
    </header>
    <div className="grid gap-4 rounded-2xl border border-slate-300 bg-white p-5 sm:grid-cols-2">
      <label className="text-sm font-bold">{en ? 'Class' : '班級'}
        <select value={classroom?.id ?? ''} disabled={busy} onChange={(event) => {
          const selected = classes.find((item) => item.id === event.target.value);
          setClassId(event.target.value); setStudentId(selected?.students[0]?.id ?? ''); setMessage('');
        }} className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3">
          {classes.map((item) => <option key={item.id} value={item.id}>{item.name}{isArchivedClass(item) ? (en ? ' (archived)' : '（已封存）') : ''}</option>)}
        </select>
      </label>
      <label className="text-sm font-bold">{en ? 'Student' : '學生'}
        <select value={student?.id ?? ''} disabled={busy || !classroom?.students.length} onChange={(event) => { setStudentId(event.target.value); setMessage(''); }} className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3">
          {(classroom?.students ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {!student && <p className="text-sm text-slate-600 sm:col-span-2">{en ? 'No student is available in this class.' : '目前班級沒有可處理的學生。'}</p>}
    </div>
    <div className="rounded-2xl border border-cyan-300 bg-cyan-50 p-5">
      <h4 className="font-black">{en ? 'Export one student' : '匯出單一學生資料'}</h4>
      <p className="mt-2 text-sm leading-6 text-cyan-950">{en ? 'Includes the selected profile, educational records and boss participation; excludes other students. Keep downloads in an approved encrypted location and delete them when the request is complete.' : '包含所選學生的狀態、教學紀錄與魔王參與，不包含其他學生。下載檔應保存在核准的加密位置，案件完成後依期限刪除。'}</p>
      <button type="button" onClick={() => void exportStudent()} disabled={busy || !student} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:bg-slate-400">
        <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />{en ? 'Download scoped JSON' : '下載限縮 JSON'}
      </button>
      <dl aria-label={en ? 'Export manifest preview' : '匯出範圍預覽'} className="mt-5 grid gap-4 rounded-xl border border-cyan-200 bg-white p-4 text-sm sm:grid-cols-2">
        <div><dt className="font-bold text-slate-600">{en ? 'Class' : '班級'}</dt><dd className="mt-1 break-words">{classroom?.name ?? '—'}</dd></div>
        <div><dt className="font-bold text-slate-600">{en ? 'Student ID' : '學生識別碼'}</dt><dd className="mt-1 break-all font-mono">{student?.id ?? '—'}</dd></div>
        <div><dt className="font-bold text-slate-600">{en ? 'Evidence records' : '學習證據'}</dt><dd className="mt-1">{student ? (classroom?.learningEvidenceRecords ?? []).filter((record) => record.studentId === student.id).length : 0}</dd></div>
        <div><dt className="font-bold text-slate-600">{en ? 'Assessments' : '評量'}</dt><dd className="mt-1">{student ? (classroom?.examRecords ?? []).filter((exam) => exam.results.some((result) => result.studentId === student.id)).length : 0}</dd></div>
      </dl>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-2xl border border-amber-400 bg-amber-50 p-5">
        <h4 className="flex items-center gap-2 font-black"><UserRoundCog className="h-5 w-5" aria-hidden="true" />{en ? 'Anonymize student' : '匿名化學生'}</h4>
        <p className="mt-3 text-sm leading-7 text-amber-950">{en ? 'Replace the name and identifier; remove this student’s assessment results, evidence and identifying free text. Pet/game values and numeric safety history remain. This is structured de-identification, not a guarantee against re-identification.' : '更換姓名與識別碼，移除此學生的考試結果、學習證據與可能識別身分的自由文字。保留寵物／遊戲數值及數值型安全紀錄。這是結構化去識別化，不能保證無法重新識別。'}</p>
        <button type="button" onClick={() => beginReview('anonymize')} disabled={busy || !student} className="mt-4 min-h-12 rounded-xl border border-amber-600 bg-white px-4 text-sm font-black text-amber-950 disabled:opacity-50">{en ? 'Review student anonymization' : '檢查匿名化學生'}</button>
      </article>
      <article className="rounded-2xl border border-rose-300 bg-rose-50 p-5">
        <h4 className="flex items-center gap-2 font-black"><Trash2 className="h-5 w-5" aria-hidden="true" />{en ? 'Delete student data' : '刪除學生資料'}</h4>
        <p className="mt-3 text-sm leading-7 text-rose-950">{en ? 'Remove the student, related learning evidence, exam results, team links and boss participation from live data and all retained application revisions. This cannot be undone using revision recovery.' : '從目前資料與所有保留的應用程式 revision 移除學生、學習證據、考試結果、隊伍連結及魔王參與，無法透過 revision 復原。'}</p>
        <button type="button" onClick={() => beginReview('delete')} disabled={busy || !student} className="mt-4 min-h-12 rounded-xl bg-rose-700 px-4 text-sm font-black text-white disabled:bg-slate-400">{en ? 'Review student data deletion' : '檢查刪除學生資料'}</button>
      </article>
    </div>
    <p className="flex gap-2 rounded-xl border border-amber-300 bg-white p-4 text-sm leading-6"><ShieldAlert className="mt-1 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />{en ? 'External exports, provider backups, and manually typed mentions elsewhere are outside this operation. It does not certify erasure of all copies.' : '已下載的匯出檔、供應商備份與其他位置手動輸入的提及不在此操作範圍內；這不是所有副本已永久刪除的證明。'}</p>
    {message && <p role="status" className="text-sm font-bold text-cyan-900">{message}</p>}
    {!review && error && <p role="alert" className="text-sm font-bold text-rose-900">{error}</p>}
    {review && <ModalDialog labelledBy={titleId} describedBy={descriptionId} onClose={() => setReview(null)} closeDisabled={busy} className="max-w-lg">
      <div className="space-y-5 p-6">
        <h3 id={titleId} className="text-xl font-black">{review.action === 'delete' ? (en ? 'Delete student data' : '刪除學生資料') : (en ? 'Anonymize student' : '匿名化學生')}</h3>
        <div id={descriptionId} className="space-y-3 text-sm leading-7">
          <p className="break-words font-bold">{en ? 'Selected student: ' : '所選學生：'}{review.name}</p>
          <p>{en ? 'This permanently changes this student’s live record and purges the prior identity from retained application revisions. Revision recovery cannot undo it. External downloads/backups are not erased.' : '此操作會永久變更所選學生的目前資料，並從保留的應用程式 revision 清除原身分，無法用 revision 復原。外部下載與備份不會被清除。'}</p>
          <p>{review.action === 'delete' ? (en ? 'The student and their linked educational/game records will be removed.' : '學生及其連結的教學／遊戲紀錄將被移除。') : (en ? 'The name/ID are replaced; education and free text removed. Numeric game/safety history remains and may still permit re-identification.' : '更換姓名／識別碼、移除教學與自由文字紀錄；保留數值型遊戲／安全紀錄，仍可能被重新識別。')}</p>
        </div>
        <label className="flex items-start gap-3 text-sm font-bold"><input type="checkbox" checked={understood} disabled={busy} onChange={(event) => setUnderstood(event.target.checked)} className="mt-1 h-5 w-5" />{en ? 'I understand the impact of this operation' : '我已了解此操作的影響'}</label>
        <p className="rounded-xl bg-slate-100 px-4 py-3 font-mono text-sm font-black">{STUDENT_PRIVACY_CONFIRMATIONS[review.action]}</p>
        <label className="block text-sm font-bold">{en ? 'Type the confirmation phrase' : '輸入確認文字'}<input autoComplete="off" spellCheck={false} value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono" /></label>
        {error && <p role="alert" className="text-sm font-bold text-rose-900">{error}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" autoFocus disabled={busy} onClick={() => setReview(null)} className="min-h-12 rounded-xl border border-slate-300 px-5 text-sm font-bold">{en ? 'Cancel' : '取消'}</button>
          <button type="button" disabled={busy || !understood || confirmation !== STUDENT_PRIVACY_CONFIRMATIONS[review.action]} onClick={() => void confirm()} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-rose-700 px-5 text-sm font-bold text-white disabled:bg-slate-400">{busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}{review.action === 'delete' ? (en ? 'Confirm deletion' : '確認刪除') : (en ? 'Confirm anonymization' : '確認匿名化')}</button>
        </div>
      </div>
    </ModalDialog>}
  </div>;
};
