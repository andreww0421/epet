import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppData } from '../src/store/types';
import {
  findPermanentlyDeletedStudentIds,
  purgeStudentsFromWorkspaceData,
} from './studentPrivacy';
import {
  EmailAlreadyExistsError,
  InvalidWorkspaceInvitationError,
  WorkspaceAlreadyClaimedError,
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  WorkspaceMembershipNotFoundError,
  WorkspaceOwnerTransferRequiredError,
  type AuthCleanupResult,
  type AuditEventRecord,
  type AcceptWorkspaceInvitationInput,
  type AuthRateLimitResult,
  type AuthRepository,
  type AuthSessionRecord,
  type AuthUserRecord,
  type ClaimLegacyWorkspaceInput,
  type ConsumeAuthRateLimitInput,
  type ConsumeEmailVerificationInput,
  type ConsumePasswordResetInput,
  type CreateUserWithWorkspaceInput,
  type CreateWorkspaceForUserInput,
  type DeleteUserInput,
  type DeleteWorkspaceInput,
  type EmailVerificationTokenRecord,
  type PasswordResetTokenRecord,
  type StoredWorkspace,
  type UserWorkspaceAccess,
  type WorkspaceMember,
  type WorkspaceInvitationRecord,
  type WorkspaceInvitationSummary,
  type WorkspaceMembershipRecord,
  type RemoveWorkspaceMemberInput,
  type TransferWorkspaceOwnershipInput,
  type UpdateWorkspaceMemberInput,
  type WorkspaceRepository,
  type WorkspaceRevisionSnapshot,
  type WorkspaceRevisionRecord,
  type WorkspaceAuditQuery,
  type WorkspaceClaimRecord,
  type WorkspaceWriteContext,
} from './contracts';

type WorkspaceMetadata = {
  name: string;
  createdAt: number;
};

type AuthRateLimitState = {
  windowStartedAt: number;
  attemptCount: number;
  blockedUntil: number;
};

type DatabaseFile = {
  version: 5;
  workspaces: Record<string, StoredWorkspace>;
  workspaceMetadata: Record<string, WorkspaceMetadata>;
  workspaceRevisions: Record<string, WorkspaceRevisionSnapshot[]>;
  workspaceClaims: Record<string, WorkspaceClaimRecord>;
  users: Record<string, AuthUserRecord>;
  memberships: Record<string, WorkspaceMembershipRecord>;
  workspaceClassAssignments: Record<string, string[]>;
  sessions: Record<string, AuthSessionRecord>;
  passwordResetTokens: Record<string, PasswordResetTokenRecord>;
  emailVerificationTokens: Record<string, EmailVerificationTokenRecord>;
  authRateLimits: Record<string, AuthRateLimitState>;
  auditEvents: AuditEventRecord[];
  workspaceInvitations: Record<string, WorkspaceInvitationRecord>;
};

const createEmptyDatabase = (): DatabaseFile => ({
  version: 5,
  workspaces: {},
  workspaceMetadata: {},
  workspaceRevisions: {},
  workspaceClaims: {},
  users: {},
  memberships: {},
  workspaceClassAssignments: {},
  sessions: {},
  passwordResetTokens: {},
  emailVerificationTokens: {},
  authRateLimits: {},
  auditEvents: [],
  workspaceInvitations: {},
});

const membershipKey = (workspaceId: string, userId: string) =>
  `${workspaceId}:${userId}`;

const normalizeClassIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (classId): classId is string =>
      typeof classId === 'string' && classId.trim().length > 0,
  ))].sort((left, right) => left.localeCompare(right));
};

const workspaceClassIds = (workspace?: StoredWorkspace): string[] =>
  normalizeClassIds(workspace?.data?.classes.map((classroom) => classroom.id));

const rateLimitKey = (scope: string, subjectHash: string) =>
  `${scope}:${subjectHash}`;

const dataSizeBytes = (data: AppData) =>
  new TextEncoder().encode(JSON.stringify(data)).byteLength;

const emptyWorkspace = (): StoredWorkspace => ({
  revision: 0,
  updatedAt: 0,
  data: null,
});

