import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppData } from '../src/store/types';
import {
  EmailAlreadyExistsError,
  WorkspaceAlreadyClaimedError,
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  type AuditEventRecord,
  type AuthRateLimitResult,
  type AuthRepository,
  type AuthSessionRecord,
  type AuthUserRecord,
  type ClaimLegacyWorkspaceInput,
  type ConsumeAuthRateLimitInput,
  type ConsumePasswordResetInput,
  type CreateUserWithWorkspaceInput,
  type CreateWorkspaceForUserInput,
  type PasswordResetTokenRecord,
  type StoredWorkspace,
  type UserWorkspaceAccess,
  type WorkspaceMembershipRecord,
  type WorkspaceRepository,
  type WorkspaceRevisionSnapshot,
  type WorkspaceRevisionRecord,
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
  version: 3;
  workspaces: Record<string, StoredWorkspace>;
  workspaceMetadata: Record<string, WorkspaceMetadata>;
  workspaceRevisions: Record<string, WorkspaceRevisionSnapshot[]>;
  workspaceClaims: Record<string, WorkspaceClaimRecord>;
  users: Record<string, AuthUserRecord>;
  memberships: Record<string, WorkspaceMembershipRecord>;
  workspaceClassAssignments: Record<string, string[]>;
  sessions: Record<string, AuthSessionRecord>;
  passwordResetTokens: Record<string, PasswordResetTokenRecord>;
  authRateLimits: Record<string, AuthRateLimitState>;
  auditEvents: AuditEventRecord[];
};

const createEmptyDatabase = (): DatabaseFile => ({
  version: 3,
  workspaces: {},
  workspaceMetadata: {},
  workspaceRevisions: {},
  workspaceClaims: {},
  users: {},
  memberships: {},
  workspaceClassAssignments: {},
  sessions: {},
  passwordResetTokens: {},
  authRateLimits: {},
  auditEvents: [],
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
      database.authRateLimits =
        raw.authRateLimits && typeof raw.authRateLimits === 'object'
          ? raw.authRateLimits as Record<string, AuthRateLimitState>
          : {};
      database.auditEvents = Array.isArray(raw.auditEvents)
        ? raw.auditEvents as AuditEventRecord[]
        : [];

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
      if (loadedVersion < 3) await this.persist(database);
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
      for (const session of Object.values(database.sessions)) {
        if (session.userId === user.id && session.revokedAt == null) {
          session.revokedAt = input.usedAt;
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
