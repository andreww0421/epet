import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [production, staging, expansion, manifestSource] = await Promise.all([
  read('.github/workflows/deploy.yml'),
  read('.github/workflows/staging.yml'),
  read('.github/workflows/database-expand.yml'),
  read('package.json'),
]);
const { scripts } = JSON.parse(manifestSource);
const uncommented = (source) => source.split('\n')
  .filter((line) => !line.trimStart().startsWith('#')).join('\n');
const steps = (source) => source.split(/^      - name: /m).slice(1);
const step = (source, name) => {
  const matches = steps(source).filter((block) => block.split(/\r?\n/, 1)[0] === name);
  assert.equal(matches.length, 1, `${name} must identify exactly one step`);
  return matches[0];
};
const ordered = (source, fragments) => {
  let previous = -1;
  for (const fragment of fragments) {
    const position = source.indexOf(fragment);
    assert.ok(position > previous, `${fragment} must follow its prerequisite`);
    previous = position;
  }
};

test('production publishes only after clean install, complete verification and read-only ledger gate', () => {
  ordered(production, [
    'run: npm ci',
    'run: npm run verify',
    'run: npx wrangler whoami',
    'run: npm run db:check:remote',
    'run: npm run deploy:worker',
    'run: npm run smoke:production',
  ]);
  ordered(scripts.verify, [
    'npm run db:validate:migrations', 'npm run lint', 'npm test',
    'npm run build', 'npm run check:worker',
  ]);
  assert.deepEqual(scripts.verify.split(' && '), [
    'npm run db:validate:migrations', 'npm run lint', 'npm test',
    'npm run build', 'npm run check:worker',
  ], 'every verification stage must stop the release on failure');
  assert.equal(scripts.lint, 'tsc --noEmit');
  assert.equal(scripts['check:worker'], 'wrangler deploy --dry-run');
  assert.match(scripts.test, /npm run test:deployment(?:\s|$)/);
  assert.doesNotMatch(uncommented(production),
    /continue-on-error:|\|\|\s*true|db:migrate|d1\s+(?:migrations|time-travel)|run:.*\brollback\b/);
});

