import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart3, BookOpenCheck, Target, TrendingUp, Users,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  computeClassEffectivenessMetrics,
  computeStudentLearningAnalytics,
  type LearningCompetency,
  type LearningEvidenceLevel,
  type LearningEvidenceSource,
  type LearningEvidenceType,
} from '../../../../shared/education';
import { translations } from '../../../i18n/translations';
import {
  isBackendAvailable,
  loadClassEffectiveness,
  loadStudentAnalytics,
} from '../../../services/backendApi';
import { useStore } from '../../../store/useStore';
import { ExamAssessmentPanel } from '../../exams/components/ExamAssessmentPanel';
import { LearningEvidenceForm } from '../../learning/components/LearningEvidenceForm';
import { EconomyDashboardPanel } from './EconomyDashboardPanel';

const levelTone: Record<LearningEvidenceLevel, string> = {
  needsSupport: 'bg-rose-500',
  progressing: 'bg-sky-500',
  mastered: 'bg-emerald-500',
};

export type StudentAnalyticsMode = 'all' | 'student' | 'class' | 'trends' | 'evidence' | 'exams';

type StudentAnalyticsPanelProps = {
  classId?: string;
  readOnly?: boolean;
  mode?: StudentAnalyticsMode;
  visible?: boolean;
};

export const StudentAnalyticsPanel: React.FC<StudentAnalyticsPanelProps> = ({
  classId,
  readOnly = false,
  mode = 'all',
  visible = true,
}) => {
  const { currentClass, lang, maxPoints } = useStore(
    useShallow((state) => ({
      currentClass: state.data.classes.find(
        (classData) => classData.id === (classId ?? state.data.currentClassId),
      ),
      lang: state.data.settings?.language || 'zh',
      maxPoints: state.data.settings?.maxPoints ?? 700,
    })),
  );
  const tLang = translations[lang];
  const students = useMemo(() => currentClass?.students ?? [], [currentClass?.students]);
  const evidence = useMemo(
    () => currentClass?.learningEvidenceRecords ?? [],
    [currentClass?.learningEvidenceRecords],
  );
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const selectedStudent = students.find((student) => student.id === studentId) ?? students[0];

  useEffect(() => {
    if (!students.some((student) => student.id === studentId)) {
      setStudentId(students[0]?.id ?? '');
    }
  }, [studentId, students]);

  const localStudentAnalytics = useMemo(
    () => selectedStudent
      ? computeStudentLearningAnalytics(selectedStudent, evidence)
      : null,
    [evidence, selectedStudent],
  );
  const localClassMetrics = useMemo(
    () => computeClassEffectivenessMetrics(
      students,
      evidence,
      currentClass?.classGoals ?? [],
    ),
    [currentClass?.classGoals, evidence, students],
  );
  const [remoteStudentAnalytics, setRemoteStudentAnalytics] =
    useState<typeof localStudentAnalytics>(null);
  const [remoteClassMetrics, setRemoteClassMetrics] =
    useState<typeof localClassMetrics | null>(null);

  useEffect(() => {
    setRemoteStudentAnalytics(null);
    setRemoteClassMetrics(null);
    if (!currentClass || !selectedStudent || !isBackendAvailable()) return;
    let disposed = false;
    const timer = setTimeout(async () => {
      try {
        const [studentAnalytics, classMetrics] = await Promise.all([
          loadStudentAnalytics(currentClass.id, selectedStudent.id),
          loadClassEffectiveness(currentClass.id),
        ]);
        if (!disposed) {
          setRemoteStudentAnalytics(studentAnalytics);
          setRemoteClassMetrics(classMetrics);
        }
      } catch {
        // Local calculations use the same shared domain rules.
      }
    }, 700);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [currentClass, evidence, selectedStudent]);

  const remoteStudentEvidenceIsCurrent = Boolean(
    remoteStudentAnalytics &&
    localStudentAnalytics &&
    remoteStudentAnalytics.evidenceCount === localStudentAnalytics.evidenceCount &&
    remoteStudentAnalytics.recentEvidence.length === localStudentAnalytics.recentEvidence.length &&
    remoteStudentAnalytics.recentEvidence.every(
      (record, index) =>
        record.id === localStudentAnalytics.recentEvidence[index]?.id &&
        record.revision === localStudentAnalytics.recentEvidence[index]?.revision,
    ),
  );
  const studentAnalytics = remoteStudentEvidenceIsCurrent
    ? remoteStudentAnalytics
    : localStudentAnalytics;
  const classMetrics =
    remoteClassMetrics?.evidenceCount === localClassMetrics.evidenceCount
      ? remoteClassMetrics
      : localClassMetrics;
  const competencyLabels: Record<LearningCompetency, string> = {
    participation: tLang.competencyParticipation,
    collaboration: tLang.competencyCollaboration,
    selfManagement: tLang.competencySelfManagement,
    assignmentQuality: tLang.competencyAssignmentQuality,
    growth: tLang.competencyGrowth,
  };
  const levelLabels: Record<LearningEvidenceLevel, string> = {
    needsSupport: tLang.dailyReflectionNeedsSupport,
    progressing: tLang.dailyReflectionProgressing,
    mastered: tLang.learningEvidenceMastered,
  };
  const typeLabels: Record<LearningEvidenceType, string> = {
    observation: tLang.learningEvidenceObservation,
    assignment: tLang.learningEvidenceAssignment,
    reflection: tLang.learningEvidenceReflection,
    project: tLang.learningEvidenceProject,
    assessment: tLang.learningEvidenceAssessment,
  };
  const sourceLabels: Record<LearningEvidenceSource, string> = {
    manual: tLang.learningEvidenceManualSource,
    mentorDailyFeedback: tLang.dailyReflectionRecord,
    import: tLang.learningEvidenceImportSource,
  };
  // Views only select presentation; domain calculations and form ownership stay shared.
  const showClassMetrics = mode === 'all' || mode === 'class' || mode === 'trends';
  const showStudentDetails = mode === 'all' || mode === 'student';
  const showCompetencyProfile = showStudentDetails || mode === 'trends';
  const showRecentEvidence = showStudentDetails || mode === 'evidence';
  const showEvidenceForm = !readOnly && (mode === 'all' || mode === 'evidence');
  const showStudentArea = mode !== 'class';
  const heading = mode === 'class'
    ? (lang === 'en' ? 'Class analytics' : '班級分析')
    : mode === 'trends'
      ? (lang === 'en' ? 'Learning trends' : '學習趨勢')
      : mode === 'evidence'
        ? (lang === 'en' ? 'Learning evidence' : '學習證據')
        : tLang.studentAnalyticsTitle;

  if (!currentClass) return null;

  return (
    <>
    <div hidden={!visible || (mode !== 'all' && mode !== 'class')}>
      <EconomyDashboardPanel students={students} maxPoints={maxPoints} lang={lang} />
    </div>
    <section hidden={!visible || mode === 'exams'} className="border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <h2 className="flex items-center text-lg font-bold text-slate-900">
          <BarChart3 className="mr-2 h-5 w-5 text-indigo-600" />
          {heading}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {mode === 'evidence' ? tLang.addLearningEvidenceHint : tLang.studentAnalyticsHint}
        </p>
      </header>

      <div hidden={!showClassMetrics} className={showClassMetrics ? 'grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-6' : ''}>
        {[
          [tLang.evidenceCoverage, `${Math.round(classMetrics.coverageRate * 100)}%`, Users],
          [tLang.learningEvidenceCount, classMetrics.evidenceCount, BookOpenCheck],
          [
            tLang.progressingOrMasteredRate,
            `${Math.round(classMetrics.progressingOrMasteredRate * 100)}%`,
            TrendingUp,
          ],
          [tLang.goalAlignmentRate, `${Math.round(classMetrics.goalAlignmentRate * 100)}%`, Target],
          [tLang.supportRecovery, classMetrics.supportRecoveryCount, Activity],
          [
            tLang.evidenceTrend,
            `${classMetrics.evidenceTrend >= 0 ? '+' : ''}${classMetrics.evidenceTrend}`,
            TrendingUp,
          ],
        ].map(([label, value, Icon]) => (
          <div key={String(label)} className="bg-white px-4 py-4">
            <p className="flex items-center text-xs font-medium text-slate-500">
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {label}
            </p>
            <p className="mt-1 text-xl font-black text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      <p hidden={!showClassMetrics} className="border-b border-slate-200 px-5 py-2 text-xs text-slate-500">
        {tLang.educationMetricsCaution}
      </p>

      {students.length === 0 && (
        <p className="px-5 py-12 text-center text-sm text-slate-500">{tLang.addStudentFirst}</p>
      )}
        <div hidden={!showStudentArea} className={`${students.length === 0 ? 'hidden' : ''} ${showEvidenceForm ? 'grid lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]' : ''}`}>
          <div className={`border-b border-slate-200 p-5 lg:border-b-0 ${showEvidenceForm ? 'lg:border-r' : ''}`}>
            <label className="block max-w-sm text-sm font-bold text-slate-700">
              {tLang.studentAnalyticsSelect}
              <select
                value={selectedStudent?.id ?? ''}
                onChange={(event) => setStudentId(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2"
              >
                {students.map((student) => (
                  <option key={student.id} value={student.id}>{student.name}</option>
                ))}
              </select>
            </label>

            {selectedStudent && studentAnalytics && (
              <>
                <div hidden={!showStudentDetails} className={showStudentDetails ? 'mt-5 grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4' : ''}>
                  {[
                    [tLang.learningEvidenceCount, studentAnalytics.evidenceCount],
                    [tLang.learningEvidenceMastered, studentAnalytics.masteredCount],
                    [tLang.dailyReflectionNeedsSupport, studentAnalytics.needsSupportCount],
                    [tLang.competenciesReached, studentAnalytics.competencyBreadth],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="bg-slate-50 px-3 py-3">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="mt-1 text-lg font-black text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>

                <div hidden={!showCompetencyProfile} className="mt-6">
                  <h3 className="text-sm font-bold text-slate-900">
                    {tLang.competencyLearningProfile}
                  </h3>
                  <div className="mt-3 divide-y divide-slate-100">
                    {studentAnalytics.competencySummaries.map((summary) => {
                      const width =
                        summary.latestLevel === 'mastered'
                          ? 100
                          : summary.latestLevel === 'progressing'
                            ? 60
                            : summary.latestLevel === 'needsSupport'
                              ? 25
                              : 0;
                      return (
                        <div key={summary.competency} className="py-3">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-slate-700">
                              {competencyLabels[summary.competency]}
                            </span>
                            <span className="text-xs font-bold text-slate-500">
                              {summary.latestLevel
                                ? levelLabels[summary.latestLevel]
                                : tLang.noLearningEvidence}
                              {summary.trend > 0 ? ' ↑' : summary.trend < 0 ? ' ↓' : ''}
                            </span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${
                                summary.latestLevel
                                  ? levelTone[summary.latestLevel]
                                  : 'bg-slate-200'
                              }`}
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div hidden={!showRecentEvidence} className="mt-6 border-t border-slate-200 pt-5">
                  <h3 className="text-sm font-bold text-slate-900">
                    {tLang.recentLearningEvidence}
                  </h3>
                  {studentAnalytics.recentEvidence.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">{tLang.noLearningEvidence}</p>
                  ) : (
                    <div className="mt-3 divide-y divide-slate-100">
                      {studentAnalytics.recentEvidence.map((record) => (
                        <div key={record.id} className="py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-900">{record.title}</span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                              {competencyLabels[record.competency]}
                            </span>
                            <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
                              {levelLabels[record.level]}
                            </span>
                            <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                              record.source === 'mentorDailyFeedback'
                                ? 'bg-emerald-50 text-emerald-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}>
                              {sourceLabels[record.source]}
                            </span>
                          </div>
                          {record.note && record.note !== record.title && (
                            <p className="mt-1 text-sm leading-5 text-slate-600">{record.note}</p>
                          )}
                          <p className="mt-1 text-xs text-slate-500">
                            {new Date(record.createdAt).toLocaleDateString(
                              lang === 'en' ? 'en-US' : 'zh-TW',
                            )}
                            {' · '}
                            {typeLabels[record.evidenceType]}
                            {' · '}
                            {tLang.rubricVersion} {record.rubricVersion}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div hidden={!showStudentDetails} className="mt-6 border-l-4 border-indigo-400 bg-indigo-50 px-4 py-3">
                  <p className="text-xs font-bold text-indigo-900">
                    {tLang.gameStatusSeparated}
                  </p>
                  <p className="mt-1 text-sm text-indigo-800">
                    {tLang.points} {selectedStudent.points} · RP {selectedStudent.rankPoints ?? 0} ·
                    Lv. {selectedStudent.pet.level}
                  </p>
                </div>
              </>
            )}
          </div>

          <LearningEvidenceForm
            canWrite={!readOnly}
            competencyLabels={competencyLabels}
            language={lang}
            levelLabels={levelLabels}
            studentId={selectedStudent?.id}
            typeLabels={typeLabels}
            visible={visible && showEvidenceForm}
          />
        </div>
    </section>
    <div hidden={!visible || (mode !== 'all' && mode !== 'exams')}>
      <ExamAssessmentPanel readOnly={readOnly} classId={classId} />
    </div>
    </>
  );
};
