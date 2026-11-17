import { isWorkspaceAccess, workspaceAccessKey, type WorkspaceAccess } from '../../../../shared/contracts/workspace';

export const LEARNING_FORM_RECOVERY_MS = 30 * 60 * 1000;
export type LearningDraftAuthorization = { access: WorkspaceAccess; generation: number };
type Lease = { generation: number; key: string };

/** No browser storage: suspended drafts are unreadable until exact authority is freshly verified. */
export const createLearningDraftMemory = () => {
  let owner: string | null = null;
  let lease: Lease | null = null;
  let expiresAt = 0;
  const drafts = new Map<string, unknown>();
  return {
    authorize(authorization: LearningDraftAuthorization | null | undefined, generation: number, now = Date.now()) {
      if (!authorization || authorization.generation !== generation || !isWorkspaceAccess(authorization.access)) {
        lease = null;
        return null;
      }
      const key = workspaceAccessKey(authorization.access);
      if (owner !== key || (!lease && now >= expiresAt)) {
        drafts.clear();
        expiresAt = now + LEARNING_FORM_RECOVERY_MS;
      }
      owner = key;
      if (!lease || lease.generation !== generation || lease.key !== key) lease = { generation, key };
      return lease;
    },
    current(generation: number) { return lease?.generation === generation ? lease : null; },
    read<T>(permit: Lease | null, key: string, initial: () => T): T | undefined {
      if (!permit || permit !== lease) return undefined;
      if (!drafts.has(key)) drafts.set(key, initial());
      return drafts.get(key) as T;
    },
    update<T>(permit: Lease | null, key: string, update: (previous: T) => T, now = Date.now()) {
      if (!permit || permit !== lease || !drafts.has(key)) return false;
      const previous = drafts.get(key) as T;
      const next = update(previous);
      if (Object.is(previous, next)) return false;
      drafts.set(key, next);
      expiresAt = now + LEARNING_FORM_RECOVERY_MS;
      return true;
    },
    suspend() { lease = null; },
    clear() { drafts.clear(); owner = null; lease = null; expiresAt = 0; },
  };
};
