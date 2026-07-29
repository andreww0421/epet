import { 
  UPGRADE_GACHA_LEVELS, getUpcomingUpgradeGachaLevel, normalizePenaltyStatus, clamp, toFiniteNumber,
  syncPetLifeState, applyDecayToStudent, SOLO_BATTLE_FULLNESS_COST, SOLO_BATTLE_WIN_POINTS,
  SOLO_BATTLE_LOSS_POINTS, TEAM_BATTLE_MIN_FULLNESS, TEAM_BATTLE_MIN_FULLNESS_ENABLED,
  TEAM_BATTLE_ATTACKER_FULLNESS_COST, TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_FULLNESS_COST, TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  DEFAULT_BOSS_ATTACK_MAX_TARGETS, DEFAULT_BOSS_ATTACK_DAMAGE, DEFAULT_BOSS_REWARD_TIERS,
  DEFAULT_BOSS_PARTICIPATION_REWARD, DEFAULT_BOSS_IMPROVEMENT_REWARD, isLearningCompetency,
  MAX_ACTIVITY_RECORDS, MAX_POINT_ADJUSTMENT_RECORDS, MAX_BOSS_REWARD_RECORDS,
  MAX_DAILY_REFLECTIONS, type BossRewardTier, type BossReward, type BossRewardRecord,
} from '../gameRules';
import {
  AppData, Student, DisciplineRecord, PointAdjustmentRecord, WorldBoss, ClassGoal,
  PointReasonOption, LearningEvidenceRecord,
} from './types';
import {
  createLearningEvidenceRecord,
  normalizeLearningEvidenceRecords,
} from '../../shared/education';
import {
  PET_TYPES, DEFAULT_CLASS_NAME, DEFAULT_MAX_TEAM_SIZE, DEFAULT_BATTLE_MODE,
  POINT_REASON_OPTIONS,
} from './constants';

export const getRandomPetType = (useRarity = false) => {
  if (!useRarity) {
    const possiblePets = PET_TYPES.filter((pet) => pet.id !== 'egg');
    return possiblePets[Math.floor(Math.random() * possiblePets.length)].id;
  }

  const rand = Math.random();
  let rarity = 'common';
  if (rand > 0.9) rarity = 'legendary';
  else if (rand > 0.6) rarity = 'rare';

  const possiblePets = PET_TYPES.filter((pet) => pet.rarity === rarity && pet.id !== 'egg');
  return possiblePets[Math.floor(Math.random() * possiblePets.length)].id;
};

export const computeBadges = (student: Pick<Student, 'points' | 'pet' | 'stats'>) => {
  const badges = new Set<string>();

  if ((student.stats?.wins || 0) >= 1) badges.add('badgeFirstWin');
  if ((student.stats?.wins || 0) >= 10) badges.add('badgeVeteran');
  if (student.points >= 500) badges.add('badgeRich');
  if ((student.pet.level || 1) >= 10) badges.add('badgeMaxLevel');

  return Array.from(badges);
};

const normalizeBossReward = (reward: unknown, fallback: BossReward): BossReward => {
  const rawReward = reward && typeof reward === 'object' ? reward as Partial<BossReward> : {};
  return {
    points: Math.max(0, Math.floor(toFiniteNumber(rawReward.points, fallback.points))),
    happiness: Math.max(0, Math.floor(toFiniteNumber(rawReward.happiness, fallback.happiness))),
    rankPoints: Math.max(0, Math.floor(toFiniteNumber(rawReward.rankPoints, fallback.rankPoints))),
  };
};

