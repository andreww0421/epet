import { applyBossContributionRewards } from '../../src/gameRules';
import type { WorldBoss } from '../../src/store/types';
import { readJsonBody } from '../http/body';
import { json } from '../http/response';
import { enforceRole } from '../middleware/authorization';
import { isBossResolutionPayload } from './routeUtils';
import type { RouteHandler, WorkspaceRouteContext } from './types';

export const handleBossRoutes: RouteHandler<WorkspaceRouteContext> = async (
  context,
) => {
  const { request, url, headers, authorized, getClassScope } = context;
  if (request.method !== 'POST' || url.pathname !== '/api/v1/boss/resolve') {
    return undefined;
  }

  enforceRole(authorized.membership.role, 'teacher');
  await getClassScope();
  const body = await readJsonBody(request);
  if (!isBossResolutionPayload(body.students, body.boss)) {
    return json({ error: 'INVALID_BOSS_PAYLOAD' }, 400, headers);
  }
  return json(
    applyBossContributionRewards(
      body.students,
      body.boss as WorldBoss,
      typeof body.now === 'number' ? body.now : Date.now(),
      typeof body.maxPoints === 'number' ? body.maxPoints : 700,
    ),
    200,
    headers,
  );
};
