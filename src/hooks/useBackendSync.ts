import { useEffect, useState } from 'react';
import {
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
  | 'conflict';

export const useBackendSync = () => {
  const [status, setStatus] = useState<BackendSyncStatus>('checking');

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

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
        } else {
          const saved = await saveBackendState(useStore.getState().data, revision);
          revision = saved.revision;
        }
        if (disposed) return;
        setStatus('connected');
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
              } else if (!disposed) {
                setStatus('offline');
              }
            }
          }, 600);
        });
      } catch {
        if (!disposed) setStatus('offline');
      }
    };

    void start();
    return () => {
      disposed = true;
      if (saveTimer) clearTimeout(saveTimer);
      unsubscribe?.();
    };
  }, []);

  return status;
};