export const normalizeWorldBoss = (boss: unknown, fallbackIndex: number, now = Date.now()): WorldBoss | undefined => {
  if (!boss || typeof boss !== 'object') return undefined;

  const rawBoss = boss as Partial<WorldBoss> & { rewardPoints?: unknown; rewardHappiness?: unknown };
  const maxHp = Math.max(1, Math.floor(toFiniteNumber(rawBoss.maxHp, 1)));
  const currentHp = clamp(Math.floor(toFiniteNumber(rawBoss.currentHp, maxHp)), 0, maxHp);

  if (rawBoss.isActive === false || currentHp <= 0) {
    return undefined;
  }

  const legacyRewardTier: BossRewardTier[] = rawBoss.rewardPoints != null || rawBoss.rewardHappiness != null
    ? [{
        rank: 1,
        points: Math.max(0, Math.floor(toFiniteNumber(rawBoss.rewardPoints, 0))),
        happiness: Math.max(0, Math.floor(toFiniteNumber(rawBoss.rewardHappiness, 0))),
        rankPoints: DEFAULT_BOSS_REWARD_TIERS[0].rankPoints,
      }]
    : DEFAULT_BOSS_REWARD_TIERS;
  const seenRanks = new Set<number>();
  const rewardTiers = (Array.isArray(rawBoss.rewardTiers) ? rawBoss.rewardTiers : legacyRewardTier)
    .map((tier) => {
      const rank = Math.max(1, Math.floor(toFiniteNumber(tier?.rank, 1)));
      const defaultTier = DEFAULT_BOSS_REWARD_TIERS.find((candidate) => candidate.rank === rank);
      return {
        rank,
        points: Math.max(0, Math.floor(toFiniteNumber(tier?.points, 0))),
        happiness: Math.max(0, Math.floor(toFiniteNumber(tier?.happiness, 0))),
        rankPoints: Math.max(0, Math.floor(toFiniteNumber(tier?.rankPoints, defaultTier?.rankPoints ?? 0))),
      };
    })
    .filter((tier) => {
      if (seenRanks.has(tier.rank)) return false;
      seenRanks.add(tier.rank);
      return true;
    })
    .sort((left, right) => left.rank - right.rank);
  const contributions: Record<string, number> = {};
  if (rawBoss.contributions && typeof rawBoss.contributions === 'object') {
    Object.entries(rawBoss.contributions).forEach(([studentId, damage]) => {
      const safeDamage = Math.max(0, Math.floor(toFiniteNumber(damage, 0)));
      if (safeDamage > 0) contributions[studentId] = safeDamage;
    });
  }
  const attackCounts: Record<string, number> = {};
  if (rawBoss.attackCounts && typeof rawBoss.attackCounts === 'object') {
    Object.entries(rawBoss.attackCounts).forEach(([studentId, count]) => {
      const safeCount = Math.max(0, Math.floor(toFiniteNumber(count, 0)));
      if (safeCount > 0) attackCounts[studentId] = safeCount;
    });
  }

  return {
    id: typeof rawBoss.id === 'string' && rawBoss.id ? rawBoss.id : `boss-${now}-${fallbackIndex}`,
    name: typeof rawBoss.name === 'string' && rawBoss.name.trim() ? rawBoss.name.trim() : 'Unknown Boss',
    maxHp,
    currentHp,
    rewardTiers,
    participationReward: normalizeBossReward(rawBoss.participationReward, DEFAULT_BOSS_PARTICIPATION_REWARD),
    improvementReward: normalizeBossReward(rawBoss.improvementReward, DEFAULT_BOSS_IMPROVEMENT_REWARD),
    contributions,
    attackCounts,
    isActive: true,
  };
};

export const clampTeamSize = (value: unknown) => clamp(Math.floor(toFiniteNumber(value, DEFAULT_MAX_TEAM_SIZE)), 2, 6);

export const createTeamId = (seed = Date.now()) => `team-${seed}-${Math.random().toString(36).slice(2, 8)}`;

export const sanitizeTeamAssignments = (students: Student[], maxTeamSize = DEFAULT_MAX_TEAM_SIZE) => {
  const grouped = new Map<string, Student[]>();
  students.forEach((student) => {
    if (!student.teamId) return;
    const existing = grouped.get(student.teamId) ?? [];
    existing.push(student);
    grouped.set(student.teamId, existing);
  });

  const validMembers = new Set<string>();
  for (const members of grouped.values()) {
    members.slice(0, maxTeamSize).forEach((student) => validMembers.add(student.id));
  }

  return students.map((student) => {
    if (!student.teamId || !validMembers.has(student.id)) {
      return { ...student, teamId: undefined };
    }

    const teamMembers = grouped.get(student.teamId)?.slice(0, maxTeamSize) ?? [];
    return {
      ...student,
      teamId: teamMembers.length >= 2 ? student.teamId : undefined,
    };
  });
};

export const getTeamMembers = (students: Student[], student: Student | undefined, maxTeamSize = DEFAULT_MAX_TEAM_SIZE) => {
  if (!student) return [];
  if (!student.teamId) return [student];
  const teamMembers = students.filter((member) => member.teamId === student.teamId);
  return teamMembers.slice(0, maxTeamSize);
};

const cloneDefaultPointReasons = () =>
  POINT_REASON_OPTIONS.map((option) => ({
    ...option,
    labels: { ...option.labels },
  }));

const stripLegacyPointAmount = (label: string, amount: number) => {
  const match = label.match(/\s([+-]\d+)\s*$/);
  if (!match || Number(match[1]) !== amount) return label;
  return label.slice(0, match.index).trim() || label;
};

export const normalizePointReasonOptions = (value: unknown): PointReasonOption[] => {
  if (!Array.isArray(value)) return cloneDefaultPointReasons();

  const seenIds = new Set<string>();
  const normalized = value
    .map((item, index): PointReasonOption | null => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Partial<PointReasonOption>;
      const id =
        typeof raw.id === 'string' && raw.id.trim()
          ? raw.id.trim().slice(0, 80)
          : `custom-${index + 1}`;
      if (seenIds.has(id) || !isLearningCompetency(raw.competency)) return null;
      const amount = Math.trunc(toFiniteNumber(raw.amount, 0));
      if (amount === 0) return null;
      const rawLabels = (
        raw.labels && typeof raw.labels === 'object' ? raw.labels : {}
      ) as { zh?: unknown; en?: unknown };
      const zh = typeof rawLabels.zh === 'string'
        ? stripLegacyPointAmount(rawLabels.zh.trim().slice(0, 60), amount)
        : '';
      const en = typeof rawLabels.en === 'string'
        ? stripLegacyPointAmount(rawLabels.en.trim().slice(0, 60), amount)
        : '';
      const fallbackLabel = zh || en;
      if (!fallbackLabel) return null;
      seenIds.add(id);
      return {
        id,
        amount,
        competency: raw.competency,
        labels: {
          zh: zh || fallbackLabel,
          en: en || fallbackLabel,
        },
      };
    })
    .filter((item): item is PointReasonOption => Boolean(item))
    .slice(0, 30);

  return normalized.length > 0 ? normalized : cloneDefaultPointReasons();
};

