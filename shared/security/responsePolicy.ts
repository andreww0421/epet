export const TURNSTILE_CHALLENGE_ORIGIN =
  'https://challenges.cloudflare.com';

export const BASE_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' ${TURNSTILE_CHALLENGE_ORIGIN}`,
  `frame-src ${TURNSTILE_CHALLENGE_ORIGIN}`,
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

export const DEFAULT_PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
export const DOCUMENT_CACHE_CONTROL = 'no-cache';
export const IMMUTABLE_ASSET_CACHE_CONTROL =
  'public, max-age=31536000, immutable';
export const PRIVATE_RESPONSE_CACHE_CONTROL = 'no-store';
export const STRICT_TRANSPORT_SECURITY =
  'max-age=31536000; includeSubDomains';

export type ResponseCacheControl =
  | typeof DOCUMENT_CACHE_CONTROL
  | typeof IMMUTABLE_ASSET_CACHE_CONTROL
  | typeof PRIVATE_RESPONSE_CACHE_CONTROL;

export type ResponseSecurityPolicy = {
  cacheControl?: ResponseCacheControl;
  document?: boolean;
  permissionsPolicy?: string;
  strictTransportSecurity?: boolean;
  upgradeInsecureRequests?: boolean;
};

export const createResponseSecurityHeaders = (
  policy: ResponseSecurityPolicy = {},
) => {
  const headers = new Headers({
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': policy.permissionsPolicy ??
      DEFAULT_PERMISSIONS_POLICY,
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  });
  if (policy.cacheControl) {
    headers.set('cache-control', policy.cacheControl);
  }
  if (policy.strictTransportSecurity) {
    headers.set(
      'strict-transport-security',
      STRICT_TRANSPORT_SECURITY,
    );
  }
  if (policy.document) {
    headers.set(
      'content-security-policy',
      [
        BASE_CONTENT_SECURITY_POLICY,
        ...(policy.upgradeInsecureRequests
          ? ['upgrade-insecure-requests']
          : []),
      ].join('; '),
    );
  }
  return headers;
};

export const secureResponse = (
  response: Response,
  policy: ResponseSecurityPolicy = {},
) => {
  const secured = new Response(response.body, response);
  createResponseSecurityHeaders(policy).forEach((value, name) => {
    secured.headers.set(name, value);
  });
  return secured;
};
