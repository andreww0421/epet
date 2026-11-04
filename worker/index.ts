import type {
  D1Database,
  ExecutionContext,
  ScheduledController,
} from '@cloudflare/workers-types';
import { createApiHandler } from '../server/api';
import { MONITORING_PATH, monitoringMethod, monitoringRouteGroup, resolveMonitoringConfig, safelyReport } from '../shared/observability/policy';
import { createWorkerReporter, monitorMailDelivery, type MonitoringEnv } from './monitoring';
import { buildScheduledOperationsReport } from '../shared/observability/operations';
import { handleMonitoringRelay } from './monitoringRelay';
import { handleProductAnalytics, PRODUCT_ANALYTICS_PATH, resolveWorkerProductAnalyticsConfig,
  type WorkerProductAnalyticsEnvironment } from './productAnalytics';
import { ProductAnalyticsRepository } from './productAnalyticsRepository';
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

type Env = MonitoringEnv & WorkerProductAnalyticsEnvironment & {
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
    const productAnalytics = resolveWorkerProductAnalyticsConfig(env);
    // Anonymous intake never constructs an auth repository or a Sentry client.
    if (url.pathname === PRODUCT_ANALYTICS_PATH) {
      try { return secureWorkerResponse(await handleProductAnalytics(request, productAnalytics.collector), 'api'); }
      catch { return secureWorkerResponse(new Response(null, { status: 503 }), 'api'); }
    }
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
      const passwordResetMailer = monitorMailDelivery(createPasswordResetMailer(env), reporter, 'auth');
      const workspaceInvitationMailer = monitorMailDelivery(createWorkspaceInvitationMailer(env), reporter, 'administration');
      const emailVerificationMailer = monitorMailDelivery(createEmailVerificationMailer(env), reporter, 'auth');
      const accountLifecycleMailer = monitorMailDelivery(createAccountLifecycleMailer(env), reporter, 'auth');
      const reportedIssues = new Set<string>();
      return await createApiHandler(new D1WorkspaceRepository(env.DB, {
        readMode: resolveWorkspaceReadMode(env.WORKSPACE_READ_MODE),
        onOperationalIssue: (issue) => {
          if (reportedIssues.has(issue)) return;
          reportedIssues.add(issue);
          safelyReport(reporter, { category: issue === 'database' ? 'worker.database' : 'worker.projection',
            route: monitoringRouteGroup(url.pathname), method: monitoringMethod(request.method) });
        },
      }), {
        allowLocalWorkspaceIds: false,
        productAnalytics: productAnalytics.onboarding,
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
    } catch {
      safelyReport(reporter, { category: 'worker.unhandled', route: monitoringRouteGroup(url.pathname), method: monitoringMethod(request.method) });
      // Do not let the platform's automatic exception logs receive raw errors.
      return secureWorkerResponse(new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
        status: 500, headers: { 'content-type': 'application/json' },
      }), 'api');
    }
  },
  scheduled(
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): void {
    const analytics = resolveWorkerProductAnalyticsConfig(env).collector;
    if (analytics.enabled && analytics.environment && analytics.database) {
      // Independent maintenance: an unavailable optional database never changes
      // business maintenance success and never forwards its error to Sentry/logs.
      context.waitUntil(Promise.resolve().then(() => new ProductAnalyticsRepository(analytics.database!, analytics.environment)
        .finalizeExpired(controller.scheduledTime)).then(() => undefined).catch(() => undefined));
    }
    const reporter = createWorkerReporter(env, context);
    const repository = new D1WorkspaceRepository(env.DB, {
      readMode: resolveWorkspaceReadMode(env.WORKSPACE_READ_MODE),
    });
    const startedAt = Date.now();
    const logReport = (outcome: 'completed' | 'failed', projection?: unknown) => {
      const report = buildScheduledOperationsReport({
        environment: env.MONITORING_ENVIRONMENT, release: env.SENTRY_RELEASE,
        scheduledTime: controller.scheduledTime, startedAt, completedAt: Date.now(), outcome, projection,
      });
      try {
        if (report) console.info('Epet operational status', report);
        else console.warn('Epet operational status unavailable');
      } catch { /* Logging is an observer, not a maintenance dependency. */ }
      if (report?.health === 'degraded') {
        safelyReport(reporter, { category: 'worker.projection', route: 'unknown', method: 'unknown' });
      } else if (!report) {
        safelyReport(reporter, { category: 'worker.configuration', route: 'unknown', method: 'unknown' });
      }
    };
    context.waitUntil(
      repository.cleanupExpiredAuthData(controller.scheduledTime)
        .then(async () => {
          const reconciliationResult =
            await repository.reconcileWorkspaceProjections({ repair: true });
          logReport('completed', reconciliationResult);
        }).catch(() => {
          logReport('failed');
          safelyReport(reporter, { category: 'worker.scheduled', route: 'unknown', method: 'unknown' });
          // Preserve the failed invocation without exposing the original SQL,
          // provider message, request or error cause to platform exception logs.
          throw new Error('EPET_SCHEDULED_MAINTENANCE_FAILED');
        }),
    );
  },
};
