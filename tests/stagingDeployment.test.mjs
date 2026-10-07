import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  assertStagingBranch,
  assertStagingConfig,
  createStagingConfig,
  runStagingOperation,
  stagingCredentials,
  stagingWorkerSecrets,
} from '../scripts/staging-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [production, template] = await Promise.all([
  readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../wrangler.staging.jsonc', import.meta.url), 'utf8').then(JSON.parse),
]);
const settings = {
  STAGING_D1_DATABASE_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  STAGING_BASE_URL: 'https://epet-staging.example-account.workers.dev/',
  STAGING_PASSWORD_RESET_FROM: 'Epet Staging <staging@example.test>',
};
const configFixture = () => createStagingConfig({ production, template, settings });
const historicalName = '0001_history.sql';
const expansionName = '0002_add_profile.sql';
const catalog = [
  { name: historicalName, phase: 'historical', sql: 'DROP TABLE old_rate_limit;' },
  { name: expansionName, phase: 'expand', sql: 'ALTER TABLE users ADD COLUMN note TEXT;' },
];
const ledger = (...names) => JSON.stringify([{
  success: true,
  results: names.map((name) => ({ name })),
}]);
const ledgerPresence = (exists) => JSON.stringify([{ success: true, results: [{ ledger_exists: exists }] }]);
const configPath = resolve(root, 'wrangler.staging.generated.jsonc');
const secretsPath = resolve(root, '.synthetic-staging-secrets.json');
const operation = (options) => runStagingOperation({
  production, config: configFixture(), catalog, configPath, log: () => {}, ...options,
});
const isLedgerRead = (args) => args[0] === 'd1' && args[1] === 'execute';
const isPresenceRead = (args) => isLedgerRead(args) && args.some((argument) => argument.includes('sqlite_master'));
const withoutComments = (source) => source.split('\n')
  .filter((line) => !line.trimStart().startsWith('#')).join('\n');

