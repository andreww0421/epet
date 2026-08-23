import type {
  ClassEffectivenessMetrics,
  LearningEvidenceRecord,
  StudentLearningAnalytics,
} from '../../shared/education';
import type {
  AppData,
  BossVictoryResult,
  ExamRecord,
  Student,
  WorldBoss,
} from '../store/types';

const runtimeEnv = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env ?? {};
const CONFIGURED_WORKSPACE_ID = runtimeEnv.VITE_EPET_WORKSPACE?.trim();
const WORKSPACE_STORAGE_KEY = 'epet-cloud-workspace-v1';
const CLOUD_WORKSPACE_PATTERN = /^ws_[a-zA-Z0-9_-]{24,61}$/;
const REQUEST_TIMEOUT_MS = 6000;

const getLegacyWorkspaceId = () => {
  if (CONFIGURED_WORKSPACE_ID) return CONFIGURED_WORKSPACE_ID;
  try {
    const saved = globalThis.localStorage?.getItem(WORKSPACE_STORAGE_KEY);
    if (saved && CLOUD_WORKSPACE_PATTERN.test(saved)) return saved;
  } catch {
    // Legacy capability-key storage is optional.
  }
  return null;
};

const LEGACY_WORKSPACE_ID = getLegacyWorkspaceId();
export const hasClaimableLegacyWorkspace =
  Boolean(LEGACY_WORKSPACE_ID && CLOUD_WORKSPACE_PATTERN.test(LEGACY_WORKSPACE_ID));

export type WorkspaceRole = 'owner' | 'admin' | 'teacher' | 'viewer';

export type WorkspaceMember = {
  userId: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  classIds: string[];
  createdAt: number;
};

export type AuthSession = {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: WorkspaceRole;
    emailVerified: boolean;
  };
  workspaces: Array<{
    id: string;
    name: string;
    role: WorkspaceRole;
  }>;
  activeWorkspaceId: string | null;
};

type AuthResponse = {
  session: AuthSession;
  csrfToken: string;
};

let csrfToken: string | null = null;
let activeWorkspaceId: string | null = null;

let backendAvailable = false;

export type BackendStateSnapshot = {
  revision: number;
  updatedAt: number;
  data: AppData | null;
};

export type BackendPublicConfig = {
  authenticationEnabled?: boolean;
  registrationEnabled: boolean;
  invitationEnabled?: boolean;
  emailVerificationEnabled?: boolean;
  lifecycleNotificationsEnabled?: boolean;
  botProtectionEnabled?: boolean;
  turnstileSiteKey?: string;
};

export type WorkspaceInvitation = {
  id: string;
  workspaceId: string;
  email: string;
  normalizedEmail: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  classIds: string[];
  createdByUserId: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  acceptedByUserId?: string;
  revokedAt: number | null;
};

export type WorkspacePrivacyExport = {
  user: AuthSession['user'];
  activeWorkspace: {
    id: string;
    role: WorkspaceRole;
    state: AppData | null;
  };
  revision: {
    current: number;
    updatedAt: number;
    history: Array<{
      workspaceId: string;
      revision: number;
      updatedAt: number;
      actorUserId?: string;
      dataSizeBytes: number;
    }>;
  };
  exportedAt: string;
};

export type WorkspaceRevision = {
  workspaceId: string;
  revision: number;
  updatedAt: number;
  actorUserId?: string;
  dataSizeBytes: number;
};

export type WorkspaceRevisionSnapshot = WorkspaceRevision & {
  data: AppData;
};

export type StudentPrivacyExport = {
  workspace: {
    id: string;
    revision: number;
    updatedAt: number;
  };
  class: { id: string; name: string };
  student: Partial<Student> & Pick<Student, 'id' | 'name' | 'points' | 'pet'>;
  learningEvidenceRecords: LearningEvidenceRecord[];
  examRecords: ExamRecord[];
  activeBossParticipation: {
    id: string;
    name: string;
    maxHp: number;
    currentHp: number;
    isActive: boolean;
    contribution: number;
    attackCount: number;
  } | null;
  exportedAt: string;
};

export type WorkspaceAuditEvent = {
  id: string;
  workspaceId?: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export type WorkspaceAuditQuery = {
  limit?: number;
  cursor?: string;
  action?: string;
  actorUserId?: string;
  targetType?: string;
  from?: number;
  to?: number;
};

export type WorkspaceAuditPage = {
  events: WorkspaceAuditEvent[];
  nextCursor?: string;
};

export class BackendRevisionConflict extends Error {
  constructor(readonly current: BackendStateSnapshot) {
    super('Backend revision conflict');
  }
}

export class BackendAuthRequired extends Error {
  constructor() {
    super('Authentication is required');
  }
}

export class BackendForbidden extends Error {
  constructor() {
    super('The active account cannot access this workspace');
  }
}

export class BackendApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

type RequestOptions = {
  auth?: boolean;
  workspace?: boolean;
};

const request = async <T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = new Headers(init.headers);
    if (init.body != null && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const method = (init.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
      headers.set('x-csrf-token', csrfToken);
    }
    if (options.workspace !== false) {
      if (!activeWorkspaceId) throw new BackendAuthRequired();
      headers.set('x-epet-workspace', activeWorkspaceId);
    }
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && body?.current) {
      throw new BackendRevisionConflict(body.current as BackendStateSnapshot);
    }
    if (response.status === 401) {
      if (options.auth !== false) csrfToken = null;
      throw new BackendAuthRequired();
    }
    if (response.status === 403 && options.auth !== false) {
      throw new BackendForbidden();
    }
    if (!response.ok) {
      throw new BackendApiError(
        response.status,
        typeof body?.error === 'string' ? body.error : `HTTP_${response.status}`,
      );
    }
    backendAvailable = true;
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
};

