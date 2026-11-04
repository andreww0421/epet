import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { AppData } from '../store/types';
import { isWorkspaceAccess, workspaceAccessKey, type WorkspaceAccess, type WorkspaceRole } from '../../shared/contracts/workspace';
import {
  clearPendingDraft, DRAFT_TTL_MS, isDraftDataWithinAccess,
  readPendingDraft, sameWorkspaceData, writePendingDraft, type PendingWorkspaceDraft,
} from '../services/workspaceDrafts';
import {
  BackendApiError,
  BackendAuthRequired,
  BackendForbidden,
  BackendRevisionConflict,
  loadBackendState,
  probeBackend,
  saveBackendState,
} from '../services/backendApi';
import { classifySaveFailure, isPausedSyncFailure, type DraftSyncState, type SyncFailure } from '../services/syncRetryPolicy';
import { jsonUtf8Size } from '../../shared/domain/repositoryPolicy';
import { normalizeAppData } from '../store/utils';
import { setProductWorkflowScope } from '../analytics/workflows';
import { captureProductWorkflowSave } from '../services/productWorkflowPersistence';
import {
  getStoreSessionGeneration,
  resetStoreForSession,
  useStore,
} from '../store/useStore';

export type BackendSyncStatus =
  | 'checking'
  | 'connected'
  | 'saving'
  | 'offline'
  | 'conflict'
  | 'capacity-error'
  | 'validation-error'
  | 'save-error'
  | 'retry-paused'
  | 'session-expired'
  | 'forbidden';

export type BackendSyncController = {
  status: BackendSyncStatus;
  verifiedAccess: WorkspaceAccess | null;
  flush: () => Promise<boolean>;
  readDraftForDownload: () => Promise<AppData | null>;
  adoptRemote: () => Promise<boolean>;
  preserveConflictDraft: () => Promise<boolean>;
  retry: () => Promise<boolean>;
  failure: SyncFailure | null;
  retryAt: number | null;
  localDraftBytes: number | null;
};

const failureStatus = (failure: SyncFailure): BackendSyncStatus =>
  failure.kind === 'capacity' ? 'capacity-error'
    : failure.kind === 'validation' ? 'validation-error'
      : failure.kind === 'retry-exhausted' ? 'retry-paused' : 'save-error';

