import { pbkdf2 as nodePbkdf2 } from 'node:crypto';
import type { AppData } from '../src/store/types';
import {
  EmailAlreadyExistsError,
  InvalidWorkspaceInvitationError,
  type AuditEventRecord,
  type AuthRateLimitResult,
  type AuthRateLimitScope,
  type AuthRepository,
  type AuthSessionRecord,
  type AuthUserRecord,
  type EmailVerificationTokenRecord,
  type PasswordCredential,
  type UserWorkspaceAccess,
  type WorkspaceMember,
  type WorkspaceInvitationSummary,
  type WorkspaceMembershipRecord,
  type WorkspaceRepository,
  type WorkspaceRole,
} from './contracts';

export const DEFAULT_PASSWORD_ITERATIONS = 600_000;
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_WORKSPACE_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CLOUD_WORKSPACE_ID_PATTERN = /^ws_[a-zA-Z0-9_-]{24,61}$/;
export const PASSWORD_RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const EMAIL_VERIFICATION_TOKEN_PATTERN = PASSWORD_RESET_TOKEN_PATTERN;

const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  viewer: 1,
  teacher: 2,
  admin: 3,
  owner: 4,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const textEncoder = new TextEncoder();

export type AuthSessionUser = {
  id: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  emailVerified: boolean;
};

export type AuthSessionView = {
  user: AuthSessionUser;
  workspaces: UserWorkspaceAccess[];
  activeWorkspaceId: string | null;
};

export type AuthSessionEnvelope = {
  sessionToken: string;
  session: AuthSessionView;
};

export type EmailVerificationDelivery = {
  email: string;
  displayName: string;
  token: string;
  expiresAt: number;
};

export type AuthRegistrationEnvelope = AuthSessionEnvelope & {
  emailVerification?: EmailVerificationDelivery;
};

export type AccountLifecycleEventKind =
  | 'email_verified'
  | 'password_changed'
  | 'workspace_joined'
  | 'workspace_role_changed'
  | 'workspace_removed'
  | 'ownership_transferred'
  | 'ownership_received'
  | 'workspace_deleted'
  | 'account_deleted';

export type AccountLifecycleDelivery = {
  eventId: string;
  kind: AccountLifecycleEventKind;
  email: string;
  displayName: string;
  occurredAt: number;
  workspaceName?: string;
  previousRole?: WorkspaceRole;
  role?: WorkspaceRole;
};

export type RegisterInput = {
  email: string;
  password: string;
  displayName: string;
  workspaceName: string;
  initialWorkspaceData: AppData;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type PasswordResetDelivery = {
  email: string;
  displayName: string;
  token: string;
  expiresAt: number;
};

export type WorkspaceInvitationDelivery = {
  invitationId: string;
  email: string;
  workspaceName: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  token: string;
  expiresAt: number;
};

export type AuthorizedWorkspace = {
  user: AuthSessionUser;
  membership: WorkspaceMembershipRecord;
  session: AuthSessionView;
};

export type AuthServiceOptions = {
  crypto?: Crypto;
  now?: () => number;
  passwordIterations?: number;
  sessionTtlMs?: number;
  passwordResetTtlMs?: number;
  emailVerificationRequired?: boolean;
  emailVerificationTtlMs?: number;
  lifecycleNotifier?: (delivery: AccountLifecycleDelivery) => void;
};

export type AuthRateLimitPolicy = {
  windowMs: number;
  maxAttempts: number;
  blockMs: number;
};

export class AuthValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('INVALID_CREDENTIALS');
  }
}

export class InvalidSessionError extends Error {
  constructor() {
    super('INVALID_SESSION');
  }
}

export class AuthForbiddenError extends Error {
  constructor() {
    super('FORBIDDEN');
  }
}

export class InvalidPasswordResetTokenError extends Error {
  constructor() {
    super('INVALID_PASSWORD_RESET_TOKEN');
  }
}

export class InvalidEmailVerificationTokenError extends Error {
  constructor() {
    super('INVALID_EMAIL_VERIFICATION_TOKEN');
  }
}

export class EmailVerificationRequiredError extends Error {
  constructor() {
    super('EMAIL_VERIFICATION_REQUIRED');
  }
}

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};

const base64UrlToBytes = (value: string) => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const constantTimeEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
};

const getCrypto = (provided?: Crypto) => {
  const implementation = provided ?? globalThis.crypto;
  if (!implementation?.subtle || !implementation.getRandomValues) {
    throw new Error('Web Crypto is required for authentication');
  }
  return implementation;
};

const randomToken = (cryptoImplementation: Crypto, byteLength = 32) => {
  const bytes = new Uint8Array(byteLength);
  cryptoImplementation.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

const randomId = (
  cryptoImplementation: Crypto,
  prefix: string,
  byteLength = 18,
) => `${prefix}${randomToken(cryptoImplementation, byteLength)}`;

const derivePasswordHash = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
) => new Promise<Uint8Array>((resolve, reject) => {
  nodePbkdf2(
    password,
    salt,
    iterations,
    32,
    'sha256',
    (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(new Uint8Array(derivedKey));
    },
  );
});

