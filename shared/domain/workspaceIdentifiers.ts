export const LOCAL_WORKSPACE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const CLOUD_WORKSPACE_PATTERN = /^ws_[a-zA-Z0-9_-]{24,61}$/;

export const isValidWorkspaceId = (
  candidate: string,
  allowLocalWorkspaceIds: boolean,
) => (allowLocalWorkspaceIds
  ? LOCAL_WORKSPACE_PATTERN
  : CLOUD_WORKSPACE_PATTERN).test(candidate);
