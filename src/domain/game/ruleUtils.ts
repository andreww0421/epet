import { MAX_ACTIVITY_RECORDS } from './constants';

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const appendRecord = <T extends { createdAt: number }>(
  records: T[] | undefined,
  record: T,
  limit = MAX_ACTIVITY_RECORDS,
) => [record, ...(records ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
