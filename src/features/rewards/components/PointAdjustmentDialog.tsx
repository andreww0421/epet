import { useEffect, useMemo, useState } from 'react';
import { Edit2, Gift, Users } from 'lucide-react';
import type { FeedbackReasonHistoryEntry, LearningCompetency, Student } from '../../../store/types';
import { translations } from '../../../i18n/translations';
import { ModalDialog } from '../../../components/ModalDialog';
import type { DashboardPointReasonOption } from '../model/buildPointReasonOptions';

type DashboardCopy = (typeof translations)[keyof typeof translations];

export type PointAdjustmentTarget =
  | { kind: 'student'; id: string; name: string }
  | { kind: 'batch'; ids: string[]; count: number }
  | { kind: 'class'; count: number };
export type PointAdjustmentEntry = PointAdjustmentTarget | { kind: 'picker'; direction: 'give' | 'deduct' };

type ReasonOption = {
  competency: LearningCompetency;
  label: string;
};

type PointAdjustmentDialogProps = {
  competencyLabels: Record<LearningCompetency, string>;
  feedbackReasonHistory: FeedbackReasonHistoryEntry[];
  onCancel: () => void;
  onConfirm: (input: {
    amount: number;
    competency: LearningCompetency;
    reason: string;
    target: PointAdjustmentTarget;
  }) => void;
  pointReasonOptions: ReasonOption[];
  target: PointAdjustmentEntry | null;
  students?: Pick<Student, 'id' | 'name'>[];
  quickReasons?: DashboardPointReasonOption[];
  onApplyPreset?: (studentId: string, reasonId: string) => void;
  isPresetDisabled?: (studentId: string, reasonId: string) => boolean;
  tLang: DashboardCopy;
};

