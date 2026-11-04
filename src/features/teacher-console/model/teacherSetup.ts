import { isWorkspaceAccess, workspaceAccessKey, type WorkspaceAccess } from '../../../../shared/contracts/workspace';
import { isArchivedClass } from '../../../../shared/domain/classArchive';
import type { AppData, PointAdjustmentRecord } from '../../../store/types';

export type TeacherSetupMode = 'idle' | 'active' | 'paused' | 'skipped' | 'completed';
export type TeacherSetupGameMode = 'shown' | 'hidden';
export type TeacherSetupState = {
  mode: TeacherSetupMode;
  reviewed: boolean;
  gameMode: TeacherSetupGameMode | null;
};
export type TeacherSetupStep = {
  id: 'class' | 'roster' | 'points' | 'review' | 'game';
  completed: boolean;
};
export type TeacherSetupPatch = Partial<TeacherSetupState>;
export const TEACHER_SETUP_STORAGE_PREFIX = 'epet-teacher-setup-v1:';
export const TEACHER_SETUP_REGISTRATION_PREFIX = 'epet-teacher-setup-registration-v1:';

// Only functional UI flags are retained. Workspace data and step snapshots are
// always derived from the currently authorized data, never serialized here.
export const createTeacherSetupState = (): TeacherSetupState => ({ mode: 'idle', reviewed: false, gameMode: null });
const MODES: readonly string[] = ['idle', 'active', 'paused', 'skipped', 'completed'];
export const isTeacherSetupState = (value: unknown): value is TeacherSetupState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return Object.keys(state).length === 3 && MODES.includes(state.mode as string) &&
    typeof state.reviewed === 'boolean' &&
    (state.gameMode === null || state.gameMode === 'shown' || state.gameMode === 'hidden');
};

export const patchTeacherSetupState = (state: TeacherSetupState, patch: TeacherSetupPatch): TeacherSetupState => ({
  mode: MODES.includes(patch?.mode) ? patch.mode : state.mode,
  reviewed: typeof patch?.reviewed === 'boolean' ? patch.reviewed : state.reviewed,
  gameMode: patch?.gameMode === null || patch?.gameMode === 'shown' || patch?.gameMode === 'hidden'
    ? patch.gameMode : state.gameMode,
});

export const teacherSetupStorageKey = (access: WorkspaceAccess) =>
  `${TEACHER_SETUP_STORAGE_PREFIX}${encodeURIComponent(workspaceAccessKey(access))}`;

// Preserve the newest flags when storage throws or a failed write leaves an
// older readable value behind. The fallback is bound to the exact authority.
const unavailableStorageStates = new Map<string, TeacherSetupState>();
export const readTeacherSetupState = (access: WorkspaceAccess): { state: TeacherSetupState; storageAvailable: boolean } => {
  if (!isWorkspaceAccess(access)) return { state: createTeacherSetupState(), storageAvailable: false };
  const key = teacherSetupStorageKey(access);
  let raw: string | null = null;
  let storageAvailable = false;
  try {
    const storage = globalThis.localStorage;
    if (storage) {
      raw = storage.getItem(key);
      storageAvailable = true;
    }
  } catch { /* Memory remains usable when browser storage is restricted. */ }
  const fallback = unavailableStorageStates.get(key);
  if (fallback) return { state: { ...fallback }, storageAvailable: false };
  if (raw && raw.length <= 256) {
    try {
      const value: unknown = JSON.parse(raw);
      if (isTeacherSetupState(value)) return { state: { ...value }, storageAvailable };
    } catch { /* Invalid optional preferences use the idle default. */ }
  }
  return { state: createTeacherSetupState(), storageAvailable };
};

export const writeTeacherSetupState = (access: WorkspaceAccess, state: TeacherSetupState): boolean => {
  if (!isWorkspaceAccess(access) || !isTeacherSetupState(state)) return false;
  const key = teacherSetupStorageKey(access);
  // Explicit projection also prevents unexpected runtime properties entering storage.
  const safeState: TeacherSetupState = { mode: state.mode, reviewed: state.reviewed, gameMode: state.gameMode };
  try {
    const storage = globalThis.localStorage;
    if (!storage) throw new Error('Local storage unavailable');
    storage.setItem(key, JSON.stringify(safeState));
    unavailableStorageStates.delete(key);
    return true;
  } catch {
    unavailableStorageStates.set(key, safeState);
    return false;
  }
};

const registrationKey = (userId: string, workspaceId: string) =>
  `${TEACHER_SETUP_REGISTRATION_PREFIX}${encodeURIComponent(JSON.stringify([userId, workspaceId]))}`;
const pendingRegistrations = new Set<string>();
const consumedRegistrations = new Set<string>();
const validIdentity = (value: string) => typeof value === 'string' && value.trim().length > 0;

/** Call only after a new account registration succeeds, using the returned IDs. */
export const markTeacherSetupRegistration = (userId: string, workspaceId: string): void => {
  if (!validIdentity(userId) || !validIdentity(workspaceId)) return;
  const key = registrationKey(userId, workspaceId);
  pendingRegistrations.add(key);
  consumedRegistrations.delete(key);
  try { globalThis.sessionStorage?.setItem(key, 'registered'); } catch { /* Current document fallback remains. */ }
};

/** The caller must first obtain a freshly verified, loaded workspace binding. */
export const consumeTeacherSetupRegistration = (access: WorkspaceAccess): boolean => {
  if (!isWorkspaceAccess(access)) return false;
  const key = registrationKey(access.userId, access.workspaceId);
  if (consumedRegistrations.has(key)) return false;
  let marked = pendingRegistrations.has(key);
  try { marked ||= globalThis.sessionStorage?.getItem(key) === 'registered'; } catch { /* Try the exact in-memory tuple. */ }
  if (!marked) return false;
  pendingRegistrations.delete(key);
  consumedRegistrations.add(key);
  try { globalThis.sessionStorage?.removeItem(key); } catch { /* Do not consume twice in this document. */ }
  return true;
};

// This is the teacher-feedback source definition used by learningRules and
// educationInsights. Automated daily-task and participation rewards do not count.
const isTeacherPointAdjustment = (record: PointAdjustmentRecord, now: number) =>
  (record.source === 'quick' || record.source === 'manual' || record.source === 'airdrop') &&
  Number.isFinite(record.amount) && record.amount !== 0 && record.guardrailOutcome !== 'blocked' &&
  Number.isFinite(record.createdAt) && record.createdAt <= now;

export const buildTeacherSetupSteps = (
  data: AppData, state: TeacherSetupState, access: WorkspaceAccess, now = Date.now(),
): TeacherSetupStep[] => {
  const allowedIds = isWorkspaceAccess(access) ? access.classIds === null ? null : new Set(access.classIds) : new Set<string>();
  const classes = data.classes.filter((classroom) => !isArchivedClass(classroom) && (!allowedIds || allowedIds.has(classroom.id)));
  // Keep the next action attached to the class shown by Today and its point
  // picker. Records elsewhere must not skip an empty selected class's roster.
  const currentClass = classes.find((classroom) => classroom.id === data.currentClassId);
  return [
    { id: 'class', completed: classes.length > 0 },
    { id: 'roster', completed: Boolean(currentClass?.students.length) },
    { id: 'points', completed: currentClass?.students.some((student) =>
      (student.pointAdjustmentRecords ?? []).some((record) => isTeacherPointAdjustment(record, now))) ?? false },
    { id: 'review', completed: state.reviewed },
    { id: 'game', completed: state.gameMode !== null },
  ];
};
