import { useEffect, useState } from 'react';
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

export const useBackendSync = (
  enabled = true,
  workspaceId: string | null = null,
  onAuthenticationInvalid?: () => void,
  canWrite = true,
) => {
  const [status, setStatus] = useState<BackendSyncStatus>('checking');

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    if (!enabled || !workspaceId) {
      setStatus('checking');
      return () => {
        disposed = true;
      };
    }

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

    const start = async () => {
      if (!(await probeBackend()) || disposed) {
        if (!disposed) setStatus('offline');
        return;
      }
      try {
        const remote = await loadBackendState();
        revision = remote.revision;
        if (remote.data) {
          useStore.setState({ data: normalizeAppData(remote.data, Date.now()) });
        } else if (canWrite) {
          const saved = await saveBackendState(useStore.getState().data, revision);
          revision = saved.revision;
        }
        if (disposed) return;
        setStatus('connected');
        if (!canWrite) return;
        unsubscribe = useStore.subscribe((state, previousState) => {
          if (state.data === previousState.data || disposed) return;
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(async () => {
            if (disposed) return;
            setStatus('saving');
            try {
              const saved = await saveBackendState(useStore.getState().data, revision);
              revision = saved.revision;
              if (!disposed) setStatus('connected');
            } catch (error) {
              if (error instanceof BackendRevisionConflict) {
                if (!disposed) setStatus('conflict');
              } else handleFailure(error);
            }
          }, 600);
        });
      } catch (error) {
        handleFailure(error);
      }
    };

    void start();
    return () => {
      disposed = true;
      if (saveTimer) clearTimeout(saveTimer);
      unsubscribe?.();
    };
  }, [canWrite, enabled, onAuthenticationInvalid, workspaceId]);

  return status;
};