test('actual staging configuration separates Worker, D1, origin, and required secrets without mutating production', () => {
  const before = structuredClone(production);
  const templateBefore = structuredClone(template);
  const config = configFixture();
  assert.equal(config.name, 'epet-staging');
  assert.notEqual(config.name, production.name);
  assert.equal(config.d1_databases.length, 1);
  assert.deepEqual(config.d1_databases[0], {
    binding: 'DB', database_name: 'epet-staging',
    database_id: settings.STAGING_D1_DATABASE_ID, migrations_dir: 'migrations',
  });
  assert.equal(config.vars.PUBLIC_APP_URL, 'https://epet-staging.example-account.workers.dev');
  assert.equal(config.vars.PASSWORD_RESET_FROM, settings.STAGING_PASSWORD_RESET_FROM);
  assert.equal(config.vars.BOT_PROTECTION_REQUIRED, 'true');
  assert.equal(config.vars.EMAIL_VERIFICATION_REQUIRED, 'true');
  assert.equal(config.vars.MONITORING_ENVIRONMENT, 'staging');
  assert.equal(config.vars.REGISTRATION_ENABLED, 'false');
  assert.equal(production.vars.MONITORING_ENVIRONMENT, 'production');
  assert.equal(config.compatibility_flags, undefined);
  assert.equal(production.compatibility_flags, undefined);
  assert.deepEqual(config.secrets.required, ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY']);
  assert.equal(config.main, production.main);
  assert.equal(config.compatibility_date, production.compatibility_date);
  assert.deepEqual(config.assets, production.assets);
  assert.deepEqual(production, before);
  assert.deepEqual(template, templateBefore);
});

test('remote staging settings are mandatory and the production database UUID cannot be reused in any case', () => {
  for (const name of Object.keys(settings)) {
    const incomplete = { ...settings };
    delete incomplete[name];
    assert.throws(() => createStagingConfig({ production, template, settings: incomplete }), undefined, name);
    incomplete[name] = '   ';
    assert.throws(() => createStagingConfig({ production, template, settings: incomplete }), undefined, name);
  }
  for (const databaseId of [
    'not-a-database-id',
    production.d1_databases[0].database_id,
    production.d1_databases[0].database_id.toUpperCase(),
    ` ${production.d1_databases[0].database_id} `,
  ]) {
    assert.throws(() => createStagingConfig({
      production, template, settings: { ...settings, STAGING_D1_DATABASE_ID: databaseId },
    }), undefined, databaseId);
  }
});

test('the checked-in template must retain unmistakable unset staging resource placeholders', () => {
  const changedDatabase = structuredClone(template);
  changedDatabase.d1_databases[0].database_id = settings.STAGING_D1_DATABASE_ID;
  assert.throws(() => createStagingConfig({ production, template: changedDatabase, settings }));
  const changedOrigin = structuredClone(template);
  changedOrigin.vars.PUBLIC_APP_URL = settings.STAGING_BASE_URL;
  assert.throws(() => createStagingConfig({ production, template: changedOrigin, settings }));
});

test('offline validation uses unmistakably synthetic resource settings and still preserves authentication protections', () => {
  const config = createStagingConfig({ production, template, dryRun: true });
  assert.equal(config.vars.PUBLIC_APP_URL, 'https://epet-staging.offline-check.workers.dev');
  assert.notEqual(config.d1_databases[0].database_id, production.d1_databases[0].database_id);
  assert.equal(config.vars.BOT_PROTECTION_REQUIRED, 'true');
  assert.equal(config.vars.EMAIL_VERIFICATION_REQUIRED, 'true');
  assert.equal(config.vars.MONITORING_ENVIRONMENT, 'staging');
  assert.equal(config.vars.REGISTRATION_ENABLED, 'false');
});

test('production routes, preview bindings, environments, and additional resource bindings fail closed', () => {
  const changes = [
    (config) => { config.name = production.name; },
    (config) => { config.workers_dev = false; },
    (config) => { config.preview_urls = true; },
    (config) => { config.routes = ['production.example.test/*']; },
    (config) => { config.route = 'production.example.test/*'; },
    (config) => { config.env = { production: { name: production.name } }; },
    (config) => { config.services = [{ binding: 'PRODUCTION', service: production.name }]; },
    (config) => { config.kv_namespaces = [{ binding: 'DATA', id: 'production-data' }]; },
    (config) => { config.d1_databases.push(structuredClone(production.d1_databases[0])); },
    (config) => { config.d1_databases[0].database_name = 'epet-production'; },
    (config) => { config.d1_databases[0].binding = 'OTHER_DB'; },
    (config) => { config.d1_databases[0].preview_database_id = production.d1_databases[0].database_id; },
    (config) => { config.d1_databases[0].migrations_dir = 'other-migrations'; },
    (config) => { config.d1_databases[0].migrations_table = 'unchecked_ledger'; },
    (config) => { config.d1_databases[0].migrations_pattern = 'migrations/**/*.sql'; },
    (config) => { config.main = 'unreviewed/worker.ts'; },
    (config) => { config.assets.directory = '../production-dist'; },
    (config) => { config.compatibility_flags = []; },
    (config) => { config.compatibility_flags = ['nodejs_als', 'nodejs_compat']; },
  ];
  for (const change of changes) {
    const config = configFixture();
    change(config);
    assert.throws(() => assertStagingConfig({ production, config }));
  }
});

test('staging cannot disable authentication protections or inherit production URLs and secret variables', () => {
  const changes = [
    (config) => { config.vars.BOT_PROTECTION_REQUIRED = 'false'; },
    (config) => { config.vars.EMAIL_VERIFICATION_REQUIRED = 'false'; },
    (config) => { config.vars.MONITORING_ENVIRONMENT = 'production'; },
    (config) => { config.vars.MONITORING_ENVIRONMENT = 'development'; },
    (config) => { delete config.vars.MONITORING_ENVIRONMENT; },
    (config) => { config.vars.REGISTRATION_ENABLED = 'true'; },
    (config) => { config.vars.PUBLIC_APP_URL = production.vars.PUBLIC_APP_URL; },
    (config) => { config.vars.RESEND_API_KEY = 'never-inline-a-secret'; },
    (config) => { config.vars.SENTRY_DSN = 'never-inline-a-dsn'; },
    (config) => { config.secrets.required = ['RESEND_API_KEY']; },
  ];
  for (const change of changes) {
    const config = configFixture();
    change(config);
    assert.throws(() => assertStagingConfig({ production, config }));
  }
});

test('staging only accepts non-main branch refs and rejects production, tags, pull request refs, and ambiguous ref types', () => {
  for (const ref of ['refs/heads/staging', 'refs/heads/feature/synthetic-test']) {
    assert.doesNotThrow(() => assertStagingBranch({ ref, refType: 'branch' }));
  }
  for (const candidate of [
    { ref: 'refs/heads/main', refType: 'branch' },
    { ref: 'refs/tags/staging', refType: 'tag' },
    { ref: 'refs/pull/1/head', refType: 'branch' },
    { ref: 'staging', refType: 'branch' },
    { ref: 'refs/heads/staging', refType: 'tag' },
    { ref: 'refs/heads/staging' },
  ]) {
    assert.throws(() => assertStagingBranch(candidate));
  }
});

test('Cloudflare credentials must use explicit staging names without generic production fallback', () => {
  const generic = { CLOUDFLARE_ACCOUNT_ID: 'production-account', CLOUDFLARE_API_TOKEN: 'production-token' };
  assert.throws(() => stagingCredentials(generic));
  assert.throws(() => stagingCredentials({ ...generic, STAGING_CLOUDFLARE_ACCOUNT_ID: 'staging-account' }));
  assert.throws(() => stagingCredentials({ ...generic, STAGING_CLOUDFLARE_API_TOKEN: 'staging-token' }));
  assert.deepEqual(stagingCredentials({
    ...generic, STAGING_CLOUDFLARE_ACCOUNT_ID: 'staging-account', STAGING_CLOUDFLARE_API_TOKEN: 'staging-token',
  }), { CLOUDFLARE_ACCOUNT_ID: 'staging-account', CLOUDFLARE_API_TOKEN: 'staging-token' });
});

test('Worker secrets use staging-prefixed inputs and never copy production credentials or inline config', () => {
  const generic = { TURNSTILE_SITE_KEY: 'production-site', TURNSTILE_SECRET_KEY: 'production-turnstile', RESEND_API_KEY: 'production-email' };
  assert.throws(() => stagingWorkerSecrets(generic));
  const workerSettings = {
    ...generic, STAGING_TURNSTILE_SITE_KEY: 'staging-site', STAGING_TURNSTILE_SECRET_KEY: 'staging-turnstile', STAGING_RESEND_API_KEY: 'staging-email',
  };
  assert.deepEqual(stagingWorkerSecrets(workerSettings), {
    TURNSTILE_SITE_KEY: 'staging-site', TURNSTILE_SECRET_KEY: 'staging-turnstile', RESEND_API_KEY: 'staging-email',
  });
  for (const name of ['STAGING_TURNSTILE_SITE_KEY', 'STAGING_TURNSTILE_SECRET_KEY', 'STAGING_RESEND_API_KEY']) {
    assert.throws(() => stagingWorkerSecrets({ ...workerSettings, [name]: '' }));
  }
  assert.doesNotMatch(JSON.stringify(configFixture()), /production-token|staging-turnstile|staging-email/);
});

test('all staging operations are configuration-pinned and never target the production database', async () => {
  for (const mode of ['dry-run', 'check', 'deploy', 'migrate']) {
    const calls = [];
    await operation({
      mode, secretsPath,
      execute: async (args) => {
        calls.push(args);
        if (isPresenceRead(args)) return ledgerPresence(0);
        return isLedgerRead(args) ? ledger(historicalName, expansionName) : 'Success';
      },
    });
    assert.ok(calls.length > 0, mode);
    for (const args of calls) {
      assert.deepEqual(args.slice(-2), ['--config', configPath]);
      assert.equal(args.filter((argument) => argument === '--config').length, 1);
      assert.ok(!args.includes('--env'));
      assert.ok(!args.includes('--name'));
      assert.ok(!args.includes('epet-production'));
      if (args[0] === 'd1') assert.equal(args[2] === 'apply' ? args[3] : args[2], 'epet-staging');
    }
    if (mode === 'dry-run') assert.deepEqual(calls[0], ['deploy', '--dry-run', '--config', configPath]);
    if (mode === 'check') assert.ok(calls.every(isLedgerRead));
    if (mode === 'deploy') {
      assert.deepEqual(calls[0], ['whoami', '--config', configPath]);
      assert.ok(isLedgerRead(calls[1]));
      assert.deepEqual(calls.at(-1), ['deploy', '--secrets-file', secretsPath, '--config', configPath]);
      assert.ok(calls.every((args) => !args.includes('apply')));
    }
    if (mode === 'migrate') assert.ok(calls.every((args) => args[0] !== 'deploy'));
  }
});

test('deploy blocks unknown, duplicated, gapped, pending, malformed, and unavailable migration ledgers before publication', async () => {
  for (const result of [
    ledger(), ledger(historicalName), ledger('0099_unknown.sql'),
    ledger(historicalName, historicalName), ledger(expansionName),
    'invalid JSON', '[{"success":false,"results":[]}]', new Error('D1 unavailable'),
  ]) {
    const calls = [];
    await assert.rejects(operation({
      mode: 'deploy', secretsPath,
      execute: async (args) => {
        calls.push(args);
        if (!isLedgerRead(args)) return 'Authenticated';
        if (result instanceof Error) throw result;
        return result;
      },
    }));
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], 'whoami');
    assert.ok(isLedgerRead(calls[1]));
    assert.ok(calls.every((args) => !args.includes('apply') && args[0] !== 'deploy'));
  }
});

