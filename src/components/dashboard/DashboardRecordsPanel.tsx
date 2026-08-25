import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Save,
  Shield,
  Swords,
} from 'lucide-react';
import type { LearningEvidenceRecord } from '../../../shared/education';
import type {
  BossRewardRecord,
  DailyAssessment,
  DailyReflection,
  Language,
  LearningCompetency,
  Student,
} from '../../store/types';
import type { MentorDailyFeedbackInput } from '../../gameRules';
import {
  DIRECT_DISCIPLINE_PENALTY,
  getDateKey,
  WARNING_AUTO_PENALTY,
  WARNING_THRESHOLD,
  type DisciplineRecordType,
} from '../../gameRules';
import {
  getRecordCompetency,
} from '../../educationInsights';
import { translations } from '../../i18n/translations';
import { WeeklyFeedbackReportPanel } from './WeeklyFeedbackReportPanel';

type DashboardCopy = (typeof translations)[keyof typeof translations];

type BossRewardRecordWithStudent = BossRewardRecord & {
  studentId: string;
  studentName: string;
};

type DailyFeedbackRecordWithStudent = DailyReflection & {
  studentId: string;
  studentName: string;
};

type DashboardRecordsPanelProps = {
  classId?: string;
  competencyLabels: Record<LearningCompetency, string>;
  lang: Language;
  learningEvidence: LearningEvidenceRecord[];
  onSaveMentorDailyFeedback: (
    studentId: string,
    feedback: MentorDailyFeedbackInput,
  ) => void;
  students: Student[];
  schoolTimeZone?: string;
  tLang: DashboardCopy;
  visible: boolean;
};

