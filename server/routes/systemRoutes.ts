import { json } from '../http/response';
import type { RouteHandler, SystemRouteContext } from './types';

export const handleSystemRoutes: RouteHandler<SystemRouteContext> = async (
  context,
) => {
  const {
    request,
    url,
    headers,
    authenticationEnabled,
    registrationEnabled,
    invitationEnabled,
    emailVerificationEnabled,
    lifecycleNotificationsEnabled,
    botProtectionEnabled,
    turnstileSiteKey,
  } = context;

  if (request.method !== 'GET' || url.pathname !== '/api/v1/health') {
    return undefined;
  }

  return json(
    {
      ok: true,
      service: 'epet-api',
      version: 1,
      authenticationEnabled,
      registrationEnabled,
      invitationEnabled,
      emailVerificationEnabled,
      lifecycleNotificationsEnabled,
      botProtectionEnabled,
      ...(botProtectionEnabled ? { turnstileSiteKey } : {}),
    },
    200,
    headers,
  );
};
