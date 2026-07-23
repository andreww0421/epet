import React, { useEffect } from 'react';
import { Dog, Users, Settings, Smile, AlertCircle, Dices } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from './store/useStore';
import { translations } from './i18n/translations';
import { ClassroomView } from './components/ClassroomView';
import { DashboardView } from './components/DashboardView';

export default function App() {
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
              <Dog className="h-8 w-8 text-indigo-600 mr-3" />
              <span className="font-bold text-xl text-gray-900">{tLang.appTitle}</span>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setView('classroom')}
                className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  view === 'classroom' 
                    ? 'bg-amber-100 text-amber-800' 
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Users className="h-4 w-4 mr-2" />
                {tLang.classroom}
              </button>
              <button
                onClick={() => setView('dashboard')}
                className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  view === 'dashboard' 
                    ? 'bg-indigo-100 text-indigo-800' 
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Settings className="h-4 w-4 mr-2" />
                {tLang.dashboard}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {view === 'dashboard' ? <DashboardView /> : <ClassroomView />}
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
