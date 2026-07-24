import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { 
  AppData, Student, ClassData, UpgradeRewardState, PetAnimationMode,
  PointAdjustmentSource, BattleMode, Language, BossRewardTier, BossVictoryResult,
  ClassGoal, LearningCompetency, BossReward, BossAttackMode,
} from './types';
import { 
  translations, STORAGE_KEY, DEFAULT_MAX_TEAM_SIZE,
  DEFAULT_BATTLE_MODE, petNames
} from './constants';
import { 
  normalizeAppData, applyDecay, getRandomPetType, 
  sanitizeTeamAssignments, getTeamMembers, createTeamId, normalizeWorldBoss
} from './utils';
import { 
  applyFeedToStudent, applyPlayWithPet, claimDailyTaskForStudent,
  reviveStudentPet, applyPointAdjustmentToStudent, createPointAdjustmentRecord,
  applyPenaltyToStudent, createDisciplineRecord, getNextUpgradeGachaLevel,
  getUpcomingUpgradeGachaLevel, resolveBattle, resolveTeamBattle,
  isBattleReady, attackWorldBoss, applyBossContributionRewards, resolveBossAttack, resolveSharedBossAttack,
  toFiniteNumber,
  BOSS_ATTACK_FULLNESS_COST, DIRECT_DISCIPLINE_PENALTY, WARNING_THRESHOLD,
  WARNING_AUTO_PENALTY, MAX_ACTIVITY_RECORDS, UPGRADE_REWARD_LEVEL,
  UPGRADE_REWARD_FULLNESS, UPGRADE_REWARD_HAPPINESS, DAILY_TASK_REWARD_HAPPINESS,
  SOLO_BATTLE_MIN_FULLNESS, SOLO_BATTLE_FULLNESS_COST, SOLO_BATTLE_WIN_POINTS,
  SOLO_BATTLE_LOSS_POINTS, TEAM_BATTLE_MIN_FULLNESS, TEAM_BATTLE_MIN_FULLNESS_ENABLED,
  TEAM_BATTLE_ATTACKER_FULLNESS_COST, TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_FULLNESS_COST, TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  DEFAULT_BOSS_ATTACK_MAX_TARGETS, DEFAULT_BOSS_ATTACK_DAMAGE,
  DEFAULT_BOSS_PARTICIPATION_REWARD, DEFAULT_BOSS_IMPROVEMENT_REWARD,
} from '../gameRules';

