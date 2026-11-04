export type WorkspaceRole = 'owner' | 'admin' | 'teacher' | 'viewer';

// A draft belongs to an authenticated principal and the exact authority used
// to read it. null means workspace-wide access; an array is a class allowlist.
export type WorkspaceAccess = {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  classIds: string[] | null;
};

const isIdentity = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const isWorkspaceAccess = (value: unknown): value is WorkspaceAccess => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const access = value as Record<string, unknown>;
  if (!isIdentity(access.userId) || !isIdentity(access.workspaceId)) return false;
  if (access.role === 'owner' || access.role === 'admin') return access.classIds === null;
  if (access.role !== 'teacher' && access.role !== 'viewer') return false;
  return Array.isArray(access.classIds) && access.classIds.length > 0 &&
    access.classIds.every(isIdentity);
};

// Serialize a tuple rather than joining IDs with an ambiguous delimiter.
export const workspaceAccessKey = (access: WorkspaceAccess): string =>
  JSON.stringify([access.userId, access.workspaceId, access.role,
    access.classIds === null ? null : [...new Set(access.classIds)].sort()]);

// Keep the transport binding bounded even for large imported Unicode scopes.
// The digest identifies authority; the server still derives and enforces it.
export const workspaceAccessHeader = async (access: WorkspaceAccess): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(workspaceAccessKey(access)));
  return `v1.${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`;
};
