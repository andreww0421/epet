import { createHash } from 'node:crypto';

const migrationName = /^\d{4}_[a-z0-9_]+\.sql$/;
const identifier = '(?:[A-Z_][A-Z0-9_]*|"(?:[^"\\n]|"")+"|`[^`\\n]+`|\\[[^\\]\\n]+\\])';
const literal = "(?:'(?:[^']|'')*'|-?\\s*\\d+(?:\\s*\\.\\s*\\d+)?|NULL|TRUE|FALSE)";

export const migrationDigest = (sql) => createHash('sha256')
  .update(sql.replace(/\r\n?/g, '\n'))
  .digest('hex');

// Keep literals intact: words such as DROP in comments or default values are
// not SQL operations. Unsupported syntax fails closed rather than being skipped.
const sqlStatements = (sql) => {
  const token = /\s+|--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_]*|\d+|[(),.;+*/<>=!:%-]/gy;
  const statements = [];
  let current = [];
  let offset = 0;
  while (offset < sql.length) {
    token.lastIndex = offset;
    const match = token.exec(sql);
    if (!match) throw new Error('Unsupported SQL syntax in expansion migration');
    const value = match[0];
    offset = token.lastIndex;
    if (/^\s|^--|^\/\*/.test(value)) continue;
    if (value === ';') {
      if (current.length) statements.push(current.join(' '));
      current = [];
    } else {
      current.push(/^[A-Za-z_]/.test(value) ? value.toUpperCase() : value);
    }
  }
  if (current.length) throw new Error('Expansion SQL must terminate every statement with a semicolon');
  if (!statements.length) throw new Error('Expansion migration must contain SQL');
  return statements;
};

export const assertExpansionSql = (sql) => {
  const table = new RegExp(`^CREATE TABLE IF NOT EXISTS ${identifier} \\( .+ \\)$`);
  const index = new RegExp(`^CREATE INDEX IF NOT EXISTS ${identifier} ON ${identifier} \\( ${identifier}(?: (?:ASC|DESC))?(?: , ${identifier}(?: (?:ASC|DESC))?)* \\)$`);
  const column = new RegExp(`^ALTER TABLE ${identifier} ADD COLUMN ${identifier} (?:TEXT|INTEGER|REAL|BLOB|NUMERIC)(?: DEFAULT ${literal}| NOT NULL DEFAULT ${literal})?$`);
  for (const statement of sqlStatements(sql)) {
    if (!table.test(statement) && !index.test(statement) && !column.test(statement)) {
      throw new Error('Expansion permits only CREATE TABLE IF NOT EXISTS, non-unique CREATE INDEX IF NOT EXISTS, or a compatible ADD COLUMN; move data changes and contract operations to a separate reviewed operation');
    }
    if (/ NOT NULL DEFAULT NULL$/.test(statement)) {
      throw new Error('A new NOT NULL column requires a non-null compatible literal default');
    }
  }
};

export const validateMigrationCatalog = ({ policy, files }) => {
  if (policy?.version !== 1 || !policy.historical || !policy.expansions ||
      typeof policy.historical !== 'object' || typeof policy.expansions !== 'object' ||
      Array.isArray(policy.historical) || Array.isArray(policy.expansions)) {
    throw new Error('Invalid migrations/policy.json');
  }
  const historical = Object.keys(policy.historical);
  const expansions = Object.keys(policy.expansions);
  const names = [...historical, ...expansions].sort();
  const numbers = new Set();
  const historicalEnd = Math.max(0, ...historical.map((name) => Number(name.slice(0, 4))));
  for (const name of files.keys()) {
    if (!names.includes(name)) throw new Error(`Unclassified migration: ${name}`);
  }
  for (const name of names) {
    if (!migrationName.test(name) || numbers.has(name.slice(0, 4))) {
      throw new Error(`Invalid or duplicate migration number: ${name}`);
    }
    numbers.add(name.slice(0, 4));
    if (!files.has(name)) throw new Error(`Missing immutable migration: ${name}`);
  }
  return names.map((name) => {
    const sql = files.get(name);
    const isHistorical = Object.hasOwn(policy.historical, name);
    const metadata = policy.expansions[name];
    const expected = isHistorical ? policy.historical[name] : metadata?.sha256;
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) ||
        migrationDigest(sql) !== expected) {
      throw new Error(`Migration checksum mismatch: ${name}; never edit applied migration history`);
    }
    if (!isHistorical) {
      if (Number(name.slice(0, 4)) <= historicalEnd ||
          typeof metadata.compatibility !== 'string' || !metadata.compatibility.trim() ||
          typeof metadata.verification !== 'string' || !metadata.verification.trim()) {
        throw new Error(`Expansion requires a later number, old-Worker read/write compatibility evidence, and a verification plan: ${name}`);
      }
      assertExpansionSql(sql);
    }
    return { name, phase: isHistorical ? 'historical' : 'expand', sql };
  });
};

