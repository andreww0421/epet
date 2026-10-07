import {
  DEFAULT_CATCH_UP_GAP_THRESHOLD,
  DEFAULT_DAILY_CATCH_UP_BONUS,
  DEFAULT_DAILY_NEGATIVE_POINT_LIMIT,
  DEFAULT_DAILY_POSITIVE_POINT_LIMIT,
  DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS,
  DEFAULT_SCHOOL_TIME_ZONE,
} from './constants';
import {
  getDateKey,
  getWeekStartDate,
  getWeekStartDateFromDateKey,
} from './calendarRules';
import {
  applyPointAdjustmentToStudent,
  createPointAdjustmentRecord,
} from './economyRules';
import { clamp, toFiniteNumber } from './ruleUtils';
import type {
  ClassGoal,
  ParticipationSupportOptions,
  ParticipationSupportPlan,
  PointAdjustmentRecord,
  PointAdjustmentSource,
  PointGuardrailOptions,
  PointGuardrailReason,
  PointGuardrailResult,
  StudentRuleState,
} from './types';

const TEACHER_FEEDBACK_SOURCES = new Set<PointAdjustmentSource>([
  'quick',
  'manual',
  'airdrop',
]);

export const getDailyTeacherPointTotals = (
  student: Pick<StudentRuleState, 'pointAdjustmentRecords'>,
  now = Date.now(),
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
) => {
  const dateKey = getDateKey(now, timeZone);
  return (student.pointAdjustmentRecords ?? []).reduce(
    (totals, record) => {
      if (
        !TEACHER_FEEDBACK_SOURCES.has(record.source) ||
        getDateKey(record.createdAt, timeZone) !== dateKey
      ) {
        return totals;
      }
      if (record.amount > 0) totals.positive += record.amount;
      if (record.amount < 0) totals.negative += Math.abs(record.amount);
      return totals;
    },
    { positive: 0, negative: 0 },
  );
};

export const applyPointGuardrail = (
  student: Pick<StudentRuleState, 'pointAdjustmentRecords'>,
  requestedAmount: number,
  now = Date.now(),
  options: PointGuardrailOptions = {},
): PointGuardrailResult => {
  const normalizedRequest = Math.trunc(toFiniteNumber(requestedAmount, 0));
  if (normalizedRequest === 0 || options.enabled === false) {
    return {
      requestedAmount: normalizedRequest,
      appliedAmount: normalizedRequest,
      outcome: 'applied',
      usedAmount: 0,
      remainingAmount: Number.POSITIVE_INFINITY,
    };
  }

  const totals = getDailyTeacherPointTotals(student, now, options.timeZone);
  const isPositive = normalizedRequest > 0;
  const configuredLimit = isPositive
    ? options.dailyPositiveLimit
    : options.dailyNegativeLimit;
  const fallbackLimit = isPositive
    ? DEFAULT_DAILY_POSITIVE_POINT_LIMIT
    : DEFAULT_DAILY_NEGATIVE_POINT_LIMIT;
  const limit = clamp(
    Math.trunc(toFiniteNumber(configuredLimit, fallbackLimit)),
    0,
    10_000,
  );
  const usedAmount = isPositive ? totals.positive : totals.negative;
  const remainingAmount = Math.max(0, limit - usedAmount);
  const requestedMagnitude = Math.abs(normalizedRequest);
  const appliedMagnitude = Math.min(requestedMagnitude, remainingAmount);
  const appliedAmount = isPositive ? appliedMagnitude : -appliedMagnitude;
  const reason: PointGuardrailReason = isPositive
    ? 'dailyPositiveLimit'
    : 'dailyNegativeLimit';

  return {
    requestedAmount: normalizedRequest,
    appliedAmount,
    outcome:
      appliedMagnitude === 0
        ? 'blocked'
        : appliedMagnitude < requestedMagnitude
          ? 'clamped'
          : 'applied',
    ...(appliedMagnitude < requestedMagnitude ? { reason } : {}),
    usedAmount,
    remainingAmount: Math.max(0, remainingAmount - appliedMagnitude),
  };
};

const PARTICIPATION_BASE_SOURCES = new Set<PointAdjustmentSource>([
  'quick',
  'manual',
  'airdrop',
  'dailyTask',
]);

export const getMedianPoints = (
  students: Array<Pick<StudentRuleState, 'points'>>,
) => {
  if (students.length === 0) return 0;
  const values = students.map((student) => student.points).sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
};

