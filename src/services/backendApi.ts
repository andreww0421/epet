import type {
  ClassEffectivenessMetrics,
  StudentLearningAnalytics,
} from '../../shared/education';
import type {
  AppData,
  BossVictoryResult,
  Student,
  WorldBoss,
} from '../store/types';

const runtimeEnv = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env ?? {};
const API_BASE = (runtimeEnv.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const CONFIGURED_WORKSPACE_ID = runtimeEnv.VITE_EPET_WORKSPACE?.trim();
const WORKSPACE_STORAGE_KEY = 'epet-cloud-workspace-v1';
const CLOUD_WORKSPACE_PATTERN = /^ws_[a-zA-Z0-9_-]{24,61}$/;
const REQUEST_TIMEOUT_MS = 6000;

const createCloudWorkspaceId = () => {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure random generation is unavailable');
  }
  if (typeof crypto.randomUUID === 'function') {
    return `ws_${crypto.randomUUID().replaceAll('-', '')}`;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `ws_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const getWorkspaceId = () => {
  if (CONFIGURED_WORKSPACE_ID) return CONFIGURED_WORKSPACE_ID;
  if (!API_BASE) return 'local-demo';
  try {
    const saved = globalThis.localStorage?.getItem(WORKSPACE_STORAGE_KEY);
    if (saved && CLOUD_WORKSPACE_PATTERN.test(saved)) return saved;
    const created = createCloudWorkspaceId();
    globalThis.localStorage?.setItem(WORKSPACE_STORAGE_KEY, created);
    return created;
  } catch {
    return createCloudWorkspaceId();
  }
};

const WORKSPACE_ID = getWorkspaceId();

let backendAvailable = false;

export type BackendStateSnapshot = {
  revision: number;
  updatedAt: number;
  data: AppData | null;
};

export class BackendRevisionConflict extends Error {
  constructor(readonly current: BackendStateSnapshot) {
    super('Backend revision conflict');
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-epet-workspace': WORKSPACE_ID,
        ...init?.headers,
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && body?.current) {
      throw new BackendRevisionConflict(body.current as BackendStateSnapshot);
    }
    if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
    backendAvailable = true;
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
};

export const isBackendAvailable = () => backendAvailable;

export const probeBackend = async () => {
  try {
    await request<{ ok: boolean }>('/api/v1/health');
    backendAvailable = true;
    return true;
  } catch {
    backendAvailable = false;
    return false;
  }
};

export const loadBackendState = () =>
  request<BackendStateSnapshot>('/api/v1/state');

export const saveBackendState = (
  data: AppData,
  baseRevision: number,
) =>
  request<BackendStateSnapshot>('/api/v1/state', {
    method: 'PUT',
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
