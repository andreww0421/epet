import {
  CLOUD_WORKSPACE_PATTERN,
  isValidWorkspaceId,
  LOCAL_WORKSPACE_PATTERN,
} from '../../shared/domain/workspaceIdentifiers';

export {
  CLOUD_WORKSPACE_PATTERN,
  LOCAL_WORKSPACE_PATTERN,
} from '../../shared/domain/workspaceIdentifiers';

export const getRequestId = (request: Request) => {
  const value = request.headers.get('x-request-id')?.trim() ?? '';
  return /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : undefined;
};

export const getWorkspaceId = (
  request: Request,
  allowLocalWorkspaceIds: boolean,
) => {
  const candidate = request.headers.get('x-epet-workspace') ?? '';
  return isValidWorkspaceId(candidate, allowLocalWorkspaceIds)
    ? candidate
    : null;
};
