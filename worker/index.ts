import type {
  D1Database,
  ExecutionContext,
  ScheduledController,
} from '@cloudflare/workers-types';
import { createApiHandler } from '../server/api';
import { MONITORING_PATH, monitoringMethod, monitoringRouteGroup, resolveMonitoringConfig, safelyReport } from '../shared/observability/policy';
import { createWorkerReporter, type MonitoringEnv } from './monitoring';
import { handleMonitoringRelay } from './monitoringRelay';
import {
  createAccountLifecycleMailer,
  createEmailVerificationMailer,
  createPasswordResetMailer,
  createWorkspaceInvitationMailer,
} from '../shared/services/accountEmail';
import { createTurnstileVerifier } from '../shared/services/turnstile';
import {
  DOCUMENT_CACHE_CONTROL,
  PRIVATE_RESPONSE_CACHE_CONTROL,
  secureResponse,
} from '../shared/security/responsePolicy';
import {
  D1WorkspaceRepository,
  type WorkspaceReadMode,
} from './repository';

type Env = MonitoringEnv & {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  BOT_PROTECTION_REQUIRED?: string;
  DB: D1Database;
  EMAIL_VERIFICATION_REQUIRED?: string;
  PASSWORD_RESET_FROM?: string;
  PUBLIC_APP_URL?: string;
  REGISTRATION_ENABLED?: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  WORKSPACE_READ_MODE?: string;
};

export type WorkerResponseKind = 'api' | 'asset' | 'document';

export const secureWorkerResponse = (
  response: Response,
  kind: WorkerResponseKind,
) => {
  const includeDocumentPolicy = kind === 'document';
  const secured = secureResponse(response, {
    cacheControl: kind === 'api'
      ? PRIVATE_RESPONSE_CACHE_CONTROL
      : includeDocumentPolicy
        ? DOCUMENT_CACHE_CONTROL
        : undefined,
    document: includeDocumentPolicy,
    strictTransportSecurity: true,
    upgradeInsecureRequests: includeDocumentPolicy,
  });
  return secured;
};

const resolveWorkspaceReadMode = (value?: string): WorkspaceReadMode =>
  value === 'blob' || value === 'verify' ? value : 'normalized';

export default {
  async fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const reporter = createWorkerReporter(env, context);
    try {
      if (url.pathname === MONITORING_PATH) {
        const config = resolveMonitoringConfig(env.MONITORING_ENVIRONMENT, env.SENTRY_FRONTEND_DSN, 'frontend', env.SENTRY_RELEASE);
        return secureWorkerResponse(await handleMonitoringRelay(
          request, Boolean(config), createWorkerReporter(env, context, 'frontend'),
        ), 'api');
      }
      if (!url.pathname.startsWith('/api/')) {
        return await env.ASSETS.fetch(request).then((response) =>
          secureWorkerResponse(
            response,
            response.headers.get('content-type')?.includes('text/html') === true
              ? 'document'
              : 'asset',
          ));
      }
      const passwordResetMailer = createPasswordResetMailer(env);
      const workspaceInvitationMailer = createWorkspaceInvitationMailer(env);
      const emailVerificationMailer = createEmailVerificationMailer(env);
      const accountLifecycleMailer = createAccountLifecycleMailer(env);
      return await createApiHandler(new D1WorkspaceRepository(env.DB, {
        readMode: resolveWorkspaceReadMode(env.WORKSPACE_READ_MODE),
      }), {
        allowLocalWorkspaceIds: false,
        monitoringReporter: reporter,
        allowedOrigins: [],
        accountLifecycleMailer,
        botChallengeVerifier: createTurnstileVerifier(env),
        botProtectionRequired: env.BOT_PROTECTION_REQUIRED === 'true',
        clientIp: (workerRequest) =>
          workerRequest.headers.get('cf-connecting-ip'),
        deferBackgroundTask: (task) => context.waitUntil(task),
        emailVerificationMailer,
        emailVerificationRequired:
          env.EMAIL_VERIFICATION_REQUIRED !== 'false',
        passwordResetMailer,
        workspaceInvitationMailer,
        registrationEnabled: env.REGISTRATION_ENABLED === 'true',
        turnstileSiteKey: env.TURNSTILE_SITE_KEY,
      })(request).then((response) => secureWorkerResponse(response, 'api'));
    } catch (error) {
      safelyReport(reporter, { category: 'worker.unhandled', route: monitoringRouteGroup(url.pathname), method: monitoringMethod(request.method) });
      throw error;
    }
  },
  scheduled(
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): void {
    const reporter = createWorkerReporter(env, context);
    const repository = new D1WorkspaceRepository(env.DB, {
      readMode: resolveWorkspaceReadMode(env.WORKSPACE_READ_MODE),
    });
    context.waitUntil(
      repository.cleanupExpiredAuthData(controller.scheduledTime)
        .then(async (cleanupResult) => {
          const reconciliationResult =
            await repository.reconcileWorkspaceProjections({ repair: true });
          console.info('Scheduled maintenance completed', {
            cleanup: cleanupResult,
            projections: reconciliationResult,
          });
        }).catch((error: unknown) => {
          safelyReport(reporter, { category: 'worker.scheduled', route: 'unknown', method: 'unknown' });
          throw error;
        }),
    );
  },
};
