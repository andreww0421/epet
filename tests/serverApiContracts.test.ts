import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApiHandler } from '../server/api';
import { JsonWorkspaceRepository } from '../server/repository';

const REQUEST_ORIGIN = 'http://localhost';
const ALLOWED_CROSS_ORIGIN = 'https://teacher.example.test';
const OWNER_EMAIL = 'contract-owner@example.test';
const OWNER_PASSWORD = 'correct horse battery staple';

type ApiHandler = ReturnType<typeof createApiHandler>;

type RegisteredClient = {
  cookieHeader: string;
  csrfToken: string;
  setCookies: string[];
  workspaceId: string;
};

const getSetCookies = (headers: Headers) => {
  const values = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  if (values && values.length > 0) return values;

  const combined = headers.get('set-cookie') ?? '';
  return combined
    ? combined.split(/,(?=\s*__Host-epet_(?:session|csrf)=)/)
    : [];
};

const findCookie = (setCookies: string[], name: string) =>
  setCookies.find((value) => value.startsWith(`${name}=`)) ?? '';

const readCookieValue = (setCookie: string) =>
  setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));

const createFixture = async (allowedOrigins: string[] = []) => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-api-contract-'));
  const repository = new JsonWorkspaceRepository(join(directory, 'data.json'));
  const handler = createApiHandler(repository, {
    allowLocalWorkspaceIds: true,
    allowedOrigins,
    auth: { passwordIterations: 10 },
    registrationEnabled: true,
  });

  return {
    handler,
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
};

const registerOwner = async (
  handler: ApiHandler,
): Promise<RegisteredClient> => {
  const response = await handler(new Request(
    `${REQUEST_ORIGIN}/api/v1/auth/register`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: REQUEST_ORIGIN,
      },
      body: JSON.stringify({
        displayName: 'Contract Owner',
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        workspaceName: 'Contract Workspace',
      }),
    },
  ));
  assert.equal(response.status, 201);
  const body = await response.json() as {
    csrfToken: string;
    session: { activeWorkspaceId: string | null };
  };
  assert.ok(body.session.activeWorkspaceId);

  const setCookies = getSetCookies(response.headers);
  const sessionCookie = findCookie(setCookies, '__Host-epet_session');
  const csrfCookie = findCookie(setCookies, '__Host-epet_csrf');
  assert.ok(sessionCookie);
  assert.ok(csrfCookie);

  return {
    cookieHeader:
      `__Host-epet_session=${readCookieValue(sessionCookie)}; ` +
      `__Host-epet_csrf=${readCookieValue(csrfCookie)}`,
    csrfToken: body.csrfToken,
    setCookies,
    workspaceId: body.session.activeWorkspaceId,
  };
};

const malformedStateRequest = (
  headers: HeadersInit,
  workspaceId?: string,
) => {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('content-type', 'application/json');
  if (workspaceId) requestHeaders.set('x-epet-workspace', workspaceId);
  return new Request(`${REQUEST_ORIGIN}/api/v1/state`, {
    method: 'PUT',
    headers: requestHeaders,
    body: '{ malformed json',
  });
};

const assertJsonError = async (
  response: Response,
  status: number,
  error: string,
) => {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error });
  assert.equal(response.headers.get('cache-control'), 'no-store');
};

test('protected state writes preserve middleware precedence before body parsing', async () => {
  const fixture = await createFixture();
  try {
    const client = await registerOwner(fixture.handler);

    await assertJsonError(
      await fixture.handler(malformedStateRequest({})),
      403,
      'ORIGIN_REQUIRED',
    );
    await assertJsonError(
      await fixture.handler(malformedStateRequest({ origin: REQUEST_ORIGIN })),
      401,
      'INVALID_SESSION',
    );
    await assertJsonError(
      await fixture.handler(malformedStateRequest({
        cookie: client.cookieHeader,
        origin: REQUEST_ORIGIN,
      })),
      403,
      'CSRF_INVALID',
    );
    await assertJsonError(
      await fixture.handler(malformedStateRequest({
        cookie: client.cookieHeader,
        origin: REQUEST_ORIGIN,
        'x-csrf-token': client.csrfToken,
      })),
      400,
      'INVALID_WORKSPACE',
    );
    await assertJsonError(
      await fixture.handler(malformedStateRequest({
        cookie: client.cookieHeader,
        origin: REQUEST_ORIGIN,
        'x-csrf-token': client.csrfToken,
      }, client.workspaceId)),
      400,
      'INVALID_JSON',
    );
  } finally {
    await fixture.dispose();
  }
});

