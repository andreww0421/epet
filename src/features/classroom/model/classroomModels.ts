import {
  DEFAULT_BATTLE_MODE,
  DEFAULT_MAX_TEAM_SIZE,
} from '../../../store/constants';
import type {
  AppData,
  BattleMode,
  ClassGoal,
  LearningEvidenceRecord,
  Student,
} from '../../../store/types';
import { getTeamMembers } from '../../../store/utils';
import {
  isBattleReady,
  type BattleReadyOptions,
  SOLO_BATTLE_FULLNESS_COST,
  SOLO_BATTLE_LOSS_POINTS,
  SOLO_BATTLE_MIN_FULLNESS,
  SOLO_BATTLE_WIN_POINTS,
  TEAM_BATTLE_ATTACKER_FULLNESS_COST,
  TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_MIN_FULLNESS,
  TEAM_BATTLE_MIN_FULLNESS_ENABLED,
  getActiveClassGoals,
  getWeekEndDate,
  getWeekStartDate,
} from '../../../gameRules';
import {
  getClassGoalCoverage,
  getClassGoalProgress,
} from '../../../educationInsights';

export type ClassroomViewMode = 'grid' | 'leaderboard' | 'teams';

export type ClassroomBattleSettings = {
  mode: BattleMode;
  maxTeamSize: number;
  soloAttackerFullnessCost: number;
  soloDefenderFullnessCost: number;
  soloWinPoints: number;
  soloLossPoints: number;
  teamMinFullnessEnabled: boolean;
  teamMinFullness: number;
  teamAttackerFullnessCost: number;
  teamAttackerTeammateFullnessCost: number;
  teamDefenderFullnessCost: number;
  teamDefenderTeammateFullnessCost: number;
  soloReadyOptions: BattleReadyOptions;
  teamReadyOptions: BattleReadyOptions;
};

export type ClassroomTeamSummary = {
  id: string;
  members: Student[];
  name: string;
  totalRankPoints: number;
  totalBattles: number;
  wins: number;
  losses: number;
  winRate: number;
  averageLevel: number;
  readyMembers: number;
  averageMood: number;
};

export type ClassroomGoalMetric = {
  goal: ClassGoal;
  progress: number;
  coverage: {
    studentsReached: number;
    totalStudents: number;
    rate: number;
  };
};

export const buildClassroomGoalMetrics = (
  students: Student[],
  goals: ClassGoal[] | undefined,
  learningEvidenceRecords: LearningEvidenceRecord[],
  now: number,
  schoolTimeZone?: string,
): ClassroomGoalMetric[] => getActiveClassGoals(goals, now, schoolTimeZone)
  .map((goal) => ({
    goal,
    progress: getClassGoalProgress(students, goal, learningEvidenceRecords),
    coverage: getClassGoalCoverage(students, goal, learningEvidenceRecords),
  }));

