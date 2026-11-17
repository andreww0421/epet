import { Plus, Save } from 'lucide-react';
import { useStore } from '../../../store/useStore';
import { translations } from '../../../i18n/translations';
import {
  LEARNING_COMPETENCIES,
  LEARNING_EVIDENCE_TYPES,
  type LearningCompetency,
  type LearningEvidenceLevel,
  type LearningEvidenceType,
} from '../../../../shared/education';
import type { Language } from '../../../store/types';
import { useWorkspaceMutationGuard } from '../../workspace/hooks/useWorkspaceMutationGuard';
import { useScopedLearningDraft } from '../hooks/useScopedLearningDraft';

type LearningEvidenceFormProps = {
  classId: string;
  canWrite: boolean;
  competencyLabels: Record<LearningCompetency, string>;
  language: Language;
  levelLabels: Record<LearningEvidenceLevel, string>;
  studentId?: string;
  typeLabels: Record<LearningEvidenceType, string>;
  visible: boolean;
};

/** Owns the manual learning-evidence draft and delegates persistence to the store. */
export const LearningEvidenceForm = ({
  classId,
  canWrite,
  competencyLabels,
  language,
  levelLabels,
  studentId,
  typeLabels,
  visible,
}: LearningEvidenceFormProps) => {
  const addLearningEvidence = useStore((state) => state.addLearningEvidence);
  const runMutation = useWorkspaceMutationGuard(canWrite);
  const copy = translations[language];
  const [draft, setDraft] = useScopedLearningDraft(JSON.stringify(['evidence', classId, studentId]), () => ({
    competency: 'participation' as LearningCompetency,
    level: 'progressing' as LearningEvidenceLevel,
    evidenceType: 'observation' as LearningEvidenceType,
    title: '', note: '', result: '' as '' | 'added' | 'rejected',
  }));
  const { competency, level, evidenceType, title, note } = draft;
  const update = (patch: Partial<typeof draft>) => setDraft((previous) => ({ ...previous, ...patch, result: '' }));

  return (
    <form
      className={`${visible ? '' : 'hidden'} p-5`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!studentId || !title.trim()) return;
        const accepted = runMutation(() => {
          const before = useStore.getState().data;
          const beforeClass = before.classes.find((item) => item.id === classId);
          if (before.currentClassId !== classId || !beforeClass?.students.some((student) => student.id === studentId)) return false;
          const ids = new Set((beforeClass.learningEvidenceRecords ?? []).map((record) => record.id));
          addLearningEvidence(studentId, { competency, level, evidenceType, title: title.trim(), note: note.trim() || undefined });
          return useStore.getState().data.classes.find((item) => item.id === classId)?.learningEvidenceRecords
            ?.some((record) => record.studentId === studentId && !ids.has(record.id)) === true;
        });
        setDraft((previous) => accepted
          ? { ...previous, title: '', note: '', result: 'added' }
          : { ...previous, result: 'rejected' });
      }}
    >
      <h3 className="flex items-center text-sm font-bold text-slate-900">
        <Plus className="mr-2 h-4 w-4 text-indigo-600" aria-hidden="true" />
        {copy.addLearningEvidence}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{copy.addLearningEvidenceHint}</p>

      <label className="mt-4 block text-xs font-bold text-slate-600">
        {copy.learningCompetency}
        <select
          value={competency}
          onChange={(event) =>
            update({ competency: event.target.value as LearningCompetency })
          }
          className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
        >
          {LEARNING_COMPETENCIES.map((item) => (
            <option key={item} value={item}>{competencyLabels[item]}</option>
          ))}
        </select>
      </label>
      <label className="mt-4 block text-xs font-bold text-slate-600">
        {copy.learningEvidenceLevel}
        <select
          value={level}
          onChange={(event) =>
            update({ level: event.target.value as LearningEvidenceLevel })
          }
          className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
        >
          {(Object.keys(levelLabels) as LearningEvidenceLevel[]).map((item) => (
            <option key={item} value={item}>{levelLabels[item]}</option>
          ))}
        </select>
      </label>
      <label className="mt-4 block text-xs font-bold text-slate-600">
        {copy.learningEvidenceType}
        <select
          value={evidenceType}
          onChange={(event) =>
            update({ evidenceType: event.target.value as LearningEvidenceType })
          }
          className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
        >
          {LEARNING_EVIDENCE_TYPES.map((item) => (
            <option key={item} value={item}>{typeLabels[item]}</option>
          ))}
        </select>
      </label>
      <label className="mt-4 block text-xs font-bold text-slate-600">
        {copy.learningEvidenceTitle}
        <input
          value={title}
          onChange={(event) => update({ title: event.target.value.slice(0, 100) })}
          maxLength={100}
          className="mt-1 min-h-11 w-full rounded-md border border-slate-300 p-2 text-sm"
          placeholder={copy.learningEvidenceTitlePlaceholder}
        />
      </label>
      <label className="mt-4 block text-xs font-bold text-slate-600">
        {copy.learningEvidenceNote}
        <textarea
          value={note}
          onChange={(event) => update({ note: event.target.value.slice(0, 500) })}
          maxLength={500}
          rows={4}
          className="mt-1 w-full resize-none rounded-md border border-slate-300 p-2 text-sm"
          placeholder={copy.learningEvidenceNotePlaceholder}
        />
      </label>
      <button
        type="submit"
        disabled={!canWrite || !studentId || !title.trim()}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        <Save className="mr-2 h-4 w-4" aria-hidden="true" />
        {copy.saveLearningEvidence}
      </button>
      {draft.result && <p role="status" className={`mt-3 text-sm ${draft.result === 'added' ? 'text-emerald-800' : 'text-amber-900'}`}>
        {draft.result === 'added'
          ? (language === 'en' ? 'Evidence added to the workspace. Check cloud sync before leaving.' : '學習證據已加入工作區，離開前請確認雲端同步。')
          : (language === 'en' ? 'Evidence was not added. Your input is retained; check your class and permissions.' : '學習證據未加入。輸入仍保留，請確認班級與操作權限。')}
      </p>}
    </form>
  );
};