test('session and CSRF cookies preserve flags, reuse, and clearing behavior', async () => {
  const fixture = await createFixture();
  try {
    const client = await registerOwner(fixture.handler);
    const sessionSetCookie = findCookie(
      client.setCookies,
      '__Host-epet_session',
    );
    const csrfSetCookie = findCookie(client.setCookies, '__Host-epet_csrf');

    assert.match(
      sessionSetCookie,
      /^__Host-epet_session=[A-Za-z0-9_-]+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax; Priority=High$/,
    );
    assert.match(
      csrfSetCookie,
      /^__Host-epet_csrf=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; Secure; SameSite=Lax; Priority=High$/,
    );
    assert.doesNotMatch(csrfSetCookie, /; HttpOnly(?:;|$)/);

    const sessionResponse = await fixture.handler(new Request(
      `${REQUEST_ORIGIN}/api/v1/auth/session`,
      { headers: { cookie: client.cookieHeader } },
    ));
    assert.equal(sessionResponse.status, 200);
    assert.equal(sessionResponse.headers.get('cache-control'), 'no-store');
    const sessionBody = await sessionResponse.json() as { csrfToken: string };
    assert.equal(sessionBody.csrfToken, client.csrfToken);
    const refreshedCookies = getSetCookies(sessionResponse.headers);
    assert.equal(refreshedCookies.length, 1);
    assert.equal(
      readCookieValue(findCookie(refreshedCookies, '__Host-epet_csrf')),
      client.csrfToken,
    );
    assert.equal(
      findCookie(refreshedCookies, '__Host-epet_session'),
      '',
    );

    const invalidSessionResponse = await fixture.handler(new Request(
      `${REQUEST_ORIGIN}/api/v1/auth/session`,
      {
        headers: {
          cookie:
            `__Host-epet_session=${'a'.repeat(40)}; ` +
            `__Host-epet_csrf=${client.csrfToken}`,
        },
      },
    ));
    await assertJsonError(
      invalidSessionResponse.clone(),
      401,
      'INVALID_SESSION',
    );
    const invalidSessionCookies = getSetCookies(invalidSessionResponse.headers);
    assert.equal(
      findCookie(invalidSessionCookies, '__Host-epet_session'),
      '__Host-epet_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Priority=High',
    );
    assert.equal(
      findCookie(invalidSessionCookies, '__Host-epet_csrf'),
      '__Host-epet_csrf=; Path=/; Max-Age=0; Secure; SameSite=Lax; Priority=High',
    );

    const logoutResponse = await fixture.handler(new Request(
      `${REQUEST_ORIGIN}/api/v1/auth/logout`,
      {
        method: 'POST',
        headers: {
          cookie: client.cookieHeader,
          origin: REQUEST_ORIGIN,
          'x-csrf-token': client.csrfToken,
        },
      },
    ));
    assert.equal(logoutResponse.status, 204);
    assert.equal(await logoutResponse.text(), '');
    assert.equal(logoutResponse.headers.get('cache-control'), 'no-store');
    const logoutCookies = getSetCookies(logoutResponse.headers);
    assert.equal(
      findCookie(logoutCookies, '__Host-epet_session'),
      '__Host-epet_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Priority=High',
    );
    assert.equal(
      findCookie(logoutCookies, '__Host-epet_csrf'),
      '__Host-epet_csrf=; Path=/; Max-Age=0; Secure; SameSite=Lax; Priority=High',
    );
  } finally {
    await fixture.dispose();
  }
});

test('CORS responses preserve credentials, origin scoping, and no-store semantics', async () => {
  const fixture = await createFixture([ALLOWED_CROSS_ORIGIN]);
  try {
    const allowed = await fixture.handler(new Request(
      `${REQUEST_ORIGIN}/api/v1/health`,
      { headers: { origin: ALLOWED_CROSS_ORIGIN } },
    ));
    assert.equal(allowed.status, 200);
    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      ALLOWED_CROSS_ORIGIN,
    );
    assert.equal(
      allowed.headers.get('access-control-allow-credentials'),
      'true',
    );
    assert.equal(allowed.headers.get('vary'), 'Origin');
    assert.equal(allowed.headers.get('cache-control'), 'no-store');

    const preflight = await fixture.handler(new Request(
      `${REQUEST_ORIGIN}/api/v1/state`,
      {
        method: 'OPTIONS',
        headers: { origin: ALLOWED_CROSS_ORIGIN },
      },
    ));
    assert.equal(preflight.status, 204);
    assert.equal(await preflight.text(), '');
    assert.equal(
      preflight.headers.get('access-control-allow-origin'),
      ALLOWED_CROSS_ORIGIN,
    );
    assert.equal(
      preflight.headers.get('access-control-allow-credentials'),
      'true',
    );
    assert.equal(preflight.headers.get('vary'), 'Origin');
    assert.equal(
      preflight.headers.get('access-control-allow-methods'),
      'GET, PUT, POST, PATCH, DELETE, OPTIONS',
    );
    assert.equal(
      preflight.headers.get('access-control-allow-headers'),
      'content-type, x-csrf-token, x-epet-workspace, x-request-id',
    );

    const denied = await fixture.handler(new Request(
      `${REQUEST_ORIGIN}/api/v1/health`,
      { headers: { origin: 'https://attacker.example.test' } },
    ));
    await assertJsonError(denied.clone(), 403, 'ORIGIN_NOT_ALLOWED');
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    assert.equal(denied.headers.get('vary'), 'Origin');
  } finally {
    await fixture.dispose();
  }
});