export const normalizeFeedbackReasonHistory = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 120))
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
};

export const createInitialData = (now = Date.now()): AppData => ({
  lastOpened: now,
  classes: [
    {
      id: 'default',
      name: DEFAULT_CLASS_NAME,
      students: [],
      learningEvidenceRecords: [],
    },
  ],
  currentClassId: 'default',
  settings: {
    decayAmount: 2,
    decayType: 'hourly',
    inclusiveMode: true,
    pauseDecayOnWeekends: true,
    petCareMode: 'rest',
    publicNameMode: 'masked',
    publicLeaderboardMode: 'growth',
    language: 'zh',
    feedCost: 10,
    feedGain: 20,
    playCost: 5,
    playGain: 15,
    battleEnabled: true,
    battleMode: DEFAULT_BATTLE_MODE,
    maxTeamSize: DEFAULT_MAX_TEAM_SIZE,
    maxPoints: 700,
    soloBattleFullnessCost: SOLO_BATTLE_FULLNESS_COST,
    soloBattleAttackerFullnessCost: SOLO_BATTLE_FULLNESS_COST,
    soloBattleDefenderFullnessCost: SOLO_BATTLE_FULLNESS_COST,
    soloBattleWinPoints: SOLO_BATTLE_WIN_POINTS,
    soloBattleLossPoints: SOLO_BATTLE_LOSS_POINTS,
    teamBattleMinFullnessEnabled: TEAM_BATTLE_MIN_FULLNESS_ENABLED,
    teamBattleMinFullness: TEAM_BATTLE_MIN_FULLNESS,
    teamBattleAttackerFullnessCost: TEAM_BATTLE_ATTACKER_FULLNESS_COST,
    teamBattleAttackerTeammateFullnessCost: TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
    teamBattleDefenderFullnessCost: TEAM_BATTLE_DEFENDER_FULLNESS_COST,
    teamBattleDefenderTeammateFullnessCost: TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
    bossAttackMaxTargets: DEFAULT_BOSS_ATTACK_MAX_TARGETS,
    bossAttackDamage: DEFAULT_BOSS_ATTACK_DAMAGE,
    bossAttackMode: 'shared',
    pointReasonOptions: cloneDefaultPointReasons(),
    pinnedReasonIds: ['homework', 'participation', 'helpful'],
    recentReasonIds: [],
    feedbackReasonHistory: [],
  },
});

