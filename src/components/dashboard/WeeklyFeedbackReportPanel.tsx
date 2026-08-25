import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, Download } from 'lucide-react';
import type { LearningEvidenceRecord } from '../../../shared/education';
import {
  LEARNING_COMPETENCIES,
  addDaysToDateKey,
  getWeekStartDate,
  type LearningCompetency,
} from '../../gameRules';
import { translations } from '../../i18n/translations';
import type { Language, Student } from '../../store/types';
import {
  createWeeklyFeedbackReportCsv,
  getWeeklyFeedbackReport,
} from '../../weeklyFeedbackReport';

type DashboardCopy = (typeof translations)[keyof typeof translations];

type WeeklyFeedbackReportPanelProps = {
  classId?: string;
  competencyLabels: Record<LearningCompetency, string>;
  evidence: LearningEvidenceRecord[];
  lang: Language;
  schoolTimeZone?: string;
  students: Student[];
  tLang: DashboardCopy;
};

const REPORT_WEEK_COUNT = 8;

export const WeeklyFeedbackReportPanel = ({
  classId,
  competencyLabels,
  evidence,
  lang,
  schoolTimeZone = 'Asia/Taipei',
  students,
  tLang,
}: WeeklyFeedbackReportPanelProps) => {
  const [openedAt] = useState(() => Date.now());
  const currentWeekStartDate = useMemo(
    () => getWeekStartDate(openedAt, schoolTimeZone),
    [openedAt, schoolTimeZone],
  );
  const [selectedWeekStartDate, setSelectedWeekStartDate] = useState(
    currentWeekStartDate,
  );

  useEffect(() => {
    setSelectedWeekStartDate(currentWeekStartDate);
  }, [classId, currentWeekStartDate]);

  const weekOptions = useMemo(
    () => Array.from({ length: REPORT_WEEK_COUNT }, (_, index) => {
      const startDate = addDaysToDateKey(currentWeekStartDate, index * -7);
      return {
        startDate,
        endDate: addDaysToDateKey(startDate, 6),
        isCurrent: index === 0,
      };
    }),
    [currentWeekStartDate],
  );
  const report = useMemo(
    () => getWeeklyFeedbackReport(
      students,
      selectedWeekStartDate,
      schoolTimeZone,
      evidence,
    ),
    [evidence, schoolTimeZone, selectedWeekStartDate, students],
  );
  const totalFeedbackCount = report.positiveCount + report.negativeCount;
  const competencyTotal = Math.max(
    1,
    LEARNING_COMPETENCIES.reduce(
      (total, competency) => total + report.competencyCounts[competency],
      0,
    ),
  );

  const formatDate = (dateKey: string) => new Intl.DateTimeFormat(
    lang === 'zh' ? 'zh-TW' : 'en-US',
    { month: 'short', day: 'numeric', timeZone: 'UTC' },
  ).format(new Date(`${dateKey}T12:00:00Z`));
  const formatWeekRange = (startDate: string, endDate: string) =>
    `${formatDate(startDate)} – ${formatDate(endDate)}`;
  const formatTrend = (value: number, suffix = '') =>
    `${value > 0 ? '+' : ''}${value}${suffix}`;

  const handleExport = () => {
    const csv = createWeeklyFeedbackReportCsv(report, lang, competencyLabels);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `epet-weekly-feedback-${report.weekStartDate}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="border-t border-slate-200 pt-5">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="flex items-center text-lg font-semibold text-slate-900">
            <BarChart3 className="mr-2 h-5 w-5 text-emerald-600" />
            {tLang.weeklyFeedbackReport}
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            {tLang.weeklyFeedbackReportHint}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block text-xs font-bold text-slate-700">
            {tLang.weeklyFeedbackWeek}
            <select
              value={selectedWeekStartDate}
              onChange={(event) => setSelectedWeekStartDate(event.target.value)}
              className="mt-1 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:w-64"
            >
              {weekOptions.map((option) => (
                <option key={option.startDate} value={option.startDate}>
                  {option.isCurrent ? `${tLang.weeklyFeedbackCurrentWeek} · ` : ''}
                  {formatWeekRange(option.startDate, option.endDate)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-700 bg-white px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-50"
          >
            <Download className="mr-2 h-4 w-4" />
            {tLang.weeklyFeedbackDownloadCsv}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-bold text-slate-700">
          {formatWeekRange(report.weekStartDate, report.weekEndDate)}
        </span>
        <span>
          {tLang.weeklyFeedbackSourceSummary
            .replace('{points}', report.sourceCounts.pointFeedback.toString())
            .replace('{evidence}', report.sourceCounts.learningEvidence.toString())}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-slate-200 sm:grid-cols-4 xl:grid-cols-7">
        {([
          [tLang.weeklyFeedbackPositive, report.positiveCount, 'text-emerald-700'],
          [tLang.weeklyFeedbackSupport, report.negativeCount, 'text-rose-700'],
          [tLang.weeklyFeedbackPositiveRatio, `${Math.round(report.positiveRatio * 100)}%`, 'text-indigo-700'],
          [
            tLang.weeklyFeedbackCoverage,
            tLang.studentsReached
              .replace('{current}', report.feedbackStudents.toString())
              .replace('{total}', report.rosterStudents.toString()),
            'text-teal-700',
          ],
          [
            tLang.weeklyFeedbackCollaboration,
            tLang.studentsReached
              .replace('{current}', report.collaborationStudents.toString())
              .replace('{total}', report.rosterStudents.toString()),
            'text-sky-700',
          ],
          [tLang.weeklyFeedbackMentorCount, report.mentorFeedbackCount, 'text-violet-700'],
          [tLang.weeklyFeedbackSelfAssessmentCount, report.studentSelfAssessmentCount, 'text-amber-700'],
        ] as Array<[string, string | number, string]>).map(([label, value, tone]) => (
          <div key={label} className="bg-white px-4 py-4">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className={`mt-1 text-xl font-black ${tone}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md bg-slate-50 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          {tLang.weeklyFeedbackTrendTitle}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-slate-700">
          <span>{tLang.weeklyFeedbackPositive}: {formatTrend(report.positiveFeedbackTrend)}</span>
          <span>{tLang.weeklyFeedbackSupport}: {formatTrend(report.negativeFeedbackTrend)}</span>
          <span>
            {tLang.weeklyFeedbackCoverageTrend}: {formatTrend(
              Math.round(report.feedbackCoverageRateTrend * 100),
              lang === 'zh' ? ' 個百分點' : ' pp',
            )}
          </span>
          <span>{tLang.weeklyFeedbackCollaboration}: {formatTrend(report.collaborationTrend)}</span>
        </div>
      </div>

      {totalFeedbackCount === 0 && (
        <p className="mt-4 border-l-4 border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {tLang.weeklyFeedbackNoRecords}
        </p>
      )}
      {totalFeedbackCount >= 3 && report.positiveRatio < 0.7 && (
        <div className="mt-4 flex items-start gap-3 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{tLang.feedbackBalanceWarning}</p>
        </div>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-3">
        <div>
          <h4 className="mb-3 text-sm font-bold text-slate-800">
            {tLang.weeklyFeedbackCompetencyDistribution}
          </h4>
          <div className="space-y-3">
            {LEARNING_COMPETENCIES.map((competency) => {
              const count = report.competencyCounts[competency];
              return (
                <div key={competency}>
                  <div className="mb-1 flex justify-between gap-3 text-xs">
                    <span className="font-medium text-slate-700">
                      {competencyLabels[competency]}
                    </span>
                    <span className="font-bold text-slate-500">
                      {tLang.feedbackCount.replace('{count}', count.toString())}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${(count / competencyTotal) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-bold text-slate-800">
            {tLang.weeklyFeedbackReasonDistribution}
          </h4>
          {report.reasonCounts.length === 0 ? (
            <p className="text-sm text-slate-500">{tLang.weeklyFeedbackNoRecords}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {report.reasonCounts.slice(0, 8).map((reason) => (
                <div key={reason.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-slate-700">{reason.label}</span>
                  <span className="shrink-0 font-bold text-slate-500">
                    {tLang.feedbackCount.replace('{count}', reason.count.toString())}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-3 text-sm font-bold text-slate-800">
            {tLang.weeklyFeedbackOverlooked}
          </h4>
          {report.overlookedStudents.length === 0 ? (
            <p className="text-sm font-medium text-emerald-700">
              {tLang.weeklyFeedbackNoOverlooked}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {report.overlookedStudents.map((student) => (
                <span
                  key={student.id}
                  className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800"
                >
                  {student.name}
                </span>
              ))}
            </div>
          )}

          <h4 className="mb-3 mt-5 text-sm font-bold text-slate-800">
            {tLang.weeklyFeedbackNeedsPositive}
          </h4>
          {report.needsPositiveFeedbackStudents.length === 0 ? (
            <p className="text-sm font-medium text-emerald-700">
              {tLang.weeklyFeedbackNoPositiveGap}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {report.needsPositiveFeedbackStudents.map((student) => (
                <span
                  key={student.id}
                  className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-800"
                >
                  {student.name}
                </span>
              ))}
            </div>
          )}

          <h4 className="mb-3 mt-5 text-sm font-bold text-slate-800">
            {tLang.needsSupportReflection}
          </h4>
          {report.needsSupportMentorFeedbackStudents.length === 0 ? (
            <p className="text-sm font-medium text-emerald-700">
              {tLang.noNeedsSupportReflection}
            </p>
          ) : (
            <div className="divide-y divide-violet-100 border-y border-violet-100">
              {report.needsSupportMentorFeedbackStudents.map((student) => (
                <div key={student.id} className="py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-violet-900">{student.name}</span>
                    <span className="rounded bg-violet-50 px-1.5 py-0.5 font-bold text-violet-700">
                      {competencyLabels[student.competency]}
                    </span>
                  </div>
                  {student.text && (
                    <p className="mt-1 line-clamp-2 leading-5 text-slate-600">{student.text}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
