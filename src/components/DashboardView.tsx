import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { translations } from '../i18n/translations';
import type { Language, PetCareMode } from '../store/types';
import { getStoreSessionGeneration, useStore } from '../store/useStore';
import { BossManagementSection } from '../features/boss/components/BossManagementSection';
import { LearningActivitiesSection } from '../features/learning/components/LearningActivitiesSection';
import { DashboardUndoNotices } from '../features/penalties/components/DashboardUndoNotices';
import { DashboardRecordsSection } from '../features/records/components/DashboardRecordsSection';
import { RewardsSection } from '../features/rewards/components/RewardsSection';
import { DashboardSettingsSection } from '../features/settings/components/DashboardSettingsSection';
import { StudentManagementSection } from '../features/students/components/StudentManagementSection';
import { DashboardHeader } from '../features/workspace/components/DashboardHeader';
import { ClassGroupsPanel } from '../features/teacher-console/components/ClassGroupsPanel';
import { ConsoleSecurityPanel } from '../features/teacher-console/components/ConsoleSecurityPanel';
import { TeacherClassContext } from '../features/teacher-console/components/TeacherClassContext';
import { TeacherConsoleNavigation } from '../features/teacher-console/components/TeacherConsoleNavigation';
import { TodayOverview } from '../features/teacher-console/components/TodayOverview';
import {
  AREA_DESCRIPTIONS, getAreaLabel, getAreaDestinations, getDestination, resolveDestination,
  type ConsoleArea, type ConsoleDestination,
} from '../features/teacher-console/model/navigation';
import type { ClassroomConsoleMode } from './ClassroomView';
import { type TodayPointEntryRequest, type TodayQuickAction } from '../features/teacher-console/model/todayActions';
import type { BackendSyncStatus } from '../hooks/useBackendSync';
import type { DashboardRecordView, RecordViewRequest } from '../features/records/model/recordNavigation';
import { useFeatureAnalytics } from '../analytics/useFeatureAnalytics';
import type { TeacherSetupController } from '../features/teacher-console/hooks/useTeacherSetup';
import { LearningWorkflow } from '../features/learning/components/LearningWorkflow';
import { getLearningWorkflowStep, resolveLearningStudent } from '../features/learning/model/learningWorkflow';
import { authorizeLearningDrafts } from '../features/learning/hooks/useScopedLearningDraft';
import type { LearningDraftAuthorization } from '../features/learning/model/learningDraftMemory';
import { resolveGameFeatures } from '../../shared/gameFeatures';

const StudentAnalyticsSection = lazy(() => import('../features/analytics/components/StudentAnalyticsSection').then((module) => ({ default: module.StudentAnalyticsSection })));
const DataGovernanceSection = lazy(() => import('../features/workspace/components/DataGovernanceSection').then((module) => ({ default: module.DataGovernanceSection })));
const ClassroomView = lazy(() => import('./ClassroomView').then((module) => ({ default: module.ClassroomView })));

type DashboardViewProps = {
  readOnly?: boolean;
  canExportFullData?: boolean;
  canAdministerWorkspace?: boolean;
  flushChanges?: () => Promise<boolean>;
  workspaceName?: string;
  syncStatus?: BackendSyncStatus;
  setup?: TeacherSetupController;
  draftAuthorization?: LearningDraftAuthorization | null;
};
const analyticsModes = { 'student-insights': 'student', 'class-insights': 'class', trends: 'trends', evidence: 'evidence', exams: 'exams' } as const;
const gameDestinations: ConsoleDestination[] = ['pets', 'battle', 'leaderboard', 'boss'];

