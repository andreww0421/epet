import React, { useId, useMemo } from 'react';
import { Trophy, X } from 'lucide-react';
import { ModalDialog } from '../../../components/ModalDialog';
import type { BossVictoryResult } from '../../../store/types';
import type { ClassroomTranslations } from '../types';

type ClassroomBossVictoryDialogProps = {
  result: BossVictoryResult | null;
  open: boolean;
  translations: ClassroomTranslations;
  displayStudentName: (name: string) => string;
  onClose: () => void;
};

export const ClassroomBossVictoryDialog: React.FC<ClassroomBossVictoryDialogProps> = ({
  result,
  open,
  translations: tLang,
  displayStudentName,
  onClose,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const topImprovement = useMemo(
    () => Math.max(
      0,
      ...(result?.standings.map((standing) => standing.fairImprovementAmount) ?? []),
    ),
    [result],
  );

  if (!open || !result) return null;

  return (
    <ModalDialog
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={onClose}
      className="max-w-2xl overflow-hidden border border-amber-300/30 bg-slate-900 text-white shadow-2xl backdrop:bg-slate-950/85 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between border-b border-slate-700 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
            <Trophy className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-black text-amber-300">
              {tLang.bossDefeatedTitle}
            </h2>
            <p className="truncate text-sm text-slate-300">{result.bossName}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
          title={tLang.close}
          aria-label={tLang.close}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="overflow-y-auto p-5 sm:p-6">
        <p id={descriptionId} className="mb-4 text-sm text-slate-300">
          {tLang.bossDefeatedSubtitle}
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <div className="grid min-w-[620px] grid-cols-[52px_minmax(0,1fr)_90px_minmax(220px,auto)] gap-2 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-400">
            <span>#</span>
            <span>{tLang.studentName}</span>
            <span className="text-right">{tLang.bossFairScore}</span>
            <span className="text-right">
              {tLang.rewardPoints} / {tLang.rewardRankPoints} / {tLang.rewardHappiness}
            </span>
          </div>
          {result.standings.map((standing) => (
            <div
              key={standing.studentId}
              className="grid min-w-[620px] grid-cols-[52px_minmax(0,1fr)_90px_minmax(220px,auto)] items-center gap-2 border-t border-slate-700 px-3 py-3 text-sm"
            >
              <span className="font-black text-amber-300">{standing.rank}</span>
              <span className="truncate font-medium text-white">
                {displayStudentName(standing.studentName)}
              </span>
              <span className="text-right font-mono text-rose-300">
                {standing.fairScore}
                <span className="block text-[10px] text-slate-500">
                  {tLang.bossAttackCount.replace(
                    '{count}',
                    standing.attackCount.toString(),
                  )}
                </span>
              </span>
              <div className="text-right text-slate-200">
                <div>
                  +{standing.rewardPoints} / +{standing.rewardRankPoints} RP / +{standing.rewardHappiness}
                </div>
                <div className="mt-1 flex flex-wrap justify-end gap-1 text-[10px]">
                  {standing.rankRewardPoints + standing.rankRewardRankPoints +
                    standing.rankRewardHappiness > 0 && (
                    <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-amber-300">
                      {tLang.bossRankBonus}
                    </span>
                  )}
                  <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-emerald-300">
                    {tLang.bossParticipationBonus}
                  </span>
                  {standing.receivedImprovementReward && (
                    <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-sky-300">
                      {tLang.bossImprovementBonus}
                    </span>
                  )}
                  {standing.fairImprovementAmount > 0 &&
                    standing.fairImprovementAmount === topImprovement && (
                    <span className="rounded bg-violet-400/15 px-1.5 py-0.5 text-violet-300">
                      {tLang.bossMostImproved}
                    </span>
                  )}
                </div>
                {standing.fairImprovementAmount > 0 && (
                  <div className="mt-1 text-[10px] text-sky-300">
                    {tLang.bossFairImprovementAmount.replace(
                      '{amount}',
                      standing.fairImprovementAmount.toString(),
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-slate-700 px-5 py-4 text-right sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-amber-400 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-amber-300"
        >
          {tLang.close}
        </button>
      </div>
    </ModalDialog>
  );
};
