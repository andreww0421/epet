import type { D1Database } from '@cloudflare/workers-types';
import { createApiHandler } from '../server/api';
import { D1WorkspaceRepository } from './repository';

type Env = {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    return createApiHandler(new D1WorkspaceRepository(env.DB), {
      allowLocalWorkspaceIds: false,
      allowedOrigins,
    })(request);
  },
};
