import { Undo2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { translations } from '../../../i18n/translations';
import { useStore } from '../../../store/useStore';

/** Page-level undo notices for point adjustments and formal safety actions. */
export const DashboardUndoNotices = () => {
  const {
    data,
    safetyUndoAction,
    undoAction,
    undoLastPointAdjustment,
    undoLastSafetyAction,
  } = useStore(useShallow((state) => ({
    data: state.data,
    safetyUndoAction: state.safetyUndoAction,
    undoAction: state.undoAction,
    undoLastPointAdjustment: state.undoLastPointAdjustment,
    undoLastSafetyAction: state.undoLastSafetyAction,
  })));
  const lang = data.settings?.language || 'zh';
  const copy = translations[lang];

  return (
    <>
      {undoAction && (
        <div className="mb-6 flex items-center gap-3 border-l-4 border-indigo-500 bg-indigo-50 px-4 py-3 text-indigo-950" role="status">
          <Undo2 className="h-5 w-5 shrink-0 text-indigo-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{undoAction.label}</p>
            <p className="mt-0.5 text-xs text-indigo-700">{copy.undoAvailable}</p>
          </div>
          <button type="button" onClick={undoLastPointAdjustment} className="shrink-0 rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-sm font-bold text-indigo-700 hover:bg-indigo-100">
            {copy.undo}
          </button>
        </div>
      )}

      {safetyUndoAction && (
        <div className="mb-6 flex items-center gap-3 border-l-4 border-rose-500 bg-rose-50 px-4 py-3 text-rose-950" role="status" aria-live="assertive">
          <Undo2 className="h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{safetyUndoAction.label}</p>
            <p className="mt-0.5 text-xs text-rose-800">
              {lang === 'en'
                ? 'Undo is available for 10 seconds. The original event stays in the ledger and a reversal is added.'
                : '10 秒內可撤銷；原始事件會保留，系統另新增補償紀錄。'}
            </p>
          </div>
          <button type="button" onClick={undoLastSafetyAction} aria-label={lang === 'en' ? 'Undo formal action' : '撤銷正式操作'} className="shrink-0 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-bold text-rose-700 hover:bg-rose-100">
            {copy.undo}
          </button>
        </div>
      )}
    </>
  );
};
