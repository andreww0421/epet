import {
  LEARNING_EVIDENCE_LEVELS,
  LEARNING_EVIDENCE_TYPES,
  computeClassEffectivenessMetrics,
  computeStudentLearningAnalytics,
  createLearningEvidenceRecord,
  isLearningCompetency,
  normalizeLearningEvidenceRecords,
  type LearningEvidenceInput,
} from '../shared/education';
import { applyBossContributionRewards } from '../src/gameRules';
import type { AppData, Student, WorldBoss } from '../src/store/types';
import { createInitialData, normalizeAppData } from '../src/store/utils';
import {
  AuthForbiddenError,
  AuthService,
  AuthValidationError,
  InvalidCredentialsError,
  InvalidPasswordResetTokenError,
  InvalidSessionError,
  isPasswordResetToken,
  isRoleAtLeast,
  parseBearerToken,
  type AuthRateLimitPolicy,
  type AuthServiceOptions,
  type PasswordResetDelivery,
  type WorkspaceInvitationDelivery,
} from './auth';
import {
  EmailAlreadyExistsError,
  InvalidWorkspaceInvitationError,
  WorkspaceAlreadyClaimedError,
  WorkspaceConflictError,
  WorkspaceDataTooLargeError,
  WorkspaceMembershipNotFoundError,
  WorkspaceNotFoundError,
  WorkspaceOwnerTransferRequiredError,
  type AuthRateLimitScope,
  type AuthRateLimitResult,
  type AuthRepository,
  type WorkspaceRole,
  type WorkspaceRepository,
} from './contracts';
import {
  mergeTeacherWorkspaceData,
  scopeStoredWorkspace,
  WorkspaceScopeViolationError,
} from './workspaceScope';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_AUTH_BODY_BYTES = 16 * 1024;
const DEFAULT_FORGOT_RESPONSE_FLOOR_MS = 300;
const LOCAL_WORKSPACE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const CLOUD_WORKSPACE_PATTERN = /^ws_[a-zA-Z0-9_-]{24,61}$/;

const AUTH_RATE_LIMIT_POLICIES: Record<
  AuthRateLimitScope,
  AuthRateLimitPolicy
> = {
  login: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 10,
    blockMs: 15 * 60 * 1000,
  },
  register: {
    windowMs: 60 * 60 * 1000,
    maxAttempts: 5,
    blockMs: 60 * 60 * 1000,
  },
  forgot: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 5,
    blockMs: 15 * 60 * 1000,
  },
  reset: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 10,
    blockMs: 15 * 60 * 1000,
  },
};

const AUTH_GLOBAL_RATE_LIMIT_POLICIES: Record<
  AuthRateLimitScope,
  AuthRateLimitPolicy
> = {
  login: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 30,
    blockMs: 15 * 60 * 1000,
  },
  register: {
    windowMs: 60 * 60 * 1000,
    maxAttempts: 20,
    blockMs: 60 * 60 * 1000,
  },
  forgot: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 20,
    blockMs: 15 * 60 * 1000,
  },
  reset: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 30,
    blockMs: 15 * 60 * 1000,
  },
};

export type ApiOptions = {
  allowLocalWorkspaceIds?: boolean;
  allowedOrigins?: string[];
  auth?: AuthServiceOptions;
  passwordResetMailer?: (
    delivery: PasswordResetDelivery,
  ) => Promise<void>;
  workspaceInvitationMailer?: (
    delivery: WorkspaceInvitationDelivery,
  ) => Promise<void>;
  clientIdentity?: (request: Request) => string | null | undefined;
  deferBackgroundTask?: (task: Promise<void>) => void;
  forgotResponseFloorMs?: number;
  registrationEnabled?: boolean;
};

const json = (
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
) => Response.json(body, {
  status,
  headers: {
    'cache-control': 'no-store',
    ...headers,
  },
});

const readJsonBody = async (
  request: Request,
  maximumBytes = MAX_BODY_BYTES,
) => {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new WorkspaceDataTooLargeError();
  }
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maximumBytes) throw new WorkspaceDataTooLargeError();
  if (buffer.byteLength === 0) return {} as Record<string, unknown>;
  const parsed = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
};

const getString = (value: unknown) =>
  typeof value === 'string' ? value : '';

const getPlatformClientIdentity = (request: Request) =>
  request.headers.get('cf-connecting-ip');

const normalizeClientIdentity = (value: string | null | undefined) => {
  const normalized = value?.trim().slice(0, 256);
  return normalized || 'unknown-client';
};

const normalizeRateLimitDiscriminator = (value: string) =>
  value.trim().toLocaleLowerCase('en-US').slice(0, 512) || '<empty>';

