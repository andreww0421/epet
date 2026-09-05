import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CheckCircle2,
  Gauge, Repeat2, Trophy, Users,
} from 'lucide-react';
import { getTeacherEconomyInsights, type EconomySourceKey } from '../../economyInsights';
import type { Language, Student } from '../../store/types';

type EconomyDashboardPanelProps = {
  students: Student[];
  maxPoints: number;
  lang: Language;
};

const sourceLabels: Record<Language, Record<EconomySourceKey, string>> = {
  zh: {
    quick: '快速加點', manual: '手動調整', airdrop: '全班空投', dailyTask: '每日任務',
    participationTopUp: '參與補足', catchUpBonus: '追趕獎勵', feed: '餵食', play: '互動',
    upgrade: '寵物升級', gacha: '換寵抽選', upgradeReroll: '升級換寵', revive: '寵物復活',
    soloBattle: '單人對戰', teamBattle: '團隊對戰', bossReward: '魔王獎勵',
  },
  en: {
    quick: 'Quick award', manual: 'Manual adjustment', airdrop: 'Class airdrop', dailyTask: 'Daily task',
    participationTopUp: 'Participation top-up', catchUpBonus: 'Catch-up bonus', feed: 'Feed', play: 'Play',
    upgrade: 'Pet upgrade', gacha: 'Pet draw', upgradeReroll: 'Upgrade reroll', revive: 'Pet revive',
    soloBattle: 'Solo battle', teamBattle: 'Team battle', bossReward: 'Boss reward',
  },
};

const text = {
  zh: {
    title: '教師經濟儀表板', hint: '監測點數供需、封頂風險與獎勵公平性；僅供遊戲經濟調整，不作為學習成績。',
    window: '統計期間', days: '天', ratio: '發放／消耗比', full: '滿點比例', duplicate: '換寵重複率',
    concentration: '獎勵集中度', issued: '發放', spent: '消耗', atCap: '位已滿點',
    petChanges: '次換寵中重複', topShare: '前 {count} 位取得的發放占比', noSpend: '尚無消耗紀錄',
    issuanceSources: '發放來源', spendSources: '消耗去向', recipients: '獎勵取得前五名', noData: '期間內尚無紀錄',
    inflation: '發放速度高於消耗，建議檢查獎勵或消耗價格。', saturation: '滿點學生偏多，點數激勵可能失去效果。',
    petDuplicate: '換寵重複偏高，建議加入保底或排除目前寵物。', concentrationWarning: '獎勵集中於少數學生，請檢查參與門檻。',
    healthy: '目前未觸發經濟風險門檻。', definition: '口徑：期間內正向加點與遊戲獎勵為「發放」；照護、升級、換寵、復活及對戰扣點為「消耗」。滿點比例採目前班級狀態；其他指標依保留的事件紀錄計算。',
  },
  en: {
    title: 'Teacher economy dashboard', hint: 'Monitor point supply, cap risk, and reward equity. Game-economy signals are never learning grades.',
    window: 'Window', days: 'days', ratio: 'Issuance / spend', full: 'At-cap rate', duplicate: 'Duplicate pet rate',
    concentration: 'Reward concentration', issued: 'Issued', spent: 'Spent', atCap: 'students at cap',
    petChanges: 'duplicate pet changes out of', topShare: 'Share issued to the top {count}', noSpend: 'No spend recorded yet',
    issuanceSources: 'Issuance sources', spendSources: 'Spend destinations', recipients: 'Top five reward recipients', noData: 'No records in this window',
    inflation: 'Issuance is outpacing spend. Review reward rates or prices.', saturation: 'Many students are at the cap, so points may lose motivational value.',
    petDuplicate: 'Duplicate pet draws are high. Consider a pity rule or excluding the current pet.', concentrationWarning: 'Rewards are concentrated among a small group. Review participation thresholds.',
    healthy: 'No economy risk threshold is currently triggered.', definition: 'Definition: positive point adjustments and game rewards count as issuance; care, upgrades, pet draws, revives, and battle deductions count as spend. At-cap rate uses current roster state; other metrics use retained event records.',
  },
} as const;

const percent = (value: number) => `${Math.round(value * 100)}%`;

