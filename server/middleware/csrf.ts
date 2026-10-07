import {
  CSRF_COOKIE_NAME,
  CSRF_TOKEN_PATTERN,
  parseCookies,
} from './authentication';

export class InvalidCsrfError extends Error {
  constructor() {
    super('CSRF_INVALID');
  }
}

export const createCsrfToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};

const constantTimeTextEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

export const validateCsrf = (request: Request) => {
  const cookieToken = parseCookies(request).get(CSRF_COOKIE_NAME) ?? '';
  const headerToken = request.headers.get('x-csrf-token') ?? '';
  if (
    !CSRF_TOKEN_PATTERN.test(cookieToken) ||
    !CSRF_TOKEN_PATTERN.test(headerToken) ||
    !constantTimeTextEqual(cookieToken, headerToken)
  ) {
    throw new InvalidCsrfError();
  }
};
