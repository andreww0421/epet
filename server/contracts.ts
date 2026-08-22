import type { AppData } from '../src/store/types';

export type StoredWorkspace = {
  revision: number;
  updatedAt: number;
  data: AppData | null;
};

export interface WorkspaceRepository {
  get(workspaceId: string): Promise<StoredWorkspace>;
  put(
    workspaceId: string,
    data: AppData,
    baseRevision?: number,
    context?: WorkspaceWriteContext,
  ): Promise<StoredWorkspace>;
}

export type WorkspaceWriteContext = {
  actorUserId?: string;
  action?: string;
  requestId?: string;
};

export type WorkspaceRole = 'owner' | 'admin' | 'teacher' | 'viewer';
export type AuthUserStatus = 'active' | 'disabled';
export type PasswordAlgorithm = 'PBKDF2-HMAC-SHA256';

export type PasswordCredential = {
  algorithm: PasswordAlgorithm;
  salt: string;
  hash: string;
  iterations: number;
};

export type AuthUserRecord = {
  id: string;
  email: string;
  normalizedEmail: string;
  displayName: string;
  status: AuthUserStatus;
  password: PasswordCredential;
  createdAt: number;
  updatedAt: number;
  passwordChangedAt: number;
};

export type WorkspaceMembershipRecord = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: number;
  createdByUserId?: string;
};

export type UserWorkspaceAccess = {
  id: string;
  name: string;
  role: WorkspaceRole;
};

export type WorkspaceMember = {
  userId: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  classIds: string[];
  createdAt: number;
};

export type UpdateWorkspaceMemberInput = {
  workspaceId: string;
  userId: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  classIds: string[];
  actorUserId: string;
  updatedAt: number;
  auditEvent: AuditEventRecord;
};

export type RemoveWorkspaceMemberInput = {
  workspaceId: string;
  userId: string;
  actorUserId: string;
  removedAt: number;
  auditEvent: AuditEventRecord;
};

export type TransferWorkspaceOwnershipInput = {
  workspaceId: string;
  fromUserId: string;
  toUserId: string;
  transferredAt: number;
  auditEvent: AuditEventRecord;
};

export type DeleteWorkspaceInput = {
  workspaceId: string;
  actorUserId: string;
  deletedAt: number;
  auditEvent: AuditEventRecord;
};

export type DeleteUserInput = {
  userId: string;
  deletedAt: number;
  auditEvent: AuditEventRecord;
};

export type AuthCleanupResult = {
  sessions: number;
  passwordResetTokens: number;
  rateLimits: number;
  invitations: number;
};

export type WorkspaceInvitationRecord = {
  id: string;
  tokenHash: string;
  workspaceId: string;
  email: string;
  normalizedEmail: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  classIds: string[];
  createdByUserId: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  acceptedByUserId?: string;
  revokedAt: number | null;
};

export type WorkspaceInvitationSummary = Omit<
  WorkspaceInvitationRecord,
  'tokenHash'
>;

export type AcceptWorkspaceInvitationInput = {
  tokenHash: string;
  invitation: WorkspaceInvitationRecord;
  user: AuthUserRecord;
  createUser: boolean;
  membership: WorkspaceMembershipRecord;
  acceptedAt: number;
  auditEvent: AuditEventRecord;
};

export type AuthSessionRecord = {
  tokenHash: string;
  userId: string;
  activeWorkspaceId: string | null;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
};

export type PasswordResetTokenRecord = {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
};

export type WorkspaceClaimRecord = {
  workspaceId: string;
  claimedByUserId: string;
  claimedAt: number;
};

export type AuthRateLimitScope = 'login' | 'register' | 'forgot' | 'reset';

export type ConsumeAuthRateLimitInput = {
  scope: AuthRateLimitScope;
  subjectHash: string;
  now: number;
  windowMs: number;
  maxAttempts: number;
  blockMs: number;
};

export type AuthRateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export type WorkspaceRevisionRecord = {
  workspaceId: string;
  revision: number;
  updatedAt: number;
  actorUserId?: string;
  dataSizeBytes: number;
};

export type WorkspaceRevisionSnapshot = WorkspaceRevisionRecord & {
  data: AppData;
};

