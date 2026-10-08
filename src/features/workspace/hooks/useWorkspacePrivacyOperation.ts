import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../auth/AuthProvider';
import { canAdministerWorkspace } from '../../../auth/workspaceAccess';
import { loadBackendState } from '../../../services/backendApi';
import type { AppData, Language } from '../../../store/types';

/** Coordinates existing sync and server revision checks, never writes a local draft. */
export const useWorkspacePrivacyOperation = (
  language: Language, flushChanges: () => Promise<boolean>,
) => {
  const { session, status } = useAuth();
  const workspaceId = session?.activeWorkspaceId ?? null;
  const role = session?.workspaces.find((item) => item.id === workspaceId)?.role;
  const allowed = status === 'authenticated' && !!workspaceId && canAdministerWorkspace(role);
  const current = useRef({ workspaceId, allowed });
  current.current = { workspaceId, allowed };
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const execute = async (
    operation: (workspaceId: string, revision: number, data: AppData | null) => Promise<unknown>,
    reloadAfter = true,
  ): Promise<boolean> => {
    const targetWorkspaceId = workspaceId;
    if (!allowed || !targetWorkspaceId || inFlight.current) return false;
    const stillAllowed = () => mounted.current && current.current.allowed &&
      current.current.workspaceId === targetWorkspaceId;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      if (!(await flushChanges())) throw new Error('SYNC_REQUIRED');
      if (!stillAllowed()) return false;
      const snapshot = await loadBackendState(targetWorkspaceId);
      if (!stillAllowed()) return false;
      await operation(targetWorkspaceId, snapshot.revision, snapshot.data);
      if (!stillAllowed()) return false;
      // The sync controller owns its base revision. Reload instead of hydrating
      // the store with a server mutation and accidentally saving stale state.
      if (reloadAfter) window.location.reload();
      return true;
    } catch (failure) {
      if (stillAllowed()) {
        const code = failure instanceof Error ? failure.message.toUpperCase() : '';
        const en = language === 'en';
        setError(code.includes('SYNC_REQUIRED')
          ? (en ? 'Finish synchronizing this workspace before taking action.' : '請先完成工作區同步，再執行資料操作。')
          : code.includes('TARGET_CHANGED')
            ? (en ? 'The selected record changed. Cancel, reload and review the target again.' : '所選資料已變更。請取消、重新載入並再次檢查對象。')
          : code.includes('LAST_ACTIVE_CLASS')
            ? (en ? 'Keep at least one active class. Create another class before archiving this one.' : '必須保留至少一個使用中的班級；請先建立另一個班級。')
            : code.includes('REVISION_CONFLICT')
              ? (en ? 'The workspace changed. Reload and review the target again; nothing was overwritten.' : '工作區已有新版本；請重新載入並再次檢查對象，系統未覆寫資料。')
              : (en ? 'The operation was not confirmed. Reload to check the current data before retrying.' : '無法確認操作結果。請重新載入檢查目前資料後，再決定是否重試。'));
      }
      return false;
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { allowed, busy, error, execute };
};
