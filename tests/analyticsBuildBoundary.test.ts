import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { assertProductionAnalyticsAssets } from '../scripts/check-production-analytics.mjs';
import { E2E_DIST_DIRECTORY } from './e2e/support/paths';

test('synthetic build and server share an isolated directory outside deployment assets', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')) as { assets: { directory: string } };
  const production = resolve(config.assets.directory);
  assert.ok(relative(production, E2E_DIST_DIRECTORY).startsWith('..'));
  assert.ok(relative(E2E_DIST_DIRECTORY, production).startsWith('..'));
  const build = await readFile(new URL('./e2e/support/web-server.ts', import.meta.url), 'utf8');
  const server = await readFile(new URL('./e2e/support/server.ts', import.meta.url), 'utf8');
  assert.match(build, /outDir: E2E_DIST_DIRECTORY/);
  assert.match(server, /distDirectory: E2E_DIST_DIRECTORY/);
  assert.doesNotMatch(server, /distDirectory:.*['"]dist['"]/);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: { build: string } };
  assert.match(pkg.scripts.build, /check-production-analytics\.mjs/);
});

test('production artifact check rejects stale synthetic chunks, without logging their contents', async (t) => {
  // A newly created, owned fixture directory, never a user-supplied path.
  const directory = await mkdtemp(join(tmpdir(), 'epet-analytics-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<script src="/assets/current.js"></script>');
  await writeFile(join(directory, 'assets/current.js'), '/* safe production bundle */');
  await assert.doesNotReject(assertProductionAnalyticsAssets(directory));
  const privateText = 'SYNTHETIC-PRIVATE-CONTENT-NOT-A-DIAGNOSTIC';
  for (const marker of ['epet-test-product-analytics', '__epetTestAnalytics']) {
    await writeFile(join(directory, 'assets/stale.js'), `${marker} ${privateText}`);
    await assert.rejects(assertProductionAnalyticsAssets(directory), (error: unknown) =>
      error instanceof Error && error.message.includes('stale.js') && !error.message.includes(privateText));
  }
});
