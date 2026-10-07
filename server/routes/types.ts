import type { AuthService, AuthorizedWorkspace } from '../auth';
import type { AuthRepository, WorkspaceRepository } from '../contracts';

export type RouteResult = Promise<Response | undefined>;

export type RouteHandler<Context extends BaseRouteContext = BaseRouteContext> = (
  context: Context,
) => RouteResult;

export type BaseRouteContext = {
  request: Request;
  url: URL;
  headers: HeadersInit;
  repository: WorkspaceRepository & AuthRepository;
  authService: AuthService;
};

export type AuthenticatedRouteContext = BaseRouteContext & {
  token: string;
};

export type WorkspaceRouteContext = AuthenticatedRouteContext & {
  workspaceId: string;
  authorized: AuthorizedWorkspace;
  getClassScope: () => Promise<Set<string> | null>;
  requireClassAccess: (classId: string) => Promise<void>;
};

export type SystemRouteContext = BaseRouteContext & {
  authenticationEnabled: boolean;
  registrationEnabled: boolean;
  invitationEnabled: boolean;
  emailVerificationEnabled: boolean;
  lifecycleNotificationsEnabled: boolean;
  botProtectionEnabled: boolean;
  turnstileSiteKey: string;
};