export const getParticipationSupportPlan = (
  student: Pick<StudentRuleState, 'points' | 'pointAdjustmentRecords'>,
  comparisonStudents: Array<Pick<StudentRuleState, 'points'>>,
  now = Date.now(),
  options: ParticipationSupportOptions = {},
): ParticipationSupportPlan => {
  const classMedianPoints = getMedianPoints(comparisonStudents);
  const gapAfterBaseReward = Math.max(0, classMedianPoints - student.points);
  if (options.enabled === false) {
    return { participationTopUp: 0, catchUpBonus: 0, classMedianPoints, gapAfterBaseReward };
  }

  const timeZone = options.timeZone ?? DEFAULT_SCHOOL_TIME_ZONE;
  const dateKey = getDateKey(now, timeZone);
  const todayRecords = (student.pointAdjustmentRecords ?? []).filter(
    (record) => getDateKey(record.createdAt, timeZone) === dateKey,
  );
  const hasParticipationTopUp = todayRecords.some(
    (record) => record.source === 'participationTopUp',
  );
  const hasCatchUpBonus = todayRecords.some((record) => record.source === 'catchUpBonus');
  const qualifyingParticipationPoints = todayRecords.reduce(
    (total, record) =>
      PARTICIPATION_BASE_SOURCES.has(record.source) && record.amount > 0
        ? total + record.amount
        : total,
    0,
  );
  const minimumDailyParticipationPoints = clamp(
    Math.floor(toFiniteNumber(
      options.minimumDailyParticipationPoints,
      DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS,
    )),
    0,
    1_000,
  );
  const catchUpGapThreshold = clamp(
    Math.floor(toFiniteNumber(options.catchUpGapThreshold, DEFAULT_CATCH_UP_GAP_THRESHOLD)),
    0,
    10_000,
  );
  const configuredCatchUpBonus = clamp(
    Math.floor(toFiniteNumber(options.dailyCatchUpBonus, DEFAULT_DAILY_CATCH_UP_BONUS)),
    0,
    1_000,
  );

  return {
    participationTopUp:
      !hasParticipationTopUp && qualifyingParticipationPoints > 0
        ? Math.max(0, minimumDailyParticipationPoints - qualifyingParticipationPoints)
        : 0,
    catchUpBonus:
      !hasCatchUpBonus &&
      qualifyingParticipationPoints > 0 &&
      configuredCatchUpBonus > 0 &&
      gapAfterBaseReward >= catchUpGapThreshold
        ? configuredCatchUpBonus
        : 0,
    classMedianPoints,
    gapAfterBaseReward,
  };
};

export const applyParticipationSupportToStudent = <T extends StudentRuleState>(
  student: T,
  comparisonStudents: Array<Pick<StudentRuleState, 'points'>>,
  now = Date.now(),
  maxPoints = 700,
  options: ParticipationSupportOptions = {},
) => {
  const plan = getParticipationSupportPlan(student, comparisonStudents, now, options);
  let nextStudent = student;
  const records: PointAdjustmentRecord[] = [];

  const applyReward = (
    requestedAmount: number,
    source: Extract<PointAdjustmentSource, 'participationTopUp' | 'catchUpBonus'>,
    reasonId: string,
  ) => {
    const actualAmount = Math.min(
      requestedAmount,
      Math.max(0, maxPoints - nextStudent.points),
    );
    if (actualAmount <= 0) return;
    const record = createPointAdjustmentRecord(
      actualAmount,
      source,
      { id: reasonId, competency: 'participation' },
      now,
    );
    nextStudent = applyPointAdjustmentToStudent(nextStudent, actualAmount, record, maxPoints);
    records.push(record);
  };

  applyReward(plan.participationTopUp, 'participationTopUp', 'participation-safety-net');
  applyReward(plan.catchUpBonus, 'catchUpBonus', 'catch-up-bonus');

  return {
    student: nextStudent,
    participationTopUp: records.find((record) => record.source === 'participationTopUp')?.amount ?? 0,
    catchUpBonus: records.find((record) => record.source === 'catchUpBonus')?.amount ?? 0,
    records,
    plan,
  };
};

export const getActiveClassGoals = (
  goals: ClassGoal[] | undefined,
  timestamp = Date.now(),
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
) => {
  const currentWeekStart = getWeekStartDate(timestamp, timeZone);
  return (goals ?? []).filter((goal) => {
    const goalWeekStart = goal.weekStartDate
      ? getWeekStartDateFromDateKey(goal.weekStartDate)
      : getWeekStartDate(goal.createdAt, timeZone);
    return goalWeekStart === currentWeekStart;
  });
};
