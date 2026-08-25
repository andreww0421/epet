import React, { lazy, Suspense, useState, useRef, useMemo, useEffect } from 'react';
import { 
  Users, Settings, AlertCircle, Trash2, Star, Shield, Zap, X, Plus, Minus,
  Download, Upload, ChevronsDown, Edit2, Save, BookOpen, RefreshCw, Skull, Swords,
  Gift, Crosshair, Target, BarChart3, Undo2,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { translations, petNames, POINT_REASON_OPTIONS } from '../i18n/translations';
import { PET_TYPES, DEFAULT_BATTLE_MODE, DEFAULT_MAX_TEAM_SIZE } from '../store/constants';
import { normalizeAppData, applyDecay, getSettingsImpactPreview } from '../store/utils';
import {
  Student, Language, BattleMode, BossRewardTier, LearningCompetency, BossAttackMode,
  PublicNameMode, PublicLeaderboardMode, PetCareMode, ClassGoal,
} from '../store/types';
import { 
  isPenaltyActive, WARNING_THRESHOLD,
  SOLO_BATTLE_FULLNESS_COST, SOLO_BATTLE_WIN_POINTS, SOLO_BATTLE_LOSS_POINTS,
  TEAM_BATTLE_MIN_FULLNESS, TEAM_BATTLE_MIN_FULLNESS_ENABLED,
  TEAM_BATTLE_ATTACKER_FULLNESS_COST, TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_FULLNESS_COST, TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  DEFAULT_BOSS_ATTACK_MAX_TARGETS, DEFAULT_BOSS_ATTACK_DAMAGE, DEFAULT_BOSS_REWARD_TIERS,
  DEFAULT_BOSS_RECOVERY_MINUTES,
  DEFAULT_BOSS_PARTICIPATION_REWARD, DEFAULT_BOSS_IMPROVEMENT_REWARD,
  hasActiveLevelDecreaseCooldown, DEFAULT_SCHOOL_TIME_ZONE, DEFAULT_SCHOOL_WEEKDAYS,
  DEFAULT_DAILY_TASK_MAKEUP_WINDOW_DAYS,
  DEFAULT_DAILY_POSITIVE_POINT_LIMIT, DEFAULT_DAILY_NEGATIVE_POINT_LIMIT,
  DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET,
  DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS, DEFAULT_CATCH_UP_GAP_THRESHOLD,
  DEFAULT_DAILY_CATCH_UP_BONUS,
  getActiveClassGoals, getWeekStartDate, getWeekEndDate,
} from '../gameRules';
import {
  getClassGoalCoverage, getClassGoalProgress, getDailyPointFairnessInsights,
  getWeeklyEducationInsights,
} from '../educationInsights';
import { BossRewardSettings } from './dashboard/BossRewardSettings';
import { PointReasonSettings } from './dashboard/PointReasonSettings';
import { RosterImportPanel } from './dashboard/RosterImportPanel';
import { WorkspaceAccessPanel } from './dashboard/WorkspaceAccessPanel';
import { DashboardRecordsPanel } from './dashboard/DashboardRecordsPanel';
import { DailyTaskCalendarSettings } from './dashboard/DailyTaskCalendarSettings';
import {
  PointFairnessSummary,
  PointGuardrailSettings,
  ParticipationSupportSettings,
} from './dashboard/PointGuardrailPanel';
import {
  AddClassDialog,
  DeleteConfirmationDialog,
  PointAdjustmentDialog,
  type PointAdjustmentTarget,
} from './dashboard/DashboardDialogs';
import { runWorkspaceMutation } from '../auth/workspaceAccess';
import { exportWorkspacePrivacyData } from '../services/backendApi';

const StudentAnalyticsPanel = lazy(() =>
  import('./dashboard/StudentAnalyticsPanel').then((module) => ({
    default: module.StudentAnalyticsPanel,
  })),
);

const DataGovernancePanel = lazy(() =>
  import('./dashboard/DataGovernancePanel').then((module) => ({
    default: module.DataGovernancePanel,
  })),
);

type DashboardSection =
  | 'students'
  | 'rewards'
  | 'activities'
  | 'analytics'
  | 'rules'
  | 'records'
  | 'governance';

type DashboardViewProps = {
  readOnly?: boolean;
  canExportFullData?: boolean;
  canAdministerWorkspace?: boolean;
  flushChanges?: () => Promise<boolean>;
};

const READ_ONLY_MUTATION_ACTIONS = new Set([
  'addClass',
  'addPoints',
  'adjustPointsForStudents',
  'addStudent',
  'addStudentsByName',
  'airdropPoints',
  'decreaseLevel',
  'deleteClass',
  'deleteStudent',
  'disciplineStudent',
  'editStudentName',
  'importData',
  'removeBoss',
  'removePenalty',
  'removeWarning',
  'replacePointReasons',
  'resetSeason',
  'saveMentorDailyFeedback',
  'setDailyTaskExcusedDate',
  'setClassGoal',
  'summonBoss',
  'switchClass',
  'togglePinnedReason',
  'undoLastPointAdjustment',
  'undoLastSafetyAction',
  'updateSettings',
  'warnStudent',
]);

export const DashboardView: React.FC<DashboardViewProps> = ({
  readOnly = false,
  canExportFullData = false,
  canAdministerWorkspace = false,
  flushChanges = async () => true,
}) => {
  const dashboardStore = useStore(
    useShallow((state) => ({
      data: state.data,
      addClass: state.addClass,
      addPoints: state.addPoints,
      adjustPointsForStudents: state.adjustPointsForStudents,
      addStudent: state.addStudent,
      addStudentsByName: state.addStudentsByName,
      airdropPoints: state.airdropPoints,
      decreaseLevel: state.decreaseLevel,
      deleteClass: state.deleteClass,
      deleteStudent: state.deleteStudent,
      disciplineStudent: state.disciplineStudent,
      editStudentName: state.editStudentName,
      importData: state.importData,
      removeBoss: state.removeBoss,
      removePenalty: state.removePenalty,
      removeWarning: state.removeWarning,
      replacePointReasons: state.replacePointReasons,
      resetSeason: state.resetSeason,
      saveMentorDailyFeedback: state.saveMentorDailyFeedback,
      setDailyTaskExcusedDate: state.setDailyTaskExcusedDate,
      setClassGoal: state.setClassGoal,
      showToast: state.showToast,
      summonBoss: state.summonBoss,
      switchClass: state.switchClass,
      togglePinnedReason: state.togglePinnedReason,
      undoAction: state.undoAction,
      undoLastPointAdjustment: state.undoLastPointAdjustment,
      safetyUndoAction: state.safetyUndoAction,
      undoLastSafetyAction: state.undoLastSafetyAction,
      updateSettings: state.updateSettings,
      warnStudent: state.warnStudent,
    })),
  );
  const data = dashboardStore.data;
  const lang = data.settings?.language || 'zh';
  const tLang = translations[lang];
  const store = useMemo(() => {
    if (!readOnly) return dashboardStore;
    return new Proxy(dashboardStore, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (
          typeof property !== 'string' ||
          !READ_ONLY_MUTATION_ACTIONS.has(property) ||
          typeof value !== 'function'
        ) {
          return value;
        }
        return (...args: unknown[]) => runWorkspaceMutation(
          false,
          () => Reflect.apply(value, target, args),
          () => target.showToast(
            lang === 'en'
              ? 'This workspace is read-only for your account.'
              : '目前帳號只能閱讀此工作區。',
            'error',
          ),
        );
      },
    });
  }, [dashboardStore, lang, readOnly]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  const [newStudentName, setNewStudentName] = useState('');
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const [pointAdjustmentTarget, setPointAdjustmentTarget] = useState<PointAdjustmentTarget | null>(null);
  const [dashboardSection, setDashboardSection] = useState<DashboardSection>(
    readOnly ? 'analytics' : 'students',
  );
  const [decayAmount, setDecayAmount] = useState(data.settings?.decayAmount ?? 2);
  const [decayType, setDecayType] = useState<'hourly' | 'daily'>(data.settings?.decayType ?? 'hourly');
  const [inclusiveMode, setInclusiveMode] = useState(data.settings?.inclusiveMode !== false);
  const [pauseDecayOnWeekends, setPauseDecayOnWeekends] = useState(
    data.settings?.pauseDecayOnWeekends !== false,
  );
  const [schoolTimeZone, setSchoolTimeZone] = useState(
    data.settings?.schoolTimeZone ?? DEFAULT_SCHOOL_TIME_ZONE,
  );
  const [schoolWeekdays, setSchoolWeekdays] = useState<number[]>(
    data.settings?.schoolWeekdays ?? [...DEFAULT_SCHOOL_WEEKDAYS],
  );
  const [schoolHolidayDatesText, setSchoolHolidayDatesText] = useState(
    (data.settings?.schoolHolidayDates ?? []).join('\n'),
  );
  const [dailyTaskMakeupWindowDays, setDailyTaskMakeupWindowDays] = useState(
    data.settings?.dailyTaskMakeupWindowDays ?? DEFAULT_DAILY_TASK_MAKEUP_WINDOW_DAYS,
  );
  const [pointGuardrailsEnabled, setPointGuardrailsEnabled] = useState(
    data.settings?.pointGuardrailsEnabled !== false,
  );
  const [dailyPositivePointLimit, setDailyPositivePointLimit] = useState(
    data.settings?.dailyPositivePointLimit ?? DEFAULT_DAILY_POSITIVE_POINT_LIMIT,
  );
  const [dailyNegativePointLimit, setDailyNegativePointLimit] = useState(
    data.settings?.dailyNegativePointLimit ?? DEFAULT_DAILY_NEGATIVE_POINT_LIMIT,
  );
  const [positiveFeedbackRatioTarget, setPositiveFeedbackRatioTarget] = useState(
    data.settings?.positiveFeedbackRatioTarget ?? DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET,
  );
  const [participationSupportEnabled, setParticipationSupportEnabled] = useState(
    data.settings?.participationSupportEnabled !== false,
  );
  const [minimumDailyParticipationPoints, setMinimumDailyParticipationPoints] = useState(
    data.settings?.minimumDailyParticipationPoints ?? DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS,
  );
  const [catchUpGapThreshold, setCatchUpGapThreshold] = useState(
    data.settings?.catchUpGapThreshold ?? DEFAULT_CATCH_UP_GAP_THRESHOLD,
  );
  const [dailyCatchUpBonus, setDailyCatchUpBonus] = useState(
    data.settings?.dailyCatchUpBonus ?? DEFAULT_DAILY_CATCH_UP_BONUS,
  );
  const [petCareMode, setPetCareMode] = useState<PetCareMode>(
    data.settings?.petCareMode === 'death' ? 'death' : 'rest',
  );
  const [publicNameMode, setPublicNameMode] = useState<PublicNameMode>(
    data.settings?.publicNameMode === 'full' ? 'full' : 'masked',
  );
  const [publicLeaderboardMode, setPublicLeaderboardMode] = useState<PublicLeaderboardMode>(
    data.settings?.publicLeaderboardMode === 'rank' ||
    data.settings?.publicLeaderboardMode === 'hidden'
      ? data.settings.publicLeaderboardMode
      : 'growth',
  );
  const [maxPoints, setMaxPoints] = useState(data.settings?.maxPoints ?? 700);
  const [feedCost, setFeedCost] = useState(data.settings?.feedCost ?? 10);
  const [feedGain, setFeedGain] = useState(data.settings?.feedGain ?? 20);
  const [playCost, setPlayCost] = useState(data.settings?.playCost ?? 5);
  const [playGain, setPlayGain] = useState(data.settings?.playGain ?? 15);
  const [battleEnabled, setBattleEnabled] = useState(data.settings?.battleEnabled !== false);
  const [battleMode, setBattleMode] = useState<BattleMode>(data.settings?.battleMode ?? DEFAULT_BATTLE_MODE);
  const [maxTeamSize, setMaxTeamSize] = useState(data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE);
  const [currentLang, setCurrentLang] = useState<Language>(lang);
  const [reviveCost, setReviveCost] = useState(data.settings?.reviveCost ?? 120);
  const [readOnlyClassId, setReadOnlyClassId] = useState(data.currentClassId);

  const defaultBrackets = data.settings?.rankBrackets ?? { diamond: 400, platinum: 300, gold: 200, silver: 100 };
  const [bracketDiamond, setBracketDiamond] = useState(defaultBrackets.diamond);
  const [bracketPlatinum, setBracketPlatinum] = useState(defaultBrackets.platinum);
  const [bracketGold, setBracketGold] = useState(defaultBrackets.gold);
  const [bracketSilver, setBracketSilver] = useState(defaultBrackets.silver);

  const [battleRankPointsWin, setBattleRankPointsWin] = useState(data.settings?.battleRankPointsWin ?? 20);
  const [battleRankPointsLoss, setBattleRankPointsLoss] = useState(data.settings?.battleRankPointsLoss ?? 10);
  const [battleSettingsCategory, setBattleSettingsCategory] = useState<'solo' | 'team'>('solo');
  const [soloBattleAttackerFullnessCost, setSoloBattleAttackerFullnessCost] = useState(
    data.settings?.soloBattleAttackerFullnessCost ?? data.settings?.soloBattleFullnessCost ?? SOLO_BATTLE_FULLNESS_COST,
  );
  const [soloBattleDefenderFullnessCost, setSoloBattleDefenderFullnessCost] = useState(
    data.settings?.soloBattleDefenderFullnessCost ?? data.settings?.soloBattleFullnessCost ?? SOLO_BATTLE_FULLNESS_COST,
  );
  const [soloBattleWinPoints, setSoloBattleWinPoints] = useState(data.settings?.soloBattleWinPoints ?? SOLO_BATTLE_WIN_POINTS);
  const [soloBattleLossPoints, setSoloBattleLossPoints] = useState(data.settings?.soloBattleLossPoints ?? SOLO_BATTLE_LOSS_POINTS);
  const [teamBattleMinFullnessEnabled, setTeamBattleMinFullnessEnabled] = useState(
    data.settings?.teamBattleMinFullnessEnabled ?? TEAM_BATTLE_MIN_FULLNESS_ENABLED,
  );
  const [teamBattleMinFullness, setTeamBattleMinFullness] = useState(
    data.settings?.teamBattleMinFullness ?? TEAM_BATTLE_MIN_FULLNESS,
  );
  const [teamBattleAttackerFullnessCost, setTeamBattleAttackerFullnessCost] = useState(
    data.settings?.teamBattleAttackerFullnessCost ?? TEAM_BATTLE_ATTACKER_FULLNESS_COST,
  );
  const [teamBattleAttackerTeammateFullnessCost, setTeamBattleAttackerTeammateFullnessCost] = useState(
    data.settings?.teamBattleAttackerTeammateFullnessCost ?? TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  );
  const [teamBattleDefenderFullnessCost, setTeamBattleDefenderFullnessCost] = useState(
    data.settings?.teamBattleDefenderFullnessCost ?? TEAM_BATTLE_DEFENDER_FULLNESS_COST,
  );
  const [teamBattleDefenderTeammateFullnessCost, setTeamBattleDefenderTeammateFullnessCost] = useState(
    data.settings?.teamBattleDefenderTeammateFullnessCost ?? TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  );
  const [bossAttackMaxTargets, setBossAttackMaxTargets] = useState(
    data.settings?.bossAttackMaxTargets ?? DEFAULT_BOSS_ATTACK_MAX_TARGETS,
  );
  const [bossAttackDamage, setBossAttackDamage] = useState(
    data.settings?.bossAttackDamage ?? DEFAULT_BOSS_ATTACK_DAMAGE,
  );
  const [bossAttackMode, setBossAttackMode] = useState<BossAttackMode>(
    data.settings?.bossAttackMode ?? 'recoverable',
  );
  const [bossRecoveryMinutes, setBossRecoveryMinutes] = useState(
    data.settings?.bossRecoveryMinutes ?? DEFAULT_BOSS_RECOVERY_MINUTES,
  );
  const [enableSeasonResetRewards, setEnableSeasonResetRewards] = useState(data.settings?.enableSeasonResetRewards ?? false);

  const defaultRewards = data.settings?.seasonResetRewards ?? { diamond: 500, platinum: 400, gold: 300, silver: 200, bronze: 100 };
  const [rewardDiamond, setRewardDiamond] = useState(defaultRewards.diamond);
  const [rewardPlatinum, setRewardPlatinum] = useState(defaultRewards.platinum);
  const [rewardGold, setRewardGold] = useState(defaultRewards.gold);
  const [rewardSilver, setRewardSilver] = useState(defaultRewards.silver);
  const [rewardBronze, setRewardBronze] = useState(defaultRewards.bronze);

  const [selectedReasons, setSelectedReasons] = useState<Record<string, string>>({});
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [showAddClass, setShowAddClass] = useState(false);
  const [classToDelete, setClassToDelete] = useState<string | null>(null);

  const [bossNameInput, setBossNameInput] = useState('');
  const [bossHpInput, setBossHpInput] = useState(1000);
  const [bossRewardTiers, setBossRewardTiers] = useState<BossRewardTier[]>(() =>
    DEFAULT_BOSS_REWARD_TIERS.map((tier) => ({ ...tier })),
  );
  const [bossParticipationPoints, setBossParticipationPoints] = useState(
    DEFAULT_BOSS_PARTICIPATION_REWARD.points,
  );
  const [bossParticipationRankPoints, setBossParticipationRankPoints] = useState(
    DEFAULT_BOSS_PARTICIPATION_REWARD.rankPoints,
  );
  const [bossParticipationHappiness, setBossParticipationHappiness] = useState(
    DEFAULT_BOSS_PARTICIPATION_REWARD.happiness,
  );
  const [bossImprovementPoints, setBossImprovementPoints] = useState(
    DEFAULT_BOSS_IMPROVEMENT_REWARD.points,
  );
  const [bossImprovementRankPoints, setBossImprovementRankPoints] = useState(
    DEFAULT_BOSS_IMPROVEMENT_REWARD.rankPoints,
  );
  const [bossImprovementHappiness, setBossImprovementHappiness] = useState(
    DEFAULT_BOSS_IMPROVEMENT_REWARD.happiness,
  );
  const [classGoalTitle, setClassGoalTitle] = useState('');
  const [classGoalCompetency, setClassGoalCompetency] =
    useState<LearningCompetency>('collaboration');
  const [classGoalTarget, setClassGoalTarget] = useState(20);
  const [editingClassGoalId, setEditingClassGoalId] = useState<string | null>(null);
  const selectedClassId = readOnly ? readOnlyClassId : data.currentClassId;
  const currentClass = data.classes.find((c: any) => c.id === selectedClassId);
  const currentStudents = useMemo(() => currentClass?.students || [], [currentClass]);
  const competencyLabels = useMemo<Record<LearningCompetency, string>>(() => ({
    participation: tLang.competencyParticipation,
    collaboration: tLang.competencyCollaboration,
    selfManagement: tLang.competencySelfManagement,
    assignmentQuality: tLang.competencyAssignmentQuality,
    growth: tLang.competencyGrowth,
  }), [tLang]);
  const weeklyInsights = useMemo(
    () => getWeeklyEducationInsights(
      currentStudents,
      Date.now(),
      7,
      currentClass?.learningEvidenceRecords ?? [],
    ),
    [currentClass?.learningEvidenceRecords, currentStudents],
  );
  const dailyPointFairness = useMemo(
    () => getDailyPointFairnessInsights(
      currentStudents,
      Date.now(),
      data.settings?.schoolTimeZone ?? DEFAULT_SCHOOL_TIME_ZONE,
      data.settings?.positiveFeedbackRatioTarget ?? DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET,
      data.settings?.catchUpGapThreshold ?? DEFAULT_CATCH_UP_GAP_THRESHOLD,
      data.settings?.dailyCatchUpBonus ?? DEFAULT_DAILY_CATCH_UP_BONUS,
    ),
    [
      currentStudents,
      data.settings?.positiveFeedbackRatioTarget,
      data.settings?.catchUpGapThreshold,
      data.settings?.dailyCatchUpBonus,
      data.settings?.schoolTimeZone,
    ],
  );
  const currentStudentIds = useMemo(
    () => new Set(currentStudents.map((student: Student) => student.id)),
    [currentStudents],
  );
  const selectedStudentIdsInClass = useMemo(
    () => selectedStudentIds.filter((studentId) => currentStudentIds.has(studentId)),
    [currentStudentIds, selectedStudentIds],
  );
  const selectedStudentIdSet = useMemo(
    () => new Set(selectedStudentIdsInClass),
    [selectedStudentIdsInClass],
  );
  const allStudentsSelected =
    currentStudents.length > 0 && selectedStudentIdsInClass.length === currentStudents.length;
  const someStudentsSelected =
    selectedStudentIdsInClass.length > 0 && !allStudentsSelected;
  const classGoalNow = useMemo(() => Date.now(), [currentClass?.id]);
  const classGoalWeekStart = getWeekStartDate(
    classGoalNow,
    data.settings?.schoolTimeZone,
  );
  const classGoalWeekEnd = getWeekEndDate(
    classGoalNow,
    data.settings?.schoolTimeZone,
  );
  const activeClassGoals = useMemo(
    () => getActiveClassGoals(
      currentClass?.classGoals,
      classGoalNow,
      data.settings?.schoolTimeZone,
    ),
    [classGoalNow, currentClass?.classGoals, data.settings?.schoolTimeZone],
  );
  const formatGoalWeekDate = (dateKey: string) =>
    new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString(
      lang === 'en' ? 'en-US' : 'zh-TW',
      { month: 'numeric', day: 'numeric', timeZone: 'UTC' },
    );
  const classGoalWeekLabel = tLang.classGoalWeekRange
    .replace('{start}', formatGoalWeekDate(classGoalWeekStart))
    .replace('{end}', formatGoalWeekDate(classGoalWeekEnd));
  const archivedClassGoalCount = Math.max(
    0,
    (currentClass?.classGoals?.length ?? 0) - activeClassGoals.length,
  );
  const classGoalMetrics = useMemo(
    () => activeClassGoals.map((goal: ClassGoal) => ({
      goal,
      progress: getClassGoalProgress(
        currentStudents,
        goal,
        currentClass?.learningEvidenceRecords ?? [],
      ),
      coverage: getClassGoalCoverage(
        currentStudents,
        goal,
        currentClass?.learningEvidenceRecords ?? [],
      ),
    })),
    [activeClassGoals, currentClass?.learningEvidenceRecords, currentStudents],
  );
  const settingsPreviewNow = useMemo(() => Date.now(), [currentClass?.id]);
  const settingsImpactPreview = useMemo(
    () => getSettingsImpactPreview(
      currentStudents,
      {
        decayAmount: Math.max(0, Number(decayAmount)),
        decayType,
        pauseDecayOnWeekends: inclusiveMode || pauseDecayOnWeekends,
        feedCost: Math.max(0, Number(feedCost)),
        feedGain: Math.max(1, Number(feedGain)),
      },
      weeklyInsights.positiveCount,
      settingsPreviewNow,
    ),
    [
      currentStudents,
      decayAmount,
      decayType,
      feedCost,
      feedGain,
      inclusiveMode,
      pauseDecayOnWeekends,
      settingsPreviewNow,
      weeklyInsights.positiveCount,
    ],
  );

  useEffect(() => {
    if (readOnly && dashboardSection !== 'analytics' && dashboardSection !== 'records') {
      setDashboardSection('analytics');
    }
  }, [dashboardSection, readOnly]);

  useEffect(() => {
    if (
      !readOnly &&
      !canAdministerWorkspace &&
      (dashboardSection === 'rules' || dashboardSection === 'governance')
    ) {
      setDashboardSection('students');
    }
  }, [canAdministerWorkspace, dashboardSection, readOnly]);

  useEffect(() => {
    if (!readOnly) return;
    if (!data.classes.some((classData) => classData.id === readOnlyClassId)) {
      setReadOnlyClassId(data.currentClassId || data.classes[0]?.id || '');
    }
  }, [data.classes, data.currentClassId, readOnly, readOnlyClassId]);

  useEffect(() => {
    setEditingClassGoalId(null);
    setClassGoalTitle('');
    setClassGoalCompetency('collaboration');
    setClassGoalTarget(20);
  }, [currentClass?.id]);
  useEffect(() => {
    setSelectedStudentIds([]);
    setPointAdjustmentTarget(null);
  }, [currentClass?.id]);
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someStudentsSelected;
    }
  }, [someStudentsSelected]);
  const formatRecordTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString(lang === 'zh' ? 'zh-TW' : 'en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  const requestSafetyAction = (
    actionLabel: string,
    studentName: string,
    applyAction: (reason: string) => void,
  ) => {
    const enteredReason = window.prompt(
      lang === 'en'
        ? `Required reason for ${actionLabel.toLocaleLowerCase()} (${studentName})`
        : `請填寫${actionLabel}理由（${studentName}）`,
    );
    if (enteredReason === null) return;
    const reason = enteredReason.trim();
    if (!reason) {
      store.showToast(lang === 'en' ? 'A reason is required.' : '理由不可留白。', 'error');
      return;
    }
    const confirmed = window.confirm(
      lang === 'en'
        ? `Confirm ${actionLabel.toLocaleLowerCase()} for ${studentName}?\nReason: ${reason}`
        : `確定對 ${studentName} 執行${actionLabel}？\n理由：${reason}`,
    );
    if (confirmed) applyAction(reason);
  };

  const pinnedReasonIds = data.settings?.pinnedReasonIds ?? [];
  const recentReasonIds = data.settings?.recentReasonIds ?? [];
  const configuredPointReasons =
    data.settings?.pointReasonOptions?.length
      ? data.settings.pointReasonOptions
      : POINT_REASON_OPTIONS;
  const feedbackReasonHistory = data.settings?.feedbackReasonHistory ?? [];
  const pointReasonOptions = useMemo(
    () => configuredPointReasons
      .map((option, originalIndex) => ({
        ...option,
        label: option.labels[currentLang] ?? option.labels.zh,
        displayLabel: `${option.labels[currentLang] ?? option.labels.zh} ${option.amount > 0 ? '+' : ''}${option.amount}`,
        isPinned: pinnedReasonIds.includes(option.id),
        isRecent: recentReasonIds.includes(option.id),
        originalIndex,
      }))
      .sort((left, right) => {
        const leftGroup = left.isPinned ? 0 : left.isRecent ? 1 : 2;
        const rightGroup = right.isPinned ? 0 : right.isRecent ? 1 : 2;
        if (leftGroup !== rightGroup) return leftGroup - rightGroup;
        if (left.isPinned && right.isPinned) {
          return pinnedReasonIds.indexOf(left.id) - pinnedReasonIds.indexOf(right.id);
        }
        if (left.isRecent && right.isRecent) {
          return recentReasonIds.indexOf(left.id) - recentReasonIds.indexOf(right.id);
        }
        return left.originalIndex - right.originalIndex;
      }),
    [configuredPointReasons, currentLang, pinnedReasonIds, recentReasonIds],
  );
  const defaultPointReasonId =
    pointReasonOptions[0]?.id ?? configuredPointReasons[0]?.id ?? POINT_REASON_OPTIONS[0].id;
  const guideStudentItems =
    lang === 'en'
      ? [
          'Students use points for feeding, upgrades, revives, and gacha; importing a backup preserves saved pet status and restarts its decay clock.',
          'Students can build teams from 2 to 6 members depending on the current system setting.',
          'Battle mode is controlled in System Settings and can run as solo only, team only, or automatic fallback.',
          'Team battles use a weighted support formula, so larger teams help without multiplying total power linearly.',
          'Winning as a full team grants an exclusive bonus of +10 points and +6 mood to each winning member.',
          petCareMode === 'death'
            ? 'Free reroll milestones are consumed at levels 2, 4, 6, then 8. Dead pets must be revived before acting again.'
            : 'Free reroll milestones are consumed at levels 2, 4, 6, then 8. At zero fullness, pets rest until they are fed.',
        ]
      : [
          '學生可用積分餵食、升級、復活與扭蛋；匯入備份會完整保留寵物狀態，並從匯入時間重新計算衰減。',
          '雙方互相選定隊友後會形成隊伍；若兩邊都有可出戰隊友，對戰會自動切換成隊伍模式。',
          '隊伍對戰採用主將全額、隊友加權的戰力公式，隊友能支援但不會直接把總戰力翻倍。',
          '完整雙人隊伍獲勝時，每位獲勝成員都會獲得隊伍專屬獎勵：+10 積分、+6 心情。',
          petCareMode === 'death'
            ? '免費重抽會依序在 2、4、6、8 級觸發；寵物死亡後必須先復活，才能再次行動。'
            : '免費重抽會依序在 2、4、6、8 級觸發；飽食度歸零時寵物會休息，餵食後即可恢復。',
        ];
  const guideTeacherItems =
    lang === 'en'
      ? [
          'Fixed reason menus keep point changes more consistent, and every quick/manual adjustment is written to the point log.',
          'Warnings still stack to 3. Auto penalties apply a 24-hour weakened status; formal discipline applies a 48-hour weakened status.',
          'The record panel lets mentors switch between discipline history and point-adjustment history.',
          'The team leaderboard ranks paired students by combined RP, then by win rate and average level.',
          'Team balance is intentionally softer than solo battles, so team mode adds coordination value instead of pure snowballing.',
        ]
      : [
          '固定原因選單可讓加減分更一致，所有快速加減分與手動調整都會寫入加減分記錄。',
          '警告累積到第 3 次會自動觸發處罰並進入 24 小時虛弱；正式處罰則直接進入 48 小時虛弱。',
          '記錄面板可切換查看處罰記錄與加減分記錄，方便導師回頭追蹤。',
          '隊伍排行榜會以隊伍總 RP 排序，再比較勝率與平均等級，方便觀察組隊成效。',
          '隊伍戰的平衡刻意比單人戰保守，重點是鼓勵合作，而不是讓高等級組合直接滾雪球。',
        ];

  const handleSaveSettings = () => {
    store.updateSettings({
      decayAmount: Number(decayAmount),
      decayType,
      inclusiveMode,
      pauseDecayOnWeekends,
      schoolTimeZone,
      schoolWeekdays,
      schoolHolidayDates: schoolHolidayDatesText.split(/[\s,]+/).filter(Boolean),
      dailyTaskMakeupWindowDays: Number(dailyTaskMakeupWindowDays),
      pointGuardrailsEnabled,
      dailyPositivePointLimit: Number(dailyPositivePointLimit),
      dailyNegativePointLimit: Number(dailyNegativePointLimit),
      positiveFeedbackRatioTarget: Number(positiveFeedbackRatioTarget),
      participationSupportEnabled,
      minimumDailyParticipationPoints: Number(minimumDailyParticipationPoints),
      catchUpGapThreshold: Number(catchUpGapThreshold),
      dailyCatchUpBonus: Number(dailyCatchUpBonus),
      petCareMode,
      publicNameMode,
      publicLeaderboardMode,
      language: currentLang,
      feedCost: Number(feedCost),
      feedGain: Number(feedGain),
      playCost: Number(playCost),
      playGain: Number(playGain),
      battleEnabled,
      battleMode,
      maxTeamSize: Number(maxTeamSize),
      maxPoints: Number(maxPoints),
      reviveCost: Number(reviveCost),
      rankBrackets: {
        diamond: Number(bracketDiamond),
        platinum: Number(bracketPlatinum),
        gold: Number(bracketGold),
        silver: Number(bracketSilver),
      },
      battleRankPointsWin: Number(battleRankPointsWin),
      battleRankPointsLoss: Number(battleRankPointsLoss),
      soloBattleAttackerFullnessCost: Number(soloBattleAttackerFullnessCost),
      soloBattleDefenderFullnessCost: Number(soloBattleDefenderFullnessCost),
      soloBattleWinPoints: Number(soloBattleWinPoints),
      soloBattleLossPoints: Number(soloBattleLossPoints),
      teamBattleMinFullnessEnabled,
      teamBattleMinFullness: Number(teamBattleMinFullness),
      teamBattleAttackerFullnessCost: Number(teamBattleAttackerFullnessCost),
      teamBattleAttackerTeammateFullnessCost: Number(teamBattleAttackerTeammateFullnessCost),
      teamBattleDefenderFullnessCost: Number(teamBattleDefenderFullnessCost),
      teamBattleDefenderTeammateFullnessCost: Number(teamBattleDefenderTeammateFullnessCost),
      bossAttackMaxTargets: Number(bossAttackMaxTargets),
      bossAttackDamage: Number(bossAttackDamage),
      bossAttackMode,
      bossRecoveryMinutes: Number(bossRecoveryMinutes),
      enableSeasonResetRewards,
      seasonResetRewards: {
        diamond: Number(rewardDiamond),
        platinum: Number(rewardPlatinum),
        gold: Number(rewardGold),
        silver: Number(rewardSilver),
        bronze: Number(rewardBronze),
      }
    });
  };

  const handleAddStudent = () => {
    if (!newStudentName.trim()) return;
    const newStudent: Student = {
      id: Date.now().toString(),
      name: newStudentName.trim(),
      points: 0,
      pet: {
        type: 'egg',
        fullness: 80,
        happiness: 80,
        level: 1
      },
      stats: { wins: 0, losses: 0 },
      rankPoints: 0,
      warningPoints: 0,
      nextUpgradeGachaLevel: 2,
      penaltyStatus: undefined,
      disciplineRecords: [],
      pointAdjustmentRecords: [],
      bossRewardRecords: [],
      dailyProgress: { streak: 0 },
      teamId: undefined,
      badges: []
    };
    store.addStudent(newStudent);
    setNewStudentName('');
  };

  const exportData = async () => {
    if (!canExportFullData) return;
    try {
      const snapshot = await exportWorkspacePrivacyData();
      if (!snapshot.activeWorkspace.state) {
        throw new Error('Workspace state is unavailable');
      }
      const blob = new Blob(
        [JSON.stringify(snapshot.activeWorkspace.state, null, 2)],
        { type: 'application/json' },
      );
      const dataUrl = URL.createObjectURL(blob);
      const linkElement = document.createElement('a');
      linkElement.href = dataUrl;
      linkElement.download = `epet_workspace_export_${snapshot.exportedAt.slice(0, 10)}.json`;
      linkElement.click();
      window.setTimeout(() => URL.revokeObjectURL(dataUrl), 0);
    } catch {
      store.showToast(tLang.exportFailed, 'error');
    }
  };

  const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target?.result as string);
        const hasSupportedShape = Array.isArray(importedData?.classes) || Array.isArray(importedData?.students);

        if (hasSupportedShape) {
          store.importData(importedData);
          store.showToast(tLang.importSuccess, 'success');
        } else {
          store.showToast(tLang.invalidData, 'error');
        }
      } catch (error) {
        store.showToast(tLang.invalidData, 'error');
      }
    };
    reader.onerror = () => {
      store.showToast(tLang.fileReadFailed, 'error');
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const applySettingsPreset = (
    preset: 'lowCompetition' | 'cooperative' | 'shortCampaign',
    name: string,
  ) => {
    if (preset === 'lowCompetition') {
      setInclusiveMode(true);
      setBattleMode('both');
      setBattleRankPointsWin(8);
      setBattleRankPointsLoss(0);
      setSoloBattleWinPoints(30);
      setSoloBattleLossPoints(0);
      setBossAttackMode('recoverable');
      setBossAttackDamage(12);
      setDecayType('daily');
      setDecayAmount(2);
      setPauseDecayOnWeekends(true);
      setPetCareMode('rest');
      setPublicNameMode('masked');
      setPublicLeaderboardMode('growth');
    } else if (preset === 'cooperative') {
      setInclusiveMode(true);
      setBattleMode('team');
      setMaxTeamSize(4);
      setBattleRankPointsWin(5);
      setBattleRankPointsLoss(0);
      setTeamBattleMinFullnessEnabled(false);
      setTeamBattleAttackerFullnessCost(10);
      setTeamBattleAttackerTeammateFullnessCost(8);
      setTeamBattleDefenderFullnessCost(10);
      setTeamBattleDefenderTeammateFullnessCost(8);
      setBossAttackMode('recoverable');
      setBossAttackDamage(16);
      setPauseDecayOnWeekends(true);
      setPetCareMode('rest');
      setPublicNameMode('masked');
      setPublicLeaderboardMode('growth');
    } else {
      setInclusiveMode(true);
      setDecayType('daily');
      setDecayAmount(5);
      setMaxPoints(400);
      setFeedCost(8);
      setFeedGain(25);
      setPlayCost(4);
      setPlayGain(20);
      setBattleMode('both');
      setBossAttackMode('recoverable');
      setBossAttackDamage(20);
      setPauseDecayOnWeekends(true);
      setPetCareMode('rest');
      setPublicNameMode('masked');
      setPublicLeaderboardMode('growth');
    }

    setParticipationSupportEnabled(true);
    setMinimumDailyParticipationPoints(20);
    setCatchUpGapThreshold(preset === 'lowCompetition' ? 75 : 100);
    setDailyCatchUpBonus(preset === 'lowCompetition' ? 15 : 10);

    store.showToast(tLang.presetApplied.replace('{name}', name), 'success');
  };

  const handleSaveClassGoal = () => {
    if (!classGoalTitle.trim()) return;
    store.setClassGoal({
      title: classGoalTitle.trim(),
      competency: classGoalCompetency,
      targetCount: Math.max(1, Number(classGoalTarget)),
    }, editingClassGoalId ?? undefined);
    setEditingClassGoalId(null);
    setClassGoalTitle('');
    setClassGoalCompetency('collaboration');
    setClassGoalTarget(20);
  };

  const handleEditClassGoal = (goal: ClassGoal) => {
    setEditingClassGoalId(goal.id);
    setClassGoalTitle(goal.title);
    setClassGoalCompetency(goal.competency);
    setClassGoalTarget(goal.targetCount);
  };

  const handleClearClassGoal = (goalId: string) => {
    store.setClassGoal(null, goalId);
    if (editingClassGoalId !== goalId) return;
    setEditingClassGoalId(null);
    setClassGoalTitle('');
    setClassGoalCompetency('collaboration');
    setClassGoalTarget(20);
  };

  const handleInclusiveModeToggle = () => {
    setInclusiveMode((enabled) => {
      const nextEnabled = !enabled;
      if (nextEnabled) {
        setPauseDecayOnWeekends(true);
        setPetCareMode('rest');
        setPublicNameMode('masked');
        setPublicLeaderboardMode('growth');
        setBossAttackMode('recoverable');
      }
      return nextEnabled;
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-slate-50 min-h-full">
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{tLang.dashboard}</h1>
          <p className="mt-2 text-sm text-slate-600">{tLang.dashboardDesc}</p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
          {canExportFullData && (
            <button
              type="button"
              onClick={() => void exportData()}
              className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
              <Download className="h-4 w-4 mr-2" />
              {tLang.exportData}
            </button>
          )}
          {canAdministerWorkspace && (
            <>
              <input
                type="file"
                accept=".json"
                className="hidden"
                ref={fileInputRef}
                onChange={importData}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
              >
                <Upload className="h-4 w-4 mr-2" />
                {tLang.importData}
              </button>
            </>
          )}
        </div>
      </div>

      <div
        className="mb-6 grid grid-cols-2 gap-1 border-b border-slate-200 sm:flex"
        role="tablist"
        aria-label={tLang.dashboard}
      >
        {([
          ['students', tLang.dashboardTabStudents, Users],
          ['rewards', tLang.dashboardTabRewards, Gift],
          ['activities', tLang.dashboardTabActivities, Crosshair],
          ['analytics', tLang.dashboardTabAnalytics, BarChart3],
          ['rules', tLang.dashboardTabRules, Settings],
          ['records', tLang.dashboardTabRecords, BookOpen],
          ['governance', lang === 'en' ? 'Data governance' : '資料治理', Shield],
        ] as const)
          .filter(([section]) => {
            if (readOnly) return section === 'analytics' || section === 'records';
            return canAdministerWorkspace || (
              section !== 'rules' && section !== 'governance'
            );
          })
          .map(([section, label, Icon]) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={dashboardSection === section}
            onClick={() => setDashboardSection(section)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 border-b-2 px-4 py-2 text-sm font-bold transition-colors ${
              dashboardSection === section
                ? 'border-indigo-600 bg-white text-indigo-700'
                : 'border-transparent text-slate-500 hover:bg-white hover:text-slate-800'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {readOnly && (
        <div
          className="mb-6 border-l-4 border-sky-500 bg-sky-50 px-4 py-4 text-sky-950"
          role="status"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-black">
                {lang === 'en' ? 'Read-only workspace' : '唯讀工作區'}
              </p>
              <p className="mt-1 text-xs leading-5 text-sky-800">
                {lang === 'en'
                  ? 'You can review analytics, records, and saved A4 reports. Editing controls are unavailable.'
                  : '你可查看個人分析、紀錄與已儲存的 A4 報告；編輯功能已停用。'}
              </p>
            </div>
            <label className="text-xs font-bold text-sky-900">
              {lang === 'en' ? 'Class to review' : '查看班級'}
              <select
                value={selectedClassId}
                onChange={(event) => setReadOnlyClassId(event.target.value)}
                className="mt-1 block min-h-10 min-w-52 rounded-md border border-sky-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {data.classes.map((classData) => (
                  <option key={classData.id} value={classData.id}>{classData.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {!readOnly && store.undoAction && (
        <div
          className="mb-6 flex items-center gap-3 border-l-4 border-indigo-500 bg-indigo-50 px-4 py-3 text-indigo-950"
          role="status"
        >
          <Undo2 className="h-5 w-5 shrink-0 text-indigo-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{store.undoAction.label}</p>
            <p className="mt-0.5 text-xs text-indigo-700">{tLang.undoAvailable}</p>
          </div>
          <button
            type="button"
            onClick={store.undoLastPointAdjustment}
            className="shrink-0 rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-sm font-bold text-indigo-700 hover:bg-indigo-100"
          >
            {tLang.undo}
          </button>
        </div>
      )}

      {!readOnly && store.safetyUndoAction && (
        <div
          className="mb-6 flex items-center gap-3 border-l-4 border-rose-500 bg-rose-50 px-4 py-3 text-rose-950"
          role="status"
          aria-live="assertive"
        >
          <Undo2 className="h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{store.safetyUndoAction.label}</p>
            <p className="mt-0.5 text-xs text-rose-800">
              {lang === 'en'
                ? 'Undo is available for 10 seconds. The original event stays in the ledger and a reversal is added.'
                : '10 秒內可撤銷；原始事件會保留，系統另新增補償紀錄。'}
            </p>
          </div>
          <button
            type="button"
            onClick={store.undoLastSafetyAction}
            aria-label={lang === 'en' ? 'Undo formal action' : '撤銷正式操作'}
            className="shrink-0 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-bold text-rose-700 hover:bg-rose-100"
          >
            {tLang.undo}
          </button>
        </div>
      )}

      {dashboardSection === 'analytics' && (
        <Suspense
          fallback={(
            <div className="flex min-h-64 items-center justify-center text-sm font-medium text-slate-500">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              {tLang.loading}
            </div>
          )}
        >
          <StudentAnalyticsPanel readOnly={readOnly} classId={selectedClassId} />
        </Suspense>
      )}

      {dashboardSection === 'governance' && canAdministerWorkspace && (
        <Suspense
          fallback={(
            <div className="flex min-h-64 items-center justify-center text-sm font-medium text-slate-500">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              {tLang.loading}
            </div>
          )}
        >
          <DataGovernancePanel
            classes={data.classes}
            language={lang}
            flushChanges={flushChanges}
          />
        </Suspense>
      )}

      {/* Class Management */}
      <div className={`${dashboardSection === 'students' ? '' : 'hidden'} bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mb-6 p-5`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex-1 w-full sm:max-w-xs">
            <label htmlFor="classSelect" className="block text-sm font-medium text-slate-700 mb-1">{tLang.classManagement}</label>
            <select
              id="classSelect"
              value={data.currentClassId}
              onChange={(e) => store.switchClass(e.target.value)}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            >
              {data.classes.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {canAdministerWorkspace && (
            <div className="flex space-x-3 mt-4 sm:mt-0 items-end">
              <button
                onClick={() => setShowAddClass(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
              >
                <Plus className="h-4 w-4 mr-2" />
                {tLang.addClass}
              </button>
              <button
                onClick={() => {
                  if (window.confirm(tLang.resetSeason + '?')) {
                    store.resetSeason();
                  }
                }}
                className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-amber-600 bg-white hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-colors"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {tLang.resetSeason}
              </button>
              <button
                onClick={() => setClassToDelete(data.currentClassId)}
                disabled={data.classes.length <= 1}
                className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-red-600 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {tLang.deleteClass}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add Student Form */}
      {!readOnly && (
      <div className={`${dashboardSection === 'students' ? '' : 'hidden'} bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mb-6 p-5`}>
        <h3 className="text-lg font-medium text-slate-900 mb-4 flex items-center">
          <Users className="h-5 w-5 mr-2 text-indigo-500" />
          {tLang.addStudent}
        </h3>
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label htmlFor="studentName" className="block text-sm font-medium text-slate-700 mb-1">{tLang.studentName}</label>
            <input 
              type="text" 
              id="studentName"
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddStudent()}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              placeholder={tLang.enterName}
            />
          </div>
          <button
            onClick={handleAddStudent}
            disabled={!newStudentName.trim()}
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="h-4 w-4 mr-2" />
            {tLang.add}
          </button>
        </div>
        <RosterImportPanel
          lang={lang}
          students={currentStudents}
          onImport={store.addStudentsByName}
        />
      </div>
      )}

      {/* Students Table */}
      <div className={`${dashboardSection === 'rewards' ? '' : 'hidden'} bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200`}>
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{tLang.pointManagement}</h3>
            <p className="mt-1 text-xs text-slate-500">{tLang.airdropHint}</p>
          </div>
          <button
            onClick={() => setPointAdjustmentTarget({ kind: 'class', count: currentStudents.length })}
            disabled={currentStudents.length === 0}
            className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Gift className="mr-2 h-4 w-4" />
            {tLang.airdropAll}
          </button>
        </div>
        <PointFairnessSummary
          lang={lang}
          insights={dailyPointFairness}
          guardrailsEnabled={data.settings?.pointGuardrailsEnabled !== false}
          participationSupportEnabled={data.settings?.participationSupportEnabled !== false}
        />
        <PointReasonSettings
          options={pointReasonOptions}
          configuredReasons={configuredPointReasons}
          competencyLabels={competencyLabels}
          labels={tLang}
          editable={canAdministerWorkspace}
          onTogglePinned={store.togglePinnedReason}
          onSave={store.replacePointReasons}
        />
        {selectedStudentIdsInClass.length > 0 && (
          <div className="flex flex-col gap-3 border-b border-indigo-200 bg-indigo-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-bold text-indigo-950">
              {tLang.selectedStudents.replace(
                '{count}',
                selectedStudentIdsInClass.length.toString(),
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedStudentIds([])}
                className="rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
              >
                {tLang.clearSelection}
              </button>
              <button
                type="button"
                onClick={() => setPointAdjustmentTarget({
                  kind: 'batch',
                  ids: selectedStudentIdsInClass,
                  count: selectedStudentIdsInClass.length,
                })}
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-indigo-700"
              >
                <Edit2 className="mr-2 h-4 w-4" />
                {tLang.batchAdjust}
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="w-12 px-4 py-3 text-center">
                  <input
                    ref={selectAllCheckboxRef}
                    type="checkbox"
                    checked={allStudentsSelected}
                    aria-checked={someStudentsSelected ? 'mixed' : allStudentsSelected}
                    aria-label={tLang.selectAllStudents}
                    onChange={() => setSelectedStudentIds(
                      allStudentsSelected
                        ? []
                        : currentStudents.map((student: Student) => student.id),
                    )}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.studentName}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.petType}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.level}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.points}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.petFullness}</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.actions}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {currentStudents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                    {tLang.noStudents}
                  </td>
                </tr>
              ) : (
                currentStudents.map((student: any) => {
                  const petConfig = PET_TYPES.find(p => p.id === student.pet.type) || PET_TYPES[0];
                  const PetIcon = petConfig.icon;
                  const warningPoints = student.warningPoints ?? 0;
                  const activePenalty = isPenaltyActive(student.penaltyStatus);
                  const levelDecreaseOnCooldown = hasActiveLevelDecreaseCooldown(student.disciplineRecords);
                  
                  return (
                    <tr
                      key={student.id}
                      className={`transition-colors ${
                        selectedStudentIdSet.has(student.id)
                          ? 'bg-indigo-50/70 hover:bg-indigo-50'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedStudentIdSet.has(student.id)}
                          aria-label={`${tLang.batchAdjust}: ${student.name}`}
                          onChange={() => setSelectedStudentIds((current) =>
                            current.includes(student.id)
                              ? current.filter((studentId) => studentId !== student.id)
                              : [...current, student.id],
                          )}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-slate-900">{student.name}</div>
                          <button
                            onClick={() => {
                              const newName = window.prompt(lang === 'en' ? 'Enter new name' : '輸入新姓名', student.name);
                              if (newName !== null) {
                                store.editStudentName(student.id, newName);
                              }
                            }}
                            className="p-1 text-slate-400 hover:text-indigo-600 rounded-md transition-colors"
                            title={lang === 'en' ? 'Edit name' : '修改姓名'}
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            warningPoints > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'
                          }`}>
                            <AlertCircle className="mr-1 h-3 w-3" />
                            {tLang.warningPoints} {warningPoints}/{WARNING_THRESHOLD}
                          </span>
                          {warningPoints > 0 && (
                            <button
                               onClick={() => store.removeWarning(student.id)}
                               className="inline-flex items-center rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-300"
                               title={lang === 'en' ? 'Remove Warning' : '消除警告'}
                            >
                               <Minus className="h-3 w-3" />
                            </button>
                          )}
                          {activePenalty && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                              <Zap className="mr-1 h-3 w-3" />
                              {tLang.penaltyStatus}
                            </span>
                          )}
                          {activePenalty && (
                            <button
                               onClick={() => store.removePenalty(student.id)}
                               className="inline-flex items-center rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-300"
                               title={lang === 'en' ? 'Remove Penalty' : '解除虛弱'}
                            >
                               <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        {activePenalty && (
                          <div className="mt-1 text-[11px] text-amber-700">
                            {tLang.penaltyUntil.replace('{time}', formatRecordTime(student.penaltyStatus.until))}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-slate-600">
                          <PetIcon className="h-4 w-4 mr-2 text-slate-400" />
                          {petNames[lang][petConfig.id as keyof typeof petNames['zh']]}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-amber-600">Lv. {student.pet.level || 1}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-indigo-600">{student.points} / {data.settings?.maxPoints ?? 700}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="flex items-center">
                            <div className="w-full bg-slate-200 rounded-full h-2.5 mr-2 max-w-[100px]">
                              <div 
                                className={`h-2.5 rounded-full ${
                                  student.pet.fullness > 70 ? 'bg-green-500' : 
                                  student.pet.fullness >= 30 ? 'bg-yellow-400' : 'bg-red-500'
                                }`} 
                                style={{ width: `${student.pet.fullness}%` }}
                              ></div>
                            </div>
                            <span className="text-sm text-slate-600">{student.pet.fullness}/100</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{tLang.happiness}: {student.pet.happiness ?? 80}/100</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end items-center space-x-3">
                          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                            <select
                              value={selectedReasons[student.id] ?? defaultPointReasonId}
                              onChange={(e) =>
                                setSelectedReasons((prev) => ({
                                  ...prev,
                                  [student.id]: e.target.value,
                                }))
                              }
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                              title={tLang.fixedReason ?? '固定原因'}
                            >
                              {pointReasonOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.isPinned
                                    ? `${tLang.pinnedReason} · ${option.displayLabel}`
                                    : option.isRecent
                                      ? `${tLang.recentReason} · ${option.displayLabel}`
                                      : option.displayLabel}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                const selectedReasonId = selectedReasons[student.id] ?? defaultPointReasonId;
                                const selectedReason = pointReasonOptions.find((option) => option.id === selectedReasonId) ?? pointReasonOptions[0];
                                store.addPoints(student.id, selectedReason.amount, 'quick', {
                                  id: selectedReason.id,
                                  label: selectedReason.label,
                                  competency: selectedReason.competency,
                                });
                              }}
                              disabled={
                                (() => {
                                  const selectedReasonId = selectedReasons[student.id] ?? defaultPointReasonId;
                                  const selectedReason = pointReasonOptions.find((option) => option.id === selectedReasonId) ?? pointReasonOptions[0];
                                  return selectedReason.amount < 0 && student.points < Math.abs(selectedReason.amount);
                                })()
                              }
                              className="inline-flex items-center rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                              title={tLang.applyReason ?? '套用'}
                            >
                              {tLang.applyReason ?? '套用'}
                            </button>
                            <button
                              onClick={() => setPointAdjustmentTarget({ kind: 'student', id: student.id, name: student.name })}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-indigo-700 hover:bg-indigo-200 transition-colors"
                              title={tLang.manualAdjust}
                            >
                              <Edit2 className="h-3 w-3" /> {tLang.manual}
                            </button>
                          </div>

                          {/* Decrease Level */}
                          <button
                            type="button"
                            onClick={() => {
                              requestSafetyAction(
                                tLang.decreaseLevel,
                                student.name,
                                (reason) => store.decreaseLevel(student.id, reason),
                              );
                            }}
                            disabled={
                              (student.pet.level || 1) <= 1 ||
                              levelDecreaseOnCooldown ||
                              Boolean(store.safetyUndoAction)
                            }
                            aria-label={`${tLang.decreaseLevel}：${student.name}`}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={levelDecreaseOnCooldown
                              ? (lang === 'en' ? 'Level decrease is on a 24-hour cooldown' : '降級操作尚在 24 小時冷卻期')
                              : tLang.decreaseLevel}
                          >
                            <ChevronsDown className="h-4 w-4" aria-hidden="true" />
                          </button>

                          <div className="flex space-x-1 bg-amber-50 p-1 rounded-md border border-amber-100">
                            <button
                              type="button"
                              onClick={() => store.warnStudent(student.id)}
                              aria-label={`${tLang.issueWarning}：${student.name}`}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-amber-700 hover:bg-amber-200 transition-colors"
                              title={tLang.issueWarning}
                            >
                              <AlertCircle className="h-3 w-3" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                requestSafetyAction(
                                  tLang.discipline,
                                  student.name,
                                  (reason) => store.disciplineStudent(student.id, reason),
                                );
                              }}
                              disabled={activePenalty || Boolean(store.safetyUndoAction)}
                              aria-label={`${tLang.discipline}：${student.name}`}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-red-700 hover:bg-red-100 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                              title={tLang.discipline}
                            >
                              <Shield className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </div>

                          {/* Delete */}
                          <button
                            onClick={() => setStudentToDelete(student.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            title={tLang.deleteStudent}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DashboardRecordsPanel
        classId={currentClass?.id}
        competencyLabels={competencyLabels}
        lang={lang}
        learningEvidence={currentClass?.learningEvidenceRecords ?? []}
        onSaveMentorDailyFeedback={store.saveMentorDailyFeedback}
        schoolTimeZone={data.settings?.schoolTimeZone}
        students={currentStudents}
        tLang={tLang}
        visible={dashboardSection === 'records'}
      />

      <section className={`${dashboardSection === 'activities' ? '' : 'hidden'} border border-emerald-200 bg-white p-5 shadow-sm`}>
        <div className="mb-5 flex flex-col gap-2 border-b border-emerald-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="flex items-center text-lg font-semibold text-slate-900">
              <Target className="mr-2 h-5 w-5 text-emerald-600" />
              {tLang.classGoal}
            </h3>
            <p className="mt-1 text-sm text-slate-500">{tLang.classGoalHint}</p>
          </div>
          <div className="text-sm font-bold text-emerald-700">
            <p>{classGoalWeekLabel}</p>
            <p className="mt-1 text-xs font-medium text-emerald-600">
              {tLang.classGoalCount.replace('{current}', classGoalMetrics.length.toString())}
            </p>
          </div>
        </div>

        {classGoalMetrics.length === 0 && (
          <div className="mb-5 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
            <p className="font-bold">{tLang.classGoalNoGoal}</p>
            <p className="mt-1 text-xs text-amber-800">{classGoalWeekLabel}</p>
          </div>
        )}

        {archivedClassGoalCount > 0 && (
          <p className="mb-4 text-xs text-slate-500">
            {tLang.classGoalArchivedCount.replace('{count}', archivedClassGoalCount.toString())}
          </p>
        )}

        {classGoalMetrics.length > 0 && (
          <div className="mb-5 divide-y divide-emerald-100 border-y border-emerald-100">
            {classGoalMetrics.map(({ goal, progress, coverage }) => {
              const completed = progress >= goal.targetCount;
              const progressPercent = Math.min(100, Math.round((progress / goal.targetCount) * 100));
              return (
                <div key={goal.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.6fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{goal.title}</p>
                    <p className="mt-1 text-xs font-medium text-emerald-700">
                      {competencyLabels[goal.competency]}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-600">
                      <span>
                        {completed
                          ? tLang.classGoalCompleted
                          : tLang.classGoalProgress
                              .replace('{current}', progress.toString())
                              .replace('{target}', goal.targetCount.toString())}
                      </span>
                      <span>{progressPercent}%</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-emerald-100">
                      <div
                        className="h-full rounded-full bg-emerald-600"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {tLang.classGoalCoverage
                        .replace('{current}', coverage.studentsReached.toString())
                        .replace('{total}', coverage.totalStudents.toString())}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 md:justify-end">
                    <button
                      type="button"
                      onClick={() => handleEditClassGoal(goal)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-emerald-50 hover:text-emerald-700"
                      title={tLang.editClassGoal}
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleClearClassGoal(goal.id)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                      title={tLang.clearClassGoal}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(180px,0.8fr)_minmax(150px,0.5fr)]">
          <label className="text-sm font-medium text-slate-700">
            {tLang.classGoalTitle}
            <input
              type="text"
              value={classGoalTitle}
              onChange={(event) => setClassGoalTitle(event.target.value)}
              placeholder={tLang.classGoalTitlePlaceholder}
              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {tLang.classGoalCompetency}
            <select
              value={classGoalCompetency}
              onChange={(event) => setClassGoalCompetency(event.target.value as LearningCompetency)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
            >
              {(Object.keys(competencyLabels) as LearningCompetency[]).map((competency) => (
                <option key={competency} value={competency}>{competencyLabels[competency]}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            {tLang.classGoalTarget}
            <input
              type="number"
              min="1"
              value={classGoalTarget}
              onChange={(event) => setClassGoalTarget(Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">{tLang.classGoalTargetHint}</p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSaveClassGoal}
            disabled={
              !classGoalTitle.trim() ||
              classGoalTarget < 1 ||
              (!editingClassGoalId && classGoalMetrics.length >= 3)
            }
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {editingClassGoalId
              ? <Save className="mr-2 h-4 w-4" />
              : <Plus className="mr-2 h-4 w-4" />}
            {editingClassGoalId ? tLang.updateClassGoal : tLang.addClassGoal}
          </button>
          {editingClassGoalId && (
            <button
              type="button"
              onClick={() => {
                setEditingClassGoalId(null);
                setClassGoalTitle('');
                setClassGoalCompetency('collaboration');
                setClassGoalTarget(20);
              }}
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <X className="mr-2 h-4 w-4" />
              {tLang.cancel}
            </button>
          )}
        </div>
      </section>

      <div className={`${dashboardSection === 'activities' ? '' : 'hidden'} mt-6 bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 p-5`}>
        <h3 className="text-lg font-medium text-slate-900 mb-4 flex items-center">
          <BookOpen className="h-5 w-5 mr-2 text-emerald-500" />
          {tLang.guideTitle}
        </h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="mb-3 flex items-center text-sm font-bold text-emerald-800">
              <Star className="mr-2 h-4 w-4" />
              {tLang.guideStudentTitle}
            </div>
            <ul className="space-y-2 text-sm text-emerald-900">
              {guideStudentItems.map((item) => (
                <li key={item} className="flex items-start">
                  <span className="mt-1 mr-2 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
            <div className="mb-3 flex items-center text-sm font-bold text-indigo-800">
              <Shield className="mr-2 h-4 w-4" />
              {tLang.guideTeacherTitle}
            </div>
            <ul className="space-y-2 text-sm text-indigo-900">
              {guideTeacherItems.map((item) => (
                <li key={item} className="flex items-start">
                  <span className="mt-1 mr-2 h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Boss Management */}
      <div className={`${dashboardSection === 'activities' ? '' : 'hidden'} bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mt-6 p-5`}>
        <h3 className="text-lg font-medium text-amber-900 mb-4 flex items-center">
          <Skull className="h-5 w-5 mr-2 text-rose-500" />
          {tLang.bossManagement ?? '魔王副本管理'}
        </h3>
        {currentClass?.activeBoss?.isActive ? (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex-1 w-full">
              <h4 className="text-lg font-bold text-rose-800 flex items-center mb-2">
                {currentClass.activeBoss.name}
              </h4>
              <div className="w-full bg-slate-200 rounded-full h-4 relative overflow-hidden">
                <div 
                  className="bg-rose-500 h-4 rounded-full transition-all duration-300" 
                  style={{ width: `${Math.max(0, (currentClass.activeBoss.currentHp / currentClass.activeBoss.maxHp) * 100)}%` }}
                ></div>
                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white shadow-black drop-shadow-md">
                  {currentClass.activeBoss.currentHp} / {currentClass.activeBoss.maxHp}
                </div>
              </div>
            </div>
            <button
              onClick={() => store.removeBoss()}
              className="bg-white text-rose-600 border border-rose-200 px-4 py-2 rounded-md font-medium hover:bg-rose-100 transition-colors shrink-0"
            >
              {tLang.removeBoss ?? '撤退魔王'}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{tLang.bossName}</label>
                <input
                  type="text"
                  value={bossNameInput}
                  onChange={(e) => setBossNameInput(e.target.value)}
                  placeholder={tLang.enterBossName}
                  className="w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{tLang.bossHp}</label>
                <input
                  type="number"
                  min="1"
                  value={bossHpInput}
                  onChange={(e) => setBossHpInput(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="border-l-4 border-emerald-500 bg-emerald-50 p-4">
                <h4 className="text-sm font-bold text-emerald-900">{tLang.bossParticipationReward}</h4>
                <p className="mt-1 text-xs text-emerald-800">{tLang.bossParticipationRewardHint}</p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardPoints}
                    <input
                      type="number"
                      min="0"
                      value={bossParticipationPoints}
                      onChange={(event) => setBossParticipationPoints(Number(event.target.value))}
                      className="mt-1 w-full rounded-md border border-emerald-200 bg-white p-2 text-sm"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardRankPoints}
                    <input
                      type="number"
                      min="0"
                      value={bossParticipationRankPoints}
                      onChange={(event) => setBossParticipationRankPoints(Number(event.target.value))}
                      className="mt-1 w-full rounded-md border border-emerald-200 bg-white p-2 text-sm"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardHappiness}
                    <input
                      type="number"
                      min="0"
                      value={bossParticipationHappiness}
                      onChange={(event) => setBossParticipationHappiness(Number(event.target.value))}
                      className="mt-1 w-full rounded-md border border-emerald-200 bg-white p-2 text-sm"
                    />
                  </label>
                </div>
              </div>
              <div className="border-l-4 border-sky-500 bg-sky-50 p-4">
                <h4 className="text-sm font-bold text-sky-900">{tLang.bossImprovementReward}</h4>
                <p className="mt-1 text-xs text-sky-800">{tLang.bossImprovementRewardHint}</p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardPoints}
                    <input
                      type="number"
                      min="0"
                      value={bossImprovementPoints}
                      onChange={(event) => setBossImprovementPoints(Number(event.target.value))}
                      className="mt-1 w-full rounded-md border border-sky-200 bg-white p-2 text-sm"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardRankPoints}
                    <input
                      type="number"
                      min="0"
                      value={bossImprovementRankPoints}
                      onChange={(event) => setBossImprovementRankPoints(Number(event.target.value))}
                      className="mt-1 w-full rounded-md border border-sky-200 bg-white p-2 text-sm"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    {tLang.rewardHappiness}
                    <input
                      type="number"
                      min="0"
                      value={bossImprovementHappiness}
                      onChange={(event) => setBossImprovementHappiness(Number(event.target.value))}
                      className="mt-1 w-full rounded-md border border-sky-200 bg-white p-2 text-sm"
                    />
                  </label>
                </div>
              </div>
            </div>

            <BossRewardSettings
              tiers={bossRewardTiers}
              onChange={setBossRewardTiers}
              studentCount={currentStudents.length}
              labels={tLang}
            />

            <button
              onClick={() => {
                store.summonBoss(
                  bossNameInput,
                  bossHpInput,
                  bossRewardTiers,
                  {
                    points: Math.max(0, Number(bossParticipationPoints)),
                    happiness: Math.max(0, Number(bossParticipationHappiness)),
                    rankPoints: Math.max(0, Number(bossParticipationRankPoints)),
                  },
                  {
                    points: Math.max(0, Number(bossImprovementPoints)),
                    happiness: Math.max(0, Number(bossImprovementHappiness)),
                    rankPoints: Math.max(0, Number(bossImprovementRankPoints)),
                  },
                );
                setBossNameInput('');
              }}
              disabled={!bossNameInput.trim() || bossRewardTiers.length === 0}
              className="w-full rounded-md bg-rose-600 px-4 py-2 font-medium text-white transition-colors hover:bg-rose-700 disabled:bg-slate-300 sm:w-auto"
            >
              {tLang.summonBoss}
            </button>
          </div>
        )}
      </div>

      {/* System Settings */}
      <div className={`${dashboardSection === 'rules' ? '' : 'hidden'} bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mt-6 p-5`}>
        <h3 className="text-lg font-medium text-slate-900 mb-6 flex items-center">
          <Settings className="h-5 w-5 mr-2 text-indigo-500" />
          {tLang.systemSettings}
        </h3>

        {canAdministerWorkspace && (
          <WorkspaceAccessPanel
            classes={data.classes.map((classroom) => ({
              id: classroom.id,
              name: classroom.name,
            }))}
            language={lang}
          />
        )}

        <DailyTaskCalendarSettings
          lang={lang}
          timeZone={schoolTimeZone}
          onTimeZoneChange={setSchoolTimeZone}
          schoolWeekdays={schoolWeekdays}
          onSchoolWeekdaysChange={setSchoolWeekdays}
          holidayDatesText={schoolHolidayDatesText}
          onHolidayDatesTextChange={setSchoolHolidayDatesText}
          makeupWindowDays={dailyTaskMakeupWindowDays}
          onMakeupWindowDaysChange={setDailyTaskMakeupWindowDays}
          students={currentStudents}
          onSetExcusedDate={store.setDailyTaskExcusedDate}
        />

        <PointGuardrailSettings
          lang={lang}
          enabled={pointGuardrailsEnabled}
          onEnabledChange={setPointGuardrailsEnabled}
          dailyPositiveLimit={dailyPositivePointLimit}
          onDailyPositiveLimitChange={setDailyPositivePointLimit}
          dailyNegativeLimit={dailyNegativePointLimit}
          onDailyNegativeLimitChange={setDailyNegativePointLimit}
          positiveRatioTarget={positiveFeedbackRatioTarget}
          onPositiveRatioTargetChange={setPositiveFeedbackRatioTarget}
        />

        <ParticipationSupportSettings
          lang={lang}
          enabled={participationSupportEnabled}
          onEnabledChange={setParticipationSupportEnabled}
          minimumDailyParticipationPoints={minimumDailyParticipationPoints}
          onMinimumDailyParticipationPointsChange={setMinimumDailyParticipationPoints}
          catchUpGapThreshold={catchUpGapThreshold}
          onCatchUpGapThresholdChange={setCatchUpGapThreshold}
          dailyCatchUpBonus={dailyCatchUpBonus}
          onDailyCatchUpBonusChange={setDailyCatchUpBonus}
        />

        <div className="mb-6 grid gap-5 border-y border-slate-200 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
          <div>
            <h4 className="text-sm font-bold text-slate-800">{tLang.settingsPresets}</h4>
            <p className="mt-1 text-xs text-slate-500">{tLang.settingsPresetsHint}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ['lowCompetition', tLang.presetLowCompetition],
                ['cooperative', tLang.presetCooperative],
                ['shortCampaign', tLang.presetShortCampaign],
              ].map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applySettingsPreset(
                    preset as 'lowCompetition' | 'cooperative' | 'shortCampaign',
                    label,
                  )}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-800">{tLang.settingsImpact}</h4>
            <div className="mt-3 grid grid-cols-2 gap-px bg-slate-200">
              <div className="bg-white p-3">
                <p className="text-xs text-slate-500">{tLang.currentAverageFullness}</p>
                <p className="mt-1 text-xl font-black text-slate-800">
                  {currentStudents.length > 0
                    ? `${settingsImpactPreview.currentAverageFullness}%`
                    : '-'}
                </p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xs text-slate-500">{tLang.projectedWeeklyFullness}</p>
                <p className="mt-1 text-xl font-black text-rose-700">
                  {currentStudents.length > 0
                    ? `${settingsImpactPreview.projectedAverageFullness}%`
                    : '-'}
                </p>
                {currentStudents.length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    {tLang.sevenDayDecayTotal.replace(
                      '{value}',
                      settingsImpactPreview.sevenDayDecay.toString(),
                    )}
                  </p>
                )}
              </div>
              <div className="bg-white p-3">
                <p className="text-xs text-slate-500">{tLang.upgradePositiveActions}</p>
                <p className="mt-1 text-xl font-black text-emerald-700">
                  {currentStudents.length > 0 ? settingsImpactPreview.estimatedUpgradeActions : '-'}
                </p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xs text-slate-500">{tLang.estimatedUpgradeDays}</p>
                <p className="mt-1 text-xl font-black text-indigo-700">
                  {currentStudents.length > 0
                    ? tLang.daysValue.replace(
                        '{value}',
                        settingsImpactPreview.estimatedUpgradeDays.toString(),
                      )
                    : '-'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">{tLang.settingsImpactHint}</p>
          </div>
        </div>

        <div className="mb-6 border-y border-slate-200 py-5">
          <div>
            <h4 className="flex items-center text-sm font-bold text-slate-800">
              <Shield className="mr-2 h-4 w-4 text-emerald-600" />
              {tLang.educationSafetySettings}
            </h4>
            <p className="mt-1 text-xs text-slate-500">{tLang.educationSafetyHint}</p>
          </div>
          <div className="mt-4 flex items-start justify-between gap-4 border-l-4 border-emerald-400 bg-emerald-50 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-emerald-950">{tLang.inclusiveMode}</p>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-emerald-800">
                {tLang.inclusiveModeHint}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={inclusiveMode}
              aria-label={tLang.inclusiveMode}
              onClick={handleInclusiveModeToggle}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center justify-start rounded-full p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
                inclusiveMode ? 'bg-emerald-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`block h-5 w-5 shrink-0 rounded-full bg-white shadow-sm transition-transform ${
                  inclusiveMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          {inclusiveMode && (
            <p className="mt-2 text-xs font-medium text-emerald-700">
              {tLang.inclusiveModeLockedHint}
            </p>
          )}
          <fieldset
            disabled={inclusiveMode}
            className={`mt-4 grid gap-4 transition-opacity md:grid-cols-2 xl:grid-cols-4 ${
              inclusiveMode ? 'opacity-50' : ''
            }`}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="publicNameMode" className="text-sm font-medium text-slate-700">
                {tLang.publicNameMode}
              </label>
              <select
                id="publicNameMode"
                value={publicNameMode}
                onChange={(event) => setPublicNameMode(event.target.value as PublicNameMode)}
                className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
              >
                <option value="masked">{tLang.publicNameMasked}</option>
                <option value="full">{tLang.publicNameFull}</option>
              </select>
              <p className="text-xs text-slate-500">{tLang.publicNameHint}</p>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="publicLeaderboardMode" className="text-sm font-medium text-slate-700">
                {tLang.publicLeaderboardMode}
              </label>
              <select
                id="publicLeaderboardMode"
                value={publicLeaderboardMode}
                onChange={(event) =>
                  setPublicLeaderboardMode(event.target.value as PublicLeaderboardMode)
                }
                className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
              >
                <option value="growth">{tLang.leaderboardGrowth}</option>
                <option value="rank">{tLang.leaderboardRank}</option>
                <option value="hidden">{tLang.leaderboardHidden}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="petCareMode" className="text-sm font-medium text-slate-700">
                {tLang.petCareMode}
              </label>
              <select
                id="petCareMode"
                value={petCareMode}
                onChange={(event) => setPetCareMode(event.target.value as PetCareMode)}
                className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
              >
                <option value="rest">{tLang.petCareRest}</option>
                <option value="death">{tLang.petCareDeath}</option>
              </select>
              <p className="text-xs text-slate-500">
                {petCareMode === 'rest' ? tLang.petCareRestHint : tLang.petCareDeathHint}
              </p>
            </div>
            <label className="flex min-h-[84px] cursor-pointer items-start gap-3 border-l-4 border-emerald-300 bg-emerald-50 p-3">
              <input
                type="checkbox"
                checked={pauseDecayOnWeekends}
                onChange={(event) => setPauseDecayOnWeekends(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                <span className="block text-sm font-bold text-emerald-950">
                  {tLang.pauseDecayOnWeekends}
                </span>
                <span className="mt-1 block text-xs text-emerald-800">
                  {tLang.pauseDecayOnWeekendsHint}
                </span>
              </span>
            </label>
          </fieldset>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          {/* 基本規則 */}
          <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
              {lang === 'en' ? 'General Rules' : '基本規則'}
            </h4>
            <div className="flex flex-col gap-1">
              <label htmlFor="language" className="text-sm font-medium text-slate-700">{tLang.language}</label>
              <select
                id="language"
                value={currentLang}
                onChange={(e) => setCurrentLang(e.target.value as Language)}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="maxPoints" className="text-sm font-medium text-slate-700">{tLang.maxPoints ?? '總積分上限'}</label>
              <input
                type="number"
                id="maxPoints"
                min="0"
                value={maxPoints}
                onChange={(e) => setMaxPoints(Number(e.target.value))}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="decayType" className="text-sm font-medium text-slate-700">{tLang.decayFrequency}</label>
              <select
                id="decayType"
                value={decayType}
                onChange={(e) => setDecayType(e.target.value as 'hourly' | 'daily')}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              >
                <option value="hourly">{tLang.hourly}</option>
                <option value="daily">{tLang.daily}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="decayAmount" className="text-sm font-medium text-slate-700">{tLang.decayAmount}</label>
              <input 
                type="number" 
                id="decayAmount"
                min="0"
                value={decayAmount}
                onChange={(e) => setDecayAmount(Number(e.target.value))}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              />
            </div>
          </div>

          {/* 互動設定 */}
          <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
              {lang === 'en' ? 'Economy & Interactions' : '經濟與互動數值'}
            </h4>
            <div className="flex flex-col gap-1">
              <label htmlFor="feedCost" className="text-sm font-medium text-slate-700">{tLang.feedCost}</label>
              <input type="number" id="feedCost" min="1" value={feedCost} onChange={(e) => setFeedCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="feedGain" className="text-sm font-medium text-slate-700">{tLang.feedGain ?? '餵食回復飽食度'}</label>
              <input type="number" id="feedGain" min="1" value={feedGain} onChange={(e) => setFeedGain(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="playCost" className="text-sm font-medium text-slate-700">{tLang.playCost ?? '玩耍所需積分'}</label>
              <input type="number" id="playCost" min="1" value={playCost} onChange={(e) => setPlayCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="playGain" className="text-sm font-medium text-slate-700">{tLang.playGain ?? '玩耍回復心情'}</label>
              <input type="number" id="playGain" min="1" value={playGain} onChange={(e) => setPlayGain(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            {petCareMode === 'death' && (
              <div className="flex flex-col gap-1">
                <label htmlFor="reviveCost" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Revive Cost' : '復活需要積分'}</label>
                <input type="number" id="reviveCost" min="0" value={reviveCost} onChange={(e) => setReviveCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
            )}
          </div>

          {/* 魔王設定 */}
          <div className="space-y-4 bg-rose-50 p-4 rounded-xl border border-rose-200">
            <h4 className="text-sm font-bold text-rose-800 pb-2 border-b border-rose-200 flex items-center">
              <Crosshair className="mr-2 h-4 w-4" />
              {tLang.bossAttackSettings}
            </h4>
            <div className="flex flex-col gap-1">
              <label htmlFor="bossAttackMode" className="text-sm font-medium text-slate-700">
                {tLang.bossAttackMode}
              </label>
              <select
                id="bossAttackMode"
                value={bossAttackMode}
                onChange={(event) => setBossAttackMode(event.target.value as BossAttackMode)}
                disabled={inclusiveMode}
                className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="recoverable">{tLang.bossAttackRecoverable}</option>
                <option value="shared">{tLang.bossAttackShared}</option>
                <option value="random">{tLang.bossAttackRandom}</option>
              </select>
              <p className="text-xs text-slate-500">
                {bossAttackMode === 'recoverable'
                  ? tLang.bossAttackRecoverableHint
                  : bossAttackMode === 'shared'
                    ? tLang.bossAttackSharedHint
                    : tLang.bossAttackRandomHint}
              </p>
            </div>
            {bossAttackMode === 'random' && (
              <div className="flex flex-col gap-1">
              <label htmlFor="bossAttackMaxTargets" className="text-sm font-medium text-slate-700">{tLang.bossAttackMaxTargets}</label>
              <select
                id="bossAttackMaxTargets"
                value={bossAttackMaxTargets}
                onChange={(e) => setBossAttackMaxTargets(Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500"
              >
                {[0, 1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>{tLang.bossTargetCountOption.replace('{count}', count.toString())}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">{tLang.bossAttackMaxTargetsHint}</p>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="bossAttackDamage" className="text-sm font-medium text-slate-700">
                {bossAttackMode === 'recoverable'
                  ? tLang.bossShieldImpact
                  : bossAttackMode === 'shared'
                    ? tLang.bossSharedDamage
                    : tLang.bossAttackDamage}
              </label>
              <input
                type="number"
                id="bossAttackDamage"
                min="0"
                value={bossAttackDamage}
                onChange={(e) => setBossAttackDamage(Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500"
              />
              <p className="text-xs text-slate-500">
                {bossAttackMode === 'recoverable'
                  ? tLang.bossAttackRecoverableHint
                  : bossAttackMode === 'shared'
                    ? tLang.bossAttackSharedHint
                    : tLang.bossAttackDamageHint}
              </p>
            </div>
            {bossAttackMode === 'recoverable' ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="bossRecoveryMinutes" className="text-sm font-medium text-slate-700">
                  {tLang.bossRecoveryMinutes}
                </label>
                <input
                  type="number"
                  id="bossRecoveryMinutes"
                  min="1"
                  max="120"
                  value={bossRecoveryMinutes}
                  onChange={(event) => setBossRecoveryMinutes(Number(event.target.value))}
                  className="w-full rounded-md border border-sky-200 bg-white p-2 text-sm shadow-sm focus:border-sky-500 focus:ring-sky-500"
                />
                <p className="text-xs text-sky-700">{tLang.bossRecoveryMinutesHint}</p>
              </div>
            ) : (
              <p className="border-l-4 border-amber-400 bg-amber-50 p-3 text-xs font-medium text-amber-800">
                {tLang.bossPersistentImpactWarning}
              </p>
            )}
          </div>

          {/* 對戰設定 */}
          <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
              {lang === 'en' ? 'Battle Settings' : '對戰與組隊設定'}
            </h4>
            <div className="flex items-start justify-between gap-4 rounded-md border border-slate-200 bg-white p-3">
              <div>
                <p className="text-sm font-bold text-slate-800">{tLang.battleEnabled}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{tLang.battleEnabledHint}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={battleEnabled}
                aria-label={tLang.battleEnabled}
                onClick={() => setBattleEnabled((enabled) => !enabled)}
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center justify-start rounded-full p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                  battleEnabled ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`block h-5 w-5 shrink-0 rounded-full bg-white shadow-sm transition-transform ${
                    battleEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <fieldset
              disabled={!battleEnabled}
              className={`space-y-4 transition-opacity ${battleEnabled ? '' : 'opacity-45'}`}
            >
            <div className="flex flex-col gap-1">
              <label htmlFor="battleMode" className="text-sm font-medium text-slate-700">
                {lang === 'en' ? 'Battle Mode' : '支援對戰模式'}
              </label>
              <select
                id="battleMode"
                value={battleMode}
                onChange={(e) => setBattleMode(e.target.value as BattleMode)}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              >
                <option value="both">{lang === 'en' ? 'Solo + Team' : '個人賽 + 隊伍賽'}</option>
                <option value="solo">{lang === 'en' ? 'Solo Only' : '僅個人賽'}</option>
                <option value="team">{lang === 'en' ? 'Team Only' : '僅隊伍賽'}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="maxTeamSize" className="text-sm font-medium text-slate-700">
                {lang === 'en' ? 'Max Team Size' : '隊伍上限人數'}
              </label>
              <input
                type="number"
                id="maxTeamSize"
                min="2"
                max="6"
                value={maxTeamSize}
                onChange={(e) => setMaxTeamSize(Number(e.target.value))}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="battleRankPointsWin" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Battle Win RP' : '對戰獲勝加分 (RP)'}</label>
              <input type="number" id="battleRankPointsWin" min="0" value={battleRankPointsWin} onChange={(e) => setBattleRankPointsWin(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="battleRankPointsLoss" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Battle Loss RP' : '落敗扣分 (RP)'}</label>
              <input type="number" id="battleRankPointsLoss" min="0" value={battleRankPointsLoss} onChange={(e) => setBattleRankPointsLoss(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="pt-2 border-t border-slate-200 mt-2 space-y-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="battleSettingsCategory" className="text-sm font-medium text-slate-700">
                  {lang === 'en' ? 'Rules to Adjust' : '調整賽制'}
                </label>
                <select
                  id="battleSettingsCategory"
                  value={battleSettingsCategory}
                  onChange={(e) => setBattleSettingsCategory(e.target.value as 'solo' | 'team')}
                  className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                >
                  <option value="solo">{lang === 'en' ? 'Solo Battle Rules' : '個人賽飽食度機制'}</option>
                  <option value="team">{lang === 'en' ? 'Team Battle Rules' : '隊伍賽飽食度機制'}</option>
                </select>
              </div>

              {battleSettingsCategory === 'solo' ? (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500">
                    {lang === 'en'
                      ? 'Solo battle costs are based on whether the student starts or receives the challenge.'
                      : '個人賽依學生是發起挑戰或接受挑戰，分別套用飽食度消耗。'}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="soloBattleAttackerFullnessCost" className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Attacker Fullness Cost' : '進攻方消耗飽食度'}
                      </label>
                      <input
                        type="number"
                        id="soloBattleAttackerFullnessCost"
                        min="0"
                        value={soloBattleAttackerFullnessCost}
                        onChange={(e) => setSoloBattleAttackerFullnessCost(Number(e.target.value))}
                        className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="soloBattleDefenderFullnessCost" className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Defender Fullness Cost' : '防守方消耗飽食度'}
                      </label>
                      <input
                        type="number"
                        id="soloBattleDefenderFullnessCost"
                        min="0"
                        value={soloBattleDefenderFullnessCost}
                        onChange={(e) => setSoloBattleDefenderFullnessCost(Number(e.target.value))}
                        className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="soloBattleWinPoints" className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Solo Win Points' : '個人賽勝利積分'}
                      </label>
                      <input
                        type="number"
                        id="soloBattleWinPoints"
                        min="0"
                        value={soloBattleWinPoints}
                        onChange={(e) => setSoloBattleWinPoints(Number(e.target.value))}
                        className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="soloBattleLossPoints" className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Solo Loss Penalty' : '個人賽失敗扣分'}
                      </label>
                      <input
                        type="number"
                        id="soloBattleLossPoints"
                        min="0"
                        value={soloBattleLossPoints}
                        onChange={(e) => setSoloBattleLossPoints(Number(e.target.value))}
                        className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500">
                    {lang === 'en'
                      ? 'Team battle costs are based on each participant role, independent of the match result.'
                      : '隊伍賽依每位成員在本場的角色扣除飽食度，不受勝敗結果影響。'}
                  </p>
                  <div className="space-y-3">
                    <h5 className="text-xs font-bold text-slate-600">{lang === 'en' ? 'Attacking Team' : '攻擊方'}</h5>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="teamBattleAttackerFullnessCost" className="text-sm font-medium text-slate-700">
                          {lang === 'en' ? 'Initiator Fullness Cost' : '發動攻擊者消耗飽食度'}
                        </label>
                        <input type="number" id="teamBattleAttackerFullnessCost" min="0" value={teamBattleAttackerFullnessCost} onChange={(e) => setTeamBattleAttackerFullnessCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="teamBattleAttackerTeammateFullnessCost" className="text-sm font-medium text-slate-700">
                          {lang === 'en' ? 'Attacking Teammate Cost' : '攻擊方隊友消耗飽食度'}
                        </label>
                        <input type="number" id="teamBattleAttackerTeammateFullnessCost" min="0" value={teamBattleAttackerTeammateFullnessCost} onChange={(e) => setTeamBattleAttackerTeammateFullnessCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 border-t border-slate-200 pt-3">
                    <h5 className="text-xs font-bold text-slate-600">{lang === 'en' ? 'Defending Team' : '防守方'}</h5>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="teamBattleDefenderFullnessCost" className="text-sm font-medium text-slate-700">
                          {lang === 'en' ? 'Target Fullness Cost' : '被攻擊者消耗飽食度'}
                        </label>
                        <input type="number" id="teamBattleDefenderFullnessCost" min="0" value={teamBattleDefenderFullnessCost} onChange={(e) => setTeamBattleDefenderFullnessCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="teamBattleDefenderTeammateFullnessCost" className="text-sm font-medium text-slate-700">
                          {lang === 'en' ? 'Defending Teammate Cost' : '防守方隊友消耗飽食度'}
                        </label>
                        <input type="number" id="teamBattleDefenderTeammateFullnessCost" min="0" value={teamBattleDefenderTeammateFullnessCost} onChange={(e) => setTeamBattleDefenderTeammateFullnessCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 border-t border-slate-200 pt-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={teamBattleMinFullnessEnabled}
                        onChange={(e) => setTeamBattleMinFullnessEnabled(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Enable team minimum fullness gate' : '隊伍賽啟用最低飽食度限制'}
                      </span>
                    </label>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="teamBattleMinFullness" className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Team Minimum Fullness' : '隊伍賽最低飽食度'}
                      </label>
                      <input
                        type="number"
                        id="teamBattleMinFullness"
                        min="0"
                        value={teamBattleMinFullness}
                        disabled={!teamBattleMinFullnessEnabled}
                        onChange={(e) => setTeamBattleMinFullness(Number(e.target.value))}
                        className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400 sm:text-sm border p-2"
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      {teamBattleMinFullnessEnabled
                        ? (lang === 'en'
                            ? 'Only members meeting this fullness value can enter team battles.'
                            : '只有達到此飽食度的成員才能參與隊伍賽。')
                        : (lang === 'en'
                            ? 'When disabled, team battles ignore the minimum fullness requirement.'
                            : '關閉後，隊伍賽將忽略最低飽食度限制。')}
                    </p>
                  </div>
                </div>
              )}
            </div>
            </fieldset>
          </div>

          {/* 段位與賽季設定 */}
          <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
              {lang === 'en' ? 'Rank & Season Settings' : '段位與賽季設定'}
            </h4>
            
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Rank Thresholds' : '排位門檻 (RP)'}</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.diamond}</span><input type="number" value={bracketDiamond} onChange={(e) => setBracketDiamond(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
                <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.platinum}</span><input type="number" value={bracketPlatinum} onChange={(e) => setBracketPlatinum(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
                <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.gold}</span><input type="number" value={bracketGold} onChange={(e) => setBracketGold(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
                <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.silver}</span><input type="number" value={bracketSilver} onChange={(e) => setBracketSilver(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 mt-2">
              <label className="flex items-center gap-2 mb-2">
                <input type="checkbox" checked={enableSeasonResetRewards} onChange={(e) => setEnableSeasonResetRewards(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                <span className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Enable Season Reset Rewards' : '啟用賽季結算獎勵'}</span>
              </label>
              
              {enableSeasonResetRewards && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.diamond}</span><input type="number" value={rewardDiamond} onChange={(e) => setRewardDiamond(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
                  <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.platinum}</span><input type="number" value={rewardPlatinum} onChange={(e) => setRewardPlatinum(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
                  <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.gold}</span><input type="number" value={rewardGold} onChange={(e) => setRewardGold(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
                  <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.silver}</span><input type="number" value={rewardSilver} onChange={(e) => setRewardSilver(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
                  <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.bronze}</span><input type="number" value={rewardBronze} onChange={(e) => setRewardBronze(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-5">
          <button
            onClick={handleSaveSettings}
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <Save className="h-4 w-4 mr-2" />
            {tLang.saveSettings}
          </button>
        </div>
      </div>

      <AddClassDialog
        open={showAddClass}
        onAdd={(name) => {
          store.addClass(name);
          setShowAddClass(false);
        }}
        onClose={() => setShowAddClass(false)}
        tLang={tLang}
      />

      <DeleteConfirmationDialog
        cancelLabel={tLang.cancel}
        confirmLabel={tLang.delete}
        message={tLang.deleteClassWarning.replace(
          '{name}',
          data.classes.find((classData) => classData.id === classToDelete)?.name ?? '',
        )}
        onCancel={() => setClassToDelete(null)}
        onConfirm={() => {
          if (!classToDelete) return;
          store.deleteClass(classToDelete);
          setClassToDelete(null);
        }}
        open={Boolean(classToDelete)}
        title={tLang.deleteClass}
      />

      <PointAdjustmentDialog
        competencyLabels={competencyLabels}
        feedbackReasonHistory={feedbackReasonHistory}
        onCancel={() => setPointAdjustmentTarget(null)}
        onConfirm={({ amount, competency, reason, target }) => {
          if (target.kind === 'class') {
            store.airdropPoints(amount, reason, competency);
          } else if (target.kind === 'batch') {
            store.adjustPointsForStudents(
              target.ids,
              amount,
              'manual',
              {
                label: reason.trim() || undefined,
                competency,
              },
            );
            setSelectedStudentIds([]);
          } else {
            store.addPoints(
              target.id,
              amount,
              'manual',
              {
                label: reason.trim() || undefined,
                competency,
              },
            );
          }
          setPointAdjustmentTarget(null);
        }}
        pointReasonOptions={pointReasonOptions}
        target={pointAdjustmentTarget}
        tLang={tLang}
      />

      <DeleteConfirmationDialog
        cancelLabel={tLang.cancel}
        confirmLabel={tLang.confirmDeleteBtn}
        message={tLang.deleteWarning.replace(
          '{name}',
          currentStudents.find((student) => student.id === studentToDelete)?.name ?? '',
        )}
        onCancel={() => setStudentToDelete(null)}
        onConfirm={() => {
          if (!studentToDelete) return;
          store.deleteStudent(studentToDelete);
          setStudentToDelete(null);
        }}
        open={Boolean(studentToDelete)}
        title={tLang.confirmDelete}
      />
    </div>
  );
};