test('production retains main-only protected environment and serializes with independent expansion', () => {
  assert.match(production, /^  verify-and-deploy:$/m);
  assert.match(production, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(production, /environment:\s*\n\s+name: production/);
  assert.match(production, /push:\s*\n\s+branches:\s*\n\s+- main/);
  assert.doesNotMatch(uncommented(production), /pull_request(?:_target)?:|workflow_run:|secrets: inherit/);
  for (const workflow of [production, expansion]) {
    assert.match(workflow, /group: cloudflare-production/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /^permissions:\s*\n  contents: read/m);
    assert.doesNotMatch(workflow, /^\s+[\w-]+: write\s*$/m);
  }
});

test('post-deployment production smoke has a bounded timeout and receives no deployment credentials or target overrides', () => {
  const smoke = step(production, 'Verify production deployment with read-only smoke');
  assert.match(smoke, /^        id: smoke$/m);
  assert.match(smoke, /^        run: npm run smoke:production\s*$/m);
  assert.match(smoke, /^        timeout-minutes: [1-2]\s*$/m);
  assert.doesNotMatch(smoke, /\bsecrets\b|env:|--|continue-on-error:|if:/);
  assert.doesNotMatch(production.slice(0, production.indexOf('    steps:')),
    /^\s*env:|\bsecrets\b/m, 'credentials must not be inherited at workflow/job scope');
  assert.equal(scripts['smoke:production'], 'node scripts/production-smoke.mjs');
  for (const action of [...production.matchAll(/^\s*uses:\s*([^\s#]+)/gm)]) {
    assert.match(action[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  }
  assert.match(production, /persist-credentials: false/);
});

test('production failure report distinguishes unattempted, uncertain and post-publish failures without masking failure', () => {
  const report = step(production, 'Report release failure and recovery instructions');
  assert.match(report, /if: \$\{\{ failure\(\) \|\| cancelled\(\) \}\}/);
  assert.match(report, /DEPLOY_OUTCOME: \$\{\{ steps\.deploy\.outcome \}\}/);
  assert.match(report, /SMOKE_OUTCOME: \$\{\{ steps\.smoke\.outcome \}\}/);
  for (const message of [
    'published release may still be serving',
    'actual serving version is unknown',
    'Deployment step did not run',
    'No automatic Worker or D1 rollback was executed',
    'Job summaries alone do not prove delivery',
  ]) assert.ok(report.includes(message), message);
  assert.match(report, /::error title=/);
  assert.match(report, /GITHUB_STEP_SUMMARY/);
  assert.match(report, /actions\/runs\/\$\{\{ github\.run_id \}\}/);
  assert.match(report, /blob\/\$\{\{ github\.sha \}\}\/docs\/production-deployment\.md/);
  assert.doesNotMatch(report, /\bsecrets\b|\b(?:curl|wget|gh|wrangler)\b|continue-on-error:|exit 0/);
});

test('staging cannot deploy before isolated verification and retains synthetic migration ordering', () => {
  const deployment = staging.slice(staging.indexOf('  deploy-and-smoke:'));
  assert.match(deployment, /needs: verify/);
  assert.match(deployment, /environment:\s*\n\s+name: staging/);
  assert.match(deployment, /github\.ref_type == 'branch' && github\.ref != 'refs\/heads\/main'/);
  ordered(deployment, [
    'run: npm ci', 'run: npm run build', 'run: npm run staging:preflight',
    'run: npm run db:migrate:staging', 'run: npm run deploy:staging',
    'run: npm run test:e2e:staging',
  ]);
  assert.match(staging, /run: npm run verify/);
  assert.match(staging, /run: npm run check:worker:staging/);
  assert.doesNotMatch(uncommented(staging),
    /secrets\.CLOUDFLARE_|secrets\.TURNSTILE_|secrets\.RESEND_|db:migrate:remote|deploy:worker|smoke:production/);
});

test('staging verification and release failures both surface a failure summary without remote side effects', () => {
  const verification = step(staging, 'Report staging verification failure');
  const release = step(staging, 'Report staging release failure and recovery instructions');
  for (const report of [verification, release]) {
    assert.match(report, /if: \$\{\{ failure\(\) \|\| cancelled\(\) \}\}/);
    assert.match(report, /::error title=/);
    assert.match(report, /GITHUB_STEP_SUMMARY/);
    assert.match(report, /actions\/runs\/\$\{\{ github\.run_id \}\}/);
    assert.doesNotMatch(report, /\bsecrets\b|\b(?:curl|wget|gh|wrangler)\b|continue-on-error:|exit 0/);
  }
  assert.match(release, /A preceding synthetic staging migration may already have completed/);
  assert.match(release, /Job summaries alone do not prove delivery/i);
  const smoke = step(staging, 'Run read-only staging E2E smoke tests');
  assert.match(smoke, /timeout-minutes: 5/);
  assert.doesNotMatch(smoke, /secrets\.|continue-on-error:|if:/);
});

// Execute the actual summary-only shell blocks with synthetic step outcomes.
// No GitHub/Cloudflare command or release step is executed by this harness.
for (const [source, name, outcomes] of [
  [production, 'Report release failure and recovery instructions', [
    ['success', 'failure', 'published release may still be serving'],
    ['failure', 'skipped', 'actual serving version is unknown'],
    ['cancelled', 'skipped', 'actual serving version is unknown'],
    ['skipped', 'skipped', 'Deployment step did not run'],
  ]],
  [staging, 'Report staging release failure and recovery instructions', [
    ['success', 'failure', 'currently serving staging version'],
    ['failure', 'skipped', 'inspect the actual serving version'],
    ['skipped', 'skipped', 'migration may already have completed'],
  ]],
  [staging, 'Report staging verification failure', [['skipped', 'skipped', 'No staging deployment job can proceed']]],
]) {
  test(`${name} executes safely for synthetic failure/cancellation states`, async () => {
    const block = step(source, name).split('        run: |')[1];
    assert.ok(block, 'failure reporting must be a reviewable literal shell block');
    const shellLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (!line.startsWith('          ')) break; // Next YAML job, not shell.
      shellLines.push(line.slice(10));
    }
    const script = shellLines.join('\n');
    const directory = await mkdtemp(join(tmpdir(), 'epet-ci-summary-'));
    try {
      for (const [deploy, smoke, expected] of outcomes) {
        const summary = join(directory, `${deploy}-${smoke}.md`);
        const result = spawnSync(process.platform === 'win32'
          ? join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : 'bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
          encoding: 'utf8', timeout: 10_000,
          env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
            GITHUB_STEP_SUMMARY: summary, DEPLOY_OUTCOME: deploy, SMOKE_OUTCOME: smoke,
            RUN_URL: 'https://github.com/synthetic/epet/actions/runs/1',
            RUNBOOK_URL: 'https://github.com/synthetic/epet/blob/synthetic/docs/production-deployment.md' },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /::error title=/);
        const body = await readFile(summary, 'utf8');
        assert.ok(body.includes(expected), expected);
        assert.match(body, /Workflow logs/);
        assert.doesNotMatch(body, /token|student|cookie/i);
      }
    } finally {
      // Exact newly-created summary fixture; never a user-supplied path.
      await rm(directory, { recursive: true, force: true });
    }
  });
}