export const normalizeEmail = (email: string) =>
  email.trim().toLocaleLowerCase('en-US');

export const isRoleAtLeast = (
  actual: WorkspaceRole,
  required: WorkspaceRole,
) => ROLE_LEVEL[actual] >= ROLE_LEVEL[required];

export const isPasswordResetToken = (value: string) =>
  PASSWORD_RESET_TOKEN_PATTERN.test(value);

export const isEmailVerificationToken = (value: string) =>
  EMAIL_VERIFICATION_TOKEN_PATTERN.test(value);

export const hashOpaqueToken = async (
  token: string,
  cryptoImplementation = getCrypto(),
) => {
  const digest = await cryptoImplementation.subtle.digest(
    'SHA-256',
    textEncoder.encode(token),
  );
  return bytesToBase64Url(new Uint8Array(digest));
};

export const createPasswordCredential = async (
  password: string,
  iterations = DEFAULT_PASSWORD_ITERATIONS,
  cryptoImplementation = getCrypto(),
): Promise<PasswordCredential> => {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('Password iterations must be a positive integer');
  }
  if (password.length > 128) {
    throw new AuthValidationError('INVALID_PASSWORD');
  }
  const salt = new Uint8Array(16);
  cryptoImplementation.getRandomValues(salt);
  const hash = await derivePasswordHash(
    password,
    salt,
    iterations,
  );
  return {
    algorithm: 'PBKDF2-HMAC-SHA256',
    salt: bytesToBase64Url(salt),
    hash: bytesToBase64Url(hash),
    iterations,
  };
};

export const verifyPassword = async (
  password: string,
  credential: PasswordCredential,
  cryptoImplementation = getCrypto(),
) => {
  if (password.length > 128) return false;
  if (
    credential.algorithm !== 'PBKDF2-HMAC-SHA256' ||
    !Number.isInteger(credential.iterations) ||
    credential.iterations < 1
  ) {
    return false;
  }
  try {
    const actual = await derivePasswordHash(
      password,
      base64UrlToBytes(credential.salt),
      credential.iterations,
    );
    return constantTimeEqual(actual, base64UrlToBytes(credential.hash));
  } catch {
    return false;
  }
};

const validateEmail = (email: string) => {
  const normalized = normalizeEmail(email);
  if (
    normalized.length > 254 ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    throw new AuthValidationError('INVALID_EMAIL');
  }
  return normalized;
};

const validatePassword = (password: string) => {
  if (password.length < 12 || password.length > 128) {
    throw new AuthValidationError('INVALID_PASSWORD');
  }
};

const validateLabel = (
  value: string,
  maximumLength: number,
  code: string,
) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new AuthValidationError(code);
  }
  return normalized;
};

const normalizeClassIds = (classIds: string[]) =>
  [...new Set(classIds.filter((classId) =>
    typeof classId === 'string' && classId.trim().length > 0,
  ).map((classId) => classId.trim()))].slice(0, 200);

export class AuthService {
  private readonly crypto: Crypto;
  private readonly now: () => number;
  private readonly passwordIterations: number;
  private readonly sessionTtlMs: number;
  private readonly passwordResetTtlMs: number;
  private readonly emailVerificationRequired: boolean;
  private readonly emailVerificationTtlMs: number;
  private readonly lifecycleNotifier?: (delivery: AccountLifecycleDelivery) => void;

  constructor(
    private readonly repository: AuthRepository & WorkspaceRepository,
    options: AuthServiceOptions = {},
  ) {
    this.crypto = getCrypto(options.crypto);
    this.now = options.now ?? Date.now;
    this.passwordIterations =
      options.passwordIterations ?? DEFAULT_PASSWORD_ITERATIONS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.passwordResetTtlMs =
      options.passwordResetTtlMs ?? DEFAULT_PASSWORD_RESET_TTL_MS;
    this.emailVerificationRequired = options.emailVerificationRequired === true;
    this.emailVerificationTtlMs =
      options.emailVerificationTtlMs ?? DEFAULT_EMAIL_VERIFICATION_TTL_MS;
    this.lifecycleNotifier = options.lifecycleNotifier;
    if (
      !Number.isInteger(this.passwordIterations) ||
      this.passwordIterations < 1
    ) {
      throw new Error('Password iterations must be a positive integer');
    }
  }

  private notifyLifecycle(
    delivery: Omit<AccountLifecycleDelivery, 'eventId'>,
  ) {
    if (!this.lifecycleNotifier) return;
    this.lifecycleNotifier({
      ...delivery,
      eventId: randomId(this.crypto, 'mail_', 18),
    });
  }

  private createAuditEvent(
    action: string,
    actorUserId?: string,
    workspaceId?: string,
    targetType?: string,
    targetId?: string,
    metadata?: Record<string, unknown>,
  ): AuditEventRecord {
    return {
      id: randomId(this.crypto, 'evt_', 18),
      action,
      actorUserId,
      workspaceId,
      targetType,
      targetId,
      metadata,
      createdAt: this.now(),
    };
  }

