import { useState } from 'react';
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

type LearningEvidenceFormProps = {
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
  const [competency, setCompetency] = useState<LearningCompetency>('participation');
  const [level, setLevel] = useState<LearningEvidenceLevel>('progressing');
  const [evidenceType, setEvidenceType] =
    useState<LearningEvidenceType>('observation');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  return (
    <form
      className={`${visible ? '' : 'hidden'} p-5`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!studentId || !title.trim()) return;
        runMutation(() => addLearningEvidence(studentId, {
          competency,
          level,
          evidenceType,
          title: title.trim(),
          note: note.trim() || undefined,
        }));
        setTitle('');
        setNote('');
      }}
    >
      <h3 className="flex items-center text-sm font-bold text-slate-900">
        <Plus className="mr-2 h-4 w-4 text-indigo-600" />
        {copy.addLearningEvidence}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{copy.addLearningEvidenceHint}</p>

      <label className="mt-4 block text-xs font-bold text-slate-600">
        {copy.learningCompetency}
        <select
          value={competency}
          onChange={(event) =>
            setCompetency(event.target.value as LearningCompetency)
          }
          className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
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
            setLevel(event.target.value as LearningEvidenceLevel)
          }
          className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
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
            setEvidenceType(event.target.value as LearningEvidenceType)
          }
          className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
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
          onChange={(event) => setTitle(event.target.value.slice(0, 100))}
          maxLength={100}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
          placeholder={copy.learningEvidenceTitlePlaceholder}
        />
      </label>
      <label className="mt-4 block text-xs font-bold text-slate-600">
        {copy.learningEvidenceNote}
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, 500))}
          maxLength={500}
          rows={4}
          className="mt-1 w-full resize-none rounded-md border border-slate-300 p-2 text-sm"
          placeholder={copy.learningEvidenceNotePlaceholder}
        />
      </label>
      <button
        type="submit"
        disabled={!studentId || !title.trim()}
        className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        <Save className="mr-2 h-4 w-4" />
        {copy.saveLearningEvidence}
      </button>
    </form>
  );
};