const combineRateLimitResults = (
  globalResult: AuthRateLimitResult,
  discriminatorResult: AuthRateLimitResult,
): AuthRateLimitResult => ({
  allowed: globalResult.allowed && discriminatorResult.allowed,
  remaining: Math.min(globalResult.remaining, discriminatorResult.remaining),
  retryAfterMs: Math.max(
    globalResult.retryAfterMs,
    discriminatorResult.retryAfterMs,
  ),
});

const consumeRequestRateLimit = async (
  authService: AuthService,
  scope: AuthRateLimitScope,
  clientIdentity: string,
  discriminator: string,
) => {
  const normalizedDiscriminator = normalizeRateLimitDiscriminator(discriminator);
  const [globalResult, discriminatorResult] = await Promise.all([
    authService.consumeRateLimit(
      scope,
      `client:${clientIdentity}`,
      AUTH_GLOBAL_RATE_LIMIT_POLICIES[scope],
    ),
    authService.consumeRateLimit(
      scope,
      `subject:${normalizedDiscriminator}`,
      AUTH_RATE_LIMIT_POLICIES[scope],
    ),
  ]);
  return combineRateLimitResults(globalResult, discriminatorResult);
};

const waitForResponseFloor = async (startedAt: number, floorMs: number) => {
  const remainingMs = floorMs - (performance.now() - startedAt);
  if (remainingMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
};

const getRequestId = (request: Request) => {
  const value = request.headers.get('x-request-id')?.trim() ?? '';
  return /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : undefined;
};

const getWorkspaceId = (request: Request, allowLocalWorkspaceIds: boolean) => {
  const candidate = request.headers.get('x-epet-workspace') ?? '';
  const pattern = allowLocalWorkspaceIds
    ? LOCAL_WORKSPACE_PATTERN
    : CLOUD_WORKSPACE_PATTERN;
  return pattern.test(candidate) ? candidate : null;
};

const isAppData = (value: unknown): value is AppData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AppData>;
  return (
    typeof data.currentClassId === 'string' &&
    Array.isArray(data.classes) &&
    data.classes.every(
      (classData) =>
        classData &&
        typeof classData === 'object' &&
        typeof classData.id === 'string' &&
        Array.isArray(classData.students),
    )
  );
};

const isLearningEvidenceInput = (value: unknown): value is LearningEvidenceInput => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<LearningEvidenceInput>;
  return (
    isLearningCompetency(input.competency) &&
    LEARNING_EVIDENCE_LEVELS.includes(input.level as never) &&
    LEARNING_EVIDENCE_TYPES.includes(input.evidenceType as never) &&
    typeof input.title === 'string' &&
    Boolean(input.title.trim())
  );
};

const isBossResolutionPayload = (
  students: unknown,
  boss: unknown,
): students is Student[] =>
  Array.isArray(students) &&
  students.every(
    (student) =>
      student &&
      typeof student === 'object' &&
      typeof student.id === 'string' &&
      typeof student.name === 'string' &&
      typeof student.points === 'number' &&
      student.pet &&
      typeof student.pet === 'object' &&
      typeof student.pet.level === 'number',
  ) &&
  Boolean(
    boss &&
    typeof boss === 'object' &&
    typeof (boss as Partial<WorldBoss>).id === 'string' &&
    typeof (boss as Partial<WorldBoss>).name === 'string' &&
    Array.isArray((boss as Partial<WorldBoss>).rewardTiers) &&
    (boss as Partial<WorldBoss>).contributions &&
    typeof (boss as Partial<WorldBoss>).contributions === 'object',
  );

const getWindowDays = (url: URL) => {
  const value = Number(url.searchParams.get('windowDays'));
  return Number.isFinite(value) ? Math.min(180, Math.max(7, Math.floor(value))) : 28;
};

const getRevisionNumber = (value: string) => {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) ? revision : null;
};

const getRevisionLimit = (url: URL) => {
  const rawLimit = url.searchParams.get('limit');
  if (rawLimit == null) return 25;
  const limit = Number(rawLimit);
  return Number.isInteger(limit) && limit > 0
    ? Math.min(200, limit)
    : null;
};

const createStudentPrivacyRecord = (student: Student) => ({
  id: student.id,
  name: student.name,
  points: student.points,
  pet: student.pet,
  stats: student.stats,
  rankPoints: student.rankPoints,
  warningPoints: student.warningPoints,
  activeWarningTimestamps: student.activeWarningTimestamps,
  nextUpgradeGachaLevel: student.nextUpgradeGachaLevel,
  penaltyStatus: student.penaltyStatus,
  disciplineRecords: student.disciplineRecords,
  pointAdjustmentRecords: student.pointAdjustmentRecords,
  bossRewardRecords: student.bossRewardRecords,
  dailyProgress: student.dailyProgress,
  lastBossDamage: student.lastBossDamage,
  lastBossFairScore: student.lastBossFairScore,
  badges: student.badges,
});