export const normalizeStudent = (student: any, fallbackIndex: number, now = Date.now()): Student => {
  const normalizedStudent: Student = {
    id: typeof student?.id === 'string' && student.id ? student.id : `student-${now}-${fallbackIndex}`,
    name: typeof student?.name === 'string' && student.name.trim() ? student.name.trim() : `Student ${fallbackIndex + 1}`,
    points: clamp(toFiniteNumber(student?.points, 0), 0, 700),
    pet: {
      type: PET_TYPES.some((pet) => pet.id === student?.pet?.type) ? student.pet.type : 'egg',
      fullness: clamp(toFiniteNumber(student?.pet?.fullness, 80), 0, 100),
      happiness: clamp(toFiniteNumber(student?.pet?.happiness, 80), 0, 100),
      level: clamp(Math.floor(toFiniteNumber(student?.pet?.level, 1)), 1, 10),
      isDead: Boolean(student?.pet?.isDead),
      zeroFullnessSince:
        student?.pet?.zeroFullnessSince == null
          ? undefined
          : toFiniteNumber(student.pet.zeroFullnessSince, now),
    },
    stats: {
      wins: Math.max(0, Math.floor(toFiniteNumber(student?.stats?.wins, 0))),
      losses: Math.max(0, Math.floor(toFiniteNumber(student?.stats?.losses, 0))),
    },
    rankPoints: Math.max(0, Math.floor(toFiniteNumber(student?.rankPoints, 0))),
    warningPoints: Math.max(0, Math.floor(toFiniteNumber(student?.warningPoints, 0))),
    activeWarningTimestamps: Array.isArray(student?.activeWarningTimestamps) 
      ? student.activeWarningTimestamps.map(Number)
      : Array.from({ length: Math.max(0, Math.floor(toFiniteNumber(student?.warningPoints, 0))) }).map(() => now),
    nextUpgradeGachaLevel:
      student?.nextUpgradeGachaLevel == null
        ? getUpcomingUpgradeGachaLevel(clamp(Math.floor(toFiniteNumber(student?.pet?.level, 1)), 1, 10))
        : UPGRADE_GACHA_LEVELS.has(Math.floor(toFiniteNumber(student?.nextUpgradeGachaLevel, 2)))
          ? Math.floor(toFiniteNumber(student?.nextUpgradeGachaLevel, 2))
          : null,
    penaltyStatus: normalizePenaltyStatus(student?.penaltyStatus, now),
    disciplineRecords: Array.isArray(student?.disciplineRecords)
      ? student.disciplineRecords
          .map((record: any, index: number) => ({
            id:
              typeof record?.id === 'string' && record.id
                ? record.id
                : `record-${now}-${fallbackIndex}-${index}`,
            type:
              record?.type === 'warning' || record?.type === 'autoPenalty' || record?.type === 'discipline'
                ? record.type
                : 'warning',
            createdAt: toFiniteNumber(record?.createdAt, now),
            warningCount: record?.warningCount == null ? undefined : Math.max(0, Math.floor(toFiniteNumber(record.warningCount, 0))),
          }))
          .sort((a: DisciplineRecord, b: DisciplineRecord) => b.createdAt - a.createdAt)
          .slice(0, MAX_ACTIVITY_RECORDS)
      : [],
    pointAdjustmentRecords: Array.isArray(student?.pointAdjustmentRecords)
      ? student.pointAdjustmentRecords
          .map((record: any, index: number) => ({
            id:
              typeof record?.id === 'string' && record.id
                ? record.id
                : `points-${now}-${fallbackIndex}-${index}`,
            amount: toFiniteNumber(record?.amount, 0),
            createdAt: toFiniteNumber(record?.createdAt, now),
            source:
              record?.source === 'manual' ||
              record?.source === 'airdrop' ||
              record?.source === 'dailyTask'
                ? record.source
                : 'quick',
            reasonId: typeof record?.reasonId === 'string' ? record.reasonId : undefined,
            reasonLabel: typeof record?.reasonLabel === 'string' ? record.reasonLabel : undefined,
            competency: isLearningCompetency(record?.competency) ? record.competency : undefined,
          }))
          .sort((a: PointAdjustmentRecord, b: PointAdjustmentRecord) => b.createdAt - a.createdAt)
          .slice(0, MAX_POINT_ADJUSTMENT_RECORDS)
      : [],
    bossRewardRecords: Array.isArray(student?.bossRewardRecords)
      ? student.bossRewardRecords
          .map((record: any, index: number): BossRewardRecord => ({
            id:
              typeof record?.id === 'string' && record.id
                ? record.id
                : `boss-reward-${now}-${fallbackIndex}-${index}`,
            bossId:
              typeof record?.bossId === 'string' && record.bossId
                ? record.bossId
                : `legacy-boss-${fallbackIndex}-${index}`,
            bossName:
              typeof record?.bossName === 'string' && record.bossName.trim()
                ? record.bossName.trim()
                : 'Unknown Boss',
            createdAt: toFiniteNumber(record?.createdAt, now),
            rank: Math.max(1, Math.floor(toFiniteNumber(record?.rank, 1))),
            damage: Math.max(0, Math.floor(toFiniteNumber(record?.damage, 0))),
            attackCount: Math.max(1, Math.floor(toFiniteNumber(record?.attackCount, 1))),
            fairScore: Math.max(
              0,
              Math.floor(toFiniteNumber(record?.fairScore, record?.damage ?? 0)),
            ),
            previousDamage: Math.max(0, Math.floor(toFiniteNumber(record?.previousDamage, 0))),
            previousFairScore: Math.max(
              0,
              Math.floor(toFiniteNumber(record?.previousFairScore, record?.previousDamage ?? 0)),
            ),
            improvementAmount: Math.max(0, Math.floor(toFiniteNumber(record?.improvementAmount, 0))),
            fairImprovementAmount: Math.max(
              0,
              Math.floor(
                toFiniteNumber(record?.fairImprovementAmount, record?.improvementAmount ?? 0),
              ),
            ),
            rewardPoints: Math.max(0, Math.floor(toFiniteNumber(record?.rewardPoints, 0))),
            rewardRankPoints: Math.max(0, Math.floor(toFiniteNumber(record?.rewardRankPoints, 0))),
            rewardHappiness: Math.max(0, Math.floor(toFiniteNumber(record?.rewardHappiness, 0))),
            rankRewardPoints: Math.max(0, Math.floor(toFiniteNumber(record?.rankRewardPoints, 0))),
            rankRewardRankPoints: Math.max(0, Math.floor(toFiniteNumber(record?.rankRewardRankPoints, 0))),
            rankRewardHappiness: Math.max(0, Math.floor(toFiniteNumber(record?.rankRewardHappiness, 0))),
            participationRewardPoints: Math.max(0, Math.floor(toFiniteNumber(record?.participationRewardPoints, 0))),
            participationRewardRankPoints: Math.max(0, Math.floor(toFiniteNumber(record?.participationRewardRankPoints, 0))),
            participationRewardHappiness: Math.max(0, Math.floor(toFiniteNumber(record?.participationRewardHappiness, 0))),
            improvementRewardPoints: Math.max(0, Math.floor(toFiniteNumber(record?.improvementRewardPoints, 0))),
            improvementRewardRankPoints: Math.max(0, Math.floor(toFiniteNumber(record?.improvementRewardRankPoints, 0))),
            improvementRewardHappiness: Math.max(0, Math.floor(toFiniteNumber(record?.improvementRewardHappiness, 0))),
            receivedImprovementReward:
              Boolean(record?.receivedImprovementReward) ||
              toFiniteNumber(record?.improvementRewardPoints, 0) > 0 ||
              toFiniteNumber(record?.improvementRewardRankPoints, 0) > 0 ||
              toFiniteNumber(record?.improvementRewardHappiness, 0) > 0,
          }))
          .sort((a: BossRewardRecord, b: BossRewardRecord) => b.createdAt - a.createdAt)
          .slice(0, MAX_BOSS_REWARD_RECORDS)
      : [],
    dailyProgress: {
      lastClaimDate: typeof student?.dailyProgress?.lastClaimDate === 'string' ? student.dailyProgress.lastClaimDate : undefined,
      streak: Math.max(0, Math.floor(toFiniteNumber(student?.dailyProgress?.streak, 0))),
      reflections: Array.isArray(student?.dailyProgress?.reflections)
          ? student.dailyProgress.reflections
            .filter((reflection: any) => isLearningCompetency(reflection?.competency))
            .map((reflection: any, index: number) => {
              const author =
                reflection?.author === 'mentor' || reflection?.mentorAssessment
                  ? 'mentor'
                  : 'student';
              const rawAssessment =
                author === 'mentor' ? reflection?.mentorAssessment : reflection?.selfAssessment;
              const assessment =
                rawAssessment === 'needsSupport' || rawAssessment === 'confident'
                  ? rawAssessment
                  : 'progressing';
              return {
                id:
                  typeof reflection?.id === 'string' && reflection.id
                    ? reflection.id
                    : `reflection-${now}-${fallbackIndex}-${index}`,
                date:
                  typeof reflection?.date === 'string' && reflection.date
                    ? reflection.date
                    : new Date(toFiniteNumber(reflection?.createdAt, now)).toISOString().slice(0, 10),
                createdAt: toFiniteNumber(reflection?.createdAt, now),
                competency: reflection.competency,
                author,
                selfAssessment: author === 'student' ? assessment : undefined,
                mentorAssessment: author === 'mentor' ? assessment : undefined,
                text:
                  typeof reflection?.text === 'string' && reflection.text.trim()
                    ? reflection.text.trim().slice(0, 160)
                    : undefined,
              };
            })
            .sort((left: any, right: any) => right.createdAt - left.createdAt)
            .slice(0, MAX_DAILY_REFLECTIONS)
        : [],
    },
    lastBossDamage:
      student?.lastBossDamage == null
        ? undefined
        : Math.max(0, Math.floor(toFiniteNumber(student.lastBossDamage, 0))),
    lastBossFairScore:
      student?.lastBossFairScore == null
        ? undefined
        : Math.max(0, Math.floor(toFiniteNumber(student.lastBossFairScore, 0))),
    teamId: typeof student?.teamId === 'string' && student.teamId ? student.teamId : undefined,
    badges: [],
  };

  return {
    ...normalizedStudent,
    pet: syncPetLifeState(normalizedStudent.pet, now),
    badges: computeBadges(normalizedStudent),
  };
};