/** Draft editors stay mounted; activity dialogs close when leaving their page. */
export const DashboardView = ({ readOnly = false, canExportFullData = false, canAdministerWorkspace = false, flushChanges = async () => true, workspaceName, syncStatus = 'connected', setup, draftAuthorization }: DashboardViewProps) => {
  const draftPermit = authorizeLearningDrafts(draftAuthorization);
  const data = useStore((state) => state.data);
  const lang = data.settings?.language || 'zh';
  const gameFeatures = resolveGameFeatures(data.settings?.gameFeatures);
  const capabilities = { readOnly, canAdministerWorkspace, gameFeatures };
  const [destination, setDestination] = useState<ConsoleDestination>('today');
  const [lastDestinations, setLastDestinations] = useState<Partial<Record<ConsoleArea, ConsoleDestination>>>({});
  const [visited, setVisited] = useState({ analytics: false, governance: false });
  const [gameMode, setGameMode] = useState<ClassroomConsoleMode>('pets');
  const [todayPointEntry, setTodayPointEntry] = useState<TodayPointEntryRequest | null>(null);
  const [recordViewRequest, setRecordViewRequest] = useState<RecordViewRequest | null>(null);
  const [learningSelection, setLearningSelection] = useState<{ classId: string; studentId: string } | null>(null);
  const [examReportRequestId, setExamReportRequestId] = useState(0);
  const [examReportActive, setExamReportActive] = useState(false);
  const [readOnlyClassId, setReadOnlyClassId] = useState(data.currentClassId);
  const [settingsLanguage, setSettingsLanguage] = useState<Language>(lang);
  const [petCareMode, setPetCareMode] = useState<PetCareMode>(data.settings?.petCareMode === 'death' ? 'death' : 'rest');
  const gamesShown = setup?.state.gameMode !== 'hidden' && Object.values(gameFeatures).some(Boolean);
  const active = resolveDestination(!gamesShown && getDestination(destination).area === 'activities' ? 'today' : destination, capabilities);
  useFeatureAnalytics(active, !readOnly);
  const area = getDestination(active).area;
  const selectedClassId = readOnly ? readOnlyClassId : data.currentClassId;
  const sessionGeneration = getStoreSessionGeneration();
  const currentClass = data.classes.find((item) => item.id === selectedClassId);
  const learningStudentId = resolveLearningStudent(selectedClassId, currentClass?.students ?? [], learningSelection);
  const onLearningStudentChange = useCallback((studentId: string) => {
    if (getStoreSessionGeneration() !== sessionGeneration) return;
    const classroom = useStore.getState().data.classes.find((item) => item.id === selectedClassId);
    if (classroom?.students.some((student) => student.id === studentId)) {
      setLearningSelection({ classId: selectedClassId, studentId });
    }
  // A new/revoked permit must also wake memoized editors with identical rosters.
  }, [selectedClassId, sessionGeneration, draftPermit]);
  const studentSelection = useMemo(() => ({
    studentId: learningStudentId, onStudentChange: onLearningStudentChange,
  }), [learningStudentId, onLearningStudentChange]);
  const workflowStep = active === 'exams' && examReportActive ? 'report' : getLearningWorkflowStep(active);
  const analyticsMode = active in analyticsModes ? analyticsModes[active as keyof typeof analyticsModes] : 'student';
  const analyticsVisible = active in analyticsModes;
  const governanceVisible = active === 'governance' && !readOnly && canAdministerWorkspace;
  const gamesVisible = !readOnly && gameDestinations.includes(active);
  const rewardsSettingsVisible = active === 'reward-settings' && !readOnly && canAdministerWorkspace;

  const navigate = (next: ConsoleDestination) => {
    setExamReportActive(false);
    const resolved = resolveDestination(!gamesShown && getDestination(next).area === 'activities' ? 'today' : next, capabilities);
    setDestination(resolved);
    setLastDestinations((current) => ({ ...current, [getDestination(resolved).area]: resolved }));
    setVisited((current) => ({ analytics: current.analytics || resolved in analyticsModes, governance: current.governance || resolved === 'governance' }));
    if (gameDestinations.includes(resolved)) setGameMode(resolved as ClassroomConsoleMode);
  };
  const navigateArea = (next: ConsoleArea) => {
    const available = getAreaDestinations(next, capabilities);
    const remembered = lastDestinations[next];
    const target = available.find((item) => item.id === remembered) ?? available[0];
    if (target) navigate(target.id);
  };
  const navigateFromToday = (next: ConsoleDestination, recordView?: DashboardRecordView) => {
    if (recordView) setRecordViewRequest((previous) => ({ id: (previous?.id ?? 0) + 1, view: recordView }));
    navigate(next);
    requestAnimationFrame(() => document.getElementById('dashboard-panel')?.focus());
  };
  const runTodayAction = (action: TodayQuickAction) => {
    if (readOnly || (syncStatus !== 'connected' && syncStatus !== 'saving')) return;
    if (action === 'points' || action === 'give-points' || action === 'deduct-points') {
      setTodayPointEntry((previous) => ({ id: (previous?.id ?? 0) + 1, direction: action === 'deduct-points' ? 'deduct' : 'give' }));
    } else {
      const tasks = { comment: 'comments', evidence: 'evidence', exam: 'exams' } as const;
      navigateFromToday(action === 'activity' ? getAreaDestinations('activities', capabilities)[0]?.id ?? 'today' : tasks[action]);
    }
  };
  const runSetupStep = (step: 'class' | 'roster' | 'points' | 'review') => {
    if (readOnly || (syncStatus !== 'connected' && syncStatus !== 'saving')) return;
    if (step === 'points') runTodayAction('points');
    else {
      if (step === 'review') setup?.review();
      navigateFromToday(step === 'review' ? 'student-insights' : 'students');
    }
  };

  useEffect(() => {
    if (readOnly && !data.classes.some((item) => item.id === readOnlyClassId)) {
      setReadOnlyClassId(data.currentClassId || data.classes[0]?.id || '');
    }
  }, [data.classes, data.currentClassId, readOnly, readOnlyClassId]);

  return (
    <div className="mx-auto min-h-full max-w-7xl bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <DashboardHeader readOnly={readOnly} canAdministerWorkspace={governanceVisible} canExportFullData={governanceVisible && canExportFullData}
        flushChanges={flushChanges}
        description={lang === 'en' ? 'Start your day with points, comments and exams.' : '從首頁開始，加減分、評語與考試一目了然。'} />
      <TeacherClassContext classes={data.classes} classId={selectedClassId} language={lang} readOnly={readOnly} workspaceName={workspaceName} onReviewClassChange={setReadOnlyClassId} />
      <TeacherConsoleNavigation active={active} language={lang} onAreaChange={navigateArea} onChange={navigate} gamificationVisible={gamesShown} {...capabilities} />
      <div id="dashboard-panel" role={area === 'today' ? 'region' : 'tabpanel'} aria-labelledby={area === 'today' ? 'console-area-today' : `console-tab-${active}`} tabIndex={0} className="min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-700">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-900">{getAreaLabel(area, lang)}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{AREA_DESCRIPTIONS[area][lang]}</p>
        </div>
        {!readOnly && <DashboardUndoNotices />}
        {workflowStep && <div key={`${getStoreSessionGeneration()}:${selectedClassId}`}><LearningWorkflow step={workflowStep} language={lang}
          studentName={currentClass?.students.find((student) => student.id === learningStudentId)?.name}
          readOnly={readOnly} syncStatus={syncStatus} data={data} flushChanges={flushChanges} onNavigate={navigateFromToday}
          onExamReport={() => {
            navigateFromToday('exams');
            setExamReportActive(true);
            setExamReportRequestId((previous) => previous + 1);
          }} /></div>}
        {active === 'today' && <TodayOverview classData={currentClass} language={lang} schoolTimeZone={data.settings?.schoolTimeZone} settings={data.settings} syncStatus={syncStatus} onNavigate={navigateFromToday} onAction={runTodayAction} setup={setup} onSetupStep={runSetupStep} {...capabilities} />}
        {(visited.analytics || analyticsVisible) && <Suspense fallback={<DashboardLoading language={lang} />}>
          <StudentAnalyticsSection classId={selectedClassId} readOnly={readOnly} mode={analyticsMode} visible={analyticsVisible}
            studentSelection={studentSelection} reportRequestId={examReportRequestId} />
        </Suspense>}
        <StudentManagementSection canAdministerWorkspace={canAdministerWorkspace} canWrite={!readOnly} showClassSelector={false} visible={!readOnly && active === 'students'} flushChanges={flushChanges} />
        <ClassGroupsPanel classData={currentClass} language={lang} canWrite={!readOnly} visible={!readOnly && active === 'groups'} />
        <RewardsSection canAdministerWorkspace={canAdministerWorkspace} canWrite={!readOnly} reasonLanguage={settingsLanguage}
          todayPointEntry={todayPointEntry} todayActive={active === 'today'}
          mode={rewardsSettingsVisible ? 'settings' : 'points'} visible={!readOnly && (active === 'points' || rewardsSettingsVisible)} />
        <BossManagementSection canWrite={!readOnly} mode={rewardsSettingsVisible ? 'rewards' : 'boss'} visible={!readOnly && (active === 'boss' || (rewardsSettingsVisible && gameFeatures.bosses))} />
        {!readOnly && gamesVisible && <div>
          <Suspense fallback={<DashboardLoading language={lang} />}><ClassroomView key={JSON.stringify(gameFeatures)} consoleMode={gameMode} visible={gamesVisible} /></Suspense>
        </div>}
        <LearningActivitiesSection canWrite={!readOnly} petCareMode={petCareMode} visible={!readOnly && active === 'goals'} guideVisible={!readOnly && (active === 'pets' || active === 'battle')} />
        <DashboardRecordsSection classId={selectedClassId} readOnly={readOnly} mode={active === 'comments' ? 'comments' : active === 'reports' ? 'reports' : 'records'}
          studentSelection={studentSelection}
          viewRequest={recordViewRequest}
          historyKind={active === 'activity-rewards' ? 'boss' : 'all'} visible={active === 'comments' || active === 'reports' || active === 'records' || active === 'activity-rewards'} />
        <DashboardSettingsSection canAdministerWorkspace={canAdministerWorkspace} canWrite={!readOnly && canAdministerWorkspace}
          languageDraft={settingsLanguage} onLanguageDraftChange={setSettingsLanguage} petCareModeDraft={petCareMode} onPetCareModeDraftChange={setPetCareMode}
          mode={active === 'reward-settings' ? 'rewards' : active === 'workspace' ? 'workspace' : active === 'governance' ? 'governance' : 'rules'}
          visible={!readOnly && canAdministerWorkspace && ['rules', 'reward-settings', 'workspace', 'governance'].includes(active)} />
        {!readOnly && canAdministerWorkspace && active === 'security' && <ConsoleSecurityPanel language={lang} onNavigate={navigate} />}
        {!readOnly && canAdministerWorkspace && (visited.governance || governanceVisible) && <div hidden={!governanceVisible}>
          <Suspense fallback={<DashboardLoading language={lang} />}><DataGovernanceSection classes={data.classes} settings={data.settings} language={lang} flushChanges={flushChanges} /></Suspense>
        </div>}
      </div>
    </div>
  );
};

const DashboardLoading = ({ language }: { language: Language }) => (
  <div role="status" className="flex min-h-64 items-center justify-center text-sm font-medium text-slate-500">
    <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{translations[language].loading}
  </div>
);
