import { BackendApiError } from './backendApi';

export const SAVE_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
export const MAX_AUTOMATIC_SAVE_RETRIES = SAVE_RETRY_DELAYS_MS.length;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type SyncFailure = {
  kind: 'capacity' | 'validation' | 'permanent' | 'transient' | 'rate-limit' | 'retry-exhausted';
  status?: number;
  limitBytes?: number;
  limitKind?: 'workspace_snapshot' | 'request_body';
};
export type DraftSyncState = {
  retries: number;
  notBefore: number;
  failure: SyncFailure;
};

export const isPausedSyncFailure = (failure: SyncFailure) =>
  failure.kind !== 'transient' && failure.kind !== 'rate-limit';

export const isDraftSyncState = (value: unknown): value is DraftSyncState => {
  if (!value || typeof value !== 'object') return false;
  const state = value as DraftSyncState;
  const failure = state.failure;
  return Number.isInteger(state.retries) && state.retries >= 0 &&
    state.retries <= MAX_AUTOMATIC_SAVE_RETRIES &&
    Number.isSafeInteger(state.notBefore) && state.notBefore >= 0 &&
    !!failure && typeof failure === 'object' &&
    ['capacity', 'validation', 'permanent', 'transient', 'rate-limit', 'retry-exhausted'].includes(failure.kind) &&
    (failure.status === undefined || (Number.isInteger(failure.status) && failure.status >= 400 && failure.status <= 599)) &&
    ((failure.limitBytes === undefined && failure.limitKind === undefined) ||
      (Number.isSafeInteger(failure.limitBytes) && failure.limitBytes > 0 &&
        ['workspace_snapshot', 'request_body'].includes(failure.limitKind)));
};

// A server deadline must never overflow setTimeout into an immediate retry.
// If it exceeds the draft's remaining lifetime we pause rather than shorten it.
export const classifySaveFailure = (
  error: unknown, retries: number, now: number, expiresAt: number,
): DraftSyncState => {
  const apiError = error instanceof BackendApiError ? error : null;
  const status = apiError?.status;
  const failure: SyncFailure = status === 413
    ? { kind: 'capacity', status, ...apiError?.capacityLimit }
    : status === 400 || status === 422
      ? { kind: 'validation', status }
      : status !== undefined && ![408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524].includes(status)
        ? { kind: 'permanent', status }
        : { kind: status === 429 ? 'rate-limit' : 'transient', ...(status ? { status } : {}) };
  const safeRetries = Math.max(0, Math.min(MAX_AUTOMATIC_SAVE_RETRIES, Math.floor(retries)));
  if (isPausedSyncFailure(failure)) return { retries: safeRetries, notBefore: 0, failure };
  const serverDelay = error instanceof BackendApiError ? error.retryAfterMs ?? 0 : 0;
  const serverDeadline = Math.min(Number.MAX_SAFE_INTEGER, now + serverDelay);
  if (safeRetries >= MAX_AUTOMATIC_SAVE_RETRIES) {
    return { retries: safeRetries, notBefore: serverDelay ? serverDeadline : 0,
      failure: { kind: 'retry-exhausted', ...(status ? { status } : {}) } };
  }
  const delay = Math.max(SAVE_RETRY_DELAYS_MS[safeRetries], serverDelay);
  const notBefore = Math.min(Number.MAX_SAFE_INTEGER, now + delay);
  if (delay > MAX_TIMER_DELAY_MS || notBefore >= expiresAt) {
    return { retries: safeRetries, notBefore,
      failure: { kind: 'retry-exhausted', ...(status ? { status } : {}) } };
  }
  return { retries: safeRetries + 1, notBefore, failure };
};
