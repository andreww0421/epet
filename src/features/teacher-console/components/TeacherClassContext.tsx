import { useStore } from '../../../store/useStore';
import type { ClassData, Language } from '../../../store/types';
import { useWorkspaceMutationGuard } from '../../workspace/hooks/useWorkspaceMutationGuard';
import { getActiveClasses } from '../../../../shared/domain/classArchive';

type Props = { classes: ClassData[]; classId: string; language: Language; readOnly: boolean; workspaceName?: string; onReviewClassChange: (id: string) => void };

/** Class context follows every task. Viewers select locally; writers use the existing guarded action. */
export const TeacherClassContext = ({ classes, classId, language, readOnly, workspaceName, onReviewClassChange }: Props) => {
  const switchClass = useStore((state) => state.switchClass);
  const runMutation = useWorkspaceMutationGuard(!readOnly);
  const current = classes.find((item) => item.id === classId);
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      {workspaceName && <div className="min-w-0 sm:max-w-xs">
        <p className="text-xs font-bold text-slate-600">{language === 'en' ? 'Current workspace' : '目前工作區'}</p>
        <p className="mt-1 break-words text-base font-semibold text-slate-900">{workspaceName}</p>
      </div>}
      <label htmlFor="classSelect" className="flex flex-col gap-1 text-xs font-bold text-slate-600 sm:min-w-64">
        {readOnly ? (language === 'en' ? 'Class to review' : '查看班級') : (language === 'en' ? 'Current class' : '目前班級')}
        <select id="classSelect" value={classId} onChange={(event) => {
          if (readOnly) onReviewClassChange(event.target.value);
          else runMutation(() => switchClass(event.target.value));
        }} className="min-h-11 w-full max-w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
          {getActiveClasses(classes).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <p className="text-sm text-slate-600">{current?.students.length ?? 0} {language === 'en' ? 'students' : '位學生'}
        {readOnly && <span className="ml-3 rounded bg-sky-50 px-2 py-1 font-semibold text-sky-900">{language === 'en' ? 'Read-only workspace' : '唯讀工作區'}</span>}
      </p>
    </div>
  );
};
