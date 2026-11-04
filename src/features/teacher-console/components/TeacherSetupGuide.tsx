import { Check, ArrowRight } from 'lucide-react';
import type { Language } from '../../../store/types';
import type { TeacherSetupController } from '../hooks/useTeacherSetup';

type Props = {
  setup: TeacherSetupController;
  language: Language;
  disabled: boolean;
  onStep: (step: 'class' | 'roster' | 'points' | 'review') => void;
};

/** Optional guidance around existing feature owners; opening it never mutates a workspace. */
export const TeacherSetupGuide = ({ setup, language, disabled, onStep }: Props) => {
  if (!setup.ready) return null;
  const zh = language === 'zh';
  const active = setup.state.mode === 'active';
  const labels = zh
    ? { class: '建立第一個班級', roster: '新增或匯入學生', points: '完成第一次加減分', review: '查看學生狀態', game: '選擇遊戲化介面' }
    : { class: 'Create your first class', roster: 'Add or import students', points: 'Make your first point adjustment', review: 'Review student status', game: 'Choose your gamification interface' };
  const next = setup.steps.find((step) => !step.completed);
  const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:opacity-50';
  return <section aria-label={zh ? '使用導覽' : 'Getting started'} className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="font-bold text-slate-900">{active ? (zh ? '從第一個班級開始' : 'Start with your first class') : setup.state.mode === 'completed' ? (zh ? '已完成使用導覽' : 'Getting started completed') : (zh ? '依自己的步調開始' : 'Get started at your own pace')}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-700">{active ? (zh ? `已完成 ${setup.completedCount} / 5 步；已有的班級與紀錄會直接沿用。` : `${setup.completedCount} / 5 steps complete. Existing classes and records are reused.`) : setup.state.mode === 'completed' ? (zh ? '已完成初次操作，可隨時在快速操作調整遊戲化介面。' : 'You have finished the guide. Change gamification from Quick actions anytime.') : (zh ? '導覽可隨時繼續，不影響日常操作。' : 'You can return to the guide anytime without interrupting daily work.')}</p>
      </div>
      {!active && setup.state.mode !== 'completed' && <button type="button" onClick={setup.start} disabled={disabled} className={buttonClass}>{setup.state.mode === 'idle' ? (zh ? '開始使用導覽' : 'Start setup guide') : (zh ? '繼續使用導覽' : 'Resume setup guide')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}
      {active && <div className="flex flex-wrap gap-2">
        <button type="button" onClick={setup.pause} className={buttonClass}>{zh ? '稍後繼續' : 'Continue later'}</button>
        <button type="button" onClick={setup.skip} className="min-h-11 rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white focus-visible:outline-2 focus-visible:outline-indigo-700">{zh ? '略過導覽' : 'Skip guide'}</button>
      </div>}
    </div>
    {active && <ol className="mt-4 divide-y divide-indigo-100">
      {setup.steps.map((step, index) => <li key={step.id} aria-current={next?.id === step.id ? 'step' : undefined} className="flex items-start gap-3 py-3">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.completed ? 'bg-indigo-700 text-white' : 'border border-slate-400 bg-white text-slate-700'}`}>{step.completed ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}<span className="sr-only">{step.completed ? (zh ? '已完成' : 'Completed') : ''}</span></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{labels[step.id]}</p>
          {step.id === 'class' && step.completed && <p className="mt-1 text-sm text-slate-600">{zh ? '已有可用班級，直接使用即可，不需重複建立。' : 'A class is ready to use. No duplicate class is needed.'}</p>}
          {next?.id === step.id && <div className="mt-3 flex flex-wrap gap-2">
            {step.id === 'game' ? <>
              <p className="w-full text-sm leading-6 text-slate-700">{zh ? '只調整寵物、對戰與活動入口的顯示；資料與計算保留，之後可隨時更改。' : 'Only pet, battle and activity entry visibility changes. Data and calculations stay intact; change this anytime.'}</p>
              <button type="button" disabled={disabled} onClick={() => setup.setGameMode('shown')} className={buttonClass}>{zh ? '顯示遊戲化功能' : 'Show gamification'}</button>
              <button type="button" disabled={disabled} onClick={() => setup.setGameMode('hidden')} className={buttonClass}>{zh ? '先專注教學' : 'Focus on teaching for now'}</button>
            </> : <button type="button" disabled={disabled} onClick={() => onStep(step.id as 'class' | 'roster' | 'points' | 'review')} className={buttonClass}>{step.id === 'roster' ? (zh ? '加入／匯入學生' : 'Add / import students') : labels[step.id]}<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}
          </div>}
        </div>
      </li>)}
    </ol>}
    {!setup.storageAvailable && <p role="status" className="mt-3 text-sm text-amber-900">{zh ? '瀏覽器無法保存導覽偏好；本次操作仍可繼續，關閉頁面後可能需要重新選擇。' : 'This browser cannot save guide preferences. You can continue; choices may need to be made again after closing the page.'}</p>}
  </section>;
};