test('staging migrate can bootstrap frozen history independently but verifies its ledger and never publishes an application', async () => {
  const calls = [];
  await operation({
    mode: 'migrate',
    execute: async (args) => {
      calls.push(args);
      if (isPresenceRead(args)) return ledgerPresence(0);
      return isLedgerRead(args) ? ledger(historicalName, expansionName) : 'Applied';
    },
  });
  assert.ok(calls.some((args) => args[0] === 'd1' && args[1] === 'migrations' && args[2] === 'apply'));
  assert.ok(isLedgerRead(calls.at(-1)));
  assert.ok(calls.every((args) => !args.includes('epet-production') && args[0] !== 'deploy'));

  await assert.rejects(operation({
    mode: 'migrate', execute: async (args) => isPresenceRead(args) ? ledgerPresence(0)
      : isLedgerRead(args) ? ledger(historicalName) : 'Success',
  }));
});

test('staging migration rejects invalid ledger presence, unavailable D1, and unknown or gapped existing history before writes', async () => {
  for (const result of [
    'not JSON', '{}', '[]', ledgerPresence('0'), ledgerPresence(-1), ledgerPresence(2),
    '[{"success":false,"results":[{"ledger_exists":0}]}]',
    '[{"success":true,"results":[]}]',
    '[{"success":true,"results":[{"ledger_exists":0},{"ledger_exists":1}]}]',
    new Error('D1 unavailable'),
  ]) {
    const calls = [];
    await assert.rejects(operation({
      mode: 'migrate', execute: async (args) => {
        calls.push(args);
        if (result instanceof Error) throw result;
        return result;
      },
    }));
    assert.equal(calls.length, 1);
    assert.ok(isPresenceRead(calls[0]));
  }
  for (const applied of [ledger('0099_unknown.sql'), ledger(expansionName), ledger(historicalName, historicalName)]) {
    const calls = [];
    await assert.rejects(operation({
      mode: 'migrate', execute: async (args) => {
        calls.push(args);
        return isPresenceRead(args) ? ledgerPresence(1) : applied;
      },
    }));
    assert.equal(calls.length, 2);
    assert.ok(calls.every(isLedgerRead));
  }
});

