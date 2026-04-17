import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { 
  AppData, Student, ClassData, UpgradeRewardState, PetAnimationMode, 
  PointAdjustmentSource, BattleMode, Language
} from './types';
import { 
  translations, STORAGE_KEY, DEFAULT_MAX_TEAM_SIZE, REVIVE_COST,
  DEFAULT_BATTLE_MODE, petNames
} from './constants';
import { 
  normalizeAppData, applyDecay, getRandomPetType, 
  sanitizeTeamAssignments, getTeamMembers, createTeamId
} from './utils';
import { 
  applyFeedToStudent, applyPlayWithPet, claimDailyTaskForStudent,
  reviveStudentPet, applyPointAdjustmentToStudent, createPointAdjustmentRecord,
  applyPenaltyToStudent, createDisciplineRecord, getNextUpgradeGachaLevel,
  getUpcomingUpgradeGachaLevel, resolveBattle, resolveTeamBattle,
  isBattleReady, attackWorldBoss, applyBossDefeatRewards,
  BOSS_ATTACK_FULLNESS_COST, DIRECT_DISCIPLINE_PENALTY, WARNING_THRESHOLD,
  WARNING_AUTO_PENALTY, MAX_ACTIVITY_RECORDS, UPGRADE_REWARD_LEVEL,
  UPGRADE_REWARD_FULLNESS, UPGRADE_REWARD_HAPPINESS, DAILY_TASK_REWARD_HAPPINESS
} from '../gameRules';

