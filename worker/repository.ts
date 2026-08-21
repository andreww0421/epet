import type {
  D1Database,
  D1PreparedStatement,
} from '@cloudflare/workers-types';
import type { AppData } from '../src/store/types';
import {
  EmailAlreadyExistsError,
  WorkspaceAlreadyClaimedError,
  WorkspaceConflictError,
  WorkspaceDataTooLargeError,
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
  type WorkspaceRevisionRecord,
  type WorkspaceRevisionSnapshot,
  type WorkspaceWriteContext,
} from '../server/contracts';

const MAX_D1_STATE_BYTES = 900 * 1024;
const MAX_STORED_REVISIONS = 25;

type WorkspaceRow = {
  revision: number;
  updated_at: number;
  data_json: string;
};

type UserRow = {
  user_id: string;
  email: string;
  email_normalized: string;
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

type MembershipRow = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceMembershipRecord['role'];
  created_at: number;
  created_by_user_id: string | null;
};

type UserWorkspaceRow = {
  workspace_id: string;
  name: string;
  role: UserWorkspaceAccess['role'];
};

type SessionRow = {
  token_hash: string;
  user_id: string;
  active_workspace_id: string | null;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  revoked_at: number | null;
};

type ClaimRow = {
  workspace_id: string;
  claimed_by_user_id: string;
  claimed_at: number;
};

type RateLimitRow = {
  window_started_at: number;
  attempt_count: number;
  blocked_until: number;
};

type RevisionRow = {
  workspace_id: string;
  revision: number;
  updated_at: number;
  actor_user_id: string | null;
  data_size_bytes: number;
};

type RevisionSnapshotRow = RevisionRow & {
  data_json: string;
};

const emptyWorkspace = (): StoredWorkspace => ({
  revision: 0,
  updatedAt: 0,
  data: null,
});

const decodeWorkspace = (row: WorkspaceRow | null): StoredWorkspace => {
  if (!row) return emptyWorkspace();
  return {
    revision: row.revision,
    updatedAt: row.updated_at,
    data: JSON.parse(row.data_json) as AppData,
  };
};

