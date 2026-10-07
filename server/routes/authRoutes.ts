import {
  AuthValidationError,
  InvalidEmailVerificationTokenError,
  InvalidPasswordResetTokenError,
  InvalidSessionError,
  isEmailVerificationToken,
  isPasswordResetToken,
} from '../auth';
import {
  WorkspaceAlreadyClaimedError,
  WorkspaceNotFoundError,
} from '../contracts';
import { MAX_AUTH_BODY_BYTES, getString, readJsonBody } from '../http/body';
import { json } from '../http/response';
import {
  CSRF_COOKIE_NAME,
  CSRF_TOKEN_PATTERN,
  csrfCookie,
  getSessionToken,
  parseCookies,
  withClearedAuthCookies,
} from '../middleware/authentication';
import { createCsrfToken, validateCsrf } from '../middleware/csrf';
import {
  consumeRequestRateLimit,
  normalizeClientIdentity,
  waitForResponseFloor,
} from '../middleware/rateLimit';
import type { ApiRuntime } from '../services/apiRuntime';
import { safelyReport } from '../../shared/observability/policy';
import { isAppData } from '../services/workspaceValidation';
import { createInitialData, normalizeAppData } from '../../src/store/utils';
import type { AuthenticatedRouteContext, RouteResult } from './types';

type AuthRouteContext = {
  request: Request;
  url: URL;
  headers: HeadersInit;
  runtime: ApiRuntime;
};

const legacyClaimErrorCode = (error: unknown) => {
  if (error instanceof AuthValidationError) return error.code;
  if (error instanceof WorkspaceNotFoundError) return 'WORKSPACE_NOT_FOUND';
  if (error instanceof WorkspaceAlreadyClaimedError) {
    return 'WORKSPACE_ALREADY_CLAIMED';
  }
  return 'LEGACY_CLAIM_FAILED';
};

const rateLimitedResponse = (
  retryAfterMs: number,
  headers: HeadersInit,
) => json(
  { error: 'RATE_LIMITED' },
  429,
  {
    ...headers,
    'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
  },
);