const getCorsHeaders = (request: Request, allowedOrigins: string[]) => {
  const requestOrigin = request.headers.get('origin');
  const allowAny = allowedOrigins.includes('*');
  const allowedOrigin =
    allowAny || !requestOrigin || allowedOrigins.includes(requestOrigin)
      ? allowAny
        ? '*'
        : requestOrigin
      : null;
  return {
    allowed: Boolean(allowedOrigin || !requestOrigin),
    headers: {
      ...(allowedOrigin ? { 'access-control-allow-origin': allowedOrigin } : {}),
      'access-control-allow-headers':
        'authorization, content-type, x-epet-workspace, x-request-id',
      'access-control-allow-methods': 'GET, PUT, POST, PATCH, DELETE, OPTIONS',
      vary: 'Origin',
    },
  };
};

const legacyClaimErrorCode = (error: unknown) => {
  if (error instanceof AuthValidationError) return error.code;
  if (error instanceof WorkspaceNotFoundError) return 'WORKSPACE_NOT_FOUND';
  if (error instanceof WorkspaceAlreadyClaimedError) {
    return 'WORKSPACE_ALREADY_CLAIMED';
  }
  return 'LEGACY_CLAIM_FAILED';
};

const enforceRole = (
  actual: WorkspaceRole,
  required: WorkspaceRole,
) => {
  if (!isRoleAtLeast(actual, required)) throw new AuthForbiddenError();
};

