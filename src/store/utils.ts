import { 
  UPGRADE_GACHA_LEVELS, getUpcomingUpgradeGachaLevel, normalizePenaltyStatus, clamp, toFiniteNumber,
  syncPetLifeState, applyDecayToStudent, SOLO_BATTLE_FULLNESS_COST, SOLO_BATTLE_WIN_POINTS,
  SOLO_BATTLE_LOSS_POINTS, TEAM_BATTLE_MIN_FULLNESS, TEAM_BATTLE_MIN_FULLNESS_ENABLED,
  TEAM_BATTLE_ATTACKER_FULLNESS_COST, TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_FULLNESS_COST, TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  DEFAULT_BOSS_ATTACK_MAX_TARGETS, DEFAULT_BOSS_ATTACK_DAMAGE, DEFAULT_BOSS_REWARD_TIERS,
  type BossRewardTier,
} from '../gameRules';
import { AppData, Student, DisciplineRecord, PointAdjustmentRecord, WorldBoss } from './types';
import { PET_TYPES, DEFAULT_CLASS_NAME, DEFAULT_MAX_TEAM_SIZE, DEFAULT_BATTLE_MODE } from './constants';

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
      }]
    : DEFAULT_BOSS_REWARD_TIERS;
  const seenRanks = new Set<number>();
  const rewardTiers = (Array.isArray(rawBoss.rewardTiers) ? rawBoss.rewardTiers : legacyRewardTier)
    .map((tier) => ({
      rank: Math.max(1, Math.floor(toFiniteNumber(tier?.rank, 1))),
      points: Math.max(0, Math.floor(toFiniteNumber(tier?.points, 0))),
      happiness: Math.max(0, Math.floor(toFiniteNumber(tier?.happiness, 0))),
    }))
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

  return {
    id: typeof rawBoss.id === 'string' && rawBoss.id ? rawBoss.id : `boss-${now}-${fallbackIndex}`,
    name: typeof rawBoss.name === 'string' && rawBoss.name.trim() ? rawBoss.name.trim() : 'Unknown Boss',
    maxHp,
    currentHp,
    rewardTiers,
    contributions,
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

export const createInitialData = (now = Date.now()): AppData => ({
  lastOpened: now,
  classes: [
    {
      id: 'default',
      name: DEFAULT_CLASS_NAME,
      students: [],
    },
  ],
  currentClassId: 'default',
  settings: {
    decayAmount: 2,
    decayType: 'hourly',
    language: 'zh',
    feedCost: 10,
    feedGain: 20,
    playCost: 5,
    playGain: 15,
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
            source: record?.source === 'manual' || record?.source === 'airdrop' ? record.source : 'quick',
            reasonId: typeof record?.reasonId === 'string' ? record.reasonId : undefined,
            reasonLabel: typeof record?.reasonLabel === 'string' ? record.reasonLabel : undefined,
          }))
          .sort((a: PointAdjustmentRecord, b: PointAdjustmentRecord) => b.createdAt - a.createdAt)
      : [],
    dailyProgress: {
      lastClaimDate: typeof student?.dailyProgress?.lastClaimDate === 'string' ? student.dailyProgress.lastClaimDate : undefined,
      streak: Math.max(0, Math.floor(toFiniteNumber(student?.dailyProgress?.streak, 0))),
    },
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

    return {
      id: typeof classItem?.id === 'string' && classItem.id ? classItem.id : `class-${now}-${index}`,
      name: typeof classItem?.name === 'string' && classItem.name.trim() ? classItem.name.trim() : DEFAULT_CLASS_NAME,
      students: sanitizeTeamAssignments(withLegacyTeams, clampTeamSize(rawSettings?.maxTeamSize)),
      activeBoss: normalizeWorldBoss(classItem?.activeBoss, index, now),
    };
  });

  const currentClassId = typeof raw?.currentClassId === 'string' && classes.some((classData) => classData.id === raw.currentClassId)
    ? raw.currentClassId
    : classes[0]?.id ?? initialData.currentClassId;
  const soloBattleFullnessCost = Math.max(
    0,
    toFiniteNumber(rawSettings?.soloBattleFullnessCost, initialData.settings?.soloBattleFullnessCost ?? SOLO_BATTLE_FULLNESS_COST),
  );

  return {
    lastOpened: toFiniteNumber(raw?.lastOpened, now),
    classes,
    currentClassId,
    settings: {
      decayAmount: Math.max(0, toFiniteNumber(rawSettings?.decayAmount ?? rawSettings?.hourlyDecay, initialData.settings?.decayAmount ?? 2)),
      decayType: rawSettings?.decayType === 'daily' ? 'daily' : 'hourly',
      language: rawSettings?.language === 'en' ? 'en' : 'zh',
      feedCost: Math.max(1, toFiniteNumber(rawSettings?.feedCost, initialData.settings?.feedCost ?? 10)),
      feedGain: Math.max(1, toFiniteNumber(rawSettings?.feedGain, initialData.settings?.feedGain ?? 20)),
      playCost: Math.max(1, toFiniteNumber(rawSettings?.playCost, initialData.settings?.playCost ?? 5)),
      playGain: Math.max(1, toFiniteNumber(rawSettings?.playGain, initialData.settings?.playGain ?? 15)),
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
      enableSeasonResetRewards: Boolean(rawSettings?.enableSeasonResetRewards),
      seasonResetRewards: rawSettings?.seasonResetRewards ?? { diamond: 500, platinum: 400, gold: 300, silver: 200, bronze: 100 },
      reviveCost: Math.max(0, toFiniteNumber(rawSettings?.reviveCost, 120)),
    },
  };
};

export const applyDecay = (appData: AppData, now = Date.now()): AppData => {
  const lastOpened = toFiniteNumber(appData.lastOpened, now);
  const elapsedMs = Math.max(0, now - lastOpened);
  const intervalMs = appData.settings?.decayType === 'daily' ? 1000 * 60 * 60 * 24 : 1000 * 60 * 60;
  const periodsPassed = Math.floor(elapsedMs / intervalMs);

  if (periodsPassed <= 0) {
    return appData;
  }

  const decay = periodsPassed * (appData.settings?.decayAmount ?? 2);
  const nextLastOpened = now - (elapsedMs % intervalMs);

  return {
    ...appData,
    lastOpened: nextLastOpened,
    classes: appData.classes.map((classData) => ({
      ...classData,
      students: classData.students.map((student) => applyDecayToStudent(student, decay, now)),
    })),
  };
};
