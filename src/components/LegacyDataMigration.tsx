import { useMemo, useState } from 'react';
import { Download, ShieldCheck, Upload } from 'lucide-react';
import { STORAGE_KEY } from '../store/constants';
import type { AppData } from '../store/types';
import { useStore } from '../store/useStore';

const DISMISSED_KEY = 'epet-legacy-migration-dismissed-v1';

const readLegacyData = (): AppData | null => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      data?: AppData;
      state?: { data?: AppData };
    };
    return parsed.state?.data ?? parsed.data ?? null;
  } catch {
    return null;
  }
};

const hasMeaningfulWorkspaceData = (data: AppData) =>
  data.classes.some((classData) =>
    classData.students.length > 0
    || Boolean(classData.activeBoss)
    || (classData.classGoals?.length ?? 0) > 0
    || (classData.learningEvidenceRecords?.length ?? 0) > 0
    || (classData.examRecords?.length ?? 0) > 0
    || (classData.id !== 'default' && classData.name.trim() !== ''),
  );

const downloadJson = (data: AppData) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `epet-legacy-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const LegacyDataMigration = ({
  workspaceName,
}: {
  workspaceName: string;
}) => {
  const [legacyData] = useState(readLegacyData);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return globalThis.sessionStorage?.getItem(DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [queuedForSync, setQueuedForSync] = useState(false);
  const currentData = useStore((state) => state.data);
  const importData = useStore((state) => state.importData);
  const currentHasData = useMemo(
    () => hasMeaningfulWorkspaceData(currentData),
    [currentData],
  );

  if (!legacyData || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      globalThis.sessionStorage?.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Session-only dismissal is optional.
    }
  };

  return (
    <section
      aria-labelledby="legacy-migration-title"
      className="border-b border-indigo-200 bg-indigo-50 px-4 py-4"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-700 shadow-sm">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="legacy-migration-title" className="text-sm font-black text-indigo-950">
              找到這台裝置上的舊版班級資料
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-indigo-900">
              系統不會自動把可能屬於另一位老師的學生資料掛到會員帳號。
              你可以先下載備份，或明確匯入到「{workspaceName}」。
            </p>
            {currentHasData && (
              <p className="mt-1 text-xs font-bold text-amber-800">
                目前工作區已有資料；為避免覆寫，請先建立空白工作區或只下載備份。
              </p>
            )}
            {queuedForSync && (
              <p className="mt-1 text-xs font-bold text-emerald-800" role="status">
                舊資料已載入，正在等候雲端同步；原本機備份仍保留。
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadJson(legacyData)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-indigo-800 hover:bg-indigo-100"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            下載備份
          </button>
          <button
            type="button"
            disabled={currentHasData || queuedForSync}
            onClick={() => {
              importData(legacyData);
              setQueuedForSync(true);
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            匯入目前帳號
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="min-h-11 rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-white"
          >
            稍後處理
          </button>
        </div>
      </div>
    </section>
  );
};
