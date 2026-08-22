import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppData } from '../store/types';
import {
  BackendAuthRequired,
  BackendForbidden,
  BackendRevisionConflict,
  loadBackendState,
  probeBackend,
  saveBackendState,
} from '../services/backendApi';
import { normalizeAppData } from '../store/utils';
import { useStore } from '../store/useStore';

export type BackendSyncStatus =
  | 'checking'
  | 'connected'
  | 'saving'
  | 'offline'
  | 'conflict'
  | 'session-expired'
  | 'forbidden';

type PendingWorkspaceDraft = {
  workspaceId: string;
  baseRevision: number;
  requestId: string;
  updatedAt: number;
  data: AppData;
  uncertainData?: AppData;
};

export type BackendSyncController = {
  status: BackendSyncStatus;
  flush: () => Promise<boolean>;
};

const DRAFT_STORAGE_PREFIX = 'epet-unsynced-workspace-v1:';
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

const createRequestId = () =>
  globalThis.crypto?.randomUUID?.()
  ?? `save-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const draftStorageKey = (workspaceId: string) =>
  `${DRAFT_STORAGE_PREFIX}${workspaceId}`;

const readPendingDraft = (workspaceId: string): PendingWorkspaceDraft | null => {
  try {
    const raw = globalThis.sessionStorage?.getItem(draftStorageKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingWorkspaceDraft>;
    if (
      parsed.workspaceId !== workspaceId ||
      !Number.isInteger(parsed.baseRevision) ||
      typeof parsed.requestId !== 'string' ||
      !parsed.requestId ||
      !parsed.data ||
      typeof parsed.data !== 'object'
    ) {
      return null;
    }
    return parsed as PendingWorkspaceDraft;
  } catch {
    return null;
  }
};

const writePendingDraft = (draft: PendingWorkspaceDraft | null) => {
  if (!draft) return;
  try {
    globalThis.sessionStorage?.setItem(
      draftStorageKey(draft.workspaceId),
      JSON.stringify(draft),
    );
  } catch {
    // The in-memory queue remains authoritative when session storage is full
    // or unavailable. The UI still blocks navigation when a flush fails.
  }
};

const clearPendingDraft = (workspaceId: string) => {
  try {
    globalThis.sessionStorage?.removeItem(draftStorageKey(workspaceId));
  } catch {
    // A stale draft is harmless: its base revision is checked before restore.
  }
};

const sameWorkspaceData = (left: AppData | null, right: AppData) => {
  if (!left) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

export const useBackendSync = (
  enabled = true,
  workspaceId: string | null = null,
  onAuthenticationInvalid?: () => void,
  canWrite = true,
): BackendSyncController => {
  const [status, setStatus] = useState<BackendSyncStatus>('checking');
  const flushRef = useRef<() => Promise<boolean>>(async () => true);

  const flush = useCallback(() => flushRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let pendingDraft: PendingWorkspaceDraft | null = null;
    let saveInFlight: Promise<boolean> | null = null;
    let retryAttempt = 0;

    if (!enabled || !workspaceId) {
      setStatus('checking');
      flushRef.current = async () => true;
      return () => {
        disposed = true;
      };
    }

    const persistPendingDraft = () => {
      if (pendingDraft) writePendingDraft(pendingDraft);
    };

    const scheduleRetry = (runSave: () => Promise<boolean>) => {
      if (disposed || retryTimer || !pendingDraft) return;
      const delay = RETRY_DELAYS_MS[
        Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)
      ];
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!disposed) void runSave();
      }, delay);
    };

    const handleFailure = (error: unknown) => {
      if (error instanceof BackendAuthRequired) {
        if (!disposed) setStatus('session-expired');
        onAuthenticationInvalid?.();
        return;
      }
      if (error instanceof BackendForbidden) {
        if (!disposed) setStatus('forbidden');
        return;
      }
      if (!disposed) setStatus('offline');
    };

    const runSave = async (): Promise<boolean> => {
      if (disposed) return false;
      if (saveInFlight) {
        const completed = await saveInFlight;
        if (!completed) return false;
        return pendingDraft ? runSave() : true;
      }
      if (!pendingDraft) return true;

      const draft = pendingDraft;
      pendingDraft = null;
      if (!disposed) setStatus('saving');
      saveInFlight = (async () => {
        try {
          const saved = await saveBackendState(
            draft.data,
            draft.baseRevision,
            draft.requestId,
          );
          revision = saved.revision;
          retryAttempt = 0;
          if (pendingDraft) {
            pendingDraft = {
              ...pendingDraft,
              baseRevision: saved.revision,
              uncertainData: undefined,
            };
            persistPendingDraft();
          } else {
            clearPendingDraft(workspaceId);
          }
          if (!disposed) setStatus('connected');
          return true;
        } catch (error) {
          if (
            error instanceof BackendRevisionConflict &&
            sameWorkspaceData(error.current.data, draft.data)
          ) {
            // The previous request may have committed while its response was
            // lost. Treat an identical remote snapshot as an idempotent save.
            revision = error.current.revision;
            retryAttempt = 0;
            if (pendingDraft) {
              pendingDraft = {
                ...pendingDraft,
                baseRevision: error.current.revision,
                uncertainData: undefined,
              };
              persistPendingDraft();
            } else {
              clearPendingDraft(workspaceId);
            }
            if (!disposed) setStatus('connected');
            return true;
          }

          if (
            error instanceof BackendRevisionConflict &&
            draft.uncertainData &&
            sameWorkspaceData(error.current.data, draft.uncertainData)
          ) {
            // A prior request committed but its response was lost, while a
            // newer local edit was already queued. Rebase only that newer
            // draft onto the confirmed remote revision and keep serial order.
            pendingDraft = {
              ...(pendingDraft ?? draft),
              baseRevision: error.current.revision,
              requestId: createRequestId(),
              uncertainData: undefined,
            };
            revision = error.current.revision;
            retryAttempt = 0;
            persistPendingDraft();
            return true;
          }

          pendingDraft = pendingDraft
            ? {
                ...pendingDraft,
                baseRevision: draft.baseRevision,
                requestId: draft.requestId,
                uncertainData: error instanceof BackendRevisionConflict
                  ? pendingDraft.uncertainData
                  : draft.data,
              }
            : {
                ...draft,
                uncertainData: error instanceof BackendRevisionConflict
                  ? draft.uncertainData
                  : draft.data,
              };
          persistPendingDraft();
          if (error instanceof BackendRevisionConflict) {
            if (!disposed) setStatus('conflict');
          } else {
            handleFailure(error);
            if (
              !(error instanceof BackendAuthRequired) &&
              !(error instanceof BackendForbidden)
            ) {
              scheduleRetry(runSave);
            }
          }
          return false;
        } finally {
          saveInFlight = null;
        }
      })();

      const completed = await saveInFlight;
      if (completed && pendingDraft && !disposed) return runSave();
      return completed && !pendingDraft;
    };

    const queueSave = (data: AppData, delay = 600) => {
      pendingDraft = {
        workspaceId,
        baseRevision: revision,
        requestId: pendingDraft?.requestId ?? createRequestId(),
        updatedAt: Date.now(),
        data,
      };
      persistPendingDraft();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        if (!disposed) void runSave();
      }, delay);
    };

    flushRef.current = async () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = undefined;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      return runSave();
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingDraft && !saveInFlight) return;
      persistPendingDraft();
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener?.('beforeunload', handleBeforeUnload);

    const start = async () => {
      if (!(await probeBackend()) || disposed) {
        if (!disposed) setStatus('offline');
        return;
      }
      try {
        const remote = await loadBackendState();
        revision = remote.revision;
        const recoveredDraft = readPendingDraft(workspaceId);
        if (
          recoveredDraft &&
          recoveredDraft.baseRevision === remote.revision
        ) {
          pendingDraft = recoveredDraft;
          useStore.setState({
            data: normalizeAppData(recoveredDraft.data, Date.now()),
          });
        } else if (
          recoveredDraft?.uncertainData &&
          sameWorkspaceData(remote.data, recoveredDraft.uncertainData)
        ) {
          pendingDraft = {
            ...recoveredDraft,
            baseRevision: remote.revision,
            requestId: createRequestId(),
            uncertainData: undefined,
          };
          useStore.setState({
            data: normalizeAppData(recoveredDraft.data, Date.now()),
          });
        } else if (recoveredDraft) {
          pendingDraft = recoveredDraft;
          useStore.setState({
            data: normalizeAppData(recoveredDraft.data, Date.now()),
          });
          if (!disposed) setStatus('conflict');
          return;
        } else if (remote.data) {
          useStore.setState({ data: normalizeAppData(remote.data, Date.now()) });
        } else if (canWrite) {
          const saved = await saveBackendState(
            useStore.getState().data,
            revision,
            createRequestId(),
          );
          revision = saved.revision;
        }
        if (disposed) return;
        setStatus('connected');
        if (!canWrite) return;
        unsubscribe = useStore.subscribe((state, previousState) => {
          if (state.data === previousState.data || disposed) return;
          queueSave(state.data);
        });
        if (pendingDraft) void runSave();
      } catch (error) {
        handleFailure(error);
      }
    };

    void start();
    return () => {
      disposed = true;
      if (saveTimer) clearTimeout(saveTimer);
      if (retryTimer) clearTimeout(retryTimer);
      persistPendingDraft();
      unsubscribe?.();
      globalThis.removeEventListener?.('beforeunload', handleBeforeUnload);
      flushRef.current = async () => !pendingDraft && !saveInFlight;
    };
  }, [canWrite, enabled, onAuthenticationInvalid, workspaceId]);

  return { status, flush };
};