export const normalizeAppData = (raw: any, now = Date.now()): AppData => {
  const initialData = createInitialData(now);
  const rawSettings = raw?.settings ?? {};
  const requestedPauseDecayOnWeekends = rawSettings?.pauseDecayOnWeekends !== false;
  const requestedPetCareMode = rawSettings?.petCareMode === 'death' ? 'death' : 'rest';
  const requestedPublicNameMode = rawSettings?.publicNameMode === 'full' ? 'full' : 'masked';
  const requestedPublicLeaderboardMode =
    rawSettings?.publicLeaderboardMode === 'rank' ||
    rawSettings?.publicLeaderboardMode === 'hidden'
      ? rawSettings.publicLeaderboardMode
      : 'growth';
  const requestedBossAttackMode = rawSettings?.bossAttackMode === 'random' ? 'random' : 'shared';
  const inclusiveMode =
    typeof rawSettings?.inclusiveMode === 'boolean'
      ? rawSettings.inclusiveMode
      : requestedPauseDecayOnWeekends &&
        requestedPetCareMode === 'rest' &&
        requestedPublicNameMode === 'masked' &&
        requestedPublicLeaderboardMode !== 'rank' &&
        requestedBossAttackMode === 'shared';
  const rawClasses = Array.isArray(raw?.classes) && raw.classes.length > 0
    ? raw.classes
    : [
        {
          id: 'default',
          name: DEFAULT_CLASS_NAME,
          students: Array.isArray(raw?.students) ? raw.students : [],
        },
      ];

  const classes = rawClasses.map((classItem: any, index: number) => {
    const classId =
      typeof classItem?.id === 'string' && classItem.id
        ? classItem.id
        : `class-${now}-${index}`;
    const rawStudents = Array.isArray(classItem?.students) ? classItem.students : [];
    const students = rawStudents.map((student: any, studentIndex: number) => normalizeStudent(student, studentIndex, now));
    const studentById = new Map<string, Student>(students.map((student) => [student.id, student] as const));
    const legacyPairs = new Map<string, string>();
    rawStudents.forEach((student: any, studentIndex: number) => {
      const normalizedId = students[studentIndex]?.id;
      if (!normalizedId) return;
      if (typeof student?.teammateId === 'string' && student.teammateId) {
        legacyPairs.set(normalizedId, student.teammateId);
      }
    });
    const withLegacyTeams = students.map((student) => {
      if (student.teamId) return student;
      const legacyMateId = legacyPairs.get(student.id);
      if (!legacyMateId) return student;
      const mate = studentById.get(legacyMateId);
      if (!mate || legacyPairs.get(mate.id) !== student.id) return student;
      const derivedTeamId = `legacy-team-${[student.id, mate.id].sort().join('-')}`;
      return { ...student, teamId: derivedTeamId };
    });
    const rawGoals = Array.isArray(classItem?.classGoals)
      ? classItem.classGoals
      : classItem?.classGoal
        ? [classItem.classGoal]
        : [];
    const classGoals = rawGoals
      .filter((goal: any) => goal && typeof goal === 'object' && isLearningCompetency(goal.competency))
      .slice(0, 3)
      .map((goal: any, goalIndex: number): ClassGoal => ({
        id:
          typeof goal.id === 'string' && goal.id
            ? goal.id
            : `goal-${now}-${index}-${goalIndex}`,
        title:
          typeof goal.title === 'string' && goal.title.trim()
            ? goal.title.trim()
            : 'Class goal',
        competency: goal.competency,
        targetCount: Math.max(1, Math.floor(toFiniteNumber(goal.targetCount, 10))),
        createdAt: toFiniteNumber(goal.createdAt, now),
      }));
    const sanitizedStudents = sanitizeTeamAssignments(
      withLegacyTeams,
      clampTeamSize(rawSettings?.maxTeamSize),
    );
    const validStudentIds = new Set(sanitizedStudents.map((student) => student.id));
    const explicitEvidence = normalizeLearningEvidenceRecords(
      classItem?.learningEvidenceRecords,
      classId,
      validStudentIds,
      now,
    );
    const existingSourceIds = new Set(
      explicitEvidence
        .filter((record) => record.sourceId)
        .map((record) => `${record.source}:${record.sourceId}`),
    );
    const migratedEvidence = sanitizedStudents.flatMap((student) =>
      (student.dailyProgress?.reflections ?? [])
        .filter(
          (reflection) =>
            reflection.author === 'mentor' &&
            !existingSourceIds.has(`mentorDailyFeedback:${reflection.id}`),
        )
        .map((reflection): LearningEvidenceRecord =>
          createLearningEvidenceRecord(
            classId,
            student.id,
            {
              competency: reflection.competency,
              level:
                reflection.mentorAssessment === 'needsSupport'
                  ? 'needsSupport'
                  : reflection.mentorAssessment === 'confident'
                    ? 'mastered'
                    : 'progressing',
              evidenceType: 'observation',
              title: reflection.text || 'Mentor daily feedback',
              note: reflection.text,
              actor: 'mentor',
              source: 'mentorDailyFeedback',
              sourceId: reflection.id,
              rubricVersion: 'legacy-1.0',
            },
            reflection.createdAt,
            `evidence-${reflection.id}`,
          ),
        ),
    );
    const learningEvidenceRecords = normalizeLearningEvidenceRecords(
      [...explicitEvidence, ...migratedEvidence],
      classId,
      validStudentIds,
      now,
    );

    return {
      id: classId,
      name: typeof classItem?.name === 'string' && classItem.name.trim() ? classItem.name.trim() : DEFAULT_CLASS_NAME,
      students: sanitizedStudents,
      activeBoss: normalizeWorldBoss(classItem?.activeBoss, index, now),
      classGoals,
      learningEvidenceRecords,
    };
  });

  const currentClassId = typeof raw?.currentClassId === 'string' && classes.some((classData) => classData.id === raw.currentClassId)
    ? raw.currentClassId
    : classes[0]?.id ?? initialData.currentClassId;
  const soloBattleFullnessCost = Math.max(
    0,
    toFiniteNumber(rawSettings?.soloBattleFullnessCost, initialData.settings?.soloBattleFullnessCost ?? SOLO_BATTLE_FULLNESS_COST),
  );
  const pointReasonOptions = normalizePointReasonOptions(rawSettings?.pointReasonOptions);
  const pointReasonIds = new Set(pointReasonOptions.map((option) => option.id));
  const pinnedReasonIds = normalizeReasonIds(
    rawSettings?.pinnedReasonIds,
    initialData.settings?.pinnedReasonIds,
  ).filter((id) => pointReasonIds.has(id));
  const recentReasonIds = normalizeReasonIds(rawSettings?.recentReasonIds)
    .filter((id) => pointReasonIds.has(id));

  return {
    lastOpened: toFiniteNumber(raw?.lastOpened, now),
    classes,
    currentClassId,
    settings: {
      decayAmount: Math.max(0, toFiniteNumber(rawSettings?.decayAmount ?? rawSettings?.hourlyDecay, initialData.settings?.decayAmount ?? 2)),
      decayType: rawSettings?.decayType === 'daily' ? 'daily' : 'hourly',
      inclusiveMode,
      pauseDecayOnWeekends: inclusiveMode || requestedPauseDecayOnWeekends,
      petCareMode: inclusiveMode ? 'rest' : requestedPetCareMode,
      publicNameMode: inclusiveMode ? 'masked' : requestedPublicNameMode,
      publicLeaderboardMode:
        inclusiveMode && requestedPublicLeaderboardMode === 'rank'
          ? 'growth'
          : requestedPublicLeaderboardMode,
      language: rawSettings?.language === 'en' ? 'en' : 'zh',
      feedCost: Math.max(1, toFiniteNumber(rawSettings?.feedCost, initialData.settings?.feedCost ?? 10)),
      feedGain: Math.max(1, toFiniteNumber(rawSettings?.feedGain, initialData.settings?.feedGain ?? 20)),
      playCost: Math.max(1, toFiniteNumber(rawSettings?.playCost, initialData.settings?.playCost ?? 5)),
      playGain: Math.max(1, toFiniteNumber(rawSettings?.playGain, initialData.settings?.playGain ?? 15)),
      battleEnabled: rawSettings?.battleEnabled !== false,
      battleMode:
        rawSettings?.battleMode === 'solo' || rawSettings?.battleMode === 'team' || rawSettings?.battleMode === 'both'
          ? rawSettings.battleMode
          : DEFAULT_BATTLE_MODE,
      maxTeamSize: clampTeamSize(rawSettings?.maxTeamSize),
      maxPoints: Math.max(100, toFiniteNumber(rawSettings?.maxPoints, initialData.settings?.maxPoints ?? 700)),
      rankBrackets: rawSettings?.rankBrackets ?? { diamond: 400, platinum: 300, gold: 200, silver: 100 },
      battleRankPointsWin: Math.max(0, toFiniteNumber(rawSettings?.battleRankPointsWin, 20)),
      battleRankPointsLoss: Math.max(0, toFiniteNumber(rawSettings?.battleRankPointsLoss, 10)),
      soloBattleFullnessCost,
      soloBattleAttackerFullnessCost: Math.max(
        0,
        toFiniteNumber(rawSettings?.soloBattleAttackerFullnessCost, soloBattleFullnessCost),
      ),
      soloBattleDefenderFullnessCost: Math.max(
        0,
        toFiniteNumber(rawSettings?.soloBattleDefenderFullnessCost, soloBattleFullnessCost),
      ),
      soloBattleWinPoints: Math.max(
        0,
        toFiniteNumber(rawSettings?.soloBattleWinPoints, initialData.settings?.soloBattleWinPoints ?? SOLO_BATTLE_WIN_POINTS),
      ),
      soloBattleLossPoints: Math.max(
        0,
        toFiniteNumber(rawSettings?.soloBattleLossPoints, initialData.settings?.soloBattleLossPoints ?? SOLO_BATTLE_LOSS_POINTS),
      ),
      teamBattleMinFullnessEnabled: rawSettings?.teamBattleMinFullnessEnabled !== false,
      teamBattleMinFullness: Math.max(
        0,
        toFiniteNumber(rawSettings?.teamBattleMinFullness, initialData.settings?.teamBattleMinFullness ?? TEAM_BATTLE_MIN_FULLNESS),
      ),
      teamBattleAttackerFullnessCost: Math.max(
        0,
        toFiniteNumber(rawSettings?.teamBattleAttackerFullnessCost, TEAM_BATTLE_ATTACKER_FULLNESS_COST),
      ),
      teamBattleAttackerTeammateFullnessCost: Math.max(
        0,
        toFiniteNumber(rawSettings?.teamBattleAttackerTeammateFullnessCost, TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST),
      ),
      teamBattleDefenderFullnessCost: Math.max(
        0,
        toFiniteNumber(rawSettings?.teamBattleDefenderFullnessCost, TEAM_BATTLE_DEFENDER_FULLNESS_COST),
      ),
      teamBattleDefenderTeammateFullnessCost: Math.max(
        0,
        toFiniteNumber(rawSettings?.teamBattleDefenderTeammateFullnessCost, TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST),
      ),
      bossAttackMaxTargets: clamp(
        Math.floor(toFiniteNumber(rawSettings?.bossAttackMaxTargets, DEFAULT_BOSS_ATTACK_MAX_TARGETS)),
        0,
        4,
      ),
      bossAttackDamage: Math.max(
        0,
        Math.floor(toFiniteNumber(rawSettings?.bossAttackDamage, DEFAULT_BOSS_ATTACK_DAMAGE)),
      ),
      bossAttackMode: inclusiveMode ? 'shared' : requestedBossAttackMode,
      pointReasonOptions,
      pinnedReasonIds,
      recentReasonIds,
      feedbackReasonHistory: normalizeFeedbackReasonHistory(rawSettings?.feedbackReasonHistory),
      enableSeasonResetRewards: Boolean(rawSettings?.enableSeasonResetRewards),
      seasonResetRewards: rawSettings?.seasonResetRewards ?? { diamond: 500, platinum: 400, gold: 300, silver: 200, bronze: 100 },
      reviveCost: Math.max(0, toFiniteNumber(rawSettings?.reviveCost, 120)),
    },
  };
};