const decodeUser = (row: UserRow | null): AuthUserRecord | null => {
  if (!row) return null;
  return {
    id: row.user_id,
    email: row.email,
    normalizedEmail: row.email_normalized,
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

const decodeMembership = (
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

const decodeSession = (row: SessionRow | null): AuthSessionRecord | null => {
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

const decodeRevision = (row: RevisionRow): WorkspaceRevisionRecord => ({
  workspaceId: row.workspace_id,
  revision: row.revision,
  updatedAt: row.updated_at,
  actorUserId: row.actor_user_id ?? undefined,
  dataSizeBytes: row.data_size_bytes,
});

const serializeWorkspace = (data: AppData) => {
  const dataJson = JSON.stringify(data);
  const dataSizeBytes = new TextEncoder().encode(dataJson).byteLength;
  if (dataSizeBytes > MAX_D1_STATE_BYTES) {
    throw new WorkspaceDataTooLargeError();
  }
  return { dataJson, dataSizeBytes };
};

const auditMetadataJson = (event: AuditEventRecord) =>
  JSON.stringify(event.metadata ?? {});

const createProjectionWriteToken = () => crypto.randomUUID();

export class D1WorkspaceRepository
implements WorkspaceRepository, AuthRepository {
  constructor(private readonly database: D1Database) {}

  async get(workspaceId: string): Promise<StoredWorkspace> {
    const row = await this.database
      .prepare(
        `SELECT revision, updated_at, data_json
         FROM workspaces
         WHERE workspace_id = ?`,
      )
      .bind(workspaceId)
      .first<WorkspaceRow>();
    return decodeWorkspace(row);
  }

  async put(
    workspaceId: string,
    data: AppData,
    baseRevision?: number,
    context: WorkspaceWriteContext = {},
  ): Promise<StoredWorkspace> {
    const { dataJson } = serializeWorkspace(data);
    const current = await this.get(workspaceId);
    const expectedRevision = baseRevision ?? current.revision;
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision !== current.revision
    ) {
      throw new WorkspaceConflictError(current);
    }

    const updatedAt = Date.now();
    const nextRevision = current.revision + 1;
    const writeToken = createProjectionWriteToken();
    const writeStatement = current.revision === 0
      ? this.database
          .prepare(
            `INSERT OR IGNORE INTO workspaces
               (workspace_id, revision, updated_at, data_json)
             VALUES (?, 1, ?, ?)`,
          )
          .bind(workspaceId, updatedAt, dataJson)
      : this.database
          .prepare(
            `UPDATE workspaces
             SET revision = revision + 1, updated_at = ?, data_json = ?
             WHERE workspace_id = ? AND revision = ?`,
          )
          .bind(updatedAt, dataJson, workspaceId, expectedRevision);

    const statements: D1PreparedStatement[] = [
      writeStatement,
      this.projectionGateStatement(
        workspaceId,
        nextRevision,
        writeToken,
        updatedAt,
        true,
      ),
      this.database
        .prepare(
          `UPDATE workspace_revisions
           SET actor_user_id = ?
           WHERE
             workspace_id = ? AND
             revision = ? AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = ? AND
                 source_revision = ? AND
                 write_token = ?
             )`,
        )
        .bind(
          context.actorUserId ?? null,
          workspaceId,
          nextRevision,
          workspaceId,
          nextRevision,
          writeToken,
        ),
      ...this.projectionStatements(workspaceId, nextRevision, writeToken),
      this.workspaceAuditStatement(
        workspaceId,
        nextRevision,
        updatedAt,
        context,
        writeToken,
      ),
    ];

    const [writeResult] = await this.database.batch(statements);
    // D1 includes writes performed by the workspace revision trigger in the
    // statement's change count, so a successful workspace write can report
    // more than one changed row. Zero remains the compare-and-swap failure.
    if ((writeResult.meta.changes ?? 0) < 1) {
      throw new WorkspaceConflictError(await this.get(workspaceId));
    }

    return {
      revision: nextRevision,
      updatedAt,
      data,
    };
  }

  async findUserByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<AuthUserRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT
           user_id,
           email,
           email_normalized,
           display_name,
           status,
           password_algorithm,
           password_salt,
           password_hash,
           password_iterations,
           created_at,
           updated_at,
           password_changed_at
         FROM users
         WHERE email_normalized = ?`,
      )
      .bind(normalizedEmail)
      .first<UserRow>();
    return decodeUser(row);
  }

  async getUserById(userId: string): Promise<AuthUserRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT
           user_id,
           email,
           email_normalized,
           display_name,
           status,
           password_algorithm,
           password_salt,
           password_hash,
           password_iterations,
           created_at,
           updated_at,
           password_changed_at
         FROM users
         WHERE user_id = ?`,
      )
      .bind(userId)
      .first<UserRow>();
    return decodeUser(row);
  }

  async createUserWithWorkspace(
    input: CreateUserWithWorkspaceInput,
  ): Promise<void> {
    if (
      await this.findUserByNormalizedEmail(input.user.normalizedEmail)
    ) {
      throw new EmailAlreadyExistsError();
    }
    const { dataJson } = serializeWorkspace(input.workspace.data);
    const { user, workspace, membership, auditEvent } = input;
    const projectionWriteToken = createProjectionWriteToken();

    try {
      await this.database.batch([
        this.database
          .prepare(
            `INSERT INTO users (
               user_id,
               email,
               email_normalized,
               display_name,
               status,
               password_algorithm,
               password_salt,
               password_hash,
               password_iterations,
               created_at,
               updated_at,
               password_changed_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            user.id,
            user.email,
            user.normalizedEmail,
            user.displayName,
            user.status,
            user.password.algorithm,
            user.password.salt,
            user.password.hash,
            user.password.iterations,
            user.createdAt,
            user.updatedAt,
            user.passwordChangedAt,
          ),
        this.database
          .prepare(
            `INSERT INTO workspaces (
               workspace_id,
               revision,
               updated_at,
               data_json,
               name,
               created_at
             )
             VALUES (?, 1, ?, ?, ?, ?)`,
          )
          .bind(
            workspace.id,
            workspace.createdAt,
            dataJson,
            workspace.name,
            workspace.createdAt,
          ),
        this.projectionGateStatement(
          workspace.id,
          1,
          projectionWriteToken,
          workspace.createdAt,
          false,
        ),
        ...this.projectionStatements(
          workspace.id,
          1,
          projectionWriteToken,
        ),
        this.database
          .prepare(
            `UPDATE workspace_revisions
             SET actor_user_id = ?
             WHERE workspace_id = ? AND revision = 1`,
          )
          .bind(membership.userId, workspace.id),
        this.database
          .prepare(
            `INSERT INTO workspace_claims (
               workspace_id,
               claimed_by_user_id,
               claimed_at
             )
             VALUES (?, ?, ?)`,
          )
          .bind(workspace.id, membership.userId, membership.createdAt),
        this.database
          .prepare(
            `INSERT INTO workspace_memberships (
               workspace_id,
               user_id,
               role,
               created_at,
               created_by_user_id
             )
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            membership.workspaceId,
            membership.userId,
            membership.role,
            membership.createdAt,
            membership.createdByUserId ?? null,
          ),
        this.auditStatement(auditEvent),
      ]);
    } catch (error) {
      if (
        await this.findUserByNormalizedEmail(user.normalizedEmail)
      ) {
        throw new EmailAlreadyExistsError();
      }
      throw error;
    }
  }

  async createWorkspaceForUser(
    input: CreateWorkspaceForUserInput,
  ): Promise<void> {
    const { dataJson } = serializeWorkspace(input.workspace.data);
    const { workspace, membership, auditEvent } = input;
    const projectionWriteToken = createProjectionWriteToken();
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO workspaces (
             workspace_id,
             revision,
             updated_at,
             data_json,
             name,
             created_at
           )
           VALUES (?, 1, ?, ?, ?, ?)`,
        )
        .bind(
          workspace.id,
          workspace.createdAt,
          dataJson,
          workspace.name,
          workspace.createdAt,
        ),
      this.projectionGateStatement(
        workspace.id,
        1,
        projectionWriteToken,
        workspace.createdAt,
        false,
      ),
      ...this.projectionStatements(
        workspace.id,
        1,
        projectionWriteToken,
      ),
      this.database
        .prepare(
          `UPDATE workspace_revisions
           SET actor_user_id = ?
           WHERE workspace_id = ? AND revision = 1`,
        )
        .bind(membership.userId, workspace.id),
      this.database
        .prepare(
          `INSERT INTO workspace_claims (
             workspace_id,
             claimed_by_user_id,
             claimed_at
           )
           VALUES (?, ?, ?)`,
        )
        .bind(workspace.id, membership.userId, membership.createdAt),
      this.database
        .prepare(
          `INSERT INTO workspace_memberships (
             workspace_id,
             user_id,
             role,
             created_at,
             created_by_user_id
           )
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          membership.workspaceId,
          membership.userId,
          membership.role,
          membership.createdAt,
          membership.createdByUserId ?? null,
        ),
      this.auditStatement(auditEvent),
    ]);
  }

  async listUserWorkspaces(userId: string): Promise<UserWorkspaceAccess[]> {
    const result = await this.database
      .prepare(
        `SELECT
           memberships.workspace_id,
           workspaces.name,
           memberships.role
         FROM workspace_memberships AS memberships
         INNER JOIN workspaces
           ON workspaces.workspace_id = memberships.workspace_id
         WHERE memberships.user_id = ?
         ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC`,
      )
      .bind(userId)
      .all<UserWorkspaceRow>();
    return result.results.map((row) => ({
      id: row.workspace_id,
      name: row.name,
      role: row.role,
    }));
  }

  async getWorkspaceMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT
           workspace_id,
           user_id,
           role,
           created_at,
           created_by_user_id
         FROM workspace_memberships
         WHERE workspace_id = ? AND user_id = ?`,
      )
      .bind(workspaceId, userId)
      .first<MembershipRow>();
    return decodeMembership(row);
  }

  async listWorkspaceClassIds(
    workspaceId: string,
    userId: string,
  ): Promise<string[]> {
    const result = await this.database
      .prepare(
        `SELECT assignments.class_id
         FROM workspace_class_assignments AS assignments
         INNER JOIN workspace_memberships AS memberships
           ON memberships.workspace_id = assignments.workspace_id
           AND memberships.user_id = assignments.user_id
           AND memberships.role IN ('teacher', 'viewer')
         INNER JOIN classes
           ON classes.workspace_id = assignments.workspace_id
           AND classes.class_id = assignments.class_id
         WHERE assignments.workspace_id = ? AND assignments.user_id = ?
         ORDER BY assignments.class_id ASC`,
      )
      .bind(workspaceId, userId)
      .all<{ class_id: string }>();
    return result.results.map((row) => row.class_id);
  }

  async claimLegacyWorkspace(
    input: ClaimLegacyWorkspaceInput,
  ): Promise<WorkspaceMembershipRecord> {
    const existingWorkspace = await this.database
      .prepare(
        `SELECT workspace_id
         FROM workspaces
         WHERE workspace_id = ?`,
      )
      .bind(input.workspaceId)
      .first<{ workspace_id: string }>();
    if (!existingWorkspace) throw new WorkspaceNotFoundError();

    await this.database.batch([
      this.database
        .prepare(
          `INSERT OR IGNORE INTO workspace_claims (
             workspace_id,
             claimed_by_user_id,
             claimed_at
           )
           SELECT ?, ?, ?
           WHERE EXISTS (
             SELECT 1
             FROM workspaces
             WHERE workspace_id = ?
           )`,
        )
        .bind(
          input.workspaceId,
          input.userId,
          input.createdAt,
          input.workspaceId,
        ),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO workspace_memberships (
             workspace_id,
             user_id,
             role,
             created_at,
             created_by_user_id
           )
           SELECT ?, ?, 'owner', ?, ?
           WHERE EXISTS (
             SELECT 1
             FROM workspace_claims
             WHERE workspace_id = ? AND claimed_by_user_id = ?
           )`,
        )
        .bind(
          input.workspaceId,
          input.userId,
          input.createdAt,
          input.userId,
          input.workspaceId,
          input.userId,
        ),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO audit_events (
             event_id,
             workspace_id,
             actor_user_id,
             action,
             target_type,
             target_id,
             metadata_json,
             created_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
           WHERE changes() = 1`,
        )
        .bind(
          input.auditEvent.id,
          input.auditEvent.workspaceId ?? null,
          input.auditEvent.actorUserId ?? null,
          input.auditEvent.action,
          input.auditEvent.targetType ?? null,
          input.auditEvent.targetId ?? null,
          auditMetadataJson(input.auditEvent),
          input.auditEvent.createdAt,
        ),
    ]);

    const claim = await this.database
      .prepare(
        `SELECT workspace_id, claimed_by_user_id, claimed_at
         FROM workspace_claims
         WHERE workspace_id = ?`,
      )
      .bind(input.workspaceId)
      .first<ClaimRow>();
    if (!claim) throw new WorkspaceNotFoundError();
    if (claim.claimed_by_user_id !== input.userId) {
      throw new WorkspaceAlreadyClaimedError();
    }

    const membership = await this.getWorkspaceMembership(
      input.workspaceId,
      input.userId,
    );
    if (!membership) {
      throw new Error('Workspace claim did not create a membership');
    }
    return membership;
  }

  async createAuthSession(session: AuthSessionRecord): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO auth_sessions (
           token_hash,
           user_id,
           active_workspace_id,
           created_at,
           expires_at,
           last_seen_at,
           revoked_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        session.tokenHash,
        session.userId,
        session.activeWorkspaceId,
        session.createdAt,
        session.expiresAt,
        session.lastSeenAt,
        session.revokedAt,
      )
      .run();
  }

  async getAuthSessionByTokenHash(
    tokenHash: string,
  ): Promise<AuthSessionRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT
           token_hash,
           user_id,
           active_workspace_id,
           created_at,
           expires_at,
           last_seen_at,
           revoked_at
         FROM auth_sessions
         WHERE token_hash = ?`,
      )
      .bind(tokenHash)
      .first<SessionRow>();
    return decodeSession(row);
  }

  async setAuthSessionActiveWorkspace(
    tokenHash: string,
    workspaceId: string,
  ): Promise<void> {
    const session = await this.getAuthSessionByTokenHash(tokenHash);
    if (!session) return;
    const membership = await this.getWorkspaceMembership(
      workspaceId,
      session.userId,
    );
    if (!membership) throw new WorkspaceNotFoundError();
    await this.database
      .prepare(
        `UPDATE auth_sessions
         SET active_workspace_id = ?, last_seen_at = ?
         WHERE token_hash = ?`,
      )
      .bind(workspaceId, Date.now(), tokenHash)
      .run();
  }

  async revokeAuthSession(
    tokenHash: string,
    revokedAt: number,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE auth_sessions
         SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .bind(revokedAt, tokenHash)
      .run();
  }

  async revokeAllAuthSessions(
    userId: string,
    revokedAt: number,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE auth_sessions
         SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .bind(revokedAt, userId)
      .run();
  }

  async createPasswordResetToken(
    token: PasswordResetTokenRecord,
  ): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE password_reset_tokens
           SET used_at = ?
           WHERE user_id = ? AND used_at IS NULL`,
        )
        .bind(token.createdAt, token.userId),
      this.database
        .prepare(
          `INSERT INTO password_reset_tokens (
             token_hash,
             user_id,
             created_at,
             expires_at,
             used_at
           )
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          token.tokenHash,
          token.userId,
          token.createdAt,
          token.expiresAt,
          token.usedAt,
        ),
    ]);
  }

  async consumePasswordResetToken(
    input: ConsumePasswordResetInput,
  ): Promise<AuthUserRecord | null> {
    const results = await this.database.batch([
      this.database
        .prepare(
          `UPDATE password_reset_tokens
           SET used_at = ?
           WHERE
             token_hash = ? AND
             used_at IS NULL AND
             expires_at > ? AND
             EXISTS (
               SELECT 1
               FROM users
               WHERE
                 users.user_id = password_reset_tokens.user_id AND
                 users.status = 'active'
             )`,
        )
        .bind(input.usedAt, input.tokenHash, input.usedAt),
      this.database
        .prepare(
          `UPDATE users
           SET
             password_algorithm = ?,
             password_salt = ?,
             password_hash = ?,
             password_iterations = ?,
             updated_at = ?,
             password_changed_at = ?
           WHERE
             user_id = (
               SELECT user_id
               FROM password_reset_tokens
               WHERE token_hash = ? AND used_at = ?
             ) AND
             status = 'active' AND
             changes() = 1`,
        )
        .bind(
          input.password.algorithm,
          input.password.salt,
          input.password.hash,
          input.password.iterations,
          input.usedAt,
          input.usedAt,
          input.tokenHash,
          input.usedAt,
        ),
      this.database
        .prepare(
          `UPDATE auth_sessions
           SET revoked_at = ?
           WHERE
             user_id = (
               SELECT user_id
               FROM password_reset_tokens
               WHERE token_hash = ? AND used_at = ?
             ) AND
             revoked_at IS NULL AND
             changes() = 1`,
        )
        .bind(input.usedAt, input.tokenHash, input.usedAt),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) return null;

    const row = await this.database
      .prepare(
        `SELECT
           users.user_id,
           users.email,
           users.email_normalized,
           users.display_name,
           users.status,
           users.password_algorithm,
           users.password_salt,
           users.password_hash,
           users.password_iterations,
           users.created_at,
           users.updated_at,
           users.password_changed_at
         FROM users
         INNER JOIN password_reset_tokens
           ON password_reset_tokens.user_id = users.user_id
         WHERE password_reset_tokens.token_hash = ?`,
      )
      .bind(input.tokenHash)
      .first<UserRow>();
    return decodeUser(row);
  }

  async consumeAuthRateLimit(
    input: ConsumeAuthRateLimitInput,
  ): Promise<AuthRateLimitResult> {
    const [, readResult] = await this.database.batch<RateLimitRow>([
      this.database
        .prepare(
          `INSERT INTO auth_rate_limits (
             scope,
             subject_hash,
             window_started_at,
             attempt_count,
             blocked_until
           )
           VALUES (?, ?, ?, 1, 0)
           ON CONFLICT (scope, subject_hash) DO UPDATE SET
             window_started_at = CASE
               WHEN auth_rate_limits.blocked_until > excluded.window_started_at
                 THEN auth_rate_limits.window_started_at
               WHEN excluded.window_started_at >=
                    auth_rate_limits.window_started_at + ?
                 THEN excluded.window_started_at
               ELSE auth_rate_limits.window_started_at
             END,
             attempt_count = CASE
               WHEN auth_rate_limits.blocked_until > excluded.window_started_at
                 THEN auth_rate_limits.attempt_count
               WHEN excluded.window_started_at >=
                    auth_rate_limits.window_started_at + ?
                 THEN 1
               ELSE auth_rate_limits.attempt_count + 1
             END,
             blocked_until = CASE
               WHEN auth_rate_limits.blocked_until > excluded.window_started_at
                 THEN auth_rate_limits.blocked_until
               WHEN excluded.window_started_at >=
                    auth_rate_limits.window_started_at + ?
                 THEN 0
               WHEN auth_rate_limits.attempt_count + 1 > ?
                 THEN excluded.window_started_at + ?
               ELSE 0
             END`,
        )
        .bind(
          input.scope,
          input.subjectHash,
          input.now,
          input.windowMs,
          input.windowMs,
          input.windowMs,
          input.maxAttempts,
          input.blockMs,
        ),
      this.database
        .prepare(
          `SELECT window_started_at, attempt_count, blocked_until
           FROM auth_rate_limits
           WHERE scope = ? AND subject_hash = ?`,
        )
        .bind(input.scope, input.subjectHash),
    ]);
    const row = readResult.results[0];
    if (!row) throw new Error('Authentication rate limit was not persisted');
    const blocked = row.blocked_until > input.now;
    return {
      allowed: !blocked && row.attempt_count <= input.maxAttempts,
      remaining: blocked
        ? 0
        : Math.max(0, input.maxAttempts - row.attempt_count),
      retryAfterMs: blocked
        ? Math.max(0, row.blocked_until - input.now)
        : 0,
    };
  }

  async appendAuditEvent(event: AuditEventRecord): Promise<void> {
    await this.auditStatement(event).run();
  }

  async listWorkspaceRevisions(
    workspaceId: string,
    limit = MAX_STORED_REVISIONS,
  ): Promise<WorkspaceRevisionRecord[]> {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(MAX_STORED_REVISIONS, Math.floor(limit)))
      : MAX_STORED_REVISIONS;
    const result = await this.database
      .prepare(
        `SELECT
           workspace_id,
           revision,
           updated_at,
           actor_user_id,
           data_size_bytes
         FROM workspace_revisions
         WHERE workspace_id = ?
         ORDER BY revision DESC
         LIMIT ?`,
      )
      .bind(workspaceId, safeLimit)
      .all<RevisionRow>();
    return result.results.map(decodeRevision);
  }

  async getWorkspaceRevision(
    workspaceId: string,
    revision: number,
  ): Promise<WorkspaceRevisionSnapshot | null> {
    const row = await this.database
      .prepare(
        `SELECT
           workspace_id,
           revision,
           updated_at,
           actor_user_id,
           data_size_bytes,
           data_json
         FROM workspace_revisions
         WHERE workspace_id = ? AND revision = ?`,
      )
      .bind(workspaceId, revision)
      .first<RevisionSnapshotRow>();
    if (!row) return null;
    return {
      ...decodeRevision(row),
      data: JSON.parse(row.data_json) as AppData,
    };
  }

  private projectionGateStatement(
    workspaceId: string,
    sourceRevision: number,
    writeToken: string,
    projectedAt: number,
    requirePreviousChange: boolean,
  ): D1PreparedStatement {
    const source = requirePreviousChange
      ? `SELECT ?, ?, ?, ? WHERE changes() = 1`
      : `VALUES (?, ?, ?, ?)`;
    return this.database
      .prepare(
        `INSERT INTO workspace_projection_state (
           workspace_id,
           source_revision,
           write_token,
           projected_at
         )
         ${source}
         ON CONFLICT (workspace_id) DO UPDATE SET
           source_revision = excluded.source_revision,
           write_token = excluded.write_token,
           projected_at = excluded.projected_at`,
      )
      .bind(workspaceId, sourceRevision, writeToken, projectedAt);
  }

  private projectionStatements(
    workspaceId: string,
    sourceRevision: number,
    writeToken: string,
  ): D1PreparedStatement[] {
    return [
      this.database
        .prepare(
          `DELETE FROM classes
           WHERE
             workspace_id = ? AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = ? AND
                 source_revision = ? AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO classes (
             workspace_id,
             class_id,
             name,
             source_revision,
             record_json
           )
           SELECT
             workspaces.workspace_id,
             CAST(json_extract(class_item.value, '$.id') AS TEXT),
             COALESCE(
               CAST(json_extract(class_item.value, '$.name') AS TEXT),
               ''
             ),
             workspaces.revision,
             class_item.value
           FROM workspaces
           JOIN json_each(
             CASE
               WHEN
                 json_valid(workspaces.data_json) AND
                 json_type(workspaces.data_json, '$.classes') = 'array'
                 THEN json_extract(workspaces.data_json, '$.classes')
               ELSE '[]'
             END
           ) AS class_item
           WHERE
             workspaces.workspace_id = ? AND
             workspaces.revision = ? AND
             json_type(class_item.value) = 'object' AND
             NULLIF(
               TRIM(CAST(json_extract(class_item.value, '$.id') AS TEXT)),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = workspaces.workspace_id AND
                 source_revision = workspaces.revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO students (
             workspace_id,
             class_id,
             student_id,
             name,
             points,
             rank_points,
             warning_points,
             pet_type,
             pet_fullness,
             pet_happiness,
             pet_level,
             source_revision,
             record_json
           )
           SELECT
             classes.workspace_id,
             classes.class_id,
             CAST(json_extract(student_item.value, '$.id') AS TEXT),
             COALESCE(
               CAST(json_extract(student_item.value, '$.name') AS TEXT),
               ''
             ),
             CAST(COALESCE(
               json_extract(student_item.value, '$.points'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(student_item.value, '$.rankPoints'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(student_item.value, '$.warningPoints'), 0
             ) AS REAL),
             COALESCE(
               CAST(json_extract(student_item.value, '$.pet.type') AS TEXT),
               ''
             ),
             CAST(COALESCE(
               json_extract(student_item.value, '$.pet.fullness'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(student_item.value, '$.pet.happiness'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(student_item.value, '$.pet.level'), 1
             ) AS INTEGER),
             classes.source_revision,
             student_item.value
           FROM classes
           JOIN json_each(
             CASE
               WHEN json_type(classes.record_json, '$.students') = 'array'
                 THEN json_extract(classes.record_json, '$.students')
               ELSE '[]'
             END
           ) AS student_item
           WHERE
             classes.workspace_id = ? AND
             classes.source_revision = ? AND
             json_type(student_item.value) = 'object' AND
             NULLIF(
               TRIM(CAST(json_extract(student_item.value, '$.id') AS TEXT)),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = classes.workspace_id AND
                 source_revision = classes.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO exam_records (
             workspace_id,
             class_id,
             exam_id,
             title,
             exam_date,
             items_json,
             created_at,
             updated_at,
             source_revision,
             record_json
           )
           SELECT
             classes.workspace_id,
             classes.class_id,
             CAST(json_extract(exam_item.value, '$.id') AS TEXT),
             COALESCE(
               CAST(json_extract(exam_item.value, '$.title') AS TEXT),
               ''
             ),
             COALESCE(
               CAST(json_extract(exam_item.value, '$.examDate') AS TEXT),
               ''
             ),
             CASE
               WHEN json_type(exam_item.value, '$.items') = 'array'
                 THEN json_extract(exam_item.value, '$.items')
               ELSE '[]'
             END,
             CAST(COALESCE(
               json_extract(exam_item.value, '$.createdAt'), 0
             ) AS INTEGER),
             CAST(COALESCE(
               json_extract(exam_item.value, '$.updatedAt'), 0
             ) AS INTEGER),
             classes.source_revision,
             exam_item.value
           FROM classes
           JOIN json_each(
             CASE
               WHEN json_type(classes.record_json, '$.examRecords') = 'array'
                 THEN json_extract(classes.record_json, '$.examRecords')
               ELSE '[]'
             END
           ) AS exam_item
           WHERE
             classes.workspace_id = ? AND
             classes.source_revision = ? AND
             json_type(exam_item.value) = 'object' AND
             NULLIF(
               TRIM(CAST(json_extract(exam_item.value, '$.id') AS TEXT)),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = classes.workspace_id AND
                 source_revision = classes.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),

      this.database
        .prepare(
          `INSERT OR REPLACE INTO exam_results (
             workspace_id,
             class_id,
             exam_id,
             student_id,
             scores_json,
             mentor_comment,
             updated_at,
             source_revision,
             record_json
           )
           SELECT
             exam_records.workspace_id,
             exam_records.class_id,
             exam_records.exam_id,
             CAST(json_extract(result_item.value, '$.studentId') AS TEXT),
             CASE
               WHEN json_type(result_item.value, '$.scores') = 'object'
                 THEN json_extract(result_item.value, '$.scores')
               ELSE '{}'
             END,
             CAST(json_extract(result_item.value, '$.mentorComment') AS TEXT),
             CAST(COALESCE(
               json_extract(result_item.value, '$.updatedAt'), 0
             ) AS INTEGER),
             exam_records.source_revision,
             result_item.value
           FROM exam_records
           JOIN json_each(
             CASE
               WHEN json_type(exam_records.record_json, '$.results') = 'array'
                 THEN json_extract(exam_records.record_json, '$.results')
               ELSE '[]'
             END
           ) AS result_item
           JOIN students
             ON students.workspace_id = exam_records.workspace_id
             AND students.class_id = exam_records.class_id
             AND students.student_id = CAST(
               json_extract(result_item.value, '$.studentId') AS TEXT
             )
           WHERE
             exam_records.workspace_id = ? AND
             exam_records.source_revision = ? AND
             json_type(result_item.value) = 'object' AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = exam_records.workspace_id AND
                 source_revision = exam_records.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO learning_evidence (
             workspace_id,
             class_id,
             evidence_id,
             student_id,
             competency,
             level,
             evidence_type,
             title,
             note,
             actor,
             source,
             source_id,
             rubric_version,
             evidence_revision,
             created_at,
             source_revision,
             record_json
           )
           SELECT
             classes.workspace_id,
             classes.class_id,
             CAST(json_extract(evidence_item.value, '$.id') AS TEXT),
             CAST(json_extract(evidence_item.value, '$.studentId') AS TEXT),
             COALESCE(
               CAST(json_extract(evidence_item.value, '$.competency') AS TEXT),
               ''
             ),
             COALESCE(
               CAST(json_extract(evidence_item.value, '$.level') AS TEXT),
               ''
             ),
             COALESCE(
               CAST(
                 json_extract(evidence_item.value, '$.evidenceType') AS TEXT
               ),
               ''
             ),
             COALESCE(
               CAST(json_extract(evidence_item.value, '$.title') AS TEXT),
               ''
             ),
             CAST(json_extract(evidence_item.value, '$.note') AS TEXT),
             COALESCE(
               CAST(json_extract(evidence_item.value, '$.actor') AS TEXT),
               'mentor'
             ),
             COALESCE(
               CAST(json_extract(evidence_item.value, '$.source') AS TEXT),
               'manual'
             ),
             CAST(json_extract(evidence_item.value, '$.sourceId') AS TEXT),
             COALESCE(
               CAST(
                 json_extract(evidence_item.value, '$.rubricVersion') AS TEXT
               ),
               '1.0'
             ),
             CAST(COALESCE(
               json_extract(evidence_item.value, '$.revision'), 1
             ) AS INTEGER),
             CAST(COALESCE(
               json_extract(evidence_item.value, '$.createdAt'), 0
             ) AS INTEGER),
             classes.source_revision,
             evidence_item.value
           FROM classes
           JOIN json_each(
             CASE
               WHEN
                 json_type(
                   classes.record_json,
                   '$.learningEvidenceRecords'
                 ) = 'array'
                 THEN json_extract(
                   classes.record_json,
                   '$.learningEvidenceRecords'
                 )
               ELSE '[]'
             END
           ) AS evidence_item
           JOIN students
             ON students.workspace_id = classes.workspace_id
             AND students.class_id = classes.class_id
             AND students.student_id = CAST(
               json_extract(evidence_item.value, '$.studentId') AS TEXT
             )
           WHERE
             classes.workspace_id = ? AND
             classes.source_revision = ? AND
             json_type(evidence_item.value) = 'object' AND
             NULLIF(
               TRIM(CAST(json_extract(evidence_item.value, '$.id') AS TEXT)),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = classes.workspace_id AND
                 source_revision = classes.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO point_adjustments (
             workspace_id,
             class_id,
             student_id,
             adjustment_id,
             amount,
             source,
             reason_id,
             reason_label,
             competency,
             created_at,
             source_revision,
             record_json
           )
           SELECT
             students.workspace_id,
             students.class_id,
             students.student_id,
             CAST(json_extract(adjustment_item.value, '$.id') AS TEXT),
             CAST(COALESCE(
               json_extract(adjustment_item.value, '$.amount'), 0
             ) AS REAL),
             COALESCE(
               CAST(json_extract(adjustment_item.value, '$.source') AS TEXT),
               ''
             ),
             CAST(json_extract(adjustment_item.value, '$.reasonId') AS TEXT),
             CAST(
               json_extract(adjustment_item.value, '$.reasonLabel') AS TEXT
             ),
             CAST(
               json_extract(adjustment_item.value, '$.competency') AS TEXT
             ),
             CAST(COALESCE(
               json_extract(adjustment_item.value, '$.createdAt'), 0
             ) AS INTEGER),
             students.source_revision,
             adjustment_item.value
           FROM students
           JOIN json_each(
             CASE
               WHEN
                 json_type(
                   students.record_json,
                   '$.pointAdjustmentRecords'
                 ) = 'array'
                 THEN json_extract(
                   students.record_json,
                   '$.pointAdjustmentRecords'
                 )
               ELSE '[]'
             END
           ) AS adjustment_item
           WHERE
             students.workspace_id = ? AND
             students.source_revision = ? AND
             json_type(adjustment_item.value) = 'object' AND
             NULLIF(
               TRIM(
                 CAST(json_extract(adjustment_item.value, '$.id') AS TEXT)
               ),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = students.workspace_id AND
                 source_revision = students.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO discipline_records (
             workspace_id,
             class_id,
             student_id,
             discipline_id,
             record_type,
             warning_count,
             reason,
             action_kind,
             reverses_record_id,
             created_at,
             source_revision,
             record_json
           )
           SELECT
             students.workspace_id,
             students.class_id,
             students.student_id,
             CAST(json_extract(discipline_item.value, '$.id') AS TEXT),
             COALESCE(
               CAST(json_extract(discipline_item.value, '$.type') AS TEXT),
               ''
             ),
             CAST(
               json_extract(discipline_item.value, '$.warningCount') AS INTEGER
             ),
             CAST(json_extract(discipline_item.value, '$.reason') AS TEXT),
             CAST(
               json_extract(discipline_item.value, '$.actionKind') AS TEXT
             ),
             CAST(
               json_extract(
                 discipline_item.value,
                 '$.reversesRecordId'
               ) AS TEXT
             ),
             CAST(COALESCE(
               json_extract(discipline_item.value, '$.createdAt'), 0
             ) AS INTEGER),
             students.source_revision,
             discipline_item.value
           FROM students
           JOIN json_each(
             CASE
               WHEN
                 json_type(
                   students.record_json,
                   '$.disciplineRecords'
                 ) = 'array'
                 THEN json_extract(
                   students.record_json,
                   '$.disciplineRecords'
                 )
               ELSE '[]'
             END
           ) AS discipline_item
           WHERE
             students.workspace_id = ? AND
             students.source_revision = ? AND
             json_type(discipline_item.value) = 'object' AND
             NULLIF(
               TRIM(
                 CAST(json_extract(discipline_item.value, '$.id') AS TEXT)
               ),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = students.workspace_id AND
                 source_revision = students.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO boss_rewards (
             workspace_id, class_id, student_id, reward_id, boss_id,
             boss_name, rank, damage, attack_count, fair_score,
             previous_damage, previous_fair_score, improvement_amount,
             fair_improvement_amount, reward_points, reward_rank_points,
             reward_happiness, rank_reward_points, rank_reward_rank_points,
             rank_reward_happiness, participation_reward_points,
             participation_reward_rank_points, participation_reward_happiness,
             improvement_reward_points, improvement_reward_rank_points,
             improvement_reward_happiness, received_improvement_reward,
             created_at, source_revision, record_json
           )
           SELECT
             students.workspace_id,
             students.class_id,
             students.student_id,
             CAST(json_extract(reward_item.value, '$.id') AS TEXT),
             COALESCE(
               CAST(json_extract(reward_item.value, '$.bossId') AS TEXT), ''
             ),
             COALESCE(
               CAST(json_extract(reward_item.value, '$.bossName') AS TEXT), ''
             ),
             CAST(COALESCE(json_extract(reward_item.value, '$.rank'), 0)
               AS INTEGER),
             CAST(COALESCE(json_extract(reward_item.value, '$.damage'), 0)
               AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.attackCount'), 0
             ) AS INTEGER),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.fairScore'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.previousDamage'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.previousFairScore'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.improvementAmount'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.fairImprovementAmount'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rewardPoints'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rewardRankPoints'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rewardHappiness'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rankRewardPoints'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rankRewardRankPoints'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rankRewardHappiness'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.participationRewardPoints'),
               0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(
                 reward_item.value,
                 '$.participationRewardRankPoints'
               ),
               0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(
                 reward_item.value,
                 '$.participationRewardHappiness'
               ),
               0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.improvementRewardPoints'),
               0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(
                 reward_item.value,
                 '$.improvementRewardRankPoints'
               ),
               0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(
                 reward_item.value,
                 '$.improvementRewardHappiness'
               ),
               0
             ) AS REAL),
             CASE
               WHEN json_extract(
                 reward_item.value,
                 '$.receivedImprovementReward'
               ) = 1 THEN 1
               ELSE 0
             END,
             CAST(COALESCE(
               json_extract(reward_item.value, '$.createdAt'), 0
             ) AS INTEGER),
             students.source_revision,
             reward_item.value
           FROM students
           JOIN json_each(
             CASE
               WHEN
                 json_type(
                   students.record_json,
                   '$.bossRewardRecords'
                 ) = 'array'
                 THEN json_extract(
                   students.record_json,
                   '$.bossRewardRecords'
                 )
               ELSE '[]'
             END
           ) AS reward_item
           WHERE
             students.workspace_id = ? AND
             students.source_revision = ? AND
             json_type(reward_item.value) = 'object' AND
             NULLIF(
               TRIM(CAST(json_extract(reward_item.value, '$.id') AS TEXT)),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = students.workspace_id AND
                 source_revision = students.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `DELETE FROM workspace_class_assignments
           WHERE
             workspace_id = ? AND
             NOT EXISTS (
               SELECT 1
               FROM classes
               WHERE
                 classes.workspace_id = workspace_class_assignments.workspace_id AND
                 classes.class_id = workspace_class_assignments.class_id
             ) AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = ? AND
                 source_revision = ? AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, workspaceId, sourceRevision, writeToken),
    ];
  }

  private workspaceAuditStatement(
    workspaceId: string,
    sourceRevision: number,
    updatedAt: number,
    context: WorkspaceWriteContext,
    writeToken: string,
  ): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT OR IGNORE INTO audit_events (
           event_id,
           workspace_id,
           actor_user_id,
           action,
           target_type,
           target_id,
           metadata_json,
           created_at
         )
         SELECT ?, ?, ?, ?, 'workspace', ?, '{}', ?
         WHERE EXISTS (
           SELECT 1
           FROM workspace_projection_state
           WHERE
             workspace_id = ? AND
             source_revision = ? AND
             write_token = ?
         )`,
      )
      .bind(
        context.requestId ??
          `evt_workspace_${workspaceId}_${sourceRevision}`,
        workspaceId,
        context.actorUserId ?? null,
        context.action ?? 'workspace.put',
        workspaceId,
        updatedAt,
        workspaceId,
        sourceRevision,
        writeToken,
      );
  }

  private auditStatement(event: AuditEventRecord) {
    return this.database
      .prepare(
        `INSERT INTO audit_events (
           event_id,
           workspace_id,
           actor_user_id,
           action,
           target_type,
           target_id,
           metadata_json,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.workspaceId ?? null,
        event.actorUserId ?? null,
        event.action,
        event.targetType ?? null,
        event.targetId ?? null,
        auditMetadataJson(event),
        event.createdAt,
      );
  }
}
