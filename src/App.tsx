import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CloudOff, Database, Dices, Dog, LogOut, RefreshCw, Settings, Smile, Users,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { resetStoreForSession, useStore } from './store/useStore';
import { translations } from './i18n/translations';
import { useBackendSync } from './hooks/useBackendSync';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthScreen } from './components/AuthScreen';
import {
  EmailVerificationScreen,
  readEmailVerificationRoute,
} from './components/EmailVerificationScreen';
import { LegacyDataMigration } from './components/LegacyDataMigration';
import { AccountDeletionDialog } from './components/AccountDeletionDialog';
import {
  canAdministerWorkspace,
  canExportWorkspace,
  canWriteWorkspace,
} from './auth/workspaceAccess';

const ClassroomView = lazy(() =>
  import('./components/ClassroomView').then((module) => ({
    default: module.ClassroomView,
  })),
);
const DashboardView = lazy(() =>
  import('./components/DashboardView').then((module) => ({
    default: module.DashboardView,
  })),
);

const downloadUnsyncedWorkspace = (canExportFullData: boolean) => {
  if (!canExportFullData) return;
  const blob = new Blob(
    [JSON.stringify(useStore.getState().data, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `epet-unsynced-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const EmptyWorkspaceView = ({
  language,
  flushChanges,
}: {
  language: 'zh' | 'en';
  flushChanges: () => Promise<boolean>;
}) => {
  const { createWorkspace, logout } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      resetStoreForSession();
      await createWorkspace(name.trim());
    } catch {
      setError(language === 'en'
        ? 'The workspace could not be created. Please retry.'
        : '無法建立工作區，請稍後再試。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <Dog className="h-10 w-10 text-indigo-700" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-black text-slate-950">
          {language === 'en' ? 'Create a workspace' : '建立新工作區'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {language === 'en'
            ? 'This account has no workspace. Create one to continue, or use account settings to delete the account.'
            : '這個帳號目前沒有工作區。你可建立新工作區繼續使用，或從帳號設定刪除帳號。'}
        </p>
        {error && <p role="alert" className="mt-4 border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900">{error}</p>}
        <label className="mt-5 block text-sm font-bold text-slate-800">
          {language === 'en' ? 'Workspace name' : '工作區名稱'}
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-2 block min-h-12 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <button type="button" onClick={() => void submit()} disabled={busy || !name.trim()} className="mt-4 min-h-12 w-full rounded-lg bg-indigo-700 px-4 py-3 font-black text-white disabled:bg-slate-300">
          {language === 'en' ? 'Create workspace' : '建立工作區'}
        </button>
        <div className="mt-5 flex justify-center gap-3">
          <button type="button" onClick={() => setAccountDialogOpen(true)} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">
            {language === 'en' ? 'Account settings' : '帳號設定'}
          </button>
          <button type="button" onClick={() => void logout()} className="min-h-11 rounded-lg px-4 py-2 text-sm font-bold text-slate-600">
            {language === 'en' ? 'Log out' : '登出'}
          </button>
        </div>
      </section>
      {accountDialogOpen && (
        <AccountDeletionDialog language={language} onClose={() => setAccountDialogOpen(false)} flushChanges={flushChanges} />
      )}
    </main>
  );
};

function WorkspaceApp() {
  const { session, logout, selectWorkspace, invalidateSession } = useAuth();
  const workspaceSwitchInFlight = useRef(false);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const activeWorkspaceId = session?.activeWorkspaceId ?? null;
  const activeWorkspace = session?.workspaces.find(
    (workspace) => workspace.id === activeWorkspaceId,
  );
  const activeWorkspaceRole = activeWorkspace?.role ?? session?.user.role;
  const canManage = canWriteWorkspace(activeWorkspaceRole);
  const canAdminister = canAdministerWorkspace(activeWorkspaceRole);
  const hasFullExportRole = canExportWorkspace(activeWorkspaceRole);
  const handleAuthenticationInvalid = useCallback(
    () => invalidateSession(),
    [invalidateSession],
  );
  const { status: backendStatus, flush: flushBackendChanges } = useBackendSync(
    true,
    activeWorkspaceId,
    handleAuthenticationInvalid,
    canManage,
  );
  const canExportFullData =
    hasFullExportRole && backendStatus === 'connected';
  const {
    view,
    toast,
    upgradeReward,
    lang,
    setView,
    advanceUpgradeRewardProgress,
    setUpgradeReward,
    rerollPetFromUpgrade,
    showToast,
  } = useStore(
    useShallow((state) => ({
      view: state.view,
      toast: state.toast,
      upgradeReward: state.upgradeReward,
      lang: state.data.settings?.language || 'zh',
      setView: state.setView,
      advanceUpgradeRewardProgress: state.advanceUpgradeRewardProgress,
      setUpgradeReward: state.setUpgradeReward,
      rerollPetFromUpgrade: state.rerollPetFromUpgrade,
      showToast: state.showToast,
    })),
  );
  const tLang = translations[lang];
  const activeWorkspaceName =
    activeWorkspace?.name
    ?? (lang === 'en' ? 'current workspace' : '目前工作區');
  const effectiveView = canManage ? view : 'dashboard';
  const workspaceReady =
    !switchingWorkspace &&
    (backendStatus === 'connected' || backendStatus === 'saving');

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [effectiveView]);

  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
  }, [lang]);

  const handleLogout = useCallback(async () => {
    if (!(await flushBackendChanges())) {
      showToast(
        lang === 'en'
          ? 'Unsaved changes could not be synchronized. Download the local draft or retry before logging out.'
          : '尚有變更無法同步；請先下載本機草稿或重試，再登出。',
        'error',
      );
      return;
    }
    await logout();
  }, [flushBackendChanges, lang, logout, showToast]);

  const handleWorkspaceChange = useCallback(async (workspaceId: string) => {
    if (workspaceSwitchInFlight.current || workspaceId === activeWorkspaceId) return;
    workspaceSwitchInFlight.current = true;
    setSwitchingWorkspace(true);
    try {
      if (!(await flushBackendChanges())) {
        showToast(
          lang === 'en'
            ? 'Finish synchronizing the current workspace before switching.'
            : '目前工作區尚未同步完成，暫時無法切換。',
          'error',
        );
        return;
      }
      // The sync hook owns reset/hydration after the old listener is detached.
      await selectWorkspace(workspaceId);
    } catch {
      showToast(
        lang === 'en'
          ? 'The workspace could not be switched. Please retry.'
          : '無法切換工作區，請稍後再試。',
        'error',
      );
    } finally {
      workspaceSwitchInFlight.current = false;
      setSwitchingWorkspace(false);
    }
  }, [activeWorkspaceId, flushBackendChanges, lang, selectWorkspace, showToast]);

  if (session && session.workspaces.length === 0) {
    return (
      <EmptyWorkspaceView
        language={lang}
        flushChanges={flushBackendChanges}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Navbar */}
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Dog className="mr-2 h-8 w-8 shrink-0 text-indigo-600 sm:mr-3" />
              <span className="whitespace-nowrap text-base font-bold text-gray-900 sm:text-xl">
                {tLang.appTitle}
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-4">
              {session && session.workspaces.length > 1 && (
                <label className="hidden items-center gap-2 text-xs font-bold text-slate-600 lg:flex">
                  <span>{lang === 'en' ? 'Workspace' : '工作區'}</span>
                  <select
                    value={activeWorkspaceId ?? ''}
                    disabled={switchingWorkspace || backendStatus === 'checking'}
                    onChange={(event) => {
                      void handleWorkspaceChange(event.target.value);
                    }}
                    className="min-h-10 max-w-48 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                  >
                    {session.workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span
                className={`hidden h-8 w-8 items-center justify-center rounded-md sm:inline-flex ${
                  backendStatus === 'connected'
                    ? 'bg-emerald-50 text-emerald-700'
                    : backendStatus === 'conflict'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-slate-100 text-slate-500'
                }`}
                title={
                  backendStatus === 'connected'
                    ? (lang === 'en' ? 'Backend synchronized' : '後端已同步')
                    : backendStatus === 'saving'
                      ? (lang === 'en' ? 'Saving to backend' : '正在同步後端')
                      : backendStatus === 'conflict'
                        ? (lang === 'en' ? 'Backend revision conflict' : '後端版本衝突')
                        : (lang === 'en' ? 'Offline local cache' : '離線本機快取')
                }
                role="status"
                aria-live="polite"
              >
                {backendStatus === 'connected' ? (
                  <Database className="h-4 w-4" />
                ) : backendStatus === 'saving' || backendStatus === 'checking' ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <CloudOff className="h-4 w-4" />
                )}
                <span className="sr-only">
                  {backendStatus === 'connected'
                    ? (lang === 'en' ? 'Backend synchronized' : '後端已同步')
                    : backendStatus === 'saving'
                      ? (lang === 'en' ? 'Saving to backend' : '正在同步後端')
                      : backendStatus === 'conflict'
                        ? (lang === 'en' ? 'Backend revision conflict' : '後端版本衝突')
                        : backendStatus === 'forbidden'
                          ? (lang === 'en' ? 'Workspace access denied' : '沒有此工作區權限')
                          : (lang === 'en' ? 'Offline local cache' : '離線本機模式')}
                </span>
              </span>
              {canManage && (
                <button
                  onClick={() => setView('classroom')}
                  aria-label={tLang.classroom}
                  title={tLang.classroom}
                  className={`flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium transition-colors sm:h-auto sm:w-auto sm:px-4 sm:py-2 ${
                    effectiveView === 'classroom'
                      ? 'bg-amber-100 text-amber-800'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Users className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{tLang.classroom}</span>
                </button>
              )}
              <button
                onClick={() => setView('dashboard')}
                aria-label={tLang.dashboard}
                title={tLang.dashboard}
                className={`flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium transition-colors sm:h-auto sm:w-auto sm:px-4 sm:py-2 ${
                  effectiveView === 'dashboard'
                    ? 'bg-indigo-100 text-indigo-800'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Settings className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{tLang.dashboard}</span>
              </button>
              {session && (
                <div className="hidden text-right xl:block">
                  <p className="max-w-36 truncate text-xs font-bold text-slate-800">
                    {session.user.displayName}
                  </p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                    {activeWorkspaceRole}
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleLogout()}
                aria-label={lang === 'en' ? 'Log out' : '登出'}
                title={lang === 'en' ? 'Log out' : '登出'}
                className="flex h-10 w-10 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      {backendStatus === 'connected' && canAdminister && (
        <LegacyDataMigration workspaceName={activeWorkspaceName} />
      )}
      {(backendStatus === 'conflict' || backendStatus === 'forbidden') && (
        <div
          role="alert"
          className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-bold text-amber-900"
        >
          {backendStatus === 'conflict'
            ? (lang === 'en'
                ? 'A newer workspace version exists. Reload before making more changes.'
                : '雲端已有較新的工作區版本，請重新整理後再繼續操作。')
            : (lang === 'en'
                ? 'Your account does not have permission to open this workspace.'
                : '目前帳號沒有開啟此工作區的權限。')}
        </div>
      )}
      <main className="flex-1 overflow-auto">
        {workspaceReady ? (
          <Suspense
            fallback={(
              <div className="flex min-h-64 items-center justify-center text-sm font-medium text-slate-500">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {tLang.loading}
              </div>
            )}
          >
            {effectiveView === 'dashboard'
              ? (
                  <DashboardView
                    readOnly={!canManage}
                    canExportFullData={canExportFullData}
                    canAdministerWorkspace={canAdminister}
                    flushChanges={flushBackendChanges}
                  />
                )
              : <ClassroomView />}
          </Suspense>
        ) : (
          <section
            className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center"
            aria-live="polite"
          >
            {backendStatus === 'checking' || switchingWorkspace ? (
              <>
                <RefreshCw className="h-8 w-8 animate-spin text-indigo-600" aria-hidden="true" />
                <h1 className="mt-5 text-xl font-black text-slate-900">
                  {lang === 'en' ? 'Loading workspace' : '正在安全載入工作區'}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {lang === 'en'
                    ? 'Editing will be enabled after the latest revision is loaded.'
                    : '取得最新版本前暫停編輯，避免覆寫雲端資料。'}
                </p>
              </>
            ) : (
              <>
                <CloudOff className="h-9 w-9 text-amber-600" aria-hidden="true" />
                <h1 className="mt-5 text-xl font-black text-slate-900">
                  {backendStatus === 'conflict'
                    ? (lang === 'en' ? 'Revision conflict' : '資料版本衝突')
                    : (lang === 'en' ? 'Workspace unavailable' : '目前無法安全開啟工作區')}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {lang === 'en'
                    ? hasFullExportRole
                      ? 'Editing is paused so unsynchronized student data is not lost or overwritten. Download the local draft before reloading.'
                      : 'Editing is paused so unsynchronized student data is not lost or overwritten. Ask a workspace admin to handle a full-data export.'
                    : hasFullExportRole
                      ? '系統已暫停編輯，避免未同步的學生資料遺失或覆寫。你可以先下載目前記憶體中的草稿，再重新載入。'
                      : '系統已暫停編輯，避免未同步的學生資料遺失或覆寫。完整資料匯出請由工作區管理者處理。'}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  {hasFullExportRole && (
                    <button
                      type="button"
                      onClick={() => downloadUnsyncedWorkspace(hasFullExportRole)}
                      className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
                    >
                      {lang === 'en' ? 'Download local draft' : '下載本機草稿'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="min-h-11 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800"
                  >
                    {lang === 'en' ? 'Reload latest version' : '重新載入最新版本'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </main>

      {/* Upgrade Gacha Reward Modal */}
      {upgradeReward && canManage && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upgrade-reward-title"
            aria-describedby="upgrade-reward-description"
            className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden"
          >
            <div className="p-6">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
                <Dices className="h-7 w-7 text-amber-600" />
              </div>
              <h3 id="upgrade-reward-title" className="text-xl font-bold text-slate-900 text-center mb-2">{tLang.upgradeGachaTitle}</h3>
              <p id="upgrade-reward-description" className="text-sm text-slate-600 text-center leading-6">
                {tLang.upgradeGachaDesc
                  .replace('{name}', upgradeReward.studentName)
                  .replace('{level}', upgradeReward.reachedLevel.toString())}
              </p>
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {tLang.upgradeGachaResetNote}
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  advanceUpgradeRewardProgress(upgradeReward.studentId, upgradeReward.reachedLevel);
                  setUpgradeReward(null);
                }}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                {tLang.upgradeGachaKeep}
              </button>
              <button
                onClick={() => {
                  rerollPetFromUpgrade(upgradeReward.studentId, upgradeReward.reachedLevel);
                  setUpgradeReward(null);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-500 border border-transparent rounded-md hover:bg-amber-600"
              >
                {tLang.upgradeGachaDraw}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-[bounce_0.5s_ease-in-out]">
          <div
            role={toast.type === 'success' ? 'status' : 'alert'}
            aria-live={toast.type === 'success' ? 'polite' : 'assertive'}
            className={`px-4 py-3 rounded-lg shadow-lg flex items-center ${
            toast.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {toast.type === 'success' ? <Smile className="h-5 w-5 mr-2" /> : <AlertCircle className="h-5 w-5 mr-2" />}
            <span className="font-medium">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const AuthenticatedApp = () => {
  const { status, session } = useAuth();
  const [verificationRoute, setVerificationRoute] = useState(
    readEmailVerificationRoute,
  );
  useEffect(() => {
    const updateRoute = () => setVerificationRoute(
      readEmailVerificationRoute(),
    );
    window.addEventListener('hashchange', updateRoute);
    window.addEventListener('popstate', updateRoute);
    return () => {
      window.removeEventListener('hashchange', updateRoute);
      window.removeEventListener('popstate', updateRoute);
    };
  }, []);
  if (
    verificationRoute.active ||
    (status === 'authenticated' && session?.user.emailVerified === false)
  ) {
    return <EmailVerificationScreen token={verificationRoute.token} />;
  }
  return status === 'authenticated' ? <WorkspaceApp /> : <AuthScreen />;
};

export default function App() {
  return (
    <AuthProvider onSessionCleared={resetStoreForSession}>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
