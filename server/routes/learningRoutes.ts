import { createLearningEvidenceRecord } from '../../shared/education';
import { readJsonBody } from '../http/body';
import { getRequestId } from '../http/request';
import { json } from '../http/response';
import { enforceRole } from '../middleware/authorization';
import { isLearningEvidenceInput } from './routeUtils';
import type { RouteHandler, WorkspaceRouteContext } from './types';

export const handleLearningRoutes: RouteHandler<WorkspaceRouteContext> = async (
  context,
) => {
  const {
    request,
    url,
    headers,
    repository,
    workspaceId,
    authorized,
    requireClassAccess,
  } = context;
  const evidenceMatch = url.pathname.match(
    /^\/api\/v1\/classes\/([^/]+)\/evidence$/,
  );
  if (request.method !== 'POST' || !evidenceMatch) return undefined;

  enforceRole(authorized.membership.role, 'teacher');
  const classId = decodeURIComponent(evidenceMatch[1]);
  await requireClassAccess(classId);
  const workspace = await repository.get(workspaceId);
  if (!workspace.data) {
    return json({ error: 'STATE_REQUIRED' }, 409, headers);
  }
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
    return json({ error: 'INVALID_EVIDENCE' }, 400, headers);
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
    {
      actorUserId: authorized.user.id,
      action: 'learning_evidence.create',
      requestId: getRequestId(request),
    },
  );
  return json(
    { record, revision: saved.revision },
    201,
    headers,
  );
};
