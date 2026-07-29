import {
  LEARNING_EVIDENCE_LEVELS,
  LEARNING_EVIDENCE_TYPES,
  computeClassEffectivenessMetrics,
  computeStudentLearningAnalytics,
  createLearningEvidenceRecord,
  isLearningCompetency,
  normalizeLearningEvidenceRecords,
  type LearningEvidenceInput,
} from '../shared/education';
import { applyBossContributionRewards } from '../src/gameRules';
import type { AppData, Student, WorldBoss } from '../src/store/types';
import { normalizeAppData } from '../src/store/utils';
import {
  WorkspaceConflictError,
  WorkspaceDataTooLargeError,
  type WorkspaceRepository,
} from './contracts';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const LOCAL_WORKSPACE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const CLOUD_WORKSPACE_PATTERN = /^ws_[a-zA-Z0-9_-]{24,61}$/;

type ApiOptions = {
  allowLocalWorkspaceIds?: boolean;
  allowedOrigins?: string[];
};

const json = (
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
) => Response.json(body, {
  status,
  headers: {
    'cache-control': 'no-store',
    ...headers,
  },
});

const readJsonBody = async (request: Request) => {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new WorkspaceDataTooLargeError();
  }
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) throw new WorkspaceDataTooLargeError();
  if (buffer.byteLength === 0) return {} as Record<string, unknown>;
  return JSON.parse(new TextDecoder().decode(buffer)) as Record<string, unknown>;
};

const getWorkspaceId = (request: Request, allowLocalWorkspaceIds: boolean) => {
  const candidate = request.headers.get('x-epet-workspace') ?? '';
  const pattern = allowLocalWorkspaceIds
    ? LOCAL_WORKSPACE_PATTERN
    : CLOUD_WORKSPACE_PATTERN;
  return pattern.test(candidate) ? candidate : null;
};

const isAppData = (value: unknown): value is AppData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AppData>;
  return (
    typeof data.currentClassId === 'string' &&
    Array.isArray(data.classes) &&
    data.classes.every(
      (classData) =>
        classData &&
        typeof classData === 'object' &&
        typeof classData.id === 'string' &&
        Array.isArray(classData.students),
    )
  );
};

const isLearningEvidenceInput = (value: unknown): value is LearningEvidenceInput => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<LearningEvidenceInput>;
  return (
    isLearningCompetency(input.competency) &&
    LEARNING_EVIDENCE_LEVELS.includes(input.level as never) &&
    LEARNING_EVIDENCE_TYPES.includes(input.evidenceType as never) &&
    typeof input.title === 'string' &&
    Boolean(input.title.trim())
  );
};

const isBossResolutionPayload = (
  students: unknown,
  boss: unknown,
): students is Student[] =>
  Array.isArray(students) &&
  students.every(
    (student) =>
      student &&
      typeof student === 'object' &&
      typeof student.id === 'string' &&
      typeof student.name === 'string' &&
      typeof student.points === 'number' &&
      student.pet &&
      typeof student.pet === 'object' &&
      typeof student.pet.level === 'number',
  ) &&
  Boolean(
    boss &&
    typeof boss === 'object' &&
    typeof (boss as Partial<WorldBoss>).id === 'string' &&
    typeof (boss as Partial<WorldBoss>).name === 'string' &&
    Array.isArray((boss as Partial<WorldBoss>).rewardTiers) &&
    (boss as Partial<WorldBoss>).contributions &&
    typeof (boss as Partial<WorldBoss>).contributions === 'object',
  );

const getWindowDays = (url: URL) => {
  const value = Number(url.searchParams.get('windowDays'));
  return Number.isFinite(value) ? Math.min(180, Math.max(7, Math.floor(value))) : 28;
};

const getCorsHeaders = (request: Request, allowedOrigins: string[]) => {
  const requestOrigin = request.headers.get('origin');
  const allowAny = allowedOrigins.includes('*');
  const allowedOrigin =
    allowAny || !requestOrigin || allowedOrigins.includes(requestOrigin)
      ? allowAny
        ? '*'
        : requestOrigin
      : null;
  return {
    allowed: Boolean(allowedOrigin || !requestOrigin),
    headers: {
      ...(allowedOrigin ? { 'access-control-allow-origin': allowedOrigin } : {}),
      'access-control-allow-headers': 'content-type, x-epet-workspace',
      'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
      vary: 'Origin',
    },
  };
};

