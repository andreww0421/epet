import { useRef, type ChangeEvent } from 'react';
import { Download, Upload } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { runWorkspaceMutation } from '../../../auth/workspaceAccess';
import { translations } from '../../../i18n/translations';
import { exportWorkspacePrivacyData } from '../../../services/backendApi';
import { useStore } from '../../../store/useStore';

type DashboardHeaderProps = {
  canAdministerWorkspace: boolean;
  canExportFullData: boolean;
  readOnly: boolean;
  description?: string;
};

/** Owns workspace import/export affordances and keeps file APIs out of the page shell. */
export const DashboardHeader = ({
  canAdministerWorkspace,
  canExportFullData,
  readOnly,
  description,
}: DashboardHeaderProps) => {
  const { data, importData, showToast } = useStore(useShallow((state) => ({
    data: state.data,
    importData: state.importData,
    showToast: state.showToast,
  })));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const language = data.settings?.language || 'zh';
  const copy = translations[language];

  const exportData = async () => {
    if (!canExportFullData) return;
    try {
      const snapshot = await exportWorkspacePrivacyData();
      if (!snapshot.activeWorkspace.state) throw new Error('Workspace state is unavailable');
      const blob = new Blob(
        [JSON.stringify(snapshot.activeWorkspace.state, null, 2)],
        { type: 'application/json' },
      );
      const dataUrl = URL.createObjectURL(blob);
      const linkElement = document.createElement('a');
      linkElement.href = dataUrl;
      linkElement.download = `epet_workspace_export_${snapshot.exportedAt.slice(0, 10)}.json`;
      linkElement.click();
      window.setTimeout(() => URL.revokeObjectURL(dataUrl), 0);
    } catch {
      showToast(copy.exportFailed, 'error');
    }
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const importedData: unknown = JSON.parse(String(loadEvent.target?.result ?? ''));
        const record = importedData && typeof importedData === 'object'
          ? importedData as Record<string, unknown>
          : null;
        const hasSupportedShape = Array.isArray(record?.classes) || Array.isArray(record?.students);
        if (hasSupportedShape) {
          runWorkspaceMutation(
            !readOnly,
            () => {
              importData(importedData);
              showToast(copy.importSuccess, 'success');
            },
            () => showToast(
              language === 'en'
                ? 'This workspace is read-only for your account.'
                : '目前帳號只能閱讀此工作區。',
              'error',
            ),
          );
        } else {
          showToast(copy.invalidData, 'error');
        }
      } catch {
        showToast(copy.invalidData, 'error');
      }
    };
    reader.onerror = () => showToast(copy.fileReadFailed, 'error');
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="sm:flex sm:items-center sm:justify-between mb-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{copy.dashboard}</h1>
        <p className="mt-2 text-sm text-slate-600">{description ?? copy.dashboardDesc}</p>
      </div>
      <div className="mt-4 sm:mt-0 flex space-x-3">
        {canExportFullData && (
          <button
            type="button"
            onClick={() => void exportData()}
            className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <Download className="h-4 w-4 mr-2" />
            {copy.exportData}
          </button>
        )}
        {canAdministerWorkspace && (
          <>
            <input
              type="file"
              accept=".json"
              className="hidden"
              ref={fileInputRef}
              onChange={handleImport}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
              <Upload className="h-4 w-4 mr-2" />
              {copy.importData}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
