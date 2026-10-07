import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { runMigrationOperation, validateMigrationCatalog } from './migration-policy.mjs';

const root = process.cwd();
const mode = process.argv[2];

const executeWrangler = (args) => new Promise((resolveCommand, reject) => {
  const child = spawn(process.execPath, [
    resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...args,
    '--config', resolve(root, 'wrangler.jsonc'),
  ], { cwd: root, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  const capture = args.includes('--json');
  child.stdout.on('data', (chunk) => {
    if (capture) stdout += chunk;
    else process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolveCommand(stdout);
    else reject(new Error(`Wrangler ${args.slice(0, 3).join(' ')} failed (exit ${code}); inspect the command log and the migration ledger before retrying`));
  });
});

try {
  if (!['validate', 'check', 'apply-expand'].includes(mode)) {
    throw new Error('Usage: node scripts/d1-migrations.mjs validate|check|apply-expand');
  }
  const directory = join(root, 'migrations');
  const policy = JSON.parse(await readFile(join(directory, 'policy.json'), 'utf8'));
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql'));
  const files = new Map(await Promise.all(names.map(async (name) => [
    name, await readFile(join(directory, name), 'utf8'),
  ])));
  const catalog = validateMigrationCatalog({ policy, files });
  // Bind the guard to the same discovery directory and ledger used by Wrangler.
  // This repo currently uses the strict JSON subset of JSONC; configuration
  // changes must update this guard explicitly, rather than bypass its catalog.
  const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
  const database = config.d1_databases?.find((binding) => binding.database_name === 'epet-production');
  if (database?.migrations_dir !== 'migrations' ||
      (database.migrations_table && database.migrations_table !== 'd1_migrations') ||
      database.migrations_pattern || config.env) {
    throw new Error('Wrangler migration discovery or environment configuration changed; update the migration guard before using production commands');
  }
  if (mode === 'validate') console.log(`Validated ${catalog.length} classified, checksum-locked migrations.`);
  else await runMigrationOperation({ mode, catalog, execute: executeWrangler });
} catch (error) {
  const message = error instanceof Error ? error.message : 'Migration guard failed';
  console.error(`Migration guard: ${message}`);
  process.exitCode = 1;
}
