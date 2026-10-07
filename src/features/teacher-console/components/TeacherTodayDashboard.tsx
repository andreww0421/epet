import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, ClipboardList, Gamepad2, MessageSquarePlus, Minus, Plus, TriangleAlert } from 'lucide-react';
import type { AppData, ClassData, Language } from '../../../store/types';
import type { BackendSyncStatus } from '../../../hooks/useBackendSync';
import { canOpenDestination, getDestination, type ConsoleCapabilities, type ConsoleDestination } from '../model/navigation';
import { TODAY_QUICK_ACTIONS, type TodayQuickAction } from '../model/todayActions';
import { buildTodayOverview, type AttentionReason } from '../model/todayOverview';
import type { DashboardRecordView } from '../../records/model/recordNavigation';

type Props = ConsoleCapabilities & {
  classData?: ClassData;
  language: Language;
  schoolTimeZone?: string;
  settings?: AppData['settings'];
  syncStatus?: BackendSyncStatus;
  onNavigate: (id: ConsoleDestination, recordView?: DashboardRecordView) => void;
  onAction?: (action: TodayQuickAction) => void;
};
const icons = { 'give-points': Plus, 'deduct-points': Minus, comment: MessageSquarePlus, evidence: BookOpen, exam: ClipboardList, activity: Gamepad2 };
const activityLabels = {
  zh: { points: '積分變更', feedback: '每日評語', boss: '魔王獎勵', discipline: '處罰紀錄', evidence: '學習證據', exam: '考試更新' },
  en: { points: 'Point change', feedback: 'Comment', boss: 'Boss reward', discipline: 'Penalty record', evidence: 'Learning evidence', exam: 'Exam update' },
};
const reasonLabels: Record<Language, Record<AttentionReason, string>> = {
  zh: { 'learning-support': '近 7 日學習證據有需協助紀錄', 'mentor-support': '近 7 日導師評語註記需協助', 'negative-feedback': '今日只有負向積分回饋' },
  en: { 'learning-support': 'Support noted in learning evidence in the last 7 days', 'mentor-support': 'Support noted in mentor comments in the last 7 days', 'negative-feedback': 'Only negative point feedback today' },
};

