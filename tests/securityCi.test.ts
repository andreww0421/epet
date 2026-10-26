import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertRequiredJobs,
  browserArguments,
  discoverBrowserSuites,
} from '../scripts/release-ci.mjs';

const root = process.cwd();
const readSource = (path: string) => readFile(join(root, path), 'utf8');
const getJobBlock = (source: string, jobId: string) => {
  const start = source.search(new RegExp(`^  ${jobId}:\\s*$`, 'm'));
  assert.notEqual(start, -1, `missing ${jobId} job`);
  const remaining = source.slice(start + 1);
  const nextJob = remaining.search(/^  [a-z0-9_-]+:\s*$/m);
  return nextJob === -1 ? source.slice(start) : source.slice(start, start + 1 + nextJob);
};

interface DependencyManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface LockedPackage extends DependencyManifest {
  version?: string;
}

interface DependencyLock {
  packages: Record<string, LockedPackage>;
}

const readDependencyLock = async (): Promise<DependencyLock> =>
  JSON.parse(await readSource('package-lock.json')) as DependencyLock;

const stableVersion = (version: string | undefined, label: string): number[] => {
  assert.ok(version, `${label} must have a locked version`);
  assert.match(version, /^\d+\.\d+\.\d+$/, `${label} must use a stable release`);
  return version.split('.').map(Number);
};

const versionAtLeast = (version: number[], floor: number[]): boolean => {
  for (let index = 0; index < 3; index += 1) {
    if (version[index] !== floor[index]) return version[index] > floor[index];
  }
  return true;
};

test('manifest dependency specifications match the lockfile root', async () => {
  const [manifestSource, lock] = await Promise.all([
    readSource('package.json'),
    readDependencyLock(),
  ]);
  const manifest = JSON.parse(manifestSource) as DependencyManifest;
  const rootPackage = lock.packages[''];
  assert.ok(rootPackage, 'lockfile must include the root package');
  for (const scope of ['dependencies', 'devDependencies'] as const) {
    assert.deepEqual(rootPackage[scope] ?? {}, manifest[scope] ?? {}, `${scope} must match`);
  }
});

for (const [packageName, patchedFloor] of Object.entries({
  nanoid: '3.3.18',
  'source-map-js': '1.2.2',
  sharp: '0.35.5',
  undici: '7.29.1',
})) {
  test(`every locked ${packageName} instance is stable and above its security patch floor`, async () => {
    const lock = await readDependencyLock();
    const instances = Object.entries(lock.packages).filter(([path]) =>
      path === `node_modules/${packageName}` || path.endsWith(`/node_modules/${packageName}`),
    );
    assert.ok(instances.length > 0, `expected at least one locked ${packageName} instance`);
    const floor = stableVersion(patchedFloor, `${packageName} security patch floor`);
    for (const [path, lockedPackage] of instances) {
      const version = stableVersion(lockedPackage.version, path);
      assert.ok(
        versionAtLeast(version, floor),
        `${path} ${lockedPackage.version} must be at least patched release ${patchedFloor}`,
      );
    }
  });
}

test('locked Wrangler, Miniflare, and workerd releases remain a coherent stable pair', async () => {
  const lock = await readDependencyLock();
  const wrangler = lock.packages['node_modules/wrangler'];
  const miniflare = lock.packages['node_modules/miniflare'];
  const workerd = lock.packages['node_modules/workerd'];
  assert.ok(wrangler && miniflare && workerd, 'all Worker toolchain packages must be locked');
  stableVersion(wrangler.version, 'wrangler');
  stableVersion(miniflare.version, 'miniflare');
  stableVersion(workerd.version, 'workerd');
  assert.equal(wrangler.dependencies?.miniflare, miniflare.version);
  assert.equal(wrangler.dependencies?.workerd, workerd.version);
  assert.equal(miniflare.dependencies?.workerd, workerd.version);
});

