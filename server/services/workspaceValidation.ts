import type { AppData } from '../../src/store/types';

export const isAppData = (value: unknown): value is AppData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AppData>;
  return (
    typeof data.currentClassId === 'string' &&
    Array.isArray(data.classes) &&
    data.classes.every(
      (classData) =>
        classData &&
        typeof classData === 'object' &&
        typeof classData.id === 'string' &&
        Array.isArray(classData.students),
    )
  );
};

export const getRevisionNumber = (value: string) => {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) ? revision : null;
};

export const getRevisionLimit = (url: URL) => {
  const rawLimit = url.searchParams.get('limit');
  if (rawLimit == null) return 25;
  const limit = Number(rawLimit);
  return Number.isInteger(limit) && limit > 0
    ? Math.min(200, limit)
    : null;
};