export const parseMigrationLedger = (stdout) => {
  let output;
  try {
    output = JSON.parse(stdout);
  } catch {
    throw new Error('D1 migration ledger did not return valid JSON; no migration will be applied');
  }
  if (!Array.isArray(output) || output.length !== 1 ||
      output[0]?.success !== true || !Array.isArray(output[0].results) ||
      output[0].results.some((row) => typeof row?.name !== 'string' || !migrationName.test(row.name))) {
    throw new Error('D1 migration ledger response is incomplete or unsuccessful; no migration will be applied');
  }
  return output[0].results.map((row) => row.name);
};

export const planMigrations = (catalog, appliedNames) => {
  const applied = new Set(appliedNames);
  if (applied.size !== appliedNames.length) throw new Error('Duplicate migration ledger entries');
  for (const name of applied) {
    if (!catalog.some((entry) => entry.name === name)) {
      throw new Error(`Database contains an unknown migration: ${name}; inspect schema compatibility before deploying this checkout`);
    }
  }
  let pendingSeen = false;
  for (const entry of catalog) {
    if (!applied.has(entry.name)) pendingSeen = true;
    else if (pendingSeen) throw new Error('Migration ledger has a gap; reconcile it explicitly before deployment');
  }
  return catalog.filter((entry) => !applied.has(entry.name));
};

// The injected executor lets regression tests prove that rejected plans never
// reach a remote write. The normal deploy uses check mode, which is read-only.
export const runMigrationOperation = async ({ mode, catalog, execute, log = console.log }) => {
  if (!['check', 'apply-expand'].includes(mode)) throw new Error('Expected check or apply-expand mode');
  const readLedger = async () => parseMigrationLedger(await execute([
    'd1', 'execute', 'epet-production', '--remote', '--command',
    'SELECT name FROM d1_migrations ORDER BY id', '--json',
  ]));
  const pending = planMigrations(catalog, await readLedger());
  if (pending.length === 0) {
    log('D1 migration ledger is current; no database changes required.');
    return { pending: [], applied: [] };
  }
  log(`Pending migration names: ${pending.map((entry) => entry.name).join(', ')}`);
  if (mode === 'check') {
    throw new Error('Required migrations are pending. Run the separate database-expand workflow for expansions; historical migrations require an operator-reviewed bootstrap. The serving Worker is unchanged.');
  }
  if (pending.some((entry) => entry.phase !== 'expand')) {
    throw new Error('Pending historical migrations require an operator-reviewed bootstrap; this workflow cannot apply them');
  }
  for (const entry of pending) assertExpansionSql(entry.sql);
  await execute(['d1', 'migrations', 'apply', 'epet-production', '--remote']);
  if (planMigrations(catalog, await readLedger()).length !== 0) {
    throw new Error('Expansion apply did not complete the expected ledger; inspect D1 before retrying');
  }
  log('Expansion migrations recorded successfully. Verify the serving Worker before starting application deployment.');
  return { pending: [], applied: pending.map((entry) => entry.name) };
};
