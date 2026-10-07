import { normalizeAppData } from '../../src/store/utils';
import { MAX_AUTH_BODY_BYTES, getString, readJsonBody } from '../http/body';
import { getRequestId } from '../http/request';
import { json } from '../http/response';
import { enforceRole } from '../middleware/authorization';
import {
  auditEventForResponse,
  getAuditQuery,
} from '../services/auditQuery';
import type { ApiRuntime } from '../services/apiRuntime';
import { safelyReport } from '../../shared/observability/policy';
import {
  getRevisionLimit,
  getRevisionNumber,
} from '../services/workspaceValidation';
import type { RouteResult, WorkspaceRouteContext } from './types';

const MEMBER_ROLES = ['admin', 'teacher', 'viewer'] as const;
type MemberRole = typeof MEMBER_ROLES[number];

const isMemberRole = (value: string): value is MemberRole =>
  MEMBER_ROLES.includes(value as MemberRole);

export const handleAdminRoutes = async (
  context: WorkspaceRouteContext,
  runtime: ApiRuntime,
): RouteResult => {
  const {
    request,
    url,
    headers,
    repository,
    authService,
    token,
    workspaceId,
    authorized,
  } = context;

  if (request.method === 'GET' && url.pathname === '/api/v1/members') {
    return json(
      { members: await authService.listWorkspaceMembers(token, workspaceId) },
      200,
      headers,
    );
  }

  if (url.pathname === '/api/v1/invitations') {
    if (request.method === 'GET') {
      return json(
        {
          invitations: await authService.listWorkspaceInvitations(
            token,
            workspaceId,
          ),
        },
        200,
        headers,
      );
    }
    if (request.method === 'POST') {
      if (!runtime.options.workspaceInvitationMailer) {
        return json(
          { error: 'INVITATION_DELIVERY_UNAVAILABLE' },
          503,
          headers,
        );
      }
      const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
      const role = getString(body.role);
      if (!isMemberRole(role)) {
        return json({ error: 'INVALID_ROLE' }, 400, headers);
      }
      const delivery = await authService.createWorkspaceInvitation(
        token,
        workspaceId,
        getString(body.email),
        role,
        Array.isArray(body.classIds)
          ? body.classIds.filter((value): value is string =>
              typeof value === 'string')
          : [],
      );
      const deliveryTask = runtime.options.workspaceInvitationMailer(delivery)
        .catch(() => {
          console.error('Workspace invitation delivery failed');
          safelyReport(runtime.options.monitoringReporter, { category: 'worker.background', route: 'administration', method: 'unknown' });
        });
      runtime.deferBackgroundTask(deliveryTask);
      return json({ accepted: true }, 202, headers);
    }
  }

  const invitationRevokeMatch = url.pathname.match(
    /^\/api\/v1\/invitations\/([^/]+)$/,
  );
  if (invitationRevokeMatch && request.method === 'DELETE') {
    return json(
      {
        invitations: await authService.revokeWorkspaceInvitation(
          token,
          workspaceId,
          decodeURIComponent(invitationRevokeMatch[1]),
        ),
      },
      200,
      headers,
    );
  }

  const memberMatch = url.pathname.match(/^\/api\/v1\/members\/([^/]+)$/);
  if (memberMatch && request.method === 'PATCH') {
    const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
    const role = getString(body.role);
    if (!isMemberRole(role)) {
      return json({ error: 'INVALID_ROLE' }, 400, headers);
    }
    const members = await authService.updateWorkspaceMember(
      token,
      workspaceId,
      decodeURIComponent(memberMatch[1]),
      role,
      Array.isArray(body.classIds)
        ? body.classIds.filter((value): value is string =>
            typeof value === 'string')
        : [],
    );
    return json({ members }, 200, headers);
  }
  if (memberMatch && request.method === 'DELETE') {
    const members = await authService.removeWorkspaceMember(
      token,
      workspaceId,
      decodeURIComponent(memberMatch[1]),
    );
    return json({ members }, 200, headers);
  }

  const ownershipTransferMatch = url.pathname.match(
    /^\/api\/v1\/members\/([^/]+)\/transfer-ownership$/,
  );
  if (ownershipTransferMatch && request.method === 'POST') {
    return json(
      {
        session: await authService.transferWorkspaceOwnership(
          token,
          workspaceId,
          decodeURIComponent(ownershipTransferMatch[1]),
        ),
      },
      200,
      headers,
    );
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/revisions') {
    enforceRole(authorized.membership.role, 'admin');
    const limit = getRevisionLimit(url);
    if (limit == null) {
      return json({ error: 'INVALID_REVISION_LIMIT' }, 400, headers);
    }
    const current = await repository.get(workspaceId);
    return json(
      {
        currentRevision: current.revision,
        revisions: await repository.listWorkspaceRevisions(workspaceId, limit),
      },
      200,
      headers,
    );
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/audit') {
    enforceRole(authorized.membership.role, 'admin');
    const query = getAuditQuery(url);
    if (!query) {
      return json({ error: 'INVALID_AUDIT_QUERY' }, 400, headers);
    }
    const limit = query.limit ?? 50;
    const events = await repository.listWorkspaceAuditEvents(
      workspaceId,
      { ...query, limit: limit + 1 },
    );
    const page = events.slice(0, limit);
    const responsePage = page.map(auditEventForResponse);
    const lastEvent = page.at(-1);
    const nextCursor = events.length > limit && lastEvent
      ? `${lastEvent.createdAt}:${lastEvent.id}`
      : undefined;
    await repository.appendAuditEvent({
      id: `evt_${crypto.randomUUID()}`,
      workspaceId,
      actorUserId: authorized.user.id,
      action: 'audit.query',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: {
        requestId: getRequestId(request),
        resultCount: responsePage.length,
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.fromCreatedAt != null
          ? { fromCreatedAt: query.fromCreatedAt }
          : {}),
        ...(query.toCreatedAt != null
          ? { toCreatedAt: query.toCreatedAt }
          : {}),
      },
      createdAt: Date.now(),
    });
    return json(
      {
        events: responsePage,
        ...(nextCursor ? { nextCursor } : {}),
      },
      200,
      headers,
    );
  }

  const revisionRestoreMatch = url.pathname.match(
    /^\/api\/v1\/revisions\/([^/]+)\/restore$/,
  );
  if (request.method === 'POST' && revisionRestoreMatch) {
    enforceRole(authorized.membership.role, 'admin');
    const revision = getRevisionNumber(revisionRestoreMatch[1]);
    if (revision == null) {
      return json({ error: 'INVALID_REVISION' }, 400, headers);
    }
    const snapshot = await repository.getWorkspaceRevision(
      workspaceId,
      revision,
    );
    if (!snapshot) {
      return json({ error: 'REVISION_NOT_FOUND' }, 404, headers);
    }
    const current = await repository.get(workspaceId);
    const saved = await repository.put(
      workspaceId,
      normalizeAppData(snapshot.data),
      current.revision,
      {
        actorUserId: authorized.user.id,
        action: 'workspace.revision.restore',
        requestId: getRequestId(request),
      },
    );
    return json(
      {
        restoredFromRevision: revision,
        revision: saved.revision,
        updatedAt: saved.updatedAt,
        data: saved.data,
      },
      200,
      headers,
    );
  }

  const revisionSnapshotMatch = url.pathname.match(
    /^\/api\/v1\/revisions\/([^/]+)$/,
  );
  if (request.method === 'GET' && revisionSnapshotMatch) {
    enforceRole(authorized.membership.role, 'admin');
    const revision = getRevisionNumber(revisionSnapshotMatch[1]);
    if (revision == null) {
      return json({ error: 'INVALID_REVISION' }, 400, headers);
    }
    const snapshot = await repository.getWorkspaceRevision(
      workspaceId,
      revision,
    );
    return snapshot
      ? json({ snapshot }, 200, headers)
      : json({ error: 'REVISION_NOT_FOUND' }, 404, headers);
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/privacy/export') {
    enforceRole(authorized.membership.role, 'admin');
    const workspace = await repository.get(workspaceId);
    const history = await repository.listWorkspaceRevisions(workspaceId);
    const exportedAt = new Date().toISOString();
    await repository.appendAuditEvent({
      id: `evt_${crypto.randomUUID()}`,
      workspaceId,
      actorUserId: authorized.user.id,
      action: 'workspace.privacy.export',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: {
        requestId: getRequestId(request),
        role: authorized.membership.role,
        revision: workspace.revision,
      },
      createdAt: Date.parse(exportedAt),
    });
    return json(
      {
        user: authorized.user,
        activeWorkspace: {
          id: workspaceId,
          role: authorized.membership.role,
          state: workspace.data,
        },
        revision: {
          current: workspace.revision,
          updatedAt: workspace.updatedAt,
          history,
        },
        exportedAt,
      },
      200,
      headers,
    );
  }

  return undefined;
};
