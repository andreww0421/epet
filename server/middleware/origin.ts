export const SAFE_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
]);

export const getCorsHeaders = (
  request: Request,
  allowedOrigins: string[],
) => {
  const requestOrigin = request.headers.get('origin');
  const requestUrl = new URL(request.url);
  const allowAny = allowedOrigins.includes('*');
  const sameOrigin = requestOrigin === requestUrl.origin;
  const allowedOrigin =
    sameOrigin || allowAny || !requestOrigin || allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : null;
  return {
    allowed: Boolean(allowedOrigin || !requestOrigin),
    headers: {
      ...(allowedOrigin ? { 'access-control-allow-origin': allowedOrigin } : {}),
      ...(allowedOrigin ? { 'access-control-allow-credentials': 'true' } : {}),
      'access-control-allow-headers':
        'content-type, x-csrf-token, x-epet-workspace, x-request-id',
      'access-control-allow-methods': 'GET, PUT, POST, PATCH, DELETE, OPTIONS',
      vary: 'Origin',
    },
  };
};