const createRequestId = () =>
  globalThis.crypto?.randomUUID?.()
  ?? `save-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const useBackendSync = (
  enabled = true,
  workspaceId: string | null = null,
  onAuthenticationInvalid?: () => void,
  canWrite = true,
  userId: string | null = null,
  role?: WorkspaceRole,
): BackendSyncController => {
  const [status, setStatus] = useState<BackendSyncStatus>('checking');
  const [verifiedAccess, setVerifiedAccess] = useState<WorkspaceAccess | null>(null);
  const [failure, setFailure] = useState<SyncFailure | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [localDraftBytes, setLocalDraftBytes] = useState<number | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => false);
  const downloadRef = useRef<() => Promise<AppData | null>>(async () => null);
  const adoptRemoteRef = useRef<() => Promise<boolean>>(async () => false);
  const preserveConflictRef = useRef<() => Promise<boolean>>(async () => false);
  const retryRef = useRef<() => Promise<boolean>>(async () => false);

  const flush = useCallback(() => flushRef.current(), []);
  const readDraftForDownload = useCallback(() => downloadRef.current(), []);
  const adoptRemote = useCallback(() => adoptRemoteRef.current(), []);
  const preserveConflictDraft = useCallback(() => preserveConflictRef.current(), []);
  const retry = useCallback(() => retryRef.current(), []);

  // Detach the previous workspace before clearing its view. Do the small
  // synchronous handoff before paint; network loading remains asynchronous.
  useLayoutEffect(() => {
    setVerifiedAccess(null);
    setProductWorkflowScope(null);
    let disposed = false;
    let revision = 0;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let pendingDraft: PendingWorkspaceDraft | null = null;
    let inFlightDraft: PendingWorkspaceDraft | null = null;
    let access: WorkspaceAccess | null = null;
    let saveInFlight: Promise<boolean> | null = null;
    let pausedFailure: SyncFailure | null = null;
    let loaded = false;
    let conflicted = false;
    let recovering = false;

    downloadRef.current = async () => null;
    adoptRemoteRef.current = async () => false;
    preserveConflictRef.current = async () => false;
    retryRef.current = async () => false;
    setFailure(null);
    setRetryAt(null);
    setLocalDraftBytes(null);
    if (!enabled || !workspaceId || !userId || !role) {
      setStatus('checking');
      flushRef.current = async () => true;
      return () => {
        disposed = true;
      };
    }

    setStatus('checking');
    // Never trust memory from a previous principal, permission set or mount.
    // Drafts remain in their exact namespace while fresh authority is loaded.
    resetStoreForSession();
    let generation = getStoreSessionGeneration();
    const isCurrent = () =>
      !disposed && generation === getStoreSessionGeneration();

    const clearFailure = () => {
      pausedFailure = null;
      setFailure(null);
      setRetryAt(null);
      setLocalDraftBytes(null);
    };
    const displayFailure = (state: DraftSyncState) => {
      pausedFailure = isPausedSyncFailure(state.failure) ? state.failure : null;
      setFailure(state.failure);
      setRetryAt(state.notBefore || null);
      setLocalDraftBytes(pendingDraft ? jsonUtf8Size(pendingDraft.data) : null);
      setStatus(pausedFailure ? failureStatus(pausedFailure) : 'offline');
    };

    const persistPendingDraft = () => {
      const draft = pendingDraft ?? inFlightDraft;
      if (draft) writePendingDraft(inFlightDraft
        ? { ...draft, uncertainData: inFlightDraft.data }
        : draft);
    };

    const loadAuthorizedState = async () => {
      const remote = await loadBackendState(workspaceId, userId);
      if (!isCurrent()) return null;
      if (!isWorkspaceAccess(remote.access) || remote.access.userId !== userId ||
          remote.access.workspaceId !== workspaceId || remote.access.role !== role ||
          (access && workspaceAccessKey(access) !== workspaceAccessKey(remote.access)) ||
          (remote.data && !isDraftDataWithinAccess(remote.data, remote.access))) {
        throw new BackendForbidden();
      }
      return remote as typeof remote & { access: WorkspaceAccess };
    };

    const scheduleRetry = (runSave: () => Promise<boolean>) => {
      if (!isCurrent() || conflicted || pausedFailure || recovering || retryTimer || !pendingDraft) return;
      const delay = Math.max(0, (pendingDraft.syncState?.notBefore ?? 0) - Date.now());
      if (delay > 2_147_483_647 || Date.now() + delay >= pendingDraft.expiresAt) {
        const state: DraftSyncState = { retries: pendingDraft.syncState?.retries ?? 0,
          notBefore: pendingDraft.syncState?.notBefore ?? 0, failure: { kind: 'retry-exhausted' } };
        pendingDraft = { ...pendingDraft, syncState: state };
        persistPendingDraft();
        displayFailure(state);
        return;
      }
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (isCurrent()) void runSave();
      }, delay);
    };

    const handleFailure = (error: unknown) => {
      if (!isCurrent()) return;
      if (error instanceof BackendAuthRequired) {
        setProductWorkflowScope(null);
        if (!disposed) setStatus('session-expired');
        onAuthenticationInvalid?.();
        return;
      }
      if (error instanceof BackendForbidden) {
        setProductWorkflowScope(null);
        if (!disposed) setStatus('forbidden');
        // Revocation also removes old Store/DOM/export authority. Its draft
        // stays isolated for a later login with the original exact scope.
        onAuthenticationInvalid?.();
        return;
      }
      if (!disposed) setStatus(conflicted ? 'conflict' : pausedFailure ? failureStatus(pausedFailure) : 'offline');
    };

    const runSave = async (): Promise<boolean> => {
      if (!isCurrent() || conflicted || pausedFailure || recovering) return false;
      if (saveInFlight) {
        const completed = await saveInFlight;
        if (!completed || !isCurrent()) return false;
        return pendingDraft ? runSave() : true;
      }
      if (!pendingDraft) return true;
      if ((pendingDraft.syncState?.notBefore ?? 0) > Date.now()) {
        scheduleRetry(runSave);
        return false;
      }

      const draft = pendingDraft;
      const workflowSave = captureProductWorkflowSave(draft.data);
      inFlightDraft = draft;
      pendingDraft = null;
      if (!disposed) setStatus('saving');
      saveInFlight = (async () => {
        try {
          const checked = await loadAuthorizedState();
          if (!checked || !isCurrent()) return false;
          if (!access || workspaceAccessKey(draft.access) !== workspaceAccessKey(access) ||
              Date.now() >= draft.expiresAt || !isDraftDataWithinAccess(draft.data, access)) {
            throw new BackendForbidden();
          }
          const saved = await saveBackendState(
            draft.data,
            draft.baseRevision,
            draft.requestId,
            workspaceId,
            access,
            workflowSave.classCreateIntent,
          );
          if (!isCurrent()) return false;
          if (Number.isInteger(saved.revision) && saved.revision > draft.baseRevision && saved.data) {
            workflowSave.acknowledge(saved.data);
          } else workflowSave.unconfirmed();
          revision = saved.revision;
          clearFailure();
          if (pendingDraft) {
            pendingDraft = {
              ...pendingDraft,
              baseRevision: saved.revision,
              uncertainData: undefined,
              syncState: undefined,
            };
            persistPendingDraft();
          } else {
            clearPendingDraft(draft.access);
          }
          if (!disposed) setStatus('connected');
          return true;
        } catch (error) {
          if (!isCurrent()) return false;
          if (
            error instanceof BackendRevisionConflict &&
            sameWorkspaceData(error.current.data, draft.data)
          ) {
            // The previous request may have committed while its response was
            // lost. Treat an identical remote snapshot as an idempotent save.
            // Equivalence proves no fresh write for this attempt.
            workflowSave.unconfirmed();
            revision = error.current.revision;
            clearFailure();
            if (pendingDraft) {
              pendingDraft = {
                ...pendingDraft,
                baseRevision: error.current.revision,
                uncertainData: undefined,
                syncState: undefined,
              };
              persistPendingDraft();
            } else {
              clearPendingDraft(draft.access);
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
              syncState: undefined,
            };
            revision = error.current.revision;
            clearFailure();
            persistPendingDraft();
            return true;
          }

          const definiteRejection = error instanceof BackendRevisionConflict ||
            (error instanceof BackendApiError && [400, 409, 413, 422, 425, 429].includes(error.status));
          pendingDraft = pendingDraft
            ? {
                ...pendingDraft,
                baseRevision: draft.baseRevision,
                requestId: draft.requestId,
                uncertainData: definiteRejection
                  ? pendingDraft.uncertainData
                  : draft.data,
              }
            : {
                ...draft,
                uncertainData: definiteRejection
                  ? draft.uncertainData
                  : draft.data,
              };
          // The attempt has settled. Its uncertainty is recorded explicitly
          // above; persisting a rejected 409 must not mark it in-flight again.
          inFlightDraft = null;
          if (error instanceof BackendRevisionConflict) {
            persistPendingDraft();
            conflicted = true;
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = undefined;
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = undefined;
            if (!disposed) setStatus('conflict');
          } else {
            if (error instanceof BackendAuthRequired || error instanceof BackendForbidden) {
              persistPendingDraft();
              handleFailure(error);
            } else {
              const syncState = classifySaveFailure(error, draft.syncState?.retries ?? 0, Date.now(), pendingDraft.expiresAt);
              pendingDraft = { ...pendingDraft, syncState };
              persistPendingDraft();
              displayFailure(syncState);
              scheduleRetry(runSave);
            }
          }
          return false;
        } finally {
          saveInFlight = null;
          inFlightDraft = null;
        }
      })();

      const completed = await saveInFlight;
      if (completed && pendingDraft && isCurrent()) return runSave();
      return completed && !pendingDraft && isCurrent();
    };

    const queueSave = (data: AppData, delay = 600) => {
      if (conflicted || pausedFailure || recovering) return;
      if (!access || !isDraftDataWithinAccess(data, access)) {
        handleFailure(new BackendForbidden());
        return;
      }
      const now = Date.now();
      pendingDraft = {
        version: 2,
        access,
        baseRevision: revision,
        requestId: pendingDraft?.requestId ?? createRequestId(),
        createdAt: pendingDraft?.createdAt ?? now,
        updatedAt: now,
        expiresAt: now + DRAFT_TTL_MS,
        data,
        syncState: pendingDraft?.syncState,
      };
      persistPendingDraft();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        if (isCurrent()) void runSave();
      }, delay);
    };

    const subscribeToChanges = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (!canWrite) return;
      unsubscribe = useStore.subscribe((state, previousState) => {
        if (state.data === previousState.data || !isCurrent()) return;
        queueSave(state.data);
      });
    };

    flushRef.current = async () => {
      if (!isCurrent() || !loaded) return false;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = undefined;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      return runSave();
    };

    retryRef.current = async () => {
      if (!isCurrent() || recovering || conflicted || !pendingDraft ||
          (pausedFailure && pausedFailure.kind !== 'retry-exhausted') ||
          (pendingDraft.syncState?.notBefore ?? 0) > Date.now()) return false;
      if (saveInFlight) return saveInFlight;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      pendingDraft = { ...pendingDraft, syncState: undefined };
      clearFailure();
      persistPendingDraft();
      return runSave();
    };

    downloadRef.current = async () => {
      const draft = pendingDraft ?? inFlightDraft;
      const downloadGeneration = generation;
      if (!draft || !access || !isCurrent() || recovering || !['owner', 'admin'].includes(access.role)) return null;
      try {
        if (!(await loadAuthorizedState()) || !isCurrent() || recovering || downloadGeneration !== generation ||
            (draft !== pendingDraft && draft !== inFlightDraft) || Date.now() >= draft.expiresAt ||
            workspaceAccessKey(draft.access) !== workspaceAccessKey(access) ||
            !isDraftDataWithinAccess(draft.data, access)) return null;
        return draft.data;
      } catch (error) {
        // An older download cannot revoke a freshly adopted generation, even
        // when its late result is an error rather than a successful response.
        if (downloadGeneration === generation && !recovering &&
            (draft === pendingDraft || draft === inFlightDraft)) handleFailure(error);
        return null;
      }
    };

    // Explicitly paused queues may leave only after durable scoped retention.
    // Ordinary offline/in-flight writes still require the original flush.
    preserveConflictRef.current = async () => {
      if (saveInFlight) await saveInFlight;
      if (!isCurrent() || recovering || (!conflicted && !pausedFailure) || !pendingDraft || Date.now() >= pendingDraft.expiresAt) return false;
      return writePendingDraft(pendingDraft);
    };

    // The caller must obtain an explicit discard decision. Fetch and validate
    // before deleting anything; a 409 response is not fresh recovery authority.
    adoptRemoteRef.current = async () => {
      if (!isCurrent() || !loaded || !access || (!conflicted && !pausedFailure) || recovering) return false;
      const previousStatus = conflicted ? 'conflict' : failureStatus(pausedFailure!);
      recovering = true;
      setStatus('checking');
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = undefined;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      try {
        if (saveInFlight) await saveInFlight;
        const remote = await loadAuthorizedState();
        if (!remote || !isCurrent()) return false;
        const data = normalizeAppData(remote.data ?? {}, Date.now());
        if (!clearPendingDraft(remote.access)) {
          setStatus(previousStatus);
          return false;
        }
        unsubscribe?.();
        unsubscribe = undefined;
        pendingDraft = null;
        inFlightDraft = null;
        revision = remote.revision;
        clearFailure();
        conflicted = false;
        // Clear transient student/UI/undo memory and invalidate old downloads.
        // This effect owns the new generation after the old save has settled.
        resetStoreForSession();
        generation = getStoreSessionGeneration();
        useStore.setState({ data });
        setProductWorkflowScope(workspaceAccessKey(remote.access));
        setVerifiedAccess(remote.access);
        subscribeToChanges();
        setStatus('connected');
        return true;
      } catch (error) {
        if (error instanceof BackendAuthRequired || error instanceof BackendForbidden) {
          handleFailure(error);
        } else if (isCurrent()) {
          setStatus(previousStatus);
        }
        return false;
      } finally {
        recovering = false;
      }
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingDraft && !saveInFlight) return;
      persistPendingDraft();
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener?.('beforeunload', handleBeforeUnload);

    const start = async () => {
      if (!(await probeBackend()) || !isCurrent()) {
        if (isCurrent()) setStatus('offline');
        return;
      }
      try {
        const remote = await loadAuthorizedState();
        if (!remote || !isCurrent()) return;
        access = remote.access;
        revision = remote.revision;
        // Preserve any old writable draft, but never replay it as a viewer.
        const recoveredDraft = canWrite && access.role !== 'viewer' ? readPendingDraft(access) : null;
        loaded = true;
        if (recoveredDraft && sameWorkspaceData(remote.data, recoveredDraft.data)) {
          // A save can commit before an auth refresh detaches its response.
          // Confirm the identical remote value without replaying another write.
          clearPendingDraft(access);
          useStore.setState({ data: normalizeAppData(remote.data, Date.now()) });
        } else if (
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
            // Confirming an older committed write does not cancel the newer
            // draft's Retry-After deadline, failure budget or terminal pause.
            syncState: recoveredDraft.syncState,
          };
          useStore.setState({
            data: normalizeAppData(recoveredDraft.data, Date.now()),
          });
        } else if (recoveredDraft) {
          pendingDraft = recoveredDraft;
          conflicted = true;
          useStore.setState({
            data: normalizeAppData(recoveredDraft.data, Date.now()),
          });
          if (!disposed) setStatus('conflict');
          setProductWorkflowScope(workspaceAccessKey(access));
          return;
        } else if (remote.data) {
          useStore.setState({ data: normalizeAppData(remote.data, Date.now()) });
        } else if (canWrite) {
          const saved = await saveBackendState(
            useStore.getState().data,
            revision,
            createRequestId(),
            workspaceId,
            access,
          );
          if (!isCurrent()) return;
          revision = saved.revision;
        }
        if (!isCurrent()) return;
        setProductWorkflowScope(workspaceAccessKey(access));
        setVerifiedAccess(access);
        setStatus('connected');
        subscribeToChanges();
        if (pendingDraft?.syncState) displayFailure(pendingDraft.syncState);
        if (pendingDraft && !pausedFailure) void runSave();
      } catch (error) {
        handleFailure(error);
      }
    };

    void start();
    return () => {
      disposed = true;
      setProductWorkflowScope(null);
      if (saveTimer) clearTimeout(saveTimer);
      if (retryTimer) clearTimeout(retryTimer);
      persistPendingDraft();
      unsubscribe?.();
      globalThis.removeEventListener?.('beforeunload', handleBeforeUnload);
      flushRef.current = async () => false;
      downloadRef.current = async () => null;
      adoptRemoteRef.current = async () => false;
      preserveConflictRef.current = async () => false;
      retryRef.current = async () => false;
    };
  }, [canWrite, enabled, onAuthenticationInvalid, role, userId, workspaceId]);

  const currentAccess = verifiedAccess?.userId === userId && verifiedAccess.workspaceId === workspaceId &&
    verifiedAccess.role === role && (status === 'connected' || status === 'saving') ? verifiedAccess : null;
  return { status, verifiedAccess: currentAccess, flush, readDraftForDownload, adoptRemote, preserveConflictDraft,
    retry, failure, retryAt, localDraftBytes };
};
