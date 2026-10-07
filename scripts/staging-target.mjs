/**
 * Validate the dedicated Workers staging origin before any remote operation.
 * Deliberately does not accept production, custom domains, localhost, or URLs
 * carrying credentials. Custom staging domains require a separate review.
 */
export const validateStagingUrl = (value) => {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error('STAGING_BASE_URL must be the dedicated HTTPS staging Worker origin.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    // Never echo an invalid URL: it might contain credentials or other secrets.
    throw new Error('STAGING_BASE_URL is not a valid staging Worker origin.');
  }

  const stagingHostname =
    /^epet-staging\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/;
  if (
    url.protocol !== 'https:' ||
    !stagingHostname.test(url.hostname) ||
    url.username || url.password || url.port ||
    url.pathname !== '/' || url.search || url.hash ||
    (value !== url.origin && value !== `${url.origin}/`)
  ) {
    throw new Error('STAGING_BASE_URL must be https://epet-staging.<workers-subdomain>.workers.dev with no credentials, path, query, or fragment.');
  }

  return url.origin;
};