export const formatClassGoalWeekLabel = (
  now: number,
  schoolTimeZone: string | undefined,
  language: 'zh' | 'en',
  template: string,
) => {
  const format = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`)
    .toLocaleDateString(language === 'en' ? 'en-US' : 'zh-TW', {
      month: 'numeric',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return template
    .replace('{start}', format(getWeekStartDate(now, schoolTimeZone)))
    .replace('{end}', format(getWeekEndDate(now, schoolTimeZone)));
};

export const getClassroomBattleSettings = (
  settings: AppData['settings'],
): ClassroomBattleSettings => {
  const soloFullnessCost = settings?.soloBattleFullnessCost ?? SOLO_BATTLE_FULLNESS_COST;
  const teamMinFullnessEnabled =
    settings?.teamBattleMinFullnessEnabled ?? TEAM_BATTLE_MIN_FULLNESS_ENABLED;
  const teamMinFullness = settings?.teamBattleMinFullness ?? TEAM_BATTLE_MIN_FULLNESS;

  return {
    mode: settings?.battleMode ?? DEFAULT_BATTLE_MODE,
    maxTeamSize: settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE,
    soloAttackerFullnessCost:
      settings?.soloBattleAttackerFullnessCost ?? soloFullnessCost,
    soloDefenderFullnessCost:
      settings?.soloBattleDefenderFullnessCost ?? soloFullnessCost,
    soloWinPoints: settings?.soloBattleWinPoints ?? SOLO_BATTLE_WIN_POINTS,
    soloLossPoints: settings?.soloBattleLossPoints ?? SOLO_BATTLE_LOSS_POINTS,
    teamMinFullnessEnabled,
    teamMinFullness,
    teamAttackerFullnessCost:
      settings?.teamBattleAttackerFullnessCost ?? TEAM_BATTLE_ATTACKER_FULLNESS_COST,
    teamAttackerTeammateFullnessCost:
      settings?.teamBattleAttackerTeammateFullnessCost ??
      TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
    teamDefenderFullnessCost:
      settings?.teamBattleDefenderFullnessCost ?? TEAM_BATTLE_DEFENDER_FULLNESS_COST,
    teamDefenderTeammateFullnessCost:
      settings?.teamBattleDefenderTeammateFullnessCost ??
      TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
    soloReadyOptions: { minimumFullness: SOLO_BATTLE_MIN_FULLNESS },
    teamReadyOptions: {
      minimumFullness: teamMinFullness,
      ignoreFullness: !teamMinFullnessEnabled,
    },
  };
};

export const getEligibleTeamBattleMembers = (
  students: Student[],
  student: Student,
  now: number,
  settings: Pick<ClassroomBattleSettings, 'maxTeamSize' | 'teamReadyOptions'>,
) => getTeamMembers(students, student, settings.maxTeamSize)
  .filter((member) => isBattleReady(member, now, settings.teamReadyOptions));

export const getEligibleBattleOpponents = (
  students: Student[],
  attackerId: string | null,
  now: number,
  settings: ClassroomBattleSettings,
) => {
  const attacker = attackerId
    ? students.find((student) => student.id === attackerId)
    : undefined;
  if (!attacker) return [];

  const attackerCanSolo = isBattleReady(attacker, now, settings.soloReadyOptions);
  const attackerTeamReadyCount = getEligibleTeamBattleMembers(
    students,
    attacker,
    now,
    settings,
  ).length;

  return students.filter((student) => {
    if (student.id === attacker.id) return false;
    if (attacker.teamId && student.teamId === attacker.teamId) return false;

    const canSoloBattle =
      attackerCanSolo && isBattleReady(student, now, settings.soloReadyOptions);
    const canTeamBattle =
      attackerTeamReadyCount >= 2 &&
      getEligibleTeamBattleMembers(students, student, now, settings).length >= 2;

    if (settings.mode === 'solo') return canSoloBattle;
    if (settings.mode === 'team') return canTeamBattle;
    return canSoloBattle || canTeamBattle;
  });
};

export const sortStudentsByRank = (students: Student[]) =>
  [...students].sort((left, right) =>
    (right.rankPoints ?? 0) - (left.rankPoints ?? 0));

export const buildClassroomTeamSummaries = (
  students: Student[],
  now: number,
  settings: Pick<ClassroomBattleSettings, 'maxTeamSize' | 'teamReadyOptions'>,
  displayStudentName: (name: string) => string,
): ClassroomTeamSummary[] => {
  const groupedTeams = new Map<string, Student[]>();
  students.forEach((student) => {
    if (!student.teamId) return;
    const members = groupedTeams.get(student.teamId) ?? [];
    if (members.length < settings.maxTeamSize) members.push(student);
    groupedTeams.set(student.teamId, members);
  });

  return Array.from(groupedTeams.entries())
    .flatMap(([teamId, members]): ClassroomTeamSummary[] => {
      if (members.length < 2) return [];
      const wins = members.reduce(
        (total, member) => total + (member.stats?.wins ?? 0),
        0,
      );
      const losses = members.reduce(
        (total, member) => total + (member.stats?.losses ?? 0),
        0,
      );
      const totalBattles = wins + losses;
      const totalRankPoints = members.reduce(
        (total, member) => total + (member.rankPoints ?? 0),
        0,
      );
      const averageLevel = members.reduce(
        (total, member) => total + (member.pet.level || 1),
        0,
      ) / members.length;
      const readyMembers = members.filter((member) =>
        isBattleReady(member, now, settings.teamReadyOptions)).length;
      const averageMood = Math.round(
        members.reduce(
          (total, member) => total + (member.pet.happiness || 0),
          0,
        ) / members.length,
      );

      return [{
        id: teamId,
        members,
        name: members.map((member) => displayStudentName(member.name)).join(' / '),
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
    .sort((left, right) =>
      right.totalRankPoints - left.totalRankPoints ||
      right.winRate - left.winRate ||
      right.averageLevel - left.averageLevel);
};