type StoreState = {
  data: AppData;
  view: 'dashboard' | 'classroom';
  animatingPets: Record<string, PetAnimationMode | undefined>;
  toast: { message: string; type: 'success' | 'error' } | null;
  upgradeReward: UpgradeRewardState | null;
  bossHitFeedback: { damage: number; id: number } | null;
  bossAttackFeedback: { targetNames: string[]; damage: number; id: number } | null;
  showBossVictory: boolean;
  bossVictoryResult: BossVictoryResult | null;

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
  setClassGoal: (goal: Pick<ClassGoal, 'title' | 'competency' | 'targetCount'> | null) => void;

  // Student CRUD
  addStudent: (student: Student) => void;
  deleteStudent: (studentId: string) => void;
  editStudentName: (studentId: string, newName: string) => void;
  
  // Student Stats & Discipline
  addPoints: (
    studentId: string,
    pointsToAdd: number,
    source?: PointAdjustmentSource,
    reason?: { id?: string; label?: string; competency?: LearningCompetency },
  ) => void;
  airdropPoints: (pointsToAdd: number, reasonLabel?: string, competency?: LearningCompetency) => void;
  decreaseLevel: (studentId: string) => void;
  warnStudent: (studentId: string) => void;
  removeWarning: (studentId: string) => void;
  disciplineStudent: (studentId: string) => void;
  removePenalty: (studentId: string) => void;
  resetSeason: () => void;
  
  // Interactions
  feedPet: (studentId: string) => void;
  playWithPet: (studentId: string) => void;
  claimDailyTask: (studentId: string) => void;
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
  executeAttackBoss: (studentId: string) => void;
  executeBossAttack: () => void;
  dismissBossVictory: () => void;

  // Lifecycle
  triggerDecay: () => void;
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const petAnimationTimers = new Map<string, ReturnType<typeof setTimeout>>();
let bossHitFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
let bossAttackFeedbackTimer: ReturnType<typeof setTimeout> | undefined;

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
        const newClass = { id: Date.now().toString(), name, students: [] };
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
        const normalizedData = normalizeAppData(importedData, now);
        const hydratedData = applyDecay(normalizedData, now);
        return { data: hydratedData };
      }),

      updateSettings: (newSettings) => set((state) => {
        const merged = { ...state.data.settings, ...newSettings };
        const safeMaxTeamSize = Math.max(2, Math.min(6, Math.floor(toFiniteNumber(merged.maxTeamSize, DEFAULT_MAX_TEAM_SIZE))));
        const safeTeamBattleMinFullness = Math.max(
          0,
          toFiniteNumber(merged.teamBattleMinFullness, TEAM_BATTLE_MIN_FULLNESS),
        );
        const safeSoloBattleFullnessCost = Math.max(
          0,
          toFiniteNumber(merged.soloBattleFullnessCost, SOLO_BATTLE_FULLNESS_COST),
        );
        
        const newData = {
          ...state.data,
          settings: {
            ...merged,
            decayAmount: Math.max(0, toFiniteNumber(merged.decayAmount, 2)),
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
            bossAttackMode: (merged.bossAttackMode === 'random' ? 'random' : 'shared') as BossAttackMode,
          }
        };
        get().showToast(translations[newData.settings.language || 'zh'].settingsSaved, 'success');
        return {
          data: {
            ...newData,
            classes: newData.classes.map(c => ({
              ...c,
              students: sanitizeTeamAssignments(c.students, safeMaxTeamSize),
            }))
          }
        };
      }),

      setClassGoal: (goal) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(
          (classData) => classData.id === state.data.currentClassId,
        );
        if (currentClassIndex === -1) return state;

        const now = Date.now();
        const nextClasses = [...state.data.classes];
        const currentGoal = nextClasses[currentClassIndex].classGoal;
        const canKeepProgress = currentGoal?.competency === goal?.competency;
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          classGoal: goal
            ? {
                id: canKeepProgress && currentGoal ? currentGoal.id : `goal-${now}`,
                title: goal.title.trim(),
                competency: goal.competency,
                targetCount: Math.max(1, Math.floor(toFiniteNumber(goal.targetCount, 10))),
                createdAt: canKeepProgress && currentGoal ? currentGoal.createdAt : now,
              }
            : undefined,
        };
        const tLang = translations[state.data.settings?.language || 'zh'];
        get().showToast(goal ? tLang.classGoalSaved : tLang.classGoalCleared, 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

      addStudent: (student) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const newStudent = {
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
          dailyProgress: { streak: 0 },
          teamId: undefined,
          badges: []
        };
        
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: [...nextClasses[currentClassIndex].students, newStudent]
        };
        get().showToast(`${translations[state.data.settings?.language || 'zh'].addedStudent}${student.name}`);
        
        return { data: { ...state.data, classes: nextClasses } };
      }),

      deleteStudent: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        
        const className = state.data.classes[currentClassIndex].students.find(s => s.id === studentId)?.name;
        const nextStudents = sanitizeTeamAssignments(
          state.data.classes[currentClassIndex].students.filter(s => s.id !== studentId),
          state.data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE
        );
        get().showToast(`${translations[state.data.settings?.language || 'zh'].deletedStudent}${className}`);

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = { ...nextClasses[currentClassIndex], students: nextStudents };
        
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

      addPoints: (studentId, pointsToAdd, source = 'quick', reason) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        
        const now = Date.now();
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId 
              ? applyPointAdjustmentToStudent(s, pointsToAdd, createPointAdjustmentRecord(pointsToAdd, source, reason, now), state.data.settings?.maxPoints ?? 700) 
              : s
          )
        };
        return { data: { ...state.data, classes: nextClasses } };
      }),

      airdropPoints: (pointsToAdd, reasonLabel, competency) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const amount = Math.trunc(toFiniteNumber(pointsToAdd, 0));
        if (amount === 0) return state;

        const now = Date.now();
        const currentClass = state.data.classes[currentClassIndex];
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...currentClass,
          students: currentClass.students.map((student) =>
            applyPointAdjustmentToStudent(
              student,
              amount,
              createPointAdjustmentRecord(
                amount,
                'airdrop',
                reasonLabel?.trim() || competency
                  ? { label: reasonLabel?.trim() || undefined, competency }
                  : undefined,
                now,
              ),
              state.data.settings?.maxPoints ?? 700,
            ),
          ),
        };

        const lang = state.data.settings?.language || 'zh';
        const signedAmount = `${amount > 0 ? '+' : ''}${amount}`;
        get().showToast(
          lang === 'en'
            ? `Airdropped ${signedAmount} points to ${currentClass.students.length} students.`
            : `已向 ${currentClass.students.length} 位學生空投 ${signedAmount} 積分。`,
          amount > 0 ? 'success' : 'error',
        );

        return { data: { ...state.data, classes: nextClasses } };
      }),

      decreaseLevel: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId && (s.pet.level || 1) > 1 
              ? { ...s, pet: { ...s.pet, level: (s.pet.level || 1) - 1 } }
              : s
          )
        };
        get().showToast(translations[state.data.settings?.language || 'zh'].levelDecreased, 'success');
        return { data: { ...state.data, classes: nextClasses } };
      }),

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

      disciplineStudent: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const targetStudent = state.data.classes[currentClassIndex].students.find(s => s.id === studentId);
        if (!targetStudent) return state;
        
        const now = Date.now();
        const disciplineRecord = createDisciplineRecord('discipline', undefined, now);

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s =>
            s.id === studentId ? applyPenaltyToStudent(s, DIRECT_DISCIPLINE_PENALTY, {
              nextWarningPoints: 0, record: disciplineRecord, now, source: 'discipline'
            }, state.data.settings?.maxPoints ?? 700) : s
          )
        };

        get().showToast(translations[state.data.settings?.language || 'zh'].disciplineApplied.replace('{name}', targetStudent.name), 'error');
        return { data: { ...state.data, classes: nextClasses } };
      }),

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
                  createPointAdjustmentRecord(rewardAmount, 'manual', { id: 'season-reset', label: '賽季結算獎勵' }, now), 
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
        
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId 
              ? applyFeedToStudent(s, feedCost, state.data.settings?.feedGain ?? 20, Date.now(), state.data.settings?.maxPoints ?? 700) 
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
        
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId 
              ? applyPlayWithPet(s, playCost, state.data.settings?.playGain ?? 15, Date.now(), state.data.settings?.maxPoints ?? 700) 
              : s
          )
        };
        return { data: { ...state.data, classes: nextClasses } };
      }),

      claimDailyTask: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const targetStudent = state.data.classes[currentClassIndex].students.find(s => s.id === studentId);
        if (!targetStudent) return state;

        const result = claimDailyTaskForStudent(targetStudent, Date.now(), state.data.settings?.maxPoints ?? 700);
        const tLang = translations[state.data.settings?.language || 'zh'];

        if (!result.claimed) {
          get().showToast(tLang.dailyTaskDone ?? '今日已完成', 'error');
          return state;
        }

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => s.id === studentId ? result.student : s)
        };

        get().showToast(
          (tLang.dailyTaskReward ?? '完成每日任務，獲得 {points} 積分與 {happiness} 心情')
            .replace('{points}', String(result.rewardPoints))
            .replace('{happiness}', String(DAILY_TASK_REWARD_HAPPINESS)),
          'success'
        );
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

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => s.id === studentId ? reviveStudentPet(s, reviveCost, state.data.settings?.maxPoints ?? 700) : s)
        };

        get().showToast((tLang.reviveSuccess ?? '{name} 的寵物已復活').replace('{name}', targetStudent.name), 'success');
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
        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId ? { ...s, points: s.points - upgradeCost, pet: { ...s.pet, level: nextLevel } } : s
          )
        };

        get().showToast(tLang.petUpgraded.replace('{name}', student.name).replace('{level}', nextLevel.toString()), 'success');

        const nextRewardLevel = student.nextUpgradeGachaLevel ?? getUpcomingUpgradeGachaLevel(currentLevel);
        if (nextRewardLevel !== null && nextLevel === nextRewardLevel) {
          get().setUpgradeReward({ studentId, studentName: student.name, reachedLevel: nextLevel });
          get().showToast(tLang.upgradeGachaUnlocked.replace('{name}', student.name).replace('{level}', nextLevel.toString()), 'success');
        }

        return { data: { ...state.data, classes: nextClasses } };
      }),

      gachaPet: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        const student = state.data.classes[currentClassIndex].students.find(s => s.id === studentId);
        if (!student || student.points < 200) return state;

        const newPetType = getRandomPetType(true);
        get().triggerPetAnimation(studentId, 'gacha', 1500);

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId ? { ...s, points: s.points - 200, pet: { ...s.pet, type: newPetType } } : s
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
        get().triggerPetAnimation(studentId, 'reroll', 1800);

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          students: nextClasses[currentClassIndex].students.map(s => 
            s.id === studentId ? {
              ...s,
              pet: { ...s.pet, type: newPetType, level: UPGRADE_REWARD_LEVEL, fullness: UPGRADE_REWARD_FULLNESS, happiness: UPGRADE_REWARD_HAPPINESS },
              nextUpgradeGachaLevel: getNextUpgradeGachaLevel(claimedLevel)
            } : s
          )
        };
        const targetStudent = nextClasses[currentClassIndex].students.find(s => s.id === studentId);
        const lang = state.data.settings?.language || 'zh';
        get().showToast(translations[lang].upgradeGachaChanged.replace('{name}', targetStudent?.name || '').replace('{pet}', (petNames[lang] as any)[newPetType]), 'success');
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

        const teamOwner = currentClass.students.find(s => s.id === studentId);
        const teammateNames = currentClass.students.filter(s => selectedIds.includes(s.id)).map(s => s.name);
        const lang = state.data.settings?.language || 'zh';

        get().showToast(
          selectedIds.length > 0
            ? lang === 'en' ? `${teamOwner?.name ?? ''} formed a team with ${teammateNames.join(', ')}.` : `${teamOwner?.name ?? ''} 已和 ${teammateNames.join('、')} 組成隊伍。`
            : lang === 'en' ? `${teamOwner?.name ?? ''} cleared the team.` : `${teamOwner?.name ?? ''} 已解除隊伍。`,
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
        const isSharedAttack = state.data.settings?.bossAttackMode !== 'random';
        const result = isSharedAttack
          ? resolveSharedBossAttack(
              members,
              state.data.settings?.bossAttackDamage ?? DEFAULT_BOSS_ATTACK_DAMAGE,
              Date.now(),
            )
          : resolveBossAttack(
              members,
              state.data.settings?.bossAttackMaxTargets ?? DEFAULT_BOSS_ATTACK_MAX_TARGETS,
              state.data.settings?.bossAttackDamage ?? DEFAULT_BOSS_ATTACK_DAMAGE,
              Math.random,
              Date.now(),
            );
        const targetIdSet = new Set(result.targetIds);
        const targetNames = currentClass.students
          .filter((student) => targetIdSet.has(student.id))
          .map((student) => student.name);
        const feedback = { targetNames, damage: result.damage, id: Date.now() };
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
            : isSharedAttack
              ? tLang.bossAttackSharedResult
                  .replace('{count}', targetNames.length.toString())
                  .replace('{damage}', result.damage.toString())
              : (lang === 'en'
                  ? `Boss hit ${targetNames.join(', ')} for ${result.damage} fullness.`
                  : `魔王攻擊 ${targetNames.join('、')}，各造成 ${result.damage} 點飽食度傷害。`),
          targetNames.length === 0 ? 'success' : 'error',
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

      executeAttackBoss: (studentId) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;
        
        const currentClass = state.data.classes[currentClassIndex];
        if (!currentClass.activeBoss || !currentClass.activeBoss.isActive) return state;

        const targetStudent = currentClass.students.find(s => s.id === studentId);
        if (!targetStudent) return state;

        const result = attackWorldBoss(targetStudent, currentClass.activeBoss, Date.now());
        const tLang = translations[state.data.settings?.language || 'zh'];

        if (result.blocked === 'penalty') { get().showToast(tLang.battleBlockedByPenalty, 'error'); return state; }
        if (result.blocked === 'dead') { get().showToast(tLang.battleBlockedByDeath ?? '寵物已死亡，無法討伐', 'error'); return state; }
        if (result.blocked === 'fullness') { get().showToast((tLang.battleNeedFullness ?? '').replace('{value}', BOSS_ATTACK_FULLNESS_COST.toString()), 'error'); return state; }
        
        if (result.updatedStudent && result.updatedBoss) {
          get().triggerPetAnimation(studentId, 'attack', 500);
          get().showToast((tLang.bossDamage ?? 'Dealt {damage} damage!').replace('{damage}', (result.damageDealt || 0).toString()), 'success');
          
          set({ bossHitFeedback: { damage: result.damageDealt || 0, id: Date.now() } });
          if (bossHitFeedbackTimer) clearTimeout(bossHitFeedbackTimer);
          bossHitFeedbackTimer = setTimeout(() => {
            set({ bossHitFeedback: null });
            bossHitFeedbackTimer = undefined;
          }, 800);

          const nextClasses = [...state.data.classes];
          const newBoss = result.updatedBoss;

          if (result.isDefeated) {
            const studentsAfterAttack = currentClass.students.map((student) =>
              student.id === studentId ? result.updatedStudent! : student,
            );
            const rewardResult = applyBossContributionRewards(
              studentsAfterAttack,
              newBoss,
              Date.now(),
              state.data.settings?.maxPoints ?? 700,
            );
            nextClasses[currentClassIndex] = {
              ...currentClass,
              students: rewardResult.students,
              activeBoss: undefined,
            };
            get().showToast((tLang.bossDefeated ?? '').replace('{name}', newBoss.name), 'success');
            return {
              showBossVictory: true,
              bossVictoryResult: { bossName: newBoss.name, standings: rewardResult.standings },
              data: { ...state.data, classes: nextClasses },
            };
          } else {
            nextClasses[currentClassIndex] = { ...currentClass, students: currentClass.students.map(s => s.id === studentId ? result.updatedStudent! : s), activeBoss: newBoss.isActive ? newBoss : undefined };
            return { data: { ...state.data, classes: nextClasses } };
          }
        }
        return state;
      }),

      triggerDecay: () => set((state) => {
        const nextData = applyDecay(state.data, Date.now());
        return { data: nextData };
      })
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
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
