import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

const readSource = (path: string) => readFile(join(root, path), 'utf8');

test('server/api.ts remains a small compatibility composition root', async () => {
  const source = await readSource('server/api.ts');
  assert.ok(
    source.split(/\r?\n/).length <= 200,
    'server/api.ts should coordinate middleware and routes, not own handlers',
  );
  assert.match(source, /export const createApiHandler/);
  assert.match(source, /export type \{[\s\S]*ApiOptions/);
  assert.match(source, /handleAuthRoutes/);
  assert.match(source, /handleWorkspaceRoutes/);
  assert.match(source, /handleAdminRoutes/);
});

test('route modules do not depend on the API composition root or UI state', async () => {
  const routeFiles = [
    'adminRoutes.ts',
    'analyticsRoutes.ts',
    'authRoutes.ts',
    'bossRoutes.ts',
    'learningRoutes.ts',
    'studentRoutes.ts',
    'systemRoutes.ts',
    'workspaceRoutes.ts',
  ];

  for (const file of routeFiles) {
    const source = await readSource(`server/routes/${file}`);
    assert.doesNotMatch(source, /from ['"]\.\.\/api['"]/);
    assert.doesNotMatch(source, /from ['"](?:react|zustand)['"]/);
  }
});

test('lower server layers do not import route modules', async () => {
  const lowerLayerFiles = [
    'server/contracts/api.ts',
    'server/http/body.ts',
    'server/http/request.ts',
    'server/http/response.ts',
    'server/middleware/authentication.ts',
    'server/middleware/authorization.ts',
    'server/middleware/csrf.ts',
    'server/middleware/errorResponse.ts',
    'server/middleware/origin.ts',
    'server/middleware/rateLimit.ts',
    'server/services/apiRuntime.ts',
    'server/services/auditQuery.ts',
    'server/services/workspaceValidation.ts',
  ];

  for (const file of lowerLayerFiles) {
    const source = await readSource(file);
    assert.doesNotMatch(source, /from ['"][^'"]*routes\//);
  }
});
