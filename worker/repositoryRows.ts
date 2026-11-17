import type { AppData } from '../src/store/types';
import { createEmptyStoredWorkspace } from '../shared/domain/repositoryPolicy';
import type {
  AuthSessionRecord, AuthUserRecord, StoredWorkspace, UserWorkspaceAccess,
  WorkspaceInvitationRecord, WorkspaceMembershipRecord, WorkspaceRevisionRecord,
} from '../server/contracts';

/** D1 storage shapes and mappings only. Preserve SQL nullability and the
 * established optional-field behavior; transactions remain in the repository.
 */
export type WorkspaceRow = {
  revision: number;
  updated_at: number;
  data_json: string;
};

export type WorkspaceMetadataRow = Omit<WorkspaceRow, 'data_json'>;

export type ProjectionStatus = 'pending' | 'verified' | 'mismatch';

export type ProjectionDocumentRow = {
  workspace_id: string;
  source_revision: number;
  root_json: string;
  reconciliation_status: ProjectionStatus;
  source_checksum: string | null;
  projection_checksum: string | null;
  reconciled_at: number | null;
  details_json: string;
};

export type ProjectionRecordRow = {
  class_id: string;
  student_id?: string;
  exam_id?: string;
  sort_index: number;
  record_json: string;
};

export type UserRow = {
  user_id: string;
  email: string;
  email_normalized: string;
  email_verified_at: number | null;
  display_name: string;
  status: AuthUserRecord['status'];
  password_algorithm: AuthUserRecord['password']['algorithm'];
  password_salt: string;
  password_hash: string;
  password_iterations: number;
  created_at: number;
  updated_at: number;
  password_changed_at: number;
};

export type AuditEventRow = {
  event_id: string;
  workspace_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata_json: string;
  created_at: number;
};

export type MembershipRow = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceMembershipRecord['role'];
  created_at: number;
  created_by_user_id: string | null;
};

export type UserWorkspaceRow = {
  workspace_id: string;
  name: string;
  role: UserWorkspaceAccess['role'];
};

export type SessionRow = {
  token_hash: string;
  user_id: string;
  active_workspace_id: string | null;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  revoked_at: number | null;
};

export type ClaimRow = {
  workspace_id: string;
  claimed_by_user_id: string;
  claimed_at: number;
};

export type RateLimitRow = {
  window_started_at: number;
  attempt_count: number;
  blocked_until: number;
};

export type RevisionRow = {
  workspace_id: string;
  revision: number;
  updated_at: number;
  actor_user_id: string | null;
  data_size_bytes: number;
};

export type RevisionSnapshotRow = RevisionRow & {
  data_json: string;
};

export type InvitationRow = {
  invitation_id: string;
  token_hash: string;
  workspace_id: string;
  email: string;
  email_normalized: string;
  role: Exclude<WorkspaceMembershipRecord['role'], 'owner'>;
  class_ids_json: string;
  created_by_user_id: string;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
  accepted_by_user_id: string | null;
  revoked_at: number | null;
};

export const decodeWorkspace = (row: WorkspaceRow | null): StoredWorkspace => {
  if (!row) return createEmptyStoredWorkspace();
  return {
    revision: row.revision,
    updatedAt: row.updated_at,
    data: JSON.parse(row.data_json) as AppData,
  };
};

export const decodeUser = (row: UserRow | null): AuthUserRecord | null => {
  if (!row) return null;
  return {
    id: row.user_id,
    email: row.email,
    normalizedEmail: row.email_normalized,
    emailVerifiedAt: row.email_verified_at,
    displayName: row.display_name,
    status: row.status,
    password: {
      algorithm: row.password_algorithm,
      salt: row.password_salt,
      hash: row.password_hash,
      iterations: row.password_iterations,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passwordChangedAt: row.password_changed_at,
  };
};

export const decodeMembership = (
  row: MembershipRow | null,
): WorkspaceMembershipRecord | null => {
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id ?? undefined,
  };
};

export const decodeSession = (row: SessionRow | null): AuthSessionRecord | null => {
  if (!row) return null;
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    activeWorkspaceId: row.active_workspace_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
};

export const decodeRevision = (row: RevisionRow): WorkspaceRevisionRecord => ({
  workspaceId: row.workspace_id,
  revision: row.revision,
  updatedAt: row.updated_at,
  actorUserId: row.actor_user_id ?? undefined,
  dataSizeBytes: row.data_size_bytes,
});

export const decodeInvitation = (row: InvitationRow): WorkspaceInvitationRecord => ({
  id: row.invitation_id,
  tokenHash: row.token_hash,
  workspaceId: row.workspace_id,
  email: row.email,
  normalizedEmail: row.email_normalized,
  role: row.role,
  classIds: JSON.parse(row.class_ids_json) as string[],
  createdByUserId: row.created_by_user_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  acceptedAt: row.accepted_at,
  acceptedByUserId: row.accepted_by_user_id ?? undefined,
  revokedAt: row.revoked_at,
});
