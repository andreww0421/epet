import type { WorkspaceRole } from '../services/backendApi';

export const canWriteWorkspace = (role: WorkspaceRole | null | undefined) =>
  role === 'owner' || role === 'admin' || role === 'teacher';

export const canAdministerWorkspace = (
  role: WorkspaceRole | null | undefined,
) => role === 'owner' || role === 'admin';

export const canExportWorkspace = (role: WorkspaceRole | null | undefined) =>
  canAdministerWorkspace(role);

export const runWorkspaceMutation = <T>(
  canWrite: boolean,
  mutation: () => T,
  onDenied?: () => void,
): T | undefined => {
  if (!canWrite) {
    onDenied?.();
    return undefined;
  }
  return mutation();
};
