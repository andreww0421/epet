import React from 'react';
import { 
  Smile, Frown, Meh, Star, AlertCircle, Zap, Users, Crown, Heart, Trophy,
  Swords, Gift, RefreshCw, Utensils, Dices, Medal, Ghost, Dumbbell, Sparkles
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { translations } from '../i18n/translations';
import { PET_TYPES, REVIVE_COST } from '../store/constants';
import { Student, PetAnimationMode } from '../store/types';
import { isPenaltyActive, isPetDead, clamp, getDateKey } from '../gameRules';
import { getTeamMembers } from '../store/utils';

const WARNING_THRESHOLD = 3;
const DAILY_TASK_REWARD_POINTS = 30;

// ─── Targeted Selectors ─────────────────────────────────────────────
// Each selector picks exactly the slice of state that PetCard needs.
// Zustand performs shallow equality on the return value, so a PetCard
// only re-renders when *its own* student or the relevant settings change.

const selectStudent = (studentId: string) => (state: any): Student | undefined =>
  state.data.classes
    .find((c: any) => c.id === state.data.currentClassId)
    ?.students.find((s: any) => s.id === studentId);

const selectSettings = (state: any) => ({
  lang: (state.data.settings?.language || 'zh') as 'zh' | 'en',
  feedCost: state.data.settings?.feedCost ?? 10,
  playCost: state.data.settings?.playCost ?? 5,
  maxPoints: state.data.settings?.maxPoints ?? 700,
  maxTeamSize: state.data.settings?.maxTeamSize ?? 6,
});

const selectActiveBoss = (state: any) =>
  state.data.classes.find((c: any) => c.id === state.data.currentClassId)?.activeBoss;

const selectAnimation = (studentId: string) => (state: any): PetAnimationMode | undefined =>
  state.animatingPets[studentId];

const selectTeammateNames = (studentId: string) => (state: any): string | undefined => {
  const cls = state.data.classes.find((c: any) => c.id === state.data.currentClassId);
  if (!cls) return undefined;
  const student = cls.students.find((s: any) => s.id === studentId);
  if (!student?.teamId) return undefined;
  const maxTeamSize = state.data.settings?.maxTeamSize ?? 6;
  return getTeamMembers(cls.students, student, maxTeamSize)
    .filter((m: any) => m.id !== studentId)
    .map((m: any) => m.name)
    .join(', ') || undefined;
};

// ─── Stable action refs (never change) ──────────────────────────────
const selectActions = (state: any) => ({
  feedPet: state.feedPet,
  playWithPet: state.playWithPet,
  claimDailyTask: state.claimDailyTask,
  revivePet: state.revivePet,
  upgradePet: state.upgradePet,
  gachaPet: state.gachaPet,
  executeAttackBoss: state.executeAttackBoss,
});

type PetCardProps = {
  studentId: string;
  onBattle: (studentId: string) => void;
  onTeamUp: (studentId: string) => void;
  getRankInfo: (rankPoints: number) => { name: string; icon: any; color: string; bg: string };
};

export const PetCard = React.memo<PetCardProps>(({ studentId, onBattle, onTeamUp, getRankInfo }) => {
  // Targeted subscriptions — each one only triggers re-render when its return value changes
  const student = useStore(selectStudent(studentId));
  const settings = useStore(useShallow(selectSettings));
  const activeBoss = useStore(selectActiveBoss);
  const animationMode = useStore(selectAnimation(studentId));
  const teammateName = useStore(selectTeammateNames(studentId));
  const actions = useStore(useShallow(selectActions));

  if (!student) return null;

  const { lang, feedCost, playCost, maxPoints } = settings;
  const tLang = translations[lang];

  const { name, points, pet, badges = [], rankPoints = 0, warningPoints = 0, nextUpgradeGachaLevel = 2, penaltyStatus, dailyProgress } = student;
  const { fullness, type, level = 1, happiness = 80 } = pet;

  const petConfig = PET_TYPES.find(p => p.id === type) || PET_TYPES[0];
  const PetIcon = petConfig.icon;

  const isStrong = points >= 100 || fullness === 100;
  const isLowMood = happiness < 30;
  const isHappy = fullness > 70 && !isLowMood;
  const isNormal = fullness >= 30 && fullness <= 70 && !isLowMood;
  const isHungry = fullness < 30 || isLowMood;
  const hasActivePenalty = isPenaltyActive(penaltyStatus);
  const isDead = isPetDead(pet);
  const canFeed = points >= feedCost && !isDead;
  const canPlay = points >= playCost && !isDead;
  const canBattle = fullness >= 50 && !hasActivePenalty && !isDead && !isLowMood;
  const upgradeCost = 100 + (level - 1) * 50;
  const canUpgrade = level < 10 && fullness >= 100 && points >= upgradeCost && happiness >= 40 && !isDead;
  const canGacha = points >= 200 && !isDead;
  const hasUpgradeReward = nextUpgradeGachaLevel !== null && level >= nextUpgradeGachaLevel;
  const canRevive = points >= REVIVE_COST;
  const todayKey = getDateKey();
  const dailyClaimedToday = dailyProgress?.lastClaimDate === todayKey;
  const streak = dailyProgress?.streak ?? 0;
  const isRerollAnimation = animationMode === 'reroll';
  const isGachaAnimation = animationMode === 'gacha';
  const isFeedAnimation = animationMode === 'feed';
  const isPlayAnimation = animationMode === 'play';
  const isAttackAnimation = animationMode === 'attack';
  const isAnimating = isFeedAnimation || isPlayAnimation || isRerollAnimation || isGachaAnimation || isAttackAnimation;

  let StatusIcon = Smile;
  let statusText = tLang.statusHappy;
  let statusColor = "text-green-500";
  let bgColor = "bg-green-50";
  let borderColor = "border-green-200";

  if (isDead) {
    StatusIcon = Ghost;
    statusText = tLang.petDead;
    statusColor = "text-slate-500";
    bgColor = "bg-slate-100";
    borderColor = "border-slate-300";
  } else if (isHungry) {
    StatusIcon = Frown;
    statusText = tLang.statusHungry;
    statusColor = "text-red-500";
    bgColor = "bg-red-50";
    borderColor = "border-red-200";
  } else if (isNormal) {
    StatusIcon = Meh;
    statusText = tLang.statusNormal;
    statusColor = "text-yellow-500";
    bgColor = "bg-yellow-50";
    borderColor = "border-yellow-200";
  }

  const evolutionStage = level >= 10 ? 3 : level >= 5 ? 2 : 1;
  const rankInfo = getRankInfo(rankPoints);

  return (
    <div className={`relative bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300 border-2 ${borderColor}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${borderColor} ${bgColor} flex justify-between items-center`}>
        <div className="flex flex-col">
          <span className="font-bold text-gray-800 text-lg">
            {name}
          </span>
          <span className="text-xs font-bold text-amber-600 flex items-center">
            <Star className="h-3 w-3 mr-1 fill-amber-500" /> Lv. {level}
          </span>
          {warningPoints > 0 && (
            <span className="mt-1 inline-flex w-fit items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
              <AlertCircle className="mr-1 h-3 w-3" />
              {tLang.warningPoints} {warningPoints}/{WARNING_THRESHOLD}
            </span>
          )}
          {hasActivePenalty && (
            <span className="mt-1 inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              <Zap className="mr-1 h-3 w-3" />
              {tLang.penaltyStatus}
            </span>
          )}
          {streak > 0 && (
            <span className="mt-1 inline-flex w-fit items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
              <Star className="mr-1 h-3 w-3" />
              {tLang.dailyTaskStreak.replace('{days}', String(streak))}
            </span>
          )}
          {teammateName && (
            <span className="mt-1 inline-flex w-fit items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
              <Users className="mr-1 h-3 w-3" />
              {lang === 'en' ? 'Team' : '隊伍'}: {teammateName}
            </span>
          )}
        </div>
        <div className="flex items-center bg-white px-2 py-1 rounded-full shadow-sm">
          <span className="text-xs font-bold text-indigo-600 mr-1">{tLang.points}</span>
          <span className="font-black text-indigo-700">{points}/{maxPoints}</span>
        </div>
      </div>

      {/* Badges Area */}
      {badges.length > 0 && (
        <div className="absolute top-16 right-2 flex flex-col gap-1 z-20">
          {badges.includes('badgeFirstWin') && <div className="bg-amber-100 p-1 rounded-full shadow-sm border border-amber-200" title={tLang.badgeFirstWin}><Medal className="h-4 w-4 text-amber-600" /></div>}
          {badges.includes('badgeVeteran') && <div className="bg-rose-100 p-1 rounded-full shadow-sm border border-rose-200" title={tLang.badgeVeteran}><Swords className="h-4 w-4 text-rose-600" /></div>}
          {badges.includes('badgeRich') && <div className="bg-emerald-100 p-1 rounded-full shadow-sm border border-emerald-200" title={tLang.badgeRich}><Gift className="h-4 w-4 text-emerald-600" /></div>}
          {badges.includes('badgeMaxLevel') && <div className="bg-indigo-100 p-1 rounded-full shadow-sm border border-indigo-200" title={tLang.badgeMaxLevel}><Crown className="h-4 w-4 text-indigo-600" /></div>}
        </div>
      )}

      {/* Pet Visual Area */}
      <div className={`px-6 pt-14 pb-4 flex flex-col items-center justify-end relative h-64 transition-colors duration-500 ${
        isDead 
          ? 'bg-gradient-to-b from-slate-200/50 to-slate-400/30' 
          : 'bg-gradient-to-b from-white to-amber-50/30'
      }`}>

        {/* Floating Rank Badge */}
        <div className={`absolute top-3 left-3 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg shadow-md border border-white/50 backdrop-blur-sm ${rankInfo.bg}`}>
          <rankInfo.icon className={`h-5 w-5 ${rankInfo.color}`} />
          <div className="flex flex-col leading-none">
            <span className={`font-black text-sm tracking-widest ${rankInfo.color}`}>{rankInfo.name}</span>
            <span className={`text-[10px] font-bold opacity-70 ${rankInfo.color}`}>{rankPoints} RP</span>
          </div>
        </div>
        
        {/* Floating Hearts Animation */}
        {isAnimating && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className={`absolute rounded-full blur-3xl animate-pulse ${
              isRerollAnimation
                ? 'h-44 w-44 bg-gradient-to-r from-fuchsia-300/40 via-amber-300/50 to-cyan-300/40'
                : isGachaAnimation
                  ? 'h-40 w-40 bg-gradient-to-r from-violet-300/35 via-indigo-300/35 to-sky-300/35'
                  : 'h-36 w-36 bg-amber-300/30'
            }`} />
            {(isGachaAnimation || isRerollAnimation) && (
              <>
                <div className={`absolute h-28 w-28 rounded-full border-4 ${
                  isRerollAnimation ? 'border-fuchsia-300/70' : 'border-indigo-300/70'
                } animate-[spin_1.8s_linear_infinite]`} />
                <div className={`absolute h-40 w-40 rounded-full border-2 ${
                  isRerollAnimation ? 'border-amber-200/70' : 'border-sky-200/70'
                } animate-[ping_1.4s_ease-out_infinite]`} />
              </>
            )}
            <Sparkles className={`absolute h-10 w-10 ${
              isRerollAnimation ? 'text-fuchsia-400 animate-[spin_1.2s_linear_infinite]' : 'text-yellow-400 animate-[spin_1.5s_linear_infinite]'
            }`} />
            <Sparkles className={`absolute -mt-10 -ml-14 h-8 w-8 ${
              isRerollAnimation ? 'text-cyan-400 animate-[ping_0.9s_ease-out_infinite]' : 'text-indigo-400 animate-[ping_1.1s_ease-out_infinite]'
            }`} />
            <Sparkles className={`absolute mt-10 mr-16 h-7 w-7 ${
              isRerollAnimation ? 'text-amber-400 animate-[ping_1s_ease-out_infinite]' : 'text-emerald-400 animate-[ping_1.3s_ease-out_infinite]'
            }`} />
            {isRerollAnimation && (
              <>
                <Sparkles className="absolute -mt-16 ml-14 h-7 w-7 text-rose-400 animate-[bounce_0.9s_ease-in-out_infinite]" />
                <div className="absolute bottom-4 rounded-full bg-white/90 px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-fuchsia-600 shadow-md animate-bounce">
                  New Pet
                </div>
              </>
            )}
            {(isFeedAnimation || isPlayAnimation || isRerollAnimation) && (
              <>
                <Heart className={`h-8 w-8 animate-[ping_1s_ease-out_forwards] absolute opacity-75 ${isPlayAnimation ? 'text-rose-500 fill-rose-500 scale-150' : 'text-pink-500 fill-pink-500'}`} />
                <Heart className={`h-6 w-6 animate-[bounce_1s_ease-in-out_infinite] absolute -mt-16 ml-8 ${isPlayAnimation ? 'text-rose-400 fill-rose-400 scale-125' : 'text-pink-400 fill-pink-400'}`} />
                <Heart className={`h-5 w-5 animate-[bounce_1.2s_ease-in-out_infinite] absolute -mt-12 -ml-10 ${isPlayAnimation ? 'text-rose-400 fill-rose-400 scale-125' : 'text-pink-400 fill-pink-400'}`} />
              </>
            )}
            {isAttackAnimation && (
              <Swords className="text-rose-600 h-14 w-14 absolute z-30 animate-[ping_0.6s_ease-out_forwards] drop-shadow-lg" />
            )}
          </div>
        )}



        {/* Pet Character Container */}
        <div className={`relative transition-all duration-300 z-10 ${
          isAttackAnimation ? 'scale-125 -translate-y-6 drop-shadow-md' : 
          isPlayAnimation ? 'scale-125 animate-[bounce_0.5s_ease-in-out_infinite]' :
          isAnimating ? 'scale-125 -translate-y-4' : 
          'hover:scale-105'
        } ${
          evolutionStage === 1 ? 'scale-90' :
          evolutionStage === 2 ? 'scale-100' :
          'scale-125 mt-2'
        }`}>
          
          {/* Status Expressions & Floating Animation Wrapper */}
          <div className={`relative flex flex-col items-center justify-center transition-all duration-500 ${
            isDead ? 'opacity-50 grayscale animate-[pulse_3s_ease-in-out_infinite]' :
            isHungry ? 'opacity-70 saturate-50 contrast-75' :
            isHappy ? 'brightness-110 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]' : ''
          } ${
            (!isDead && !isHungry && evolutionStage === 1) ? 'animate-[bounce_3s_infinite]' : ''
          }`}>

            {/* Pet Circle Base */}
            <div className={`p-4 rounded-full relative z-10 ${isStrong ? 'bg-amber-100' : bgColor} ${
              isRerollAnimation
                ? 'shadow-[0_0_30px_rgba(217,70,239,0.65)] ring-4 ring-fuchsia-200/70'
                : evolutionStage >= 2
                  ? 'shadow-[0_0_15px_rgba(251,191,36,0.6)]'
                  : ''
            } ${evolutionStage >= 3 ? 'shadow-[0_0_25px_rgba(167,139,250,0.8)]' : ''}`}>
              
              {/* Epic Aura — inside Pet Circle Base so it's always centered */}
              {!isDead && evolutionStage >= 3 && (
                <div className="absolute -inset-6 rounded-full border-[4px] border-yellow-300/20 border-t-yellow-400 border-b-yellow-400 animate-[spin_4s_linear_infinite] shadow-[0_0_30px_rgba(250,204,21,0.6)] z-0 pointer-events-none" />
              )}

              {evolutionStage >= 3 && (
                <Crown className="h-10 w-10 text-yellow-400 fill-yellow-400 absolute -top-6 left-1/2 transform -translate-x-1/2 z-20 drop-shadow-[0_0_10px_rgba(250,204,21,0.8)] animate-[pulse_2s_ease-in-out_infinite]" />
              )}
              
              {isStrong ? (
                <div className="relative">
                  <PetIcon className={`h-16 w-16 ${statusColor}`} strokeWidth={1.5} />
                  <Dumbbell className="h-8 w-8 text-slate-700 absolute -right-2 -bottom-2 transform rotate-12" />
                </div>
              ) : (
                <PetIcon className={`h-16 w-16 ${statusColor}`} strokeWidth={1.5} />
              )}

              {!isDead && evolutionStage >= 2 && (
                <Sparkles className="h-7 w-7 text-amber-400 fill-amber-400 absolute -top-1 -right-1 animate-pulse drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
              )}
            </div>

            {/* Status Badge */}
            <div className={`absolute -bottom-2 -right-2 bg-white rounded-full p-1.5 shadow-md border-2 z-20 ${borderColor}`} title={statusText}>
              <StatusIcon className={`h-5 w-5 ${statusColor}`} />
            </div>
          </div>
        </div>

        {/* Fullness Bar */}
        <div className="w-full mt-6">
          <div className="flex justify-between text-xs mb-1 font-medium text-gray-500">
            <span>{tLang.petFullness}</span>
            <span>{fullness}/100</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden shadow-inner">
            <div 
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                isHungry ? 'bg-red-400' : isNormal ? 'bg-yellow-400' : 'bg-green-400'
              }`}
              style={{ width: `${fullness}%` }}
            ></div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs mb-1 font-medium text-gray-500">
              <span className="flex items-center">
                <Heart className={`h-3 w-3 mr-1 ${happiness >= 70 ? 'text-emerald-500' : happiness >= 30 ? 'text-amber-500' : 'text-fuchsia-500'}`} />
                {tLang.happiness}
              </span>
              <span>{happiness}/100</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden flex">
              <div 
                className={`h-full rounded-full transition-all duration-500 ease-out ${
                   happiness >= 70 ? 'bg-emerald-400' : happiness >= 30 ? 'bg-amber-400' : 'bg-fuchsia-400'
                }`}
                style={{ width: `${clamp(happiness, 0, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Area */}
      <div className="p-4 bg-gray-50 border-t border-gray-100 space-y-2">
        {type === 'egg' && !isDead ? (
          <button
            onClick={() => actions.gachaPet(studentId)}
            disabled={!canGacha}
            className={`w-full flex items-center justify-center py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
              !canGacha
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white shadow-md hover:shadow-lg active:scale-95'
            }`}
          >
            <Dices className="h-5 w-5 mr-2 animate-bounce" />
            {tLang.gacha}
          </button>
        ) : (
          <>
            {isDead && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center">
                <div className="text-sm font-bold text-rose-700">{tLang.petDead}</div>
                <div className="mt-1 text-[11px] text-rose-600">{tLang.petDeadHint}</div>
              </div>
            )}

            <button
              onClick={() => actions.claimDailyTask(studentId)}
              disabled={dailyClaimedToday}
              className={`w-full flex items-center justify-center py-2 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
                dailyClaimedToday
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-emerald-400 hover:bg-emerald-500 text-emerald-950 shadow-sm hover:shadow active:scale-95'
              }`}
            >
              <Gift className="h-4 w-4 mr-2" />
              {dailyClaimedToday
                ? tLang.dailyTaskDone
                : `${tLang.dailyTask} (+${DAILY_TASK_REWARD_POINTS})`}
            </button>

            <button
              onClick={() => onTeamUp(studentId)}
              className="w-full flex items-center justify-center py-2 px-4 rounded-xl font-bold text-sm transition-all duration-200 bg-sky-100 hover:bg-sky-200 text-sky-900 shadow-sm hover:shadow active:scale-95"
            >
              <Users className="h-4 w-4 mr-2" />
              {teammateName
                ? (lang === 'en' ? 'Manage Team' : '管理隊伍')
                : (lang === 'en' ? 'Create Team' : '建立隊伍')}
            </button>

            {isDead ? (
              <button
                onClick={() => actions.revivePet(studentId)}
                disabled={!canRevive}
                className={`w-full flex items-center justify-center py-2 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
                  !canRevive
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-rose-500 hover:bg-rose-600 text-white shadow-sm hover:shadow active:scale-95'
                }`}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {tLang.revivePet}
              </button>
            ) : (
              <>
            <div className="flex space-x-2">
              <button
                onClick={() => actions.feedPet(studentId)}
                disabled={!canFeed || fullness >= 100}
                className={`flex-1 flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
                  !canFeed || fullness >= 100
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-amber-400 hover:bg-amber-500 text-amber-900 shadow-sm hover:shadow active:scale-95'
                }`}
              >
                <Utensils className="h-3 w-3 mr-1" />
                {fullness >= 100 ? tLang.alreadyFull : canFeed ? tLang.feedPet.replace('{cost}', feedCost.toString()) : tLang.notEnoughPoints}
              </button>
              
              <button
                onClick={() => actions.playWithPet(studentId)}
                disabled={!canPlay || happiness >= 100}
                className={`flex-1 flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
                  !canPlay || happiness >= 100
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-rose-400 hover:bg-rose-500 text-white shadow-sm hover:shadow active:scale-95'
                }`}
              >
                <Smile className="h-3 w-3 mr-1" />
                {happiness >= 100 ? (lang === 'en' ? 'Very happy!' : '已經很開心了') : canPlay ? tLang.playPet.replace('{cost}', playCost.toString()) : tLang.notEnoughPoints}
              </button>
            </div>

            <div className="flex space-x-2">
              <div className="relative flex-1">
                {level < 10 && hasUpgradeReward && (
                  <div className="pointer-events-none absolute -top-2 -left-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-amber-200 bg-gradient-to-br from-amber-200 via-yellow-100 to-orange-200 text-amber-700 shadow-md animate-pulse">
                    <Dices className="h-3.5 w-3.5" />
                  </div>
                )}
                <button
                  onClick={() => actions.upgradePet(studentId)}
                  disabled={!canUpgrade}
                  className={`w-full flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
                    !canUpgrade
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : hasUpgradeReward
                        ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 hover:from-amber-500 hover:via-orange-500 hover:to-rose-500 text-white shadow-md hover:shadow-lg active:scale-95'
                        : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm hover:shadow active:scale-95'
                  }`}
                >
                  <Trophy className="h-3 w-3 mr-1" />
                  {level >= 10 ? tLang.maxLevel : tLang.upgradePet.replace('{cost}', upgradeCost.toString())}
                </button>
              </div>
              
              <button
                onClick={() => onBattle(studentId)}
                disabled={!canBattle}
                className={`flex-1 flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
                  !canBattle
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-rose-500 hover:bg-rose-600 text-white shadow-sm hover:shadow active:scale-95'
                }`}
              >
                <Swords className="h-3 w-3 mr-1" />
                {tLang.battle}
              </button>
            </div>

            {activeBoss?.isActive && (
              <button
                onClick={() => actions.executeAttackBoss(studentId)}
                className={`w-full mt-2 flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
                  fullness < 20 || isDead || hasActivePenalty
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-purple-600 hover:bg-purple-700 text-white shadow-sm hover:shadow active:scale-95'
                }`}
                disabled={fullness < 20 || isDead || hasActivePenalty}
              >
                <Swords className="h-3 w-3 mr-1" />
                {tLang.attack} (-20)
              </button>
            )}
            
            {(!canFeed && fullness < 100 || (!canPlay && happiness < 100) || !canBattle || (!canUpgrade && level < 10)) && (
              <p className="text-center text-[10px] text-red-500 mt-2 flex flex-col items-center justify-center space-y-0.5">
                {!canFeed && fullness < 100 && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.feedNeedPoints.replace('{cost}', feedCost.toString())}</span>}
                {!canPlay && happiness < 100 && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.playNeedPoints.replace('{cost}', playCost.toString())}</span>}
                {!canBattle && hasActivePenalty && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.battleBlockedByPenalty}</span>}
                {!canBattle && !hasActivePenalty && isLowMood && <span><AlertCircle className="h-3 w-3 inline mr-1" />{lang === 'en' ? 'Mood too low, refusing to battle!' : '心情過低，罷工拒絕出戰！'}</span>}
                {!canBattle && !hasActivePenalty && !isLowMood && fullness < 50 && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.battleNeedFullness}</span>}
                {!canUpgrade && level < 10 && fullness < 100 && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.upgradeNeedFullness}</span>}
                {!canUpgrade && level < 10 && fullness >= 100 && points < upgradeCost && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.upgradeNeedPoints.replace('{cost}', upgradeCost.toString())}</span>}
                {!canUpgrade && level < 10 && fullness >= 100 && points >= upgradeCost && happiness < 40 && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.moodLowPenalty}</span>}
              </p>
            )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
});

PetCard.displayName = 'PetCard';
