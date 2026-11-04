import { validateStagingUrl } from '../../scripts/staging-target.mjs';

export const turnstileOrigin = 'https://challenges.cloudflare.com';

/**
 * @param {{ stagingOrigin: string, getMainFrame: () => import('@playwright/test').Frame }} options
 * @returns {(route: import('@playwright/test').Route) => Promise<void>}
 */
export const createStagingRouteHandler = ({ stagingOrigin, getMainFrame }) => {
  const allowedStagingOrigin = validateStagingUrl(stagingOrigin);
  return async (route) => {
    const request = route.request();
    let origin;
    try {
      origin = new URL(request.url()).origin;
    } catch {
      // An unparseable target must never reach the network or leak into an error.
      await route.abort('blockedbyclient');
      return;
    }
    const isTopLevelNavigation = request.isNavigationRequest() &&
      request.frame() === getMainFrame();
    const allowed = origin === allowedStagingOrigin ||
      (origin === turnstileOrigin && !isTopLevelNavigation);
    const readOnlyStagingRequest = origin !== allowedStagingOrigin ||
      ['GET', 'HEAD'].includes(request.method());
    if (!allowed || !readOnlyStagingRequest) {
      await route.abort('blockedbyclient');
      return;
    }
    // Routing only sees the first URL in a redirect chain. Fetch without
    // redirects, then reject all 3xx responses before the browser follows them.
    const remoteResponse = await route.fetch({ maxRedirects: 0 });
    if (remoteResponse.status() >= 300 && remoteResponse.status() < 400) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.fulfill({ response: remoteResponse });
  };
};
