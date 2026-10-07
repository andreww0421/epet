import {
  DAILY_TASK_REWARD_HAPPINESS,
  DAILY_TASK_REWARD_POINTS,
  MAX_DAILY_REFLECTIONS,
  MAX_POINT_ADJUSTMENT_RECORDS,
} from './constants';
import {
  addDaysToDateKey,
  getDateKey,
  getDateKeyDistance,
  isDateKey,
  normalizeDailyTaskMakeupWindowDays,
  normalizeDateKeyList,
  normalizeSchoolTimeZone,
  normalizeSchoolWeekdays,
} from './calendarRules';
import { createPointAdjustmentRecord } from './economyRules';
import { syncPetLifeState } from './petRules';
import { clamp } from './ruleUtils';
import type {
  DailyReflection,
  DailyTaskCalendarOptions,
  DailyTaskClaimPlan,
  MentorDailyFeedbackInput,
  StudentRuleState,
} from './types';

const normalizeDailyTaskCalendarOptions = (options: DailyTaskCalendarOptions = {}) => ({
  timeZone: normalizeSchoolTimeZone(options.timeZone),
  schoolWeekdays: normalizeSchoolWeekdays(options.schoolWeekdays),
  holidayDates: new Set(normalizeDateKeyList(options.holidayDates)),
  excusedDates: new Set(normalizeDateKeyList(options.excusedDates, 120)),
  makeupWindowDays: normalizeDailyTaskMakeupWindowDays(options.makeupWindowDays),
});

type NormalizedDailyTaskCalendar = ReturnType<typeof normalizeDailyTaskCalendarOptions>;

const isInstructionDateForCalendar = (
  dateKey: string,
  calendar: NormalizedDailyTaskCalendar,
) => {
  if (!isDateKey(dateKey)) return false;
  const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return calendar.schoolWeekdays.includes(weekday) &&
    !calendar.holidayDates.has(dateKey) &&
    !calendar.excusedDates.has(dateKey);
};

const getNextInstructionDateForCalendar = (
  afterDateKey: string,
  calendar: NormalizedDailyTaskCalendar,
) => {
  if (!isDateKey(afterDateKey)) return undefined;
  for (let offset = 1; offset <= 800; offset += 1) {
    const candidate = addDaysToDateKey(afterDateKey, offset);
    if (isInstructionDateForCalendar(candidate, calendar)) return candidate;
  }
  return undefined;
};

export const isDailyTaskInstructionDate = (
  dateKey: string,
  options: DailyTaskCalendarOptions = {},
) => {
  const calendar = normalizeDailyTaskCalendarOptions(options);
  return isInstructionDateForCalendar(dateKey, calendar);
};

export const getNextDailyTaskInstructionDate = (
  afterDateKey: string,
  options: DailyTaskCalendarOptions = {},
) => {
  const calendar = normalizeDailyTaskCalendarOptions(options);
  return getNextInstructionDateForCalendar(afterDateKey, calendar);
};

export const getDailyTaskClaimPlan = <T extends StudentRuleState>(
  student: T,
  now = Date.now(),
  options: DailyTaskCalendarOptions = {},
): DailyTaskClaimPlan => {
  const calendar = normalizeDailyTaskCalendarOptions(options);
  const schoolDate = getDateKey(now, calendar.timeZone);
  const lastClaimDate = isDateKey(student.dailyProgress?.lastClaimDate)
    ? student.dailyProgress?.lastClaimDate
    : undefined;
  const alreadyClaimed = Boolean(lastClaimDate && lastClaimDate >= schoolDate) ||
    (student.pointAdjustmentRecords ?? []).some(
      (record) => record.source === 'dailyTask' &&
        getDateKey(record.createdAt, calendar.timeZone) === schoolDate,
    );

  if (alreadyClaimed) {
    return { schoolDate, alreadyClaimed: true, frozen: false };
  }

  if (!lastClaimDate) {
    const available = isInstructionDateForCalendar(schoolDate, calendar);
    return available
      ? {
          schoolDate,
          targetDate: schoolDate,
          claimKind: 'current',
          alreadyClaimed: false,
          frozen: false,
        }
      : { schoolDate, alreadyClaimed: false, frozen: true };
  }

  const nextInstructionDate = getNextInstructionDateForCalendar(lastClaimDate, calendar);
  if (nextInstructionDate && nextInstructionDate <= schoolDate) {
    if (nextInstructionDate === schoolDate) {
      return {
        schoolDate,
        targetDate: schoolDate,
        claimKind: 'current',
        alreadyClaimed: false,
        frozen: false,
      };
    }
    if (getDateKeyDistance(nextInstructionDate, schoolDate) <= calendar.makeupWindowDays) {
      return {
        schoolDate,
        targetDate: nextInstructionDate,
        claimKind: 'makeup',
        alreadyClaimed: false,
        frozen: false,
      };
    }
  }

  const availableToday = isInstructionDateForCalendar(schoolDate, calendar);
  return availableToday
    ? {
        schoolDate,
        targetDate: schoolDate,
        claimKind: 'current',
        alreadyClaimed: false,
        frozen: false,
      }
    : { schoolDate, alreadyClaimed: false, frozen: true };
};