export const isBackendAvailable = () => backendAvailable;

export const loadBackendPublicConfig = () =>
  request<BackendPublicConfig>(
    '/api/v1/health',
    {},
    { auth: false, workspace: false },
  );

export const probeBackend = async () => {
  try {
    await loadBackendPublicConfig();
    backendAvailable = true;
    return true;
  } catch {
    backendAvailable = false;
    return false;
  }
};

const applyAuthResponse = (response: AuthResponse) => {
  csrfToken = response.csrfToken;
  activeWorkspaceId = response.session.activeWorkspaceId
    ?? response.session.workspaces[0]?.id
    ?? null;
  return {
    ...response.session,
    activeWorkspaceId,
  };
};

export const loadAuthSession = async (): Promise<AuthSession | null> => {
  try {
    const response = await request<{
      session: AuthSession;
      csrfToken: string;
    }>(
      '/api/v1/auth/session',
      {},
      { workspace: false },
    );
    csrfToken = response.csrfToken;
    const availableIds = new Set(response.session.workspaces.map((workspace) => workspace.id));
    activeWorkspaceId = activeWorkspaceId && availableIds.has(activeWorkspaceId)
      ? activeWorkspaceId
      : response.session.activeWorkspaceId ?? response.session.workspaces[0]?.id ?? null;
    return { ...response.session, activeWorkspaceId };
  } catch (error) {
    if (error instanceof BackendAuthRequired) return null;
    throw error;
  }
};

export const loginAccount = async (input: {
  email: string;
  password: string;
  turnstileToken?: string;
}) => {
  const response = await request<AuthResponse>(
    '/api/v1/auth/login',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    { auth: false, workspace: false },
  );
  return applyAuthResponse(response);
};

export const registerAccount = async (input: {
  displayName: string;
  email: string;
  password: string;
  claimLegacyWorkspace?: boolean;
  turnstileToken?: string;
}) => {
  const response = await request<AuthResponse>(
    '/api/v1/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({
        displayName: input.displayName,
        email: input.email,
        password: input.password,
        turnstileToken: input.turnstileToken,
        legacyWorkspaceId: input.claimLegacyWorkspace && LEGACY_WORKSPACE_ID
          ? LEGACY_WORKSPACE_ID
          : undefined,
      }),
    },
    { auth: false, workspace: false },
  );
  return applyAuthResponse(response);
};

export const acceptWorkspaceInvitation = async (input: {
  token: string;
  displayName: string;
  password: string;
}) => {
  const response = await request<AuthResponse>(
    '/api/v1/auth/invitations/accept',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    { auth: false, workspace: false },
  );
  return applyAuthResponse(response);
};

export const logoutAccount = async () => {
  try {
    await request(
      '/api/v1/auth/logout',
      { method: 'POST' },
      { workspace: false },
    );
  } finally {
    csrfToken = null;
    activeWorkspaceId = null;
    backendAvailable = false;
  }
};

export const requestPasswordReset = async (input: {
  email: string;
  turnstileToken?: string;
}) => {
  await request(
    '/api/v1/auth/password/forgot',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    { auth: false, workspace: false },
  );
};

export const verifyEmail = async (token: string) => {
  await request<{ verified: true }>(
    '/api/v1/auth/email/verify',
    {
      method: 'POST',
      body: JSON.stringify({ token }),
    },
    { auth: false, workspace: false },
  );
};

export const resendEmailVerification = async () => {
  await request<{ accepted: true }>(
    '/api/v1/auth/email/resend',
    { method: 'POST' },
    { workspace: false },
  );
};

export const resetPassword = async (input: {
  token: string;
  password: string;
}) => {
  await request(
    '/api/v1/auth/password/reset',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    { auth: false, workspace: false },
  );
  csrfToken = null;
  activeWorkspaceId = null;
};

export const setActiveWorkspaceId = (workspaceId: string) => {
  activeWorkspaceId = workspaceId;
};

export const createWorkspace = async (name: string) => {
  const response = await request<{ session: AuthSession }>(
    '/api/v1/workspaces',
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
    { workspace: false },
  );
  activeWorkspaceId = response.session.activeWorkspaceId;
  return response.session;
};

export const clearAuthentication = () => {
  csrfToken = null;
  activeWorkspaceId = null;
  backendAvailable = false;
};

export const loadBackendState = () =>
  request<BackendStateSnapshot>('/api/v1/state');

