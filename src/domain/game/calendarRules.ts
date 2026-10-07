import {
  DEFAULT_DAILY_TASK_MAKEUP_WINDOW_DAYS,
  DEFAULT_SCHOOL_TIME_ZONE,
  DEFAULT_SCHOOL_WEEKDAYS,
} from './constants';
import { clamp, toFiniteNumber } from './ruleUtils';

export const isDateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const normalizeDateKeyList = (value: unknown, limit = 366) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isDateKey))).sort().slice(0, limit);
};

export const normalizeSchoolTimeZone = (value: unknown) => {
  const requested = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_SCHOOL_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: requested }).format(0);
    return requested;
  } catch {
    return DEFAULT_SCHOOL_TIME_ZONE;
  }
};

export const normalizeSchoolWeekdays = (value: unknown) => {
  if (!Array.isArray(value)) return [...DEFAULT_SCHOOL_WEEKDAYS];
  const weekdays = Array.from(new Set(
    value
      .map((day) => Math.floor(Number(day)))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
  )).sort((left, right) => left - right);
  return weekdays.length > 0 ? weekdays : [...DEFAULT_SCHOOL_WEEKDAYS];
};

export const normalizeDailyTaskMakeupWindowDays = (value: unknown) =>
  clamp(
    Math.floor(toFiniteNumber(value, DEFAULT_DAILY_TASK_MAKEUP_WINDOW_DAYS)),
    0,
    30,
  );

export const getDateKey = (timestamp = Date.now(), timeZone = 'UTC') => {
  if (timeZone === 'UTC') return new Date(timestamp).toISOString().slice(0, 10);
  const safeTimeZone = normalizeSchoolTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const getWeekStartDateFromDateKey = (dateKey: string) => {
  if (!isDateKey(dateKey)) return dateKey;
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return addDaysToDateKey(dateKey, -daysSinceMonday);
};

export const getWeekStartDate = (
  timestamp = Date.now(),
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
) => getWeekStartDateFromDateKey(getDateKey(timestamp, timeZone));

export const getWeekEndDate = (
  timestamp = Date.now(),
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
) => addDaysToDateKey(getWeekStartDate(timestamp, timeZone), 6);

export const getDateKeyDistance = (fromDateKey: string, toDateKey: string) =>
  Math.floor(
    (new Date(`${toDateKey}T00:00:00.000Z`).getTime() -
      new Date(`${fromDateKey}T00:00:00.000Z`).getTime()) /
      (24 * 60 * 60 * 1000),
  );
