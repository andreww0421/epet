import { appendFileSync, lstatSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const suiteDirectories = {
  e2e: 'tests/e2e',
  a11y: 'tests/accessibility',
  capacity: 'tests/e2e-capacity',
};

// Discover every checked-in browser spec, including new regression suites.
// Each matrix job gets its own server/database, retaining real auth quotas.
export const discoverBrowserSuites = (root = process.cwd()) => {
  const include = [];
  for (const [kind, directory] of Object.entries(suiteDirectories)) {
    const path = resolve(root, directory);
    let entries;
    try {
      if (lstatSync(path).isSymbolicLink()) throw new Error(`Symlink suite directory: ${directory}`);
      entries = readdirSync(path, { withFileTypes: true });
    } catch (error) {
      // Older branches may predate capacity regressions. An existing directory
      // must never silently disappear or yield a skipped required job.
      if (kind === 'capacity' && error.code === 'ENOENT') continue;
      throw error;
    }
    const specs = entries.filter((entry) => entry.name.endsWith('.spec.ts'));
    if (!specs.length) throw new Error(`Empty browser suite: ${directory}`);
    for (const entry of specs.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.spec\.ts$/.test(entry.name)) {
        throw new Error(`Unsafe browser spec: ${directory}/${entry.name}`);
      }
      include.push({ kind, spec: `${directory}/${entry.name}` });
    }
  }
  return { include };
};

export const assertRequiredJobs = (needs) => {
  const expected = ['browser', 'discover', 'verify'];
  if (!needs || typeof needs !== 'object' ||
      JSON.stringify(Object.keys(needs).sort()) !== JSON.stringify(expected)) {
    throw new Error('Missing or unexpected required CI jobs');
  }
  for (const name of expected) {
    if (needs[name]?.result !== 'success') {
      throw new Error(`Required CI job did not succeed: ${name}`);
    }
  }
};

export const browserArguments = (kind, spec, root = process.cwd()) => {
  if (!discoverBrowserSuites(root).include.some((suite) => suite.kind === kind && suite.spec === spec)) {
    throw new Error('Browser selection is not a discovered spec');
  }
  return ['test', '--config', kind === 'a11y' ? 'playwright.a11y.config.ts'
    : kind === 'capacity' ? 'playwright.capacity.config.ts' : 'playwright.config.ts', spec];
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const operation = process.argv[2];
  if (operation === 'matrix') {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(discoverBrowserSuites())}\n`);
  } else if (operation === 'gate') {
    assertRequiredJobs(JSON.parse(process.env.EPET_CI_NEEDS ?? 'null'));
    console.log('All required application and browser jobs succeeded.');
  } else if (operation === 'browser') {
    const args = browserArguments(process.env.EPET_CI_KIND, process.env.EPET_CI_SPEC);
    const result = spawnSync(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), ...args], {
      stdio: 'inherit', shell: false,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else {
    throw new Error('Expected matrix, gate or browser');
  }
}
