import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import {
  assertExpansionSql,
  migrationDigest,
  parseMigrationLedger,
  planMigrations,
  runMigrationOperation,
  validateMigrationCatalog,
} from '../scripts/migration-policy.mjs';

const historicalName = '0001_historical.sql';
const expansionName = '0002_expand_profile.sql';
const historicalSql = 'DROP TABLE obsolete_rate_limits;\n';
const expansionSql = 'ALTER TABLE users ADD COLUMN display_name TEXT;\n';
const ledger = (...names) => JSON.stringify([{ success: true, results: names.map((name) => ({ name })) }]);
const fixture = () => {
  const files = new Map([[historicalName, historicalSql], [expansionName, expansionSql]]);
  const policy = {
    version: 1,
    historical: { [historicalName]: migrationDigest(historicalSql) },
    expansions: {
      [expansionName]: {
        sha256: migrationDigest(expansionSql),
        compatibility: 'Old releases ignore the nullable column and continue writing existing columns.',
        verification: 'Exercise old release reads and writes on the expanded staging schema.',
      },
    },
  };
  return { policy, files };
};
const catalogFixture = () => validateMigrationCatalog(fixture());
const isLedgerRead = (args) => args.includes('execute') && args.includes('--remote')
  && args.includes('--json') && /\bSELECT\b/i.test(args.join(' '));
const isMigrationApply = (args) => args.includes('migrations') && args.includes('apply')
  && args.includes('--remote');

test('the actual repository migration inventory satisfies its classification and frozen checksums', async () => {
  const directory = new URL('../migrations/', import.meta.url);
  const policy = JSON.parse(await readFile(new URL('policy.json', directory), 'utf8'));
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql'));
  const files = new Map(await Promise.all(names.map(async (name) => [
    name, await readFile(new URL(name, directory), 'utf8'),
  ])));
  const catalog = validateMigrationCatalog({ policy, files });
  assert.ok(catalog.length > 0);
  assert.deepEqual(catalog.map(({ name }) => name), names.sort());
});

test('history remains immutable while Windows checkout line endings preserve its digest', () => {
  const { policy, files } = fixture();
  files.set(historicalName, historicalSql.replaceAll('\n', '\r\n'));
  const catalog = validateMigrationCatalog({ policy, files });
  assert.deepEqual(catalog.map(({ name, phase }) => ({ name, phase })), [
    { name: historicalName, phase: 'historical' },
    { name: expansionName, phase: 'expand' },
  ]);
  assert.equal(migrationDigest('SELECT 1;\n'), migrationDigest('SELECT 1;\r\n'));

  files.set(historicalName, 'DROP TABLE users;\n');
  assert.throws(() => validateMigrationCatalog({ policy, files }));
});

test('unclassified, missing, modified, and multiply classified migrations fail closed', () => {
  const unclassified = fixture();
  unclassified.files.set('0003_unreviewed.sql', 'CREATE TABLE unwanted (id TEXT);');
  assert.throws(() => validateMigrationCatalog(unclassified));

  const missing = fixture();
  missing.files.delete(expansionName);
  assert.throws(() => validateMigrationCatalog(missing));

  const modified = fixture();
  modified.files.set(expansionName, 'DROP TABLE users;');
  assert.throws(() => validateMigrationCatalog(modified));

  const multiplyClassified = fixture();
  multiplyClassified.policy.historical[expansionName] = migrationDigest(expansionSql);
  assert.throws(() => validateMigrationCatalog(multiplyClassified));
});

test('expansion classification requires compatibility and verification evidence', () => {
  for (const field of ['compatibility', 'verification']) {
    const current = fixture();
    current.policy.expansions[expansionName][field] = '   ';
    assert.throws(() => validateMigrationCatalog(current), `missing ${field} must block classification`);
  }
});

