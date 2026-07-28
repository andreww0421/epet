import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Users, BarChart3, Trophy, Skull, Swords, Dog, Crown, Sparkles, Medal, Award, Shield, X, Trash2,
  Target,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { translations } from '../i18n/translations';
import { PET_TYPES, DEFAULT_BATTLE_MODE, DEFAULT_MAX_TEAM_SIZE } from '../store/constants';
import { getTeamMembers } from '../store/utils';
import {
  isBattleReady, SOLO_BATTLE_MIN_FULLNESS, SOLO_BATTLE_FULLNESS_COST,
  SOLO_BATTLE_WIN_POINTS, SOLO_BATTLE_LOSS_POINTS, TEAM_BATTLE_MIN_FULLNESS,
  TEAM_BATTLE_MIN_FULLNESS_ENABLED, TEAM_BATTLE_ATTACKER_FULLNESS_COST,
  TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST, TEAM_BATTLE_DEFENDER_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST, getBossContributionStandings
} from '../gameRules';
import {
  getClassGoalCoverage,
  getClassGoalProgress,
  getWeeklyStudentGrowth,
} from '../educationInsights';
import { getPublicStudentName } from '../studentPresentation';
import { PetCard } from './PetCard';

export const ClassroomView: React.FC = () => {
  const {
    currentClass,
    settings,
    showBossVictory,
    bossVictoryResult,
    bossHitFeedback,
    bossAttackFeedback,
    battle,
    setTeammate,
    dismissBossVictory,
    executeBossAttack,
  } = useStore(
    useShallow((state) => ({
      currentClass: state.data.classes.find((classroom) => classroom.id === state.data.currentClassId),
      settings: state.data.settings,
      showBossVictory: state.showBossVictory,
      bossVictoryResult: state.bossVictoryResult,
      bossHitFeedback: state.bossHitFeedback,
      bossAttackFeedback: state.bossAttackFeedback,
      battle: state.battle,
      setTeammate: state.setTeammate,
      dismissBossVictory: state.dismissBossVictory,
      executeBossAttack: state.executeBossAttack,
    })),
  );
  const lang = settings?.language || 'zh';
  const tLang = translations[lang];
  
  const [battleModalOpen, setBattleModalOpen] = useState(false);
  const [attackerId, setAttackerId] = useState<string | null>(null);
  const [defenderId, setDefenderId] = useState<string | null>(null);
  const [teamModalStudentId, setTeamModalStudentId] = useState<string | null>(null);
  const [selectedTeammateIds, setSelectedTeammateIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'leaderboard' | 'teams'>('grid');

  const students = useMemo(() => currentClass?.students || [], [currentClass]);
  const classGoalMetrics = useMemo(
    () => (currentClass?.classGoals ?? []).map((goal) => ({
      goal,
      progress: getClassGoalProgress(students, goal),
      coverage: getClassGoalCoverage(students, goal),
    })),
    [currentClass?.classGoals, students],
  );
  const weeklyStudentGrowth = useMemo(
    () => getWeeklyStudentGrowth(students),
    [students],
  );
  const competencyLabels = useMemo(() => ({
    participation: tLang.competencyParticipation,
    collaboration: tLang.competencyCollaboration,
    selfManagement: tLang.competencySelfManagement,
    assignmentQuality: tLang.competencyAssignmentQuality,
    growth: tLang.competencyGrowth,
  }), [tLang]);
  const bossContributionStandings = useMemo(
    () => currentClass?.activeBoss
      ? getBossContributionStandings(students, currentClass.activeBoss)
      : [],
    [currentClass?.activeBoss, students],
  );
  const topBossImprovement = useMemo(
    () => Math.max(
      0,
      ...(bossVictoryResult?.standings.map((standing) => standing.improvementAmount) ?? []),
    ),
    [bossVictoryResult],
  );
  const attackerStudent = useMemo(
    () => attackerId ? students.find((student: any) => student.id === attackerId) : null,
    [attackerId, students],
  );
  const readinessNow = useMemo(() => Date.now(), [battleModalOpen, students, viewMode]);
  const currentBattleMode = settings?.battleMode ?? DEFAULT_BATTLE_MODE;
  const publicNameMode = settings?.publicNameMode === 'full' ? 'full' : 'masked';
  const publicLeaderboardMode =
    settings?.publicLeaderboardMode === 'rank' ||
    settings?.publicLeaderboardMode === 'hidden'
      ? settings.publicLeaderboardMode
      : 'growth';
  const displayStudentName = useCallback(
    (name: string) => getPublicStudentName(name, publicNameMode),
    [publicNameMode],
  );
  const currentMaxTeamSize = settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE;
  const currentSoloBattleFullnessCost = settings?.soloBattleFullnessCost ?? SOLO_BATTLE_FULLNESS_COST;
  const currentSoloBattleAttackerFullnessCost =
    settings?.soloBattleAttackerFullnessCost ?? currentSoloBattleFullnessCost;
  const currentSoloBattleDefenderFullnessCost =
    settings?.soloBattleDefenderFullnessCost ?? currentSoloBattleFullnessCost;
  const currentSoloBattleWinPoints = settings?.soloBattleWinPoints ?? SOLO_BATTLE_WIN_POINTS;
  const currentSoloBattleLossPoints = settings?.soloBattleLossPoints ?? SOLO_BATTLE_LOSS_POINTS;
  const currentTeamBattleMinFullnessEnabled = settings?.teamBattleMinFullnessEnabled ?? TEAM_BATTLE_MIN_FULLNESS_ENABLED;
  const currentTeamBattleMinFullness = settings?.teamBattleMinFullness ?? TEAM_BATTLE_MIN_FULLNESS;
  const currentTeamBattleAttackerFullnessCost =
    settings?.teamBattleAttackerFullnessCost ?? TEAM_BATTLE_ATTACKER_FULLNESS_COST;
  const currentTeamBattleAttackerTeammateFullnessCost =
    settings?.teamBattleAttackerTeammateFullnessCost ?? TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST;
  const currentTeamBattleDefenderFullnessCost =
    settings?.teamBattleDefenderFullnessCost ?? TEAM_BATTLE_DEFENDER_FULLNESS_COST;
  const currentTeamBattleDefenderTeammateFullnessCost =
    settings?.teamBattleDefenderTeammateFullnessCost ?? TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST;
  const soloBattleReadyOptions = useMemo(() => ({ minimumFullness: SOLO_BATTLE_MIN_FULLNESS }), []);
  const teamBattleReadyOptions = useMemo(() => ({
    minimumFullness: currentTeamBattleMinFullness,
    ignoreFullness: !currentTeamBattleMinFullnessEnabled,
  }), [currentTeamBattleMinFullness, currentTeamBattleMinFullnessEnabled]);

  const handleOpenBattle = useCallback((id: string) => {
    setAttackerId(id);
    setDefenderId(null);
    setBattleModalOpen(true);
  }, []);

  const handleBattle = useCallback(() => {
    if (attackerId && defenderId) {
      battle(attackerId, defenderId);
      setBattleModalOpen(false);
      setAttackerId(null);
      setDefenderId(null);
    }
  }, [attackerId, battle, defenderId]);

  const handleOpenTeamModal = useCallback((id: string) => {
    setTeamModalStudentId(id);
  }, []);

  const teamModalStudent = useMemo(
    () => teamModalStudentId
      ? students.find((student: any) => student.id === teamModalStudentId)
      : null,
    [students, teamModalStudentId],
  );
  const currentTeamMembers = useMemo(
    () => teamModalStudent
      ? getTeamMembers(students, teamModalStudent, currentMaxTeamSize)
          .filter((member) => member.id !== teamModalStudent.id)
      : [],
    [currentMaxTeamSize, students, teamModalStudent],
  );
  const availableTeammates = useMemo(
    () => teamModalStudent
      ? students.filter((candidate: any) => candidate.id !== teamModalStudent.id)
      : [],
    [students, teamModalStudent],
  );
  const getEligibleTeamBattleMembers = useCallback(
    (student: any) =>
      getTeamMembers(students, student, currentMaxTeamSize)
        .filter((member) => isBattleReady(member, readinessNow, teamBattleReadyOptions)),
    [currentMaxTeamSize, readinessNow, students, teamBattleReadyOptions],
  );
  const attackerTeamReadyCount = useMemo(
    () => attackerStudent ? getEligibleTeamBattleMembers(attackerStudent).length : 0,
    [attackerStudent, getEligibleTeamBattleMembers],
  );
  const availableOpponents = useMemo(
    () => students.filter((student: any) => {
      if (student.id === attackerId) return false;
      if (attackerStudent?.teamId && student.teamId === attackerStudent.teamId) return false;
      if (!attackerStudent) return false;

      const canSoloBattle =
        isBattleReady(attackerStudent, readinessNow, soloBattleReadyOptions) &&
        isBattleReady(student, readinessNow, soloBattleReadyOptions);
      const canTeamBattle =
        attackerTeamReadyCount >= 2 &&
        getEligibleTeamBattleMembers(student).length >= 2;

      if (currentBattleMode === 'solo') return canSoloBattle;
      if (currentBattleMode === 'team') return canTeamBattle;
      return canSoloBattle || canTeamBattle;
    }),
    [
      attackerId,
      attackerStudent,
      attackerTeamReadyCount,
      currentBattleMode,
      getEligibleTeamBattleMembers,
      readinessNow,
      soloBattleReadyOptions,
      students,
    ],
  );

  useEffect(() => {
    if (!teamModalStudent) {
      setSelectedTeammateIds([]);
      return;
    }
    setSelectedTeammateIds(currentTeamMembers.map((member) => member.id));
  }, [currentTeamMembers, teamModalStudent]);

  useEffect(() => {
    if (publicLeaderboardMode === 'hidden' && viewMode === 'leaderboard') {
      setViewMode('grid');
    }
  }, [publicLeaderboardMode, viewMode]);

  const sortedByRank = useMemo(
    () => [...students].sort((a, b) => (b.rankPoints || 0) - (a.rankPoints || 0)),
    [students],
  );
  const teams = useMemo(() => {
    const groupedTeams = new Map<string, any[]>();
    students.forEach((student: any) => {
      if (!student.teamId) return;
      const members = groupedTeams.get(student.teamId) ?? [];
      if (members.length < currentMaxTeamSize) members.push(student);
      groupedTeams.set(student.teamId, members);
    });

    return Array.from(groupedTeams.entries())
      .flatMap(([teamId, members]) => {
        if (members.length < 2) return [];
        const wins = members.reduce((total: number, member: any) => total + (member.stats?.wins || 0), 0);
        const losses = members.reduce((total: number, member: any) => total + (member.stats?.losses || 0), 0);
        const totalBattles = wins + losses;
        const totalRankPoints = members.reduce((total: number, member: any) => total + (member.rankPoints || 0), 0);
        const averageLevel = members.reduce((total: number, member: any) => total + (member.pet.level || 1), 0) / members.length;
        const readyMembers = members.filter((member: any) => isBattleReady(member, readinessNow, teamBattleReadyOptions)).length;
        const averageMood = Math.round(
          members.reduce((total: number, member: any) => total + (member.pet.happiness || 0), 0) / members.length,
        );

        return [{
          id: teamId,
          members,
          name: members.map((member: any) => displayStudentName(member.name)).join(' / '),
          totalRankPoints,
          totalBattles,
          wins,
          losses,
          winRate: totalBattles > 0 ? Math.round((wins / totalBattles) * 100) : 0,
          averageLevel,
          readyMembers,
          averageMood,
        }];
      })
      .sort((a: any, b: any) =>
        b.totalRankPoints - a.totalRankPoints ||
        b.winRate - a.winRate ||
        b.averageLevel - a.averageLevel,
      );
  }, [currentMaxTeamSize, displayStudentName, readinessNow, students, teamBattleReadyOptions]);

  const getRankInfo = useCallback((rp: number = 0) => {
    const brackets = settings?.rankBrackets ?? { diamond: 400, platinum: 300, gold: 200, silver: 100 };
    if (rp >= brackets.diamond) return { name: tLang.diamond, color: 'text-cyan-500', bg: 'bg-cyan-100', icon: Crown };
    if (rp >= brackets.platinum) return { name: tLang.platinum, color: 'text-teal-500', bg: 'bg-teal-100', icon: Sparkles };
    if (rp >= brackets.gold) return { name: tLang.gold, color: 'text-yellow-500', bg: 'bg-yellow-100', icon: Medal };
    if (rp >= brackets.silver) return { name: tLang.silver, color: 'text-gray-400', bg: 'bg-gray-100', icon: Award };
    return { name: tLang.bronze, color: 'text-amber-700', bg: 'bg-amber-100', icon: Shield };
  }, [settings?.rankBrackets, tLang]);

  return (
    <div className="min-h-[calc(100vh-64px)] bg-amber-50/50">
      {/* ── Header Zone (Title + Boss Banner) ── */}
      <div className="px-4 sm:px-6 lg:px-8 pt-8">
        <div className="max-w-7xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-extrabold text-amber-900 tracking-tight">{tLang.classroomTitle}</h1>
          <p className="mt-3 max-w-2xl mx-auto text-xl text-amber-700 sm:mt-4">
            {tLang.classroomDesc}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'grid' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
            >
              <Users className="h-4 w-4 inline mr-2" />
              {tLang.classroomTitle}
            </button>
            {publicLeaderboardMode !== 'hidden' && (
              <button
                onClick={() => setViewMode('leaderboard')}
                className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'leaderboard' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
              >
                <BarChart3 className="h-4 w-4 inline mr-2" />
                {publicLeaderboardMode === 'growth' ? tLang.leaderboardGrowth : tLang.leaderboard}
              </button>
            )}
            <button
              onClick={() => setViewMode('teams')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'teams' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
            >
              <Users className="h-4 w-4 inline mr-2" />
              {lang === 'en' ? 'Team Leaderboard' : '隊伍排行榜'}
            </button>
          </div>
        </div>

        {showBossVictory && bossVictoryResult && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl border border-amber-300/30 bg-slate-900 shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-700 px-5 py-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
                    <Trophy className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-black text-amber-300">{tLang.bossDefeatedTitle}</h2>
                    <p className="truncate text-sm text-slate-300">{bossVictoryResult.bossName}</p>
                  </div>
                </div>
                <button
                  onClick={dismissBossVictory}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
                  title={tLang.close}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="overflow-y-auto p-5 sm:p-6">
                <p className="mb-4 text-sm text-slate-300">{tLang.bossDefeatedSubtitle}</p>
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                  <div className="grid min-w-[620px] grid-cols-[52px_minmax(0,1fr)_90px_minmax(220px,auto)] gap-2 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-400">
                    <span>#</span>
                    <span>{tLang.studentName}</span>
                    <span className="text-right">{tLang.damageContribution.replace('{damage}', '')}</span>
                    <span className="text-right">{tLang.rewardPoints} / {tLang.rewardRankPoints} / {tLang.rewardHappiness}</span>
                  </div>
                  {bossVictoryResult.standings.map((standing) => (
                    <div key={standing.studentId} className="grid min-w-[620px] grid-cols-[52px_minmax(0,1fr)_90px_minmax(220px,auto)] items-center gap-2 border-t border-slate-700 px-3 py-3 text-sm">
                      <span className="font-black text-amber-300">{standing.rank}</span>
                      <span className="truncate font-medium text-white">
                        {displayStudentName(standing.studentName)}
                      </span>
                      <span className="text-right font-mono text-rose-300">{standing.damage}</span>
                      <div className="text-right text-slate-200">
                        <div>+{standing.rewardPoints} / +{standing.rewardRankPoints} RP / +{standing.rewardHappiness}</div>
                        <div className="mt-1 flex flex-wrap justify-end gap-1 text-[10px]">
                          {standing.rankRewardPoints + standing.rankRewardRankPoints + standing.rankRewardHappiness > 0 && (
                            <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-amber-300">
                              {tLang.bossRankBonus}
                            </span>
                          )}
                          <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-emerald-300">
                            {tLang.bossParticipationBonus}
                          </span>
                          {standing.receivedImprovementReward && (
                            <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-sky-300">
                              {tLang.bossImprovementBonus}
                            </span>
                          )}
                          {standing.improvementAmount > 0 &&
                            standing.improvementAmount === topBossImprovement && (
                                <span className="rounded bg-violet-400/15 px-1.5 py-0.5 text-violet-300">
                                  {tLang.bossMostImproved}
                                </span>
                              )}
                        </div>
                        {standing.improvementAmount > 0 && (
                          <div className="mt-1 text-[10px] text-sky-300">
                            {tLang.bossImprovementAmount.replace(
                              '{amount}',
                              standing.improvementAmount.toString(),
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-slate-700 px-5 py-4 text-right sm:px-6">
                <button onClick={dismissBossVictory} className="rounded-md bg-amber-400 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-amber-300">
                  {tLang.close}
                </button>
              </div>
            </div>
          </div>
        )}

        {classGoalMetrics.length > 0 && (
          <section className="mb-4 border-y border-emerald-200 bg-emerald-50 px-4 py-4 sm:px-5">
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase text-emerald-700">
              <Target className="h-4 w-4" />
              {tLang.classGoal}
            </div>
            <div className="divide-y divide-emerald-200">
              {classGoalMetrics.map(({ goal, progress, coverage }) => {
                const progressPercent = Math.min(100, Math.round((progress / goal.targetCount) * 100));
                return (
                  <div
                    key={goal.id}
                    className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(230px,0.55fr)] sm:items-center sm:gap-6"
                  >
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-black text-emerald-950">{goal.title}</h2>
                      <p className="text-sm text-emerald-800">{competencyLabels[goal.competency]}</p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs font-bold text-emerald-900">
                        <span>
                          {progress >= goal.targetCount
                            ? tLang.classGoalCompleted
                            : tLang.classGoalProgress
                                .replace('{current}', progress.toString())
                                .replace('{target}', goal.targetCount.toString())}
                        </span>
                        <span>{progressPercent}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-emerald-200">
                        <div
                          className="h-full rounded-full bg-emerald-600 transition-[width] duration-300"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs font-medium text-emerald-800">
                        {tLang.classGoalCoverage
                          .replace('{current}', coverage.studentsReached.toString())
                          .replace('{total}', coverage.totalStudents.toString())}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {currentClass?.activeBoss?.isActive && (
          <div className={`relative isolate z-0 mb-4 overflow-hidden rounded-xl border-2 bg-slate-900 p-5 shadow-2xl ${bossHitFeedback ? 'border-red-500 bg-red-950' : 'border-red-900/50'}`}>
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Skull className="w-32 h-32 text-red-500" />
            </div>
            <div className="relative z-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-red-800 bg-red-950">
                    <Swords className="h-7 w-7 text-red-500" />
                    {bossHitFeedback && (
                      <div key={bossHitFeedback.id} className="absolute -top-7 z-20 whitespace-nowrap text-2xl font-black text-red-400 animate-[bounce_0.8s_ease-out_forwards]">
                        -{bossHitFeedback.damage}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="mb-2 truncate text-2xl font-black text-rose-100">{currentClass.activeBoss.name}</h2>
                    <div className="relative h-6 w-full overflow-hidden rounded-full bg-slate-800 ring-1 ring-white/10">
                      <div
                        className="h-6 rounded-full bg-red-600 transition-all duration-500"
                        style={{ width: `${Math.max(0, (currentClass.activeBoss.currentHp / currentClass.activeBoss.maxHp) * 100)}%` }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow-md">
                        {currentClass.activeBoss.currentHp} / {currentClass.activeBoss.maxHp}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    onClick={executeBossAttack}
                    className="inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-red-500 active:scale-[0.98]"
                  >
                    <Skull className="mr-2 h-4 w-4" />
                    {tLang.executeBossAttack}
                  </button>
                  {bossAttackFeedback && (
                    <p className="min-w-0 text-sm text-rose-200">
                      {bossAttackFeedback.targetNames.length > 0
                        ? `${bossAttackFeedback.targetNames.join(lang === 'en' ? ', ' : '、')} (-${bossAttackFeedback.damage})`
                        : tLang.bossAttackMissed}
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                <h3 className="mb-2 flex items-center text-sm font-bold text-slate-200">
                  <BarChart3 className="mr-2 h-4 w-4 text-amber-300" />
                  {tLang.contributionLeaderboard}
                </h3>
                {bossContributionStandings.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-500">{tLang.noContribution}</p>
                ) : (
                  <div className="max-h-28 space-y-1.5 overflow-y-auto pr-1">
                    {bossContributionStandings.map((standing) => (
                      <div key={standing.studentId} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded bg-slate-800/80 px-2 py-1.5 text-xs">
                        <span className="font-black text-amber-300">{standing.rank}</span>
                        <span className="truncate font-medium text-slate-100">
                          {displayStudentName(standing.studentName)}
                        </span>
                        <span className="font-mono text-rose-300">{standing.damage}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        </div>{/* end max-w-7xl header */}
      </div>{/* end header zone */}

      {/* ── Content Zone ── */}
      <div className="px-4 sm:px-6 lg:px-8 pb-8">
        <div className="max-w-7xl mx-auto">
        {students.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl shadow-sm border-2 border-amber-100">
            <Dog className="h-16 w-16 text-amber-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-amber-900">{tLang.noPets}</h3>
            <p className="text-amber-700 mt-1">{tLang.addStudentFirst}</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {students.map((student: any) => (
              <PetCard 
                key={student.id} 
                studentId={student.id}
                onBattle={handleOpenBattle}
                onTeamUp={handleOpenTeamModal}
                getRankInfo={getRankInfo}
              />
            ))}
          </div>
        ) : viewMode === 'leaderboard' ? (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-100 overflow-hidden max-w-4xl mx-auto">
            <div className="px-6 py-5 border-b border-amber-100 bg-amber-50 flex items-center justify-between">
              <h3 className="text-lg leading-6 font-medium text-amber-900 flex items-center">
                <Trophy className="h-5 w-5 mr-2 text-amber-500" />
                {publicLeaderboardMode === 'growth'
                  ? tLang.leaderboardGrowthTitle
                  : tLang.leaderboard}
              </h3>
            </div>
            <div className="overflow-x-auto">
              {publicLeaderboardMode === 'growth' ? (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.studentName}</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.weeklyPositiveFeedback}</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.competenciesReached}</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.netPointChange}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {weeklyStudentGrowth.map((growth, index) => {
                      const student = students.find((item: any) => item.id === growth.studentId);
                      if (!student) return null;
                      const PetIcon = PET_TYPES.find((pet) => pet.id === student.pet.type)?.icon || Dog;
                      return (
                        <tr key={growth.studentId}>
                          <td className="px-6 py-4 text-sm font-bold text-slate-500">{index + 1}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                                <PetIcon className="h-4 w-4 text-emerald-700" />
                              </div>
                              <span className="ml-3 text-sm font-medium text-gray-900">
                                {displayStudentName(student.name)}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm font-black text-emerald-700">
                            {growth.positiveFeedbackCount}
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-sky-700">
                            {growth.competencyCount}
                          </td>
                          <td className={`px-6 py-4 font-mono text-sm font-bold ${
                            growth.netPoints >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}>
                            {growth.netPoints > 0 ? '+' : ''}{growth.netPoints}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.studentName}</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.rank}</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.rankPoints}</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.winRate}</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.level}</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedByRank.map((student: any, idx: number) => {
                      const rankInfo = getRankInfo(student.rankPoints);
                      const RankIcon = rankInfo.icon;
                      const wins = student.stats?.wins || 0;
                      const losses = student.stats?.losses || 0;
                      const totalBattles = wins + losses;
                      const winRate = totalBattles > 0 ? Math.round((wins / totalBattles) * 100) : 0;
                      const PetIcon = PET_TYPES.find((pet) => pet.id === student.pet.type)?.icon || Dog;

                      return (
                        <tr key={student.id} className={idx < 3 ? 'bg-amber-50/30' : ''}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{idx + 1}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
                                <PetIcon className="h-4 w-4 text-gray-600" />
                              </div>
                              <span className="ml-3 text-sm font-medium text-gray-900">
                                {displayStudentName(student.name)}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${rankInfo.bg} ${rankInfo.color}`}>
                              <RankIcon className="h-3 w-3 mr-1" />
                              {rankInfo.name}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{student.rankPoints || 0}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{winRate}% <span className="text-xs text-gray-400">({wins}W {losses}L)</span></td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">Lv. {student.pet.level || 1}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5 max-w-5xl mx-auto">
            <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-sky-900 flex items-center">
                    <Users className="h-5 w-5 mr-2 text-sky-600" />
                    {lang === 'en' ? 'Team Leaderboard' : '隊伍排行榜'}
                  </h3>
                  <p className="mt-1 text-sm text-sky-800">
                    {lang === 'en'
                      ? 'Team wins grant an exclusive +10 pts / +6 mood bonus to each winning teammate.'
                      : '完整雙人隊伍獲勝時，每位獲勝成員都會獲得 +10 積分 / +6 心情的隊伍獎勵。'}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-sky-900 shadow-sm">
                  {lang === 'en' ? 'Active Teams' : '目前隊伍'}: {teams.length}
                </div>
              </div>
            </div>

            {teams.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-sky-200 bg-white px-6 py-14 text-center text-sm text-slate-500">
                {lang === 'en'
                  ? 'No teams yet. Use the teammate button on a pet card to create one.'
                  : '目前還沒有隊伍，請先在寵物卡片中選擇隊友。'}
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-sky-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">#</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {lang === 'en' ? 'Team' : '隊伍'}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {lang === 'en' ? 'Total RP' : '總 RP'}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {tLang.winRate}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {lang === 'en' ? 'Avg Lv.' : '平均等級'}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {lang === 'en' ? 'Ready Members' : '可出戰人數'}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {lang === 'en' ? 'Avg Mood' : '平均心情'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {teams.map((team: any, idx: number) => (
                        <tr key={team.id} className={idx < 3 ? 'bg-sky-50/40' : ''}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                            {idx + 1}
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm font-semibold text-slate-900">{team.name}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {team.members.map((member: any) => displayStudentName(member.name)).join(' / ')}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-700">
                            {team.totalRankPoints}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                            {team.winRate}% ({team.wins}W {team.losses}L)
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                            {team.averageLevel.toFixed(1)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                              team.readyMembers === team.members.length ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {team.readyMembers}/{team.members.length}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                            {team.averageMood}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

      {/* Battle Modal */}
      {battleModalOpen && attackerId && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-slate-900 flex items-center">
                <Swords className="h-5 w-5 mr-2 text-rose-500" />
                {tLang.selectOpponent}
              </h3>
              <button onClick={() => { setBattleModalOpen(false); setDefenderId(null); }} className="text-gray-400 hover:text-gray-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4 space-y-2 text-sm text-gray-600">
                {currentBattleMode !== 'team' && (
                  <p>
                    {lang === 'en'
                      ? `Solo: attacker -${currentSoloBattleAttackerFullnessCost} fullness, defender -${currentSoloBattleDefenderFullnessCost}. Winner +${currentSoloBattleWinPoints} points, loser -${currentSoloBattleLossPoints} points.`
                      : `個人賽：進攻方消耗 ${currentSoloBattleAttackerFullnessCost} 飽食度，防守方消耗 ${currentSoloBattleDefenderFullnessCost} 飽食度；勝方 +${currentSoloBattleWinPoints} 積分，敗方 -${currentSoloBattleLossPoints} 積分。`}
                  </p>
                )}
                <p className="rounded-xl bg-sky-50 px-3 py-2 text-sky-800">
                  {currentBattleMode === 'solo'
                    ? (lang === 'en'
                        ? 'Current mode is solo only.'
                        : '目前模式為僅個人賽。')
                    : currentBattleMode === 'team'
                      ? (lang === 'en'
                          ? `Current mode is team only. Each side needs at least 2 eligible members, and teams can include up to ${currentMaxTeamSize} members.`
                          : `目前模式為僅隊伍賽。雙方都需至少 2 位符合條件的成員，每隊最多 ${currentMaxTeamSize} 人。`)
                      : (lang === 'en'
                          ? `If both sides have at least 2 eligible members, this match becomes a team battle; otherwise it falls back to solo. Teams can include up to ${currentMaxTeamSize} members.`
                          : `若雙方都至少有 2 位符合條件的成員，這場對戰會切換為隊伍賽；否則會回到個人賽。每隊最多 ${currentMaxTeamSize} 人。`)}
                </p>
                {currentBattleMode !== 'solo' && (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">
                    {lang === 'en'
                      ? `Team: initiator -${currentTeamBattleAttackerFullnessCost}, attacking teammates -${currentTeamBattleAttackerTeammateFullnessCost}, target -${currentTeamBattleDefenderFullnessCost}, defending teammates -${currentTeamBattleDefenderTeammateFullnessCost} fullness. ${currentTeamBattleMinFullnessEnabled ? `Minimum ${currentTeamBattleMinFullness} fullness required.` : 'Minimum fullness gate is disabled.'}`
                      : `隊伍賽：發動攻擊者消耗 ${currentTeamBattleAttackerFullnessCost}、攻擊方隊友消耗 ${currentTeamBattleAttackerTeammateFullnessCost}、被攻擊者消耗 ${currentTeamBattleDefenderFullnessCost}、防守方隊友消耗 ${currentTeamBattleDefenderTeammateFullnessCost} 飽食度。${currentTeamBattleMinFullnessEnabled ? `出戰需至少 ${currentTeamBattleMinFullness} 飽食度。` : '目前已關閉最低飽食度限制。'}`}
                  </p>
                )}
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {availableOpponents.map((student: any) => (
                  <button
                    key={student.id}
                    onClick={() => setDefenderId(student.id)}
                    className={`w-full text-left px-4 py-3 rounded-lg border flex justify-between items-center transition-colors ${
                      defenderId === student.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center">
                      <div className="bg-white p-2 rounded-full shadow-sm mr-3">
                        {(() => {
                          const PetIcon = PET_TYPES.find(p => p.id === student.pet.type)?.icon || Dog;
                          return <PetIcon className="h-5 w-5 text-gray-600" />;
                        })()}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{displayStudentName(student.name)}</div>
                        <div className="text-xs text-gray-500">
                          Lv. {student.pet.level || 1} | {tLang.petFullness}: {student.pet.fullness}
                          {student.teamId
                            ? ` | ${lang === 'en' ? 'Team' : '隊伍'}: ${getTeamMembers(students, student, currentMaxTeamSize).length} ${lang === 'en' ? 'members' : '人'}`
                            : ''}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
                {availableOpponents.length === 0 && (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    {tLang.noOpponents}
                  </div>
                )}
              </div>
            </div>
            <div className="bg-gray-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => { setBattleModalOpen(false); setDefenderId(null); }} 
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={handleBattle} 
                disabled={!defenderId}
                className="px-4 py-2 text-sm font-medium text-white bg-rose-600 border border-transparent rounded-md hover:bg-rose-700 disabled:bg-rose-300 disabled:cursor-not-allowed"
              >
                {tLang.startBattle}
              </button>
            </div>
          </div>
        </div>
      )}

      {teamModalStudent && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-slate-900 flex items-center">
                <Users className="h-5 w-5 mr-2 text-indigo-500" />
                {lang === 'en' ? 'Manage Team' : '管理隊伍'}
              </h3>
              <button onClick={() => setTeamModalStudentId(null)} className="text-gray-400 hover:text-gray-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                {lang === 'en'
                  ? `${displayStudentName(teamModalStudent.name)} can build a team of up to ${currentMaxTeamSize} members.`
                  : `${displayStudentName(teamModalStudent.name)} 可建立最多 ${currentMaxTeamSize} 人的隊伍。`}
              </p>
              {currentTeamMembers.length > 0 && (
                <div className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  {lang === 'en' ? 'Current Team' : '目前隊伍'}: {currentTeamMembers.map((member: any) => displayStudentName(member.name)).join(', ')}
                </div>
              )}
              {currentTeamMembers.length > 0 && (
                <button
                  onClick={() => {
                    setTeammate(teamModalStudent.id, []);
                    setTeamModalStudentId(null);
                  }}
                  className="mb-4 inline-flex items-center rounded-md bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {lang === 'en' ? 'Clear current team' : '解除目前隊伍'}
                </button>
              )}
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {availableTeammates.map((candidate: any) => (
                  <button
                    key={candidate.id}
                    onClick={() => {
                      setSelectedTeammateIds((current) => {
                        if (current.includes(candidate.id)) {
                          return current.filter((id) => id !== candidate.id);
                        }
                        if (current.length >= currentMaxTeamSize - 1) {
                          return current;
                        }
                        return [...current, candidate.id];
                      });
                    }}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                      selectedTeammateIds.includes(candidate.id)
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-slate-900">{displayStudentName(candidate.name)}</div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        selectedTeammateIds.includes(candidate.id) ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {selectedTeammateIds.includes(candidate.id)
                          ? (lang === 'en' ? 'Selected' : '已選取')
                          : candidate.teamId
                            ? (lang === 'en' ? 'In Team' : '已有隊伍')
                            : (lang === 'en' ? 'Available' : '可加入')}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      Lv. {candidate.pet.level || 1} | {tLang.petFullness}: {candidate.pet.fullness}
                    </div>
                  </button>
                ))}
                {availableTeammates.length === 0 && (
                  <div className="text-center py-6 text-sm text-slate-500">
                    {lang === 'en' ? 'No available teammates.' : '目前沒有可選的隊友。'}
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => setTeamModalStudentId(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  {tLang.cancel}
                </button>
                <button
                  onClick={() => {
                    setTeammate(teamModalStudent.id, selectedTeammateIds);
                    setTeamModalStudentId(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700"
                >
                  {lang === 'en' ? 'Save Team' : '儲存隊伍'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
        </div>{/* end max-w-7xl content */}
      </div>{/* end content zone */}
    </div>
  );
};
