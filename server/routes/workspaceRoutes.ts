import { createInitialData, normalizeAppData } from '../../src/store/utils';
import { getActiveClasses } from '../../shared/domain/classArchive';
import { WorkspaceConflictError } from '../contracts';
import { getString, readJsonBody, MAX_AUTH_BODY_BYTES } from '../http/body';
import { getRequestId } from '../http/request';
import { json } from '../http/response';
import { enforceRole } from '../middleware/authorization';
import { isRoleAtLeast, AuthForbiddenError } from '../auth';
import { isAppData } from '../services/workspaceValidation';
import {
  mergeTeacherWorkspaceData,
  protectClassLifecycleWrite,
  scopeStoredWorkspace,
} from '../workspaceScope';
import type {
  AuthenticatedRouteContext,
  RouteHandler,
  WorkspaceRouteContext,
} from './types';

export const handleWorkspaceCollectionRoutes: RouteHandler<
  AuthenticatedRouteContext
> = async (context) => {
  const { request, url, headers, authService, token } = context;
  if (request.method !== 'POST' || url.pathname !== '/api/v1/workspaces') {
    return undefined;
  }

  const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
  return json(
    {
      session: await authService.createWorkspace(
        token,
        getString(body.name),
        createInitialData(),
      ),
    },
    201,
    headers,
  );
};

export const handleWorkspaceRoutes: RouteHandler<WorkspaceRouteContext> = async (
  context,
) => {
  const {
    request,
    url,
    headers,
    repository,
    authService,
    token,
    workspaceId,
    authorized,
    getClassScope,
  } = context;

  if (request.method === 'DELETE' && url.pathname === '/api/v1/workspace') {
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
    return json(
      {
        session: await authService.deleteWorkspace(
          token,
          workspaceId,
          getString(body.password),
          getString(body.confirmation),
        ),
      },
      200,
      headers,
    );
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/workspace/import') {
    enforceRole(authorized.membership.role, 'admin');
    const body = await readJsonBody(request);
    if (getString(body.confirmation) !== 'IMPORT WORKSPACE') {
      return json({ error: 'CONFIRMATION_REQUIRED' }, 400, headers);
    }
    if (body.acknowledgeReplacement !== true) {
      return json({ error: 'REPLACEMENT_ACKNOWLEDGEMENT_REQUIRED' }, 400, headers);
    }
    if (typeof body.expectedRevision !== 'number' ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
      return json({ error: 'BASE_REVISION_REQUIRED' }, 400, headers);
    }
    if (!isAppData(body.data)) {
      return json({ error: 'INVALID_APP_DATA' }, 400, headers);
    }
    const now = Date.now();
    const data = { ...normalizeAppData(body.data, now), lastOpened: now };
    if (new Set(data.classes.map((classroom) => classroom.id)).size !== data.classes.length ||
      data.classes.some((classroom) => new Set(classroom.students.map((student) => student.id)).size !== classroom.students.length)) {
      return json({ error: 'INVALID_APP_DATA' }, 400, headers);
    }
    if (getActiveClasses(data.classes).length === 0) {
      return json({ error: 'LAST_ACTIVE_CLASS' }, 409, headers);
    }
    // Explicit recovery may replace the complete snapshot, including archives.
    // The repository atomically checks the revision and purges omitted records.
    const saved = await repository.put(workspaceId, data, body.expectedRevision, {
      actorUserId: authorized.user.id,
      action: 'workspace.privacy.import',
      requestId: `privacy_${crypto.randomUUID()}`,
    });
    return json(saved, 200, headers);
  }

  if (url.pathname !== '/api/v1/state') return undefined;

  if (request.method === 'GET') {
    const workspace = await repository.get(workspaceId);
    const classScope = await getClassScope();
    return json(
      classScope ? scopeStoredWorkspace(workspace, classScope) : workspace,
      200,
      headers,
    );
  }

  if (request.method === 'PUT') {
    enforceRole(authorized.membership.role, 'teacher');
    const body = await readJsonBody(request);
    if (!isAppData(body.data)) {
      return json({ error: 'INVALID_APP_DATA' }, 400, headers);
    }
    const baseRevision = Number.isInteger(body.baseRevision) &&
        Number(body.baseRevision) >= 0
      ? Number(body.baseRevision)
      : undefined;
    const writeContext = {
      actorUserId: authorized.user.id,
      action: 'workspace.state.put',
      requestId: getRequestId(request),
    };
    if (isRoleAtLeast(authorized.membership.role, 'admin')) {
      const current = await repository.get(workspaceId);
      if (baseRevision != null && baseRevision !== current.revision) {
        return json({ error: 'REVISION_CONFLICT', current }, 409, headers);
      }
      const normalizationTime = Date.now();
      const normalized = normalizeAppData(body.data, normalizationTime);
      const nextData = current.data
        ? protectClassLifecycleWrite(current.data, normalized, {
            comparison: normalizeAppData(current.data, normalizationTime),
            submitted: body.data,
          })
        : normalized;
      const saved = await repository.put(
        workspaceId,
        nextData,
        // Keep the legacy optional admin base revision contract while making
        // the lifecycle validation/read-write boundary atomic.
        baseRevision ?? current.revision,
        writeContext,
      );
      return json(saved, 200, headers);
    }

    if (baseRevision == null) {
      return json({ error: 'BASE_REVISION_REQUIRED' }, 400, headers);
    }
    const classScope = await getClassScope();
    if (!classScope) throw new AuthForbiddenError();
    const current = await repository.get(workspaceId);
    if (!current.data) {
      return json({ error: 'STATE_REQUIRED' }, 409, headers);
    }
    if (baseRevision !== current.revision) {
      return json({ error: 'REVISION_CONFLICT', current: scopeStoredWorkspace(current, classScope) }, 409, headers);
    }
    const normalizationTime = Date.now();
    const merged = mergeTeacherWorkspaceData(
      current.data,
      normalizeAppData(body.data, normalizationTime),
      classScope,
      {
        comparison: normalizeAppData(current.data, normalizationTime),
        // The client already normalized its loaded snapshot once. Compare
        // before a second normalization can change legacy fallback defaults.
        submitted: body.data,
      },
    );
    try {
      const saved = await repository.put(
        workspaceId,
        merged,
        baseRevision,
        writeContext,
      );
      return json(scopeStoredWorkspace(saved, classScope), 200, headers);
    } catch (error) {
      if (error instanceof WorkspaceConflictError) {
        return json(
          {
            error: 'REVISION_CONFLICT',
            current: scopeStoredWorkspace(error.current, classScope),
          },
          409,
          headers,
        );
      }
      throw error;
    }
  }

  return undefined;
};
