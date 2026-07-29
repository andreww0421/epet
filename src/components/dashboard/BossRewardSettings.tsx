import React, { useMemo, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  createAutomatedBossRewardTier,
  recalculateBossRewardTiers,
  type BossRewardStep,
} from '../../gameRules';
import { translations } from '../../i18n/translations';
import type { BossRewardTier } from '../../store/types';

type Props = {
  tiers: BossRewardTier[];
  onChange: React.Dispatch<React.SetStateAction<BossRewardTier[]>>;
  studentCount: number;
  labels: typeof translations.zh;
};

export const BossRewardSettings: React.FC<Props> = ({
  tiers,
  onChange,
  studentCount,
  labels,
}) => {
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [pointStep, setPointStep] = useState(20);
  const [rankPointStep, setRankPointStep] = useState(5);
  const [happinessStep, setHappinessStep] = useState(5);
  const rewardStep = useMemo<BossRewardStep>(() => ({
    points: Math.max(0, Math.trunc(Number(pointStep) || 0)),
    rankPoints: Math.max(0, Math.trunc(Number(rankPointStep) || 0)),
    happiness: Math.max(0, Math.trunc(Number(happinessStep) || 0)),
  }), [happinessStep, pointStep, rankPointStep]);
  const rankOptions = Array.from(
    { length: Math.max(10, studentCount) },
    (_, index) => index + 1,
  );

  return (
    <div className="border-t border-slate-200 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-slate-800">{labels.bossRankRewards}</h4>
          <p className="mt-1 text-xs text-slate-500">{labels.bossRankRewardsHint}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange((currentTiers) => {
              const usedRanks = new Set(currentTiers.map((tier) => tier.rank));
              const nextRank = rankOptions.find((rank) => !usedRanks.has(rank));
              if (!nextRank) return currentTiers;
              const reward = automationEnabled
                ? createAutomatedBossRewardTier(currentTiers, nextRank, rewardStep)
                : { rank: nextRank, points: 0, happiness: 0, rankPoints: 0 };
              return [...currentTiers, reward];
            });
          }}
          className="inline-flex shrink-0 items-center rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {labels.addRewardTier}
        </button>
      </div>

      <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-rose-950">{labels.bossRewardAutomation}</p>
            <p className="mt-1 text-xs text-rose-800">{labels.bossRewardAutomationHint}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={automationEnabled}
            onClick={() => setAutomationEnabled((enabled) => !enabled)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 p-0.5 transition-colors ${
              automationEnabled
                ? 'border-rose-600 bg-rose-600'
                : 'border-slate-300 bg-slate-300'
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                automationEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        {automationEnabled && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
            <label className="text-xs font-medium text-rose-950">
              {labels.bossRewardPointStep}
              <input
                type="number"
                min="0"
                step="1"
                value={pointStep}
                onChange={(event) => setPointStep(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-rose-200 bg-white p-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-rose-950">
              {labels.bossRewardRankPointStep}
              <input
                type="number"
                min="0"
                step="1"
                value={rankPointStep}
                onChange={(event) => setRankPointStep(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-rose-200 bg-white p-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-rose-950">
              {labels.bossRewardHappinessStep}
              <input
                type="number"
                min="0"
                step="1"
                value={happinessStep}
                onChange={(event) => setHappinessStep(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-rose-200 bg-white p-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => onChange((currentTiers) =>
                recalculateBossRewardTiers(currentTiers, rewardStep),
              )}
              className="inline-flex items-center justify-center rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-bold text-rose-800 hover:bg-rose-100"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {labels.applyBossRewardAutomation}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {tiers
          .slice()
          .sort((left, right) => left.rank - right.rank)
          .map((tier) => (
            <div
              key={tier.rank}
              className="grid grid-cols-2 items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(88px,0.8fr)_repeat(3,minmax(0,1fr))_36px]"
            >
              <label className="text-xs font-medium text-slate-600">
                {labels.rewardRank}
                <select
                  value={tier.rank}
                  onChange={(event) => {
                    const rank = Number(event.target.value);
                    onChange((currentTiers) => currentTiers.map((item) =>
                      item.rank === tier.rank ? { ...item, rank } : item,
                    ));
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                >
                  {rankOptions.map((rank) => (
                    <option
                      key={rank}
                      value={rank}
                      disabled={rank !== tier.rank && tiers.some((item) => item.rank === rank)}
                    >
                      {labels.rewardRankOption.replace('{rank}', rank.toString())}
                    </option>
                  ))}
                </select>
              </label>
              {([
                ['points', labels.rewardPoints],
                ['rankPoints', labels.rewardRankPoints],
                ['happiness', labels.rewardHappiness],
              ] as const).map(([field, label]) => (
                <label key={field} className="text-xs font-medium text-slate-600">
                  {label}
                  <input
                    type="number"
                    min="0"
                    value={tier[field]}
                    onChange={(event) => onChange((currentTiers) =>
                      currentTiers.map((item) =>
                        item.rank === tier.rank
                          ? { ...item, [field]: Number(event.target.value) }
                          : item,
                      ),
                    )}
                    className="mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white p-2 text-sm"
                  />
                </label>
              ))}
              <button
                type="button"
                onClick={() => onChange((currentTiers) =>
                  currentTiers.filter((item) => item.rank !== tier.rank),
                )}
                className="col-span-2 flex h-9 w-9 items-center justify-center justify-self-end rounded-md text-slate-400 hover:bg-rose-100 hover:text-rose-600 md:col-span-1 md:justify-self-auto"
                title={labels.removeRewardTier}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
      </div>
    </div>
  );
};
