import React, { useMemo } from 'react';
import { BarChart3, Skull, Swords } from 'lucide-react';
import type {
  BossAttackMode,
  Student,
  WorldBoss,
} from '../../../store/types';
import {
  getBossContributionStandings,
  isBossRecoveryActive,
} from '../../../gameRules';
import type { ClassroomTranslations } from '../types';

type BossAttackFeedback = {
  targetNames: string[];
  damage: number;
  id: number;
  mode?: BossAttackMode;
  recoverAt?: number;
};

type ClassroomBossPanelProps = {
  boss?: WorldBoss;
  students: Student[];
  now: number;
  hitFeedback: { damage: number; id: number } | null;
  attackFeedback: BossAttackFeedback | null;
  attackMode?: BossAttackMode;
  recoveryMinutes: number;
  language: 'zh' | 'en';
  translations: ClassroomTranslations;
  displayStudentName: (name: string) => string;
  onBossAttack: () => void;
  onClearRecovery: () => void;
};

export const ClassroomBossPanel: React.FC<ClassroomBossPanelProps> = ({
  boss,
  students,
  now,
  hitFeedback,
  attackFeedback,
  attackMode,
  recoveryMinutes,
  language,
  translations: tLang,
  displayStudentName,
  onBossAttack,
  onClearRecovery,
}) => {
  const standings = useMemo(
    () => boss ? getBossContributionStandings(students, boss) : [],
    [boss, students],
  );
  const activeRecoveryCount = useMemo(
    () => students.filter((student) =>
      isBossRecoveryActive(student.bossRecovery, now)).length,
    [now, students],
  );

  if (!boss?.isActive) return null;

  return (
    <section
      aria-labelledby="classroom-boss-title"
      className={`relative isolate z-0 mb-4 overflow-hidden rounded-xl border-2 bg-slate-900 p-5 shadow-2xl ${hitFeedback ? 'border-red-500 bg-red-950' : 'border-red-900/50'}`}
    >
      <div className="absolute top-0 right-0 p-4 opacity-10" aria-hidden="true">
        <Skull className="w-32 h-32 text-red-500" />
      </div>
      <div className="relative z-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-red-800 bg-red-950">
              <Swords className="h-7 w-7 text-red-500" />
              {hitFeedback && (
                <div
                  key={hitFeedback.id}
                  className="absolute -top-7 z-20 whitespace-nowrap text-2xl font-black text-red-400 animate-[bounce_0.8s_ease-out_forwards]"
                >
                  -{hitFeedback.damage}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id="classroom-boss-title"
                className="mb-2 truncate text-2xl font-black text-rose-100"
              >
                {boss.name}
              </h2>
              <div className="relative h-6 w-full overflow-hidden rounded-full bg-slate-800 ring-1 ring-white/10">
                <div
                  className="h-6 rounded-full bg-red-600 transition-all duration-500"
                  style={{
                    width: `${Math.max(0, (boss.currentHp / boss.maxHp) * 100)}%`,
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow-md">
                  {boss.currentHp} / {boss.maxHp}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onBossAttack}
              className="inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-red-500 active:scale-[0.98]"
            >
              <Skull className="mr-2 h-4 w-4" />
              {tLang.executeBossAttack}
            </button>
            {attackFeedback && (
              <p className="min-w-0 text-sm text-rose-200" aria-live="polite">
                {attackFeedback.mode === 'recoverable' &&
                attackFeedback.targetNames.length > 0
                  ? tLang.bossAttackRecoverableResult
                      .replace('{count}', attackFeedback.targetNames.length.toString())
                      .replace('{impact}', attackFeedback.damage.toString())
                      .replace('{minutes}', String(recoveryMinutes))
                  : attackFeedback.targetNames.length > 0
                    ? `${attackFeedback.targetNames.join(language === 'en' ? ', ' : '、')} (-${attackFeedback.damage})`
                    : tLang.bossAttackMissed}
              </p>
            )}
          </div>
          {attackMode === 'recoverable' && (
            <div className="mt-3 flex flex-col gap-2 border-l-4 border-sky-400 bg-sky-950/50 p-3 text-xs text-sky-100 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {tLang.bossAttackRecoverableHint}
                {activeRecoveryCount > 0 && ` (${activeRecoveryCount}/${students.length})`}
              </span>
              {activeRecoveryCount > 0 && (
                <button
                  type="button"
                  onClick={onClearRecovery}
                  className="shrink-0 rounded-md border border-sky-600 bg-sky-900 px-3 py-1.5 font-bold text-sky-100 hover:bg-sky-800"
                >
                  {tLang.clearBossRecovery}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
          <h3 className="mb-2 flex items-center text-sm font-bold text-slate-200">
            <BarChart3 className="mr-2 h-4 w-4 text-amber-300" />
            {tLang.contributionLeaderboard}
          </h3>
          <p className="mb-2 text-[11px] leading-4 text-slate-400">
            {tLang.bossFairRankingHint}
          </p>
          {standings.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-500">
              {tLang.noContribution}
            </p>
          ) : (
            <div className="max-h-28 space-y-1.5 overflow-y-auto pr-1">
              {standings.map((standing) => (
                <div
                  key={standing.studentId}
                  className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded bg-slate-800/80 px-2 py-1.5 text-xs"
                >
                  <span className="font-black text-amber-300">{standing.rank}</span>
                  <span className="truncate font-medium text-slate-100">
                    {displayStudentName(standing.studentName)}
                  </span>
                  <span
                    className="font-mono text-rose-300"
                    title={tLang.damageContribution.replace(
                      '{damage}',
                      standing.damage.toString(),
                    )}
                  >
                    {standing.fairScore}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
