import {
  computeClassEffectivenessMetrics,
  computeStudentLearningAnalytics,
  normalizeLearningEvidenceRecords,
} from '../../shared/education';
import { json } from '../http/response';
import { getWindowDays } from './routeUtils';
import type { RouteHandler, WorkspaceRouteContext } from './types';

export const handleAnalyticsRoutes: RouteHandler<WorkspaceRouteContext> = async (
  context,
) => {
  const { request, url, headers, repository, workspaceId, requireClassAccess } =
    context;

  const classAnalyticsMatch = url.pathname.match(
    /^\/api\/v1\/classes\/([^/]+)\/analytics$/,
  );
  if (request.method === 'GET' && classAnalyticsMatch) {
    const classId = decodeURIComponent(classAnalyticsMatch[1]);
    await requireClassAccess(classId);
    const workspace = await repository.get(workspaceId);
    const classData = workspace.data?.classes.find(
      (candidate) => candidate.id === classId,
    );
    if (!classData) {
      return json({ error: 'CLASS_NOT_FOUND' }, 404, headers);
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
      headers,
    );
  }

  const studentAnalyticsMatch = url.pathname.match(
    /^\/api\/v1\/classes\/([^/]+)\/students\/([^/]+)\/analytics$/,
  );
  if (request.method === 'GET' && studentAnalyticsMatch) {
    const classId = decodeURIComponent(studentAnalyticsMatch[1]);
    await requireClassAccess(classId);
    const workspace = await repository.get(workspaceId);
    const studentId = decodeURIComponent(studentAnalyticsMatch[2]);
    const classData = workspace.data?.classes.find(
      (candidate) => candidate.id === classId,
    );
    const student = classData?.students.find(
      (candidate) => candidate.id === studentId,
    );
    if (!classData || !student) {
      return json({ error: 'STUDENT_NOT_FOUND' }, 404, headers);
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
      headers,
    );
  }

  return undefined;
};