export const EconomyDashboardPanel: React.FC<EconomyDashboardPanelProps> = ({
  students,
  maxPoints,
  lang,
}) => {
  const [windowDays, setWindowDays] = useState(30);
  const copy = text[lang];
  const insights = useMemo(
    () => getTeacherEconomyInsights(students, maxPoints, Date.now(), windowDays),
    [maxPoints, students, windowDays],
  );
  const number = useMemo(() => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'zh-TW'), [lang]);
  const warnings = [
    insights.warnings.inflation ? copy.inflation : null,
    insights.warnings.saturation ? copy.saturation : null,
    insights.warnings.petDuplicates ? copy.petDuplicate : null,
    insights.warnings.concentration ? copy.concentrationWarning : null,
  ].filter((warning): warning is string => Boolean(warning));
  const cards = [
    {
      label: copy.ratio,
      value: insights.issuanceSpendRatio == null ? '—' : `${insights.issuanceSpendRatio.toFixed(1)} : 1`,
      detail: insights.totalSpent > 0
        ? `${copy.issued} ${number.format(insights.totalIssued)} · ${copy.spent} ${number.format(insights.totalSpent)}`
        : copy.noSpend,
      icon: Gauge,
      warning: insights.warnings.inflation,
    },
    {
      label: copy.full,
      value: percent(insights.maxedRate),
      detail: `${insights.maxedStudents} / ${students.length} ${copy.atCap}`,
      icon: Users,
      warning: insights.warnings.saturation,
    },
    {
      label: copy.duplicate,
      value: percent(insights.duplicatePetChangeRate),
      detail: lang === 'en'
        ? `${insights.duplicatePetChangeCount} ${copy.petChanges} ${insights.petChangeCount}`
        : `${insights.petChangeCount} ${copy.petChanges} ${insights.duplicatePetChangeCount} 次`,
      icon: Repeat2,
      warning: insights.warnings.petDuplicates,
    },
    {
      label: copy.concentration,
      value: percent(insights.rewardConcentrationRate),
      detail: copy.topShare.replace('{count}', String(insights.topRecipientCount)),
      icon: Trophy,
      warning: insights.warnings.concentration,
    },
  ];

  return (
    <section className="mb-6 border border-slate-200 bg-white shadow-sm" aria-labelledby="economy-dashboard-title">
      <header className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="economy-dashboard-title" className="flex items-center text-lg font-bold text-slate-900">
            <Gauge className="mr-2 h-5 w-5 text-indigo-600" />
            {copy.title}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{copy.hint}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-slate-600">
          {copy.window}
          <select
            aria-label={copy.window}
            value={windowDays}
            onChange={(event) => setWindowDays(Number(event.target.value))}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
          >
            {[7, 30, 90].map((days) => <option key={days} value={days}>{days} {copy.days}</option>)}
          </select>
        </label>
      </header>

      <div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, detail, icon: Icon, warning }) => (
          <article key={label} className="bg-white px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-slate-500">{label}</p>
              <Icon className={`h-4 w-4 ${warning ? 'text-amber-600' : 'text-emerald-600'}`} />
            </div>
            <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{detail}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-3">
        {[
          { title: copy.issuanceSources, icon: ArrowUpFromLine, items: insights.issuanceSources },
          { title: copy.spendSources, icon: ArrowDownToLine, items: insights.spendSources },
        ].map(({ title, icon: Icon, items }) => (
          <div key={title}>
            <h3 className="flex items-center text-sm font-bold text-slate-800"><Icon className="mr-2 h-4 w-4 text-indigo-600" />{title}</h3>
            {items.length === 0 ? <p className="mt-3 text-sm text-slate-600">{copy.noData}</p> : (
              <div className="mt-2 divide-y divide-slate-100">
                {items.slice(0, 5).map((item) => (
                  <div key={item.source} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-600">{sourceLabels[lang][item.source]}</span>
                    <span className="font-bold text-slate-900">{number.format(item.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div>
          <h3 className="flex items-center text-sm font-bold text-slate-800"><Trophy className="mr-2 h-4 w-4 text-indigo-600" />{copy.recipients}</h3>
          {insights.topRecipients.length === 0 ? <p className="mt-3 text-sm text-slate-600">{copy.noData}</p> : (
            <ol className="mt-2 divide-y divide-slate-100">
              {insights.topRecipients.map((recipient, index) => (
                <li key={recipient.studentId} className="flex items-center justify-between py-2 text-sm">
                  <span className="min-w-0 truncate text-slate-600">{index + 1}. {recipient.name}</span>
                  <span className="ml-3 font-bold text-slate-900">+{number.format(recipient.amount)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className={`border-t px-5 py-3 ${warnings.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
        {warnings.length ? (
          <ul className="space-y-1 text-sm text-amber-900">
            {warnings.map((warning) => <li key={warning} className="flex"><AlertTriangle className="mr-2 mt-0.5 h-4 w-4 shrink-0" />{warning}</li>)}
          </ul>
        ) : (
          <p className="flex text-sm text-emerald-800"><CheckCircle2 className="mr-2 h-4 w-4 shrink-0" />{copy.healthy}</p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-slate-500">{copy.definition}</p>
      </div>
    </section>
  );
};