type StoreState = {
  data: AppData;
  view: 'dashboard' | 'classroom';
  animatingPets: Record<string, PetAnimationMode | undefined>;
  toast: { message: string; type: 'success' | 'error' } | null;
  upgradeReward: UpgradeRewardState | null;
  bossHitFeedback: { damage: number; id: number } | null;
  showBossVictory: boolean;

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

  // Student CRUD
  addStudent: (student: Student) => void;
  deleteStudent: (studentId: string) => void;
  editStudentName: (studentId: string, newName: string) => void;
  
  // Student Stats & Discipline
  addPoints: (studentId: string, pointsToAdd: number, source?: PointAdjustmentSource, reason?: { id?: string; label?: string }) => void;
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
  summonBoss: (name: string, maxHp: number, rewardPoints: number, rewardHappiness: number) => void;
  removeBoss: () => void;
  executeAttackBoss: (studentId: string) => void;

  // Lifecycle
  triggerDecay: () => void;
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
      showBossVictory: false,

      setView: (view) => set({ view }),
      
      showToast: (message, type = 'success') => {
        set({ toast: { message, type } });
        setTimeout(() => set({ toast: null }), 3000);
      },

      setUpgradeReward: (reward) => set({ upgradeReward: reward }),

      triggerPetAnimation: (studentId, mode, durationMs) => {
        set((state) => ({
          animatingPets: { ...state.animatingPets, [studentId]: mode }
        }));
        setTimeout(() => {
          set((state) => {
            const next = { ...state.animatingPets };
            delete next[studentId];
            return { animatingPets: next };
          });
        }, durationMs);
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
        const safeMaxTeamSize = Math.max(2, Math.min(6, merged.maxTeamSize || DEFAULT_MAX_TEAM_SIZE));
        
        const newData = {
          ...state.data,
          settings: {
            ...merged,
            decayAmount: Math.max(0, merged.decayAmount || 2),
            feedCost: Math.max(1, merged.feedCost || 10),
            feedGain: Math.max(1, merged.feedGain || 20),
            playCost: Math.max(1, merged.playCost || 5),
            playGain: Math.max(1, merged.playGain || 15),
            maxTeamSize: safeMaxTeamSize,
            maxPoints: Math.max(10, merged.maxPoints || 700),
            reviveCost: Math.max(0, merged.reviveCost || 120),
            battleRankPointsWin: Math.max(0, merged.battleRankPointsWin || 20),
            battleRankPointsLoss: Math.max(0, merged.battleRankPointsLoss || 10),
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
          get().showToast(state.data.settings?.language === 'en' ? `Need ${reviveCost} points to revive` : `復活需要 ${reviveCost} 積分`, 'error');
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
        
        const currentClass = state.data.classes[currentClassIndex];
        const attacker = currentClass.students.find(s => s.id === attackerId);
        const defender = currentClass.students.find(s => s.id === defenderId);
        if (!attacker || !defender) return state;

        const now = Date.now();
        const tLang = translations[state.data.settings?.language || 'zh'];
        const maxTeamSize = state.data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE;
        const battleMode = state.data.settings?.battleMode ?? DEFAULT_BATTLE_MODE;

        const attackerMembers = getTeamMembers(currentClass.students, attacker, maxTeamSize)
          .filter((member) => member.id === attacker.id || isBattleReady(member, now))
          .map((member) => ({ id: member.id, student: member }));
        const defenderMembers = getTeamMembers(currentClass.students, defender, maxTeamSize)
          .filter((member) => member.id === defender.id || isBattleReady(member, now))
          .map((member) => ({ id: member.id, student: member }));
        
        const shouldForceTeamBattle = battleMode === 'team';
        const shouldUseTeamBattle = battleMode !== 'solo' && attackerMembers.length > 1 && defenderMembers.length > 1;

        if (shouldForceTeamBattle && (attackerMembers.length < 2 || defenderMembers.length < 2)) {
          get().showToast(state.data.settings?.language === 'en' ? 'Team battle mode requires at least 2 ready members on both sides.' : '隊伍賽模式要求雙方都至少有 2 位可出戰成員。', 'error');
          return state;
        }

        const maxPoints = state.data.settings?.maxPoints ?? 700;
        const battleOptions = { 
          battleRankPointsWin: state.data.settings?.battleRankPointsWin,
          battleRankPointsLoss: state.data.settings?.battleRankPointsLoss
        };
        
        const battleResult = !shouldUseTeamBattle && !shouldForceTeamBattle
          ? (() => {
              const singleResult = resolveBattle(attacker, defender, { attacker: Math.floor(Math.random() * 20), defender: Math.floor(Math.random() * 20) }, battleOptions, now, maxPoints);
              if (singleResult.blocked) return singleResult;
              return { ...singleResult, mode: 'solo' as const, updated: { [attacker.id]: singleResult.attacker, [defender.id]: singleResult.defender } };
            })()
          : { ...resolveTeamBattle(attackerMembers, defenderMembers, { attackers: attackerMembers.map(() => Math.floor(Math.random() * 20)), defenders: defenderMembers.map(() => Math.floor(Math.random() * 20)) }, battleOptions, now, maxPoints), mode: 'team' as const };

        if (battleResult.blocked === 'penalty') { get().showToast(tLang.battleBlockedByPenalty, 'error'); return state; }
        if (battleResult.blocked === 'dead') { get().showToast(tLang.battleBlockedByDeath ?? '寵物已死亡，必須先復活', 'error'); return state; }
        if (battleResult.blocked === 'fullness') { get().showToast(tLang.fullnessNeed50Battle, 'error'); return state; }
        if (battleResult.blocked === 'invalid') return state;

        const teamReward = (battleResult as any).teamReward;
        const isTeamBattle = (battleResult as any).mode === 'team';

        if (battleResult.outcome === 'win') {
          get().showToast(
            isTeamBattle && teamReward
              ? (state.data.settings?.language === 'en' ? `Team battle won. Team bonus +${teamReward.bonusPoints} pts / +${teamReward.bonusHappiness} mood.` : `隊伍對戰獲勝，啟動隊伍獎勵：+${teamReward.bonusPoints} 積分 / +${teamReward.bonusHappiness} 心情。`)
              : tLang.battleWon, 'success'
          );
        } else if (battleResult.outcome === 'loss') {
          get().showToast(isTeamBattle ? (state.data.settings?.language === 'en' ? 'Team battle lost.' : '隊伍對戰失敗。') : tLang.battleLost, 'error');
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

      summonBoss: (name, maxHp, rewardPoints, rewardHappiness) => set((state) => {
        const currentClassIndex = state.data.classes.findIndex(c => c.id === state.data.currentClassId);
        if (currentClassIndex === -1) return state;

        const nextClasses = [...state.data.classes];
        nextClasses[currentClassIndex] = {
          ...nextClasses[currentClassIndex],
          activeBoss: {
            id: `boss-${Date.now()}`, name: name || 'Unknown Boss',
            maxHp: Math.max(1, maxHp), currentHp: Math.max(1, maxHp),
            rewardPoints: Math.max(0, rewardPoints), rewardHappiness: Math.max(0, rewardHappiness),
            isActive: true,
          }
        };
        const lang = state.data.settings?.language || 'zh';
        get().showToast(lang === 'en' ? `Summoned Boss: ${name}` : `已召喚魔王：${name}`, 'success');
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
        if (result.blocked === 'fullness') { get().showToast((tLang.battleNeedFullness ?? '').replace('50', BOSS_ATTACK_FULLNESS_COST.toString()), 'error'); return state; }
        
        if (result.updatedStudent && result.updatedBoss) {
          get().triggerPetAnimation(studentId, 'attack', 500);
          get().showToast((tLang.bossDamage ?? 'Dealt {damage} damage!').replace('{damage}', (result.damageDealt || 0).toString()), 'success');
          
          set({ bossHitFeedback: { damage: result.damageDealt || 0, id: Date.now() } });
          setTimeout(() => set({ bossHitFeedback: null }), 800);

          const nextClasses = [...state.data.classes];
          const newBoss = result.updatedBoss;

          if (result.isDefeated) {
            set({ showBossVictory: true });
            nextClasses[currentClassIndex] = { ...currentClass, students: currentClass.students.map(s => s.id === studentId ? result.updatedStudent! : s), activeBoss: { ...newBoss, currentHp: 0, isActive: true } };
            
            setTimeout(() => {
              set((s2) => {
                const idx = s2.data.classes.findIndex(c => c.id === s2.data.currentClassId);
                if (idx === -1) return s2;
                const c = s2.data.classes[idx];
                if (!c.activeBoss) return s2;
                
                const rewardedStudents = applyBossDefeatRewards(c.students, c.activeBoss.rewardPoints, c.activeBoss.rewardHappiness, Date.now(), s2.data.settings?.maxPoints ?? 700);
                const afterClasses = [...s2.data.classes];
                afterClasses[idx] = { ...afterClasses[idx], students: rewardedStudents as any, activeBoss: undefined };
                return { showBossVictory: false, data: { ...s2.data, classes: afterClasses } };
              });
              get().showToast((tLang.bossDefeated ?? '').replace('{name}', newBoss.name).replace('{points}', currentClass.activeBoss!.rewardPoints.toString()).replace('{happiness}', currentClass.activeBoss!.rewardHappiness.toString()), 'success');
            }, 3800);
            return { data: { ...state.data, classes: nextClasses } };
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
      partialize: (state) => ({ data: state.data }),
      onRehydrateStorage: () => (state) => {
        if (state) state.triggerDecay();
      }
    }
  )
);
