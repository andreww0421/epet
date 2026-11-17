import { useState } from 'react';
import { cloneGameFeaturePreset, resolveGameFeatures, type GameFeatures, type GameFeaturePreset } from '../../../../shared/gameFeatures';
import type { Language } from '../../../store/types';
import { useStore } from '../../../store/useStore';
import { useWorkspaceMutationGuard } from '../../workspace/hooks/useWorkspaceMutationGuard';

/** A narrow settings write: changing entry points never applies economy/rule drafts. */
export const GameFeatureSettings = ({ canWrite, language }: { canWrite: boolean; language: Language }) => {
  const persisted = useStore((state) => state.data.settings?.gameFeatures);
  const updateSettings = useStore((state) => state.updateSettings);
  const [draft, setDraft] = useState<GameFeatures | null>(null);
  const [saved, setSaved] = useState(false);
  const runMutation = useWorkspaceMutationGuard(canWrite);
  const flags = draft ?? resolveGameFeatures(persisted);
  const dirty = JSON.stringify(flags) !== JSON.stringify(resolveGameFeatures(persisted));
  const zh = language === 'zh';
  const edit = (value: GameFeatures) => { setDraft(value); setSaved(false); };
  const presets: [GameFeaturePreset, string][] = [
    ['simple', zh ? '簡約養成（建議）' : 'Simple care (recommended)'],
    ['full', zh ? '完整活動' : 'All activities'],
    ['teaching', zh ? '專注教學' : 'Teaching focus'],
  ];
  const labels: Record<keyof GameFeatures, string> = zh
    ? { pets: '寵物養成與照顧', battles: '個人與隊伍對戰', bosses: '魔王副本', leaderboards: '排行榜' }
    : { pets: 'Pet growth and care', battles: 'Solo and team battles', bosses: 'Boss activities', leaderboards: 'Leaderboards' };
  return <section aria-labelledby="game-features-title" className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 sm:p-5">
    <h3 id="game-features-title" className="text-base font-bold text-slate-900">{zh ? '遊戲化活動入口' : 'Gamification entry points'}</h3>
    <p className="mt-2 text-sm leading-6 text-slate-700">{zh
      ? '管理員決定教師控制台顯示哪些活動。隱藏後仍保留玩家進度與歷史，既有規則、時間衰減及班級展示照常運作。'
      : 'Admins choose activities in the Teacher Console. Hiding keeps progress and history; existing rules, time decay and classroom presentation continue.'}</p>
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={zh ? '活動介面方案' : 'Activity interface presets'}>
      {presets.map(([id, label]) => <button key={id} type="button" disabled={!canWrite} onClick={() => edit(cloneGameFeaturePreset(id))}
        className="min-h-11 rounded-md border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-indigo-700">{label}</button>)}
    </div>
    <fieldset disabled={!canWrite} className="mt-4 grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">{zh ? '顯示的活動' : 'Visible activities'}</legend>
      {(Object.keys(labels) as (keyof GameFeatures)[]).map((key) => <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800">
        <input type="checkbox" checked={flags[key]} onChange={(event) => edit({ ...flags, [key]: event.target.checked })} className="h-5 w-5 accent-indigo-700" />{labels[key]}
      </label>)}
    </fieldset>
    <p className="mt-3 text-sm text-slate-600">{zh ? '方案只調整入口。友善規則沿用下方的包容模式；個人隱藏偏好仍可進一步精簡。遊戲紀錄可由「班級 → 紀錄」查看。' : 'Presets only change entry points. Inclusive mode below controls friendly rules. Personal hiding still applies; game history remains in Class → Records.'}</p>
    <button type="button" disabled={!canWrite || !dirty} onClick={() => runMutation(() => {
      updateSettings({ gameFeatures: { ...flags } });
      setDraft(null); setSaved(true);
    })} className="mt-4 min-h-11 rounded-md bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:bg-slate-200 disabled:text-slate-500">
      {zh ? '儲存活動入口' : 'Save activity entry points'}
    </button>
    <p role="status" className="mt-2 text-sm text-slate-600">{dirty ? (zh ? '活動入口尚未儲存。' : 'Entry point changes are not saved.') : saved
      ? (zh ? '活動入口已加入工作區；雲端保存狀態請見上方同步提示。' : 'Entry points added to the workspace. Check cloud sync status above.') : ''}</p>
  </section>;
};
