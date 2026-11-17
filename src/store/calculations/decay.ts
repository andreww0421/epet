import type { AppData, Student } from '../types';
import { isArchivedClass } from '../../../shared/domain/classArchive';
import { applyDecayToStudent, clamp, toFiniteNumber, getPetUpgradeCost, PET_MAX_LEVEL } from '../../gameRules';

// Keep local-calendar and no-op reference semantics identical to the legacy facade.
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
  const studentsBelowMaxLevel = students.filter((student) => student.pet.level < PET_MAX_LEVEL);
  const averagePointGap = studentsBelowMaxLevel.length === 0
    ? 0
    : average(studentsBelowMaxLevel.map((student) => {
        const upgradeCost = getPetUpgradeCost(student.pet.level);
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
    const classes = appData.classes.map((classData) => isArchivedClass(classData) ? classData : ({
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
    // Archived records are read-only snapshots. Active classes continue using
    // the exact existing decay rules; do not create edits in archived classes.
    classes: appData.classes.map((classData) => isArchivedClass(classData) ? classData : ({
      ...classData,
      students: classData.students.map((student) =>
        applyDecayToStudent(student, decay, now, { allowDeath }),
      ),
    })),
  };
};
