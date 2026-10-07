import {
  AuthService,
  DEFAULT_SESSION_TTL_MS,
  type AuthSessionEnvelope,
} from '../auth';
import { safelyReport } from '../../shared/observability/policy';
import type {
  ApiOptions,
  ApiRepository,
  BotChallengeVerification,
} from '../contracts/api';
import { getString } from '../http/body';
import { json } from '../http/response';
import {
  csrfCookie,
  sessionCookie,
} from '../middleware/authentication';
import { createCsrfToken } from '../middleware/csrf';
import {
  DEFAULT_FORGOT_RESPONSE_FLOOR_MS,
  getPlatformClientIdentity,
} from '../middleware/rateLimit';
import {
  BotChallengeFailedError,
  BotProtectionUnavailableError,
} from './botProtection';

export type ApiRuntime = {
  repository: ApiRepository;
  options: ApiOptions;
  authService: AuthService;
  allowedOrigins: string[];
  allowLocalWorkspaceIds: boolean;
  authenticationEnabled: boolean;
  registrationEnabled: boolean;
  botProtectionEnabled: boolean;
  turnstileSiteKey: string;
  sessionCookieMaxAgeSeconds: number;
  forgotResponseFloorMs: number;
  resolveClientIdentity: (request: Request) => string | null | undefined;
  deferBackgroundTask: (task: Promise<void>) => void;
  scheduleBackgroundDelivery: (
    task: Promise<void>,
    label: string,
  ) => void;
  verifyBotChallenge: (
    request: Request,
    body: Record<string, unknown>,
    action: BotChallengeVerification['action'],
  ) => Promise<void>;
  authenticatedJson: (
    envelope: AuthSessionEnvelope,
    status: number,
    headers: HeadersInit,
    extra?: Record<string, unknown>,
  ) => Response;
};

export const createApiRuntime = (
  repository: ApiRepository,
  options: ApiOptions,
): ApiRuntime => {
  const allowedOrigins = options.allowedOrigins ?? [];
  const allowLocalWorkspaceIds = options.allowLocalWorkspaceIds ?? true;
  const emailVerificationRequired =
    options.emailVerificationRequired === true;
  const botProtectionRequired = options.botProtectionRequired === true;
  const turnstileSiteKey = options.turnstileSiteKey?.trim() ?? '';
  const botProtectionEnabled = Boolean(
    options.botChallengeVerifier && turnstileSiteKey,
  );
  const authenticationEnabled =
    !botProtectionRequired || botProtectionEnabled;
  const registrationEnabled = options.registrationEnabled === true &&
    authenticationEnabled &&
    (!emailVerificationRequired || Boolean(options.emailVerificationMailer));
  const sessionCookieMaxAgeSeconds = Math.max(
    60,
    Math.floor(
      options.sessionCookieMaxAgeSeconds ??
      (options.auth?.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS) / 1000,
    ),
  );
  const resolveClientIdentity =
    options.clientIdentity ?? getPlatformClientIdentity;
  const resolveClientIp = options.clientIp ?? (() => undefined);
  const deferBackgroundTask = options.deferBackgroundTask ?? (() => undefined);
  const forgotResponseFloorMs = Number.isFinite(options.forgotResponseFloorMs)
    ? Math.min(2_000, Math.max(0, options.forgotResponseFloorMs ?? 0))
    : DEFAULT_FORGOT_RESPONSE_FLOOR_MS;
  const scheduleBackgroundDelivery = (
    task: Promise<void>,
    label: string,
  ) => {
    const handledTask = task.catch(() => {
      console.error('Background delivery failed');
      safelyReport(options.monitoringReporter, { category: 'worker.background', route: 'auth', method: 'unknown' });
    });
    try {
      deferBackgroundTask(handledTask);
    } catch {
      console.error('Background delivery scheduling failed');
      safelyReport(options.monitoringReporter, { category: 'worker.background', route: 'auth', method: 'unknown' });
    }
  };
  const authService = new AuthService(repository, {
    ...options.auth,
    emailVerificationRequired,
    lifecycleNotifier: options.accountLifecycleMailer
      ? (delivery) => scheduleBackgroundDelivery(
          options.accountLifecycleMailer!(delivery),
          'Account lifecycle',
        )
      : undefined,
  });

  const verifyBotChallenge = async (
    request: Request,
    body: Record<string, unknown>,
    action: BotChallengeVerification['action'],
  ) => {
    if (!botProtectionEnabled) {
      if (botProtectionRequired) throw new BotProtectionUnavailableError();
      return;
    }
    const candidate = getString(body.turnstileToken);
    if (!candidate || candidate.length > 2_048) {
      throw new BotChallengeFailedError();
    }
    const verified = await options.botChallengeVerifier!({
      token: candidate,
      action,
      remoteIp: resolveClientIp(request)?.trim() || undefined,
      expectedHostname: new URL(request.url).hostname,
    });
    if (!verified) throw new BotChallengeFailedError();
  };

  const authenticatedJson = (
    envelope: AuthSessionEnvelope,
    status: number,
    headers: HeadersInit,
    extra: Record<string, unknown> = {},
  ) => {
    const csrfToken = createCsrfToken();
    const responseHeaders = new Headers(headers);
    responseHeaders.append(
      'set-cookie',
      sessionCookie(envelope.sessionToken, sessionCookieMaxAgeSeconds),
    );
    responseHeaders.append(
      'set-cookie',
      csrfCookie(csrfToken, sessionCookieMaxAgeSeconds),
    );
    return json(
      { session: envelope.session, csrfToken, ...extra },
      status,
      responseHeaders,
    );
  };

  return {
    repository,
    options,
    authService,
    allowedOrigins,
    allowLocalWorkspaceIds,
    authenticationEnabled,
    registrationEnabled,
    botProtectionEnabled,
    turnstileSiteKey,
    sessionCookieMaxAgeSeconds,
    forgotResponseFloorMs,
    resolveClientIdentity,
    deferBackgroundTask,
    scheduleBackgroundDelivery,
    verifyBotChallenge,
    authenticatedJson,
  };
};
