import { isWorkspaceAccess, workspaceAccessKey, type WorkspaceAccess } from '../../shared/contracts/workspace';
import type { AppData } from '../store/types';
import { normalizeAppData } from '../store/utils';
import { isDraftSyncState, type DraftSyncState } from './syncRetryPolicy';

export const DRAFT_STORAGE_PREFIX = 'epet-unsynced-workspace-v2:';
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;
// Preserve an isolated queue through auth remounts when browser storage fails.
// This fallback lasts only for the current document and obeys the same TTL.
const unavailableStorageDrafts = new Map<string, string>();
export type PendingWorkspaceDraft = {
  version: 2;
  access: WorkspaceAccess;
  baseRevision: number;
  requestId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  data: AppData;
  uncertainData?: AppData;
  syncState?: DraftSyncState;
};

export const draftStorageKey = (access: WorkspaceAccess) =>
  `${DRAFT_STORAGE_PREFIX}${encodeURIComponent(workspaceAccessKey(access))}`;

// Compare the representation actually committed by the server, including
// defaults added to new students. Object key order is not a data difference.
export const sameWorkspaceData = (left: AppData | null, right: AppData, now = Date.now()): boolean => {
  if (!left) return false;
  const canonicalJson = (data: AppData) => JSON.stringify(normalizeAppData(data, now), (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
      : value);
  try { return canonicalJson(left) === canonicalJson(right); } catch { return false; }
};

export const isDraftDataWithinAccess = (data: unknown, access: WorkspaceAccess): data is AppData => {
  if (!data || typeof data !== 'object') return false;
  const value = data as Partial<AppData>;
  if (!Array.isArray(value.classes) || typeof value.currentClassId !== 'string') return false;
  const allowed = access.classIds === null ? null : new Set(access.classIds);
  return value.classes.every((classroom) => classroom && typeof classroom.id === 'string' &&
    Array.isArray(classroom.students) && (!allowed || allowed.has(classroom.id))) &&
    (!allowed || !value.currentClassId || allowed.has(value.currentClassId));
};

export const clearPendingDraft = (access: WorkspaceAccess) => {
  try {
    globalThis.sessionStorage?.removeItem(draftStorageKey(access));
    unavailableStorageDrafts.delete(draftStorageKey(access));
    return true;
  } catch {
    // Explicit discard must not succeed while an old readable copy survives.
    // Keep the memory fallback too, so a failed discard never loses new edits.
    return false;
  }
};

// Only call after the server has freshly authorized this exact binding. Never
// enumerate other principals' namespaces or infer ownership for legacy v1 data.
export const readPendingDraft = (access: WorkspaceAccess, now = Date.now()): PendingWorkspaceDraft | null => {
  try {
    const key = draftStorageKey(access);
    // A failed setItem may leave an older, readable stored value behind.
    // The latest failed write is authoritative until storage succeeds again.
    let raw: string | null | undefined = unavailableStorageDrafts.get(key);
    if (raw === undefined) {
      try { raw = globalThis.sessionStorage?.getItem(key); } catch { /* No recoverable stored copy. */ }
    }
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<PendingWorkspaceDraft>;
    if (draft.version !== 2 || !isWorkspaceAccess(draft.access) ||
        workspaceAccessKey(draft.access) !== workspaceAccessKey(access) ||
        !Number.isSafeInteger(draft.baseRevision) || Number(draft.baseRevision) < 0 ||
        typeof draft.requestId !== 'string' || !draft.requestId ||
        !Number.isSafeInteger(draft.createdAt) || Number(draft.createdAt) <= 0 ||
        !Number.isSafeInteger(draft.updatedAt) || Number(draft.updatedAt) < Number(draft.createdAt) ||
        Number(draft.updatedAt) > now ||
        draft.expiresAt !== Number(draft.updatedAt) + DRAFT_TTL_MS ||
        (draft.syncState !== undefined && !isDraftSyncState(draft.syncState)) ||
        !isDraftDataWithinAccess(draft.data, access) ||
        (draft.uncertainData !== undefined && !isDraftDataWithinAccess(draft.uncertainData, access))) return null;
    if (now >= draft.expiresAt) {
      clearPendingDraft(access);
      return null;
    }
    return draft as PendingWorkspaceDraft;
  } catch { return null; }
};

export const writePendingDraft = (draft: PendingWorkspaceDraft) => {
  const key = draftStorageKey(draft.access);
  let raw: string;
  try { raw = JSON.stringify(draft); } catch { return false; }
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) throw new Error('Session storage unavailable');
    storage.setItem(key, raw);
    unavailableStorageDrafts.delete(key);
    return true;
  } catch {
    unavailableStorageDrafts.set(key, raw);
    return false;
  }
};