export class JsonWorkspaceRepository
implements WorkspaceRepository, AuthRepository {
  private database: DatabaseFile | null = null;
  private databaseLoad: Promise<DatabaseFile> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async load() {
    if (this.database) return this.database;
    this.databaseLoad ??= this.loadFromFile();
    try {
      return await this.databaseLoad;
    } finally {
      this.databaseLoad = null;
    }
  }

  private async loadFromFile(): Promise<DatabaseFile> {
    try {
      const raw = JSON.parse(
        await readFile(this.filePath, 'utf8'),
      ) as Partial<DatabaseFile>;
      const loadedVersion =
        typeof raw.version === 'number' && Number.isInteger(raw.version)
          ? raw.version
          : 1;
      const database = createEmptyDatabase();
      database.workspaces =
        raw.workspaces && typeof raw.workspaces === 'object'
          ? raw.workspaces as Record<string, StoredWorkspace>
          : {};
      database.workspaceMetadata =
        raw.workspaceMetadata && typeof raw.workspaceMetadata === 'object'
          ? raw.workspaceMetadata as Record<string, WorkspaceMetadata>
          : {};
      database.workspaceRevisions =
        raw.workspaceRevisions && typeof raw.workspaceRevisions === 'object'
          ? raw.workspaceRevisions as Record<string, WorkspaceRevisionSnapshot[]>
          : {};
      database.workspaceClaims =
        raw.workspaceClaims && typeof raw.workspaceClaims === 'object'
          ? raw.workspaceClaims as Record<string, WorkspaceClaimRecord>
          : {};
      database.users =
        raw.users && typeof raw.users === 'object'
          ? raw.users as Record<string, AuthUserRecord>
          : {};
      database.memberships =
        raw.memberships && typeof raw.memberships === 'object'
          ? raw.memberships as Record<string, WorkspaceMembershipRecord>
          : {};
      if (
        raw.workspaceClassAssignments &&
        typeof raw.workspaceClassAssignments === 'object'
      ) {
        for (const [key, classIds] of Object.entries(
          raw.workspaceClassAssignments,
        )) {
          database.workspaceClassAssignments[key] = normalizeClassIds(classIds);
        }
      }
      database.sessions =
        raw.sessions && typeof raw.sessions === 'object'
          ? raw.sessions as Record<string, AuthSessionRecord>
          : {};
      database.passwordResetTokens =
        raw.passwordResetTokens &&
        typeof raw.passwordResetTokens === 'object'
          ? raw.passwordResetTokens as Record<string, PasswordResetTokenRecord>
          : {};
      database.emailVerificationTokens =
        raw.emailVerificationTokens &&
        typeof raw.emailVerificationTokens === 'object'
          ? raw.emailVerificationTokens as Record<
              string,
              EmailVerificationTokenRecord
            >
          : {};
      database.authRateLimits =
        raw.authRateLimits && typeof raw.authRateLimits === 'object'
          ? raw.authRateLimits as Record<string, AuthRateLimitState>
          : {};
      database.auditEvents = Array.isArray(raw.auditEvents)
        ? raw.auditEvents as AuditEventRecord[]
        : [];
      database.workspaceInvitations =
        raw.workspaceInvitations &&
        typeof raw.workspaceInvitations === 'object'
          ? raw.workspaceInvitations as Record<string, WorkspaceInvitationRecord>
          : {};

      for (const user of Object.values(database.users)) {
        if (!Object.prototype.hasOwnProperty.call(user, 'emailVerifiedAt')) {
          user.emailVerifiedAt = user.createdAt;
        }
      }

      for (const [workspaceId, workspace] of Object.entries(
        database.workspaces,
      )) {
        database.workspaceMetadata[workspaceId] ??= {
          name: 'Workspace',
          createdAt: workspace.updatedAt,
        };
        const revisions = Array.isArray(
          database.workspaceRevisions[workspaceId],
        )
          ? database.workspaceRevisions[workspaceId].filter(
              (revision) =>
                revision &&
                typeof revision === 'object' &&
                revision.data &&
                typeof revision.data === 'object',
            )
          : [];
        if (
          workspace.data &&
          !revisions.some(
            (revision) => revision.revision === workspace.revision,
          )
        ) {
          revisions.unshift({
            workspaceId,
            revision: workspace.revision,
            updatedAt: workspace.updatedAt,
            dataSizeBytes: dataSizeBytes(workspace.data),
            data: structuredClone(workspace.data),
          });
        }
        database.workspaceRevisions[workspaceId] = revisions
          .sort((left, right) => right.revision - left.revision)
          .slice(0, 25);
      }
      for (const membership of Object.values(database.memberships)) {
        if (
          membership.role === 'owner' &&
          !database.workspaceClaims[membership.workspaceId]
        ) {
          database.workspaceClaims[membership.workspaceId] = {
            workspaceId: membership.workspaceId,
            claimedByUserId: membership.userId,
            claimedAt: membership.createdAt,
          };
        }
        const key = membershipKey(membership.workspaceId, membership.userId);
        const validClassIds = new Set(
          workspaceClassIds(database.workspaces[membership.workspaceId]),
        );
        if (
          loadedVersion < 3 &&
          (membership.role === 'teacher' || membership.role === 'viewer')
        ) {
          database.workspaceClassAssignments[key] = [...validClassIds].sort(
            (left, right) => left.localeCompare(right),
          );
        } else if (
          Object.prototype.hasOwnProperty.call(
            database.workspaceClassAssignments,
            key,
          )
        ) {
          database.workspaceClassAssignments[key] =
            database.workspaceClassAssignments[key].filter(
              (classId) => validClassIds.has(classId),
            );
        }
      }
      this.database = database;
      if (loadedVersion < 5) await this.persist(database);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.database = createEmptyDatabase();
    }
    if (!this.database) throw new Error('Failed to load workspace database');
    return this.database;
  }

  private async persist(database: DatabaseFile) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(
      temporaryPath,
      JSON.stringify(database, null, 2),
      'utf8',
    );
    await rename(temporaryPath, this.filePath);
  }

  private mutate<T>(
    operation: (database: DatabaseFile) => T | Promise<T>,
  ): Promise<T> {
    const pending = this.mutationQueue.then(async () => {
      const database = await this.load();
      const result = await operation(database);
      await this.persist(database);
      return structuredClone(result);
    });
    this.mutationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async get(workspaceId: string): Promise<StoredWorkspace> {
    await this.mutationQueue;
    const database = await this.load();
    return structuredClone(database.workspaces[workspaceId] ?? emptyWorkspace());
  }

  async put(
    workspaceId: string,
    data: AppData,
    baseRevision?: number,
    context: WorkspaceWriteContext = {},
  ): Promise<StoredWorkspace> {
    return this.mutate((database) => {
      const current = database.workspaces[workspaceId] ?? emptyWorkspace();
      if (
        baseRevision != null &&
        (!Number.isInteger(baseRevision) || baseRevision !== current.revision)
      ) {
        throw new WorkspaceConflictError(structuredClone(current));
      }
      const next: StoredWorkspace = {
        revision: current.revision + 1,
        updatedAt: Date.now(),
        data: structuredClone(data),
      };
      database.workspaces[workspaceId] = next;
      const validClassIds = new Set(workspaceClassIds(next));
      for (const membership of Object.values(database.memberships)) {
        if (membership.workspaceId !== workspaceId) continue;
        const key = membershipKey(workspaceId, membership.userId);
        if (
          !Object.prototype.hasOwnProperty.call(
            database.workspaceClassAssignments,
            key,
          )
        ) continue;
        database.workspaceClassAssignments[key] =
          database.workspaceClassAssignments[key].filter(
            (classId) => validClassIds.has(classId),
          );
      }
      database.workspaceMetadata[workspaceId] ??= {
        name: 'Workspace',
        createdAt: next.updatedAt,
      };
      const deletedStudentIds = findPermanentlyDeletedStudentIds(
        current.data,
        data,
      );
      if (deletedStudentIds.size > 0) {
        database.workspaceRevisions[workspaceId] = (
          database.workspaceRevisions[workspaceId] ?? []
        ).map((snapshot) => {
          const purgedData = purgeStudentsFromWorkspaceData(
            snapshot.data,
            deletedStudentIds,
          );
          return {
            ...snapshot,
            data: purgedData,
            dataSizeBytes: dataSizeBytes(purgedData),
          };
        });
        database.auditEvents.push({
          id: `evt_privacy_student_${workspaceId}_${next.revision}`,
          workspaceId,
          actorUserId: context.actorUserId,
          action: 'privacy.student.purge',
          targetType: 'workspace',
          targetId: workspaceId,
          metadata: { deletedStudentCount: deletedStudentIds.size },
          createdAt: next.updatedAt,
        });
      }
      const revision: WorkspaceRevisionSnapshot = {
        workspaceId,
        revision: next.revision,
        updatedAt: next.updatedAt,
        actorUserId: context.actorUserId,
        dataSizeBytes: dataSizeBytes(data),
        data: structuredClone(data),
      };
      database.workspaceRevisions[workspaceId] = [
        revision,
        ...(database.workspaceRevisions[workspaceId] ?? []).filter(
          (candidate) => candidate.revision !== revision.revision,
        ),
      ].slice(0, 25);
      if (context.action) {
        database.auditEvents.push({
          id:
            context.requestId ??
            `evt_workspace_${workspaceId}_${revision.revision}`,
          workspaceId,
          actorUserId: context.actorUserId,
          action: context.action,
          targetType: 'workspace',
          targetId: workspaceId,
          createdAt: next.updatedAt,
        });
      }
      return next;
    });
  }

  async findUserByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<AuthUserRecord | null> {
    await this.mutationQueue;
    const database = await this.load();
    const user = Object.values(database.users).find(
      (candidate) => candidate.normalizedEmail === normalizedEmail,
    );
    return user ? structuredClone(user) : null;
  }

  async getUserById(userId: string): Promise<AuthUserRecord | null> {
    await this.mutationQueue;
    const database = await this.load();
    return database.users[userId]
      ? structuredClone(database.users[userId])
      : null;
  }

  async createUserWithWorkspace(
    input: CreateUserWithWorkspaceInput,
  ): Promise<void> {
    await this.mutate((database) => {
      if (
        Object.values(database.users).some(
          (user) =>
            user.normalizedEmail === input.user.normalizedEmail,
        )
      ) {
        throw new EmailAlreadyExistsError();
      }
      if (database.workspaces[input.workspace.id]) {
        throw new Error('Workspace id already exists');
      }
      database.users[input.user.id] = structuredClone(input.user);
      if (input.emailVerificationToken) {
        database.emailVerificationTokens[
          input.emailVerificationToken.tokenHash
        ] = structuredClone(input.emailVerificationToken);
      }
      this.insertWorkspace(database, input.workspace, input.membership);
      database.auditEvents.push(structuredClone(input.auditEvent));
    });
  }

  async createWorkspaceForUser(
    input: CreateWorkspaceForUserInput,
  ): Promise<void> {
    await this.mutate((database) => {
      if (!database.users[input.membership.userId]) {
        throw new Error('User does not exist');
      }
      if (database.workspaces[input.workspace.id]) {
        throw new Error('Workspace id already exists');
      }
      this.insertWorkspace(database, input.workspace, input.membership);
      database.auditEvents.push(structuredClone(input.auditEvent));
    });
  }

  private insertWorkspace(
    database: DatabaseFile,
    workspace: CreateWorkspaceForUserInput['workspace'],
    membership: WorkspaceMembershipRecord,
  ) {
    const stored: StoredWorkspace = {
      revision: 1,
      updatedAt: workspace.createdAt,
      data: structuredClone(workspace.data),
    };
    database.workspaces[workspace.id] = stored;
    database.workspaceMetadata[workspace.id] = {
      name: workspace.name,
      createdAt: workspace.createdAt,
    };
    database.workspaceRevisions[workspace.id] = [{
      workspaceId: workspace.id,
      revision: 1,
      updatedAt: workspace.createdAt,
      actorUserId: membership.userId,
      dataSizeBytes: dataSizeBytes(workspace.data),
      data: structuredClone(workspace.data),
    }];
    database.workspaceClaims[workspace.id] = {
      workspaceId: workspace.id,
      claimedByUserId: membership.userId,
      claimedAt: membership.createdAt,
    };
    database.memberships[
      membershipKey(workspace.id, membership.userId)
    ] = structuredClone(membership);
  }

  async listUserWorkspaces(userId: string): Promise<UserWorkspaceAccess[]> {
    await this.mutationQueue;
    const database = await this.load();
    return Object.values(database.memberships)
      .filter((membership) => membership.userId === userId)
      .map((membership) => ({
        id: membership.workspaceId,
        name:
          database.workspaceMetadata[membership.workspaceId]?.name ??
          'Workspace',
        role: membership.role,
        createdAt:
          database.workspaceMetadata[membership.workspaceId]?.createdAt ??
          membership.createdAt,
      }))
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(({ createdAt: _createdAt, ...workspace }) => workspace);
  }

  async getWorkspaceMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRecord | null> {
    await this.mutationQueue;
    const database = await this.load();
    const membership = database.memberships[
      membershipKey(workspaceId, userId)
    ];
    return membership ? structuredClone(membership) : null;
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    await this.mutationQueue;
    const database = await this.load();
    return Object.values(database.memberships)
      .filter((membership) => membership.workspaceId === workspaceId)
      .flatMap((membership) => {
        const user = database.users[membership.userId];
        if (!user) return [];
        return [{
          userId: user.id,
          email: user.email,
          displayName: user.displayName,
          role: membership.role,
          classIds: [...(
            database.workspaceClassAssignments[
              membershipKey(workspaceId, user.id)
            ] ?? []
          )],
          createdAt: membership.createdAt,
        }];
      })
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((member) => structuredClone(member));
  }

  async updateWorkspaceMember(
    input: UpdateWorkspaceMemberInput,
  ): Promise<void> {
    await this.mutate((database) => {
      const key = membershipKey(input.workspaceId, input.userId);
      const membership = database.memberships[key];
      if (!membership || membership.role === 'owner') {
        throw new WorkspaceMembershipNotFoundError();
      }
      membership.role = input.role;
      const validClassIds = new Set(
        workspaceClassIds(database.workspaces[input.workspaceId]),
      );
      database.workspaceClassAssignments[key] =
        input.role === 'teacher' || input.role === 'viewer'
          ? normalizeClassIds(input.classIds).filter((classId) =>
              validClassIds.has(classId))
          : [];
      database.auditEvents.push(structuredClone(input.auditEvent));
    });
  }

  async removeWorkspaceMember(
    input: RemoveWorkspaceMemberInput,
  ): Promise<void> {
    await this.mutate((database) => {
      const key = membershipKey(input.workspaceId, input.userId);
      const membership = database.memberships[key];
      if (!membership || membership.role === 'owner') {
        throw new WorkspaceMembershipNotFoundError();
      }
      delete database.memberships[key];
      delete database.workspaceClassAssignments[key];
      for (const session of Object.values(database.sessions)) {
        if (
          session.userId === input.userId &&
          session.activeWorkspaceId === input.workspaceId
        ) {
          session.activeWorkspaceId = null;
          session.lastSeenAt = input.removedAt;
        }
      }
      database.auditEvents.push(structuredClone(input.auditEvent));
    });
  }

  async transferWorkspaceOwnership(
    input: TransferWorkspaceOwnershipInput,
  ): Promise<void> {
    await this.mutate((database) => {
      const sourceKey = membershipKey(input.workspaceId, input.fromUserId);
      const targetKey = membershipKey(input.workspaceId, input.toUserId);
      const source = database.memberships[sourceKey];
      const target = database.memberships[targetKey];
      if (source?.role !== 'owner' || !target || target.role === 'owner') {
        throw new WorkspaceMembershipNotFoundError();
      }
      source.role = 'admin';
      target.role = 'owner';
      delete database.workspaceClassAssignments[sourceKey];
      delete database.workspaceClassAssignments[targetKey];
      database.workspaceClaims[input.workspaceId] = {
        workspaceId: input.workspaceId,
        claimedByUserId: input.toUserId,
        claimedAt: input.transferredAt,
      };
      database.auditEvents.push(structuredClone(input.auditEvent));
    });
  }

  async deleteWorkspace(input: DeleteWorkspaceInput): Promise<void> {
    await this.mutate((database) => {
      if (!database.workspaces[input.workspaceId]) {
        throw new WorkspaceNotFoundError();
      }
      delete database.workspaces[input.workspaceId];
      delete database.workspaceMetadata[input.workspaceId];
      delete database.workspaceRevisions[input.workspaceId];
      delete database.workspaceClaims[input.workspaceId];
      for (const [key, membership] of Object.entries(database.memberships)) {
        if (membership.workspaceId !== input.workspaceId) continue;
        delete database.memberships[key];
        delete database.workspaceClassAssignments[key];
      }
      for (const session of Object.values(database.sessions)) {
        if (session.activeWorkspaceId === input.workspaceId) {
          session.activeWorkspaceId = null;
          session.lastSeenAt = input.deletedAt;
        }
      }
      for (const [id, invitation] of Object.entries(database.workspaceInvitations)) {
        if (invitation.workspaceId === input.workspaceId) {
          delete database.workspaceInvitations[id];
        }
      }
      database.auditEvents = database.auditEvents.filter(
        (event) => event.workspaceId !== input.workspaceId,
      );
      database.auditEvents.push(structuredClone(input.auditEvent));
    });
  }

  async deleteUser(input: DeleteUserInput): Promise<void> {
    await this.mutate((database) => {
      if (!database.users[input.userId]) return;
      if (Object.values(database.memberships).some(
        (membership) =>
          membership.userId === input.userId && membership.role === 'owner',
      )) {
        throw new WorkspaceOwnerTransferRequiredError();
      }
      if (Object.values(database.workspaceClaims).some(
        (claim) => claim.claimedByUserId === input.userId,
      )) {
        throw new WorkspaceOwnerTransferRequiredError();
      }
      delete database.users[input.userId];
      for (const [key, membership] of Object.entries(database.memberships)) {
        if (membership.userId !== input.userId) continue;
        delete database.memberships[key];
        delete database.workspaceClassAssignments[key];
      }
      for (const [key, session] of Object.entries(database.sessions)) {
        if (session.userId === input.userId) delete database.sessions[key];
      }
      for (const [key, token] of Object.entries(database.passwordResetTokens)) {
        if (token.userId === input.userId) delete database.passwordResetTokens[key];
      }
      for (const [key, token] of Object.entries(database.emailVerificationTokens)) {
        if (token.userId === input.userId) {
          delete database.emailVerificationTokens[key];
        }
      }
      for (const [id, invitation] of Object.entries(database.workspaceInvitations)) {
        if (invitation.createdByUserId === input.userId) {
          delete database.workspaceInvitations[id];
        } else if (invitation.acceptedByUserId === input.userId) {
          invitation.acceptedByUserId = undefined;
        }
      }
      database.auditEvents = database.auditEvents.map((event) =>
        event.actorUserId === input.userId
          ? { ...event, actorUserId: undefined }
          : event,
      );
      database.auditEvents.push(structuredClone(input.auditEvent));
    });
  }

  async cleanupExpiredAuthData(now: number): Promise<AuthCleanupResult> {
    return this.mutate((database) => {
      let sessions = 0;
      let passwordResetTokens = 0;
      let emailVerificationTokens = 0;
      let rateLimits = 0;
      let invitations = 0;
      for (const [key, session] of Object.entries(database.sessions)) {
        if (session.expiresAt > now && session.revokedAt == null) continue;
        delete database.sessions[key];
        sessions += 1;
      }
      for (const [key, token] of Object.entries(database.passwordResetTokens)) {
        if (token.expiresAt > now && token.usedAt == null) continue;
        delete database.passwordResetTokens[key];
        passwordResetTokens += 1;
      }
      for (const [key, token] of Object.entries(database.emailVerificationTokens)) {
        if (token.expiresAt > now && token.usedAt == null) continue;
        delete database.emailVerificationTokens[key];
        emailVerificationTokens += 1;
      }
      for (const [key, limit] of Object.entries(database.authRateLimits)) {
        if (limit.blockedUntil > now || limit.windowStartedAt + 86_400_000 > now) {
          continue;
        }
        delete database.authRateLimits[key];
        rateLimits += 1;
      }
      for (const [id, invitation] of Object.entries(database.workspaceInvitations)) {
        if (
          invitation.expiresAt > now &&
          invitation.acceptedAt == null &&
          invitation.revokedAt == null
        ) continue;
        delete database.workspaceInvitations[id];
        invitations += 1;
      }
      return {
        sessions,
        passwordResetTokens,
        emailVerificationTokens,
        rateLimits,
        invitations,
      };
    });
  }

  async createWorkspaceInvitation(
    invitation: WorkspaceInvitationRecord,
  ): Promise<void> {
    await this.mutate((database) => {
      for (const existing of Object.values(database.workspaceInvitations)) {
        if (
          existing.workspaceId === invitation.workspaceId &&
          existing.normalizedEmail === invitation.normalizedEmail &&
          existing.acceptedAt == null &&
          existing.revokedAt == null
        ) {
          existing.revokedAt = invitation.createdAt;
        }
      }
      database.workspaceInvitations[invitation.id] = structuredClone(invitation);
    });
  }

  async getWorkspaceInvitationByTokenHash(
    tokenHash: string,
  ): Promise<WorkspaceInvitationRecord | null> {
    await this.mutationQueue;
    const database = await this.load();
    const invitation = Object.values(database.workspaceInvitations).find(
      (candidate) => candidate.tokenHash === tokenHash,
    );
    return invitation ? structuredClone(invitation) : null;
  }

  async listWorkspaceInvitations(
    workspaceId: string,
  ): Promise<WorkspaceInvitationSummary[]> {
    await this.mutationQueue;
    const database = await this.load();
    return Object.values(database.workspaceInvitations)
      .filter((invitation) => invitation.workspaceId === workspaceId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(({ tokenHash: _tokenHash, ...summary }) => structuredClone(summary));
  }

  async revokeWorkspaceInvitation(
    workspaceId: string,
    invitationId: string,
    revokedAt: number,
    auditEvent: AuditEventRecord,
  ): Promise<void> {
    await this.mutate((database) => {
      const invitation = database.workspaceInvitations[invitationId];
      if (
        !invitation ||
        invitation.workspaceId !== workspaceId ||
        invitation.acceptedAt != null ||
        invitation.revokedAt != null
      ) throw new InvalidWorkspaceInvitationError();
      invitation.revokedAt = revokedAt;
      database.auditEvents.push(structuredClone(auditEvent));
    });
  }

  async acceptWorkspaceInvitation(
    input: AcceptWorkspaceInvitationInput,
  ): Promise<void> {
    await this.mutate((database) => {
      const invitation = database.workspaceInvitations[input.invitation.id];
      if (
        !invitation ||
        invitation.tokenHash !== input.tokenHash ||
        invitation.acceptedAt != null ||
        invitation.revokedAt != null ||
        invitation.expiresAt <= input.acceptedAt
      ) throw new InvalidWorkspaceInvitationError();
      if (input.createUser) {
        if (Object.values(database.users).some(
          (user) => user.normalizedEmail === input.user.normalizedEmail,
        )) throw new EmailAlreadyExistsError();
        database.users[input.user.id] = structuredClone(input.user);
      } else if (!database.users[input.user.id]) {
        throw new InvalidWorkspaceInvitationError();
      } else if (database.users[input.user.id].emailVerifiedAt == null) {
        database.users[input.user.id].emailVerifiedAt = input.acceptedAt;
        database.users[input.user.id].updatedAt = input.acceptedAt;
      }
      const key = membershipKey(input.membership.workspaceId, input.user.id);
      if (database.memberships[key]) {
        throw new InvalidWorkspaceInvitationError();
      }
      database.memberships[key] = structuredClone(input.membership);
      const validClassIds = new Set(
        workspaceClassIds(database.workspaces[input.membership.workspaceId]),
      );
      database.workspaceClassAssignments[key] =
        input.membership.role === 'teacher' || input.membership.role === 'viewer'
          ? invitation.classIds.filter((classId) => validClassIds.has(classId))
          : [];
      invitation.acceptedAt = input.acceptedAt;
      invitation.acceptedByUserId = input.user.id;
      database.auditEvents.push(structuredClone(input.auditEvent));
    });
  }

  async listWorkspaceClassIds(
    workspaceId: string,
    userId: string,
  ): Promise<string[]> {
    await this.mutationQueue;
    const database = await this.load();
    const key = membershipKey(workspaceId, userId);
    const membership = database.memberships[key];
    if (
      !membership ||
      (membership.role !== 'teacher' && membership.role !== 'viewer')
    ) return [];
    const validClassIds = new Set(
      workspaceClassIds(database.workspaces[workspaceId]),
    );
    return database.workspaceClassAssignments[key]?.filter(
      (classId) => validClassIds.has(classId),
    ) ?? [];
  }

  async claimLegacyWorkspace(
    input: ClaimLegacyWorkspaceInput,
  ): Promise<WorkspaceMembershipRecord> {
    return this.mutate((database) => {
      if (!database.workspaces[input.workspaceId]) {
        throw new WorkspaceNotFoundError();
      }
      const claim = database.workspaceClaims[input.workspaceId];
      if (claim && claim.claimedByUserId !== input.userId) {
        throw new WorkspaceAlreadyClaimedError();
      }
      const existingForUser = database.memberships[
        membershipKey(input.workspaceId, input.userId)
      ];
      if (existingForUser) return existingForUser;
      database.workspaceClaims[input.workspaceId] ??= {
        workspaceId: input.workspaceId,
        claimedByUserId: input.userId,
        claimedAt: input.createdAt,
      };
      const membership: WorkspaceMembershipRecord = {
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: 'owner',
        createdAt: input.createdAt,
        createdByUserId: input.userId,
      };
      database.memberships[
        membershipKey(input.workspaceId, input.userId)
      ] = membership;
      database.auditEvents.push(structuredClone(input.auditEvent));
      return membership;
    });
  }

  async createAuthSession(session: AuthSessionRecord): Promise<void> {
    await this.mutate((database) => {
      if (!database.users[session.userId]) {
        throw new Error('User does not exist');
      }
      database.sessions[session.tokenHash] = structuredClone(session);
    });
  }

  async getAuthSessionByTokenHash(
    tokenHash: string,
  ): Promise<AuthSessionRecord | null> {
    await this.mutationQueue;
    const database = await this.load();
    const session = database.sessions[tokenHash];
    return session ? structuredClone(session) : null;
  }

  async setAuthSessionActiveWorkspace(
    tokenHash: string,
    workspaceId: string,
  ): Promise<void> {
    await this.mutate((database) => {
      const session = database.sessions[tokenHash];
      if (!session) return;
      if (
        !database.memberships[membershipKey(workspaceId, session.userId)]
      ) {
        throw new WorkspaceNotFoundError();
      }
      session.activeWorkspaceId = workspaceId;
      session.lastSeenAt = Date.now();
    });
  }

  async revokeAuthSession(
    tokenHash: string,
    revokedAt: number,
  ): Promise<void> {
    await this.mutate((database) => {
      const session = database.sessions[tokenHash];
      if (session && session.revokedAt == null) session.revokedAt = revokedAt;
    });
  }

  async revokeAllAuthSessions(
    userId: string,
    revokedAt: number,
  ): Promise<void> {
    await this.mutate((database) => {
      for (const session of Object.values(database.sessions)) {
        if (session.userId === userId && session.revokedAt == null) {
          session.revokedAt = revokedAt;
        }
      }
    });
  }

  async createPasswordResetToken(
    token: PasswordResetTokenRecord,
  ): Promise<void> {
    await this.mutate((database) => {
      for (const existing of Object.values(database.passwordResetTokens)) {
        if (existing.userId === token.userId && existing.usedAt == null) {
          existing.usedAt = token.createdAt;
        }
      }
      database.passwordResetTokens[token.tokenHash] =
        structuredClone(token);
    });
  }

  async consumePasswordResetToken(
    input: ConsumePasswordResetInput,
  ): Promise<AuthUserRecord | null> {
    return this.mutate((database) => {
      const token = database.passwordResetTokens[input.tokenHash];
      if (
        !token ||
        token.usedAt != null ||
        token.expiresAt <= input.usedAt
      ) {
        return null;
      }
      const user = database.users[token.userId];
      if (!user || user.status !== 'active') return null;
      token.usedAt = input.usedAt;
      user.password = structuredClone(input.password);
      user.updatedAt = input.usedAt;
      user.passwordChangedAt = input.usedAt;
      user.emailVerifiedAt ??= input.usedAt;
      for (const session of Object.values(database.sessions)) {
        if (session.userId === user.id && session.revokedAt == null) {
          session.revokedAt = input.usedAt;
        }
      }
      return user;
    });
  }

  async createEmailVerificationToken(
    token: EmailVerificationTokenRecord,
  ): Promise<void> {
    await this.mutate((database) => {
      const user = database.users[token.userId];
      if (!user || user.status !== 'active' || user.emailVerifiedAt != null) {
        return;
      }
      for (const existing of Object.values(database.emailVerificationTokens)) {
        if (existing.userId === token.userId && existing.usedAt == null) {
          existing.usedAt = token.createdAt;
        }
      }
      database.emailVerificationTokens[token.tokenHash] =
        structuredClone(token);
    });
  }

  async consumeEmailVerificationToken(
    input: ConsumeEmailVerificationInput,
  ): Promise<AuthUserRecord | null> {
    return this.mutate((database) => {
      const token = database.emailVerificationTokens[input.tokenHash];
      if (
        !token ||
        token.usedAt != null ||
        token.expiresAt <= input.verifiedAt
      ) return null;
      const user = database.users[token.userId];
      if (
        !user ||
        user.status !== 'active' ||
        user.emailVerifiedAt != null
      ) return null;
      token.usedAt = input.verifiedAt;
      user.emailVerifiedAt ??= input.verifiedAt;
      user.updatedAt = input.verifiedAt;
      for (const candidate of Object.values(database.emailVerificationTokens)) {
        if (candidate.userId === user.id && candidate.usedAt == null) {
          candidate.usedAt = input.verifiedAt;
        }
      }
      return user;
    });
  }

  async consumeAuthRateLimit(
    input: ConsumeAuthRateLimitInput,
  ): Promise<AuthRateLimitResult> {
    return this.mutate((database) => {
      const key = rateLimitKey(input.scope, input.subjectHash);
      const current = database.authRateLimits[key];
      if (current && current.blockedUntil > input.now) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: current.blockedUntil - input.now,
        };
      }
      const outsideWindow =
        !current ||
        input.now >= current.windowStartedAt + input.windowMs;
      const next: AuthRateLimitState = outsideWindow
        ? {
            windowStartedAt: input.now,
            attemptCount: 1,
            blockedUntil: 0,
          }
        : {
            ...current,
            attemptCount: current.attemptCount + 1,
          };
      const allowed = next.attemptCount <= input.maxAttempts;
      if (!allowed) next.blockedUntil = input.now + input.blockMs;
      database.authRateLimits[key] = next;
      return {
        allowed,
        remaining: Math.max(0, input.maxAttempts - next.attemptCount),
        retryAfterMs: allowed ? 0 : input.blockMs,
      };
    });
  }

  async appendAuditEvent(event: AuditEventRecord): Promise<void> {
    await this.mutate((database) => {
      database.auditEvents.push(structuredClone(event));
    });
  }

  async listWorkspaceAuditEvents(
    workspaceId: string,
    query: WorkspaceAuditQuery = {},
  ): Promise<AuditEventRecord[]> {
    await this.mutationQueue;
    const database = await this.load();
    const safeLimit = Math.max(
      1,
      Math.min(201, Math.floor(query.limit ?? 50)),
    );
    return database.auditEvents
      .filter((event) => event.workspaceId === workspaceId)
      .filter((event) => !query.action || event.action === query.action)
      .filter((event) =>
        !query.actorUserId || event.actorUserId === query.actorUserId
      )
      .filter((event) =>
        !query.targetType || event.targetType === query.targetType
      )
      .filter((event) =>
        query.fromCreatedAt == null || event.createdAt >= query.fromCreatedAt
      )
      .filter((event) =>
        query.toCreatedAt == null || event.createdAt <= query.toCreatedAt
      )
      .filter((event) => !query.cursor ||
        event.createdAt < query.cursor.createdAt ||
        (
          event.createdAt === query.cursor.createdAt &&
          event.id < query.cursor.id
        ))
      .slice()
      .sort((left, right) =>
        right.createdAt - left.createdAt || right.id.localeCompare(left.id)
      )
      .slice(0, safeLimit)
      .map((event) => structuredClone(event));
  }

  async listWorkspaceRevisions(
    workspaceId: string,
    limit = 50,
  ): Promise<WorkspaceRevisionRecord[]> {
    await this.mutationQueue;
    const database = await this.load();
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    return (database.workspaceRevisions[workspaceId] ?? [])
      .slice()
      .sort((left, right) => right.revision - left.revision)
      .slice(0, safeLimit)
      .map(({ data: _data, ...revision }) => structuredClone(revision));
  }

  async getWorkspaceRevision(
    workspaceId: string,
    revision: number,
  ): Promise<WorkspaceRevisionSnapshot | null> {
    await this.mutationQueue;
    const database = await this.load();
    const snapshot = (database.workspaceRevisions[workspaceId] ?? []).find(
      (candidate) => candidate.revision === revision,
    );
    return snapshot ? structuredClone(snapshot) : null;
  }
}
