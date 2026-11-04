import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { createApiHandler } from '../../../server/api';
import type { WorkspaceInvitationDelivery } from '../../../server/auth';
import { D1WorkspaceRepository } from '../../../worker/repository';
import {
  createResponseSecurityHeaders, DOCUMENT_CACHE_CONTROL,
  IMMUTABLE_ASSET_CACHE_CONTROL, PRIVATE_RESPONSE_CACHE_CONTROL, secureResponse,
} from '../../../shared/security/responsePolicy';
import {
  E2E_BASE_URL, E2E_DIST_DIRECTORY, getE2eInvitationFile, getE2eRuntimePaths,
} from './paths';

// This adapter exists only under tests/. It retains the real API, auth, CSRF,
// origin and rate-limit middleware while replacing JSON with real local D1.
if (process.env.EPET_E2E_REPOSITORY !== 'd1' || E2E_BASE_URL !== 'http://127.0.0.1:3100') {
  throw new Error('The synthetic D1 fixture requires its isolated capacity configuration');
}
const paths = getE2eRuntimePaths();
await mkdir(paths.directory);
await mkdir(paths.invitationOutboxDirectory);
await writeFile(paths.serverPidFile, String(process.pid), { encoding: 'utf8', flag: 'wx' });
const miniflare = new Miniflare({
  modules: true, d1Databases: ['DB'], d1Persist: join(paths.directory, 'd1'),
  script: 'export default { fetch() { return new Response("isolated synthetic capacity fixture"); } }',
});
const database = await miniflare.getD1Database('DB') as unknown as D1Database;
for (const file of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
  let lines: string[] = [];
  let insideTrigger = false;
  for (const raw of (await readFile(join('migrations', file), 'utf8')).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('--')) continue;
    if (/^CREATE\s+TRIGGER\b/i.test(line)) insideTrigger = true;
    lines.push(raw);
    if (insideTrigger ? /^END;$/i.test(line) : line.endsWith(';')) {
      await database.prepare(lines.join('\n')).run();
      lines = [];
      insideTrigger = false;
    }
  }
  if (lines.length) throw new Error(`Incomplete synthetic D1 migration: ${file}`);
}

const captureInvitation = (delivery: WorkspaceInvitationDelivery) =>
  writeFile(getE2eInvitationFile(delivery.email), JSON.stringify(delivery), { encoding: 'utf8', flag: 'wx' });
const repository = new D1WorkspaceRepository(database);
const trustedClientHeader = 'x-epet-transport-client';
const untrustedForwarding = new Set(['cf-connecting-ip', trustedClientHeader, 'x-forwarded-for', 'x-real-ip']);
const handleApi = createApiHandler(repository, {
  allowLocalWorkspaceIds: true, allowedOrigins: [], botProtectionRequired: false,
  emailVerificationRequired: false, forgotResponseFloorMs: 0, registrationEnabled: true,
  clientIdentity: (request) => request.headers.get(trustedClientHeader),
  workspaceInvitationMailer: captureInvitation,
});
const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};
const serveStatic = async (requestPath: string, response: import('node:http').ServerResponse) => {
  if (!existsSync(E2E_DIST_DIRECTORY)) return false;
  const withoutBase = requestPath.startsWith('/epet/') ? requestPath.slice('/epet'.length) : requestPath;
  const relative = withoutBase === '/' ? 'index.html' : withoutBase.replace(/^\/+/, '');
  const root = resolve(E2E_DIST_DIRECTORY);
  const resolved = resolve(root, normalize(relative));
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) return false;
  let file = resolved;
  try { if (!(await stat(file)).isFile()) file = join(root, 'index.html'); }
  catch { file = join(root, 'index.html'); }
  const document = file.endsWith('index.html');
  response.writeHead(200, {
    'content-type': mimeTypes[extname(file)] ?? 'application/octet-stream',
    ...Object.fromEntries(createResponseSecurityHeaders({ document,
      cacheControl: document ? DOCUMENT_CACHE_CONTROL : IMMUTABLE_ASSET_CACHE_CONTROL }).entries()),
  });
  createReadStream(file).pipe(response);
  return true;
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', E2E_BASE_URL);
  if (url.pathname.startsWith('/api/')) {
    const headers = new Headers();
    Object.entries(request.headers).forEach(([name, value]) => {
      if (untrustedForwarding.has(name.toLowerCase())) return;
      if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
      else if (value != null) headers.set(name, value);
    });
    headers.set(trustedClientHeader, request.socket.remoteAddress ?? 'unknown-client');
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const webRequest = new Request(url, { method: request.method, headers,
      body: hasBody ? Readable.toWeb(request) as ReadableStream<Uint8Array> : undefined,
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit);
    const result = secureResponse(await handleApi(webRequest), { cacheControl: PRIVATE_RESPONSE_CACHE_CONTROL });
    const outgoing: Record<string, string | string[]> = Object.fromEntries(result.headers.entries());
    const cookies = (result.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    if (cookies.length) outgoing['set-cookie'] = cookies;
    response.writeHead(result.status, outgoing);
    response.end(Buffer.from(await result.arrayBuffer()));
    return;
  }
  if (request.method === 'GET' && await serveStatic(url.pathname, response)) return;
  response.writeHead(404, { 'content-type': 'application/json',
    ...Object.fromEntries(createResponseSecurityHeaders({ cacheControl: PRIVATE_RESPONSE_CACHE_CONTROL }).entries()) });
  response.end(JSON.stringify({ error: 'NOT_FOUND' }));
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => { void miniflare.dispose().finally(() => process.exit(0)); });
  server.closeAllConnections();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
await repository.cleanupExpiredAuthData(Date.now());
server.listen(Number(new URL(E2E_BASE_URL).port), '127.0.0.1', () => {
  console.log(`ePet synthetic D1 E2E server listening on ${E2E_BASE_URL}`);
});
