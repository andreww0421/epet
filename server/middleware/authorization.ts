import {
  AuthForbiddenError,
  isRoleAtLeast,
  type AuthorizedWorkspace,
} from '../auth';
import type { AuthRepository, WorkspaceRole } from '../contracts';

export const enforceRole = (
  actual: WorkspaceRole,
  required: WorkspaceRole,
) => {
  if (!isRoleAtLeast(actual, required)) throw new AuthForbiddenError();
};

export type ClassAccessControl = {
  getClassScope: () => Promise<Set<string> | null>;
  requireClassAccess: (classId: string) => Promise<void>;
};

export const createClassAccessControl = (
  repository: Pick<AuthRepository, 'listWorkspaceClassIds'>,
  workspaceId: string,
  authorized: AuthorizedWorkspace,
): ClassAccessControl => {
  const getClassScope = async () => {
    if (isRoleAtLeast(authorized.membership.role, 'admin')) return null;
    const classIds = await repository.listWorkspaceClassIds(
      workspaceId,
      authorized.user.id,
    );
    if (classIds.length === 0) throw new AuthForbiddenError();
    return new Set(classIds);
  };
  const requireClassAccess = async (classId: string) => {
    const classScope = await getClassScope();
    if (classScope && !classScope.has(classId)) {
      throw new AuthForbiddenError();
    }
  };
  return { getClassScope, requireClassAccess };
};