test('additive SQL can preserve old reads and writes', () => {
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS profile_labels (id TEXT PRIMARY KEY, label TEXT NOT NULL);',
    'CREATE INDEX IF NOT EXISTS idx_users_name ON users (display_name);',
    'ALTER TABLE users ADD COLUMN display_name TEXT;',
    'ALTER TABLE users ADD COLUMN feature_enabled INTEGER NOT NULL DEFAULT 0;',
  ]) {
    assert.doesNotThrow(() => assertExpansionSql(sql), sql);
  }
});

test('automatic SQL rejects schema removal, replacement, writes, triggers, and tighter existing writes', () => {
  for (const sql of [
    'DROP TABLE users;',
    'DROP INDEX idx_users_name;',
    'ALTER TABLE users DROP COLUMN email;',
    'ALTER TABLE users RENAME TO users_v2;',
    'ALTER TABLE users RENAME COLUMN email TO login;',
    'DELETE FROM users WHERE id = 1;',
    'UPDATE users SET email = lower(email);',
    'INSERT INTO users (id) VALUES (1);',
    'INSERT OR REPLACE INTO users (id) VALUES (1);',
    'REPLACE INTO users (id) VALUES (1);',
    'CREATE TRIGGER stop_writes BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT, \'blocked\'); END;',
    'CREATE UNIQUE INDEX idx_unique_name ON users (display_name);',
    'ALTER TABLE users ADD COLUMN required_name TEXT NOT NULL;',
    'ALTER TABLE users ADD COLUMN required_name TEXT NOT NULL DEFAULT NULL;',
    'ALTER TABLE users ADD COLUMN unique_name TEXT UNIQUE;',
    'ALTER TABLE users ADD COLUMN constrained_score INTEGER CHECK (constrained_score > 0);',
    'ALTER TABLE users ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;',
    'ALTER TABLE users ADD COLUMN computed_score INTEGER DEFAULT (random());',
    'PRAGMA foreign_keys = OFF;',
    'CREATE TABLE IF NOT EXISTS temp_labels (id TEXT); DROP TABLE users;',
  ]) {
    assert.throws(() => assertExpansionSql(sql), undefined, sql);
  }
});

test('comment and literal words do not masquerade as destructive statements', () => {
  const sql = `-- DROP TABLE users; UPDATE users SET email = '';
/* DELETE FROM users; ALTER TABLE users RENAME TO vanished; */
ALTER TABLE users ADD COLUMN note TEXT DEFAULT 'DROP; DELETE; RENAME; can''t';`;
  assert.doesNotThrow(() => assertExpansionSql(sql));
});

test('Wrangler JSON ledger requires successful query results and valid names', () => {
  assert.deepEqual(parseMigrationLedger(ledger(historicalName, expansionName)), [historicalName, expansionName]);
  assert.deepEqual(parseMigrationLedger(ledger()), []);
  for (const stdout of [
    'not json',
    '{}',
    '[]',
    '[{"success":false,"results":[]}]',
    '[{"results":[]}]',
    '[{"success":true,"results":null}]',
    '[{"success":true,"results":[{}]}]',
    '[{"success":true,"results":[{"name":42}]}]',
    '[{"success":true,"results":[{"name":""}]}]',
    JSON.stringify([{ success: true, results: [{ name: [historicalName] }] }]),
  ]) {
    assert.throws(() => parseMigrationLedger(stdout), undefined, stdout);
  }
});

test('planning permits only unique known migrations without gaps in the catalog', () => {
  const catalog = catalogFixture();
  assert.deepEqual(planMigrations(catalog, []).map(({ name }) => name), [historicalName, expansionName]);
  assert.deepEqual(planMigrations(catalog, [historicalName]).map(({ name }) => name), [expansionName]);
  assert.deepEqual(planMigrations(catalog, [historicalName, expansionName]), []);
  assert.deepEqual(planMigrations(catalog, [expansionName, historicalName]), []);
  for (const names of [
    ['0099_unknown.sql'],
    [historicalName, historicalName],
    [expansionName],
  ]) {
    assert.throws(() => planMigrations(catalog, names), undefined, JSON.stringify(names));
  }
});

