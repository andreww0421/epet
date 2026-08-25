import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Edit2, Gift, Users } from 'lucide-react';
import type { FeedbackReasonHistoryEntry, LearningCompetency } from '../../store/types';
import { translations } from '../../i18n/translations';

type DashboardCopy = (typeof translations)[keyof typeof translations];

export type PointAdjustmentTarget =
  | { kind: 'student'; id: string; name: string }
  | { kind: 'batch'; ids: string[]; count: number }
  | { kind: 'class'; count: number };

type AddClassDialogProps = {
  open: boolean;
  onAdd: (name: string) => void;
  onClose: () => void;
  tLang: DashboardCopy;
};

export const AddClassDialog = ({
  open,
  onAdd,
  onClose,
  tLang,
}: AddClassDialogProps) => {
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) setName('');
  }, [open]);

  if (!open) return null;
  const submit = () => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    onAdd(normalizedName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="p-6">
          <h3 className="mb-4 text-lg font-bold text-slate-900">{tLang.addClass}</h3>
          <label htmlFor="className" className="mb-1 block text-sm font-medium text-slate-700">
            {tLang.className}
          </label>
          <input
            id="className"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
            className="w-full rounded-md border border-slate-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder={tLang.enterClassName}
            autoFocus
          />
        </div>
        <div className="flex justify-end space-x-3 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {tLang.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-indigo-300"
          >
            {tLang.add}
          </button>
        </div>
      </div>
    </div>
  );
};

type DeleteConfirmationDialogProps = {
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
};

export const DeleteConfirmationDialog = ({
  cancelLabel,
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  open,
  title,
}: DeleteConfirmationDialogProps) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="p-6">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <h3 className="mb-2 text-center text-lg font-bold text-slate-900">{title}</h3>
          <p className="mb-4 text-center text-sm text-slate-600">{message}</p>
        </div>
        <div className="flex justify-end space-x-3 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

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
  target: PointAdjustmentTarget | null;
  tLang: DashboardCopy;
};

export const PointAdjustmentDialog = ({
  competencyLabels,
  feedbackReasonHistory,
  onCancel,
  onConfirm,
  pointReasonOptions,
  target,
  tLang,
}: PointAdjustmentDialogProps) => {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [competency, setCompetency] =
    useState<LearningCompetency>('participation');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  useEffect(() => {
    setAmount('');
    setReason('');
    setCompetency('participation');
    setSuggestionsOpen(false);
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
  const parsedAmount = Math.trunc(Number(amount));
  const canSubmit = Number.isFinite(parsedAmount) && parsedAmount !== 0 && Boolean(reason.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl">
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
          <h3 className="text-lg font-bold text-slate-900">
            {target.kind === 'class'
              ? tLang.airdropTitle
              : target.kind === 'batch'
                ? tLang.batchAdjustTitle
                : tLang.manualAdjustTitle}
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            {target.kind === 'class'
              ? tLang.airdropDesc.replace('{count}', target.count.toString())
              : target.kind === 'batch'
                ? tLang.batchAdjustDesc.replace('{count}', target.count.toString())
                : tLang.manualAdjustDesc.replace('{name}', target.name)}
          </p>
          <label className="mt-5 block text-sm font-medium text-slate-700">
            {tLang.airdropAmount}
            <input
              type="number"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              placeholder={tLang.airdropAmountPlaceholder}
              autoFocus
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
                aria-expanded={suggestionsOpen}
                aria-controls="point-adjustment-reason-options"
                value={reason}
                onFocus={() => setSuggestionsOpen(true)}
                onChange={(event) => {
                  setReason(event.target.value);
                  setSuggestionsOpen(true);
                }}
                onKeyDown={(event) => event.key === 'Escape' && setSuggestionsOpen(false)}
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                placeholder={tLang.airdropReasonPlaceholder}
                autoComplete="off"
              />
              {suggestionsOpen && suggestions.length > 0 && (
                <div
                  id="point-adjustment-reason-options"
                  role="listbox"
                  className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg"
                >
                  {suggestions.map((suggestion) => (
                    <button
                      key={`${suggestion.label}-${suggestion.competency}`}
                      type="button"
                      role="option"
                      aria-selected={reason === suggestion.label}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setReason(suggestion.label);
                        setCompetency(suggestion.competency);
                        setSuggestionsOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-900"
                    >
                      <span>{suggestion.label}</span>
                      <span className="shrink-0 text-xs text-slate-400">
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
            onClick={() => canSubmit && onConfirm({
              amount: parsedAmount,
              competency,
              reason,
              target,
            })}
            disabled={!canSubmit}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300 ${
              target.kind === 'class'
                ? 'bg-emerald-600 hover:bg-emerald-700'
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
      </div>
    </div>
  );
};
