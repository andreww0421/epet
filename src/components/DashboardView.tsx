import { lazy, Suspense, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { translations } from '../i18n/translations';
import type { Language, PetCareMode } from '../store/types';
import { useStore } from '../store/useStore';
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
  AREA_DESCRIPTIONS, AREA_LABELS, getAreaDestinations, getDestination, resolveDestination,
  type ConsoleArea, type ConsoleDestination,
} from '../features/teacher-console/model/navigation';
import type { ClassroomConsoleMode } from './ClassroomView';
import { type TodayPointEntryRequest, type TodayQuickAction } from '../features/teacher-console/model/todayActions';
import type { BackendSyncStatus } from '../hooks/useBackendSync';
import type { DashboardRecordView, RecordViewRequest } from '../features/records/model/recordNavigation';
import { useFeatureAnalytics } from '../analytics/useFeatureAnalytics';

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
};
const analyticsModes = { 'student-insights': 'student', 'class-insights': 'class', trends: 'trends', evidence: 'evidence', exams: 'exams' } as const;
const gameDestinations: ConsoleDestination[] = ['pets', 'battle', 'leaderboard', 'boss'];

/** Page composition, task navigation and high-level coordination only. Feature owners stay mounted. */
export const DashboardView = ({ readOnly = false, canExportFullData = false, canAdministerWorkspace = false, flushChanges = async () => true, workspaceName, syncStatus = 'connected' }: DashboardViewProps) => {
  const data = useStore((state) => state.data);
  const lang = data.settings?.language || 'zh';
  const capabilities = { readOnly, canAdministerWorkspace };
  const [destination, setDestination] = useState<ConsoleDestination>('today');
  const [lastDestinations, setLastDestinations] = useState<Partial<Record<ConsoleArea, ConsoleDestination>>>({});
  const [visited, setVisited] = useState({ analytics: false, governance: false, games: false });
  const [gameMode, setGameMode] = useState<ClassroomConsoleMode>('pets');
  const [todayPointEntry, setTodayPointEntry] = useState<TodayPointEntryRequest | null>(null);
  const [recordViewRequest, setRecordViewRequest] = useState<RecordViewRequest | null>(null);
  const [readOnlyClassId, setReadOnlyClassId] = useState(data.currentClassId);
  const [settingsLanguage, setSettingsLanguage] = useState<Language>(lang);
  const [petCareMode, setPetCareMode] = useState<PetCareMode>(data.settings?.petCareMode === 'death' ? 'death' : 'rest');
  const active = resolveDestination(destination, capabilities);
  useFeatureAnalytics(active, !readOnly);
  const area = getDestination(active).area;
  const selectedClassId = readOnly ? readOnlyClassId : data.currentClassId;
  const currentClass = data.classes.find((item) => item.id === selectedClassId);
  const analyticsMode = active in analyticsModes ? analyticsModes[active as keyof typeof analyticsModes] : 'student';
  const analyticsVisible = active in analyticsModes;
  const governanceVisible = active === 'governance' && !readOnly && canAdministerWorkspace;
  const gamesVisible = !readOnly && gameDestinations.includes(active);
  const rewardsSettingsVisible = active === 'reward-settings' && !readOnly && canAdministerWorkspace;

  const navigate = (next: ConsoleDestination) => {
    const resolved = resolveDestination(next, capabilities);
    setDestination(resolved);
    setLastDestinations((current) => ({ ...current, [getDestination(resolved).area]: resolved }));
    setVisited((current) => ({ analytics: current.analytics || resolved in analyticsModes, governance: current.governance || resolved === 'governance', games: current.games || gameDestinations.includes(resolved) }));
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
    if (action === 'give-points' || action === 'deduct-points') {
      setTodayPointEntry((previous) => ({ id: (previous?.id ?? 0) + 1, direction: action === 'give-points' ? 'give' : 'deduct' }));
    } else {
      const tasks = { comment: 'comments', evidence: 'evidence', exam: 'exams', activity: 'pets' } as const;
      navigateFromToday(tasks[action]);
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
        description={lang === 'en' ? 'Your teaching day, organized around class, learning, activities and insights.' : '以班級、學習、活動與洞察，整理每天的導師工作。'} />
      <TeacherClassContext classes={data.classes} classId={selectedClassId} language={lang} readOnly={readOnly} workspaceName={workspaceName} onReviewClassChange={setReadOnlyClassId} />
      <TeacherConsoleNavigation active={active} language={lang} onAreaChange={navigateArea} onChange={navigate} {...capabilities} />
      <div id="dashboard-panel" role={area === 'today' ? 'region' : 'tabpanel'} aria-labelledby={area === 'today' ? 'console-area-today' : `console-tab-${active}`} tabIndex={0} className="min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-700">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-900">{AREA_LABELS[area]}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{AREA_DESCRIPTIONS[area][lang]}</p>
        </div>
        {!readOnly && <DashboardUndoNotices />}
        {active === 'today' && <TodayOverview classData={currentClass} language={lang} schoolTimeZone={data.settings?.schoolTimeZone} settings={data.settings} syncStatus={syncStatus} onNavigate={navigateFromToday} onAction={runTodayAction} {...capabilities} />}
        {(visited.analytics || analyticsVisible) && <Suspense fallback={<DashboardLoading language={lang} />}>
          <StudentAnalyticsSection classId={selectedClassId} readOnly={readOnly} mode={analyticsMode} visible={analyticsVisible} />
        </Suspense>}
        <StudentManagementSection canAdministerWorkspace={canAdministerWorkspace} canWrite={!readOnly} showClassSelector={false} visible={!readOnly && active === 'students'} />
        <ClassGroupsPanel classData={currentClass} language={lang} canWrite={!readOnly} visible={!readOnly && active === 'groups'} />
        <RewardsSection canAdministerWorkspace={canAdministerWorkspace} canWrite={!readOnly} reasonLanguage={settingsLanguage}
          todayPointEntry={todayPointEntry} todayActive={active === 'today'}
          mode={rewardsSettingsVisible ? 'settings' : 'points'} visible={!readOnly && (active === 'points' || rewardsSettingsVisible)} />
        <BossManagementSection canWrite={!readOnly} mode={rewardsSettingsVisible ? 'rewards' : 'boss'} visible={!readOnly && (active === 'boss' || rewardsSettingsVisible)} />
        {!readOnly && (visited.games || gamesVisible) && <div hidden={!gamesVisible}>
          <Suspense fallback={<DashboardLoading language={lang} />}><ClassroomView consoleMode={gameMode} visible={gamesVisible} /></Suspense>
        </div>}
        <LearningActivitiesSection canWrite={!readOnly} petCareMode={petCareMode} visible={!readOnly && active === 'goals'} guideVisible={!readOnly && (active === 'pets' || active === 'battle')} />
        <DashboardRecordsSection classId={selectedClassId} readOnly={readOnly} mode={active === 'comments' ? 'comments' : active === 'reports' ? 'reports' : 'records'}
          viewRequest={recordViewRequest}
          historyKind={active === 'activity-rewards' ? 'boss' : 'all'} visible={active === 'comments' || active === 'reports' || active === 'records' || active === 'activity-rewards'} />
        <DashboardSettingsSection canAdministerWorkspace={canAdministerWorkspace} canWrite={!readOnly && canAdministerWorkspace}
          languageDraft={settingsLanguage} onLanguageDraftChange={setSettingsLanguage} petCareModeDraft={petCareMode} onPetCareModeDraftChange={setPetCareMode}
          mode={active === 'reward-settings' ? 'rewards' : active === 'workspace' ? 'workspace' : active === 'governance' ? 'governance' : 'rules'}
          visible={!readOnly && canAdministerWorkspace && ['rules', 'reward-settings', 'workspace', 'governance'].includes(active)} />
        {!readOnly && canAdministerWorkspace && active === 'security' && <ConsoleSecurityPanel language={lang} onNavigate={navigate} />}
        {!readOnly && canAdministerWorkspace && (visited.governance || governanceVisible) && <div hidden={!governanceVisible}>
          <Suspense fallback={<DashboardLoading language={lang} />}><DataGovernanceSection classes={data.classes} language={lang} flushChanges={flushChanges} /></Suspense>
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