export const DashboardRecordsPanel = ({
  classId,
  competencyLabels,
  lang,
  learningEvidence,
  onSaveMentorDailyFeedback,
  schoolTimeZone,
  students: currentStudents,
  tLang,
  visible,
}: DashboardRecordsPanelProps) => {
  const [recordView, setRecordView] =
    useState<'discipline' | 'points' | 'feedback' | 'boss'>('discipline');
  const [mentorFeedbackStudentId, setMentorFeedbackStudentId] = useState('');
  const [mentorFeedbackCompetency, setMentorFeedbackCompetency] =
    useState<LearningCompetency>('assignmentQuality');
  const [mentorFeedbackAssessment, setMentorFeedbackAssessment] =
    useState<DailyAssessment>('progressing');
  const [mentorFeedbackText, setMentorFeedbackText] = useState('');

  const todayKey = getDateKey();
  const selectedMentorFeedback = useMemo(
    () => currentStudents
      .find((student) => student.id === mentorFeedbackStudentId)
      ?.dailyProgress?.reflections?.find(
        (reflection) => reflection.date === todayKey && reflection.author === 'mentor',
      ),
    [currentStudents, mentorFeedbackStudentId, todayKey],
  );
  const todayMentorFeedbackCount = useMemo(
    () => currentStudents.filter((student) =>
      student.dailyProgress?.reflections?.some(
        (reflection) => reflection.date === todayKey && reflection.author === 'mentor',
      ),
    ).length,
    [currentStudents, todayKey],
  );

  useEffect(() => {
    setMentorFeedbackStudentId('');
  }, [classId]);

  useEffect(() => {
    if (!mentorFeedbackStudentId) {
      setMentorFeedbackCompetency('assignmentQuality');
      setMentorFeedbackAssessment('progressing');
      setMentorFeedbackText('');
      return;
    }
    setMentorFeedbackCompetency(
      selectedMentorFeedback?.competency ?? 'assignmentQuality',
    );
    setMentorFeedbackAssessment(
      selectedMentorFeedback?.mentorAssessment ??
        selectedMentorFeedback?.selfAssessment ??
        'progressing',
    );
    setMentorFeedbackText(selectedMentorFeedback?.text ?? '');
  }, [mentorFeedbackStudentId, selectedMentorFeedback]);

  useEffect(() => {
    if (
      mentorFeedbackStudentId &&
      !currentStudents.some((student) => student.id === mentorFeedbackStudentId)
    ) {
      setMentorFeedbackStudentId('');
    }
  }, [currentStudents, mentorFeedbackStudentId]);

  const disciplineRecords = useMemo(
    () => currentStudents
      .flatMap((student: any) =>
        (student.disciplineRecords ?? []).map((record: any) => ({
          ...record,
          studentName: student.name,
        })),
      )
      .sort((a: any, b: any) => b.createdAt - a.createdAt)
      .slice(0, 12),
    [currentStudents],
  );
  const pointAdjustmentRecords = useMemo(
    () => currentStudents
      .flatMap((student: any) =>
        (student.pointAdjustmentRecords ?? []).map((record: any) => ({
          ...record,
          studentName: student.name,
        })),
      )
      .sort((a: any, b: any) => b.createdAt - a.createdAt)
      .slice(0, 12),
    [currentStudents],
  );
  const dailyFeedbackRecords = useMemo(
    () => currentStudents
      .flatMap((student: Student) =>
        (student.dailyProgress?.reflections ?? []).map(
          (record): DailyFeedbackRecordWithStudent => ({
            ...record,
            studentId: student.id,
            studentName: student.name,
          }),
        ),
      )
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 30),
    [currentStudents],
  );
  const bossRewardRecords = useMemo(
    () => currentStudents
      .flatMap((student) =>
        (student.bossRewardRecords ?? []).map((record): BossRewardRecordWithStudent => ({
          ...record,
          studentId: student.id,
          studentName: student.name,
        })),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12),
    [currentStudents],
  );

  const getRecordLabel = (type: DisciplineRecordType) => {
    if (type === 'autoPenalty') return tLang.recordAutoPenalty;
    if (type === 'discipline') return tLang.recordDiscipline;
    if (type === 'levelDecrease') return lang === 'en' ? 'Level decrease' : '降級';
    if (type === 'reversal') return lang === 'en' ? 'Compensating reversal' : '撤銷補償';
    return tLang.recordWarning;
  };

  const getRecordTone = (type: DisciplineRecordType) => {
    if (type === 'autoPenalty') return 'bg-amber-100 text-amber-700';
    if (type === 'discipline') return 'bg-rose-100 text-rose-700';
    if (type === 'levelDecrease') return 'bg-orange-100 text-orange-700';
    if (type === 'reversal') return 'bg-emerald-100 text-emerald-800';
    return 'bg-slate-100 text-slate-700';
  };

  const formatRecordTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString(lang === 'zh' ? 'zh-TW' : 'en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  const penaltySummary = (penalty: { points: number; fullness: number; happiness: number; rankPoints: number }) =>
    tLang.recordPenaltySummary
      .replace('{points}', penalty.points.toString())
      .replace('{fullness}', penalty.fullness.toString())
      .replace('{happiness}', penalty.happiness.toString())
      .replace('{rankPoints}', penalty.rankPoints.toString());

  const bossRewardSummary = (points: number, rankPoints: number, happiness: number) =>
    tLang.bossRewardBreakdownSummary
      .replace('{points}', points.toString())
      .replace('{rankPoints}', rankPoints.toString())
      .replace('{happiness}', happiness.toString());
  const handleSaveMentorDailyFeedback = () => {
    if (!mentorFeedbackStudentId || !mentorFeedbackText.trim()) return;
    onSaveMentorDailyFeedback(mentorFeedbackStudentId, {
      competency: mentorFeedbackCompetency,
      assessment: mentorFeedbackAssessment,
      text: mentorFeedbackText.trim(),
    });
  };

  return (
    <>
      <section className={`${visible ? '' : 'hidden'} border border-slate-200 bg-white p-5 shadow-sm`}>
        <div className="-mx-5 -mt-5 mb-5 border-b border-emerald-200 bg-emerald-50 px-5 py-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="flex items-center text-lg font-semibold text-emerald-950">
                <BookOpen className="mr-2 h-5 w-5 text-emerald-700" />
                {tLang.dailyReflectionTitle}
              </h3>
              <p className="mt-1 text-sm text-emerald-800">{tLang.dailyReflectionHint}</p>
            </div>
            <span className="text-sm font-bold text-emerald-800">
              {tLang.dailyFeedbackCoverage
                .replace('{current}', todayMentorFeedbackCount.toString())
                .replace('{total}', currentStudents.length.toString())}
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-bold text-slate-800">
              {tLang.dailyFeedbackStudent}
              <select
                value={mentorFeedbackStudentId}
                onChange={(event) => setMentorFeedbackStudentId(event.target.value)}
                className="mt-1 w-full rounded-md border border-emerald-200 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
              >
                <option value="">{tLang.dailyFeedbackSelectStudent}</option>
                {currentStudents.map((student: Student) => (
                  <option key={student.id} value={student.id}>{student.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold text-slate-800">
              {tLang.dailyReflectionCompetency}
              <select
                value={mentorFeedbackCompetency}
                onChange={(event) =>
                  setMentorFeedbackCompetency(event.target.value as LearningCompetency)
                }
                disabled={!mentorFeedbackStudentId}
                className="mt-1 w-full rounded-md border border-emerald-200 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500 disabled:bg-slate-100"
              >
                {(Object.keys(competencyLabels) as LearningCompetency[]).map((competency) => (
                  <option key={competency} value={competency}>
                    {competencyLabels[competency]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4">
            <p className="text-sm font-bold text-slate-800">{tLang.dailyFeedbackAssessment}</p>
            <div
              className="mt-1 grid max-w-xl grid-cols-3 gap-1"
              role="group"
              aria-label={tLang.dailyFeedbackAssessment}
            >
              {([
                ['needsSupport', tLang.dailyReflectionNeedsSupport],
                ['progressing', tLang.dailyReflectionProgressing],
                ['confident', tLang.dailyReflectionConfident],
              ] as Array<[DailyAssessment, string]>).map(([assessment, label]) => (
                <button
                  key={assessment}
                  type="button"
                  aria-pressed={mentorFeedbackAssessment === assessment}
                  disabled={!mentorFeedbackStudentId}
                  onClick={() => setMentorFeedbackAssessment(assessment)}
                  className={`min-h-10 rounded-md px-2 py-2 text-xs font-bold transition-colors ${
                    mentorFeedbackAssessment === assessment
                      ? 'bg-emerald-700 text-white'
                      : 'border border-emerald-200 bg-white text-slate-700 hover:bg-emerald-100'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="mt-4 block text-sm font-bold text-slate-800">
            {tLang.dailyReflectionPrompt}
            <textarea
              value={mentorFeedbackText}
              onChange={(event) => setMentorFeedbackText(event.target.value.slice(0, 160))}
              disabled={!mentorFeedbackStudentId}
              maxLength={160}
              rows={3}
              placeholder={tLang.dailyReflectionPlaceholder}
              className="mt-1 w-full resize-none rounded-md border border-emerald-200 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500 disabled:bg-slate-100"
            />
          </label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-emerald-800">
              {selectedMentorFeedback
                ? tLang.dailyFeedbackAlreadyRecorded
                : tLang.dailyFeedbackSaveHint}
            </p>
            <button
              type="button"
              onClick={handleSaveMentorDailyFeedback}
              disabled={!mentorFeedbackStudentId || !mentorFeedbackText.trim()}
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Save className="mr-2 h-4 w-4" />
              {selectedMentorFeedback
                ? tLang.dailyFeedbackUpdate
                : tLang.dailyReflectionSubmit}
            </button>
          </div>
        </div>

        <WeeklyFeedbackReportPanel
          classId={classId}
          competencyLabels={competencyLabels}
          evidence={learningEvidence}
          lang={lang}
          schoolTimeZone={schoolTimeZone}
          students={currentStudents}
          tLang={tLang}
        />
      </section>

      <div className={`${visible ? '' : 'hidden'} mt-6 bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200`}>
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-medium text-slate-900 flex items-center">
            {recordView === 'boss'
              ? <Swords className="h-5 w-5 mr-2 text-amber-600" />
              : recordView === 'feedback'
                ? <BookOpen className="h-5 w-5 mr-2 text-emerald-600" />
                : <Shield className="h-5 w-5 mr-2 text-rose-500" />}
            {recordView === 'discipline'
              ? tLang.disciplineRecords
              : recordView === 'points'
                ? tLang.pointAdjustmentRecords
                : recordView === 'feedback'
                  ? tLang.dailyFeedbackRecords
                  : tLang.bossRewardRecords}
          </h3>
          <div className="flex flex-wrap rounded-full bg-white p-1 border border-slate-200">
            <button
              onClick={() => setRecordView('discipline')}
              className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                recordView === 'discipline' ? 'bg-rose-100 text-rose-700' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {tLang.recordMenuDiscipline}
            </button>
            <button
              onClick={() => setRecordView('points')}
              className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                recordView === 'points' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {tLang.recordMenuPoints}
            </button>
            <button
              onClick={() => setRecordView('feedback')}
              className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                recordView === 'feedback' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {tLang.recordMenuDailyFeedback}
            </button>
            <button
              onClick={() => setRecordView('boss')}
              className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                recordView === 'boss' ? 'bg-amber-100 text-amber-800' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {tLang.recordMenuBossRewards}
            </button>
          </div>
        </div>
        {recordView === 'discipline' ? (
          disciplineRecords.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500 text-center">{tLang.noDisciplineRecords}</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {disciplineRecords.map((record: any) => (
                <div key={record.id} className="px-5 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${getRecordTone(record.type)}`}>
                        {getRecordLabel(record.type)}
                      </span>
                      <span className="font-medium text-slate-900">{record.studentName}</span>
                      {record.type === 'warning' && (
                        <span className="text-sm text-slate-500">
                          {tLang.warningPoints} {record.warningCount}/{WARNING_THRESHOLD}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {record.type === 'warning'
                        ? tLang.warningIssued.replace('{name}', record.studentName).replace('{count}', String(record.warningCount ?? 1))
                        : record.type === 'autoPenalty'
                          ? penaltySummary(WARNING_AUTO_PENALTY)
                          : record.type === 'discipline'
                            ? penaltySummary(DIRECT_DISCIPLINE_PENALTY)
                            : record.type === 'levelDecrease'
                              ? (lang === 'en' ? 'Pet level decreased by 1.' : '寵物等級降低 1 級。')
                              : (lang === 'en'
                                  ? 'Original event retained; a compensating reversal was recorded.'
                                  : '原始事件已保留，並新增一筆撤銷補償紀錄。')}
                    </div>
                    {record.reason && (
                      <div className="mt-1 text-xs text-slate-500">
                        {lang === 'en' ? 'Reason' : '理由'}：{record.reason}
                      </div>
                    )}
                    {record.reversesRecordId && (
                      <div className="mt-1 font-mono text-[11px] text-slate-400">
                        {lang === 'en' ? 'Reverses' : '撤銷事件'}：{record.reversesRecordId}
                      </div>
                    )}
                  </div>
                  <div className="text-xs font-medium text-slate-400">{formatRecordTime(record.createdAt)}</div>
                </div>
              ))}
            </div>
          )
        ) : recordView === 'points' ? (
          pointAdjustmentRecords.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500 text-center">{tLang.noPointAdjustmentRecords}</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {pointAdjustmentRecords.map((record: any) => (
                <div key={record.id} className="px-5 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        record.amount >= 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'
                      }`}>
                        {record.source === 'airdrop'
                          ? tLang.recordAirdrop
                          : record.source === 'participationTopUp'
                            ? (lang === 'en' ? 'Participation safety net' : '最低參與補足')
                          : record.source === 'catchUpBonus'
                            ? (lang === 'en' ? 'Catch-up bonus' : '追趕加成')
                          : record.source === 'dailyTask'
                            ? tLang.dailyTaskRecord
                          : record.source === 'manual'
                            ? tLang.recordManualAdjust
                            : tLang.recordQuickAdjust}
                      </span>
                      <span className="font-medium text-slate-900">{record.studentName}</span>
                      {record.guardrailOutcome && (
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          record.guardrailOutcome === 'blocked'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {record.guardrailOutcome === 'blocked'
                            ? (lang === 'en' ? 'Blocked by daily limit' : '每日上限拒絕')
                            : (lang === 'en' ? 'Clamped by daily limit' : '每日上限縮減')}
                        </span>
                      )}
                      {getRecordCompetency(record) && (
                        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                          {competencyLabels[getRecordCompetency(record)!]}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {record.reasonLabel
                        ? `${record.reasonLabel} (${record.amount >= 0 ? '+' : '-'}${Math.abs(record.amount)})`
                        : tLang.recordPointSummary
                            .replace('{label}', record.amount >= 0 ? '+' : '-')
                            .replace('{amount}', Math.abs(record.amount).toString())}
                    </div>
                    {record.source === 'dailyTask' && record.claimKind === 'makeup' && record.effectiveDate && (
                      <div className="mt-1 text-xs font-medium text-amber-700">
                        {tLang.dailyTaskMakeupRecord.replace('{date}', record.effectiveDate)}
                      </div>
                    )}
                    {record.guardrailOutcome && record.requestedAmount != null && (
                      <div className="mt-1 text-xs font-medium text-amber-700">
                        {lang === 'en'
                          ? `Requested ${record.requestedAmount > 0 ? '+' : ''}${record.requestedAmount}; applied ${record.amount > 0 ? '+' : ''}${record.amount}.`
                          : `原要求 ${record.requestedAmount > 0 ? '+' : ''}${record.requestedAmount}，實際套用 ${record.amount > 0 ? '+' : ''}${record.amount}。`}
                      </div>
                    )}
                  </div>
                  <div className="text-xs font-medium text-slate-400">{formatRecordTime(record.createdAt)}</div>
                </div>
              ))}
            </div>
          )
        ) : recordView === 'feedback' ? (
          dailyFeedbackRecords.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500 text-center">
              {tLang.noDailyFeedbackRecords}
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {dailyFeedbackRecords.map((record) => {
                const assessment = record.mentorAssessment ?? record.selfAssessment ?? 'progressing';
                const assessmentLabel =
                  assessment === 'needsSupport'
                    ? tLang.dailyReflectionNeedsSupport
                    : assessment === 'confident'
                      ? tLang.dailyReflectionConfident
                      : tLang.dailyReflectionProgressing;
                return (
                  <div
                    key={`${record.studentId}-${record.id}`}
                    className="px-5 py-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          record.author === 'mentor'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-violet-100 text-violet-800'
                        }`}>
                          {record.author === 'mentor'
                            ? tLang.mentorFeedbackSource
                            : tLang.studentReflectionSource}
                        </span>
                        <span className="font-medium text-slate-900">{record.studentName}</span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                          {competencyLabels[record.competency]}
                        </span>
                        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                          {assessmentLabel}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">
                        {record.text || tLang.noDailyFeedbackText}
                      </p>
                    </div>
                    <div className="shrink-0 text-xs font-medium text-slate-400">
                      {formatRecordTime(record.createdAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          bossRewardRecords.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500 text-center">{tLang.noBossRewardRecords}</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {bossRewardRecords.map((record) => {
                const rewardParts = [
                  {
                    label: tLang.bossRankBonus,
                    points: record.rankRewardPoints,
                    rankPoints: record.rankRewardRankPoints,
                    happiness: record.rankRewardHappiness,
                  },
                  {
                    label: tLang.bossParticipationBonus,
                    points: record.participationRewardPoints,
                    rankPoints: record.participationRewardRankPoints,
                    happiness: record.participationRewardHappiness,
                  },
                  {
                    label: tLang.bossImprovementBonus,
                    points: record.improvementRewardPoints,
                    rankPoints: record.improvementRewardRankPoints,
                    happiness: record.improvementRewardHappiness,
                  },
                ];

                return (
                  <div key={`${record.studentId}-${record.id}`} className="px-5 py-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                            {tLang.bossRewardRecordMeta
                              .replace('{damage}', record.damage.toString())
                              .replace('{rank}', record.rank.toString())}
                          </span>
                          <span className="font-medium text-slate-900">{record.studentName}</span>
                          <span className="text-sm text-slate-500">{record.bossName}</span>
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-700">
                          {tLang.bossRewardRecordSummary
                            .replace('{points}', record.rewardPoints.toString())
                            .replace('{rankPoints}', record.rewardRankPoints.toString())
                            .replace('{happiness}', record.rewardHappiness.toString())}
                        </div>
                      </div>
                      <div className="text-xs font-medium text-slate-400">{formatRecordTime(record.createdAt)}</div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {rewardParts.map((part) => {
                        const hasReward = part.points > 0 || part.rankPoints > 0 || part.happiness > 0;
                        return (
                          <div
                            key={part.label}
                            className={`border-l-2 px-3 py-2 ${
                              hasReward
                                ? 'border-amber-300 bg-amber-50 text-amber-950'
                                : 'border-slate-200 bg-slate-50 text-slate-400'
                            }`}
                          >
                            <div className="text-xs font-bold">{part.label}</div>
                            <div className="mt-1 text-xs">
                              {bossRewardSummary(part.points, part.rankPoints, part.happiness)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </>
  );
};
