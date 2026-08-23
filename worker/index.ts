import type {
  D1Database,
  ExecutionContext,
  ScheduledController,
} from '@cloudflare/workers-types';
import { createApiHandler } from '../server/api';
import {
  createAccountLifecycleMailer,
  createEmailVerificationMailer,
  createPasswordResetMailer,
  createWorkspaceInvitationMailer,
} from './passwordResetEmail';
import { createTurnstileVerifier } from './turnstile';
import {
  D1WorkspaceRepository,
  type WorkspaceReadMode,
} from './repository';

type Env = {
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

const secureResponse = (response: Response, includeDocumentPolicy = false) => {
  const secured = new Response(response.body, response);
  secured.headers.set('x-content-type-options', 'nosniff');
  secured.headers.set('referrer-policy', 'no-referrer');
  secured.headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  secured.headers.set('cross-origin-opener-policy', 'same-origin');
  secured.headers.set('cross-origin-resource-policy', 'same-origin');
  secured.headers.set(
    'strict-transport-security',
    'max-age=31536000; includeSubDomains',
  );
  if (includeDocumentPolicy) {
    secured.headers.set(
      'content-security-policy',
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; " +
      "font-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' https://challenges.cloudflare.com; " +
      "frame-src https://challenges.cloudflare.com; " +
      "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; " +
      "object-src 'none'; upgrade-insecure-requests",
    );
    secured.headers.set('cache-control', 'no-cache');
  }
  return secured;
};

const resolveWorkspaceReadMode = (value?: string): WorkspaceReadMode =>
  value === 'blob' || value === 'verify' ? value : 'normalized';

export default {
  fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request).then((response) =>
        secureResponse(
          response,
          response.headers.get('content-type')?.includes('text/html') === true,
        ));
    }
    const passwordResetMailer = createPasswordResetMailer(env);
    const workspaceInvitationMailer = createWorkspaceInvitationMailer(env);
    const emailVerificationMailer = createEmailVerificationMailer(env);
    const accountLifecycleMailer = createAccountLifecycleMailer(env);
    return createApiHandler(new D1WorkspaceRepository(env.DB, {
      readMode: resolveWorkspaceReadMode(env.WORKSPACE_READ_MODE),
    }), {
      allowLocalWorkspaceIds: false,
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
    })(request).then((response) => secureResponse(response));
  },
  scheduled(
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): void {
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
        }),
    );
  },
};
