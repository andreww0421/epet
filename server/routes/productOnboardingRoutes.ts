import type { ApiOptions } from '../contracts/api';
import type { ProductOnboardingRepository } from '../contracts';
import { isProductOnboardingEnrollmentTime } from '../contracts';
import { readJsonBody } from '../http/body';
import { json } from '../http/response';
import { enforceRole } from '../middleware/authorization';
import type { WorkspaceRouteContext } from './types';

export const allowsProductAnalytics = (request: Request) =>
  !['1', 'yes'].includes((request.headers.get('dnt') ?? '').toLowerCase().trim()) &&
  request.headers.get('sec-gpc')?.trim() !== '1';

export const productOnboardingEnabled = (options: ApiOptions['productAnalytics']) =>
  options?.enabled === true && ['development', 'staging', 'production'].includes(options.environment) &&
  isProductOnboardingEnrollmentTime(options.cohortStart, Date.now());

export const handleProductOnboardingRoutes = async (
  context: WorkspaceRouteContext,
  options?: ApiOptions['productAnalytics'],
): Promise<Response | undefined> => {
  const { request, url, headers, repository, authorized } = context;
  if (url.pathname !== '/api/v1/product-onboarding') return undefined;
  // Feature-off does not access the optional table, keeping old databases safe.
  if (!productOnboardingEnabled(options)) return json({ error: 'NOT_FOUND' }, 404, headers);
  enforceRole(authorized.membership.role, 'admin');
  if (!allowsProductAnalytics(request)) return new Response(null, { status: 204, headers });
  const progressRepository = repository as typeof repository & Partial<ProductOnboardingRepository>;
  if (!progressRepository.getProductOnboarding || !progressRepository.enrollProductOnboarding ||
      !progressRepository.updateProductOnboarding) {
    return json({ error: 'PRODUCT_ANALYTICS_UNAVAILABLE' }, 503, headers);
  }
  let state;
  if (request.method === 'GET') {
    state = await progressRepository.getProductOnboarding(authorized.user.id);
  } else if (request.method === 'POST') {
    const body = await readJsonBody(request, 256);
    if (Object.keys(body).some((key) => key !== 'stage') ||
        !['enroll', 'started', 'local_completed'].includes(String(body.stage))) {
      return json({ error: 'INVALID_PRODUCT_ONBOARDING_STAGE' }, 400, headers);
    }
    state = body.stage === 'enroll'
      ? await progressRepository.enrollProductOnboarding({ userId: authorized.user.id,
          cohortStart: options!.cohortStart, now: Date.now() })
      : await progressRepository.updateProductOnboarding(authorized.user.id,
          body.stage as 'started' | 'local_completed');
  } else return json({ error: 'METHOD_NOT_ALLOWED' }, 405, headers);
  return json({ eligible: state !== null, state }, 200, headers);
};