export const exportWorkspacePrivacyData = () =>
  request<WorkspacePrivacyExport>('/api/v1/privacy/export');

export const loadWorkspaceRevisions = (limit = 25) =>
  request<{ currentRevision: number; revisions: WorkspaceRevision[] }>(
    `/api/v1/revisions?limit=${encodeURIComponent(String(limit))}`,
  );

export const loadWorkspaceRevision = (revision: number) =>
  request<{ snapshot: WorkspaceRevisionSnapshot }>(
    `/api/v1/revisions/${encodeURIComponent(String(revision))}`,
  );

export const restoreWorkspaceRevision = (revision: number) =>
  request<{
    restoredFromRevision: number;
    revision: number;
    updatedAt: number;
    data: AppData;
  }>(
    `/api/v1/revisions/${encodeURIComponent(String(revision))}/restore`,
    { method: 'POST' },
  );

export const exportStudentPrivacyData = (
  classId: string,
  studentId: string,
) => request<StudentPrivacyExport>(
  `/api/v1/classes/${encodeURIComponent(classId)}/students/` +
    `${encodeURIComponent(studentId)}/privacy/export`,
);

export const loadWorkspaceAuditEvents = (
  query: WorkspaceAuditQuery = {},
) => {
  const search = new URLSearchParams();
  if (query.limit != null) search.set('limit', String(query.limit));
  if (query.cursor) search.set('cursor', query.cursor);
  if (query.action) search.set('action', query.action);
  if (query.actorUserId) search.set('actorUserId', query.actorUserId);
  if (query.targetType) search.set('targetType', query.targetType);
  if (query.from != null) search.set('from', String(query.from));
  if (query.to != null) search.set('to', String(query.to));
  const queryString = search.toString();
  return request<WorkspaceAuditPage>(
    `/api/v1/audit${queryString ? `?${queryString}` : ''}`,
  );
};

export const loadWorkspaceMembers = () =>
  request<{ members: WorkspaceMember[] }>('/api/v1/members');

export const loadWorkspaceInvitations = () =>
  request<{ invitations: WorkspaceInvitation[] }>('/api/v1/invitations');

export const createWorkspaceInvitation = (input: {
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  classIds: string[];
}) => request<{ accepted: true }>('/api/v1/invitations', {
  method: 'POST',
  body: JSON.stringify(input),
});

export const revokeWorkspaceInvitation = (invitationId: string) =>
  request<{ invitations: WorkspaceInvitation[] }>(
    `/api/v1/invitations/${encodeURIComponent(invitationId)}`,
    { method: 'DELETE' },
  );

export const updateWorkspaceMember = (
  userId: string,
  input: {
    role: Exclude<WorkspaceRole, 'owner'>;
    classIds: string[];
  },
) => request<{ members: WorkspaceMember[] }>(
  `/api/v1/members/${encodeURIComponent(userId)}`,
  {
    method: 'PATCH',
    body: JSON.stringify(input),
  },
);

export const removeWorkspaceMember = (userId: string) =>
  request<{ members: WorkspaceMember[] }>(
    `/api/v1/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );

export const transferWorkspaceOwnership = (userId: string) =>
  request<{ session: AuthSession }>(
    `/api/v1/members/${encodeURIComponent(userId)}/transfer-ownership`,
    { method: 'POST' },
  );

export const deleteActiveWorkspace = (input: {
  password: string;
  confirmation: string;
}) => request<{ session: AuthSession }>('/api/v1/workspace', {
  method: 'DELETE',
  body: JSON.stringify(input),
});

export const deleteCurrentAccount = async (input: {
  password: string;
  confirmation: string;
}) => {
  await request('/api/v1/account', {
    method: 'DELETE',
    body: JSON.stringify(input),
  }, { workspace: false });
  clearAuthentication();
};

export const saveBackendState = (
  data: AppData,
  baseRevision: number,
  requestId?: string,
) =>
  request<BackendStateSnapshot>('/api/v1/state', {
    method: 'PUT',
    headers: requestId
      ? { 'x-request-id': requestId }
      : undefined,
    body: JSON.stringify({ data, baseRevision }),
  });

export const loadStudentAnalytics = (
  classId: string,
  studentId: string,
  windowDays = 28,
) =>
  request<StudentLearningAnalytics>(
    `/api/v1/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}/analytics?windowDays=${windowDays}`,
  );

export const loadClassEffectiveness = (
  classId: string,
  windowDays = 28,
) =>
  request<ClassEffectivenessMetrics>(
    `/api/v1/classes/${encodeURIComponent(classId)}/analytics?windowDays=${windowDays}`,
  );

export const resolveBossRewardsOnBackend = async (
  students: Student[],
  boss: WorldBoss,
  now: number,
  maxPoints: number,
): Promise<{ students: Student[]; standings: BossVictoryResult['standings'] } | null> => {
  if (!backendAvailable) return null;
  try {
    return await request('/api/v1/boss/resolve', {
      method: 'POST',
      body: JSON.stringify({ students, boss, now, maxPoints }),
    });
  } catch {
    backendAvailable = false;
    return null;
  }
};