test('production checks read the ledger without migration mutations', async () => {
  const calls = [];
  await runMigrationOperation({
    mode: 'check',
    catalog: catalogFixture(),
    execute: async (args) => {
      calls.push(args);
      return ledger(historicalName, expansionName);
    },
    log: () => {},
  });
  assert.equal(calls.length, 1);
  assert.ok(isLedgerRead(calls[0]));
});

test('production checks reject every pending migration without applying SQL', async () => {
  for (const applied of [[], [historicalName]]) {
    const calls = [];
    await assert.rejects(runMigrationOperation({
      mode: 'check',
      catalog: catalogFixture(),
      execute: async (args) => {
        calls.push(args);
        return ledger(...applied);
      },
      log: () => {},
    }));
    assert.equal(calls.length, 1);
    assert.ok(isLedgerRead(calls[0]));
  }
});

test('pending historical destructive SQL blocks expansion apply before any mutation', async () => {
  const calls = [];
  await assert.rejects(runMigrationOperation({
    mode: 'apply-expand',
    catalog: catalogFixture(),
    execute: async (args) => {
      calls.push(args);
      return ledger();
    },
    log: () => {},
  }));
  assert.equal(calls.length, 1);
  assert.ok(isLedgerRead(calls[0]));
});

test('invalid and unavailable ledger reads block all mutations', async () => {
  for (const executeResult of ['not json', ledger('0099_unknown.sql'), new Error('D1 unavailable')]) {
    const calls = [];
    await assert.rejects(runMigrationOperation({
      mode: 'apply-expand',
      catalog: catalogFixture(),
      execute: async (args) => {
        calls.push(args);
        if (executeResult instanceof Error) throw executeResult;
        return executeResult;
      },
      log: () => {},
    }));
    assert.equal(calls.length, 1);
    assert.ok(isLedgerRead(calls[0]));
  }
});

test('applied historical SQL permits expansion, and apply verifies the updated ledger', async () => {
  const calls = [];
  let ledgerReads = 0;
  await runMigrationOperation({
    mode: 'apply-expand',
    catalog: catalogFixture(),
    execute: async (args) => {
      calls.push(args);
      if (isLedgerRead(args)) {
        return ++ledgerReads === 1 ? ledger(historicalName) : ledger(historicalName, expansionName);
      }
      assert.ok(isMigrationApply(args));
      return 'Migration applied';
    },
    log: () => {},
  });
  assert.equal(calls.length, 3);
  assert.ok(isLedgerRead(calls[0]));
  assert.ok(isMigrationApply(calls[1]));
  assert.ok(isLedgerRead(calls[2]));
});

test('rerunning expansion after success does not invoke migration apply again', async () => {
  const calls = [];
  await runMigrationOperation({
    mode: 'apply-expand',
    catalog: catalogFixture(),
    execute: async (args) => {
      calls.push(args);
      return ledger(historicalName, expansionName);
    },
    log: () => {},
  });
  assert.equal(calls.length, 1);
  assert.ok(isLedgerRead(calls[0]));
});

test('a successful CLI exit cannot hide an expansion missing from the post-apply ledger', async () => {
  const calls = [];
  await assert.rejects(runMigrationOperation({
    mode: 'apply-expand',
    catalog: catalogFixture(),
    execute: async (args) => {
      calls.push(args);
      return isLedgerRead(args) ? ledger(historicalName) : 'Success';
    },
    log: () => {},
  }));
  assert.equal(calls.length, 3);
  assert.ok(isLedgerRead(calls[2]));
});

test('migration apply errors stop the operation and never invoke application deployment', async () => {
  const calls = [];
  await assert.rejects(runMigrationOperation({
    mode: 'apply-expand',
    catalog: catalogFixture(),
    execute: async (args) => {
      calls.push(args);
      if (isLedgerRead(args)) return ledger(historicalName);
      assert.ok(isMigrationApply(args));
      throw new Error('Migration failed');
    },
    log: () => {},
  }));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((args) => !args.includes('deploy')));
});

