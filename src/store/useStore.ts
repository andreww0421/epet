import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { 
  AppData, Student, ClassData, UpgradeRewardState, PetAnimationMode,
  PointAdjustmentSource, BattleMode, Language, BossRewardTier, BossVictoryResult,
  ClassGoal, LearningCompetency, BossReward, BossAttackMode, MentorDailyFeedbackInput,
  PointReasonOption, FeedbackReasonHistoryEntry, LearningEvidenceInput, ExamRecord,
  DailyReflection, LearningEvidenceRecord, ClassDailyTaskCalendar,
} from './types';
import {
  createLearningEvidenceRecord,
  createMentorFeedbackEvidenceRecord,
} from '../../shared/education';
import { 
  translations, STORAGE_KEY, DEFAULT_MAX_TEAM_SIZE,
  DEFAULT_BATTLE_MODE, petNames
} from './constants';
import {
  normalizeAppData, applyDecay, getRandomPetType, 
  sanitizeTeamAssignments, getTeamMembers, createTeamId, normalizeWorldBoss,
  normalizePointReasonOptions, normalizeClassDailyTaskCalendar,
} from './utils';
import { normalizeExamRecords } from '../examAnalytics';
import { getPublicStudentName } from '../studentPresentation';
import { resolveBossRewardsOnBackend } from '../services/backendApi';
import { 
  applyFeedToStudent, applyPlayWithPet, claimDailyTaskForStudent,
  saveMentorDailyFeedbackForStudent,
  reviveStudentPet, applyPointAdjustmentToStudent, createPointAdjustmentRecord,
  createEconomyEventRecord, appendEconomyEventToStudent,
  applyPenaltyToStudent, createDisciplineRecord, getNextUpgradeGachaLevel,
  applySafetyActionReversal, createSafetyActionEffect, appendRecord, isPenaltyActive,
  getUpcomingUpgradeGachaLevel, resolveBattle, resolveTeamBattle,
  isBattleReady, attackWorldBoss, applyBossContributionRewards, resolveBossAttack, resolveSharedBossAttack,
  resolveRecoverableBossAttack,
  clamp, toFiniteNumber,
  BOSS_ATTACK_FULLNESS_COST, DIRECT_DISCIPLINE_PENALTY, WARNING_THRESHOLD,
  WARNING_AUTO_PENALTY, MAX_ACTIVITY_RECORDS, UPGRADE_REWARD_LEVEL,
  UPGRADE_REWARD_FULLNESS, UPGRADE_REWARD_HAPPINESS, DAILY_TASK_REWARD_HAPPINESS,
  SOLO_BATTLE_MIN_FULLNESS, SOLO_BATTLE_FULLNESS_COST, SOLO_BATTLE_WIN_POINTS,
  SOLO_BATTLE_LOSS_POINTS, TEAM_BATTLE_MIN_FULLNESS, TEAM_BATTLE_MIN_FULLNESS_ENABLED,
  TEAM_BATTLE_ATTACKER_FULLNESS_COST, TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_FULLNESS_COST, TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  DEFAULT_BOSS_ATTACK_MAX_TARGETS, DEFAULT_BOSS_ATTACK_DAMAGE,
  DEFAULT_BOSS_RECOVERY_MINUTES, MAX_BOSS_RECOVERY_MINUTES,
  DEFAULT_BOSS_PARTICIPATION_REWARD, DEFAULT_BOSS_IMPROVEMENT_REWARD,
  DEFAULT_DAILY_POSITIVE_POINT_LIMIT, DEFAULT_DAILY_NEGATIVE_POINT_LIMIT,
  DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET, applyPointGuardrail,
  DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS, DEFAULT_CATCH_UP_GAP_THRESHOLD,
  DEFAULT_DAILY_CATCH_UP_BONUS, applyParticipationSupportToStudent,
  getDateKey, hasActiveLevelDecreaseCooldown, type SafetyActionKind,
  normalizeDateKeyList, normalizeSchoolTimeZone, normalizeSchoolWeekdays,
  normalizeDailyTaskMakeupWindowDays, isDateKey,
  isLearningCompetency, getActiveClassGoals, getWeekStartDate,
  type PointGuardrailOptions, type PointGuardrailOutcome,
  type ParticipationSupportOptions,
} from '../gameRules';

type PointAdjustmentReason = {
  id?: string;
  label?: string;
  competency?: LearningCompetency;
};

type PointUndoEntry = {
  studentId: string;
  recordId: string;
  actualDelta: number;
};

type PointUndoAction = {
  id: string;
  classId: string;
  label: string;
  expiresAt: number;
  entries: PointUndoEntry[];
};

type PointGuardrailApplication = {
  studentId: string;
  requestedAmount: number;
  appliedAmount: number;
  outcome: PointGuardrailOutcome;
  participationTopUp: number;
  catchUpBonus: number;
};

type SafetyUndoAction = {
  id: string;
  classId: string;
  studentId: string;
  originalRecordId: string;
  actionKind: SafetyActionKind;
  label: string;
  expiresAt: number;
};

