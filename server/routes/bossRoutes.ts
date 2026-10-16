import { applyBossContributionRewards } from '../../src/gameRules';
import type { WorldBoss } from '../../src/store/types';
import { isArchivedClass } from '../../shared/domain/classArchive';
import { readJsonBody } from '../http/body';
import { json } from '../http/response';
import { enforceRole } from '../middleware/authorization';
import { isBossResolutionPayload } from './routeUtils';
import type { RouteHandler, WorkspaceRouteContext } from './types';

export const handleBossRoutes: RouteHandler<WorkspaceRouteContext> = async (
  context,
) => {
  const { request, url, headers, authorized, getClassScope, repository, workspaceId } = context;
  if (request.method !== 'POST' || url.pathname !== '/api/v1/boss/resolve') {
    return undefined;
  }

  enforceRole(authorized.membership.role, 'teacher');
  const classScope = await getClassScope();
  const body = await readJsonBody(request);
  if (!isBossResolutionPayload(body.students, body.boss)) {
    return json({ error: 'INVALID_BOSS_PAYLOAD' }, 400, headers);
  }
  const boss = body.boss as WorldBoss;
  const postedStudentIds = new Set([
    ...body.students.map((student) => student.id),
    ...Object.keys(boss.contributions),
    ...Object.keys(boss.attackCounts ?? {}),
  ]);
  const workspace = await repository.get(workspaceId);
  const matchedClasses = workspace.data?.classes.filter((classroom) =>
    classroom.activeBoss?.id === boss.id ||
    classroom.students.some((student) => postedStudentIds.has(student.id))) ?? [];
  if (classScope && matchedClasses.some((classroom) => !classScope.has(classroom.id))) {
    return json({ error: 'FORBIDDEN' }, 403, headers);
  }
  if (matchedClasses.some(isArchivedClass)) {
    return json({ error: 'CLASS_ARCHIVED' }, 409, headers);
  }
  return json(
    applyBossContributionRewards(
      body.students,
      boss,
      typeof body.now === 'number' ? body.now : Date.now(),
      typeof body.maxPoints === 'number' ? body.maxPoints : 700,
    ),
    200,
    headers,
  );
};
