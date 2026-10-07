import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateMigrationCatalog } from './migration-policy.mjs';
import {
  assertStagingBranch, createStagingConfig, runStagingOperation,
  stagingCredentials, stagingWorkerSecrets,
} from './staging-policy.mjs';

const root = process.cwd();
const mode = process.argv[2];
let secretsDirectory;

try {
  if (process.argv.length !== 3 || !['validate', 'preflight', 'dry-run', 'migrate', 'check', 'deploy'].includes(mode)) {
    throw new Error('Usage: node scripts/staging.mjs validate|preflight|dry-run|migrate|check|deploy (no additional overrides)');
  }
  const production = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
  const template = JSON.parse(await readFile(join(root, 'wrangler.staging.jsonc'), 'utf8'));
  const offline = mode === 'validate' || mode === 'dry-run';
  const config = createStagingConfig({ production, template, settings: process.env, dryRun: offline });
  const directory = join(root, 'migrations');
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql'));
  const files = new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name), 'utf8')])));
  const catalog = validateMigrationCatalog({
    policy: JSON.parse(await readFile(join(directory, 'policy.json'), 'utf8')), files,
  });
  if (mode === 'validate') {
    console.log('Staging template is isolated; production configuration is unchanged. Remote commands require explicit staging settings.');
  } else {
    if (!offline && process.env.GITHUB_ACTIONS === 'true') {
      assertStagingBranch({ ref: process.env.GITHUB_REF, refType: process.env.GITHUB_REF_TYPE });
    }
    const credentials = offline ? {} : stagingCredentials(process.env);
    const secrets = ['preflight', 'deploy'].includes(mode) ? stagingWorkerSecrets(process.env) : undefined;
    if (mode === 'preflight') {
      console.log('Staging resource, origin, credentials, and required Worker secrets passed preflight (values omitted).');
    } else {
      // Keep config at repository root: Wrangler resolves main/assets/migrations
      // relative to its config file. This file contains no credentials/secrets.
      const configPath = resolve(root, 'wrangler.staging.generated.jsonc');
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
      // Wrangler otherwise loads generic .env files even for remote commands.
      // Pin an empty env file so only explicit staging credentials are used.
      await mkdir(join(root, '.wrangler'), { recursive: true });
      const emptyEnvPath = join(root, '.wrangler', 'staging-empty.env');
      await writeFile(emptyEnvPath, '');
      let secretsPath;
      if (secrets) {
        secretsDirectory = await mkdtemp(join(tmpdir(), 'epet-staging-secrets-'));
        secretsPath = join(secretsDirectory, 'secrets.json');
        await writeFile(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
      }
      const execute = (args) => new Promise((resolveCommand, reject) => {
        // Do not inherit generic production Cloudflare credentials into offline
        // checks. Real commands explicitly replace them with staging credentials.
        const childEnv = { ...process.env, CI: 'true' };
        delete childEnv.CLOUDFLARE_API_TOKEN;
        delete childEnv.CLOUDFLARE_ACCOUNT_ID;
        delete childEnv.CLOUDFLARE_API_KEY;
        delete childEnv.CLOUDFLARE_EMAIL;
        delete childEnv.CF_API_TOKEN;
        delete childEnv.CF_ACCOUNT_ID;
        delete childEnv.CF_API_KEY;
        delete childEnv.CF_EMAIL;
        delete childEnv.TURNSTILE_SITE_KEY;
        delete childEnv.TURNSTILE_SECRET_KEY;
        delete childEnv.RESEND_API_KEY;
        delete childEnv.SENTRY_DSN;
        delete childEnv.SENTRY_FRONTEND_DSN;
        delete childEnv.SENTRY_RELEASE;
        delete childEnv.MONITORING_ENVIRONMENT;
        Object.assign(childEnv, credentials);
        const capture = args.includes('--json');
        const child = spawn(process.execPath, [
          resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...args, '--env-file', emptyEnvPath,
        ], {
          cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        child.stdout.on('data', (chunk) => { if (capture) stdout += chunk; else process.stdout.write(chunk); });
        child.stderr.on('data', (chunk) => process.stderr.write(chunk));
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolveCommand(stdout)
          : reject(new Error(`Staging Wrangler operation failed (exit ${code}); inspect the staging ledger/deployment before retrying`)));
      });
      await runStagingOperation({ mode, config, production, catalog, configPath, secretsPath, execute });
    }
  }
} catch (error) {
  console.error(`Staging guard: ${error instanceof Error ? error.message : 'operation failed'}`);
  process.exitCode = 1;
} finally {
  // Exact directory was created by mkdtemp in this process, never a caller path.
  if (secretsDirectory) await rm(secretsDirectory, { recursive: true, force: true });
}