type StoreState = {
  data: AppData;
  view: 'dashboard' | 'classroom';
  animatingPets: Record<string, PetAnimationMode | undefined>;
  toast: { message: string; type: 'success' | 'error' } | null;
  upgradeReward: UpgradeRewardState | null;
  bossHitFeedback: { damage: number; id: number } | null;
  bossAttackFeedback: {
    targetNames: string[];
    damage: number;
    id: number;
    mode?: BossAttackMode;
    recoverAt?: number;
  } | null;
  showBossVictory: boolean;
  bossVictoryResult: BossVictoryResult | null;
  undoAction: PointUndoAction | null;
  safetyUndoAction: SafetyUndoAction | null;

  // Actions
  setView: (view: 'dashboard' | 'classroom') => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
  setUpgradeReward: (reward: UpgradeRewardState | null) => void;
  triggerPetAnimation: (studentId: string, mode: PetAnimationMode, durationMs: number) => void;
  
  // Class / Setup Actions
  switchClass: (classId: string) => void;
  addClass: (name: string) => void;
  deleteClass: (classId: string) => void;
  importData: (importedData: any, now?: number) => void;
  updateSettings: (settings: Partial<NonNullable<AppData['settings']>>) => void;
  updateClassDailyTaskCalendar: (
    classId: string,
    calendar: ClassDailyTaskCalendar,
  ) => void;
  setClassGoal: (
    goal: Pick<ClassGoal, 'title' | 'competency' | 'targetCount'> | null,
    goalId?: string,
  ) => void;
  saveExamRecord: (exam: ExamRecord) => void;
  deleteExamRecord: (examId: string) => void;

  // Student CRUD
  addStudent: (student: Student) => void;
  addStudentsByName: (names: string[]) => number;
  deleteStudent: (studentId: string) => void;
  editStudentName: (studentId: string, newName: string) => void;
  
  // Student Stats & Discipline
  addPoints: (
    studentId: string,
    pointsToAdd: number,
    source?: PointAdjustmentSource,
    reason?: PointAdjustmentReason,
  ) => void;
  adjustPointsForStudents: (
    studentIds: string[],
    pointsToAdd: number,
    source?: PointAdjustmentSource,
    reason?: PointAdjustmentReason,
  ) => void;
  airdropPoints: (pointsToAdd: number, reasonLabel?: string, competency?: LearningCompetency) => void;
  replacePointReasons: (reasons: PointReasonOption[]) => void;
  togglePinnedReason: (reasonId: string) => void;
  undoLastPointAdjustment: () => void;
  decreaseLevel: (studentId: string, reason?: string) => void;
  warnStudent: (studentId: string) => void;
  removeWarning: (studentId: string) => void;
  disciplineStudent: (studentId: string, reason: string) => void;
  undoLastSafetyAction: () => void;
  removePenalty: (studentId: string) => void;
  resetSeason: () => void;
  
  // Interactions
  feedPet: (studentId: string) => void;
  playWithPet: (studentId: string) => void;
  claimDailyTask: (studentId: string) => boolean;
  setDailyTaskExcusedDate: (studentId: string, date: string, excused: boolean) => void;
  saveMentorDailyFeedback: (studentId: string, feedback: MentorDailyFeedbackInput) => void;
  addLearningEvidence: (studentId: string, evidence: LearningEvidenceInput) => void;
  revivePet: (studentId: string) => void;
  upgradePet: (studentId: string) => void;
  gachaPet: (studentId: string) => void;
  rerollPetFromUpgrade: (studentId: string, claimedLevel: number) => void;
  advanceUpgradeRewardProgress: (studentId: string, claimedLevel: number) => void;
  
  // Team & Battle
  setTeammate: (studentId: string, teammateIds?: string[]) => void;
  battle: (attackerId: string, defenderId: string) => void;
  
  // Boss
  summonBoss: (
    name: string,
    maxHp: number,
    rewardTiers: BossRewardTier[],
    participationReward?: BossReward,
    improvementReward?: BossReward,
  ) => void;
  removeBoss: () => void;
  executeAttackBoss: (studentId: string) => Promise<void>;
  executeBossAttack: () => void;
  clearBossRecovery: () => void;
  dismissBossVictory: () => void;

  // Lifecycle
  triggerDecay: () => void;
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const petAnimationTimers = new Map<string, ReturnType<typeof setTimeout>>();
let bossHitFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
let bossAttackFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
let pointUndoTimer: ReturnType<typeof setTimeout> | undefined;
let safetyUndoTimer: ReturnType<typeof setTimeout> | undefined;
const POINT_UNDO_WINDOW_MS = 10_000;
const SAFETY_UNDO_WINDOW_MS = 10_000;
const MAX_BULK_STUDENTS = 200;
const MAX_LEARNING_EVIDENCE_RECORDS = 2000;
const PII_CACHE_ENABLED = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env?.VITE_ENABLE_PII_CACHE === 'true';

const normalizeImportedStudentName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ');

const createNewStudent = (student: Student): Student => ({
  ...student,
  points: 200,
  pet: { ...student.pet, type: 'egg' },
  stats: { wins: 0, losses: 0 },
  rankPoints: 0,
  warningPoints: 0,
  nextUpgradeGachaLevel: 2,
  penaltyStatus: undefined,
  disciplineRecords: [],
  pointAdjustmentRecords: [],
  economyEventRecords: [],
  bossRewardRecords: [],
  dailyProgress: { streak: 0 },
  bossRecovery: undefined,
  teamId: undefined,
  badges: [],
});

const syncMentorFeedbackEvidence = (
  records: LearningEvidenceRecord[],
  classId: string,
  studentId: string,
  reflection: DailyReflection,
) => [
  createMentorFeedbackEvidenceRecord(
    classId,
    studentId,
    {
      id: reflection.id,
      competency: reflection.competency,
      assessment: reflection.mentorAssessment,
      text: reflection.text,
      createdAt: reflection.createdAt,
    },
    records,
  ),
  ...records,
].slice(0, MAX_LEARNING_EVIDENCE_RECORDS);

const createStudentFromImportedName = (name: string, index: number): Student =>
  createNewStudent({
    id: `student-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    points: 200,
    pet: {
      type: 'egg',
      fullness: 80,
      happiness: 80,
      level: 1,
    },
  });
const NOOP_STATE_STORAGE: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};
const STORE_PERSISTENCE_KEY = PII_CACHE_ENABLED
  ? STORAGE_KEY
  : 'epet-session-memory-only';

const applyPointAdjustments = (
  students: Student[],
  studentIds: Set<string>,
  amount: number,
  source: PointAdjustmentSource,
  reason: PointAdjustmentReason | undefined,
  now: number,
  maxPoints: number,
  guardrailOptions: PointGuardrailOptions,
  participationSupportOptions: ParticipationSupportOptions,
) => {
  const entries: PointUndoEntry[] = [];
  const applications: PointGuardrailApplication[] = [];
  const actualDeltaByStudentId = new Map<string, number>();
  const boundReason: PointAdjustmentReason = {
    ...reason,
    competency: isLearningCompetency(reason?.competency)
      ? reason.competency
      : source === 'dailyTask'
        ? 'assignmentQuality'
        : 'participation',
  };
  const baseStudents = students.map((student) => {
    if (!studentIds.has(student.id)) return student;

    const guardrail = applyPointGuardrail(
      student,
      amount,
      now,
      source === 'dailyTask' || source === 'participationTopUp' || source === 'catchUpBonus'
        ? { ...guardrailOptions, enabled: false }
        : guardrailOptions,
    );
    const record = createPointAdjustmentRecord(
      guardrail.appliedAmount,
      source,
      boundReason,
      now,
      guardrail.outcome === 'applied'
        ? undefined
        : {
            requestedAmount: guardrail.requestedAmount,
            guardrailOutcome: guardrail.outcome,
            guardrailReason: guardrail.reason,
          },
    );
    const updatedStudent = applyPointAdjustmentToStudent(
      student,
      guardrail.appliedAmount,
      record,
      maxPoints,
    );
    applications.push({
      studentId: student.id,
      requestedAmount: guardrail.requestedAmount,
      appliedAmount: guardrail.appliedAmount,
      outcome: guardrail.outcome,
      participationTopUp: 0,
      catchUpBonus: 0,
    });
    const actualDelta = updatedStudent.points - student.points;
    actualDeltaByStudentId.set(student.id, actualDelta);
    if (guardrail.outcome !== 'blocked') {
      entries.push({
        studentId: student.id,
        recordId: record.id,
        actualDelta,
      });
    }
    return updatedStudent;
  });

  const applicationByStudentId = new Map(
    applications.map((application) => [application.studentId, application] as const),
  );
  const nextStudents = baseStudents.map((student) => {
    if (!studentIds.has(student.id) || (actualDeltaByStudentId.get(student.id) ?? 0) <= 0) {
      return student;
    }
    const support = applyParticipationSupportToStudent(
      student,
      baseStudents,
      now,
      maxPoints,
      participationSupportOptions,
    );
    const application = applicationByStudentId.get(student.id);
    if (application) {
      application.participationTopUp = support.participationTopUp;
      application.catchUpBonus = support.catchUpBonus;
    }
    support.records.forEach((record) => {
      entries.push({
        studentId: student.id,
        recordId: record.id,
        actualDelta: record.amount,
      });
    });
    return support.student;
  });

  return { applications, entries, students: nextStudents };
};

const getPointGuardrailOptions = (
  settings: AppData['settings'],
): PointGuardrailOptions => ({
  enabled: settings?.pointGuardrailsEnabled !== false,
  timeZone: settings?.schoolTimeZone,
  dailyPositiveLimit: settings?.dailyPositivePointLimit,
  dailyNegativeLimit: settings?.dailyNegativePointLimit,
});

const getParticipationSupportOptions = (
  settings: AppData['settings'],
): ParticipationSupportOptions => ({
  enabled: settings?.participationSupportEnabled !== false,
  timeZone: settings?.schoolTimeZone,
  minimumDailyParticipationPoints: settings?.minimumDailyParticipationPoints,
  catchUpGapThreshold: settings?.catchUpGapThreshold,
  dailyCatchUpBonus: settings?.dailyCatchUpBonus,
});

const getPointGuardrailCounts = (applications: PointGuardrailApplication[]) => ({
  blocked: applications.filter((application) => application.outcome === 'blocked').length,
  clamped: applications.filter((application) => application.outcome === 'clamped').length,
});

const getPointGuardrailNotice = (
  lang: Language,
  applications: PointGuardrailApplication[],
) => {
  const counts = getPointGuardrailCounts(applications);
  if (counts.blocked === 0 && counts.clamped === 0) return '';
  if (counts.blocked === applications.length) {
    return translations[lang].pointGuardrailBlocked.replace(
      '{count}',
      counts.blocked.toString(),
    );
  }
  return translations[lang].pointGuardrailAdjusted
    .replace('{clamped}', counts.clamped.toString())
    .replace('{blocked}', counts.blocked.toString());
};

const getParticipationSupportNotice = (
  lang: Language,
  applications: PointGuardrailApplication[],
) => {
  const supportedStudents = applications.filter(
    (application) => application.participationTopUp > 0 || application.catchUpBonus > 0,
  );
  if (supportedStudents.length === 0) return '';
  const participationTopUp = supportedStudents.reduce(
    (total, application) => total + application.participationTopUp,
    0,
  );
  const catchUpBonus = supportedStudents.reduce(
    (total, application) => total + application.catchUpBonus,
    0,
  );
  return translations[lang].participationSupportApplied
    .replace('{count}', supportedStudents.length.toString())
    .replace('{topUp}', participationTopUp.toString())
    .replace('{catchUp}', catchUpBonus.toString());
};

const schedulePointUndoExpiry = (
  undoId: string,
  clearIfActive: (undoId: string) => void,
) => {
  if (pointUndoTimer) clearTimeout(pointUndoTimer);
  pointUndoTimer = setTimeout(() => {
    clearIfActive(undoId);
    pointUndoTimer = undefined;
  }, POINT_UNDO_WINDOW_MS);
};

const scheduleSafetyUndoExpiry = (
  undoId: string,
  clearIfActive: (undoId: string) => void,
) => {
  if (safetyUndoTimer) clearTimeout(safetyUndoTimer);
  safetyUndoTimer = setTimeout(() => {
    clearIfActive(undoId);
    safetyUndoTimer = undefined;
  }, SAFETY_UNDO_WINDOW_MS);
};

const normalizeSafetyReason = (reason?: string) => reason?.trim().slice(0, 240) ?? '';

const prependFeedbackReason = (
  history: FeedbackReasonHistoryEntry[] | undefined,
  label: string | undefined,
  competency: LearningCompetency | undefined,
) => {
  const normalizedLabel = label?.trim().slice(0, 120);
  if (!normalizedLabel) return history ?? [];
  const normalizedKey = normalizedLabel.toLocaleLowerCase();
  return [
    {
      label: normalizedLabel,
      competency: isLearningCompetency(competency) ? competency : 'participation' as const,
    },
    ...(history ?? []).filter((item) => item.label.toLocaleLowerCase() !== normalizedKey),
  ].slice(0, 20);
};

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      data: normalizeAppData({}),
      view: 'classroom',
      animatingPets: {},
      toast: null,
      upgradeReward: null,
      bossHitFeedback: null,
      bossAttackFeedback: null,
      showBossVictory: false,
      bossVictoryResult: null,
      undoAction: null,
      safetyUndoAction: null,

      setView: (view) => set({ view }),
      
      showToast: (message, type = 'success') => {
        if (toastTimer) clearTimeout(toastTimer);
        set({ toast: { message, type } });
        toastTimer = setTimeout(() => {
          set({ toast: null });
          toastTimer = undefined;
        }, 3000);
      },

      setUpgradeReward: (reward) => set({ upgradeReward: reward }),

      triggerPetAnimation: (studentId, mode, durationMs) => {
        const activeTimer = petAnimationTimers.get(studentId);
        if (activeTimer) clearTimeout(activeTimer);
        set((state) => ({
          animatingPets: { ...state.animatingPets, [studentId]: mode }
        }));
        const timer = setTimeout(() => {
          set((state) => {
            const next = { ...state.animatingPets };
            delete next[studentId];
            return { animatingPets: next };
          });
          petAnimationTimers.delete(studentId);
        }, durationMs);
        petAnimationTimers.set(studentId, timer);
      },

      switchClass: (classId) => set((state) => ({
        data: { ...state.data, currentClassId: classId }
      })),

      addClass: (name) => set((state) => {
        const newClass = {
          id: Date.now().toString(),
          name,
          students: [],
          dailyTaskCalendar: normalizeClassDailyTaskCalendar(undefined, state.data.settings),
          learningEvidenceRecords: [],
          examRecords: [],
        };
        get().showToast(`${translations[state.data.settings?.language || 'zh'].classAdded}${name}`);
        return { data: { ...state.data, classes: [...state.data.classes, newClass], currentClassId: newClass.id } };
      }),

      deleteClass: (classId) => set((state) => {
        if (state.data.classes.length <= 1) return state;
        const className = state.data.classes.find(c => c.id === classId)?.name;
        const newClasses = state.data.classes.filter(c => c.id !== classId);
        get().showToast(`${translations[state.data.settings?.language || 'zh'].classDeleted}${className}`);
        return {
          data: {
            ...state.data,
            classes: newClasses,
            currentClassId: state.data.currentClassId === classId ? newClasses[0].id : state.data.currentClassId
          }
        };
      }),

      importData: (importedData, now = Date.now()) => set(() => {
        if (pointUndoTimer) {
          clearTimeout(pointUndoTimer);
          pointUndoTimer = undefined;
        }
        if (safetyUndoTimer) {
          clearTimeout(safetyUndoTimer);
          safetyUndoTimer = undefined;
        }
        const normalizedData = normalizeAppData(importedData, now);
        // A backup is a point-in-time snapshot. Replaying decay from its old
        // lastOpened value would corrupt the pet state during restoration.
        const restoredData = applyDecay(
          { ...normalizedData, lastOpened: now },
          now,
        );
        return { data: restoredData, undoAction: null, safetyUndoAction: null };
      }),

      updateSettings: (newSettings) => set((state) => {
        const merged = { ...state.data.settings, ...newSettings };
        const inclusiveMode = merged.inclusiveMode !== false;
        const safeMaxTeamSize = Math.max(2, Math.min(6, Math.floor(toFiniteNumber(merged.maxTeamSize, DEFAULT_MAX_TEAM_SIZE))));
        const safeTeamBattleMinFullness = Math.max(
          0,
          toFiniteNumber(merged.teamBattleMinFullness, TEAM_BATTLE_MIN_FULLNESS),
        );
        const safeSoloBattleFullnessCost = Math.max(
          0,
          toFiniteNumber(merged.soloBattleFullnessCost, SOLO_BATTLE_FULLNESS_COST),
        );
        const safePetCareMode: 'rest' | 'death' =
          inclusiveMode ? 'rest' : merged.petCareMode === 'death' ? 'death' : 'rest';
        const safePublicNameMode: 'full' | 'masked' =
          inclusiveMode ? 'masked' : merged.publicNameMode === 'full' ? 'full' : 'masked';
        const safePublicLeaderboardMode: 'growth' | 'rank' | 'hidden' =
          inclusiveMode
            ? merged.publicLeaderboardMode === 'hidden' ? 'hidden' : 'growth'
            : merged.publicLeaderboardMode === 'rank' ||
                merged.publicLeaderboardMode === 'hidden'
              ? merged.publicLeaderboardMode
              : 'growth';
        
        const newData = {
          ...state.data,
          settings: {
            ...merged,
            decayAmount: Math.max(0, toFiniteNumber(merged.decayAmount, 2)),
            inclusiveMode,
            pauseDecayOnWeekends: inclusiveMode || merged.pauseDecayOnWeekends !== false,
            schoolTimeZone: normalizeSchoolTimeZone(merged.schoolTimeZone),
            schoolWeekdays: normalizeSchoolWeekdays(merged.schoolWeekdays),
            schoolHolidayDates: normalizeDateKeyList(merged.schoolHolidayDates),
            dailyTaskMakeupWindowDays: normalizeDailyTaskMakeupWindowDays(
              merged.dailyTaskMakeupWindowDays,
            ),
            petCareMode: safePetCareMode,
            publicNameMode: safePublicNameMode,
            publicLeaderboardMode: safePublicLeaderboardMode,
            feedCost: Math.max(1, toFiniteNumber(merged.feedCost, 10)),
            feedGain: Math.max(1, toFiniteNumber(merged.feedGain, 20)),
            playCost: Math.max(1, toFiniteNumber(merged.playCost, 5)),
            playGain: Math.max(1, toFiniteNumber(merged.playGain, 15)),
            battleEnabled: merged.battleEnabled !== false,
            maxTeamSize: safeMaxTeamSize,
            maxPoints: Math.max(10, toFiniteNumber(merged.maxPoints, 700)),
            reviveCost: Math.max(0, toFiniteNumber(merged.reviveCost, 120)),
            battleRankPointsWin: Math.max(0, toFiniteNumber(merged.battleRankPointsWin, 20)),
            battleRankPointsLoss: Math.max(0, toFiniteNumber(merged.battleRankPointsLoss, 10)),
            soloBattleFullnessCost: safeSoloBattleFullnessCost,
            soloBattleAttackerFullnessCost: Math.max(
              0,
              toFiniteNumber(merged.soloBattleAttackerFullnessCost, safeSoloBattleFullnessCost),
            ),
            soloBattleDefenderFullnessCost: Math.max(
              0,
              toFiniteNumber(merged.soloBattleDefenderFullnessCost, safeSoloBattleFullnessCost),
            ),
            soloBattleWinPoints: Math.max(0, toFiniteNumber(merged.soloBattleWinPoints, SOLO_BATTLE_WIN_POINTS)),
            soloBattleLossPoints: Math.max(0, toFiniteNumber(merged.soloBattleLossPoints, SOLO_BATTLE_LOSS_POINTS)),
            teamBattleMinFullnessEnabled: merged.teamBattleMinFullnessEnabled !== false,
            teamBattleMinFullness: safeTeamBattleMinFullness,
            teamBattleAttackerFullnessCost: Math.max(
              0,
              toFiniteNumber(merged.teamBattleAttackerFullnessCost, TEAM_BATTLE_ATTACKER_FULLNESS_COST),
            ),
            teamBattleAttackerTeammateFullnessCost: Math.max(
              0,
              toFiniteNumber(
                merged.teamBattleAttackerTeammateFullnessCost,
                TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
              ),
            ),
            teamBattleDefenderFullnessCost: Math.max(
              0,
              toFiniteNumber(merged.teamBattleDefenderFullnessCost, TEAM_BATTLE_DEFENDER_FULLNESS_COST),
            ),
            teamBattleDefenderTeammateFullnessCost: Math.max(
              0,
              toFiniteNumber(
                merged.teamBattleDefenderTeammateFullnessCost,
                TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
              ),
            ),
            bossAttackMaxTargets: Math.max(
              0,
              Math.min(4, Math.floor(toFiniteNumber(merged.bossAttackMaxTargets, DEFAULT_BOSS_ATTACK_MAX_TARGETS))),
            ),
            bossAttackDamage: Math.max(
              0,
              Math.floor(toFiniteNumber(merged.bossAttackDamage, DEFAULT_BOSS_ATTACK_DAMAGE)),
            ),
            bossAttackMode: (
              inclusiveMode
                ? 'recoverable'
                : merged.bossAttackMode === 'random'
                  ? 'random'
                  : merged.bossAttackMode === 'shared'
                    ? 'shared'
                    : 'recoverable'
            ) as BossAttackMode,
            bossRecoveryMinutes: clamp(
              Math.floor(toFiniteNumber(merged.bossRecoveryMinutes, DEFAULT_BOSS_RECOVERY_MINUTES)),
              1,
              MAX_BOSS_RECOVERY_MINUTES,
            ),
            pointGuardrailsEnabled: merged.pointGuardrailsEnabled !== false,
            dailyPositivePointLimit: clamp(
              Math.floor(toFiniteNumber(
                merged.dailyPositivePointLimit,
                DEFAULT_DAILY_POSITIVE_POINT_LIMIT,
              )),
              0,
              10_000,
            ),
            dailyNegativePointLimit: clamp(
              Math.floor(toFiniteNumber(
                merged.dailyNegativePointLimit,
                DEFAULT_DAILY_NEGATIVE_POINT_LIMIT,
              )),
              0,
              10_000,
            ),
            positiveFeedbackRatioTarget: clamp(
              toFiniteNumber(
                merged.positiveFeedbackRatioTarget,
                DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET,
              ),
              1,
              10,
            ),
            participationSupportEnabled: merged.participationSupportEnabled !== false,
            minimumDailyParticipationPoints: clamp(
              Math.floor(toFiniteNumber(
                merged.minimumDailyParticipationPoints,
                DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS,
              )),
              0,
              1_000,
            ),
            catchUpGapThreshold: clamp(
              Math.floor(toFiniteNumber(
                merged.catchUpGapThreshold,
                DEFAULT_CATCH_UP_GAP_THRESHOLD,
              )),
              0,
              10_000,
            ),
            dailyCatchUpBonus: clamp(
              Math.floor(toFiniteNumber(
                merged.dailyCatchUpBonus,
                DEFAULT_DAILY_CATCH_UP_BONUS,
              )),
              0,
              1_000,
            ),
          }
        };
        get().showToast(translations[newData.settings.language || 'zh'].settingsSaved, 'success');
        return {
          data: {
            ...newData,
            classes: newData.classes.map(c => ({
              ...c,
              students: sanitizeTeamAssignments(c.students, safeMaxTeamSize).map((student) =>
                newData.settings.petCareMode === 'death' || !student.pet.isDead
                  ? student
                  : {
                      ...student,
                      pet: {
                        ...student.pet,
                        isDead: false,
                      },
                    },
              ),
            }))
          }
        };
      }),

      updateClassDailyTaskCalendar: (classId, calendar) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(
          (classData) => classData.id === classId,
        );
        if (currentClassIndex === -1) return state;
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          dailyTaskCalendar: normalizeClassDailyTaskCalendar(
            calendar,
            state.data.settings,
          ),
        };
        return { data: { ...state.data, classes: nextClasses } };
      }),

      setClassGoal: (goal, goalId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(
          (classData) => classData.id === state.data.currentClassId,
        );
        if (currentClassIndex === -1) return state;

        const now = Date.now();
        const nextClasses = [...state.data.classes];
        const currentGoals = nextClasses[currentClassIndex].classGoals ?? [];
        const schoolTimeZone = state.data.settings?.schoolTimeZone;
        const currentWeekStart = getWeekStartDate(now, schoolTimeZone);
        const activeGoals = getActiveClassGoals(currentGoals, now, schoolTimeZone);
        const currentGoal = goalId
          ? currentGoals.find((existingGoal) => existingGoal.id === goalId)
          : undefined;
        const canKeepProgress = currentGoal?.competency === goal?.competency;
        let nextGoals: ClassGoal[];

        if (!goal) {
          nextGoals = goalId
            ? currentGoals.filter((existingGoal) => existingGoal.id !== goalId)
            : currentGoals.filter((existingGoal) => !activeGoals.includes(existingGoal));
        } else {
          const nextGoal: ClassGoal = {
            id: currentGoal?.id ?? `goal-${now}-${currentGoals.length}`,
            title: goal.title.trim(),
            competency: goal.competency,
            targetCount: Math.max(1, Math.floor(toFiniteNumber(goal.targetCount, 10))),
            createdAt: canKeepProgress && currentGoal ? currentGoal.createdAt : now,
            weekStartDate: currentGoal?.weekStartDate ?? currentWeekStart,
          };

          if (currentGoal) {
            nextGoals = currentGoals.map((existingGoal) =>
              existingGoal.id === currentGoal.id ? nextGoal : existingGoal,
            );
          } else {
            if (activeGoals.length >= 3) {
              get().showToast(
                translations[state.data.settings?.language || 'zh'].classGoalLimitReached,
                'error',
              );
              return state;
            }
            nextGoals = [...currentGoals, nextGoal].slice(-156);
          }
        }

        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          classGoals: nextGoals,
        };
        const tLang = translations[state.data.settings?.language || 'zh'];
        get().showToast(goal ? tLang.classGoalSaved : tLang.classGoalCleared, 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      saveExamRecord: (exam) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(
          (classData) => classData.id === state.data.currentClassId,
        );
        if (currentClassIndex === -1) return state;
        const currentClass = state.data.classes[currentClassIndex];
        const now = Date.now();
        const normalizedExam = normalizeExamRecords(
          [{ ...exam, updatedAt: now }],
          new Set(currentClass.students.map((student) => student.id)),
          now,
        )[0];
        if (!normalizedExam || normalizedExam.items.length === 0) return state;

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          examRecords: [
            normalizedExam,
            ...(currentClass.examRecords ?? []).filter(
              (candidate) => candidate.id !== normalizedExam.id,
            ),
          ].sort(
            (left, right) =>
              right.examDate.localeCompare(left.examDate) ||
              right.createdAt - left.createdAt,
          ),
        };
        const lang = state.data.settings?.language || 'zh';
        get().showToast(
          lang === 'en' ? 'Assessment saved.' : '考試成績已保存。',
          'success',
        );
        return { data: { ...state.data, classes: nextClasses } };
      }),

      deleteExamRecord: (examId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(
          (classData) => classData.id === state.data.currentClassId,
        );
        if (currentClassIndex === -1) return state;
        const currentClass = state.data.classes[currentClassIndex];
        if (!(currentClass.examRecords ?? []).some((exam) => exam.id === examId)) {
          return state;
        }
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          examRecords: (currentClass.examRecords ?? []).filter(
            (exam) => exam.id !== examId,
          ),
        };
        const lang = state.data.settings?.language || 'zh';
        get().showToast(
          lang === 'en' ? 'Assessment deleted.' : '考試紀錄已刪除。',
          'success',
        );
        return { data: { ...state.data, classes: nextClasses } };
      }),

      addStudent: (student) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const newStudent = createNewStudent(student);
        
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: [...nextClasses[currentClassIndex].students, newStudent]
        };
        get().showToast(`${translations[state.data.settings?.language || 'zh'].addedStudent}${student.name}`);
        
        return { data: { ...state.data, classes: nextClasses } };
      }),

      addStudentsByName: (names) => {
        let addedCount = 0;
        set((state) => {
          const currentClassIndex = state.data.classes.findIndex(
            (classData) => classData.id === state.data.currentClassId,
          );
          if (currentClassIndex === -1) return state;

          const currentClass = state.data.classes[currentClassIndex];
          const existingNames = new Set(
            currentClass.students.map((student) =>
              normalizeImportedStudentName(student.name).toLocaleLowerCase(),
            ),
          );
          const uniqueNames: string[] = [];

          for (const rawName of names.slice(0, MAX_BULK_STUDENTS)) {
            const name = normalizeImportedStudentName(rawName);
            if (!name || name.length > 80) continue;
            const key = name.toLocaleLowerCase();
            if (existingNames.has(key)) continue;
            existingNames.add(key);
            uniqueNames.push(name);
          }

          if (uniqueNames.length === 0) return state;
          const importedStudents = uniqueNames.map(createStudentFromImportedName);
          addedCount = importedStudents.length;
          const nextClasses = [...state.data.classes];
          nextClasses[currentClassIndex] = {
            ...currentClass,
            students: [...currentClass.students, ...importedStudents],
          };
          const lang = state.data.settings?.language || 'zh';
          get().showToast(
            lang === 'en'
              ? `Imported ${addedCount} students.`
              : `已匯入 ${addedCount} 位學生。`,
          );
          return { data: { ...state.data, classes: nextClasses } };
        });
        return addedCount;
      },

      deleteStudent: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        
        const currentClass = state.data.classes[currentClassIndex];
        const className = currentClass.students.find(s => s.id === studentId)?.name;
        const nextStudents = sanitizeTeamAssignments(
          currentClass.students.filter(s => s.id !== studentId),
          state.data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE
        );
        get().showToast(`${translations[state.data.settings?.language || 'zh'].deletedStudent}${className}`);

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          students: nextStudents,
          learningEvidenceRecords: (currentClass.learningEvidenceRecords ?? []).filter(
            (record) => record.studentId !== studentId,
          ),
          examRecords: (currentClass.examRecords ?? []).map(
            (exam) => ({
              ...exam,
              results: exam.results.filter((result) => result.studentId !== studentId),
            }),
          ),
          activeBoss: currentClass.activeBoss
            ? {
                ...currentClass.activeBoss,
                contributions: Object.fromEntries(
                  Object.entries(currentClass.activeBoss.contributions).filter(
                    ([contributorId]) => contributorId !== studentId,
                  ),
                ),
                attackCounts: Object.fromEntries(
                  Object.entries(currentClass.activeBoss.attackCounts ?? {}).filter(
                    ([contributorId]) => contributorId !== studentId,
                  ),
                ),
              }
            : undefined,
        };
        
        return { data: { ...state.data, classes: nextClasses } };
      }),

      editStudentName: (studentId, newName) => set((state) => {
        if (!newName.trim()) return state;
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId ? { ...s, name: newName.trim() } : s
          )
        };
        get().showToast(state.data.settings?.language === 'en' ? `Renamed to ${newName.trim()}` : `已將學生姓名修改為 ${newName.trim()}`, 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      addPoints: (studentId, pointsToAdd, source = 'quick', reason) => {
        let createdUndoId = '';
        let adjustmentNotice = '';
        let adjustmentNoticeType: 'success' | 'error' = 'success';
        set((state) => {
          const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
          if (currentClassIndex === -1) return state;

          const amount = Math.trunc(toFiniteNumber(pointsToAdd, 0));
          if (amount === 0) return state;
          const currentClass = state.data.classes[currentClassIndex];
          const targetStudent = currentClass.students.find((student) => student.id === studentId);
          if (!targetStudent) return state;

          const now = Date.now();
          const result = applyPointAdjustments(
            currentClass.students,
            new Set([studentId]),
            amount,
            source,
            reason,
            now,
            state.data.settings?.maxPoints ?? 700,
            getPointGuardrailOptions(state.data.settings),
            getParticipationSupportOptions(state.data.settings),
          );
          const lang = state.data.settings?.language || 'zh';
          const guardrailNotice = getPointGuardrailNotice(lang, result.applications);
          adjustmentNotice = [
            guardrailNotice,
            getParticipationSupportNotice(lang, result.applications),
          ].filter(Boolean).join(' ');
          adjustmentNoticeType = guardrailNotice ? 'error' : 'success';
          const undoId = result.entries.length > 0
            ? `undo-points-${now}-${Math.random().toString(36).slice(2, 8)}`
            : '';
          createdUndoId = undoId;
          const nextClasses = [...state.data.classes];
          nextClasses[currentClassIndex] = { ...currentClass, students: result.students };
          const recentReasonIds = reason?.id
            ? [
                reason.id,
                ...(state.data.settings?.recentReasonIds ?? []).filter((id) => id !== reason.id),
              ].slice(0, 3)
            : state.data.settings?.recentReasonIds;
          const feedbackReasonHistory = prependFeedbackReason(
            state.data.settings?.feedbackReasonHistory,
            reason?.label,
            reason?.competency,
          );
          const shouldUpdateReasonSettings = Boolean(reason?.id || reason?.label?.trim());

          return {
            undoAction: undoId
              ? {
                  id: undoId,
                  classId: currentClass.id,
                  label: translations[lang].undoSingleAdjustment.replace('{name}', targetStudent.name),
                  expiresAt: now + POINT_UNDO_WINDOW_MS,
                  entries: result.entries,
                }
              : state.undoAction,
            data: {
              ...state.data,
              classes: nextClasses,
              settings: shouldUpdateReasonSettings
                ? { ...state.data.settings!, recentReasonIds, feedbackReasonHistory }
                : state.data.settings,
            },
          };
        });
        if (createdUndoId) {
          schedulePointUndoExpiry(createdUndoId, (undoId) => {
            set((state) => state.undoAction?.id === undoId ? { undoAction: null } : {});
          });
        }
        if (adjustmentNotice) get().showToast(adjustmentNotice, adjustmentNoticeType);
      },

      adjustPointsForStudents: (studentIds, pointsToAdd, source = 'manual', reason) => {
        let createdUndoId = '';
        let toastMessage = '';
        let toastType: 'success' | 'error' = 'success';
        set((state) => {
          const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
          if (currentClassIndex === -1) return state;

          const amount = Math.trunc(toFiniteNumber(pointsToAdd, 0));
          const uniqueStudentIds = new Set(studentIds);
          if (amount === 0 || uniqueStudentIds.size === 0) return state;

          const now = Date.now();
          const currentClass = state.data.classes[currentClassIndex];
          const result = applyPointAdjustments(
            currentClass.students,
            uniqueStudentIds,
            amount,
            source,
            reason,
            now,
            state.data.settings?.maxPoints ?? 700,
            getPointGuardrailOptions(state.data.settings),
            getParticipationSupportOptions(state.data.settings),
          );
          if (result.applications.length === 0) return state;

          const undoId = result.entries.length > 0
            ? `undo-batch-${now}-${Math.random().toString(36).slice(2, 8)}`
            : '';
          createdUndoId = undoId;
          const lang = state.data.settings?.language || 'zh';
          const signedAmount = `${amount > 0 ? '+' : ''}${amount}`;
          const adjustedStudentCount = result.applications.filter(
            (application) => application.outcome !== 'blocked',
          ).length;
          const nextClasses = [...state.data.classes];
          nextClasses[currentClassIndex] = { ...currentClass, students: result.students };
          const guardrailNotice = getPointGuardrailNotice(lang, result.applications);
          const supportNotice = getParticipationSupportNotice(lang, result.applications);
          toastMessage = [guardrailNotice, supportNotice].filter(Boolean).join(' ') ||
            translations[lang].batchAdjustmentApplied
              .replace('{count}', adjustedStudentCount.toString())
              .replace('{amount}', signedAmount);
          const guardrailCounts = getPointGuardrailCounts(result.applications);
          toastType = guardrailCounts.blocked > 0 || guardrailCounts.clamped > 0 || amount < 0
            ? 'error'
            : 'success';
          const feedbackReasonHistory = prependFeedbackReason(
            state.data.settings?.feedbackReasonHistory,
            reason?.label,
            reason?.competency,
          );

          return {
            undoAction: undoId
              ? {
                  id: undoId,
                  classId: currentClass.id,
                  label: translations[lang].undoBatchAdjustment.replace(
                    '{count}',
                    adjustedStudentCount.toString(),
                  ),
                  expiresAt: now + POINT_UNDO_WINDOW_MS,
                  entries: result.entries,
                }
              : state.undoAction,
            data: {
              ...state.data,
              classes: nextClasses,
              settings: reason?.label?.trim()
                ? { ...state.data.settings!, feedbackReasonHistory }
                : state.data.settings,
            },
          };
        });
        if (createdUndoId) {
          schedulePointUndoExpiry(createdUndoId, (undoId) => {
            set((state) => state.undoAction?.id === undoId ? { undoAction: null } : {});
          });
        }
        if (toastMessage) get().showToast(toastMessage, toastType);
      },

      airdropPoints: (pointsToAdd, reasonLabel, competency) => {
        let createdUndoId = '';
        let toastMessage = '';
        let toastType: 'success' | 'error' = 'success';
        set((state) => {
          const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
          if (currentClassIndex === -1) return state;

          const amount = Math.trunc(toFiniteNumber(pointsToAdd, 0));
          if (amount === 0) return state;

          const now = Date.now();
          const currentClass = state.data.classes[currentClassIndex];
          const result = applyPointAdjustments(
            currentClass.students,
            new Set(currentClass.students.map((student) => student.id)),
            amount,
            'airdrop',
            reasonLabel?.trim() || competency
              ? { label: reasonLabel?.trim() || undefined, competency }
              : undefined,
            now,
            state.data.settings?.maxPoints ?? 700,
            getPointGuardrailOptions(state.data.settings),
            getParticipationSupportOptions(state.data.settings),
          );
          if (result.applications.length === 0) return state;

          const undoId = result.entries.length > 0
            ? `undo-airdrop-${now}-${Math.random().toString(36).slice(2, 8)}`
            : '';
          createdUndoId = undoId;
          const nextClasses = [...state.data.classes];
          nextClasses[currentClassIndex] = { ...currentClass, students: result.students };
          const lang = state.data.settings?.language || 'zh';
          const signedAmount = `${amount > 0 ? '+' : ''}${amount}`;
          const guardrailNotice = getPointGuardrailNotice(lang, result.applications);
          const supportNotice = getParticipationSupportNotice(lang, result.applications);
          toastMessage = [guardrailNotice, supportNotice].filter(Boolean).join(' ') || (
            lang === 'en'
              ? `Airdropped ${signedAmount} points to ${currentClass.students.length} students.`
              : `已向 ${currentClass.students.length} 位學生空投 ${signedAmount} 積分。`
          );
          const guardrailCounts = getPointGuardrailCounts(result.applications);
          toastType = guardrailCounts.blocked > 0 || guardrailCounts.clamped > 0 || amount < 0
            ? 'error'
            : 'success';
          const feedbackReasonHistory = prependFeedbackReason(
            state.data.settings?.feedbackReasonHistory,
            reasonLabel,
            competency,
          );

          return {
            undoAction: undoId
              ? {
                  id: undoId,
                  classId: currentClass.id,
                  label: translations[lang].undoClassAdjustment,
                  expiresAt: now + POINT_UNDO_WINDOW_MS,
                  entries: result.entries,
                }
              : state.undoAction,
            data: {
              ...state.data,
              classes: nextClasses,
              settings: reasonLabel?.trim()
                ? { ...state.data.settings!, feedbackReasonHistory }
                : state.data.settings,
            },
          };
        });
        if (createdUndoId) {
          schedulePointUndoExpiry(createdUndoId, (undoId) => {
            set((state) => state.undoAction?.id === undoId ? { undoAction: null } : {});
          });
        }
        if (toastMessage) get().showToast(toastMessage, toastType);
      },

      replacePointReasons: (reasons) => {
        const lang = get().data.settings?.language || 'zh';
        set((state) => {
          if (!state.data.settings) return state;
          const pointReasonOptions = normalizePointReasonOptions(reasons);
          const validIds = new Set(pointReasonOptions.map((reason) => reason.id));
          const pinnedReasonIds = (state.data.settings.pinnedReasonIds ?? [])
            .filter((id) => validIds.has(id));
          const recentReasonIds = (state.data.settings.recentReasonIds ?? [])
            .filter((id) => validIds.has(id));
          return {
            data: {
              ...state.data,
              settings: {
                ...state.data.settings,
                pointReasonOptions,
                pinnedReasonIds,
                recentReasonIds,
              },
            },
          };
        });
        get().showToast(translations[lang].reasonSettingsSaved, 'success');
      },

      togglePinnedReason: (reasonId) => set((state) => {
        const normalizedReasonId = reasonId.trim();
        if (!normalizedReasonId || !state.data.settings) return state;
        if (!(state.data.settings.pointReasonOptions ?? []).some(
          (reason) => reason.id === normalizedReasonId,
        )) return state;
        const currentIds = state.data.settings.pinnedReasonIds ?? [];
        const pinnedReasonIds = currentIds.includes(normalizedReasonId)
          ? currentIds.filter((id) => id !== normalizedReasonId)
          : [...currentIds, normalizedReasonId];
        return {
          data: {
            ...state.data,
            settings: { ...state.data.settings, pinnedReasonIds },
          },
        };
      }),

      undoLastPointAdjustment: () => {
        const undoAction = get().undoAction;
        if (!undoAction) return;
        if (pointUndoTimer) {
          clearTimeout(pointUndoTimer);
          pointUndoTimer = undefined;
        }

        let didUndo = false;
        set((state) => {
          if (state.undoAction?.id !== undoAction.id || Date.now() > undoAction.expiresAt) {
            return { undoAction: null };
          }

          const classIndex = state.data.classes.findIndex(
            (classData) => classData.id === undoAction.classId,
          );
          if (classIndex === -1) return { undoAction: null };
          const entriesByStudentId = new Map<string, PointUndoEntry[]>();
          undoAction.entries.forEach((entry) => {
            const studentEntries = entriesByStudentId.get(entry.studentId) ?? [];
            studentEntries.push(entry);
            entriesByStudentId.set(entry.studentId, studentEntries);
          });
          const nextClasses = [...state.data.classes];
          nextClasses[classIndex] = {
            ...nextClasses[classIndex],
            students: nextClasses[classIndex].students.map((student) => {
              const studentEntries = entriesByStudentId.get(student.id) ?? [];
              const records = student.pointAdjustmentRecords ?? [];
              const recordIds = new Set(studentEntries.map((entry) => entry.recordId));
              const appliedEntries = studentEntries.filter((entry) =>
                records.some((record) => record.id === entry.recordId),
              );
              if (appliedEntries.length === 0) return student;
              didUndo = true;
              return {
                ...student,
                points: clamp(
                  student.points - appliedEntries.reduce(
                    (total, entry) => total + entry.actualDelta,
                    0,
                  ),
                  0,
                  state.data.settings?.maxPoints ?? 700,
                ),
                pointAdjustmentRecords: records.filter((record) => !recordIds.has(record.id)),
              };
            }),
          };

          return {
            undoAction: null,
            data: { ...state.data, classes: nextClasses },
          };
        });

        if (didUndo) {
          const lang = get().data.settings?.language || 'zh';
          get().showToast(translations[lang].undoCompleted, 'success');
        }
      },

      decreaseLevel: (studentId, reason) => {
        const language = get().data.settings?.language || 'zh';
        const normalizedReason = normalizeSafetyReason(reason) || (
          language === 'en' ? 'Quick level decrease by mentor' : '導師快速降級操作'
        );

        let createdUndoId = '';
        let blockedMessage = '';
        set((state) => {
          const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
          if (currentClassIndex === -1) return state;

          const now = Date.now();
          if (state.safetyUndoAction && now <= state.safetyUndoAction.expiresAt) {
            blockedMessage = language === 'en'
              ? 'Finish or undo the current safety action first.'
              : '請先完成或撤銷目前的正式操作。';
            return state;
          }

          const currentClass = state.data.classes[currentClassIndex];
          const targetStudent = currentClass.students.find((student) => student.id === studentId);
          if (!targetStudent || (targetStudent.pet.level || 1) <= 1) return state;
          if (hasActiveLevelDecreaseCooldown(targetStudent.disciplineRecords, now)) {
            blockedMessage = language === 'en'
              ? 'This student can only be decreased one level every 24 hours unless the prior action is reversed.'
              : '同一位學生 24 小時內只能降級一次；若前次為誤操作，請先撤銷。';
            return state;
          }

          const loweredStudent = {
            ...targetStudent,
            pet: { ...targetStudent.pet, level: (targetStudent.pet.level || 1) - 1 },
          };
          const effect = createSafetyActionEffect(targetStudent, loweredStudent);
          const record = createDisciplineRecord('levelDecrease', undefined, now, {
            actionKind: 'levelDecrease',
            reason: normalizedReason,
            safetyEffect: effect,
          });
          const updatedStudent = {
            ...loweredStudent,
            disciplineRecords: appendRecord(targetStudent.disciplineRecords, record),
          };
          const undoId = `undo-safety-${now}-${Math.random().toString(36).slice(2, 8)}`;
          createdUndoId = undoId;
          const nextClasses = [...state.data.classes];
          nextClasses[currentClassIndex] = {
            ...currentClass,
            students: currentClass.students.map((student) =>
              student.id === studentId ? updatedStudent : student
            ),
          };

          return {
            safetyUndoAction: {
              id: undoId,
              classId: currentClass.id,
              studentId,
              originalRecordId: record.id,
              actionKind: 'levelDecrease',
              label: language === 'en'
                ? `Level decreased for ${targetStudent.name}`
                : `已降低 ${targetStudent.name} 的等級`,
              expiresAt: now + SAFETY_UNDO_WINDOW_MS,
            },
            data: { ...state.data, classes: nextClasses },
          };
        });

        if (blockedMessage) get().showToast(blockedMessage, 'error');
        if (createdUndoId) {
          get().showToast(translations[language].levelDecreased, 'success');
          scheduleSafetyUndoExpiry(createdUndoId, (undoId) => {
            set((state) => state.safetyUndoAction?.id === undoId ? { safetyUndoAction: null } : {});
          });
        }
      },

      warnStudent: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const currentClass = state.data.classes[currentClassIndex];
        const targetStudent = currentClass.students.find(s => s.id === studentId);
        if (!targetStudent) return state;

        const now = Date.now();
        const currentWarnings = (targetStudent.activeWarningTimestamps || []).filter(t => now - t < 1000 * 60 * 60 * 24);
        const newWarnings = [...currentWarnings, now];
        const nextWarningCount = newWarnings.length;
        const triggersPenalty = nextWarningCount >= WARNING_THRESHOLD;
        
        const warningRecord = createDisciplineRecord('warning', nextWarningCount, now);
        const autoPenaltyRecord = createDisciplineRecord('autoPenalty', nextWarningCount, now);

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          students: currentClass.students.map((student) => {
            if (student.id !== studentId) return student;
            if (triggersPenalty) {
              return applyPenaltyToStudent(
                {
                  ...student,
                  activeWarningTimestamps: [],
                  disciplineRecords: [warningRecord, ...(student.disciplineRecords ?? [])].slice(0, MAX_ACTIVITY_RECORDS),
                },
                WARNING_AUTO_PENALTY,
                { nextWarningPoints: 0, record: autoPenaltyRecord, now, source: 'autoPenalty' },
                state.data.settings?.maxPoints ?? 700
              );
            }
            return {
              ...student,
              warningPoints: nextWarningCount,
              activeWarningTimestamps: newWarnings,
              disciplineRecords: [warningRecord, ...(student.disciplineRecords ?? [])].slice(0, MAX_ACTIVITY_RECORDS),
            };
          })
        };

        const tLang = translations[state.data.settings?.language || 'zh'];
        get().showToast(
          triggersPenalty ? tLang.warningTriggeredPenalty.replace('{name}', targetStudent.name)
            : tLang.warningIssued.replace('{name}', targetStudent.name).replace('{count}', nextWarningCount.toString()),
          triggersPenalty ? 'error' : 'success'
        );

        return { data: { ...state.data, classes: nextClasses } };
      }),

      removeWarning: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const currentClass = state.data.classes[currentClassIndex];
        const targetStudent = currentClass.students.find(s => s.id === studentId);
        if (!targetStudent || (!targetStudent.warningPoints && !(targetStudent.activeWarningTimestamps?.length))) return state;

        let active = targetStudent.activeWarningTimestamps || [];
        if (active.length > 0) {
          active = [...active];
          active.shift();
        }
        
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          students: currentClass.students.map((student) =>
            student.id === studentId ? { ...student, warningPoints: active.length, activeWarningTimestamps: active } : student
          )
        };

        get().showToast(state.data.settings?.language === 'en' ? `Removed 1 warning from ${targetStudent.name}` : `已為 ${targetStudent.name} 消除一次警告`, 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      disciplineStudent: (studentId, reason) => {
        const normalizedReason = normalizeSafetyReason(reason);
        const language = get().data.settings?.language || 'zh';
        if (!normalizedReason) {
          get().showToast(language === 'en' ? 'A reason is required.' : '必須填寫正式處罰理由。', 'error');
          return;
        }

        let createdUndoId = '';
        let blockedMessage = '';
        let studentName = '';
        set((state) => {
          const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
          if (currentClassIndex === -1) return state;
          const currentClass = state.data.classes[currentClassIndex];
          const targetStudent = currentClass.students.find((student) => student.id === studentId);
          if (!targetStudent) return state;
          studentName = targetStudent.name;

          const now = Date.now();
          if (state.safetyUndoAction && now <= state.safetyUndoAction.expiresAt) {
            blockedMessage = language === 'en'
              ? 'Finish or undo the current safety action first.'
              : '請先完成或撤銷目前的正式操作。';
            return state;
          }
          if (isPenaltyActive(targetStudent.penaltyStatus, now)) {
            blockedMessage = language === 'en'
              ? 'This student already has an active penalty.'
              : '這位學生已有生效中的正式處罰。';
            return state;
          }

          const penalizedStudent = applyPenaltyToStudent(
            { ...targetStudent, activeWarningTimestamps: [] },
            DIRECT_DISCIPLINE_PENALTY,
            { nextWarningPoints: 0, now, source: 'discipline' },
            state.data.settings?.maxPoints ?? 700,
          );
          const effect = createSafetyActionEffect(targetStudent, penalizedStudent);
          const disciplineRecord = createDisciplineRecord('discipline', undefined, now, {
            actionKind: 'discipline',
            reason: normalizedReason,
            safetyEffect: effect,
          });
          const updatedStudent = {
            ...penalizedStudent,
            disciplineRecords: appendRecord(targetStudent.disciplineRecords, disciplineRecord),
          };
          const undoId = `undo-safety-${now}-${Math.random().toString(36).slice(2, 8)}`;
          createdUndoId = undoId;
          const nextClasses = [...state.data.classes];
          nextClasses[currentClassIndex] = {
            ...currentClass,
            students: currentClass.students.map((student) =>
              student.id === studentId ? updatedStudent : student
            ),
          };

          return {
            safetyUndoAction: {
              id: undoId,
              classId: currentClass.id,
              studentId,
              originalRecordId: disciplineRecord.id,
              actionKind: 'discipline',
              label: language === 'en'
                ? `Formal consequence applied to ${targetStudent.name}`
                : `已對 ${targetStudent.name} 套用正式處罰`,
              expiresAt: now + SAFETY_UNDO_WINDOW_MS,
            },
            data: { ...state.data, classes: nextClasses },
          };
        });

        if (blockedMessage) get().showToast(blockedMessage, 'error');
        if (createdUndoId) {
          get().showToast(
            translations[language].disciplineApplied.replace('{name}', studentName),
            'error',
          );
          scheduleSafetyUndoExpiry(createdUndoId, (undoId) => {
            set((state) => state.safetyUndoAction?.id === undoId ? { safetyUndoAction: null } : {});
          });
        }
      },

      undoLastSafetyAction: () => {
        const undoAction = get().safetyUndoAction;
        if (!undoAction) return;
        if (safetyUndoTimer) {
          clearTimeout(safetyUndoTimer);
          safetyUndoTimer = undefined;
        }

        let didUndo = false;
        set((state) => {
          if (state.safetyUndoAction?.id !== undoAction.id || Date.now() > undoAction.expiresAt) {
            return { safetyUndoAction: null };
          }
          const classIndex = state.data.classes.findIndex(
            (classData) => classData.id === undoAction.classId,
          );
          if (classIndex === -1) return { safetyUndoAction: null };

          const currentClass = state.data.classes[classIndex];
          const targetStudent = currentClass.students.find(
            (student) => student.id === undoAction.studentId,
          );
          const originalRecord = targetStudent?.disciplineRecords?.find(
            (record) => record.id === undoAction.originalRecordId,
          );
          if (!targetStudent || !originalRecord?.safetyEffect) {
            return { safetyUndoAction: null };
          }

          const now = Date.now();
          const reversalRecord = createDisciplineRecord('reversal', undefined, now, {
            actionKind: undoAction.actionKind,
            reason: originalRecord.reason,
            reversesRecordId: originalRecord.id,
          });
          const reversedStudent = applySafetyActionReversal(
            targetStudent,
            originalRecord.safetyEffect,
            reversalRecord,
            state.data.settings?.maxPoints ?? 700,
          );
          didUndo = true;
          const nextClasses = [...state.data.classes];
          nextClasses[classIndex] = {
            ...currentClass,
            students: currentClass.students.map((student) =>
              student.id === targetStudent.id ? reversedStudent : student
            ),
          };
          return {
            safetyUndoAction: null,
            data: { ...state.data, classes: nextClasses },
          };
        });

        if (didUndo) {
          const language = get().data.settings?.language || 'zh';
          get().showToast(
            language === 'en'
              ? 'Reversal recorded; the original record was retained.'
              : '已建立撤銷補償紀錄，原始紀錄仍保留。',
            'success',
          );
        }
      },

      removePenalty: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const targetStudent = state.data.classes[currentClassIndex].students.find(s => s.id === studentId);
        if (!targetStudent) return state;

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s =>
            s.id === studentId ? { ...s, penaltyStatus: undefined } : s
          )
        };
        
        get().showToast(state.data.settings?.language === 'en' ? `Removed penalty from ${targetStudent.name}` : `已為 ${targetStudent.name} 解除虛弱狀態`, 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      resetSeason: () => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const settings = state.data.settings;
        const enableRewards = settings?.enableSeasonResetRewards ?? false;
        const rewards = settings?.seasonResetRewards ?? { diamond: 500, platinum: 400, gold: 300, silver: 200, bronze: 100 };
        const brackets = settings?.rankBrackets ?? { diamond: 400, platinum: 300, gold: 200, silver: 100 };
        const maxPoints = settings?.maxPoints ?? 700;
        const now = Date.now();

        const getRewardForRank = (rp: number) => {
          if (rp >= brackets.diamond) return rewards.diamond;
          if (rp >= brackets.platinum) return rewards.platinum;
          if (rp >= brackets.gold) return rewards.gold;
          if (rp >= brackets.silver) return rewards.silver;
          return rewards.bronze;
        };

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => {
            let nextStudent = s;

            if (enableRewards) {
              const rewardAmount = getRewardForRank(s.rankPoints ?? 0);
              if (rewardAmount > 0) {
                nextStudent = applyPointAdjustmentToStudent(
                  nextStudent, 
                  rewardAmount, 
                  createPointAdjustmentRecord(
                    rewardAmount,
                    'manual',
                    { id: 'season-reset', label: '賽季結算獎勵', competency: 'growth' },
                    now,
                  ),
                  maxPoints
                );
              }
            }

            return {
              ...nextStudent,
              stats: { wins: 0, losses: 0 }, 
              rankPoints: 0, 
              warningPoints: 0, 
              penaltyStatus: undefined
            };
          })
        };
        get().showToast(translations[state.data.settings?.language || 'zh'].resetSeason, 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      feedPet: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const student = state.data.classes[currentClassIndex].students.find(s => s.id === studentId);
        const feedCost = state.data.settings?.feedCost ?? 10;
        
        if (!student || student.points < feedCost) return state;

        get().triggerPetAnimation(studentId, 'feed', 1000);
        const now = Date.now();

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId 
              ? applyFeedToStudent(s, feedCost, state.data.settings?.feedGain ?? 20, now, state.data.settings?.maxPoints ?? 700)
              : s
          )
        };
        return { data: { ...state.data, classes: nextClasses } };
      }),

      playWithPet: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const student = state.data.classes[currentClassIndex].students.find(s => s.id === studentId);
        const playCost = state.data.settings?.playCost ?? 5;
        
        if (!student || student.points < playCost) return state;

        get().triggerPetAnimation(studentId, 'play', 1000);
        const now = Date.now();

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId 
              ? applyPlayWithPet(s, playCost, state.data.settings?.playGain ?? 15, now, state.data.settings?.maxPoints ?? 700)
              : s
          )
        };
        return { data: { ...state.data, classes: nextClasses } };
      }),

      claimDailyTask: (studentId) => {
        let claimed = false;
        set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const currentClass = state.data.classes[currentClassIndex];
        const targetStudent = currentClass.students.find(s => s.id === studentId);
        if (!targetStudent) return state;

        const tLang = translations[state.data.settings?.language || 'zh'];
        const now = Date.now();
        const result = claimDailyTaskForStudent(
          targetStudent,
          now,
          state.data.settings?.maxPoints ?? 700,
          tLang.dailyTaskRecord,
          {
            timeZone: currentClass.dailyTaskCalendar?.schoolTimeZone ?? state.data.settings?.schoolTimeZone,
            schoolWeekdays: currentClass.dailyTaskCalendar?.schoolWeekdays ?? state.data.settings?.schoolWeekdays,
            holidayDates: currentClass.dailyTaskCalendar?.schoolHolidayDates ?? state.data.settings?.schoolHolidayDates,
            excusedDates: targetStudent.dailyProgress?.excusedDates,
            makeupWindowDays: currentClass.dailyTaskCalendar?.dailyTaskMakeupWindowDays ?? state.data.settings?.dailyTaskMakeupWindowDays,
          },
        );

        if (!result.claimed) {
          get().showToast(
            result.frozen
              ? (tLang.dailyTaskFrozen ?? '今天不是上課日，連續紀錄已凍結')
              : (tLang.dailyTaskDone ?? '今日已完成'),
            result.frozen ? 'success' : 'error',
          );
          return state;
        }

        const projectedStudents = currentClass.students.map((student) =>
          student.id === studentId ? result.student : student,
        );
        const support = applyParticipationSupportToStudent(
          result.student,
          projectedStudents,
          now,
          state.data.settings?.maxPoints ?? 700,
          getParticipationSupportOptions(state.data.settings),
        );
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          students: currentClass.students.map((student) =>
            student.id === studentId ? support.student : student,
          ),
        };

        const supportNotice = getParticipationSupportNotice(
          state.data.settings?.language || 'zh',
          [{
            studentId,
            requestedAmount: result.rewardPoints,
            appliedAmount: result.rewardPoints,
            outcome: 'applied',
            participationTopUp: support.participationTopUp,
            catchUpBonus: support.catchUpBonus,
          }],
        );
        get().showToast(
          [
            (result.claimKind === 'makeup'
            ? (tLang.dailyTaskMakeupReward ?? '已補簽 {date} 的每日任務！')
            : (tLang.dailyTaskReward ?? '完成每日任務，獲得 {points} 積分與 {happiness} 心情'))
              .replace('{points}', String(result.rewardPoints))
              .replace('{happiness}', String(DAILY_TASK_REWARD_HAPPINESS))
              .replace('{date}', result.effectiveDate),
            supportNotice,
          ].filter(Boolean).join(' '),
          'success'
        );
        claimed = true;
        return { data: { ...state.data, classes: nextClasses } };
        });
        return claimed;
      },

      setDailyTaskExcusedDate: (studentId, date, excused) => set((state) => {
        if (!isDateKey(date)) return state;
        const currentClassIndex = state.data.classes.findIndex(
          (classData) => classData.id === state.data.currentClassId,
        );
        if (currentClassIndex === -1) return state;
        const nextClasses = [...state.data.classes];
        let changed = false;
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map((student) => {
            if (student.id !== studentId) return student;
            const currentDates = normalizeDateKeyList(student.dailyProgress?.excusedDates, 120);
            const nextDates = excused
              ? normalizeDateKeyList([...currentDates, date], 120)
              : currentDates.filter((item) => item !== date);
            if (nextDates.length === currentDates.length &&
                nextDates.every((item, index) => item === currentDates[index])) {
              return student;
            }
            changed = true;
            return {
              ...student,
              dailyProgress: {
                lastClaimDate: student.dailyProgress?.lastClaimDate,
                streak: student.dailyProgress?.streak ?? 0,
                reflections: student.dailyProgress?.reflections,
                excusedDates: nextDates,
              },
            };
          }),
        };
        if (!changed) return state;
        const tLang = translations[state.data.settings?.language || 'zh'];
        get().showToast(tLang.dailyTaskExcusedUpdated ?? '學生請假日已更新', 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      saveMentorDailyFeedback: (studentId, feedback) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const currentClass = state.data.classes[currentClassIndex];
        const targetStudent = currentClass.students.find((student) => student.id === studentId);
        if (!targetStudent) return state;

        const now = Date.now();
        const timeZone = currentClass.dailyTaskCalendar?.schoolTimeZone ??
          state.data.settings?.schoolTimeZone;
        const result = saveMentorDailyFeedbackForStudent(
          targetStudent,
          feedback,
          now,
          timeZone,
        );
        if (!result.saved) return state;
        const savedReflection = result.student.dailyProgress?.reflections?.find(
          (reflection) =>
            reflection.author === 'mentor' &&
            reflection.date === getDateKey(now, timeZone),
        );
        const currentEvidence = currentClass.learningEvidenceRecords ?? [];

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          students: currentClass.students.map((student) =>
            student.id === studentId ? result.student : student,
          ),
          learningEvidenceRecords: savedReflection
            ? syncMentorFeedbackEvidence(
                currentEvidence,
                currentClass.id,
                studentId,
                savedReflection,
              )
            : currentEvidence,
        };
        const tLang = translations[state.data.settings?.language || 'zh'];
        get().showToast(
          result.updated ? tLang.dailyFeedbackUpdated : tLang.dailyFeedbackSaved,
          'success',
        );
        return { data: { ...state.data, classes: nextClasses } };
      }),

      addLearningEvidence: (studentId, evidence) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(
          (classData) => classData.id === state.data.currentClassId,
        );
        if (currentClassIndex === -1 || !evidence.title.trim()) return state;
        const currentClass = state.data.classes[currentClassIndex];
        const targetStudent = currentClass.students.find((student) => student.id === studentId);
        if (!targetStudent) return state;

        const now = Date.now();
        const record = createLearningEvidenceRecord(
          currentClass.id,
          studentId,
          {
            ...evidence,
            actor: 'mentor',
            source: 'manual',
            rubricVersion: evidence.rubricVersion ?? '1.0',
          },
          now,
        );
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          learningEvidenceRecords: [
            record,
            ...(currentClass.learningEvidenceRecords ?? []),
          ].slice(0, MAX_LEARNING_EVIDENCE_RECORDS),
        };
        const lang = state.data.settings?.language || 'zh';
        get().showToast(translations[lang].learningEvidenceSaved, 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      revivePet: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const targetStudent = state.data.classes[currentClassIndex].students.find(s => s.id === studentId);
        if (!targetStudent) return state;

        const tLang = translations[state.data.settings?.language || 'zh'];
        const reviveCost = state.data.settings?.reviveCost ?? 120;

        if (targetStudent.points < reviveCost) {
          get().showToast(tLang.reviveNeedPoints.replace('{cost}', reviveCost.toString()), 'error');
          return state;
        }

        const now = Date.now();
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => s.id === studentId ? reviveStudentPet(s, reviveCost, state.data.settings?.maxPoints ?? 700, now) : s)
        };

        const publicName = getPublicStudentName(
          targetStudent.name,
          state.data.settings?.publicNameMode === 'full' ? 'full' : 'masked',
        );
        get().showToast((tLang.reviveSuccess ?? '{name} 的寵物已復活').replace('{name}', publicName), 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      upgradePet: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const student = state.data.classes[currentClassIndex].students.find(s => s.id === studentId);
        if (!student) return state;

        const tLang = translations[state.data.settings?.language || 'zh'];
        const currentLevel = student.pet.level || 1;
        if (currentLevel >= 10) { get().showToast(tLang.petMaxLevel, 'error'); return state; }
        if (student.pet.fullness < 100) { get().showToast(tLang.fullnessNeed100, 'error'); return state; }
        if ((student.pet.happiness || 0) < 40) { get().showToast(tLang.moodLowPenalty, 'error'); return state; }
        
        const upgradeCost = 100 + (currentLevel - 1) * 50;
        if (student.points < upgradeCost) {
          get().showToast(tLang.upgradeNeedPoints.replace('{cost}', upgradeCost.toString()), 'error'); return state;
        }

        const nextLevel = currentLevel + 1;
        const now = Date.now();
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s =>
            s.id === studentId
              ? appendEconomyEventToStudent(
                  { ...s, points: s.points - upgradeCost, pet: { ...s.pet, level: nextLevel } },
                  createEconomyEventRecord('spend', 'upgrade', -upgradeCost, now),
                )
              : s
          )
        };

        const publicName = getPublicStudentName(
          student.name,
          state.data.settings?.publicNameMode === 'full' ? 'full' : 'masked',
        );
        get().showToast(tLang.petUpgraded.replace('{name}', publicName).replace('{level}', nextLevel.toString()), 'success');

        const nextRewardLevel = student.nextUpgradeGachaLevel ?? getUpcomingUpgradeGachaLevel(currentLevel);
        if (nextRewardLevel !== null && nextLevel === nextRewardLevel) {
          get().setUpgradeReward({ studentId, studentName: publicName, reachedLevel: nextLevel });
          get().showToast(tLang.upgradeGachaUnlocked.replace('{name}', publicName).replace('{level}', nextLevel.toString()), 'success');
        }

        return { data: { ...state.data, classes: nextClasses } };
      }),

      gachaPet: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const student = state.data.classes[currentClassIndex].students.find(s => s.id === studentId);
        if (!student || student.points < 200) return state;

        const newPetType = getRandomPetType(true);
        const now = Date.now();
        get().triggerPetAnimation(studentId, 'gacha', 1500);

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s =>
            s.id === studentId
              ? appendEconomyEventToStudent(
                  { ...s, points: s.points - 200, pet: { ...s.pet, type: newPetType } },
                  createEconomyEventRecord('spend', 'gacha', -200, now, {
                    previousPetType: s.pet.type,
                    newPetType,
                  }),
                )
              : s
          )
        };
        const lang = state.data.settings?.language || 'zh';
        get().showToast(translations[lang].gachaResult.replace('{pet}', (petNames[lang] as any)[newPetType]), 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      rerollPetFromUpgrade: (studentId, claimedLevel) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const newPetType = getRandomPetType(true);
        const now = Date.now();
        get().triggerPetAnimation(studentId, 'reroll', 1800);

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s =>
            s.id === studentId
              ? appendEconomyEventToStudent(
                  {
                    ...s,
                    pet: { ...s.pet, type: newPetType, level: UPGRADE_REWARD_LEVEL, fullness: UPGRADE_REWARD_FULLNESS, happiness: UPGRADE_REWARD_HAPPINESS },
                    nextUpgradeGachaLevel: getNextUpgradeGachaLevel(claimedLevel),
                  },
                  createEconomyEventRecord('petChange', 'upgradeReroll', 0, now, {
                    previousPetType: s.pet.type,
                    newPetType,
                  }),
                )
              : s
          )
        };
        const targetStudent = nextClasses[currentClassIndex].students.find(s => s.id === studentId);
        const lang = state.data.settings?.language || 'zh';
        const publicName = getPublicStudentName(
          targetStudent?.name || '',
          state.data.settings?.publicNameMode === 'full' ? 'full' : 'masked',
        );
        get().showToast(translations[lang].upgradeGachaChanged.replace('{name}', publicName).replace('{pet}', (petNames[lang] as any)[newPetType]), 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      advanceUpgradeRewardProgress: (studentId, claimedLevel) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId ? { ...s, nextUpgradeGachaLevel: getNextUpgradeGachaLevel(claimedLevel) } : s
          )
        };
        return { data: { ...state.data, classes: nextClasses } };
      }),

      setTeammate: (studentId, teammateIds = []) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        
        const currentClass = state.data.classes[currentClassIndex];
        const maxTeamSize = state.data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE;
        const selectedIds = Array.from(new Set(teammateIds))
          .filter((id) => id !== studentId && currentClass.students.some((s) => s.id === id))
          .slice(0, maxTeamSize - 1);
        
        const memberIds = [studentId, ...selectedIds];
        const teamIdsToClear = new Set(
          currentClass.students.filter(s => memberIds.includes(s.id) && s.teamId).map(s => s.teamId as string)
        );
        
        const nextTeamId = selectedIds.length > 0 ? createTeamId() : undefined;
        const nextStudents = sanitizeTeamAssignments(
          currentClass.students.map((student) => {
            if (student.teamId && teamIdsToClear.has(student.teamId)) return { ...student, teamId: undefined };
            if (nextTeamId && memberIds.includes(student.id)) return { ...student, teamId: nextTeamId };
            return student;
          }),
          maxTeamSize
        );

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = { ...currentClass, students: nextStudents };

        const publicNameMode = state.data.settings?.publicNameMode === 'full' ? 'full' : 'masked';
        const teamOwner = currentClass.students.find(s => s.id === studentId);
        const teamOwnerName = getPublicStudentName(teamOwner?.name || '', publicNameMode);
        const teammateNames = currentClass.students
          .filter(s => selectedIds.includes(s.id))
          .map(s => getPublicStudentName(s.name, publicNameMode));
        const lang = state.data.settings?.language || 'zh';

        get().showToast(
          selectedIds.length > 0
            ? lang === 'en' ? `${teamOwnerName} formed a team with ${teammateNames.join(', ')}.` : `${teamOwnerName} 已和 ${teammateNames.join('、')} 組成隊伍。`
            : lang === 'en' ? `${teamOwnerName} cleared the team.` : `${teamOwnerName} 已解除隊伍。`,
          'success'
        );

        return { data: { ...state.data, classes: nextClasses } };
      }),

      battle: (attackerId, defenderId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const tLang = translations[state.data.settings?.language || 'zh'];
        if (state.data.settings?.battleEnabled === false) {
          get().showToast(tLang.battleDisabledByTeacher, 'error');
          return state;
        }
        
        const currentClass = state.data.classes[currentClassIndex];
        const attacker = currentClass.students.find(s => s.id === attackerId);
        const defender = currentClass.students.find(s => s.id === defenderId);
        if (!attacker || !defender) return state;

        const now = Date.now();
        const maxTeamSize = state.data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE;
        const battleMode = state.data.settings?.battleMode ?? DEFAULT_BATTLE_MODE;
        const teamBattleMinFullnessEnabled = state.data.settings?.teamBattleMinFullnessEnabled ?? TEAM_BATTLE_MIN_FULLNESS_ENABLED;
        const teamBattleMinFullness = state.data.settings?.teamBattleMinFullness ?? TEAM_BATTLE_MIN_FULLNESS;
        const soloBattleWinPoints = state.data.settings?.soloBattleWinPoints ?? SOLO_BATTLE_WIN_POINTS;
        const soloBattleLossPoints = state.data.settings?.soloBattleLossPoints ?? SOLO_BATTLE_LOSS_POINTS;
        const soloBattleReadyOptions = { minimumFullness: SOLO_BATTLE_MIN_FULLNESS };
        const teamBattleReadyOptions = {
          minimumFullness: teamBattleMinFullness,
          ignoreFullness: !teamBattleMinFullnessEnabled,
        };

        const attackerMembers = [
          attacker,
          ...getTeamMembers(currentClass.students, attacker, maxTeamSize).filter(
            (member) => member.id !== attacker.id && isBattleReady(member, now, teamBattleReadyOptions),
          ),
        ]
          .slice(0, maxTeamSize)
          .map((member) => ({ id: member.id, student: member }));
        const defenderMembers = [
          defender,
          ...getTeamMembers(currentClass.students, defender, maxTeamSize).filter(
            (member) => member.id !== defender.id && isBattleReady(member, now, teamBattleReadyOptions),
          ),
        ]
          .slice(0, maxTeamSize)
          .map((member) => ({ id: member.id, student: member }));

        const canRunTeamBattle = attackerMembers.length >= 2 && defenderMembers.length >= 2;

        if (battleMode === 'team' && !canRunTeamBattle) {
          get().showToast(
            state.data.settings?.language === 'en'
              ? `Team battle mode requires at least 2 eligible members per side${teamBattleMinFullnessEnabled ? ` (fullness >= ${teamBattleMinFullness})` : ''}.`
              : `隊伍賽模式要求雙方都至少有 2 位符合條件的成員${teamBattleMinFullnessEnabled ? `（飽食度需 >= ${teamBattleMinFullness}）` : ''}。`,
            'error',
          );
          return state;
        }

        const maxPoints = state.data.settings?.maxPoints ?? 700;
        const battleOptions = { 
          battleRankPointsWin: state.data.settings?.battleRankPointsWin,
          battleRankPointsLoss: state.data.settings?.battleRankPointsLoss,
          soloBattleFullnessCost: state.data.settings?.soloBattleFullnessCost,
          soloBattleAttackerFullnessCost: state.data.settings?.soloBattleAttackerFullnessCost,
          soloBattleDefenderFullnessCost: state.data.settings?.soloBattleDefenderFullnessCost,
          soloBattleWinPoints: state.data.settings?.soloBattleWinPoints,
          soloBattleLossPoints: state.data.settings?.soloBattleLossPoints,
          teamBattleMinFullnessEnabled,
          teamBattleMinFullness,
          teamBattleAttackerFullnessCost: state.data.settings?.teamBattleAttackerFullnessCost,
          teamBattleAttackerTeammateFullnessCost: state.data.settings?.teamBattleAttackerTeammateFullnessCost,
          teamBattleDefenderFullnessCost: state.data.settings?.teamBattleDefenderFullnessCost,
          teamBattleDefenderTeammateFullnessCost: state.data.settings?.teamBattleDefenderTeammateFullnessCost,
        };
        
        const battleResult =
          battleMode === 'team' || (battleMode === 'both' && canRunTeamBattle)
            ? {
                ...resolveTeamBattle(
                  attackerMembers,
                  defenderMembers,
                  {
                    attackers: attackerMembers.map(() => Math.floor(Math.random() * 20)),
                    defenders: defenderMembers.map(() => Math.floor(Math.random() * 20)),
                  },
                  battleOptions,
                  now,
                  maxPoints,
                ),
                mode: 'team' as const,
              }
            : (() => {
                const singleResult = resolveBattle(
                  attacker,
                  defender,
                  { attacker: Math.floor(Math.random() * 20), defender: Math.floor(Math.random() * 20) },
                  battleOptions,
                  now,
                  maxPoints,
                );
                if (singleResult.blocked) return singleResult;
                return {
                  ...singleResult,
                  mode: 'solo' as const,
                  updated: { [attacker.id]: singleResult.attacker, [defender.id]: singleResult.defender },
                };
              })();

        if (battleResult.blocked === 'penalty') { get().showToast(tLang.battleBlockedByPenalty, 'error'); return state; }
        if (battleResult.blocked === 'dead') { get().showToast(tLang.battleBlockedByDeath ?? '寵物已死亡，必須先復活', 'error'); return state; }
        if (battleResult.blocked === 'happiness') {
          get().showToast(state.data.settings?.language === 'en' ? 'Mood too low to battle.' : '心情過低，無法對戰。', 'error');
          return state;
        }
        if (battleResult.blocked === 'fullness') {
          const requiredFullness = (battleResult as any).mode === 'team' ? teamBattleMinFullness : SOLO_BATTLE_MIN_FULLNESS;
          get().showToast((tLang.fullnessNeed50Battle ?? '').replace('{value}', requiredFullness.toString()), 'error');
          return state;
        }
        if (battleResult.blocked === 'invalid') return state;

        const teamReward = (battleResult as any).teamReward;
        const isTeamBattle = (battleResult as any).mode === 'team';

        if (battleResult.outcome === 'win') {
          get().showToast(
            isTeamBattle && teamReward
              ? (state.data.settings?.language === 'en' ? `Team battle won. Team bonus +${teamReward.bonusPoints} pts / +${teamReward.bonusHappiness} mood.` : `隊伍對戰獲勝，啟動隊伍獎勵：+${teamReward.bonusPoints} 積分 / +${teamReward.bonusHappiness} 心情。`)
              : (state.data.settings?.language === 'en' ? `Battle won! +${soloBattleWinPoints} points` : `對戰勝利！+${soloBattleWinPoints} 積分`),
            'success'
          );
        } else if (battleResult.outcome === 'loss') {
          get().showToast(
            isTeamBattle
              ? (state.data.settings?.language === 'en' ? 'Team battle lost.' : '隊伍對戰失敗。')
              : (state.data.settings?.language === 'en' ? `Battle lost! -${soloBattleLossPoints} points` : `對戰失敗！-${soloBattleLossPoints} 積分`),
            'error',
          );
        } else {
          get().showToast(isTeamBattle ? (state.data.settings?.language === 'en' ? 'Team battle draw.' : '隊伍對戰平手。') : tLang.battleDraw, 'success');
        }

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          students: currentClass.students.map(s => (battleResult as any).updated?.[s.id] ?? s)
        };
        return { data: { ...state.data, classes: nextClasses } };
      }),

      summonBoss: (
        name,
        maxHp,
        rewardTiers,
        participationReward = DEFAULT_BOSS_PARTICIPATION_REWARD,
        improvementReward = DEFAULT_BOSS_IMPROVEMENT_REWARD,
      ) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const now = Date.now();
        const safeMaxHp = Math.max(1, Math.floor(toFiniteNumber(maxHp, 1)));
        const activeBoss = normalizeWorldBoss(
          {
            id: `boss-${now}`,
            name,
            maxHp: safeMaxHp,
            currentHp: safeMaxHp,
            rewardTiers,
            participationReward,
            improvementReward,
            contributions: {},
            attackCounts: {},
            isActive: true,
          },
          currentClassIndex,
          now,
        );
        if (!activeBoss) return state;

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          activeBoss,
        };
        const lang = state.data.settings?.language || 'zh';
        get().showToast(lang === 'en' ? `Summoned Boss: ${activeBoss.name}` : `已召喚魔王：${activeBoss.name}`, 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      removeBoss: () => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = { ...nextClasses[currentClassIndex], activeBoss: undefined };
        get().showToast(translations[state.data.settings?.language || 'zh'].removeBoss, 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      dismissBossVictory: () => set({ showBossVictory: false, bossVictoryResult: null }),

      executeBossAttack: () => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const currentClass = state.data.classes[currentClassIndex];
        if (!currentClass.activeBoss?.isActive) return state;

        const members = currentClass.students.map((student) => ({ id: student.id, student }));
        const now = Date.now();
        const attackMode = state.data.settings?.bossAttackMode ?? 'recoverable';
        const result = attackMode === 'recoverable'
          ? resolveRecoverableBossAttack(
              members,
              state.data.settings?.bossAttackDamage ?? DEFAULT_BOSS_ATTACK_DAMAGE,
              state.data.settings?.bossRecoveryMinutes ?? DEFAULT_BOSS_RECOVERY_MINUTES,
              now,
            )
          : attackMode === 'shared'
            ? resolveSharedBossAttack(
              members,
              state.data.settings?.bossAttackDamage ?? DEFAULT_BOSS_ATTACK_DAMAGE,
              now,
            )
            : resolveBossAttack(
                members,
                state.data.settings?.bossAttackMaxTargets ?? DEFAULT_BOSS_ATTACK_MAX_TARGETS,
                state.data.settings?.bossAttackDamage ?? DEFAULT_BOSS_ATTACK_DAMAGE,
                Math.random,
                now,
              );
        const targetIdSet = new Set(result.targetIds);
        const publicNameMode =
          state.data.settings?.publicNameMode === 'full' ? 'full' : 'masked';
        const targetNames = currentClass.students
          .filter((student) => targetIdSet.has(student.id))
          .map((student) => getPublicStudentName(student.name, publicNameMode));
        const feedback = {
          targetNames,
          damage: result.damage,
          id: now,
          mode: attackMode,
          recoverAt: attackMode === 'recoverable' &&
            'recoverAt' in result &&
            typeof result.recoverAt === 'number'
              ? result.recoverAt
              : undefined,
        };
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          students: currentClass.students.map((student) => result.updated[student.id] ?? student),
        };

        const lang = state.data.settings?.language || 'zh';
        const tLang = translations[lang];
        get().showToast(
          targetNames.length === 0
            ? (lang === 'en' ? 'The boss attack missed every pet.' : '魔王本次攻擊沒有命中任何寵物。')
            : attackMode === 'recoverable'
              ? tLang.bossAttackRecoverableResult
                  .replace('{count}', targetNames.length.toString())
                  .replace('{impact}', result.damage.toString())
                  .replace(
                    '{minutes}',
                    String(state.data.settings?.bossRecoveryMinutes ?? DEFAULT_BOSS_RECOVERY_MINUTES),
                  )
              : attackMode === 'shared'
              ? tLang.bossAttackSharedResult
                  .replace('{count}', targetNames.length.toString())
                  .replace('{damage}', result.damage.toString())
              : (lang === 'en'
                  ? `Boss hit ${targetNames.join(', ')} for ${result.damage} fullness.`
                  : `魔王攻擊 ${targetNames.join('、')}，各造成 ${result.damage} 點飽食度傷害。`),
          targetNames.length === 0 || attackMode === 'recoverable' ? 'success' : 'error',
        );
        if (bossAttackFeedbackTimer) clearTimeout(bossAttackFeedbackTimer);
        bossAttackFeedbackTimer = setTimeout(() => {
          set({ bossAttackFeedback: null });
          bossAttackFeedbackTimer = undefined;
        }, 3000);

        return {
          bossAttackFeedback: feedback,
          data: { ...state.data, classes: nextClasses },
        };
      }),

      clearBossRecovery: () => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const currentClass = state.data.classes[currentClassIndex];
        if (!currentClass.students.some((student) => student.bossRecovery)) return state;
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          students: currentClass.students.map((student) => (
            student.bossRecovery ? { ...student, bossRecovery: undefined } : student
          )),
        };
        const lang = state.data.settings?.language || 'zh';
        get().showToast(
          lang === 'en' ? 'The class regroup is complete.' : '全班已完成整隊，護盾休整狀態已解除。',
          'success',
        );
        return { data: { ...state.data, classes: nextClasses } };
      }),

      executeAttackBoss: async (studentId) => {
        const state = get();
        const currentClassIndex = state.data.classes.findIndex(
          (classData) => classData.id === state.data.currentClassId,
        );
        if (currentClassIndex === -1) return;

        const currentClass = state.data.classes[currentClassIndex];
        if (!currentClass.activeBoss?.isActive) return;
        const targetStudent = currentClass.students.find(
          (student) => student.id === studentId,
        );
        if (!targetStudent) return;

        const now = Date.now();
        const result = attackWorldBoss(targetStudent, currentClass.activeBoss, now);
        const tLang = translations[state.data.settings?.language || 'zh'];
        if (result.blocked === 'penalty') {
          get().showToast(tLang.battleBlockedByPenalty, 'error');
          return;
        }
        if (result.blocked === 'dead') {
          get().showToast(tLang.battleBlockedByDeath ?? '寵物已死亡，無法討伐', 'error');
          return;
        }
        if (result.blocked === 'fullness') {
          get().showToast(
            (tLang.battleNeedFullness ?? '').replace(
              '{value}',
              BOSS_ATTACK_FULLNESS_COST.toString(),
            ),
            'error',
          );
          return;
        }
        if (!result.updatedStudent || !result.updatedBoss) return;

        get().triggerPetAnimation(studentId, 'attack', 500);
        get().showToast(
          (tLang.bossDamage ?? 'Dealt {damage} damage!').replace(
            '{damage}',
            (result.damageDealt || 0).toString(),
          ),
          'success',
        );
        set({ bossHitFeedback: { damage: result.damageDealt || 0, id: now } });
        if (bossHitFeedbackTimer) clearTimeout(bossHitFeedbackTimer);
        bossHitFeedbackTimer = setTimeout(() => {
          set({ bossHitFeedback: null });
          bossHitFeedbackTimer = undefined;
        }, 800);

        const studentsAfterAttack = currentClass.students.map((student) =>
          student.id === studentId ? result.updatedStudent! : student,
        );
        if (!result.isDefeated) {
          set((latestState) => {
            const classIndex = latestState.data.classes.findIndex(
              (classData) => classData.id === currentClass.id,
            );
            if (classIndex === -1) return latestState;
            const nextClasses = [...latestState.data.classes];
            nextClasses[classIndex] = {
              ...nextClasses[classIndex],
              students: studentsAfterAttack,
              activeBoss: result.updatedBoss,
            };
            return { data: { ...latestState.data, classes: nextClasses } };
          });
          return;
        }

        const maxPoints = state.data.settings?.maxPoints ?? 700;
        const rewardResult = applyBossContributionRewards(
          studentsAfterAttack,
          result.updatedBoss,
          now,
          maxPoints,
        );
        void resolveBossRewardsOnBackend(
          studentsAfterAttack,
          result.updatedBoss,
          now,
          maxPoints,
        ).catch(() => undefined);

        set((latestState) => {
          const classIndex = latestState.data.classes.findIndex(
            (classData) => classData.id === currentClass.id,
          );
          if (classIndex === -1) return latestState;
          const latestClass = latestState.data.classes[classIndex];
          if (latestClass.activeBoss?.id !== result.updatedBoss!.id) return latestState;
          const nextClasses = [...latestState.data.classes];
          nextClasses[classIndex] = {
            ...latestClass,
            students: rewardResult.students,
            activeBoss: undefined,
          };
          return {
            showBossVictory: true,
            bossVictoryResult: {
              bossName: result.updatedBoss!.name,
              standings: rewardResult.standings,
            },
            data: { ...latestState.data, classes: nextClasses },
          };
        });
        get().showToast(
          (tLang.bossDefeated ?? '').replace('{name}', result.updatedBoss.name),
          'success',
        );
      },

      triggerDecay: () => set((state) => {
        const nextData = applyDecay(state.data, Date.now());
        return { data: nextData };
      })
    }),
    {
      name: STORE_PERSISTENCE_KEY,
      storage: createJSONStorage(() =>
        PII_CACHE_ENABLED ? localStorage : NOOP_STATE_STORAGE,
      ),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<StoreState> | undefined;
        return {
          ...currentState,
          data: normalizeAppData(persisted?.data ?? currentState.data, Date.now()),
        };
      },
      partialize: (state) => ({ data: state.data }),
      onRehydrateStorage: () => (state) => {
        if (state) state.triggerDecay();
      }
    }
  )
);

export const resetStoreForSession = (now = Date.now()) => {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = undefined;
  petAnimationTimers.forEach((timer) => clearTimeout(timer));
  petAnimationTimers.clear();
  if (bossHitFeedbackTimer) clearTimeout(bossHitFeedbackTimer);
  bossHitFeedbackTimer = undefined;
  if (bossAttackFeedbackTimer) clearTimeout(bossAttackFeedbackTimer);
  bossAttackFeedbackTimer = undefined;
  if (pointUndoTimer) clearTimeout(pointUndoTimer);
  pointUndoTimer = undefined;
  if (safetyUndoTimer) clearTimeout(safetyUndoTimer);
  safetyUndoTimer = undefined;

  useStore.setState({
    data: normalizeAppData({}, now),
    view: 'classroom',
    animatingPets: {},
    toast: null,
    upgradeReward: null,
    bossHitFeedback: null,
    bossAttackFeedback: null,
    showBossVictory: false,
    bossVictoryResult: null,
    undoAction: null,
    safetyUndoAction: null,
  });

  if (PII_CACHE_ENABLED) {
    void useStore.persist.clearStorage();
  }
};