const normalizeReasonIds = (value: unknown, fallback: string[] = []) => {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from(new Set(
    source.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
  )).slice(0, 12);
};

export const countDecayPeriods = (
  lastOpened: number,
  now: number,
  intervalMs: number,
  pauseOnWeekends: boolean,
) => {
  const elapsedMs = Math.max(0, now - lastOpened);
  const totalPeriods = Math.floor(elapsedMs / intervalMs);
  if (!pauseOnWeekends || totalPeriods <= 0) return totalPeriods;

  let eligiblePeriods = 0;
  let index = 1;
  while (index <= totalPeriods) {
    const periodMidpoint = lastOpened + (index - 0.5) * intervalMs;
    const midpointDate = new Date(periodMidpoint);
    const day = midpointDate.getDay();

    if (intervalMs <= 1000 * 60 * 60) {
      const nextDay = new Date(
        midpointDate.getFullYear(),
        midpointDate.getMonth(),
        midpointDate.getDate() + 1,
      ).getTime();
      const periodsInDay = Math.max(1, Math.ceil((nextDay - periodMidpoint) / intervalMs));
      const chunkSize = Math.min(periodsInDay, totalPeriods - index + 1);
      if (day !== 0 && day !== 6) eligiblePeriods += chunkSize;
      index += chunkSize;
      continue;
    }

    if (day !== 0 && day !== 6) eligiblePeriods += 1;
    index += 1;
  }
  return eligiblePeriods;
};

