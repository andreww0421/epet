import { useEffect, useId, useRef, useState } from 'react';
import { BookOpenCheck, Gift, X } from 'lucide-react';
import { translations } from '../i18n/translations';
import type {
  DailyAssessment,
  DailyTaskReflectionInput,
  LearningCompetency,
} from '../store/types';

type DailyTaskReflectionDialogProps = {
  language: 'zh' | 'en';
  studentName: string;
  targetDate: string;
  rewardPoints: number;
  onClose: () => void;
  onSubmit: (reflection: DailyTaskReflectionInput) => boolean;
};

export const DailyTaskReflectionDialog = ({
  language,
  studentName,
  targetDate,
  rewardPoints,
  onClose,
  onSubmit,
}: DailyTaskReflectionDialogProps) => {
  const tLang = translations[language];
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const reflectionRef = useRef<HTMLTextAreaElement>(null);
  const [competency, setCompetency] = useState<LearningCompetency>('assignmentQuality');
  const [assessment, setAssessment] = useState<DailyAssessment>('progressing');
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    reflectionRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable: HTMLElement[] = dialogRef.current
        ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled])',
          ))
        : [];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const submit = () => {
    const normalizedText = text.trim();
    if (!normalizedText) {
      setError(tLang.dailyTaskReflectionError);
      reflectionRef.current?.focus();
      return;
    }
    const claimed = onSubmit({ competency, assessment, text: normalizedText });
    if (claimed) onClose();
  };

  const competencyOptions: Array<[LearningCompetency, string]> = [
    ['participation', tLang.competencyParticipation],
    ['collaboration', tLang.competencyCollaboration],
    ['selfManagement', tLang.competencySelfManagement],
    ['assignmentQuality', tLang.competencyAssignmentQuality],
    ['growth', tLang.competencyGrowth],
  ];
  const assessmentOptions: Array<[DailyAssessment, string]> = [
    ['needsSupport', tLang.dailyTaskAssessmentNeedsSupport],
    ['progressing', tLang.dailyTaskAssessmentProgressing],
    ['confident', tLang.dailyTaskAssessmentConfident],
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-emerald-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
              <BookOpenCheck className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 id={titleId} className="mt-3 text-xl font-black text-slate-950">
              {tLang.dailyTaskReflectionTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tLang.cancel}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <p id={descriptionId} className="mt-3 text-sm leading-6 text-slate-600">
          {tLang.dailyTaskReflectionHint
            .replace('{name}', studentName)
            .replace('{date}', targetDate)}
        </p>
        <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-xs font-medium leading-5 text-sky-900">
          {tLang.dailyTaskReflectionPrivacy}
        </p>

        <label className="mt-5 block text-sm font-bold text-slate-800">
          {tLang.dailyTaskReflectionPrompt}
          <textarea
            ref={reflectionRef}
            value={text}
            maxLength={160}
            rows={3}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError('');
            }}
            placeholder={tLang.dailyTaskReflectionPlaceholder}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${descriptionId}-error` : undefined}
            className="mt-2 block min-h-24 w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-base leading-6 text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <div className="mt-1 flex items-start justify-between gap-3 text-xs">
          <span id={`${descriptionId}-error`} role={error ? 'alert' : undefined} className="font-bold text-rose-700">
            {error}
          </span>
          <span className="shrink-0 text-slate-500">{text.length}/160</span>
        </div>

        <label className="mt-4 block text-sm font-bold text-slate-800">
          {tLang.dailyTaskReflectionCompetency}
          <select
            value={competency}
            onChange={(event) => setCompetency(event.target.value as LearningCompetency)}
            className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          >
            {competencyOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <fieldset className="mt-4">
          <legend className="text-sm font-bold text-slate-800">
            {tLang.dailyTaskReflectionAssessment}
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {assessmentOptions.map(([value, label]) => (
              <label
                key={value}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 py-2 text-center text-sm font-bold transition-colors ${
                  assessment === value
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name={`${titleId}-assessment`}
                  value={value}
                  checked={assessment === value}
                  onChange={() => setAssessment(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            {tLang.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-5 py-2 text-sm font-black text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            <Gift className="mr-2 h-4 w-4" aria-hidden="true" />
            {tLang.dailyTaskReflectionSubmit.replace('{points}', String(rewardPoints))}
          </button>
        </div>
      </section>
    </div>
  );
};