test('security workflow uses isolated least-privilege jobs and immutable actions', async () => {
  const source = await readSource('.github/workflows/security.yml');

  assert.match(source, /^permissions: \{\}$/m);
  assert.match(source, /^  push:$/m);
  assert.match(source, /^  pull_request:$/m);
  assert.match(source, /^  schedule:$/m);
  assert.match(source, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(source, /pull_request_target:/);
  assert.doesNotMatch(source, /\bsecrets\s*(?:\.|\[)/);
  assert.doesNotMatch(source, /CLOUDFLARE_|db:migrate|deploy:worker/);
  assert.doesNotMatch(
    source,
    /continue-on-error:\s*true|warn-only:\s*true|\|\|\s*true|--omit(?:=|\s+)dev/,
  );

  const actionReferences = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(
    ([, reference]) => reference,
  );
  assert.ok(actionReferences.length >= 6, 'expected all security action steps to be pinned');
  for (const reference of actionReferences) {
    assert.match(
      reference,
      /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/,
      `${reference} must use an immutable full commit SHA`,
    );
  }

  const codeqlJob = getJobBlock(source, 'codeql');
  assert.match(
    codeqlJob,
    /permissions:\s*\n\s+actions: read\s*\n\s+contents: read\s*\n\s+security-events: write/,
  );
  assert.deepEqual(
    [...codeqlJob.matchAll(/^\s+([\w-]+):\s*write\s*$/gm)].map(([, scope]) => scope),
    ['security-events'],
  );
  const dependencyReviewJob = getJobBlock(source, 'dependency-review');
  const npmAuditJob = getJobBlock(source, 'npm-audit');
  for (const job of [dependencyReviewJob, npmAuditJob]) {
    assert.match(job, /permissions:\s*\n\s+contents: read/);
    assert.doesNotMatch(job, /^\s+[\w-]+:\s*write\s*$/m);
  }
  assert.match(source, /github\/codeql-action\/init@[0-9a-f]{40}/);
  assert.match(source, /github\/codeql-action\/analyze@[0-9a-f]{40}/);
  assert.match(source, /languages: javascript-typescript/);
  assert.match(source, /actions\/dependency-review-action@[0-9a-f]{40}/);
  assert.match(source, /fail-on-severity: high/);
  assert.match(source, /fail-on-scopes: runtime, development, unknown/);
  assert.match(source, /npm audit --audit-level=high/);
  assert.ok(
    (source.match(/::error title=/g) ?? []).length >= 3,
    'each security scanner should provide an understandable failure annotation',
  );
});

test('Dependabot monitors npm and GitHub Actions without external credentials', async () => {
  const source = await readSource('.github/dependabot.yml');

  assert.match(source, /^version: 2$/m);
  assert.match(source, /package-ecosystem: npm/);
  assert.match(source, /package-ecosystem: github-actions/);
  assert.equal((source.match(/interval: weekly/g) ?? []).length, 2);
  assert.doesNotMatch(source, /registries:|password:|token:|\bsecrets\s*\./);
});

test('security policy documents disclosure, secrets, dependencies, and support', async () => {
  const source = await readSource('SECURITY.md');

  for (const heading of [
    '## Supported versions',
    '## Reporting a vulnerability',
    '## Secret handling',
    '## Dependency policy',
    '## Responsible disclosure',
  ]) {
    assert.match(source, new RegExp(`^${heading}$`, 'm'));
  }

  assert.match(source, /security\/advisories\/new/);
  assert.match(source, /secret scanning/i);
  assert.match(source, /push protection/i);
  assert.match(source, /student personally identifiable information/i);
  assert.match(source, /npm audit --audit-level=high/);
});

test('security checks remain separate from the production deployment workflow', async () => {
  const [securityWorkflow, deployWorkflow] = await Promise.all([
    readSource('.github/workflows/security.yml'),
    readSource('.github/workflows/deploy.yml'),
  ]);

  assert.match(deployWorkflow, /^name: Deploy to Cloudflare Worker$/m);
  assert.match(deployWorkflow, /npm run deploy:worker/);
  assert.doesNotMatch(securityWorkflow, /workflow_call:|\.\/\.github\/workflows\/deploy\.yml/);
});

const successfulRequiredJobs = () => ({
  discover: { result: 'success' },
  verify: { result: 'success' },
  browser: { result: 'success' },
});

test('the required CI gate accepts only the complete set of successful jobs', () => {
  assert.doesNotThrow(() => assertRequiredJobs(successfulRequiredJobs()));
  for (const missing of ['discover', 'verify', 'browser']) {
    const needs: Record<string, { result: string }> = successfulRequiredJobs();
    delete needs[missing];
    assert.throws(() => assertRequiredJobs(needs), `missing ${missing} must block merge`);
  }
  assert.throws(() => assertRequiredJobs({
    ...successfulRequiredJobs(), unexpected: { result: 'success' },
  }));
  for (const invalid of [null, undefined, [], 'success', {}]) {
    assert.throws(() => assertRequiredJobs(invalid));
  }
});

for (const result of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'pending', '']) {
  test(`the required CI gate rejects ${result || 'empty'} results in every dependency`, () => {
    for (const dependency of ['discover', 'verify', 'browser']) {
      const needs = successfulRequiredJobs();
      needs[dependency] = { result };
      assert.throws(() => assertRequiredJobs(needs), `${dependency}: ${result}`);
    }
  });
}

test('the browser matrix covers every checked-in functional, accessibility and capacity spec', async () => {
  const expected: Array<{ kind: string; spec: string }> = [];
  for (const [kind, directory] of [
    ['e2e', 'tests/e2e'],
    ['a11y', 'tests/accessibility'],
    ['capacity', 'tests/e2e-capacity'],
  ]) {
    let names: string[];
    try {
      names = await readdir(join(root, directory));
    } catch (error) {
      if (kind === 'capacity' && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const specs = names.filter((name) => name.endsWith('.spec.ts')).sort();
    assert.ok(specs.length > 0, `${directory} must contain real browser tests`);
    expected.push(...specs.map((name) => ({ kind, spec: `${directory}/${name}` })));
  }
  assert.deepEqual(discoverBrowserSuites(root), { include: expected });
});

const withBrowserFixture = async (operation: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-ci-contract-'));
  try {
    for (const suite of ['tests/e2e', 'tests/accessibility']) {
      await mkdir(join(directory, suite), { recursive: true });
      await writeFile(join(directory, suite, 'sample.spec.ts'), '// synthetic fixture\n');
    }
    await operation(directory);
  } finally {
    // Only the dedicated, newly created temporary fixture is removed.
    await rm(directory, { recursive: true, force: true });
  }
};

test('older branches may omit capacity suites but existing or mandatory empty suites fail closed', async () => {
  await withBrowserFixture(async (directory) => {
    assert.deepEqual(discoverBrowserSuites(directory), {
      include: [
        { kind: 'e2e', spec: 'tests/e2e/sample.spec.ts' },
        { kind: 'a11y', spec: 'tests/accessibility/sample.spec.ts' },
      ],
    });
    const capacity = join(directory, 'tests/e2e-capacity');
    await mkdir(capacity);
    assert.throws(() => discoverBrowserSuites(directory), /Empty browser suite/);
    await writeFile(join(capacity, 'sample.spec.ts'), '// synthetic fixture\n');
    assert.equal(discoverBrowserSuites(directory).include.length, 3);
    for (const suite of ['tests/e2e', 'tests/accessibility']) {
      const path = join(directory, suite, 'sample.spec.ts');
      await rm(path);
      assert.throws(() => discoverBrowserSuites(directory), /Empty browser suite/);
      await writeFile(path, '// synthetic fixture\n');
    }
    await rm(join(directory, 'tests/accessibility'), { recursive: true });
    assert.throws(() => discoverBrowserSuites(directory));
  });
});

test('browser discovery rejects shell-shaped filenames and symbolic links', async () => {
  await withBrowserFixture(async (directory) => {
    for (const name of ['unsafe name.spec.ts', 'unsafe;command.spec.ts']) {
      const unsafe = join(directory, 'tests/e2e', name);
      await writeFile(unsafe, '// synthetic fixture\n');
      assert.throws(() => discoverBrowserSuites(directory), /Unsafe browser spec/);
      await rm(unsafe);
    }
    const link = join(directory, 'tests/e2e', 'linked.spec.ts');
    // Windows junctions avoid a symlink privilege requirement and still expose
    // a symbolic-link directory entry. CI uses an ordinary directory symlink.
    await symlink(join(directory, 'tests/accessibility'), link,
      process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => discoverBrowserSuites(directory), /Unsafe browser spec/);
    await rm(link, { recursive: true });
    const suite = join(directory, 'tests/e2e-capacity');
    await symlink(join(directory, 'tests/accessibility'), suite,
      process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => discoverBrowserSuites(directory), /Symlink suite directory/);
  });
});

test('browser execution accepts only a discovered kind and path with array arguments', async () => {
  await withBrowserFixture(async (directory) => {
    await mkdir(join(directory, 'tests/e2e-capacity'));
    await writeFile(join(directory, 'tests/e2e-capacity/sample.spec.ts'), '// synthetic fixture\n');
    for (const [kind, folder, config] of [
      ['e2e', 'tests/e2e', 'playwright.config.ts'],
      ['a11y', 'tests/accessibility', 'playwright.a11y.config.ts'],
      ['capacity', 'tests/e2e-capacity', 'playwright.capacity.config.ts'],
    ]) {
      assert.deepEqual(browserArguments(kind, `${folder}/sample.spec.ts`, directory),
        ['test', '--config', config, `${folder}/sample.spec.ts`]);
    }
    for (const [kind, spec] of [
      ['e2e', 'tests/accessibility/sample.spec.ts'],
      ['a11y', 'tests/e2e/sample.spec.ts'],
      ['e2e', 'tests/e2e/missing.spec.ts'],
      ['e2e', '../tests/e2e/sample.spec.ts'],
      ['e2e', '--config=playwright.staging.config.ts'],
      ['e2e;command', 'tests/e2e/sample.spec.ts'],
    ]) {
      assert.throws(() => browserArguments(kind, spec, directory));
    }
  });
  const runner = await readSource('scripts/release-ci.mjs');
  assert.match(runner, /spawnSync\(process\.execPath,\s*\[/);
  assert.match(runner, /shell:\s*false/);
  assert.doesNotMatch(runner, /shell:\s*true|execSync\(/);
});

test('functional PR checks run without deployment authority and cannot hide failed dependencies', async () => {
  const source = await readSource('.github/workflows/functional.yml');
  const workflow = source.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /^  pull_request:\s*\n\s+branches:\s*\[main\]/m);
  assert.match(workflow, /^  push:\s*\n\s+branches:\s*\[main\]/m);
  assert.match(workflow, /^  merge_group:/m);
  assert.doesNotMatch(workflow,
    /pull_request_target:|paths(?:-ignore)?:|branches-ignore:|environment:|\bsecrets\s*(?:\.|\[)|CLOUDFLARE_|db:migrate|deploy:worker|upload-artifact|continue-on-error:\s*true|\|\|\s*true/);
  const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)];
  assert.ok(actionReferences.length > 0);
  for (const [, reference] of actionReferences) {
    assert.match(reference, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  }
  for (const jobId of ['discover', 'verify', 'browser', 'required']) {
    const job = getJobBlock(workflow, jobId);
    assert.match(job, /permissions:\s*\n\s+contents: read/);
    assert.doesNotMatch(job, /^\s+[\w-]+:\s*write\s*$/m);
    assert.match(job, /timeout-minutes:\s*\d+/);
    assert.match(job, /persist-credentials:\s*false/);
  }
  assert.match(getJobBlock(workflow, 'verify'), /npm ci/);
  assert.match(getJobBlock(workflow, 'verify'), /npm run verify/);
  const browser = getJobBlock(workflow, 'browser');
  assert.match(browser, /fromJSON\(needs\.discover\.outputs\.matrix\)/);
  assert.match(browser, /fail-fast:\s*false/);
  assert.match(browser, /max-parallel:\s*[1-4](?:\s|$)/);
  assert.match(browser, /playwright install --with-deps chromium/);
  assert.match(browser, /node scripts\/release-ci\.mjs browser/);
  const required = getJobBlock(workflow, 'required');
  assert.match(required, /name:\s*PR required checks/);
  assert.match(required, /if:\s*\$\{\{\s*always\(\)\s*\}\}/);
  assert.match(required, /needs:\s*\[discover, verify, browser\]/);
  assert.match(required, /node scripts\/release-ci\.mjs gate/);
  assert.match(required, /EPET_CI_NEEDS:\s*\$\{\{\s*toJSON\(needs\)\s*\}\}/);
});

test('the proposed main ruleset requires review and GitHub-originated checks without a bypass', async () => {
  const ruleset = JSON.parse(await readSource('.github/rulesets/main-protection.json'));
  assert.equal(ruleset.target, 'branch');
  assert.equal(ruleset.enforcement, 'active');
  assert.deepEqual(ruleset.conditions.ref_name, { include: ['refs/heads/main'], exclude: [] });
  assert.deepEqual(ruleset.bypass_actors, []);
  const byType = new Map(ruleset.rules.map((rule: { type: string; parameters?: unknown }) => [rule.type, rule]));
  assert.ok(byType.has('deletion'));
  assert.ok(byType.has('non_fast_forward'));
  const review = (byType.get('pull_request') as { parameters: Record<string, unknown> }).parameters;
  assert.ok(Number.isInteger(review.required_approving_review_count) && Number(review.required_approving_review_count) >= 1);
  for (const name of ['dismiss_stale_reviews_on_push', 'require_last_push_approval', 'required_review_thread_resolution']) {
    assert.equal(review[name], true, name);
  }
  const checks = (byType.get('required_status_checks') as {
    parameters: { strict_required_status_checks_policy: boolean; do_not_enforce_on_create: boolean;
      required_status_checks: Array<{ context: string; integration_id: number }> };
  }).parameters;
  assert.equal(checks.strict_required_status_checks_policy, true);
  assert.equal(checks.do_not_enforce_on_create, false);
  assert.deepEqual(checks.required_status_checks.map(({ context }) => context).sort(),
    ['PR required checks', 'CodeQL', 'Dependency review', 'npm audit'].sort());
  assert.ok(checks.required_status_checks.every(({ integration_id }) => integration_id === 15368));
});

test('production workflows use immutable actions and discard checkout credentials', async () => {
  for (const path of ['.github/workflows/deploy.yml', '.github/workflows/database-expand.yml']) {
    const source = await readSource(path);
    const references = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)];
    assert.ok(references.length >= 2, path);
    for (const [, reference] of references) {
      assert.match(reference, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, path);
    }
    assert.match(source, /persist-credentials:\s*false/);
    assert.match(source, /timeout-minutes:\s*\d+/);
  }
});
