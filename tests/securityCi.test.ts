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
