import type {
  D1Database,
  ExecutionContext,
  ScheduledController,
} from '@cloudflare/workers-types';
import { createApiHandler } from '../server/api';
import {
  createPasswordResetMailer,
  createWorkspaceInvitationMailer,
} from './passwordResetEmail';
import { D1WorkspaceRepository } from './repository';

type Env = {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  PASSWORD_RESET_FROM?: string;
  PUBLIC_APP_URL?: string;
  REGISTRATION_ENABLED?: string;
  RESEND_API_KEY?: string;
};

export default {
  fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    const passwordResetMailer = createPasswordResetMailer(env);
    const workspaceInvitationMailer = createWorkspaceInvitationMailer(env);
    return createApiHandler(new D1WorkspaceRepository(env.DB), {
      allowLocalWorkspaceIds: false,
      allowedOrigins,
      deferBackgroundTask: (task) => context.waitUntil(task),
      passwordResetMailer,
      workspaceInvitationMailer,
      registrationEnabled: env.REGISTRATION_ENABLED === 'true',
    })(request);
  },
  scheduled(
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): void {
    const repository = new D1WorkspaceRepository(env.DB);
    context.waitUntil(
      repository.cleanupExpiredAuthData(controller.scheduledTime)
        .then((result) => {
          console.info('Expired authentication data cleaned', result);
        }),
    );
  },
};
