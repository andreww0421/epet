import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { createApiHandler, type ApiOptions } from './api';
import { JsonWorkspaceRepository } from './repository';

const TRUSTED_CLIENT_IDENTITY_HEADER = 'x-epet-transport-client';
const UNTRUSTED_FORWARDING_HEADERS = new Set([
  'cf-connecting-ip',
  'x-epet-transport-client',
  'x-forwarded-for',
  'x-real-ip',
]);

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const serveStatic = async (
  requestPath: string,
  response: import('node:http').ServerResponse,
  distDirectory: string,
) => {
  if (!existsSync(distDirectory)) return false;
  const withoutBase = requestPath.startsWith('/epet/')
    ? requestPath.slice('/epet'.length)
    : requestPath;
  const relativePath = withoutBase === '/' ? 'index.html' : withoutBase.replace(/^\/+/, '');
  const distRoot = resolve(distDirectory);
  const resolvedPath = resolve(distRoot, normalize(relativePath));
  if (resolvedPath !== distRoot && !resolvedPath.startsWith(`${distRoot}${sep}`)) return false;
  let filePath = resolvedPath;
  try {
    if (!(await stat(filePath)).isFile()) filePath = join(distDirectory, 'index.html');
  } catch {
    filePath = join(distDirectory, 'index.html');
  }
  response.writeHead(200, {
    'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
    'cache-control': filePath.endsWith('index.html')
      ? 'no-store'
      : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cross-origin-opener-policy': 'same-origin',
  });
  createReadStream(filePath).pipe(response);
  return true;
};

export type EpetServerOptions = {
  dataFile: string;
  distDirectory: string;
  auth?: ApiOptions['auth'];
  forgotResponseFloorMs?: number;
  passwordResetMailer?: ApiOptions['passwordResetMailer'];
  registrationEnabled?: boolean;
};

export const createEpetServer = (options: EpetServerOptions) => {
  const repository = new JsonWorkspaceRepository(options.dataFile);
  const handleApi = createApiHandler(repository, {
    allowLocalWorkspaceIds: true,
    allowedOrigins: ['*'],
    auth: options.auth,
    clientIdentity: (request) =>
      request.headers.get(TRUSTED_CLIENT_IDENTITY_HEADER),
    forgotResponseFloorMs: options.forgotResponseFloorMs,
    passwordResetMailer: options.passwordResetMailer,
    registrationEnabled: options.registrationEnabled === true,
  });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers();
      Object.entries(request.headers).forEach(([name, value]) => {
        if (UNTRUSTED_FORWARDING_HEADERS.has(name.toLocaleLowerCase())) return;
        if (Array.isArray(value)) {
          value.forEach((entry) => headers.append(name, entry));
        } else if (value != null) {
          headers.set(name, value);
        }
      });
      headers.set(
        TRUSTED_CLIENT_IDENTITY_HEADER,
        request.socket.remoteAddress ?? 'unknown-client',
      );
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const webRequest = new Request(url, {
        method: request.method,
        headers,
        body: hasBody
          ? Readable.toWeb(request) as ReadableStream<Uint8Array>
          : undefined,
        ...(hasBody ? { duplex: 'half' } : {}),
      } as RequestInit);
      const webResponse = await handleApi(webRequest);
      response.writeHead(
        webResponse.status,
        Object.fromEntries(webResponse.headers.entries()),
      );
      response.end(Buffer.from(await webResponse.arrayBuffer()));
      return;
    }

    if (
      request.method === 'GET' &&
      await serveStatic(url.pathname, response, options.distDirectory)
    ) {
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });

  return { server, repository };
};
