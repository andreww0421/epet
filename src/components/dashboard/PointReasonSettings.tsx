import React, { useEffect, useState } from 'react';
import { Pin, Plus, Save, Settings, Trash2 } from 'lucide-react';
import { translations } from '../../i18n/translations';
import type { LearningCompetency, PointReasonOption } from '../../store/types';

type PointReasonDraft = Omit<PointReasonOption, 'amount'> & {
  amount: string;
};

type PointReasonShortcut = PointReasonOption & {
  displayLabel: string;
  isPinned: boolean;
  isRecent: boolean;
};

type PointReasonSettingsProps = {
  options: PointReasonShortcut[];
  configuredReasons: PointReasonOption[];
  competencyLabels: Record<LearningCompetency, string>;
  labels: typeof translations.zh;
  editable?: boolean;
  onTogglePinned: (reasonId: string) => void;
  onSave: (reasons: PointReasonOption[]) => void;
};

const clonePointReasons = (reasons: PointReasonOption[]): PointReasonDraft[] =>
  reasons.map((reason) => ({
    ...reason,
    amount: reason.amount.toString(),
    labels: { ...reason.labels },
  }));

export const PointReasonSettings: React.FC<PointReasonSettingsProps> = ({
  options,
  configuredReasons,
  competencyLabels,
  labels,
  editable = true,
  onTogglePinned,
  onSave,
}) => {
  const [showManager, setShowManager] = useState(false);
  const [drafts, setDrafts] = useState<PointReasonDraft[]>(() =>
    clonePointReasons(configuredReasons),
  );

  useEffect(() => {
    if (!showManager) {
      setDrafts(clonePointReasons(configuredReasons));
    }
  }, [configuredReasons, showManager]);

  const isInvalid =
    drafts.length === 0 ||
    drafts.some(
      (reason) =>
        !Number.isInteger(Number(reason.amount)) ||
        Number(reason.amount) === 0 ||
        (!reason.labels.zh.trim() && !reason.labels.en.trim()),
    );

  return (
    <div className="border-b border-slate-200 px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center text-xs font-bold text-slate-700">
          <Pin className="mr-1.5 h-3.5 w-3.5" />
          {labels.reasonShortcuts}
        </span>
        {editable && (
          <button
            type="button"
            onClick={() => {
              setShowManager((open) => {
                if (!open) setDrafts(clonePointReasons(configuredReasons));
                return !open;
              });
            }}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <Settings className="mr-1.5 h-3.5 w-3.5" />
            {labels.managePointReasons}
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.isPinned}
            onClick={() => onTogglePinned(option.id)}
            disabled={!editable}
            title={option.isPinned ? labels.unpinReason : labels.pinReason}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-default ${
              option.isPinned
                ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                : option.isRecent
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Pin
              className="h-3 w-3"
              fill={option.isPinned ? 'currentColor' : 'none'}
            />
            {option.displayLabel}
            <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold opacity-80">
              {competencyLabels[option.competency]}
            </span>
            {(option.isPinned || option.isRecent) && (
              <span className="text-[10px] opacity-70">
                {option.isPinned ? labels.pinnedReason : labels.recentReason}
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">{labels.reasonShortcutsHint}</p>

      {editable && showManager && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="space-y-3">
            {drafts.map((reason, index) => (
              <div
                key={reason.id}
                className="grid gap-3 border-b border-slate-100 pb-3 md:grid-cols-[minmax(150px,1.2fr)_minmax(150px,1.2fr)_100px_minmax(150px,1fr)_36px]"
              >
                <label className="text-xs font-bold text-slate-600">
                  {labels.reasonLabelZh}
                  <input
                    type="text"
                    value={reason.labels.zh}
                    maxLength={60}
                    onChange={(event) =>
                      setDrafts((reasons) =>
                        reasons.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                labels: { ...item.labels, zh: event.target.value },
                              }
                            : item,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  {labels.reasonLabelEn}
                  <input
                    type="text"
                    value={reason.labels.en}
                    maxLength={60}
                    onChange={(event) =>
                      setDrafts((reasons) =>
                        reasons.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                labels: { ...item.labels, en: event.target.value },
                              }
                            : item,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  {labels.reasonAmount}
                  <input
                    type="number"
                    step="1"
                    value={reason.amount}
                    onChange={(event) =>
                      setDrafts((reasons) =>
                        reasons.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, amount: event.target.value }
                            : item,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  {labels.feedbackCompetency}
                  <select
                    value={reason.competency}
                    onChange={(event) =>
                      setDrafts((reasons) =>
                        reasons.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                competency: event.target.value as LearningCompetency,
                              }
                            : item,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                  >
                    {(Object.keys(competencyLabels) as LearningCompetency[]).map(
                      (competency) => (
                        <option key={competency} value={competency}>
                          {competencyLabels[competency]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setDrafts((reasons) =>
                      reasons.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  disabled={drafts.length <= 1}
                  className="flex h-9 w-9 items-center justify-center self-end rounded-md text-slate-400 hover:bg-rose-100 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-30"
                  title={labels.deletePointReason}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() =>
                setDrafts((reasons) => [
                  ...reasons,
                  {
                    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    amount: '10',
                    competency: 'participation',
                    labels: { zh: '自訂回饋', en: 'Custom Feedback' },
                  },
                ])
              }
              disabled={drafts.length >= 30}
              className="inline-flex items-center justify-center rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              <Plus className="mr-2 h-4 w-4" />
              {labels.addPointReason}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setDrafts(clonePointReasons(configuredReasons));
                  setShowManager(false);
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {labels.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  onSave(
                    drafts.map((reason) => ({
                      ...reason,
                      amount: Number(reason.amount),
                    })),
                  );
                  setShowManager(false);
                }}
                disabled={isInvalid}
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Save className="mr-2 h-4 w-4" />
                {labels.savePointReasons}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