export type AuditEventRecord = {
  id: string;
  workspaceId?: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export type WorkspaceSeed = {
  id: string;
  name: string;
  data: AppData;
  createdAt: number;
};

export type CreateUserWithWorkspaceInput = {
  user: AuthUserRecord;
  workspace: WorkspaceSeed;
  membership: WorkspaceMembershipRecord;
  auditEvent: AuditEventRecord;
};

export type CreateWorkspaceForUserInput = {
  workspace: WorkspaceSeed;
  membership: WorkspaceMembershipRecord;
  auditEvent: AuditEventRecord;
};

export type ClaimLegacyWorkspaceInput = {
  workspaceId: string;
  userId: string;
  createdAt: number;
  auditEvent: AuditEventRecord;
};

export type ConsumePasswordResetInput = {
  tokenHash: string;
  password: PasswordCredential;
  usedAt: number;
};

export interface AuthRepository {
  findUserByNormalizedEmail(normalizedEmail: string): Promise<AuthUserRecord | null>;
  getUserById(userId: string): Promise<AuthUserRecord | null>;
  createUserWithWorkspace(input: CreateUserWithWorkspaceInput): Promise<void>;
  createWorkspaceForUser(input: CreateWorkspaceForUserInput): Promise<void>;
  listUserWorkspaces(userId: string): Promise<UserWorkspaceAccess[]>;
  getWorkspaceMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRecord | null>;
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  updateWorkspaceMember(input: UpdateWorkspaceMemberInput): Promise<void>;
  removeWorkspaceMember(input: RemoveWorkspaceMemberInput): Promise<void>;
  transferWorkspaceOwnership(
    input: TransferWorkspaceOwnershipInput,
  ): Promise<void>;
  deleteWorkspace(input: DeleteWorkspaceInput): Promise<void>;
  deleteUser(input: DeleteUserInput): Promise<void>;
  cleanupExpiredAuthData(now: number): Promise<AuthCleanupResult>;
  createWorkspaceInvitation(invitation: WorkspaceInvitationRecord): Promise<void>;
  getWorkspaceInvitationByTokenHash(
    tokenHash: string,
  ): Promise<WorkspaceInvitationRecord | null>;
  listWorkspaceInvitations(
    workspaceId: string,
  ): Promise<WorkspaceInvitationSummary[]>;
  revokeWorkspaceInvitation(
    workspaceId: string,
    invitationId: string,
    revokedAt: number,
    auditEvent: AuditEventRecord,
  ): Promise<void>;
  acceptWorkspaceInvitation(
    input: AcceptWorkspaceInvitationInput,
  ): Promise<void>;
  listWorkspaceClassIds(
    workspaceId: string,
    userId: string,
  ): Promise<string[]>;
  claimLegacyWorkspace(
    input: ClaimLegacyWorkspaceInput,
  ): Promise<WorkspaceMembershipRecord>;
  createAuthSession(session: AuthSessionRecord): Promise<void>;
  getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  setAuthSessionActiveWorkspace(
    tokenHash: string,
    workspaceId: string,
  ): Promise<void>;
  revokeAuthSession(tokenHash: string, revokedAt: number): Promise<void>;
  revokeAllAuthSessions(userId: string, revokedAt: number): Promise<void>;
  createPasswordResetToken(token: PasswordResetTokenRecord): Promise<void>;
  consumePasswordResetToken(
    input: ConsumePasswordResetInput,
  ): Promise<AuthUserRecord | null>;
  consumeAuthRateLimit(
    input: ConsumeAuthRateLimitInput,
  ): Promise<AuthRateLimitResult>;
  appendAuditEvent(event: AuditEventRecord): Promise<void>;
  listWorkspaceRevisions(
    workspaceId: string,
    limit?: number,
  ): Promise<WorkspaceRevisionRecord[]>;
  getWorkspaceRevision(
    workspaceId: string,
    revision: number,
  ): Promise<WorkspaceRevisionSnapshot | null>;
}

export class WorkspaceConflictError extends Error {
  constructor(readonly current: StoredWorkspace) {
    super('Workspace revision conflict');
  }
}

export class WorkspaceDataTooLargeError extends Error {
  constructor() {
    super('Workspace data is too large');
  }
}

export class EmailAlreadyExistsError extends Error {
  constructor() {
    super('Email already exists');
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor() {
    super('Workspace not found');
  }
}

export class WorkspaceAlreadyClaimedError extends Error {
  constructor() {
    super('Workspace already claimed');
  }
}

export class WorkspaceMembershipNotFoundError extends Error {
  constructor() {
    super('Workspace membership not found');
  }
}

export class WorkspaceOwnerTransferRequiredError extends Error {
  constructor() {
    super('Workspace ownership must be transferred or deleted first');
  }
}

export class InvalidWorkspaceInvitationError extends Error {
  constructor() {
    super('Workspace invitation is invalid or expired');
  }
}