export const claimDailyTaskForStudent = <T extends StudentRuleState>(
  student: T,
  now = Date.now(),
  maxPoints = 700,
  reasonLabel?: string,
  calendarOptions?: DailyTaskCalendarOptions,
) => {
  const lastClaimDate = student.dailyProgress?.lastClaimDate;
  const currentStreak = student.dailyProgress?.streak ?? 0;
  const plan = calendarOptions
    ? getDailyTaskClaimPlan(student, now, {
        ...calendarOptions,
        excusedDates: calendarOptions.excusedDates ?? student.dailyProgress?.excusedDates,
      })
    : undefined;
  const targetDate = plan?.targetDate ?? getDateKey(now);
  const yesterday = getDateKey(now - 1000 * 60 * 60 * 24);

  if (plan && !plan.targetDate) {
    return {
      claimed: false as const,
      student,
      alreadyClaimed: plan.alreadyClaimed,
      frozen: plan.frozen,
    };
  }
  if (!plan && lastClaimDate === targetDate) {
    return { claimed: false as const, student, alreadyClaimed: true, frozen: false };
  }

  const followsPreviousInstructionDate = calendarOptions && isDateKey(lastClaimDate)
    ? getNextDailyTaskInstructionDate(lastClaimDate, {
        ...calendarOptions,
        excusedDates: calendarOptions.excusedDates ?? student.dailyProgress?.excusedDates,
      }) === targetDate
    : lastClaimDate === yesterday;
  const nextStreak = followsPreviousInstructionDate ? currentStreak + 1 : 1;
  const streakBonus = Math.min(20, (nextStreak - 1) * 5);
  const rewardPoints = DAILY_TASK_REWARD_POINTS + streakBonus;
  const claimKind = plan?.claimKind ?? 'current';
  const rewardRecord = createPointAdjustmentRecord(
    rewardPoints,
    'dailyTask',
    {
      id: 'daily-homework',
      label: reasonLabel?.trim() || undefined,
      competency: 'assignmentQuality',
    },
    now,
    plan ? { effectiveDate: targetDate, claimKind } : undefined,
  );
  return {
    claimed: true as const,
    rewardPoints,
    streak: nextStreak,
    effectiveDate: targetDate,
    claimKind,
    student: {
      ...student,
      points: clamp(student.points + rewardPoints, 0, maxPoints),
      pet: syncPetLifeState(
        {
          ...student.pet,
          happiness: clamp(student.pet.happiness + DAILY_TASK_REWARD_HAPPINESS, 0, 100),
        },
        now,
      ),
      dailyProgress: {
        lastClaimDate: targetDate,
        streak: nextStreak,
        reflections: student.dailyProgress?.reflections,
        excusedDates: student.dailyProgress?.excusedDates,
      },
      pointAdjustmentRecords: [
        rewardRecord,
        ...(student.pointAdjustmentRecords ?? []),
      ].slice(0, MAX_POINT_ADJUSTMENT_RECORDS),
    },
  };
};

export const saveMentorDailyFeedbackForStudent = <T extends StudentRuleState>(
  student: T,
  feedback: MentorDailyFeedbackInput,
  now = Date.now(),
  timeZone = 'Asia/Taipei',
) => {
  const text = feedback.text.trim().slice(0, 160);
  if (!text) {
    return { saved: false as const, updated: false as const, student };
  }

  const date = getDateKey(now, timeZone);
  const reflections = student.dailyProgress?.reflections ?? [];
  const existing = reflections.find(
    (reflection) => reflection.date === date && reflection.author === 'mentor',
  );
  const dailyFeedback: DailyReflection = {
    id: existing?.id ?? `reflection-${now}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    createdAt: now,
    competency: feedback.competency,
    author: 'mentor',
    mentorAssessment: feedback.assessment,
    text,
  };

  return {
    saved: true as const,
    updated: Boolean(existing),
    student: {
      ...student,
      dailyProgress: {
        lastClaimDate: student.dailyProgress?.lastClaimDate,
        streak: student.dailyProgress?.streak ?? 0,
        reflections: [
          dailyFeedback,
          ...reflections.filter(
            (reflection) => !(reflection.date === date && reflection.author === 'mentor'),
          ),
        ].slice(0, MAX_DAILY_REFLECTIONS),
        excusedDates: student.dailyProgress?.excusedDates,
      },
    },
  };
};
