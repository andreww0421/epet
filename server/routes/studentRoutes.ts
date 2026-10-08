import { normalizeLearningEvidenceRecords } from '../../shared/education';
import {
  anonymizeStudentInWorkspaceData,
  purgeStudentsFromWorkspaceData,
  STUDENT_PRIVACY_CONFIRMATIONS,
} from '../../shared/domain/studentPrivacy';
import { WorkspaceConflictError } from '../contracts';
import { MAX_AUTH_BODY_BYTES, readJsonBody } from '../http/body';
import { getRequestId } from '../http/request';
import { json } from '../http/response';
import { enforceRole } from '../middleware/authorization';
import { createStudentPrivacyRecord } from './routeUtils';
import type { RouteHandler, WorkspaceRouteContext } from './types';

export const handleStudentRoutes: RouteHandler<WorkspaceRouteContext> = async (
  context,
) => {
  const {
    request,
    url,
    headers,
    repository,
    workspaceId,
    authorized,
  } = context;
  const studentPrivacyExportMatch = url.pathname.match(
    /^\/api\/v1\/classes\/([^/]+)\/students\/([^/]+)\/privacy\/(export|delete|anonymize)$/,
  );
  if (!studentPrivacyExportMatch) {
    return undefined;
  }
  const action = studentPrivacyExportMatch[3];
  if ((action === 'export' && request.method !== 'GET') ||
      (action !== 'export' && request.method !== 'POST')) {
    return undefined;
  }

  // Authorization deliberately precedes payload parsing and student lookup.
  enforceRole(authorized.membership.role, 'admin');
  const mutationBody = action === 'export' ? null
    : await readJsonBody(request, MAX_AUTH_BODY_BYTES);
  if (mutationBody) {
    if (!Number.isSafeInteger(mutationBody.expectedRevision) ||
        Number(mutationBody.expectedRevision) < 1) {
      return json({ error: 'EXPECTED_REVISION_REQUIRED' }, 400, headers);
    }
    const confirmation = action === 'delete'
      ? STUDENT_PRIVACY_CONFIRMATIONS.delete
      : STUDENT_PRIVACY_CONFIRMATIONS.anonymize;
    if (mutationBody.confirmation !== confirmation) {
      return json({ error: 'PRIVACY_CONFIRMATION_REQUIRED' }, 400, headers);
    }
  }
  const workspace = await repository.get(workspaceId);
  if (mutationBody && Number(mutationBody.expectedRevision) !== workspace.revision) {
    throw new WorkspaceConflictError(workspace);
  }
  const classId = decodeURIComponent(studentPrivacyExportMatch[1]);
  const studentId = decodeURIComponent(studentPrivacyExportMatch[2]);
  const classData = workspace.data?.classes.find(
    (candidate) => candidate.id === classId,
  );
  const student = classData?.students.find(
    (candidate) => candidate.id === studentId,
  );
  if (!classData || !student) {
    return json({ error: 'STUDENT_NOT_FOUND' }, 404, headers);
  }
  if (mutationBody && workspace.data) {
    const expectedRevision = Number(mutationBody.expectedRevision);
    const next = action === 'delete'
      ? purgeStudentsFromWorkspaceData(workspace.data, new Set([student.id]))
      : anonymizeStudentInWorkspaceData(
          workspace.data,
          student.id,
          `student-anonymous-${crypto.randomUUID()}`,
        );
    const saved = await repository.put(workspaceId, next, expectedRevision, {
      actorUserId: authorized.user.id,
      action: `student.privacy.${action}`,
      // Never use a caller's request ID as a database audit primary key.
      requestId: `evt_${crypto.randomUUID()}`,
    });
    return json({ action, ...saved }, 200, headers);
  }
  const evidenceRecords = normalizeLearningEvidenceRecords(
    classData.learningEvidenceRecords,
    classData.id,
    new Set(classData.students.map((candidate) => candidate.id)),
  ).filter((record) => record.studentId === student.id);
  const examRecords = (classData.examRecords ?? []).flatMap((exam) => {
    const results = exam.results.filter(
      (result) => result.studentId === student.id,
    );
    return results.length > 0 ? [{ ...exam, results }] : [];
  });
  const activeBossParticipation = classData.activeBoss
    ? {
        id: classData.activeBoss.id,
        name: classData.activeBoss.name,
        maxHp: classData.activeBoss.maxHp,
        currentHp: classData.activeBoss.currentHp,
        isActive: classData.activeBoss.isActive,
        contribution: classData.activeBoss.contributions[student.id] ?? 0,
        attackCount: classData.activeBoss.attackCounts?.[student.id] ?? 0,
      }
    : null;
  const exportedAt = new Date().toISOString();
  await repository.appendAuditEvent({
    id: `evt_${crypto.randomUUID()}`,
    workspaceId,
    actorUserId: authorized.user.id,
    action: 'student.privacy.export',
    targetType: 'student',
    targetId: student.id,
    metadata: {
      classId,
      requestId: getRequestId(request),
      role: authorized.membership.role,
      revision: workspace.revision,
    },
    createdAt: Date.parse(exportedAt),
  });
  return json(
    {
      workspace: {
        id: workspaceId,
        revision: workspace.revision,
        updatedAt: workspace.updatedAt,
      },
      class: {
        id: classData.id,
        name: classData.name,
      },
      student: createStudentPrivacyRecord(student),
      learningEvidenceRecords: evidenceRecords,
      examRecords,
      activeBossParticipation,
      exportedAt,
    },
    200,
    headers,
  );
};