  private async createEmailVerificationMaterial(
    user: Pick<AuthUserRecord, 'id' | 'email' | 'displayName'>,
  ): Promise<{
    record: EmailVerificationTokenRecord;
    delivery: EmailVerificationDelivery;
  }> {
    const token = randomToken(this.crypto);
    const createdAt = this.now();
    const expiresAt = createdAt + this.emailVerificationTtlMs;
    return {
      record: {
        tokenHash: await hashOpaqueToken(token, this.crypto),
        userId: user.id,
        createdAt,
        expiresAt,
        usedAt: null,
      },
      delivery: {
        email: user.email,
        displayName: user.displayName,
        token,
        expiresAt,
      },
    };
  }

  private async issueSession(
    userId: string,
    preferredWorkspaceId?: string,
  ): Promise<AuthSessionEnvelope> {
    const workspaces = await this.repository.listUserWorkspaces(userId);
    const activeWorkspaceId = workspaces.some(
      (workspace) => workspace.id === preferredWorkspaceId,
    )
      ? preferredWorkspaceId ?? null
      : workspaces[0]?.id ?? null;
    const rawToken = randomToken(this.crypto);
    const tokenHash = await hashOpaqueToken(rawToken, this.crypto);
    const now = this.now();
    const session: AuthSessionRecord = {
      tokenHash,
      userId,
      activeWorkspaceId,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      lastSeenAt: now,
      revokedAt: null,
    };
    await this.repository.createAuthSession(session);
    return {
      sessionToken: rawToken,
      session: await this.buildSessionView(session),
    };
  }