export type SettingsImpactPreview = {
  currentAverageFullness: number;
  projectedAverageFullness: number;
  sevenDayDecay: number;
  estimatedUpgradeActions: number;
  estimatedUpgradeDays: number;
};

export const getSettingsImpactPreview = (
  students: Student[],
  settings: {
    decayAmount: number;
    decayType: 'hourly' | 'daily';
    pauseDecayOnWeekends: boolean;
    feedCost: number;
    feedGain: number;
  },
  weeklyPositiveFeedbackCount: number,
  now = Date.now(),
): SettingsImpactPreview => {
  if (students.length === 0) {
    return {
      currentAverageFullness: 0,
      projectedAverageFullness: 0,
      sevenDayDecay: 0,
      estimatedUpgradeActions: 0,
      estimatedUpgradeDays: 0,
    };
  }

  const intervalMs = settings.decayType === 'daily'
    ? 1000 * 60 * 60 * 24
    : 1000 * 60 * 60;
  const previewEnd = now + 7 * 24 * 60 * 60 * 1000;
  const decayPeriods = countDecayPeriods(
    now,
    previewEnd,
    intervalMs,
    settings.pauseDecayOnWeekends,
  );
  const sevenDayDecay = Math.max(0, settings.decayAmount) * decayPeriods;
  const average = (values: number[]) =>
    Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;

  const currentAverageFullness = average(students.map((student) => student.pet.fullness));
  const projectedAverageFullness = average(
    students.map((student) => clamp(student.pet.fullness - sevenDayDecay, 0, 100)),
  );
  const studentsBelowMaxLevel = students.filter((student) => student.pet.level < 10);
  const averagePointGap = studentsBelowMaxLevel.length === 0
    ? 0
    : average(studentsBelowMaxLevel.map((student) => {
        const upgradeCost = 100 + (student.pet.level - 1) * 50;
        const feedCount = Math.ceil(
          Math.max(0, 100 - student.pet.fullness) / Math.max(1, settings.feedGain),
        );
        const totalRequiredPoints = upgradeCost + feedCount * Math.max(0, settings.feedCost);
        return Math.max(0, totalRequiredPoints - student.points);
      }));
  const estimatedUpgradeActions = Math.ceil(averagePointGap / 20);
  const observedActionsPerStudentPerDay = weeklyPositiveFeedbackCount > 0
    ? weeklyPositiveFeedbackCount / students.length / 7
    : 1;
  const estimatedUpgradeDays = estimatedUpgradeActions === 0
    ? 0
    : Math.ceil(estimatedUpgradeActions / Math.max(observedActionsPerStudentPerDay, 1 / 7));

  return {
    currentAverageFullness,
    projectedAverageFullness,
    sevenDayDecay,
    estimatedUpgradeActions,
    estimatedUpgradeDays,
  };
};