export const PointAdjustmentDialog = ({
  competencyLabels,
  feedbackReasonHistory,
  onCancel,
  onConfirm,
  pointReasonOptions,
  target,
  students = [],
  quickReasons = [],
  onApplyPreset,
  isPresetDisabled,
  tLang,
}: PointAdjustmentDialogProps) => {
  const [amount, setAmount] = useState('');
  const [studentId, setStudentId] = useState('');
  const [reason, setReason] = useState('');
  const [competency, setCompetency] =
    useState<LearningCompetency>('participation');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [custom, setCustom] = useState(false);
  const [presetId, setPresetId] = useState('');

  useEffect(() => {
    setAmount('');
    setStudentId('');
    setReason('');
    setCompetency('participation');
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    setCustom(false);
    setPresetId('');
  }, [target]);

  const suggestions = useMemo(() => {
    const options = new Map<string, ReasonOption>();
    feedbackReasonHistory.forEach((entry) => {
      options.set(entry.label.toLocaleLowerCase(), entry);
    });
    pointReasonOptions.forEach((option) => {
      const key = option.label.toLocaleLowerCase();
      options.set(key, option);
    });
    const query = reason.trim().toLocaleLowerCase();
    return [...options.values()]
      .filter((option) => !query || option.label.toLocaleLowerCase().includes(query))
      .sort((left, right) => {
        if (!query) return 0;
        return Number(right.label.toLocaleLowerCase().startsWith(query)) -
          Number(left.label.toLocaleLowerCase().startsWith(query));
      })
      .slice(0, 10);
  }, [feedbackReasonHistory, pointReasonOptions, reason]);

  if (!target) return null;
  const picker = target.kind === 'picker';
  const presets = target.kind === 'picker' ? quickReasons.filter((option) =>
    target.direction === 'give' ? option.amount > 0 : option.amount < 0) : [];
  const selectedPreset = presets.find((option) => option.id === presetId) ?? presets[0];
  const showPresets = picker && !custom && Boolean(onApplyPreset) && Boolean(selectedPreset);
  const selectedStudent = students.find((student) => student.id === studentId);
  const resolvedTarget: PointAdjustmentTarget | null = target.kind !== 'picker' ? target
    : selectedStudent ? { kind: 'student', id: selectedStudent.id, name: selectedStudent.name } : null;
  const parsedAmount = Math.trunc(Number(amount));
  const canSubmit = Boolean(resolvedTarget) && Number.isFinite(parsedAmount) &&
    (picker ? parsedAmount > 0 && Number.isInteger(Number(amount)) : parsedAmount !== 0) && Boolean(reason.trim());
  const language = tLang === translations.en ? 'en' : 'zh';
  const quickTitle = target.kind === 'picker' ? target.direction === 'give'
    ? (language === 'en' ? 'Give points' : '給予積分')
    : (language === 'en' ? 'Deduct points' : '扣除積分') : '';
  const showSuggestions = suggestionsOpen && suggestions.length > 0;
  const chooseSuggestion = (suggestion: ReasonOption) => {
    setReason(suggestion.label);
    setCompetency(suggestion.competency);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
  };

  return (
    <ModalDialog labelledBy="point-adjustment-title" describedBy="point-adjustment-description" onClose={onCancel} className="max-w-sm">
        <div className="p-6">
          <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-full ${
            target.kind === 'class'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-indigo-100 text-indigo-700'
          }`}>
            {target.kind === 'class'
              ? <Gift className="h-5 w-5" />
              : target.kind === 'batch'
                ? <Users className="h-5 w-5" />
                : <Edit2 className="h-5 w-5" />}
          </div>
          <h2 id="point-adjustment-title" className="text-lg font-bold text-slate-900">
            {target.kind === 'picker' ? quickTitle : target.kind === 'class'
              ? tLang.airdropTitle
              : target.kind === 'batch'
                ? tLang.batchAdjustTitle
                : tLang.manualAdjustTitle}
          </h2>
          <p id="point-adjustment-description" className="mt-2 text-sm text-slate-600">
            {target.kind === 'picker'
              ? (showPresets
                ? (language === 'en' ? 'Click a learner to apply the displayed reason and amount. Existing point safeguards still apply.' : '點選學生，即套用下方顯示的原因與積分；原有積分保障仍會生效。')
                : (language === 'en' ? 'Choose a learner and provide a reason. Existing point safeguards still apply.' : '選擇學生並填寫理由；原有積分保障仍會生效。'))
              : target.kind === 'class'
              ? tLang.airdropDesc.replace('{count}', target.count.toString())
              : target.kind === 'batch'
                ? tLang.batchAdjustDesc.replace('{count}', target.count.toString())
                : tLang.manualAdjustDesc.replace('{name}', target.name)}
          </p>
          {showPresets && <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="today-point-preset" className="text-sm font-medium text-slate-700">{language === 'en' ? 'Feedback reason and points' : '回饋原因與積分'}</label>
              <select id="today-point-preset" autoFocus value={selectedPreset?.id} onChange={(event) => setPresetId(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white p-2 text-base">
                {presets.map((option) => <option key={option.id} value={option.id}>{option.displayLabel}</option>)}
              </select>
            </div>
            <div role="group" aria-label={language === 'en' ? 'Apply to student' : '套用至學生'} className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
              {students.map((student) => <button key={student.id} type="button" disabled={!selectedPreset || isPresetDisabled?.(student.id, selectedPreset.id)}
                onClick={() => selectedPreset && onApplyPreset?.(student.id, selectedPreset.id)}
                className="min-h-11 break-words rounded-md border border-indigo-200 bg-indigo-50 p-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500">
                {student.name}
              </button>)}
            </div>
            <button type="button" onClick={() => setCustom(true)} className="min-h-11 text-sm font-semibold text-indigo-800 underline underline-offset-4">{language === 'en' ? 'Custom points' : '自訂積分'}</button>
          </div>}
          <div hidden={showPresets}>
          {picker && !showPresets && <div className="mt-5 text-sm font-medium text-slate-700">
            <label htmlFor="today-point-student">{language === 'en' ? 'Select student' : '選擇學生'}</label>
            <select id="today-point-student" value={studentId} onChange={(event) => setStudentId(event.target.value)} autoFocus
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white p-2 text-base">
              <option value="">{language === 'en' ? 'Select a learner' : '請選擇學生'}</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
            </select>
          </div>}
          <label className="mt-5 block text-sm font-medium text-slate-700">
            {picker ? (language === 'en' ? 'Point amount' : '積分數量') : tLang.airdropAmount}
            <input
              type="number"
              step="1"
              min={picker ? 1 : undefined}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              placeholder={picker ? (language === 'en' ? 'Enter a positive whole number' : '請輸入正整數') : tLang.airdropAmountPlaceholder}
              autoFocus={!picker && !showPresets}
            />
          </label>
          <div className="mt-4 text-sm font-medium text-slate-700">
            <label htmlFor="point-adjustment-reason">{tLang.airdropReason}</label>
            <div
              className="relative"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setSuggestionsOpen(false);
                }
              }}
            >
              <input
                id="point-adjustment-reason"
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                aria-controls={showSuggestions ? 'point-adjustment-reason-options' : undefined}
                aria-activedescendant={showSuggestions && activeSuggestion >= 0 && activeSuggestion < suggestions.length
                  ? `point-adjustment-option-${activeSuggestion}` : undefined}
                value={reason}
                onFocus={() => { setSuggestionsOpen(true); setActiveSuggestion(-1); }}
                onChange={(event) => {
                  setReason(event.target.value);
                  setSuggestionsOpen(true);
                  setActiveSuggestion(-1);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && showSuggestions) {
                    event.preventDefault();
                    event.stopPropagation();
                    setSuggestionsOpen(false);
                    setActiveSuggestion(-1);
                  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    if (!suggestions.length) return;
                    event.preventDefault();
                    const next = event.key === 'ArrowDown'
                      ? (activeSuggestion + 1) % suggestions.length
                      : (activeSuggestion <= 0 ? suggestions.length : activeSuggestion) - 1;
                    setSuggestionsOpen(true);
                    setActiveSuggestion(next);
                    document.getElementById(`point-adjustment-option-${next}`)?.scrollIntoView({ block: 'nearest' });
                  } else if (event.key === 'Enter' && showSuggestions && activeSuggestion >= 0) {
                    event.preventDefault();
                    const suggestion = suggestions[activeSuggestion];
                    if (suggestion) chooseSuggestion(suggestion);
                  }
                }}
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                placeholder={tLang.airdropReasonPlaceholder}
                autoComplete="off"
              />
              {showSuggestions && (
                <div
                  id="point-adjustment-reason-options"
                  role="listbox"
                  aria-label={tLang.airdropReason}
                  className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg"
                >
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion.label}-${suggestion.competency}`}
                      type="button"
                      role="option"
                      id={`point-adjustment-option-${index}`}
                      tabIndex={-1}
                      aria-selected={activeSuggestion === index}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseSuggestion(suggestion)}
                      className={`flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-900 ${activeSuggestion === index ? 'bg-indigo-50 text-indigo-900' : ''}`}
                    >
                      <span>{suggestion.label}</span>
                      <span className="shrink-0 text-xs text-slate-600">
                        {competencyLabels[suggestion.competency]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="mt-1 block text-xs font-normal text-slate-500">
              {tLang.feedbackReasonHistoryHint}
            </span>
          </div>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            {tLang.feedbackCompetency}
            <select
              value={competency}
              onChange={(event) => setCompetency(event.target.value as LearningCompetency)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            >
              {(Object.keys(competencyLabels) as LearningCompetency[]).map((item) => (
                <option key={item} value={item}>{competencyLabels[item]}</option>
              ))}
            </select>
          </label>
          </div>
        </div>
        <div className="flex justify-end gap-3 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {tLang.cancel}
          </button>
          <button
            type="button"
            hidden={showPresets}
            onClick={() => canSubmit && resolvedTarget && onConfirm({
              amount: target.kind === 'picker' && target.direction === 'deduct' ? -parsedAmount : parsedAmount,
              competency,
              reason,
              target: resolvedTarget,
            })}
            disabled={!canSubmit}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300 ${
              target.kind === 'class'
                ? 'bg-emerald-700 hover:bg-emerald-800'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {target.kind === 'class'
              ? tLang.confirmAirdrop
              : target.kind === 'batch'
                ? tLang.confirmBatchAdjustment
                : tLang.confirmAdjustment}
          </button>
        </div>
    </ModalDialog>
  );
};
