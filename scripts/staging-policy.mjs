import { parseMigrationLedger, planMigrations } from './migration-policy.mjs';
import { validateStagingUrl } from './staging-target.mjs';

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const dryRunId = '11111111-1111-4111-8111-111111111111';
const allowedKeys = new Set([
  '$schema', 'name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls',
  'assets', 'placement', 'observability', 'triggers', 'vars', 'secrets', 'd1_databases',
]);
const requiredSecrets = ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY'];

const requireValue = (settings, name) => {
  const value = settings[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing staging setting: ${name}`);
  return value.trim();
};

export const assertStagingBranch = ({ ref, refType }) => {
  if (refType !== 'branch' || typeof ref !== 'string' ||
      !ref.startsWith('refs/heads/') || ref === 'refs/heads/main') {
    throw new Error('Staging deployment requires a non-main branch; tags and production releases are not staging targets');
  }
};

export const assertStagingConfig = ({ production, config }) => {
  const databases = config.d1_databases;
  const database = databases?.[0];
  if (Object.keys(config).some((key) => !allowedKeys.has(key)) ||
      config.name !== 'epet-staging' || config.name === production.name ||
      config.workers_dev !== true || config.preview_urls !== false ||
      !Array.isArray(databases) || databases.length !== 1 ||
      database.binding !== 'DB' || database.database_name !== 'epet-staging' ||
      !uuid.test(database.database_id) || database.migrations_dir !== 'migrations' ||
      Object.keys(database).some((key) => !['binding', 'database_name', 'database_id', 'migrations_dir'].includes(key)) ||
      production.d1_databases.some((binding) =>
        binding.database_id.toLowerCase() === database.database_id.toLowerCase() ||
        binding.database_name === database.database_name)) {
    throw new Error('Staging must use only the epet-staging Worker and a distinct epet-staging D1 binding; production IDs, routes, environments, and extra bindings are forbidden');
  }
  if (config.main !== production.main || config.compatibility_date !== production.compatibility_date ||
      JSON.stringify(config.assets) !== JSON.stringify(production.assets)) {
    throw new Error('Staging must build the same Worker entry point, compatibility date, and static asset configuration as production');
  }
  if (config.vars?.BOT_PROTECTION_REQUIRED !== 'true' ||
      config.vars.EMAIL_VERIFICATION_REQUIRED !== 'true' ||
      config.vars.MONITORING_ENVIRONMENT !== 'staging' ||
      production.vars?.MONITORING_ENVIRONMENT !== 'production' ||
      config.vars.REGISTRATION_ENABLED !== 'false' ||
      Object.keys(config.vars).some((name) => ![
        'BOT_PROTECTION_REQUIRED', 'EMAIL_VERIFICATION_REQUIRED', 'PUBLIC_APP_URL',
        'REGISTRATION_ENABLED', 'PASSWORD_RESET_FROM', 'MONITORING_ENVIRONMENT',
      ].includes(name)) ||
      JSON.stringify(config.secrets) !== JSON.stringify({ required: requiredSecrets })) {
    throw new Error('Staging authentication protections and staging-only required secrets must remain enabled');
  }
  validateStagingUrl(config.vars.PUBLIC_APP_URL);
};

// The checked-in template cannot accidentally deploy with a real resource ID.
// Resolve only staging settings, never production defaults or generic CF secrets.
export const createStagingConfig = ({ production, template, settings = {}, dryRun = false }) => {
  if (template.d1_databases?.[0]?.database_id !== 'REPLACE_WITH_STAGING_D1_DATABASE_ID' ||
      template.vars?.PUBLIC_APP_URL !== 'STAGING_BASE_URL') {
    throw new Error('Keep staging resource settings out of the template; configure STAGING_D1_DATABASE_ID and STAGING_BASE_URL explicitly');
  }
  const config = structuredClone(template);
  config.d1_databases[0].database_id = dryRun
    ? dryRunId : requireValue(settings, 'STAGING_D1_DATABASE_ID');
  config.vars.PUBLIC_APP_URL = dryRun ? 'https://epet-staging.offline-check.workers.dev'
    : validateStagingUrl(requireValue(settings, 'STAGING_BASE_URL'));
  if (!dryRun) config.vars.PASSWORD_RESET_FROM = requireValue(settings, 'STAGING_PASSWORD_RESET_FROM');
  assertStagingConfig({ production, config });
  return config;
};

export const stagingCredentials = (settings) => ({
  CLOUDFLARE_ACCOUNT_ID: requireValue(settings, 'STAGING_CLOUDFLARE_ACCOUNT_ID'),
  CLOUDFLARE_API_TOKEN: requireValue(settings, 'STAGING_CLOUDFLARE_API_TOKEN'),
});

export const stagingWorkerSecrets = (settings) => Object.fromEntries(
  requiredSecrets.map((name) => [name, requireValue(settings, `STAGING_${name}`)]),
);

export const runStagingOperation = async ({
  mode, config, production, catalog, configPath, secretsPath, execute, log = console.log,
}) => {
  assertStagingConfig({ production, config });
  if (!['dry-run', 'migrate', 'check', 'deploy'].includes(mode)) throw new Error('Unknown staging operation');
  const pinned = (args) => execute([...args, '--config', configPath]);
  const pendingMigrations = async () => {
    const applied = parseMigrationLedger(await pinned([
      'd1', 'execute', 'epet-staging', '--remote', '--command',
      'SELECT name FROM d1_migrations ORDER BY id', '--json',
    ]));
    return planMigrations(catalog, applied);
  };
  const checkLedger = async () => {
    if ((await pendingMigrations()).length) throw new Error('Staging migrations are pending; migrate the isolated staging database before deployment');
  };
  if (mode === 'dry-run') return pinned(['deploy', '--dry-run']);
  if (mode === 'migrate') {
    // A fresh DB has no ledger. Distinguish that case from a corrupt/unavailable
    // ledger, and reject unknown/gapped history before any migration write.
    let presence;
    try {
      presence = JSON.parse(await pinned([
        'd1', 'execute', 'epet-staging', '--remote', '--command',
        "SELECT COUNT(*) AS ledger_exists FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'", '--json',
      ]));
    } catch {
      throw new Error('Cannot establish staging ledger state; no migrations applied');
    }
    const exists = presence?.[0]?.results?.[0]?.ledger_exists;
    if (!Array.isArray(presence) || presence.length !== 1 || presence[0]?.success !== true ||
        !Array.isArray(presence[0].results) || presence[0].results.length !== 1 ||
        (exists !== 0 && exists !== 1)) {
      throw new Error('Invalid staging ledger state; no migrations applied');
    }
    if (exists === 1 && (await pendingMigrations()).length === 0) {
      log('Staging migration ledger is current; no database changes required.');
      return;
    }
    // Unlike production, a fresh synthetic-only staging DB may bootstrap history.
    // Wrangler's ledger creates itself and skips filenames already applied.
    await pinned(['d1', 'migrations', 'apply', 'epet-staging', '--remote']);
    await checkLedger();
    log('Isolated staging migration ledger is current.');
  } else {
    if (mode === 'deploy') {
      if (!secretsPath) throw new Error('Staging deployment requires a staging-only secrets file');
      await pinned(['whoami']);
    }
    await checkLedger();
    if (mode === 'deploy') await pinned(['deploy', '--secrets-file', secretsPath]);
  }
};
