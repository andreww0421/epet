import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const testMarkers = ['epet-test-product-analytics', '__epetTestAnalytics'];

/** @param {string} directory Inspect generated artifacts only; never log contents. */
export const assertProductionAnalyticsAssets = async (directory) => {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Production asset inspection requires a regular directory.');
  const synthetic = [];
  const visit = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Production asset inspection refuses symbolic links.');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const source = await readFile(file);
        if (testMarkers.some((marker) => source.includes(marker))) synthetic.push(relative(directory, file));
      }
    }
  };
  await visit(directory);
  if (synthetic.length) {
    throw new Error(`Synthetic analytics hooks found in production assets: ${synthetic.sort().join(', ')}. Remove stale test artifacts; E2E builds belong in output/playwright/server-dist.`);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/check-production-analytics.mjs (no directory overrides).');
    await assertProductionAnalyticsAssets(resolve(process.cwd(), 'dist'));
    console.log('Production assets contain no synthetic analytics hooks.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Production analytics asset inspection failed.');
    process.exitCode = 1;
  }
}