test('existing staging history is checked before apply and a successful retry never replays frozen migrations', async () => {
  const calls = [];
  let ledgerReads = 0;
  await operation({
    mode: 'migrate', execute: async (args) => {
      calls.push(args);
      if (isPresenceRead(args)) return ledgerPresence(1);
      if (isLedgerRead(args)) return ++ledgerReads === 1 ? ledger(historicalName) : ledger(historicalName, expansionName);
      return 'Applied';
    },
  });
  assert.equal(calls.length, 4);
  assert.ok(isPresenceRead(calls[0]));
  assert.ok(isLedgerRead(calls[1]));
  assert.deepEqual(calls[2].slice(0, 5), ['d1', 'migrations', 'apply', 'epet-staging', '--remote']);
  assert.ok(isLedgerRead(calls[3]));
  const retryCalls = [];
  await operation({
    mode: 'migrate', execute: async (args) => {
      retryCalls.push(args);
      return isPresenceRead(args) ? ledgerPresence(1) : ledger(historicalName, expansionName);
    },
  });
  assert.equal(retryCalls.length, 2);
  assert.ok(retryCalls.every(isLedgerRead));
});

test('invalid config, unknown mode, absent deployment secrets, and failed authentication invoke no destructive operation', async () => {
  const invalid = configFixture();
  invalid.d1_databases[0].database_id = production.d1_databases[0].database_id;
  for (const options of [
    { mode: 'deploy', secretsPath, config: invalid },
    { mode: 'unsafe-reset', secretsPath },
    { mode: 'deploy' },
  ]) {
    const calls = [];
    await assert.rejects(operation({ ...options, execute: async (args) => { calls.push(args); return 'Success'; } }));
    assert.deepEqual(calls, []);
  }
  const calls = [];
  await assert.rejects(operation({
    mode: 'deploy', secretsPath, execute: async (args) => { calls.push(args); throw new Error('Authentication failed'); },
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'whoami');
});

test('the staging CLI refuses arbitrary Worker, environment, config, and command overrides before any remote operation', () => {
  for (const argumentsAfterMode of [
    ['--name', production.name], ['--config', 'wrangler.jsonc'], ['--env', 'production'], ['--command', 'DROP TABLE students;'],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/staging.mjs', 'deploy', ...argumentsAfterMode], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_API_TOKEN: 'production-token-never-print' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no additional overrides/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /production-token-never-print|DROP TABLE students/);
  }
});

test('CLI preflight refuses generic credentials and main refs without issuing a Wrangler command or printing values', () => {
  const cleanEnvironment = { ...process.env, ...settings, CLOUDFLARE_API_TOKEN: 'production-token-never-print', CLOUDFLARE_ACCOUNT_ID: 'production-account' };
  delete cleanEnvironment.STAGING_CLOUDFLARE_ACCOUNT_ID;
  delete cleanEnvironment.STAGING_CLOUDFLARE_API_TOKEN;
  // This regression suite also runs in production's main-branch verify job;
  // only the explicit branch fixture below should inherit GitHub semantics.
  delete cleanEnvironment.GITHUB_ACTIONS;
  delete cleanEnvironment.GITHUB_REF;
  delete cleanEnvironment.GITHUB_REF_TYPE;
  const missing = spawnSync(process.execPath, ['scripts/staging.mjs', 'preflight'], {
    cwd: root, encoding: 'utf8', env: cleanEnvironment,
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing staging setting: STAGING_CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(`${missing.stdout}${missing.stderr}`, /production-token-never-print|production-account/);
  const main = spawnSync(process.execPath, ['scripts/staging.mjs', 'preflight'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnvironment, GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_REF_TYPE: 'branch' },
  });
  assert.equal(main.status, 1);
  assert.match(main.stderr, /non-main branch/);
});

test('CLI isolates process credentials, keeps generated config root-relative, and safely disposes temporary secrets', async () => {
  const source = await readFile(new URL('../scripts/staging.mjs', import.meta.url), 'utf8');
  assert.match(source, /resolve\(root, 'wrangler\.staging\.generated\.jsonc'\)/);
  for (const name of [
    'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL',
    'CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_API_KEY', 'CF_EMAIL',
    'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY',
    'SENTRY_DSN', 'SENTRY_FRONTEND_DSN', 'SENTRY_RELEASE', 'MONITORING_ENVIRONMENT',
  ]) {
    assert.ok(source.includes(`delete childEnv.${name}`), name);
  }
  assert.match(source, /Object\.assign\(childEnv, credentials\)/);
  assert.match(source, /'--env-file', emptyEnvPath/);
  assert.match(source, /await writeFile\(emptyEnvPath, ''\)/);
  assert.match(source, /finally\s*\{/);
  assert.match(source, /if \(secretsDirectory\) await rm\(secretsDirectory/);
  assert.doesNotMatch(source, /(?:console\.(?:log|error)|process\.stdout\.write)\(\s*(?:secrets\b|credentials\b|JSON\.stringify\((?:secrets|credentials)\b)/);
  assert.equal(resolve(root, template.main), resolve(root, production.main));
  assert.equal(resolve(root, template.assets.directory), resolve(root, production.assets.directory));
  assert.equal(resolve(root, template.d1_databases[0].migrations_dir), resolve(root, 'migrations'));
});

test('GitHub staging and production deployment boundaries remain independent and secret-scoped', async () => {
  const [productionWorkflow, stageWorkflow, ignore] = await Promise.all([
    readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/staging.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
  ]);
  const prod = withoutComments(productionWorkflow);
  assert.match(prod, /branches:\s*\n\s*- main/);
  assert.match(prod, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(prod, /name:\s*production/);
  assert.match(prod, /group:\s*cloudflare-production/);
  assert.match(prod, /npm run db:check:remote/);
  assert.match(prod, /npm run deploy:worker/);
  assert.match(prod, /VITE_MONITORING_ENABLED:\s*\$\{\{ vars\.EPET_MONITORING_ENABLED \}\}/);
  assert.match(prod, /VITE_MONITORING_ENVIRONMENT:\s*production/);
  assert.match(prod, /VITE_MONITORING_RELEASE:\s*\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(prod, /VITE_SENTRY|SENTRY_FRONTEND_DSN|SENTRY_DSN/);
  assert.doesNotMatch(prod, /STAGING_|staging:|db:migrate:remote/);
  for (const raw of [stageWorkflow]) {
    const stage = withoutComments(raw);
    assert.match(stage, /permissions:\s*\n\s*contents:\s*read/);
    assert.match(stage, /name:\s*staging/);
    assert.match(stage, /group:\s*cloudflare-staging/);
    assert.match(stage, /cancel-in-progress:\s*false/);
    assert.match(stage, /github\.ref\s*!=\s*'refs\/heads\/main'/);
    assert.match(stage, /github\.ref_type\s*==\s*'branch'/);
    assert.doesNotMatch(stage, /secrets\.CLOUDFLARE_|secrets\.TURNSTILE_|secrets\.RESEND_|db:migrate:remote|deploy:worker(?:\s|$)/);
    assert.match(stage, /secrets\.STAGING_CLOUDFLARE_API_TOKEN/);
  }
  const deploy = withoutComments(stageWorkflow);
  assert.match(deploy, /branches:\s*\n\s*- staging/);
  assert.match(deploy, /npm run deploy:staging/);
  assert.match(deploy, /npm run test:e2e:staging/);
  assert.match(deploy, /VITE_MONITORING_ENABLED:\s*\$\{\{ vars\.EPET_MONITORING_ENABLED \}\}/);
  assert.match(deploy, /VITE_MONITORING_ENVIRONMENT:\s*staging/);
  assert.match(deploy, /VITE_MONITORING_RELEASE:\s*\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(deploy, /VITE_SENTRY|SENTRY_FRONTEND_DSN|SENTRY_DSN/);
  assert.match(deploy, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(deploy, /^\s+(?:pull_request|pull_request_target|schedule|workflow_run):/m);
  assert.match(deploy, /npm run db:migrate:staging/);
  assert.ok(deploy.indexOf('npm run staging:preflight') < deploy.indexOf('npm run db:migrate:staging'));
  assert.ok(deploy.indexOf('npm run db:migrate:staging') < deploy.indexOf('npm run deploy:staging'));
  assert.ok(deploy.indexOf('npm run deploy:staging') < deploy.indexOf('npm run test:e2e:staging'));
  assert.match(ignore, /^wrangler\.staging\.generated\.jsonc$/m);
  assert.match(ignore, /^\.dev\.vars\*$/m);
});