test('D1 expansion preserves old explicit-column writes and ledger reruns skip ADD COLUMN', async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'],
  });
  try {
    const database = await miniflare.getD1Database('DB');
    await database.batch([
      database.prepare('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL)'),
      database.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE)'),
      database.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(historicalName),
      database.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind('old-user', 'old@example.test'),
    ]);
    const additiveStatements = [
      'CREATE TABLE IF NOT EXISTS profile_labels (id TEXT PRIMARY KEY, label TEXT NOT NULL);',
      'ALTER TABLE users ADD COLUMN display_name TEXT;',
      'ALTER TABLE users ADD COLUMN feature_enabled INTEGER NOT NULL DEFAULT 0;',
      'CREATE INDEX IF NOT EXISTS idx_users_display_name ON users (display_name);',
    ];
    const current = fixture();
    const sql = additiveStatements.join('\n');
    current.files.set(expansionName, sql);
    current.policy.expansions[expansionName].sha256 = migrationDigest(sql);
    const catalog = validateMigrationCatalog(current);
    let migrationApplyCount = 0;
    const execute = async (args) => {
      if (isLedgerRead(args)) {
        return JSON.stringify([await database.prepare('SELECT name FROM d1_migrations ORDER BY id').all()]);
      }
      assert.ok(isMigrationApply(args));
      migrationApplyCount++;
      await database.batch([
        ...additiveStatements.map((statement) => database.prepare(statement)),
        database.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(expansionName),
      ]);
      return 'Success';
    };
    await runMigrationOperation({ mode: 'apply-expand', catalog, execute, log: () => {} });

    // A serving old release still uses only the pre-expansion column names.
    await database.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind('new-user', 'new@example.test').run();
    await database.prepare('UPDATE users SET email = ? WHERE id = ?').bind('updated@example.test', 'old-user').run();
    assert.deepEqual((await database.prepare('SELECT id, email FROM users ORDER BY id').all()).results, [
      { id: 'new-user', email: 'new@example.test' },
      { id: 'old-user', email: 'updated@example.test' },
    ]);
    assert.deepEqual(await database.prepare('SELECT display_name, feature_enabled FROM users WHERE id = ?').bind('new-user').first(), {
      display_name: null,
      feature_enabled: 0,
    });

    // IF NOT EXISTS objects tolerate direct repetition; ADD COLUMN uses the ledger.
    await database.batch([database.prepare(additiveStatements[0]), database.prepare(additiveStatements[3])]);
    await runMigrationOperation({ mode: 'apply-expand', catalog, execute, log: () => {} });
    assert.equal(migrationApplyCount, 1);
    assert.equal((await database.prepare('SELECT name FROM d1_migrations').all()).results.length, 2);
  } finally {
    await miniflare.dispose();
  }
});

test('application and database workflows keep production mutations separate', async () => {
  const [deployment, expansion] = await Promise.all([
    readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/database-expand.yml', import.meta.url), 'utf8'),
  ]);
  const withoutComments = (source) => source.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  const deploySteps = withoutComments(deployment);
  const expandSteps = withoutComments(expansion);
  assert.match(deploySteps, /npm run deploy:worker/);
  assert.doesNotMatch(deploySteps, /db:migrate:remote|db:migrate:expand|d1\s+migrations\s+apply|d1\s+execute[^\n]*(?:--file|UPDATE|DELETE|DROP)/i);
  assert.match(expandSteps, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(expandSteps, /^\s+(?:push|pull_request|schedule|workflow_run|workflow_call):/m);
  assert.match(expandSteps, /github\.ref\s*==\s*['"]refs\/heads\/main['"]/);
  assert.doesNotMatch(expandSteps, /deploy:worker|wrangler\s+(?:deploy|versions\s+deploy)/);
  for (const source of [deploySteps, expandSteps]) {
    assert.match(source, /group:\s*cloudflare-production/);
    assert.match(source, /cancel-in-progress:\s*false/);
  }
});
