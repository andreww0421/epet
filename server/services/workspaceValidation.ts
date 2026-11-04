import type { AppData } from '../../src/store/types';
import { assertWorkspaceData, WorkspaceValidationError } from '../../shared/validation/workspaceValidation';

export const isAppData = (value: unknown): value is AppData => {
  try {
    assertWorkspaceData(value);
    return true;
  } catch (error) {
    if (error instanceof WorkspaceValidationError) return false;
    throw error;
  }
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
