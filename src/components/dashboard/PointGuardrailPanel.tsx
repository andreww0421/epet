import React from 'react';
import { AlertTriangle, HeartHandshake, ShieldCheck, Users } from 'lucide-react';
import type { DailyPointFairnessInsights } from '../../educationInsights';
import type { Language } from '../../store/types';

type PointFairnessSummaryProps = {
  lang: Language;
  insights: DailyPointFairnessInsights;
  guardrailsEnabled: boolean;
  participationSupportEnabled: boolean;
};

export const PointFairnessSummary: React.FC<PointFairnessSummaryProps> = ({
  lang,
  insights,
  guardrailsEnabled,
  participationSupportEnabled,
}) => {
  const ratio = insights.positiveToNegativeRatio == null
    ? '—'
    : `${Math.round(insights.positiveToNegativeRatio * 10) / 10}:1`;
  const uncoveredPreview = insights.uncoveredStudents.slice(0, 8);
  const remainingUncovered = Math.max(0, insights.uncoveredStudents.length - uncoveredPreview.length);
  const catchUpPreview = insights.catchUpCandidates.slice(0, 8);
  const remainingCatchUp = Math.max(0, insights.catchUpCandidates.length - catchUpPreview.length);

  return (
    <section className="border-b border-slate-200 bg-white px-5 py-4" aria-labelledby="point-fairness-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 id="point-fairness-heading" className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Users className="h-4 w-4 text-indigo-600" />
            {lang === 'en' ? 'Today’s feedback fairness' : '今日回饋公平性'}
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            {lang === 'en'
              ? 'Counts teacher quick, manual, and class adjustments only.'
              : '只統計導師快速、手動與全班空投的回饋事件。'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex w-fit items-center gap-1 px-2 py-1 text-xs font-bold ${
            guardrailsEnabled
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-slate-100 text-slate-600'
          }`}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {guardrailsEnabled
              ? (lang === 'en' ? 'Guardrails on' : '護欄已開啟')
              : (lang === 'en' ? 'Guardrails off' : '護欄未開啟')}
          </span>
          <span className={`inline-flex w-fit items-center gap-1 px-2 py-1 text-xs font-bold ${
            participationSupportEnabled
              ? 'bg-sky-50 text-sky-700'
              : 'bg-slate-100 text-slate-600'
          }`}>
            <HeartHandshake className="h-3.5 w-3.5" />
            {participationSupportEnabled
              ? (lang === 'en' ? 'Catch-up support on' : '參與保障已開啟')
              : (lang === 'en' ? 'Catch-up support off' : '參與保障未開啟')}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-px bg-slate-200">
        <div className="bg-emerald-50 p-3">
          <p className="text-xs font-medium text-emerald-800">{lang === 'en' ? 'Positive events' : '正向事件'}</p>
          <p className="mt-1 text-xl font-black text-emerald-900">{insights.positiveCount}</p>
        </div>
        <div className="bg-rose-50 p-3">
          <p className="text-xs font-medium text-rose-800">{lang === 'en' ? 'Corrective events' : '修正事件'}</p>
          <p className="mt-1 text-xl font-black text-rose-900">{insights.negativeCount}</p>
        </div>
        <div className="bg-indigo-50 p-3">
          <p className="text-xs font-medium text-indigo-800">{lang === 'en' ? 'Positive ratio' : '正向比例'}</p>
          <p className="mt-1 text-xl font-black text-indigo-900">{ratio}</p>
        </div>
      </div>

      {insights.belowTarget && (
        <div className="mt-3 flex items-start gap-2 border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {lang === 'en'
              ? `The positive-to-corrective ratio is below the ${insights.targetRatio}:1 reminder target.`
              : `目前正向／修正回饋低於 ${insights.targetRatio}:1 的提醒目標。`}
          </span>
        </div>
      )}

      <div className="mt-3">
        <p className="text-xs font-bold text-slate-700">
          {lang === 'en'
            ? `${insights.uncoveredStudents.length} students have not received positive feedback today`
            : `今日尚未獲得正向回饋：${insights.uncoveredStudents.length} 位`}
        </p>
        {uncoveredPreview.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {uncoveredPreview.map((student) => (
              <span key={student.id} className="bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {student.name}
              </span>
            ))}
            {remainingUncovered > 0 && (
              <span className="bg-slate-200 px-2 py-1 text-xs font-bold text-slate-700">
                +{remainingUncovered}
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs font-medium text-emerald-700">
            {lang === 'en' ? 'Every student is covered today.' : '今天每位學生都已獲得正向回饋。'}
          </p>
        )}
      </div>

      {(insights.clampedCount > 0 || insights.blockedCount > 0) && (
        <p className="mt-3 text-xs font-medium text-amber-700">
          {lang === 'en'
            ? `Guardrail outcomes today: ${insights.clampedCount} clamped, ${insights.blockedCount} blocked.`
            : `今日護欄結果：${insights.clampedCount} 筆縮減、${insights.blockedCount} 筆拒絕。`}
        </p>
      )}
      {(insights.participationTopUpCount > 0 || insights.catchUpBonusCount > 0) && (
        <p className="mt-3 text-xs font-medium text-sky-700">
          {lang === 'en'
            ? `Support rewards today: ${insights.participationTopUpCount} safety-net top-ups, ${insights.catchUpBonusCount} catch-up bonuses, +${insights.supportRewardPoints} points total.`
            : `今日參與保障：${insights.participationTopUpCount} 筆最低獎勵補足、${insights.catchUpBonusCount} 筆追趕加成，共 +${insights.supportRewardPoints} 分。`}
        </p>
      )}
      {participationSupportEnabled && insights.catchUpCandidates.length > 0 && (
        <div className="mt-3 border-l-4 border-sky-400 bg-sky-50 p-3 text-xs text-sky-900">
          <span className="font-bold">
            {lang === 'en' ? 'Catch-up watchlist before the next reward: ' : '下次獎勵前的追趕觀察名單：'}
          </span>
          {catchUpPreview.map((student) => student.name).join('、')}
          {remainingCatchUp > 0 && ` +${remainingCatchUp}`}
        </div>
      )}
    </section>
  );
};

type PointGuardrailSettingsProps = {
  lang: Language;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  dailyPositiveLimit: number;
  onDailyPositiveLimitChange: (value: number) => void;
  dailyNegativeLimit: number;
  onDailyNegativeLimitChange: (value: number) => void;
  positiveRatioTarget: number;
  onPositiveRatioTargetChange: (value: number) => void;
};

export const PointGuardrailSettings: React.FC<PointGuardrailSettingsProps> = ({
  lang,
  enabled,
  onEnabledChange,
  dailyPositiveLimit,
  onDailyPositiveLimitChange,
  dailyNegativeLimit,
  onDailyNegativeLimitChange,
  positiveRatioTarget,
  onPositiveRatioTargetChange,
}) => (
  <section className="mb-6 border-l-4 border-indigo-500 bg-indigo-50 p-4" aria-labelledby="point-guardrail-settings-heading">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h4 id="point-guardrail-settings-heading" className="flex items-center gap-2 text-sm font-bold text-indigo-950">
          <ShieldCheck className="h-4 w-4" />
          {lang === 'en' ? 'Point economy guardrails' : '積分經濟護欄'}
        </h4>
        <p className="mt-1 max-w-3xl text-xs text-indigo-800">
          {lang === 'en'
            ? 'Limits apply per student, per school day to quick, manual, and class adjustments. Daily tasks and game-system rewards or costs are excluded.'
            : '上限依每位學生、每個上課日計算，只套用於快速、手動與全班空投；每日任務及遊戲系統獎勵／消耗不受限制。'}
        </p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-indigo-950">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
          className="h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
        />
        {lang === 'en' ? 'Enable limits' : '啟用每日上限'}
      </label>
    </div>

    <fieldset disabled={!enabled} className="mt-4 grid gap-3 sm:grid-cols-3 disabled:opacity-50">
      <label className="text-xs font-bold text-slate-700">
        {lang === 'en' ? 'Daily positive points / student' : '每生每日正向積分上限'}
        <input
          type="number"
          min="0"
          max="10000"
          value={dailyPositiveLimit}
          onChange={(event) => onDailyPositiveLimitChange(Number(event.target.value))}
          className="mt-1 w-full border border-indigo-200 bg-white p-2 text-sm"
        />
      </label>
      <label className="text-xs font-bold text-slate-700">
        {lang === 'en' ? 'Daily negative points / student' : '每生每日負向積分上限'}
        <input
          type="number"
          min="0"
          max="10000"
          value={dailyNegativeLimit}
          onChange={(event) => onDailyNegativeLimitChange(Number(event.target.value))}
          className="mt-1 w-full border border-indigo-200 bg-white p-2 text-sm"
        />
      </label>
      <label className="text-xs font-bold text-slate-700">
        {lang === 'en' ? 'Positive reminder target' : '正向回饋比例提醒'}
        <div className="mt-1 flex items-center gap-2">
          <input
            type="number"
            min="1"
            max="10"
            step="0.5"
            value={positiveRatioTarget}
            onChange={(event) => onPositiveRatioTargetChange(Number(event.target.value))}
            className="w-full border border-indigo-200 bg-white p-2 text-sm"
          />
          <span className="shrink-0 text-sm text-slate-600">: 1</span>
        </div>
      </label>
    </fieldset>
  </section>
);

type ParticipationSupportSettingsProps = {
  lang: Language;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  minimumDailyParticipationPoints: number;
  onMinimumDailyParticipationPointsChange: (value: number) => void;
  catchUpGapThreshold: number;
  onCatchUpGapThresholdChange: (value: number) => void;
  dailyCatchUpBonus: number;
  onDailyCatchUpBonusChange: (value: number) => void;
};

export const ParticipationSupportSettings: React.FC<ParticipationSupportSettingsProps> = ({
  lang,
  enabled,
  onEnabledChange,
  minimumDailyParticipationPoints,
  onMinimumDailyParticipationPointsChange,
  catchUpGapThreshold,
  onCatchUpGapThresholdChange,
  dailyCatchUpBonus,
  onDailyCatchUpBonusChange,
}) => (
  <section className="mb-6 border-l-4 border-sky-500 bg-sky-50 p-4" aria-labelledby="participation-support-settings-heading">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h4 id="participation-support-settings-heading" className="flex items-center gap-2 text-sm font-bold text-sky-950">
          <HeartHandshake className="h-4 w-4" />
          {lang === 'en' ? 'Participation safety net and catch-up' : '參與保障與追趕機制'}
        </h4>
        <p className="mt-1 max-w-3xl text-xs text-sky-800">
          {lang === 'en'
            ? 'The first positive participation of a school day can be topped up to a minimum. Students still below the projected class median by the selected gap receive one catch-up bonus that day.'
            : '每個上課日首次有效正向參與可補足到最低獎勵；套用原獎勵後仍落後班級中位數達門檻者，當日可獲一次追趕加成。'}
        </p>
        <p className="mt-1 text-[11px] font-medium text-sky-700">
          {lang === 'en'
            ? 'Support records are separate and do not affect teacher feedback caps or positive/corrective ratios.'
            : '保障獎勵會獨立記錄，不占用教師回饋上限，也不計入正向／修正回饋比例。'}
        </p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-sky-950">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
          className="h-4 w-4 rounded border-sky-300 text-sky-600 focus:ring-sky-500"
        />
        {lang === 'en' ? 'Enable support' : '啟用參與保障'}
      </label>
    </div>

    <fieldset disabled={!enabled} className="mt-4 grid gap-3 sm:grid-cols-3 disabled:opacity-50">
      <label className="text-xs font-bold text-slate-700">
        {lang === 'en' ? 'Minimum daily participation points' : '每日最低參與獎勵'}
        <input
          type="number"
          min="0"
          max="1000"
          value={minimumDailyParticipationPoints}
          onChange={(event) => onMinimumDailyParticipationPointsChange(Number(event.target.value))}
          className="mt-1 w-full border border-sky-200 bg-white p-2 text-sm"
        />
      </label>
      <label className="text-xs font-bold text-slate-700">
        {lang === 'en' ? 'Gap below class median' : '落後班級中位數門檻'}
        <input
          type="number"
          min="0"
          max="10000"
          value={catchUpGapThreshold}
          onChange={(event) => onCatchUpGapThresholdChange(Number(event.target.value))}
          className="mt-1 w-full border border-sky-200 bg-white p-2 text-sm"
        />
      </label>
      <label className="text-xs font-bold text-slate-700">
        {lang === 'en' ? 'Once-daily catch-up bonus' : '每日一次追趕加成'}
        <input
          type="number"
          min="0"
          max="1000"
          value={dailyCatchUpBonus}
          onChange={(event) => onDailyCatchUpBonusChange(Number(event.target.value))}
          className="mt-1 w-full border border-sky-200 bg-white p-2 text-sm"
        />
      </label>
    </fieldset>
  </section>
);
