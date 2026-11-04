import type { AppData } from '../src/store/types';
import type { WorkspaceRole } from '../shared/contracts/workspace';

export type { WorkspaceRole } from '../shared/contracts/workspace';

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

export type ProductOnboardingState = {
  cohortDay: string;
  started: boolean;
  localReported: boolean;
  backendPersisted: boolean;
};

export type ProductOnboardingSummary = {
  cohortDay: string;
  enrolled: number;
  started: number;
  localReported: number;
  backendPersisted: number;
};

export interface ProductOnboardingRepository {
  getProductOnboarding(userId: string): Promise<ProductOnboardingState | null>;
  enrollProductOnboarding(input: {
    userId: string; cohortStart: number; now: number;
  }): Promise<ProductOnboardingState | null>;
  updateProductOnboarding(userId: string, stage: 'started' | 'local_completed'):
    Promise<ProductOnboardingState | null>;
  confirmProductOnboarding(userId: string): Promise<void>;
  summarizeProductOnboarding(input: { fromDay: string; toDay: string }):
    Promise<ProductOnboardingSummary[]>;
}

export const isProductOnboardingEnrollmentTime = (cohortStart: number, now: number) =>
  Number.isSafeInteger(cohortStart) && cohortStart >= 0 &&
  Number.isSafeInteger(now) && now >= cohortStart && now <= 8_640_000_000_000_000;

export const assertProductOnboardingDateRange = (fromDay: string, toDay: string) => {
  const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  if (!validDay(fromDay) || !validDay(toDay) || toDay < fromDay ||
      Date.parse(toDay) - Date.parse(fromDay) > 90 * 86_400_000) {
    throw new Error('Invalid product onboarding summary range');
  }
};

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
  emailVerifiedAt: number | null;
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
  emailVerificationTokens: number;
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

export type EmailVerificationTokenRecord = {
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

export type AuthRateLimitScope =
  | 'login'
  | 'register'
  | 'forgot'
  | 'reset'
  | 'verify';

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

export type AuditEventCursor = {
  createdAt: number;
  id: string;
};

export type WorkspaceAuditQuery = {
  limit?: number;
  cursor?: AuditEventCursor;
  action?: string;
  actorUserId?: string;
  targetType?: string;
  fromCreatedAt?: number;
  toCreatedAt?: number;
};

export type WorkspaceSeed = {
  id: string;
  name: string;
  data: AppData;
  createdAt: number;
};

export type CreateUserWithWorkspaceInput = {
  user: AuthUserRecord;
  emailVerificationToken?: EmailVerificationTokenRecord;
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

export type ConsumeEmailVerificationInput = {
  tokenHash: string;
  verifiedAt: number;
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
  // Only issue a session for the exact credential that was authenticated.
  // Implementations must compare and insert atomically with password resets.
  createAuthSession(
    session: AuthSessionRecord,
    expectedPassword: PasswordCredential,
  ): Promise<boolean>;
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
  createEmailVerificationToken(
    token: EmailVerificationTokenRecord,
  ): Promise<void>;
  consumeEmailVerificationToken(
    input: ConsumeEmailVerificationInput,
  ): Promise<AuthUserRecord | null>;
  consumeAuthRateLimit(
    input: ConsumeAuthRateLimitInput,
  ): Promise<AuthRateLimitResult>;
  appendAuditEvent(event: AuditEventRecord): Promise<void>;
  listWorkspaceAuditEvents(
    workspaceId: string,
    query?: WorkspaceAuditQuery,
  ): Promise<AuditEventRecord[]>;
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
  readonly limitBytes?: number;
  readonly limitKind?: 'workspace_snapshot' | 'request_body';

  constructor(limit?: {
    limitBytes: number;
    limitKind: 'workspace_snapshot' | 'request_body';
  }) {
    super('Workspace data is too large');
    this.limitBytes = limit?.limitBytes;
    this.limitKind = limit?.limitKind;
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

export class WorkspaceOwnershipConflictError extends Error {
  constructor() {
    super('Workspace ownership changed; reload membership before retrying');
  }
}

export class InvalidWorkspaceInvitationError extends Error {
  constructor() {
    super('Workspace invitation is invalid or expired');
  }
}
