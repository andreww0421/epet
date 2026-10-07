import { useState } from 'react';
import { Skull } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { BossRewardSettings } from './BossRewardSettings';
import {
  DEFAULT_BOSS_IMPROVEMENT_REWARD,
  DEFAULT_BOSS_PARTICIPATION_REWARD,
  DEFAULT_BOSS_REWARD_TIERS,
} from '../../../gameRules';
import { translations } from '../../../i18n/translations';
import type { BossRewardTier } from '../../../store/types';
import { useStore } from '../../../store/useStore';
import { useWorkspaceMutationGuard } from '../../workspace/hooks/useWorkspaceMutationGuard';

type BossManagementSectionProps = {
  canWrite: boolean;
  mode?: 'boss' | 'rewards' | 'all';
  visible: boolean;
};

/** One summon draft owner; mode separates boss operations from summon-time reward settings. */
export const BossManagementSection = ({ canWrite, mode = 'all', visible }: BossManagementSectionProps) => {
  const { data, removeBoss, summonBoss } = useStore(useShallow((state) => ({
    data: state.data,
    removeBoss: state.removeBoss,
    summonBoss: state.summonBoss,
  })));
  const lang = data.settings?.language || 'zh';
  const tLang = translations[lang];
  const currentClass = data.classes.find((classData) => classData.id === data.currentClassId);
  const currentStudents = currentClass?.students ?? [];
  const [bossNameInput, setBossNameInput] = useState('');
  const [bossHpInput, setBossHpInput] = useState(1000);
  const [bossRewardTiers, setBossRewardTiers] = useState<BossRewardTier[]>(() =>
    DEFAULT_BOSS_REWARD_TIERS.map((tier) => ({ ...tier })),
  );
  const [bossParticipationPoints, setBossParticipationPoints] = useState(
    DEFAULT_BOSS_PARTICIPATION_REWARD.points,
  );
  const [bossParticipationRankPoints, setBossParticipationRankPoints] = useState(
    DEFAULT_BOSS_PARTICIPATION_REWARD.rankPoints,
  );
  const [bossParticipationHappiness, setBossParticipationHappiness] = useState(
    DEFAULT_BOSS_PARTICIPATION_REWARD.happiness,
  );
  const [bossImprovementPoints, setBossImprovementPoints] = useState(
    DEFAULT_BOSS_IMPROVEMENT_REWARD.points,
  );
  const [bossImprovementRankPoints, setBossImprovementRankPoints] = useState(
    DEFAULT_BOSS_IMPROVEMENT_REWARD.rankPoints,
  );
  const [bossImprovementHappiness, setBossImprovementHappiness] = useState(
    DEFAULT_BOSS_IMPROVEMENT_REWARD.happiness,
  );
  const runMutation = useWorkspaceMutationGuard(canWrite);

  return (
    <div className={`${visible ? '' : 'hidden'} bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mt-6 p-5`}>
      <h2 className="text-lg font-medium text-amber-900 mb-4 flex items-center">
        <Skull className="h-5 w-5 mr-2 text-rose-500" />
        {mode === 'rewards' ? tLang.bossRankRewards : tLang.bossManagement ?? '魔王副本管理'}
      </h2>
      {mode === 'rewards' && (
        <p className="mb-4 text-sm text-slate-600">
          {currentClass?.activeBoss?.isActive
            ? lang === 'en'
              ? 'The active boss keeps its existing rewards. Configure the next boss after this activity ends.'
              : '目前魔王保留原有獎勵；活動結束後可設定下一隻魔王的獎勵。'
            : lang === 'en'
              ? 'These drafts apply when you summon the next boss from Activities.'
              : '這些草稿會在「活動」召喚下一隻魔王時套用。'}
        </p>
      )}
      {currentClass?.activeBoss?.isActive ? (
        <div hidden={mode === 'rewards'}>
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex-1 w-full">
              <h3 className="text-lg font-bold text-rose-800 flex items-center mb-2">
                {currentClass.activeBoss.name}
              </h3>
              <div className="w-full bg-slate-200 rounded-full h-4 relative overflow-hidden">
                <div
                  className="bg-rose-500 h-4 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(0, (currentClass.activeBoss.currentHp / currentClass.activeBoss.maxHp) * 100)}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white shadow-black drop-shadow-md">
                  {currentClass.activeBoss.currentHp} / {currentClass.activeBoss.maxHp}
                </div>
              </div>
            </div>
            <button
              onClick={() => runMutation(removeBoss)}
              className="bg-white text-rose-600 border border-rose-200 px-4 py-2 rounded-md font-medium hover:bg-rose-100 transition-colors shrink-0"
            >
              {tLang.removeBoss ?? '撤退魔王'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div hidden={mode === 'rewards'}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="teacher-boss-name" className="mb-1 block text-sm font-medium text-slate-700">{tLang.bossName}</label>
                <input
                  id="teacher-boss-name"
                  type="text"
                  value={bossNameInput}
                  onChange={(event) => setBossNameInput(event.target.value)}
                  placeholder={tLang.enterBossName}
                  className="w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500"
                />
              </div>
              <div>
                <label htmlFor="teacher-boss-hp" className="mb-1 block text-sm font-medium text-slate-700">{tLang.bossHp}</label>
                <input
                  id="teacher-boss-hp"
                  type="number"
                  min="1"
                  value={bossHpInput}
                  onChange={(event) => setBossHpInput(Number(event.target.value))}
                  className="w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500"
                />
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="border-l-4 border-emerald-500 bg-emerald-50 p-4">
                <h3 className="text-sm font-bold text-emerald-900">{tLang.bossParticipationReward}</h3>
                <p className="mt-1 text-xs text-emerald-800">{tLang.bossParticipationRewardHint}</p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardPoints}
                    <input type="number" min="0" value={bossParticipationPoints} onChange={(event) => setBossParticipationPoints(Number(event.target.value))} className="mt-1 w-full rounded-md border border-emerald-200 bg-white p-2 text-sm" />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardRankPoints}
                    <input type="number" min="0" value={bossParticipationRankPoints} onChange={(event) => setBossParticipationRankPoints(Number(event.target.value))} className="mt-1 w-full rounded-md border border-emerald-200 bg-white p-2 text-sm" />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardHappiness}
                    <input type="number" min="0" value={bossParticipationHappiness} onChange={(event) => setBossParticipationHappiness(Number(event.target.value))} className="mt-1 w-full rounded-md border border-emerald-200 bg-white p-2 text-sm" />
                  </label>
                </div>
              </div>
              <div className="border-l-4 border-sky-500 bg-sky-50 p-4">
                <h3 className="text-sm font-bold text-sky-900">{tLang.bossImprovementReward}</h3>
                <p className="mt-1 text-xs text-sky-800">{tLang.bossImprovementRewardHint}</p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardPoints}
                    <input type="number" min="0" value={bossImprovementPoints} onChange={(event) => setBossImprovementPoints(Number(event.target.value))} className="mt-1 w-full rounded-md border border-sky-200 bg-white p-2 text-sm" />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardRankPoints}
                    <input type="number" min="0" value={bossImprovementRankPoints} onChange={(event) => setBossImprovementRankPoints(Number(event.target.value))} className="mt-1 w-full rounded-md border border-sky-200 bg-white p-2 text-sm" />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardHappiness}
                    <input type="number" min="0" value={bossImprovementHappiness} onChange={(event) => setBossImprovementHappiness(Number(event.target.value))} className="mt-1 w-full rounded-md border border-sky-200 bg-white p-2 text-sm" />
                  </label>
                </div>
              </div>
            </div>

            <BossRewardSettings
              tiers={bossRewardTiers}
              onChange={setBossRewardTiers}
              studentCount={currentStudents.length}
              labels={tLang}
            />
          </div>

          <div hidden={mode === 'rewards'}>
            <button
              onClick={() => {
                runMutation(() => summonBoss(
                  bossNameInput,
                  bossHpInput,
                  bossRewardTiers,
                  {
                    points: Math.max(0, Number(bossParticipationPoints)),
                    happiness: Math.max(0, Number(bossParticipationHappiness)),
                    rankPoints: Math.max(0, Number(bossParticipationRankPoints)),
                  },
                  {
                    points: Math.max(0, Number(bossImprovementPoints)),
                    happiness: Math.max(0, Number(bossImprovementHappiness)),
                    rankPoints: Math.max(0, Number(bossImprovementRankPoints)),
                  },
                ));
                setBossNameInput('');
              }}
              disabled={!bossNameInput.trim() || bossRewardTiers.length === 0}
              className="w-full rounded-md bg-rose-600 px-4 py-2 font-medium text-white transition-colors hover:bg-rose-700 disabled:bg-slate-300 sm:w-auto"
            >
              {tLang.summonBoss}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