export const applyDecay = (appData: AppData, now = Date.now()): AppData => {
  const lastOpened = toFiniteNumber(appData.lastOpened, now);
  const elapsedMs = Math.max(0, now - lastOpened);
  const intervalMs = appData.settings?.decayType === 'daily' ? 1000 * 60 * 60 * 24 : 1000 * 60 * 60;
  const periodsPassed = Math.floor(elapsedMs / intervalMs);
  const allowDeath = appData.settings?.petCareMode === 'death';

  if (periodsPassed <= 0) {
    if (allowDeath) return appData;

    let changed = false;
    const classes = appData.classes.map((classData) => ({
      ...classData,
      students: classData.students.map((student) => {
        if (!student.pet.isDead) return student;
        changed = true;
        return {
          ...student,
          pet: {
            ...student.pet,
            isDead: false,
          },
        };
      }),
    }));
    return changed ? { ...appData, classes } : appData;
  }

  const eligiblePeriods = countDecayPeriods(
    lastOpened,
    now,
    intervalMs,
    appData.settings?.pauseDecayOnWeekends !== false,
  );
  const decay = eligiblePeriods * (appData.settings?.decayAmount ?? 2);
  const nextLastOpened = now - (elapsedMs % intervalMs);

  return {
    ...appData,
    lastOpened: nextLastOpened,
    classes: appData.classes.map((classData) => ({
      ...classData,
      students: classData.students.map((student) =>
        applyDecayToStudent(student, decay, now, { allowDeath }),
      ),
    })),
  };
};
