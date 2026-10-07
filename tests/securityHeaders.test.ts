import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEpetServer } from '../server/app';
import {
  BASE_CONTENT_SECURITY_POLICY,
  DEFAULT_PERMISSIONS_POLICY,
  DOCUMENT_CACHE_CONTROL,
  IMMUTABLE_ASSET_CACHE_CONTROL,
  PRIVATE_RESPONSE_CACHE_CONTROL,
  STRICT_TRANSPORT_SECURITY,
} from '../shared/security/responsePolicy';
import worker from '../worker/index';

type TestServer = ReturnType<typeof createEpetServer>['server'];

const listenForTest = async (server: TestServer) => {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once('error', handleError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', handleError);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
};

const closeTestServer = async (server: TestServer) => {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
};

const assertCommonSecurityHeaders = (
  headers: Headers,
  strictTransportSecurity: boolean,
) => {
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('permissions-policy'), DEFAULT_PERMISSIONS_POLICY);
  assert.equal(headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(headers.get('cross-origin-embedder-policy'), null);
  assert.equal(
    headers.get('strict-transport-security'),
    strictTransportSecurity ? STRICT_TRANSPORT_SECURITY : null,
  );
};

test('Node responses apply shared headers with route-appropriate caching', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-header-test-'));
  const distDirectory = join(directory, 'dist');
  await mkdir(join(distDirectory, 'assets'), { recursive: true });
  await Promise.all([
    writeFile(
      join(distDirectory, 'index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>',
      'utf8',
    ),
    writeFile(
      join(distDirectory, 'assets', 'app-abc123.js'),
      'console.log("fixture");',
      'utf8',
    ),
  ]);
  const { server } = createEpetServer({
    dataFile: join(directory, 'data.json'),
    distDirectory,
  });

  try {
    const baseUrl = await listenForTest(server);

    const documentResponse = await fetch(`${baseUrl}/`);
    assert.equal(documentResponse.status, 200);
    assertCommonSecurityHeaders(documentResponse.headers, false);
    assert.equal(
      documentResponse.headers.get('content-security-policy'),
      BASE_CONTENT_SECURITY_POLICY,
    );
    assert.equal(
      documentResponse.headers.get('cache-control'),
      DOCUMENT_CACHE_CONTROL,
    );
    await documentResponse.arrayBuffer();

    const assetResponse = await fetch(`${baseUrl}/assets/app-abc123.js`);
    assert.equal(assetResponse.status, 200);
    assertCommonSecurityHeaders(assetResponse.headers, false);
    assert.equal(assetResponse.headers.get('content-security-policy'), null);
    assert.equal(
      assetResponse.headers.get('cache-control'),
      IMMUTABLE_ASSET_CACHE_CONTROL,
    );
    await assetResponse.arrayBuffer();

    const apiResponse = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(apiResponse.status, 200);
    assertCommonSecurityHeaders(apiResponse.headers, false);
    assert.equal(apiResponse.headers.get('content-security-policy'), null);
    assert.equal(
      apiResponse.headers.get('cache-control'),
      PRIVATE_RESPONSE_CACHE_CONTROL,
    );
    await apiResponse.arrayBuffer();

    const preflightResponse = await fetch(`${baseUrl}/api/v1/state`, {
      method: 'OPTIONS',
      headers: { origin: baseUrl },
    });
    assert.equal(preflightResponse.status, 204);
    assertCommonSecurityHeaders(preflightResponse.headers, false);
    assert.equal(
      preflightResponse.headers.get('cache-control'),
      PRIVATE_RESPONSE_CACHE_CONTROL,
    );

    const notFoundResponse = await fetch(`${baseUrl}/missing`, {
      method: 'POST',
    });
    assert.equal(notFoundResponse.status, 404);
    assertCommonSecurityHeaders(notFoundResponse.headers, false);
    assert.equal(
      notFoundResponse.headers.get('cache-control'),
      PRIVATE_RESPONSE_CACHE_CONTROL,
    );
    await notFoundResponse.arrayBuffer();
  } finally {
    await closeTestServer(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('Worker document and API responses add the production-only profile', async () => {
  type WorkerFetch = typeof worker.fetch;
  const env = {
    ASSETS: {
      fetch: async () => new Response('<!doctype html><html></html>', {
        headers: {
          'cache-control': 'public, max-age=0, must-revalidate',
          'content-type': 'text/html; charset=utf-8',
          etag: 'fixture-etag',
        },
      }),
    },
    DB: {},
  } as unknown as Parameters<WorkerFetch>[1];
  const context = {
    waitUntil: (_task: Promise<unknown>) => undefined,
  } as unknown as Parameters<WorkerFetch>[2];

  const documentResponse = await worker.fetch(
    new Request('https://epet.example.test/'),
    env,
    context,
  );
  assertCommonSecurityHeaders(documentResponse.headers, true);
  assert.equal(
    documentResponse.headers.get('content-security-policy'),
    `${BASE_CONTENT_SECURITY_POLICY}; upgrade-insecure-requests`,
  );
  assert.equal(
    documentResponse.headers.get('cache-control'),
    DOCUMENT_CACHE_CONTROL,
  );
  assert.equal(documentResponse.headers.get('etag'), 'fixture-etag');
  await documentResponse.arrayBuffer();

  const apiResponse = await worker.fetch(
    new Request('https://epet.example.test/api/v1/health'),
    env,
    context,
  );
  assert.equal(apiResponse.status, 200);
  assertCommonSecurityHeaders(apiResponse.headers, true);
  assert.equal(apiResponse.headers.get('content-security-policy'), null);
  assert.equal(
    apiResponse.headers.get('cache-control'),
    PRIVATE_RESPONSE_CACHE_CONTROL,
  );
  await apiResponse.arrayBuffer();
});

test('Cloudflare assets-first policy hardens and caches fingerprinted files', async () => {
  const headersFile = await readFile(
    join(process.cwd(), 'public', '_headers'),
    'utf8',
  );

  assert.match(headersFile, /^\/assets\/\*$/m);
  assert.match(
    headersFile,
    new RegExp(`Cache-Control: ${IMMUTABLE_ASSET_CACHE_CONTROL}`),
  );
  assert.match(headersFile, /X-Content-Type-Options: nosniff/);
  assert.match(headersFile, /Cross-Origin-Resource-Policy: same-origin/);
  assert.match(
    headersFile,
    new RegExp(`Strict-Transport-Security: ${STRICT_TRANSPORT_SECURITY}`),
  );
});