export const createApiHandler = (
  repository: WorkspaceRepository & AuthRepository,
  options: ApiOptions = {},
) => {
  const allowedOrigins = options.allowedOrigins ?? ['*'];
  const allowLocalWorkspaceIds = options.allowLocalWorkspaceIds ?? true;
  const registrationEnabled = options.registrationEnabled === true;
  const resolveClientIdentity = options.clientIdentity ?? getPlatformClientIdentity;
  const deferBackgroundTask = options.deferBackgroundTask ?? (() => undefined);
  const forgotResponseFloorMs = Number.isFinite(options.forgotResponseFloorMs)
    ? Math.min(2_000, Math.max(0, options.forgotResponseFloorMs ?? 0))
    : DEFAULT_FORGOT_RESPONSE_FLOOR_MS;
  const authService = new AuthService(repository, options.auth);

  return async (request: Request): Promise<Response> => {
    const cors = getCorsHeaders(request, allowedOrigins);
    if (!cors.allowed) {
      return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, cors.headers);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors.headers });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      return json(
        {
          ok: true,
          service: 'epet-api',
          version: 1,
          registrationEnabled,
          invitationEnabled: Boolean(options.workspaceInvitationMailer),
        },
        200,
        cors.headers,
      );
    }

    try {
      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/auth/register'
      ) {
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        if (!registrationEnabled) {
          return json(
            { error: 'REGISTRATION_DISABLED' },
            403,
            cors.headers,
          );
        }
        const email = getString(body.email);
        const rateLimit = await consumeRequestRateLimit(
          authService,
          'register',
          normalizeClientIdentity(resolveClientIdentity(request)),
          email,
        );
        if (!rateLimit.allowed) {
          return json(
            { error: 'RATE_LIMITED' },
            429,
            {
              ...cors.headers,
              'retry-after': String(
                Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000)),
              ),
            },
          );
        }

        const displayName = getString(body.displayName);
        const initialWorkspaceData = isAppData(body.initialWorkspaceData)
          ? normalizeAppData(body.initialWorkspaceData)
          : createInitialData();
        const envelope = await authService.register({
          email,
          password: getString(body.password),
          displayName,
          workspaceName:
            getString(body.workspaceName) ||
            `${displayName.trim() || 'ePet'} 的班級`,
          initialWorkspaceData,
        });

        const legacyWorkspaceId = getString(body.legacyWorkspaceId);
        if (!legacyWorkspaceId) {
          return json(envelope, 201, cors.headers);
        }
        try {
          const session = await authService.claimLegacyWorkspace(
            envelope.sessionToken,
            legacyWorkspaceId,
          );
          return json(
            {
              ...envelope,
              session,
              legacyClaim: {
                status: 'claimed',
                workspaceId: legacyWorkspaceId,
              },
            },
            201,
            cors.headers,
          );
        } catch (error) {
          return json(
            {
              ...envelope,
              legacyClaim: {
                status: 'failed',
                workspaceId: legacyWorkspaceId,
                error: legacyClaimErrorCode(error),
              },
            },
            201,
            cors.headers,
          );
        }
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/auth/login'
      ) {
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        const email = getString(body.email);
        const rateLimit = await consumeRequestRateLimit(
          authService,
          'login',
          normalizeClientIdentity(resolveClientIdentity(request)),
          email,
        );
        if (!rateLimit.allowed) {
          return json(
            { error: 'RATE_LIMITED' },
            429,
            {
              ...cors.headers,
              'retry-after': String(
                Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000)),
              ),
            },
          );
        }
        return json(
          await authService.login({
            email,
            password: getString(body.password),
          }),
          200,
          cors.headers,
        );
      }

      if (
        request.method === 'GET' &&
        url.pathname === '/api/v1/auth/session'
      ) {
        const token = parseBearerToken(
          request.headers.get('authorization'),
        );
        if (!token) throw new InvalidSessionError();
        return json(
          { session: await authService.getSession(token) },
          200,
          cors.headers,
        );
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/auth/logout'
      ) {
        const token = parseBearerToken(
          request.headers.get('authorization'),
        );
        if (!token) throw new InvalidSessionError();
        await authService.logout(token);
        return new Response(null, {
          status: 204,
          headers: {
            ...cors.headers,
            'cache-control': 'no-store',
          },
        });
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/auth/password/forgot'
      ) {
        const startedAt = performance.now();
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        const email = getString(body.email);
        const rateLimit = await consumeRequestRateLimit(
          authService,
          'forgot',
          normalizeClientIdentity(resolveClientIdentity(request)),
          email,
        );
        const deliveryTask = rateLimit.allowed
          ? Promise.resolve()
              .then(() => authService.requestPasswordReset(email))
              .then((delivery) => delivery && options.passwordResetMailer
                ? options.passwordResetMailer(delivery)
                : undefined)
              .then(() => undefined)
              .catch((error: unknown) => {
                console.error('Password reset delivery failed', error);
              })
          : Promise.resolve();
        try {
          deferBackgroundTask(deliveryTask);
        } catch (error) {
          console.error('Password reset delivery scheduling failed', error);
        }
        await waitForResponseFloor(startedAt, forgotResponseFloorMs);
        return json(
          { accepted: true },
          202,
          {
            ...cors.headers,
            ...(!rateLimit.allowed
              ? {
                  'retry-after': String(
                    Math.max(
                      1,
                      Math.ceil(rateLimit.retryAfterMs / 1000),
                    ),
                  ),
                }
              : {}),
          },
        );
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/auth/password/reset'
      ) {
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        const token = getString(body.token);
        if (!isPasswordResetToken(token)) {
          throw new InvalidPasswordResetTokenError();
        }
        const rateLimit = await consumeRequestRateLimit(
          authService,
          'reset',
          normalizeClientIdentity(resolveClientIdentity(request)),
          token,
        );
        if (!rateLimit.allowed) {
          return json(
            { error: 'RATE_LIMITED' },
            429,
            {
              ...cors.headers,
              'retry-after': String(
                Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000)),
              ),
            },
          );
        }
        await authService.resetPassword(
          token,
          getString(body.password),
        );
        return json({ ok: true }, 200, cors.headers);
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/auth/invitations/accept'
      ) {
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        const invitationToken = getString(body.token);
        const rateLimit = await consumeRequestRateLimit(
          authService,
          'reset',
          normalizeClientIdentity(resolveClientIdentity(request)),
          invitationToken,
        );
        if (!rateLimit.allowed) {
          return json(
            { error: 'RATE_LIMITED' },
            429,
            {
              ...cors.headers,
              'retry-after': String(
                Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000)),
              ),
            },
          );
        }
        return json(
          await authService.acceptWorkspaceInvitation(
            invitationToken,
            getString(body.displayName),
            getString(body.password),
          ),
          201,
          cors.headers,
        );
      }

      const token = parseBearerToken(
        request.headers.get('authorization'),
      );
      if (!token) throw new InvalidSessionError();

      if (
        request.method === 'DELETE' &&
        url.pathname === '/api/v1/account'
      ) {
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        await authService.deleteAccount(
          token,
          getString(body.password),
          getString(body.confirmation),
        );
        return new Response(null, {
          status: 204,
          headers: { ...cors.headers, 'cache-control': 'no-store' },
        });
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/workspaces'
      ) {
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        return json(
          {
            session: await authService.createWorkspace(
              token,
              getString(body.name),
              createInitialData(),
            ),
          },
          201,
          cors.headers,
        );
      }

      const workspaceId = getWorkspaceId(
        request,
        allowLocalWorkspaceIds,
      );
      if (!workspaceId) {
        return json({ error: 'INVALID_WORKSPACE' }, 400, cors.headers);
      }
      const authorized = await authService.authorizeWorkspace(
        token,
        workspaceId,
        'viewer',
      );
      const getClassScope = async () => {
        if (isRoleAtLeast(authorized.membership.role, 'admin')) return null;
        const classIds = await repository.listWorkspaceClassIds(
          workspaceId,
          authorized.user.id,
        );
        if (classIds.length === 0) throw new AuthForbiddenError();
        return new Set(classIds);
      };
      const requireClassAccess = async (classId: string) => {
        const classScope = await getClassScope();
        if (classScope && !classScope.has(classId)) {
          throw new AuthForbiddenError();
        }
      };

      if (
        request.method === 'GET' &&
        url.pathname === '/api/v1/members'
      ) {
        return json(
          { members: await authService.listWorkspaceMembers(token, workspaceId) },
          200,
          cors.headers,
        );
      }

      if (url.pathname === '/api/v1/invitations') {
        if (request.method === 'GET') {
          return json(
            {
              invitations: await authService.listWorkspaceInvitations(
                token,
                workspaceId,
              ),
            },
            200,
            cors.headers,
          );
        }
        if (request.method === 'POST') {
          if (!options.workspaceInvitationMailer) {
            return json(
              { error: 'INVITATION_DELIVERY_UNAVAILABLE' },
              503,
              cors.headers,
            );
          }
          const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
          const role = getString(body.role);
          if (!['admin', 'teacher', 'viewer'].includes(role)) {
            return json({ error: 'INVALID_ROLE' }, 400, cors.headers);
          }
          const delivery = await authService.createWorkspaceInvitation(
            token,
            workspaceId,
            getString(body.email),
            role as 'admin' | 'teacher' | 'viewer',
            Array.isArray(body.classIds)
              ? body.classIds.filter((value): value is string =>
                  typeof value === 'string')
              : [],
          );
          const deliveryTask = options.workspaceInvitationMailer(delivery)
            .catch((error: unknown) => {
              console.error('Workspace invitation delivery failed', error);
            });
          deferBackgroundTask(deliveryTask);
          return json({ accepted: true }, 202, cors.headers);
        }
      }

      const invitationRevokeMatch = url.pathname.match(
        /^\/api\/v1\/invitations\/([^/]+)$/,
      );
      if (invitationRevokeMatch && request.method === 'DELETE') {
        return json(
          {
            invitations: await authService.revokeWorkspaceInvitation(
              token,
              workspaceId,
              decodeURIComponent(invitationRevokeMatch[1]),
            ),
          },
          200,
          cors.headers,
        );
      }

      const memberMatch = url.pathname.match(
        /^\/api\/v1\/members\/([^/]+)$/,
      );
      if (memberMatch && request.method === 'PATCH') {
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        const role = getString(body.role);
        if (!['admin', 'teacher', 'viewer'].includes(role)) {
          return json({ error: 'INVALID_ROLE' }, 400, cors.headers);
        }
        const members = await authService.updateWorkspaceMember(
          token,
          workspaceId,
          decodeURIComponent(memberMatch[1]),
          role as 'admin' | 'teacher' | 'viewer',
          Array.isArray(body.classIds)
            ? body.classIds.filter((value): value is string =>
                typeof value === 'string')
            : [],
        );
        return json({ members }, 200, cors.headers);
      }
      if (memberMatch && request.method === 'DELETE') {
        const members = await authService.removeWorkspaceMember(
          token,
          workspaceId,
          decodeURIComponent(memberMatch[1]),
        );
        return json({ members }, 200, cors.headers);
      }

      const ownershipTransferMatch = url.pathname.match(
        /^\/api\/v1\/members\/([^/]+)\/transfer-ownership$/,
      );
      if (ownershipTransferMatch && request.method === 'POST') {
        return json(
          {
            session: await authService.transferWorkspaceOwnership(
              token,
              workspaceId,
              decodeURIComponent(ownershipTransferMatch[1]),
            ),
          },
          200,
          cors.headers,
        );
      }

      if (
        request.method === 'DELETE' &&
        url.pathname === '/api/v1/workspace'
      ) {
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        return json(
          {
            session: await authService.deleteWorkspace(
              token,
              workspaceId,
              getString(body.password),
              getString(body.confirmation),
            ),
          },
          200,
          cors.headers,
        );
      }

      if (url.pathname === '/api/v1/state') {
        if (request.method === 'GET') {
          const workspace = await repository.get(workspaceId);
          const classScope = await getClassScope();
          return json(
            classScope
              ? scopeStoredWorkspace(workspace, classScope)
              : workspace,
            200,
            cors.headers,
          );
        }
        if (request.method === 'PUT') {
          enforceRole(authorized.membership.role, 'teacher');
          const body = await readJsonBody(request);
          if (!isAppData(body.data)) {
            return json({ error: 'INVALID_APP_DATA' }, 400, cors.headers);
          }
          const baseRevision = Number.isInteger(body.baseRevision) &&
            Number(body.baseRevision) >= 0
            ? Number(body.baseRevision)
            : undefined;
          const writeContext = {
            actorUserId: authorized.user.id,
            action: 'workspace.state.put',
            requestId: getRequestId(request),
          };
          if (isRoleAtLeast(authorized.membership.role, 'admin')) {
            const saved = await repository.put(
              workspaceId,
              normalizeAppData(body.data),
              baseRevision,
              writeContext,
            );
            return json(saved, 200, cors.headers);
          }

          if (baseRevision == null) {
            return json(
              { error: 'BASE_REVISION_REQUIRED' },
              400,
              cors.headers,
            );
          }
          const classScope = await getClassScope();
          if (!classScope) throw new AuthForbiddenError();
          const current = await repository.get(workspaceId);
          if (!current.data) {
            return json({ error: 'STATE_REQUIRED' }, 409, cors.headers);
          }
          const merged = mergeTeacherWorkspaceData(
            current.data,
            normalizeAppData(body.data),
            classScope,
          );
          try {
            const saved = await repository.put(
              workspaceId,
              merged,
              baseRevision,
              writeContext,
            );
            return json(
              scopeStoredWorkspace(saved, classScope),
              200,
              cors.headers,
            );
          } catch (error) {
            if (error instanceof WorkspaceConflictError) {
              return json(
                {
                  error: 'REVISION_CONFLICT',
                  current: scopeStoredWorkspace(error.current, classScope),
                },
                409,
                cors.headers,
              );
            }
            throw error;
          }
        }
      }

      if (
        request.method === 'GET' &&
        url.pathname === '/api/v1/revisions'
      ) {
        enforceRole(authorized.membership.role, 'admin');
        const limit = getRevisionLimit(url);
        if (limit == null) {
          return json({ error: 'INVALID_REVISION_LIMIT' }, 400, cors.headers);
        }
        const current = await repository.get(workspaceId);
        return json(
          {
            currentRevision: current.revision,
            revisions: await repository.listWorkspaceRevisions(
              workspaceId,
              limit,
            ),
          },
          200,
          cors.headers,
        );
      }

      const revisionRestoreMatch = url.pathname.match(
        /^\/api\/v1\/revisions\/([^/]+)\/restore$/,
      );
      if (request.method === 'POST' && revisionRestoreMatch) {
        enforceRole(authorized.membership.role, 'admin');
        const revision = getRevisionNumber(revisionRestoreMatch[1]);
        if (revision == null) {
          return json({ error: 'INVALID_REVISION' }, 400, cors.headers);
        }
        const snapshot = await repository.getWorkspaceRevision(
          workspaceId,
          revision,
        );
        if (!snapshot) {
          return json({ error: 'REVISION_NOT_FOUND' }, 404, cors.headers);
        }
        const current = await repository.get(workspaceId);
        const saved = await repository.put(
          workspaceId,
          normalizeAppData(snapshot.data),
          current.revision,
          {
            actorUserId: authorized.user.id,
            action: 'workspace.revision.restore',
            requestId: getRequestId(request),
          },
        );
        return json(
          {
            restoredFromRevision: revision,
            revision: saved.revision,
            updatedAt: saved.updatedAt,
            data: saved.data,
          },
          200,
          cors.headers,
        );
      }

      const revisionSnapshotMatch = url.pathname.match(
        /^\/api\/v1\/revisions\/([^/]+)$/,
      );
      if (request.method === 'GET' && revisionSnapshotMatch) {
        enforceRole(authorized.membership.role, 'admin');
        const revision = getRevisionNumber(revisionSnapshotMatch[1]);
        if (revision == null) {
          return json({ error: 'INVALID_REVISION' }, 400, cors.headers);
        }
        const snapshot = await repository.getWorkspaceRevision(
          workspaceId,
          revision,
        );
        return snapshot
          ? json({ snapshot }, 200, cors.headers)
          : json({ error: 'REVISION_NOT_FOUND' }, 404, cors.headers);
      }

      if (
        request.method === 'GET' &&
        url.pathname === '/api/v1/privacy/export'
      ) {
        enforceRole(authorized.membership.role, 'admin');
        const workspace = await repository.get(workspaceId);
        const history = await repository.listWorkspaceRevisions(workspaceId);
        const exportedAt = new Date().toISOString();
        await repository.appendAuditEvent({
          id: `evt_${crypto.randomUUID()}`,
          workspaceId,
          actorUserId: authorized.user.id,
          action: 'workspace.privacy.export',
          targetType: 'workspace',
          targetId: workspaceId,
          metadata: {
            requestId: getRequestId(request),
            role: authorized.membership.role,
            revision: workspace.revision,
          },
          createdAt: Date.parse(exportedAt),
        });
        return json(
          {
            user: authorized.user,
            activeWorkspace: {
              id: workspaceId,
              role: authorized.membership.role,
              state: workspace.data,
            },
            revision: {
              current: workspace.revision,
              updatedAt: workspace.updatedAt,
              history,
            },
            exportedAt,
          },
          200,
          cors.headers,
        );
      }

      const studentPrivacyExportMatch = url.pathname.match(
        /^\/api\/v1\/classes\/([^/]+)\/students\/([^/]+)\/privacy\/export$/,
      );
      if (request.method === 'GET' && studentPrivacyExportMatch) {
        enforceRole(authorized.membership.role, 'admin');
        const workspace = await repository.get(workspaceId);
        const classId = decodeURIComponent(studentPrivacyExportMatch[1]);
        const studentId = decodeURIComponent(studentPrivacyExportMatch[2]);
        const classData = workspace.data?.classes.find(
          (candidate) => candidate.id === classId,
        );
        const student = classData?.students.find(
          (candidate) => candidate.id === studentId,
        );
        if (!classData || !student) {
          return json({ error: 'STUDENT_NOT_FOUND' }, 404, cors.headers);
        }
        const evidenceRecords = normalizeLearningEvidenceRecords(
          classData.learningEvidenceRecords,
          classData.id,
          new Set(classData.students.map((candidate) => candidate.id)),
        ).filter((record) => record.studentId === student.id);
        const examRecords = (classData.examRecords ?? []).flatMap((exam) => {
          const results = exam.results.filter(
            (result) => result.studentId === student.id,
          );
          return results.length > 0 ? [{ ...exam, results }] : [];
        });
        const activeBossParticipation = classData.activeBoss
          ? {
              id: classData.activeBoss.id,
              name: classData.activeBoss.name,
              maxHp: classData.activeBoss.maxHp,
              currentHp: classData.activeBoss.currentHp,
              isActive: classData.activeBoss.isActive,
              contribution:
                classData.activeBoss.contributions[student.id] ?? 0,
              attackCount:
                classData.activeBoss.attackCounts?.[student.id] ?? 0,
            }
          : null;
        const exportedAt = new Date().toISOString();
        await repository.appendAuditEvent({
          id: `evt_${crypto.randomUUID()}`,
          workspaceId,
          actorUserId: authorized.user.id,
          action: 'student.privacy.export',
          targetType: 'student',
          targetId: student.id,
          metadata: {
            classId,
            requestId: getRequestId(request),
            role: authorized.membership.role,
            revision: workspace.revision,
          },
          createdAt: Date.parse(exportedAt),
        });
        return json(
          {
            workspace: {
              id: workspaceId,
              revision: workspace.revision,
              updatedAt: workspace.updatedAt,
            },
            class: {
              id: classData.id,
              name: classData.name,
            },
            student: createStudentPrivacyRecord(student),
            learningEvidenceRecords: evidenceRecords,
            examRecords,
            activeBossParticipation,
            exportedAt,
          },
          200,
          cors.headers,
        );
      }

      const classAnalyticsMatch = url.pathname.match(
        /^\/api\/v1\/classes\/([^/]+)\/analytics$/,
      );
      if (request.method === 'GET' && classAnalyticsMatch) {
        const classId = decodeURIComponent(classAnalyticsMatch[1]);
        await requireClassAccess(classId);
        const workspace = await repository.get(workspaceId);
        const classData = workspace.data?.classes.find(
          (candidate) => candidate.id === classId,
        );
        if (!classData) {
          return json({ error: 'CLASS_NOT_FOUND' }, 404, cors.headers);
        }
        const evidence = normalizeLearningEvidenceRecords(
          classData.learningEvidenceRecords,
          classData.id,
          new Set(classData.students.map((student) => student.id)),
        );
        return json(
          computeClassEffectivenessMetrics(
            classData.students,
            evidence,
            classData.classGoals,
            Date.now(),
            getWindowDays(url),
          ),
          200,
          cors.headers,
        );
      }

      const studentAnalyticsMatch = url.pathname.match(
        /^\/api\/v1\/classes\/([^/]+)\/students\/([^/]+)\/analytics$/,
      );
      if (request.method === 'GET' && studentAnalyticsMatch) {
        const classId = decodeURIComponent(studentAnalyticsMatch[1]);
        await requireClassAccess(classId);
        const workspace = await repository.get(workspaceId);
        const studentId = decodeURIComponent(studentAnalyticsMatch[2]);
        const classData = workspace.data?.classes.find(
          (candidate) => candidate.id === classId,
        );
        const student = classData?.students.find(
          (candidate) => candidate.id === studentId,
        );
        if (!classData || !student) {
          return json({ error: 'STUDENT_NOT_FOUND' }, 404, cors.headers);
        }
        const evidence = normalizeLearningEvidenceRecords(
          classData.learningEvidenceRecords,
          classData.id,
          new Set(classData.students.map((candidate) => candidate.id)),
        );
        return json(
          computeStudentLearningAnalytics(
            student,
            evidence,
            Date.now(),
            getWindowDays(url),
          ),
          200,
          cors.headers,
        );
      }

      const evidenceMatch = url.pathname.match(
        /^\/api\/v1\/classes\/([^/]+)\/evidence$/,
      );
      if (request.method === 'POST' && evidenceMatch) {
        enforceRole(authorized.membership.role, 'teacher');
        const classId = decodeURIComponent(evidenceMatch[1]);
        await requireClassAccess(classId);
        const workspace = await repository.get(workspaceId);
        if (!workspace.data) {
          return json({ error: 'STATE_REQUIRED' }, 409, cors.headers);
        }
        const classIndex = workspace.data.classes.findIndex(
          (classData) => classData.id === classId,
        );
        const classData = workspace.data.classes[classIndex];
        const body = await readJsonBody(request);
        const studentId = typeof body.studentId === 'string' ? body.studentId : '';
        if (
          !classData ||
          !classData.students.some((student) => student.id === studentId) ||
          !isLearningEvidenceInput(body.input)
        ) {
          return json({ error: 'INVALID_EVIDENCE' }, 400, cors.headers);
        }
        const record = createLearningEvidenceRecord(
          classId,
          studentId,
          body.input,
        );
        const nextClasses = [...workspace.data.classes];
        nextClasses[classIndex] = {
          ...classData,
          learningEvidenceRecords: [
            record,
            ...(classData.learningEvidenceRecords ?? []),
          ].slice(0, 2000),
        };
        const saved = await repository.put(
          workspaceId,
          { ...workspace.data, classes: nextClasses },
          workspace.revision,
          {
            actorUserId: authorized.user.id,
            action: 'learning_evidence.create',
            requestId: getRequestId(request),
          },
        );
        return json(
          { record, revision: saved.revision },
          201,
          cors.headers,
        );
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/boss/resolve') {
        enforceRole(authorized.membership.role, 'teacher');
        await getClassScope();
        const body = await readJsonBody(request);
        if (!isBossResolutionPayload(body.students, body.boss)) {
          return json({ error: 'INVALID_BOSS_PAYLOAD' }, 400, cors.headers);
        }
        return json(
          applyBossContributionRewards(
            body.students,
            body.boss as WorldBoss,
            typeof body.now === 'number' ? body.now : Date.now(),
            typeof body.maxPoints === 'number' ? body.maxPoints : 700,
          ),
          200,
          cors.headers,
        );
      }

      return json({ error: 'NOT_FOUND' }, 404, cors.headers);
    } catch (error) {
      if (error instanceof WorkspaceConflictError) {
        return json(
          { error: 'REVISION_CONFLICT', current: error.current },
          409,
          cors.headers,
        );
      }
      if (error instanceof WorkspaceDataTooLargeError) {
        return json({ error: 'PAYLOAD_TOO_LARGE' }, 413, cors.headers);
      }
      if (error instanceof AuthValidationError) {
        return json({ error: error.code }, 400, cors.headers);
      }
      if (error instanceof InvalidCredentialsError) {
        return json({ error: 'INVALID_CREDENTIALS' }, 401, cors.headers);
      }
      if (error instanceof InvalidSessionError) {
        return json({ error: 'INVALID_SESSION' }, 401, cors.headers);
      }
      if (error instanceof AuthForbiddenError) {
        return json({ error: 'FORBIDDEN' }, 403, cors.headers);
      }
      if (error instanceof WorkspaceScopeViolationError) {
        return json({ error: error.code }, 403, cors.headers);
      }
      if (error instanceof InvalidPasswordResetTokenError) {
        return json(
          { error: 'INVALID_PASSWORD_RESET_TOKEN' },
          400,
          cors.headers,
        );
      }
      if (error instanceof EmailAlreadyExistsError) {
        return json(
          { error: 'EMAIL_ALREADY_EXISTS' },
          409,
          cors.headers,
        );
      }
      if (error instanceof WorkspaceNotFoundError) {
        return json({ error: 'WORKSPACE_NOT_FOUND' }, 404, cors.headers);
      }
      if (error instanceof WorkspaceAlreadyClaimedError) {
        return json(
          { error: 'WORKSPACE_ALREADY_CLAIMED' },
          409,
          cors.headers,
        );
      }
      if (error instanceof WorkspaceMembershipNotFoundError) {
        return json({ error: 'MEMBERSHIP_NOT_FOUND' }, 404, cors.headers);
      }
      if (error instanceof WorkspaceOwnerTransferRequiredError) {
        return json({ error: 'OWNER_TRANSFER_REQUIRED' }, 409, cors.headers);
      }
      if (error instanceof InvalidWorkspaceInvitationError) {
        return json({ error: 'INVALID_WORKSPACE_INVITATION' }, 400, cors.headers);
      }
      if (error instanceof SyntaxError) {
        return json({ error: 'INVALID_JSON' }, 400, cors.headers);
      }
      console.error(error);
      return json({ error: 'INTERNAL_ERROR' }, 500, cors.headers);
    }
  };
};