export const handleAuthRoutes = async (
  context: AuthRouteContext,
): RouteResult => {
  const { request, url, headers, runtime } = context;
  const {
    authService,
    options,
    registrationEnabled,
    sessionCookieMaxAgeSeconds,
    resolveClientIdentity,
    deferBackgroundTask,
    forgotResponseFloorMs,
    scheduleBackgroundDelivery,
    verifyBotChallenge,
    authenticatedJson,
  } = runtime;

  if (
    request.method === 'POST' &&
    url.pathname === '/api/v1/auth/register'
  ) {
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
    if (options.registrationEnabled !== true) {
      return json({ error: 'REGISTRATION_DISABLED' }, 403, headers);
    }
    if (!registrationEnabled) {
      return json(
        { error: 'REGISTRATION_CONFIGURATION_INCOMPLETE' },
        503,
        headers,
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
      return rateLimitedResponse(rateLimit.retryAfterMs, headers);
    }
    await verifyBotChallenge(request, body, 'register');

    const displayName = getString(body.displayName);
    const initialWorkspaceData = isAppData(body.initialWorkspaceData)
      ? normalizeAppData(body.initialWorkspaceData)
      : createInitialData();
    const registration = await authService.register({
      email,
      password: getString(body.password),
      displayName,
      workspaceName:
        getString(body.workspaceName) ||
        `${displayName.trim() || 'ePet'} 的班級`,
      initialWorkspaceData,
    });
    const { emailVerification, ...envelope } = registration;
    if (emailVerification && options.emailVerificationMailer) {
      scheduleBackgroundDelivery(
        options.emailVerificationMailer(emailVerification),
        'Email verification',
      );
    }

    const legacyWorkspaceId = getString(body.legacyWorkspaceId);
    if (!legacyWorkspaceId) {
      return authenticatedJson(envelope, 201, headers);
    }
    try {
      const session = await authService.claimLegacyWorkspace(
        envelope.sessionToken,
        legacyWorkspaceId,
      );
      return authenticatedJson(
        { ...envelope, session },
        201,
        headers,
        {
          legacyClaim: {
            status: 'claimed',
            workspaceId: legacyWorkspaceId,
          },
        },
      );
    } catch (error) {
      return authenticatedJson(
        envelope,
        201,
        headers,
        {
          legacyClaim: {
            status: 'failed',
            workspaceId: legacyWorkspaceId,
            error: legacyClaimErrorCode(error),
          },
        },
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
      return rateLimitedResponse(rateLimit.retryAfterMs, headers);
    }
    await verifyBotChallenge(request, body, 'login');
    return authenticatedJson(
      await authService.login({
        email,
        password: getString(body.password),
      }),
      200,
      headers,
    );
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/api/v1/auth/session'
  ) {
    const token = getSessionToken(request);
    if (!token) throw new InvalidSessionError();
    const existingCsrfToken = parseCookies(request).get(CSRF_COOKIE_NAME) ?? '';
    const csrfToken = CSRF_TOKEN_PATTERN.test(existingCsrfToken)
      ? existingCsrfToken
      : createCsrfToken();
    const responseHeaders = new Headers(headers);
    responseHeaders.append(
      'set-cookie',
      csrfCookie(csrfToken, sessionCookieMaxAgeSeconds),
    );
    return json(
      { session: await authService.getSession(token), csrfToken },
      200,
      responseHeaders,
    );
  }

  if (
    request.method === 'POST' &&
    url.pathname === '/api/v1/auth/logout'
  ) {
    const token = getSessionToken(request);
    if (!token) throw new InvalidSessionError();
    validateCsrf(request);
    await authService.logout(token);
    return new Response(null, {
      status: 204,
      headers: withClearedAuthCookies({
        ...headers,
        'cache-control': 'no-store',
      }),
    });
  }

  if (
    request.method === 'POST' &&
    url.pathname === '/api/v1/auth/email/verify'
  ) {
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
    const verificationToken = getString(body.token);
    if (!isEmailVerificationToken(verificationToken)) {
      throw new InvalidEmailVerificationTokenError();
    }
    const rateLimit = await consumeRequestRateLimit(
      authService,
      'verify',
      normalizeClientIdentity(resolveClientIdentity(request)),
      verificationToken,
    );
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit.retryAfterMs, headers);
    }
    await authService.verifyEmail(verificationToken);
    return json({ verified: true }, 200, headers);
  }

  if (
    request.method === 'POST' &&
    url.pathname === '/api/v1/auth/email/resend'
  ) {
    if (!options.emailVerificationMailer) {
      return json(
        { error: 'EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE' },
        503,
        headers,
      );
    }
    const token = getSessionToken(request);
    if (!token) throw new InvalidSessionError();
    validateCsrf(request);
    const session = await authService.getSession(token);
    const rateLimit = await consumeRequestRateLimit(
      authService,
      'verify',
      normalizeClientIdentity(resolveClientIdentity(request)),
      session.user.id,
    );
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit.retryAfterMs, headers);
    }
    const delivery = await authService.requestEmailVerification(token);
    if (delivery) {
      scheduleBackgroundDelivery(
        options.emailVerificationMailer(delivery),
        'Email verification',
      );
    }
    return json({ accepted: true }, 202, headers);
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
    if (rateLimit.allowed) {
      await verifyBotChallenge(request, body, 'forgot');
    }
    const deliveryTask = rateLimit.allowed
      ? Promise.resolve()
          .then(() => authService.requestPasswordReset(email))
          .then((delivery) => delivery && options.passwordResetMailer
            ? options.passwordResetMailer(delivery)
            : undefined)
          .then(() => undefined)
          .catch(() => {
            console.error('Password reset delivery failed');
            safelyReport(options.monitoringReporter, { category: 'worker.background', route: 'auth', method: 'unknown' });
          })
      : Promise.resolve();
    try {
      deferBackgroundTask(deliveryTask);
    } catch {
      console.error('Password reset delivery scheduling failed');
      safelyReport(options.monitoringReporter, { category: 'worker.background', route: 'auth', method: 'unknown' });
    }
    await waitForResponseFloor(startedAt, forgotResponseFloorMs);
    return json(
      { accepted: true },
      202,
      {
        ...headers,
        ...(!rateLimit.allowed
          ? {
              'retry-after': String(
                Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000)),
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
      return rateLimitedResponse(rateLimit.retryAfterMs, headers);
    }
    await authService.resetPassword(token, getString(body.password));
    return json(
      { ok: true },
      200,
      withClearedAuthCookies(headers),
    );
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
      return rateLimitedResponse(rateLimit.retryAfterMs, headers);
    }
    return authenticatedJson(
      await authService.acceptWorkspaceInvitation(
        invitationToken,
        getString(body.displayName),
        getString(body.password),
      ),
      201,
      headers,
    );
  }

  return undefined;
};

export const handleAccountRoutes = async (
  context: AuthenticatedRouteContext,
): RouteResult => {
  const { request, url, headers, authService, token } = context;
  if (request.method !== 'DELETE' || url.pathname !== '/api/v1/account') {
    return undefined;
  }

  const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
  await authService.deleteAccount(
    token,
    getString(body.password),
    getString(body.confirmation),
  );
  return new Response(null, {
    status: 204,
    headers: withClearedAuthCookies({
      ...headers,
      'cache-control': 'no-store',
    }),
  });
};
