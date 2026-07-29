import React, { lazy, Suspense, useEffect } from 'react';
import {
  AlertCircle, CloudOff, Database, Dices, Dog, RefreshCw, Settings, Smile, Users,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from './store/useStore';
import { translations } from './i18n/translations';
import { useBackendSync } from './hooks/useBackendSync';

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

export default function App() {
  const backendStatus = useBackendSync();
  const {
    view,
    toast,
    upgradeReward,
    lang,
    setView,
    advanceUpgradeRewardProgress,
    setUpgradeReward,
    rerollPetFromUpgrade,
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
    })),
  );
  const tLang = translations[lang];

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [view]);

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
              >
                {backendStatus === 'connected' ? (
                  <Database className="h-4 w-4" />
                ) : backendStatus === 'saving' || backendStatus === 'checking' ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <CloudOff className="h-4 w-4" />
                )}
              </span>
              <button
                onClick={() => setView('classroom')}
                aria-label={tLang.classroom}
                title={tLang.classroom}
                className={`flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium transition-colors sm:h-auto sm:w-auto sm:px-4 sm:py-2 ${
                  view === 'classroom' 
                    ? 'bg-amber-100 text-amber-800' 
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Users className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{tLang.classroom}</span>
              </button>
              <button
                onClick={() => setView('dashboard')}
                aria-label={tLang.dashboard}
                title={tLang.dashboard}
                className={`flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium transition-colors sm:h-auto sm:w-auto sm:px-4 sm:py-2 ${
                  view === 'dashboard' 
                    ? 'bg-indigo-100 text-indigo-800' 
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Settings className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{tLang.dashboard}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Suspense
          fallback={(
            <div className="flex min-h-64 items-center justify-center text-sm font-medium text-slate-500">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              {tLang.loading}
            </div>
          )}
        >
          {view === 'dashboard' ? <DashboardView /> : <ClassroomView />}
        </Suspense>
      </main>

      {/* Upgrade Gacha Reward Modal */}
      {upgradeReward && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="p-6">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
                <Dices className="h-7 w-7 text-amber-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 text-center mb-2">{tLang.upgradeGachaTitle}</h3>
              <p className="text-sm text-slate-600 text-center leading-6">
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
          <div className={`px-4 py-3 rounded-lg shadow-lg flex items-center ${
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
