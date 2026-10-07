export const SESSION_COOKIE_NAME = '__Host-epet_session';
export const CSRF_COOKIE_NAME = '__Host-epet_csrf';
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;
export const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const parseCookies = (request: Request) => {
  const cookies = new Map<string, string>();
  for (const segment of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (name && !cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
};

export const getSessionToken = (request: Request) => {
  const token = parseCookies(request).get(SESSION_COOKIE_NAME) ?? '';
  return SESSION_TOKEN_PATTERN.test(token) ? token : null;
};

export const sessionCookie = (token: string, maximumAgeSeconds: number) =>
  `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maximumAgeSeconds}; ` +
  'HttpOnly; Secure; SameSite=Lax; Priority=High';

export const csrfCookie = (token: string, maximumAgeSeconds: number) =>
  `${CSRF_COOKIE_NAME}=${token}; Path=/; Max-Age=${maximumAgeSeconds}; ` +
  'Secure; SameSite=Lax; Priority=High';

export const clearCookie = (name: string, httpOnly = false) =>
  `${name}=; Path=/; Max-Age=0; ${httpOnly ? 'HttpOnly; ' : ''}` +
  'Secure; SameSite=Lax; Priority=High';

export const withClearedAuthCookies = (headers: HeadersInit = {}) => {
  const result = new Headers(headers);
  result.append('set-cookie', clearCookie(SESSION_COOKIE_NAME, true));
  result.append('set-cookie', clearCookie(CSRF_COOKIE_NAME));
  return result;
};
