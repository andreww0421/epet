import { CLASS_ARCHIVE_CONFIRMATIONS, CLASS_DELETE_CONFIRMATION, deleteClassFromWorkspace,
  updateClassArchive, type ClassArchiveAction } from '../../shared/domain/classArchive';
import { getString, readJsonBody, MAX_AUTH_BODY_BYTES } from '../http/body';
import { json } from '../http/response';
import { enforceRole } from '../middleware/authorization';
import type { RouteHandler, WorkspaceRouteContext } from './types';

/** Explicit admin operations share the repository's atomic revision/audit write. */
export const handleClassRoutes: RouteHandler<WorkspaceRouteContext> = async (context) => {
  const { request, url, headers, repository, workspaceId, authorized } = context;
  const match = url.pathname.match(/^\/api\/v1\/classes\/([^/]+)\/privacy\/(archive|reopen|delete)$/);
  if (request.method !== 'POST' || !match) return undefined;
  enforceRole(authorized.membership.role, 'admin');
  const action = match[2] as ClassArchiveAction | 'delete';
  const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
  const confirmation = action === 'delete' ? CLASS_DELETE_CONFIRMATION : CLASS_ARCHIVE_CONFIRMATIONS[action];
  if (getString(body.confirmation) !== confirmation) {
    return json({ error: 'CONFIRMATION_REQUIRED' }, 400, headers);
  }
  if (action === 'delete' && body.acknowledgePermanentDeletion !== true) {
    return json({ error: 'PERMANENT_DELETION_ACKNOWLEDGEMENT_REQUIRED' }, 400, headers);
  }
  if (typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
    return json({ error: 'BASE_REVISION_REQUIRED' }, 400, headers);
  }
  const workspace = await repository.get(workspaceId);
  if (!workspace.data) return json({ error: 'STATE_REQUIRED' }, 409, headers);
  if (workspace.revision !== body.expectedRevision) {
    return json({ error: 'REVISION_CONFLICT', current: workspace }, 409, headers);
  }
  let data;
  try {
    const classId = decodeURIComponent(match[1]);
    data = action === 'delete'
      ? deleteClassFromWorkspace(workspace.data, classId)
      : updateClassArchive(workspace.data, classId, action, Date.now());
  } catch (error) {
    if (error instanceof Error && error.message === 'CLASS_NOT_FOUND') {
      return json({ error: 'CLASS_NOT_FOUND' }, 404, headers);
    }
    if (error instanceof Error && error.message === 'LAST_ACTIVE_CLASS') {
      return json({ error: 'LAST_ACTIVE_CLASS' }, 409, headers);
    }
    throw error;
  }
  if (data === workspace.data) return json({ action, ...workspace }, 200, headers);
  const saved = await repository.put(workspaceId, data, body.expectedRevision, {
    actorUserId: authorized.user.id,
    action: `class.privacy.${action}`,
    requestId: `privacy_${crypto.randomUUID()}`,
  });
  return json({ action, ...saved }, 200, headers);
};