/** A classroom workbench: small read-only summaries, with actions owned by existing features. */
export const TeacherTodayDashboard = ({ classData, language, schoolTimeZone, settings, syncStatus = 'connected', onNavigate, onAction, ...capabilities }: Props) => {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  // Refresh the cutoff on data changes too: newly saved records must not wait for the minute tick.
  const { now, overview } = useMemo(() => {
    const now = Date.now();
    return { now, overview: buildTodayOverview(classData, now, schoolTimeZone, settings) };
  }, [classData, clock, schoolTimeZone, settings]);
  const zh = language === 'zh';
  const timeZone = classData?.dailyTaskCalendar?.schoolTimeZone ?? schoolTimeZone ?? 'Asia/Taipei';
  const feedbackTimeZone = schoolTimeZone ?? 'Asia/Taipei';
  const syncLocked = syncStatus !== 'connected' && syncStatus !== 'saving';
  const action = (id: ConsoleDestination, label: string, recordView?: DashboardRecordView) => <button type="button" onClick={() => onNavigate(id, recordView)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-indigo-800 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">
    {label}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
  </button>;
  const runAction = (id: TodayQuickAction) => {
    if (syncLocked || capabilities.readOnly) return;
    if (onAction) onAction(id);
    else onNavigate(({ 'give-points': 'points', 'deduct-points': 'points', comment: 'comments', evidence: 'evidence', exam: 'exams', activity: 'pets' } as const)[id]);
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="today-quick-actions" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="today-quick-actions" className="text-base font-bold text-slate-900">{zh ? '快速操作' : 'Quick actions'}</h3>
          <p className="text-sm text-slate-600">{zh ? '從這裡開始今天的帶班工作' : 'Start your classroom work here'}</p>
        </div>
        {capabilities.readOnly ? <div className="flex flex-wrap gap-2">{(['student-insights', 'records', 'reports'] as const).map((id) => <div key={id}>{action(id, getDestination(id).label[language])}</div>)}</div> : <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {TODAY_QUICK_ACTIONS.map(({ id, label }) => {
            const Icon = icons[id];
            const requiresStudents = id !== 'activity';
            return <button key={id} type="button" onClick={() => runAction(id)} disabled={syncLocked || (requiresStudents && overview.studentCount === 0)}
              className={`flex min-h-16 items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500 sm:text-base ${id === 'give-points' ? 'border-indigo-700 bg-indigo-700 text-white hover:bg-indigo-800' : id === 'deduct-points' ? 'border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100' : 'border-slate-200 bg-white text-slate-800 hover:border-indigo-300 hover:bg-indigo-50'}`}>
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" /><span>{label[language]}</span>
            </button>;
          })}
        </div>}
        {!capabilities.readOnly && overview.studentCount === 0 && <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-700"><p>{zh ? '先加入學生，即可使用積分、評語與學習操作。' : 'Add students to use point, comment and learning actions.'}</p>{action('students', zh ? '加入／匯入學生' : 'Add / import students')}</div>}
      </section>

      <section aria-labelledby="today-summary">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="today-summary" className="text-base font-bold text-slate-900">{zh ? '今日摘要' : "Today's summary"}</h3>
          <time dateTime={new Date(now).toISOString()} className="text-sm text-slate-600">{new Date(now).toLocaleDateString(zh ? 'zh-TW' : 'en-US', { timeZone, dateStyle: 'medium' })}</time>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            [zh ? '學生人數' : 'Students', overview.studentCount],
            [zh ? '需要關注的學生' : 'Students needing attention', overview.attentionCount],
            [zh ? '今日學習證據' : 'Learning evidence today', overview.evidenceTodayCount],
            [zh ? '今日考試活動' : 'Exam activity today', overview.examTodayCount],
            [zh ? '待補導師評語' : 'Pending mentor comments', overview.feedbackPending],
          ].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><dt className="text-sm leading-5 text-slate-600">{label}</dt><dd className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</dd></div>)}
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="today-alerts" className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 id="today-alerts" className="text-base font-bold text-slate-900">{zh ? '需要留意' : 'Alerts'}</h3>
          {timeZone !== feedbackTimeZone && <p className="mt-2 text-sm text-slate-600">{zh ? `積分回饋提醒依工作區時區 ${feedbackTimeZone}；學習證據與評語依班級時區 ${timeZone}。` : `Point feedback reminders use the workspace timezone ${feedbackTimeZone}; evidence and comments use the class timezone ${timeZone}.`}</p>}
          {overview.negativeFeedbackAlert && <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
            <h4 className="flex items-center gap-2 font-bold"><TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{zh ? '負向回饋集中提醒' : 'Negative feedback concentration'}</h4>
            <p className="mt-1">{zh ? `今日 ${overview.negativeFeedbackAlert.negativeCount} 次負向、${overview.negativeFeedbackAlert.positiveCount} 次正向積分回饋；負向回饋集中於少數學生，且低於設定的正／負回饋目標。請檢視紀錄與情境。` : `${overview.negativeFeedbackAlert.negativeCount} negative and ${overview.negativeFeedbackAlert.positiveCount} positive point actions today. Negative feedback is concentrated and below the configured positive/negative target. Review the records and context.`}</p>
            <div className="mt-3">{action('records', zh ? '檢視積分紀錄' : 'Review point records', 'points')}</div>
          </div>}
          {overview.attentionCount > 0 ? <div className="mt-4">
            <p className="text-sm leading-6 text-slate-700">{zh ? `${overview.attentionCount} 位學生有需要追蹤的回饋紀錄；這是提醒，不是診斷。` : `${overview.attentionCount} learners have feedback to follow up. These are reminders, not diagnoses.`}</p>
            <ul className="mt-3 space-y-3">
              {overview.attentionStudents.slice(0, 3).map((item) => <li key={item.studentId} className="border-l-2 border-amber-300 pl-3"><p className="break-words text-sm font-semibold text-slate-900">{classData?.students.find((student) => student.id === item.studentId)?.name}</p><ul className="mt-1 space-y-1 text-sm leading-5 text-slate-600">{item.reasons.map((reason) => <li key={reason}>{reasonLabels[language][reason]}</li>)}</ul></li>)}
            </ul>
            {overview.attentionCount > 3 && <p className="mt-3 text-sm text-slate-600">{zh ? `另有 ${overview.attentionCount - 3} 位，請至個人分析查看紀錄。` : `${overview.attentionCount - 3} more; review student insights for their records.`}</p>}
            <div className="mt-4 flex flex-wrap gap-2">{action('student-insights', zh ? '查看個人分析' : 'Review student insights')}{!capabilities.readOnly && action('comments', zh ? '新增追蹤評語' : 'Add follow-up comment')}</div>
          </div> : <p className="mt-4 text-sm leading-6 text-slate-600">{zh ? '目前沒有符合追蹤條件的紀錄；仍請依課堂觀察給予回饋。' : 'No records currently meet the follow-up criteria. Continue using your classroom observations.'}</p>}
          {syncStatus === 'saving' && <p className="mt-4 text-sm text-slate-600">{zh ? '變更正在同步，請留意頁面頂端的同步狀態。' : 'Changes are syncing. Check the synchronization status above.'}</p>}
          {capabilities.readOnly && <p className="mt-4 text-sm text-sky-900">{zh ? '唯讀帳號可查看紀錄，不能編輯。' : 'This account can review records but cannot edit.'}</p>}
        </section>

        <section aria-labelledby="today-pending" className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 id="today-pending" className="text-base font-bold text-slate-900">{zh ? '待處理事項' : 'Pending teacher tasks'}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{zh ? '依現有紀錄整理的可選提醒，不是截止期限或強制任務。' : 'Optional reminders from existing records, not deadlines or mandatory tasks.'}</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-3"><dt>{zh ? '今天尚無導師評語' : 'No mentor comment today'}</dt><dd className="font-bold tabular-nums">{overview.feedbackPending} / {overview.studentCount}</dd></div>
            <div className="flex justify-between gap-3"><dt>{zh ? '本週學習目標' : 'Active weekly goals'}</dt><dd className="font-bold tabular-nums">{overview.activeGoalCount}</dd></div>
          </dl>
          {overview.activeGoalCount === 0 && <p className="mt-3 text-sm text-slate-700">{zh ? '本週尚未設定學習目標，歷史目標仍保留。' : 'No active goals this week. Historical goals are preserved.'}</p>}
          {overview.activeBoss && <p className="mt-3 text-sm text-slate-700">{zh ? '目前有進行中的魔王活動。' : 'A boss activity is in progress.'}</p>}
          {!capabilities.readOnly && <div className="mt-4 flex flex-wrap gap-2">{overview.studentCount > 0 && action('comments', zh ? '填寫每日評語' : 'Write daily comments')}{action('goals', zh ? '管理學習目標' : 'Manage learning goals')}</div>}
        </section>
      </div>

      <section aria-labelledby="today-recent" className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 id="today-recent" className="text-base font-bold text-slate-900">{zh ? '最近活動' : 'Recent activity'}</h3>
        {overview.recentActivity.length === 0 ? <p className="mt-3 text-sm text-slate-600">{zh ? '尚無活動紀錄。' : 'No activity recorded yet.'}</p> : <ul className="mt-3 divide-y divide-slate-100">
          {overview.recentActivity.map((item) => {
            const id = canOpenDestination(item.destination, capabilities) ? item.destination : 'records';
            const recordView = item.kind === 'points' ? 'points' : item.kind === 'feedback' ? 'feedback' : item.kind === 'discipline' ? 'discipline' : item.kind === 'boss' ? 'boss' : undefined;
            return <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div className="flex items-center gap-3">{action(id, activityLabels[language][item.kind], recordView)}{item.amount !== undefined && <span className="text-sm font-bold tabular-nums text-slate-700">{item.amount > 0 ? '+' : ''}{item.amount}</span>}</div><time dateTime={new Date(item.createdAt).toISOString()} className="text-sm text-slate-600">{new Date(item.createdAt).toLocaleString(zh ? 'zh-TW' : 'en-US', { timeZone, dateStyle: 'short', timeStyle: 'short' })}</time></li>;
          })}
        </ul>}
      </section>
    </div>
  );
};
