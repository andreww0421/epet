import { InvalidSessionError } from './auth';
import { monitoringMethod, monitoringRouteGroup, safelyReport } from '../shared/observability/policy';
import type { ApiOptions, ApiRepository } from './contracts/api';
import { getWorkspaceId } from './http/request';
import { json } from './http/response';
import { getSessionToken } from './middleware/authentication';
import { createClassAccessControl } from './middleware/authorization';
import { validateCsrf } from './middleware/csrf';
import { errorResponse } from './middleware/errorResponse';
import { getCorsHeaders, SAFE_METHODS } from './middleware/origin';
import { handleAdminRoutes } from './routes/adminRoutes';
import {
  handleAccountRoutes,
  handleAuthRoutes,
} from './routes/authRoutes';
import { handleAnalyticsRoutes } from './routes/analyticsRoutes';
import { handleBossRoutes } from './routes/bossRoutes';
import { handleLearningRoutes } from './routes/learningRoutes';
import { handleStudentRoutes } from './routes/studentRoutes';
import { handleSystemRoutes } from './routes/systemRoutes';
import type {
  AuthenticatedRouteContext,
  BaseRouteContext,
  WorkspaceRouteContext,
} from './routes/types';
import {
  handleWorkspaceCollectionRoutes,
  handleWorkspaceRoutes,
} from './routes/workspaceRoutes';
import { createApiRuntime } from './services/apiRuntime';

export type {
  ApiOptions,
  BotChallengeVerification,
} from './contracts/api';

export const createApiHandler = (
  repository: ApiRepository,
  options: ApiOptions = {},
) => {
  const runtime = createApiRuntime(repository, options);

  const dispatch = async (request: Request): Promise<Response> => {
    const cors = getCorsHeaders(request, runtime.allowedOrigins);
    if (!cors.allowed) {
      return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, cors.headers);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors.headers });
    }
    if (
      !SAFE_METHODS.has(request.method.toUpperCase()) &&
      !request.headers.get('origin')
    ) {
      return json({ error: 'ORIGIN_REQUIRED' }, 403, cors.headers);
    }

    const url = new URL(request.url);
    const baseContext: BaseRouteContext = {
      request,
      url,
      headers: cors.headers,
      repository,
      authService: runtime.authService,
    };
    const systemResponse = await handleSystemRoutes({
      ...baseContext,
      authenticationEnabled: runtime.authenticationEnabled,
      registrationEnabled: runtime.registrationEnabled,
      invitationEnabled: Boolean(options.workspaceInvitationMailer),
      emailVerificationEnabled: Boolean(options.emailVerificationMailer),
      lifecycleNotificationsEnabled: Boolean(options.accountLifecycleMailer),
      botProtectionEnabled: runtime.botProtectionEnabled,
      turnstileSiteKey: runtime.turnstileSiteKey,
    });
    if (systemResponse) return systemResponse;

    try {
      const authResponse = await handleAuthRoutes({
        request,
        url,
        headers: cors.headers,
        runtime,
      });
      if (authResponse) return authResponse;

      const token = getSessionToken(request);
      if (!token) throw new InvalidSessionError();
      if (!SAFE_METHODS.has(request.method.toUpperCase())) {
        validateCsrf(request);
      }

      const authenticatedContext: AuthenticatedRouteContext = {
        ...baseContext,
        token,
      };
      const accountResponse = await handleAccountRoutes(authenticatedContext);
      if (accountResponse) return accountResponse;
      const workspaceCollectionResponse =
        await handleWorkspaceCollectionRoutes(authenticatedContext);
      if (workspaceCollectionResponse) return workspaceCollectionResponse;

      const workspaceId = getWorkspaceId(
        request,
        runtime.allowLocalWorkspaceIds,
      );
      if (!workspaceId) {
        return json({ error: 'INVALID_WORKSPACE' }, 400, cors.headers);
      }
      const authorized = await runtime.authService.authorizeWorkspace(
        token,
        workspaceId,
        'viewer',
      );
      const classAccess = createClassAccessControl(
        repository,
        workspaceId,
        authorized,
      );
      const workspaceContext: WorkspaceRouteContext = {
        ...authenticatedContext,
        workspaceId,
        authorized,
        ...classAccess,
      };

      const adminResponse = await handleAdminRoutes(workspaceContext, runtime);
      if (adminResponse) return adminResponse;
      const workspaceResponse = await handleWorkspaceRoutes(workspaceContext);
      if (workspaceResponse) return workspaceResponse;
      const studentResponse = await handleStudentRoutes(workspaceContext);
      if (studentResponse) return studentResponse;
      const analyticsResponse = await handleAnalyticsRoutes(workspaceContext);
      if (analyticsResponse) return analyticsResponse;
      const learningResponse = await handleLearningRoutes(workspaceContext);
      if (learningResponse) return learningResponse;
      const bossResponse = await handleBossRoutes(workspaceContext);
      if (bossResponse) return bossResponse;

      return json({ error: 'NOT_FOUND' }, 404, cors.headers);
    } catch (error) {
      return errorResponse(error, cors.headers);
    }
  };

  // Observe the final response once, including direct service-unavailable
  // responses, without reading its body or changing middleware/route behavior.
  return async (request: Request): Promise<Response> => {
    const response = await dispatch(request);
    if (response.status >= 500) safelyReport(options.monitoringReporter, {
      category: 'worker.api.http', route: monitoringRouteGroup(new URL(request.url).pathname),
      method: monitoringMethod(request.method), status: response.status,
    });
    return response;
  };
};