  private async buildSessionView(
    session: AuthSessionRecord,
    suppliedUser?: AuthUserRecord,
  ): Promise<AuthSessionView> {
    const user =
      suppliedUser ?? await this.repository.getUserById(session.userId);
    if (!user || user.status !== 'active') throw new InvalidSessionError();
    const workspaces = await this.repository.listUserWorkspaces(user.id);
    const activeWorkspace = workspaces.find(
      (workspace) => workspace.id === session.activeWorkspaceId,
    ) ?? workspaces[0];
    if (
      activeWorkspace &&
      activeWorkspace.id !== session.activeWorkspaceId
    ) {
      await this.repository.setAuthSessionActiveWorkspace(
        session.tokenHash,
        activeWorkspace.id,
      );
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: activeWorkspace?.role ?? 'viewer',
        emailVerified: user.emailVerifiedAt != null,
      },
      workspaces,
      activeWorkspaceId: activeWorkspace?.id ?? null,
    };
  }

  private async resolveSession(rawToken: string) {
    if (!rawToken) throw new InvalidSessionError();
    const tokenHash = await hashOpaqueToken(rawToken, this.crypto);
    const record = await this.repository.getAuthSessionByTokenHash(tokenHash);
    const now = this.now();
    if (!record || record.revokedAt != null || record.expiresAt <= now) {
      if (record && record.revokedAt == null) {
        await this.repository.revokeAuthSession(tokenHash, now);
      }
      throw new InvalidSessionError();
    }
    const user = await this.repository.getUserById(record.userId);
    if (!user || user.status !== 'active') throw new InvalidSessionError();
    return {
      tokenHash,
      record,
      user,
      view: await this.buildSessionView(record, user),
    };
  }

  async register(input: RegisterInput): Promise<AuthRegistrationEnvelope> {
    const normalizedEmail = validateEmail(input.email);
    validatePassword(input.password);
    const displayName = validateLabel(
      input.displayName,
      80,
      'INVALID_DISPLAY_NAME',
    );
    const workspaceName = validateLabel(
      input.workspaceName,
      120,
      'INVALID_WORKSPACE_NAME',
    );
    if (await this.repository.findUserByNormalizedEmail(normalizedEmail)) {
      throw new EmailAlreadyExistsError();
    }
    const now = this.now();
    const userId = randomId(this.crypto, 'usr_', 18);
    const workspaceId = randomId(this.crypto, 'ws_', 24);
    const user: AuthUserRecord = {
      id: userId,
      email: input.email.trim(),
      normalizedEmail,
      emailVerifiedAt: this.emailVerificationRequired ? null : now,
      displayName,
      status: 'active',
      password: await createPasswordCredential(
        input.password,
        this.passwordIterations,
        this.crypto,
      ),
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
    };
    const membership: WorkspaceMembershipRecord = {
      workspaceId,
      userId,
      role: 'owner',
      createdAt: now,
      createdByUserId: userId,
    };
    const emailVerification = this.emailVerificationRequired
      ? await this.createEmailVerificationMaterial(user)
      : undefined;
    await this.repository.createUserWithWorkspace({
      user,
      emailVerificationToken: emailVerification?.record,
      workspace: {
        id: workspaceId,
        name: workspaceName,
        data: input.initialWorkspaceData,
        createdAt: now,
      },
      membership,
      auditEvent: this.createAuditEvent(
        'auth.register',
        userId,
        workspaceId,
        'workspace',
        workspaceId,
      ),
    });
    return {
      ...await this.issueSession(userId, workspaceId),
      ...(emailVerification
        ? { emailVerification: emailVerification.delivery }
        : {}),
    };
  }

  async login(input: LoginInput): Promise<AuthSessionEnvelope> {
    let normalizedEmail: string;
    try {
      normalizedEmail = validateEmail(input.email);
    } catch {
      normalizedEmail = '';
    }
    const user = normalizedEmail
      ? await this.repository.findUserByNormalizedEmail(normalizedEmail)
      : null;
    const passwordCandidate =
      input.password.length <= 128
        ? input.password
        : 'invalid-password-candidate';
    if (!user || input.password.length > 128) {
      await derivePasswordHash(
        passwordCandidate,
        new Uint8Array(16),
        this.passwordIterations,
      );
      throw new InvalidCredentialsError();
    }
    const valid = await verifyPassword(
      input.password,
      user.password,
      this.crypto,
    );
    if (!valid || user.status !== 'active') {
      throw new InvalidCredentialsError();
    }
    const issued = await this.issueSession(user.id);
    await this.repository.appendAuditEvent(
      this.createAuditEvent(
        'auth.login',
        user.id,
        issued.session.activeWorkspaceId ?? undefined,
        'user',
        user.id,
      ),
    );
    return issued;
  }

  async getSession(rawToken: string): Promise<AuthSessionView> {
    return (await this.resolveSession(rawToken)).view;
  }

  async requestEmailVerification(
    rawToken: string,
  ): Promise<EmailVerificationDelivery | null> {
    const resolved = await this.resolveSession(rawToken);
    if (resolved.user.emailVerifiedAt != null) return null;
    const verification = await this.createEmailVerificationMaterial(
      resolved.user,
    );
    await this.repository.createEmailVerificationToken(verification.record);
    await this.repository.appendAuditEvent(this.createAuditEvent(
      'auth.email_verification.request',
      resolved.user.id,
      resolved.view.activeWorkspaceId ?? undefined,
      'user',
      resolved.user.id,
    ));
    return verification.delivery;
  }

  async verifyEmail(rawToken: string): Promise<void> {
    if (!isEmailVerificationToken(rawToken)) {
      throw new InvalidEmailVerificationTokenError();
    }
    const verifiedAt = this.now();
    const user = await this.repository.consumeEmailVerificationToken({
      tokenHash: await hashOpaqueToken(rawToken, this.crypto),
      verifiedAt,
    });
    if (!user) throw new InvalidEmailVerificationTokenError();
    await this.repository.appendAuditEvent(this.createAuditEvent(
      'auth.email_verified',
      user.id,
      undefined,
      'user',
      user.id,
    ));
    this.notifyLifecycle({
      kind: 'email_verified',
      email: user.email,
      displayName: user.displayName,
      occurredAt: verifiedAt,
    });
  }

  async logout(rawToken: string): Promise<void> {
    try {
      const resolved = await this.resolveSession(rawToken);
      const now = this.now();
      await this.repository.revokeAuthSession(resolved.tokenHash, now);
      await this.repository.appendAuditEvent(
        this.createAuditEvent(
          'auth.logout',
          resolved.user.id,
          resolved.view.activeWorkspaceId ?? undefined,
          'user',
          resolved.user.id,
        ),
      );
    } catch (error) {
      if (!(error instanceof InvalidSessionError)) throw error;
    }
  }

  async requestPasswordReset(
    email: string,
  ): Promise<PasswordResetDelivery | null> {
    let normalizedEmail: string;
    try {
      normalizedEmail = validateEmail(email);
    } catch {
      normalizedEmail = '';
    }
    const rawToken = randomToken(this.crypto);
    const tokenHash = await hashOpaqueToken(rawToken, this.crypto);
    const user = normalizedEmail
      ? await this.repository.findUserByNormalizedEmail(normalizedEmail)
      : null;
    if (!user || user.status !== 'active') return null;
    const now = this.now();
    const expiresAt = now + this.passwordResetTtlMs;
    await this.repository.createPasswordResetToken({
      tokenHash,
      userId: user.id,
      createdAt: now,
      expiresAt,
      usedAt: null,
    });
    return {
      email: user.email,
      displayName: user.displayName,
      token: rawToken,
      expiresAt,
    };
  }

  async resetPassword(rawToken: string, password: string): Promise<void> {
    // Reject malformed tokens before the deliberately expensive password KDF.
    // Well-formed guesses are additionally bounded by the API's IP-global and
    // token-specific rate limits.
    if (!isPasswordResetToken(rawToken)) {
      throw new InvalidPasswordResetTokenError();
    }
    validatePassword(password);
    const now = this.now();
    const user = await this.repository.consumePasswordResetToken({
      tokenHash: await hashOpaqueToken(rawToken, this.crypto),
      password: await createPasswordCredential(
        password,
        this.passwordIterations,
        this.crypto,
      ),
      usedAt: now,
    });
    if (!user) throw new InvalidPasswordResetTokenError();
    await this.repository.appendAuditEvent(
      this.createAuditEvent(
        'auth.password_reset',
        user.id,
        undefined,
        'user',
        user.id,
      ),
    );
    this.notifyLifecycle({
      kind: 'password_changed',
      email: user.email,
      displayName: user.displayName,
      occurredAt: now,
    });
  }

  async authorizeWorkspace(
    rawToken: string,
    workspaceId: string,
    minimumRole: WorkspaceRole = 'viewer',
  ): Promise<AuthorizedWorkspace> {
    const resolved = await this.resolveSession(rawToken);
    if (resolved.user.emailVerifiedAt == null) {
      throw new EmailVerificationRequiredError();
    }
    const membership = await this.repository.getWorkspaceMembership(
      workspaceId,
      resolved.user.id,
    );
    if (!membership || !isRoleAtLeast(membership.role, minimumRole)) {
      throw new AuthForbiddenError();
    }
    if (resolved.record.activeWorkspaceId !== workspaceId) {
      await this.repository.setAuthSessionActiveWorkspace(
        resolved.tokenHash,
        workspaceId,
      );
    }
    const activeWorkspace = resolved.view.workspaces.find(
      (workspace) => workspace.id === workspaceId,
    );
    return {
      user: {
        id: resolved.user.id,
        email: resolved.user.email,
        displayName: resolved.user.displayName,
        role: activeWorkspace?.role ?? membership.role,
        emailVerified: resolved.user.emailVerifiedAt != null,
      },
      membership,
      session: {
        ...resolved.view,
        user: {
          ...resolved.view.user,
          role: membership.role,
        },
        activeWorkspaceId: workspaceId,
      },
    };
  }

  async listWorkspaceMembers(
    rawToken: string,
    workspaceId: string,
  ): Promise<WorkspaceMember[]> {
    await this.authorizeWorkspace(rawToken, workspaceId, 'admin');
    return this.repository.listWorkspaceMembers(workspaceId);
  }

  async createWorkspaceInvitation(
    rawToken: string,
    workspaceId: string,
    email: string,
    role: Exclude<WorkspaceRole, 'owner'>,
    classIds: string[],
  ): Promise<WorkspaceInvitationDelivery> {
    const authorized = await this.authorizeWorkspace(
      rawToken,
      workspaceId,
      'admin',
    );
    if (!['admin', 'teacher', 'viewer'].includes(role)) {
      throw new AuthValidationError('INVALID_ROLE');
    }
    if (authorized.membership.role !== 'owner' && role === 'admin') {
      throw new AuthForbiddenError();
    }
    const normalizedEmail = validateEmail(email);
    const existingUser = await this.repository.findUserByNormalizedEmail(
      normalizedEmail,
    );
    if (
      existingUser &&
      await this.repository.getWorkspaceMembership(workspaceId, existingUser.id)
    ) {
      throw new AuthValidationError('MEMBER_ALREADY_EXISTS');
    }
    const workspace = await this.repository.get(workspaceId);
    const validClassIds = new Set(
      workspace.data?.classes.map((classroom) => classroom.id) ?? [],
    );
    const scopedClassIds = normalizeClassIds(classIds);
    if (
      (role === 'teacher' || role === 'viewer') &&
      (scopedClassIds.length === 0 ||
        scopedClassIds.some((classId) => !validClassIds.has(classId)))
    ) {
      throw new AuthValidationError('INVALID_CLASS_SCOPE');
    }
    const rawInvitationToken = randomToken(this.crypto);
    const now = this.now();
    const invitationId = randomId(this.crypto, 'inv_', 18);
    const invitation = {
      id: invitationId,
      tokenHash: await hashOpaqueToken(rawInvitationToken, this.crypto),
      workspaceId,
      email: email.trim(),
      normalizedEmail,
      role,
      classIds: role === 'admin' ? [] : scopedClassIds,
      createdByUserId: authorized.user.id,
      createdAt: now,
      expiresAt: now + DEFAULT_WORKSPACE_INVITATION_TTL_MS,
      acceptedAt: null,
      revokedAt: null,
    };
    await this.repository.createWorkspaceInvitation(invitation);
    await this.repository.appendAuditEvent(this.createAuditEvent(
      'workspace.invitation.create',
      authorized.user.id,
      workspaceId,
      'invitation',
      invitationId,
      { email: normalizedEmail, role, classIds: invitation.classIds },
    ));
    const workspaceName = authorized.session.workspaces.find(
      (candidate) => candidate.id === workspaceId,
    )?.name ?? 'ePet';
    return {
      invitationId,
      email: invitation.email,
      workspaceName,
      role,
      token: rawInvitationToken,
      expiresAt: invitation.expiresAt,
    };
  }

  async listWorkspaceInvitations(
    rawToken: string,
    workspaceId: string,
  ): Promise<WorkspaceInvitationSummary[]> {
    await this.authorizeWorkspace(rawToken, workspaceId, 'admin');
    return this.repository.listWorkspaceInvitations(workspaceId);
  }

  async revokeWorkspaceInvitation(
    rawToken: string,
    workspaceId: string,
    invitationId: string,
  ): Promise<WorkspaceInvitationSummary[]> {
    const authorized = await this.authorizeWorkspace(
      rawToken,
      workspaceId,
      'admin',
    );
    const invitation = (await this.repository.listWorkspaceInvitations(
      workspaceId,
    )).find((candidate) => candidate.id === invitationId);
    if (!invitation || invitation.acceptedAt != null || invitation.revokedAt != null) {
      throw new InvalidWorkspaceInvitationError();
    }
    if (authorized.membership.role !== 'owner' && invitation.role === 'admin') {
      throw new AuthForbiddenError();
    }
    const now = this.now();
    await this.repository.revokeWorkspaceInvitation(
      workspaceId,
      invitationId,
      now,
      this.createAuditEvent(
        'workspace.invitation.revoke',
        authorized.user.id,
        workspaceId,
        'invitation',
        invitationId,
      ),
    );
    return this.repository.listWorkspaceInvitations(workspaceId);
  }

  async acceptWorkspaceInvitation(
    rawToken: string,
    displayName: string,
    password: string,
  ): Promise<AuthSessionEnvelope> {
    if (!isPasswordResetToken(rawToken)) {
      throw new InvalidWorkspaceInvitationError();
    }
    const tokenHash = await hashOpaqueToken(rawToken, this.crypto);
    const invitation = await this.repository.getWorkspaceInvitationByTokenHash(
      tokenHash,
    );
    const now = this.now();
    if (
      !invitation ||
      invitation.acceptedAt != null ||
      invitation.revokedAt != null ||
      invitation.expiresAt <= now
    ) {
      throw new InvalidWorkspaceInvitationError();
    }
    validatePassword(password);
    const existingUser = await this.repository.findUserByNormalizedEmail(
      invitation.normalizedEmail,
    );
    let user: AuthUserRecord;
    if (existingUser) {
      if (
        existingUser.status !== 'active' ||
        !(await verifyPassword(password, existingUser.password, this.crypto))
      ) {
        throw new InvalidCredentialsError();
      }
      if (
        await this.repository.getWorkspaceMembership(
          invitation.workspaceId,
          existingUser.id,
        )
      ) throw new InvalidWorkspaceInvitationError();
      user = {
        ...existingUser,
        emailVerifiedAt: existingUser.emailVerifiedAt ?? now,
      };
    } else {
      const normalizedDisplayName = validateLabel(
        displayName,
        80,
        'INVALID_DISPLAY_NAME',
      );
      user = {
        id: randomId(this.crypto, 'usr_', 18),
        email: invitation.email,
        normalizedEmail: invitation.normalizedEmail,
        emailVerifiedAt: now,
        displayName: normalizedDisplayName,
        status: 'active',
        password: await createPasswordCredential(
          password,
          this.passwordIterations,
          this.crypto,
        ),
        createdAt: now,
        updatedAt: now,
        passwordChangedAt: now,
      };
    }
    await this.repository.acceptWorkspaceInvitation({
      tokenHash,
      invitation,
      user,
      createUser: !existingUser,
      membership: {
        workspaceId: invitation.workspaceId,
        userId: user.id,
        role: invitation.role,
        createdAt: now,
        createdByUserId: invitation.createdByUserId,
      },
      acceptedAt: now,
      auditEvent: this.createAuditEvent(
        'workspace.invitation.accept',
        user.id,
        invitation.workspaceId,
        'invitation',
        invitation.id,
      ),
    });
    const workspaceName = (await this.repository.listUserWorkspaces(user.id))
      .find((workspace) => workspace.id === invitation.workspaceId)
      ?.name;
    this.notifyLifecycle({
      kind: 'workspace_joined',
      email: user.email,
      displayName: user.displayName,
      occurredAt: now,
      workspaceName,
      role: invitation.role,
    });
    return this.issueSession(user.id, invitation.workspaceId);
  }

  async updateWorkspaceMember(
    rawToken: string,
    workspaceId: string,
    targetUserId: string,
    role: Exclude<WorkspaceRole, 'owner'>,
    classIds: string[],
  ): Promise<WorkspaceMember[]> {
    const authorized = await this.authorizeWorkspace(
      rawToken,
      workspaceId,
      'admin',
    );
    if (!['admin', 'teacher', 'viewer'].includes(role)) {
      throw new AuthValidationError('INVALID_ROLE');
    }
    const target = await this.repository.getWorkspaceMembership(
      workspaceId,
      targetUserId,
    );
    const targetUser = await this.repository.getUserById(targetUserId);
    if (!target || target.role === 'owner') throw new AuthForbiddenError();
    if (!targetUser) throw new AuthForbiddenError();
    if (
      authorized.membership.role !== 'owner' &&
      (target.role === 'admin' || role === 'admin')
    ) {
      throw new AuthForbiddenError();
    }
    const workspace = await this.repository.get(workspaceId);
    const validClassIds = new Set(
      workspace.data?.classes.map((classroom) => classroom.id) ?? [],
    );
    const scopedClassIds = normalizeClassIds(classIds);
    if (
      ((role === 'teacher' || role === 'viewer') && scopedClassIds.length === 0) ||
      scopedClassIds.some((classId) => !validClassIds.has(classId))
    ) {
      throw new AuthValidationError('INVALID_CLASS_SCOPE');
    }
    const now = this.now();
    await this.repository.updateWorkspaceMember({
      workspaceId,
      userId: targetUserId,
      role,
      classIds: scopedClassIds,
      actorUserId: authorized.user.id,
      updatedAt: now,
      auditEvent: this.createAuditEvent(
        'workspace.member.update',
        authorized.user.id,
        workspaceId,
        'user',
        targetUserId,
        { role, classIds: scopedClassIds },
      ),
    });
    this.notifyLifecycle({
      kind: 'workspace_role_changed',
      email: targetUser.email,
      displayName: targetUser.displayName,
      occurredAt: now,
      workspaceName: authorized.session.workspaces.find(
        (workspace) => workspace.id === workspaceId,
      )?.name,
      previousRole: target.role,
      role,
    });
    return this.repository.listWorkspaceMembers(workspaceId);
  }

  async removeWorkspaceMember(
    rawToken: string,
    workspaceId: string,
    targetUserId: string,
  ): Promise<WorkspaceMember[]> {
    const authorized = await this.authorizeWorkspace(
      rawToken,
      workspaceId,
      'admin',
    );
    if (targetUserId === authorized.user.id) throw new AuthForbiddenError();
    const target = await this.repository.getWorkspaceMembership(
      workspaceId,
      targetUserId,
    );
    const targetUser = await this.repository.getUserById(targetUserId);
    if (!target || target.role === 'owner') throw new AuthForbiddenError();
    if (!targetUser) throw new AuthForbiddenError();
    if (
      authorized.membership.role !== 'owner' && target.role === 'admin'
    ) {
      throw new AuthForbiddenError();
    }
    const now = this.now();
    await this.repository.removeWorkspaceMember({
      workspaceId,
      userId: targetUserId,
      actorUserId: authorized.user.id,
      removedAt: now,
      auditEvent: this.createAuditEvent(
        'workspace.member.remove',
        authorized.user.id,
        workspaceId,
        'user',
        targetUserId,
        { previousRole: target.role },
      ),
    });
    this.notifyLifecycle({
      kind: 'workspace_removed',
      email: targetUser.email,
      displayName: targetUser.displayName,
      occurredAt: now,
      workspaceName: authorized.session.workspaces.find(
        (workspace) => workspace.id === workspaceId,
      )?.name,
      previousRole: target.role,
    });
    return this.repository.listWorkspaceMembers(workspaceId);
  }

  async transferWorkspaceOwnership(
    rawToken: string,
    workspaceId: string,
    targetUserId: string,
  ): Promise<AuthSessionView> {
    const authorized = await this.authorizeWorkspace(
      rawToken,
      workspaceId,
      'owner',
    );
    if (targetUserId === authorized.user.id) {
      throw new AuthValidationError('OWNER_ALREADY_SELECTED');
    }
    const target = await this.repository.getWorkspaceMembership(
      workspaceId,
      targetUserId,
    );
    const targetUser = await this.repository.getUserById(targetUserId);
    if (!target || target.role === 'owner') throw new AuthForbiddenError();
    if (!targetUser) throw new AuthForbiddenError();
    const now = this.now();
    await this.repository.transferWorkspaceOwnership({
      workspaceId,
      fromUserId: authorized.user.id,
      toUserId: targetUserId,
      transferredAt: now,
      auditEvent: this.createAuditEvent(
        'workspace.owner.transfer',
        authorized.user.id,
        workspaceId,
        'user',
        targetUserId,
      ),
    });
    const workspaceName = authorized.session.workspaces.find(
      (workspace) => workspace.id === workspaceId,
    )?.name;
    this.notifyLifecycle({
      kind: 'ownership_transferred',
      email: authorized.user.email,
      displayName: authorized.user.displayName,
      occurredAt: now,
      workspaceName,
      previousRole: 'owner',
      role: 'admin',
    });
    this.notifyLifecycle({
      kind: 'ownership_received',
      email: targetUser.email,
      displayName: targetUser.displayName,
      occurredAt: now,
      workspaceName,
      previousRole: target.role,
      role: 'owner',
    });
    return this.getSession(rawToken);
  }

  private async verifyDestructivePassword(
    user: AuthUserRecord,
    password: string,
  ) {
    if (!(await verifyPassword(password, user.password, this.crypto))) {
      throw new InvalidCredentialsError();
    }
  }

  async deleteWorkspace(
    rawToken: string,
    workspaceId: string,
    password: string,
    confirmation: string,
  ): Promise<AuthSessionView> {
    const resolved = await this.resolveSession(rawToken);
    const authorized = await this.authorizeWorkspace(
      rawToken,
      workspaceId,
      'owner',
    );
    const workspace = resolved.view.workspaces.find(
      (candidate) => candidate.id === workspaceId,
    );
    if (!workspace || confirmation.trim() !== workspace.name) {
      throw new AuthValidationError('WORKSPACE_CONFIRMATION_MISMATCH');
    }
    await this.verifyDestructivePassword(resolved.user, password);
    const now = this.now();
    const affectedMembers = await this.repository.listWorkspaceMembers(
      workspaceId,
    );
    await this.repository.deleteWorkspace({
      workspaceId,
      actorUserId: authorized.user.id,
      deletedAt: now,
      auditEvent: this.createAuditEvent(
        'workspace.delete',
        authorized.user.id,
        workspaceId,
        'workspace',
        workspaceId,
      ),
    });
    for (const member of affectedMembers) {
      this.notifyLifecycle({
        kind: 'workspace_deleted',
        email: member.email,
        displayName: member.displayName,
        occurredAt: now,
        workspaceName: workspace.name,
        previousRole: member.role,
      });
    }
    return this.getSession(rawToken);
  }

  async deleteAccount(
    rawToken: string,
    password: string,
    confirmation: string,
  ): Promise<void> {
    const resolved = await this.resolveSession(rawToken);
    if (confirmation.trim().toLocaleLowerCase('en-US') !== 'delete') {
      throw new AuthValidationError('ACCOUNT_CONFIRMATION_MISMATCH');
    }
    await this.verifyDestructivePassword(resolved.user, password);
    if (resolved.view.workspaces.some((workspace) => workspace.role === 'owner')) {
      throw new AuthValidationError('OWNER_TRANSFER_REQUIRED');
    }
    const now = this.now();
    await this.repository.deleteUser({
      userId: resolved.user.id,
      deletedAt: now,
      auditEvent: this.createAuditEvent(
        'account.delete',
        undefined,
        undefined,
        'account',
      ),
    });
    this.notifyLifecycle({
      kind: 'account_deleted',
      email: resolved.user.email,
      displayName: resolved.user.displayName,
      occurredAt: now,
    });
  }

  async consumeRateLimit(
    scope: AuthRateLimitScope,
    subject: string,
    policy: AuthRateLimitPolicy,
  ): Promise<AuthRateLimitResult> {
    if (
      !Number.isFinite(policy.windowMs) ||
      policy.windowMs <= 0 ||
      !Number.isInteger(policy.maxAttempts) ||
      policy.maxAttempts < 1 ||
      !Number.isFinite(policy.blockMs) ||
      policy.blockMs <= 0
    ) {
      throw new Error('Invalid authentication rate-limit policy');
    }
    return this.repository.consumeAuthRateLimit({
      scope,
      subjectHash: await hashOpaqueToken(subject, this.crypto),
      now: this.now(),
      windowMs: Math.floor(policy.windowMs),
      maxAttempts: policy.maxAttempts,
      blockMs: Math.floor(policy.blockMs),
    });
  }

  async claimLegacyWorkspace(
    rawToken: string,
    workspaceId: string,
  ): Promise<AuthSessionView> {
    if (!CLOUD_WORKSPACE_ID_PATTERN.test(workspaceId)) {
      throw new AuthValidationError('INVALID_LEGACY_WORKSPACE');
    }
    const resolved = await this.resolveSession(rawToken);
    const now = this.now();
    await this.repository.claimLegacyWorkspace({
      workspaceId,
      userId: resolved.user.id,
      createdAt: now,
      auditEvent: this.createAuditEvent(
        'workspace.legacy_claim',
        resolved.user.id,
        workspaceId,
        'workspace',
        workspaceId,
      ),
    });
    await this.repository.setAuthSessionActiveWorkspace(
      resolved.tokenHash,
      workspaceId,
    );
    return this.getSession(rawToken);
  }

  async createWorkspace(
    rawToken: string,
    name: string,
    initialData: AppData,
  ): Promise<AuthSessionView> {
    const workspaceName = validateLabel(
      name,
      120,
      'INVALID_WORKSPACE_NAME',
    );
    const resolved = await this.resolveSession(rawToken);
    if (resolved.user.emailVerifiedAt == null) {
      throw new EmailVerificationRequiredError();
    }
    const now = this.now();
    const workspaceId = randomId(this.crypto, 'ws_', 24);
    await this.repository.createWorkspaceForUser({
      workspace: {
        id: workspaceId,
        name: workspaceName,
        data: initialData,
        createdAt: now,
      },
      membership: {
        workspaceId,
        userId: resolved.user.id,
        role: 'owner',
        createdAt: now,
        createdByUserId: resolved.user.id,
      },
      auditEvent: this.createAuditEvent(
        'workspace.create',
        resolved.user.id,
        workspaceId,
        'workspace',
        workspaceId,
      ),
    });
    await this.repository.setAuthSessionActiveWorkspace(
      resolved.tokenHash,
      workspaceId,
    );
    return this.getSession(rawToken);
  }
}
