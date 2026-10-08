import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

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