export const createApiHandler = (
  repository: WorkspaceRepository,
  options: ApiOptions = {},
) => {
  const allowedOrigins = options.allowedOrigins ?? ['*'];
  const allowLocalWorkspaceIds = options.allowLocalWorkspaceIds ?? true;

  return async (request: Request): Promise<Response> => {
    const cors = getCorsHeaders(request, allowedOrigins);
    if (!cors.allowed) {
      return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, cors.headers);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors.headers });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      return json(
        { ok: true, service: 'epet-api', version: 1 },
        200,
        cors.headers,
      );
    }

    const workspaceId = getWorkspaceId(request, allowLocalWorkspaceIds);
    if (!workspaceId) {
      return json({ error: 'INVALID_WORKSPACE' }, 401, cors.headers);
    }

    try {
      if (url.pathname === '/api/v1/state') {
        if (request.method === 'GET') {
          return json(await repository.get(workspaceId), 200, cors.headers);
        }
        if (request.method === 'PUT') {
          const body = await readJsonBody(request);
          if (!isAppData(body.data)) {
            return json({ error: 'INVALID_APP_DATA' }, 400, cors.headers);
          }
          const saved = await repository.put(
            workspaceId,
            normalizeAppData(body.data),
            typeof body.baseRevision === 'number' ? body.baseRevision : undefined,
          );
          return json(saved, 200, cors.headers);
        }
      }

      const classAnalyticsMatch = url.pathname.match(
        /^\/api\/v1\/classes\/([^/]+)\/analytics$/,
      );
      if (request.method === 'GET' && classAnalyticsMatch) {
        const workspace = await repository.get(workspaceId);
        const classId = decodeURIComponent(classAnalyticsMatch[1]);
        const classData = workspace.data?.classes.find(
          (candidate) => candidate.id === classId,
        );
        if (!classData) {
          return json({ error: 'CLASS_NOT_FOUND' }, 404, cors.headers);
        }
        const evidence = normalizeLearningEvidenceRecords(
          classData.learningEvidenceRecords,
          classData.id,
          new Set(classData.students.map((student) => student.id)),
        );
        return json(
          computeClassEffectivenessMetrics(
            classData.students,
            evidence,
            classData.classGoals,
            Date.now(),
            getWindowDays(url),
          ),
          200,
          cors.headers,
        );
      }

      const studentAnalyticsMatch = url.pathname.match(
        /^\/api\/v1\/classes\/([^/]+)\/students\/([^/]+)\/analytics$/,
      );
      if (request.method === 'GET' && studentAnalyticsMatch) {
        const workspace = await repository.get(workspaceId);
        const classId = decodeURIComponent(studentAnalyticsMatch[1]);
        const studentId = decodeURIComponent(studentAnalyticsMatch[2]);
        const classData = workspace.data?.classes.find(
          (candidate) => candidate.id === classId,
        );
        const student = classData?.students.find(
          (candidate) => candidate.id === studentId,
        );
        if (!classData || !student) {
          return json({ error: 'STUDENT_NOT_FOUND' }, 404, cors.headers);
        }
        const evidence = normalizeLearningEvidenceRecords(
          classData.learningEvidenceRecords,
          classData.id,
          new Set(classData.students.map((candidate) => candidate.id)),
        );
        return json(
          computeStudentLearningAnalytics(
            student,
            evidence,
            Date.now(),
            getWindowDays(url),
          ),
          200,
          cors.headers,
        );
      }

      const evidenceMatch = url.pathname.match(
        /^\/api\/v1\/classes\/([^/]+)\/evidence$/,
      );
      if (request.method === 'POST' && evidenceMatch) {
        const workspace = await repository.get(workspaceId);
        if (!workspace.data) {
          return json({ error: 'STATE_REQUIRED' }, 409, cors.headers);
        }
        const classId = decodeURIComponent(evidenceMatch[1]);
        const classIndex = workspace.data.classes.findIndex(
          (classData) => classData.id === classId,
        );
        const classData = workspace.data.classes[classIndex];
        const body = await readJsonBody(request);
        const studentId = typeof body.studentId === 'string' ? body.studentId : '';
        if (
          !classData ||
          !classData.students.some((student) => student.id === studentId) ||
          !isLearningEvidenceInput(body.input)
        ) {
          return json({ error: 'INVALID_EVIDENCE' }, 400, cors.headers);
        }
        const record = createLearningEvidenceRecord(
          classId,
          studentId,
          body.input,
        );
        const nextClasses = [...workspace.data.classes];
        nextClasses[classIndex] = {
          ...classData,
          learningEvidenceRecords: [
            record,
            ...(classData.learningEvidenceRecords ?? []),
          ].slice(0, 2000),
        };
        const saved = await repository.put(
          workspaceId,
          { ...workspace.data, classes: nextClasses },
          workspace.revision,
        );
        return json(
          { record, revision: saved.revision },
          201,
          cors.headers,
        );
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/boss/resolve') {
        const body = await readJsonBody(request);
        if (!isBossResolutionPayload(body.students, body.boss)) {
          return json({ error: 'INVALID_BOSS_PAYLOAD' }, 400, cors.headers);
        }
        return json(
          applyBossContributionRewards(
            body.students,
            body.boss as WorldBoss,
            typeof body.now === 'number' ? body.now : Date.now(),
            typeof body.maxPoints === 'number' ? body.maxPoints : 700,
          ),
          200,
          cors.headers,
        );
      }

      return json({ error: 'NOT_FOUND' }, 404, cors.headers);
    } catch (error) {
      if (error instanceof WorkspaceConflictError) {
        return json(
          { error: 'REVISION_CONFLICT', current: error.current },
          409,
          cors.headers,
        );
      }
      if (error instanceof WorkspaceDataTooLargeError) {
        return json({ error: 'PAYLOAD_TOO_LARGE' }, 413, cors.headers);
      }
      if (error instanceof SyntaxError) {
        return json({ error: 'INVALID_JSON' }, 400, cors.headers);
      }
      console.error(error);
      return json({ error: 'INTERNAL_ERROR' }, 500, cors.headers);
    }
  };
};
