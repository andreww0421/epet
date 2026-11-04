import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import type { AppData } from '../src/store/types';
import { MAX_D1_STATE_BYTES, utf8Size } from '../shared/domain/repositoryPolicy';
import { D1WorkspaceRepository } from '../worker/repository';
import {
  validateD1Recovery,
  type D1RecoveryIssueCode,
  type D1RecoverySchemaEntry,
  type D1RecoveryValidationOptions,
} from '../worker/recoveryValidation';

const names = (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort();
const options: D1RecoveryValidationOptions = { expectedMigrations: names };
const trustedSchemas = new WeakMap<D1Database, D1RecoverySchemaEntry[]>();
const PRIVATE_TEXT = 'synthetic-sensitive-student-name';
const PRIVATE_EMAIL = 'synthetic-sensitive-email@example.invalid';
const PRIVATE_HASH = 'synthetic-password-verifier-never-report';

const statements = (sql: string) => {
  const result: string[] = [];
  let current: string[] = [];
  let trigger = false;
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    if (/^CREATE\s+TRIGGER\b/i.test(trimmed)) trigger = true;
    current.push(line);
    if (trigger ? /^END;$/i.test(trimmed) : trimmed.endsWith(';')) {
      result.push(current.join('\n'));
      current = [];
      trigger = false;
    }
  }
  assert.equal(current.length, 0);
  return result;
};

const createData = (): AppData => ({
  currentClassId: 'class-a', lastOpened: 1_700_000_000_000,
  classes: ['class-a', 'class-b'].map((classId) => ({
    id: classId, name: `${PRIVATE_TEXT}-${classId}`,
    students: [{
      // IDs are scoped by workspace AND class; repeating this ID is legal.
      id: 'shared-student', name: PRIVATE_TEXT, points: 11, rankPoints: 8, warningPoints: 1,
      pet: { type: 'cat', fullness: 80, happiness: 70, level: 3 },
      pointAdjustmentRecords: [{ id: 'adjustment', amount: 3, source: 'manual',
        reasonId: 'helping', reasonLabel: 'Helped a friend', competency: 'collaboration', createdAt: 100 }],
      disciplineRecords: [{ id: 'discipline', type: 'levelDecrease', warningCount: 1,
        reason: 'Synthetic reason', actionKind: 'levelDecrease', createdAt: 101 }],
      bossRewardRecords: [{ id: 'reward', bossId: 'boss', bossName: 'Slime', rank: 1, damage: 5,
        attackCount: 1, fairScore: 5, previousDamage: 1, previousFairScore: 1, improvementAmount: 4,
        fairImprovementAmount: 4, rewardPoints: 2, rewardRankPoints: 1, rewardHappiness: 1,
        rankRewardPoints: 1, rankRewardRankPoints: 1, rankRewardHappiness: 1,
        participationRewardPoints: 1, participationRewardRankPoints: 0, participationRewardHappiness: 0,
        improvementRewardPoints: 0, improvementRewardRankPoints: 0, improvementRewardHappiness: 0,
        receivedImprovementReward: true, createdAt: 102 }],
    }],
    examRecords: [{ id: 'exam', title: 'Synthetic exam', examDate: '2026-10-29',
      items: [{ id: 'math', name: 'Math', maxScore: 100 }],
      results: [{ studentId: 'shared-student', scores: { math: 80 }, mentorComment: PRIVATE_TEXT, updatedAt: 103 }],
      createdAt: 102, updatedAt: 103 }],
    learningEvidenceRecords: [{ id: 'evidence', classId, studentId: 'shared-student', competency: 'growth',
      level: 'progressing', evidenceType: 'assessment', title: 'Growth', note: PRIVATE_TEXT,
      actor: 'mentor', source: 'manual', rubricVersion: '1.0', revision: 1, createdAt: 104 }],
  })),
});

const addUser = async (database: D1Database, userId: string) => {
  await database.prepare(`INSERT INTO users (
    user_id, email, email_normalized, display_name, status, password_algorithm, password_salt,
    password_hash, password_iterations, created_at, updated_at, password_changed_at, email_verified_at
  ) VALUES (?, ?, ?, ?, 'active', 'PBKDF2-HMAC-SHA256', 'synthetic-salt', ?, 1, 1, 1, 1, 1)`)
    .bind(userId, PRIVATE_EMAIL, `${userId}-${PRIVATE_EMAIL}`, 'Synthetic owner', PRIVATE_HASH).run();
};

const fixture = async (t: TestContext, tenants = 1, persistence?: string) => {
  const miniflare = new Miniflare({
    modules: true, script: 'export default { fetch() { return new Response("fixture"); } }', d1Databases: ['DB'],
    ...(persistence ? { d1Persist: persistence } : {}),
  });
  let disposed = false;
  const dispose = async () => { if (!disposed) { disposed = true; await miniflare.dispose(); } };
  t.after(dispose);
  const database = await miniflare.getD1Database('DB') as unknown as D1Database;
  // This is the actual Wrangler ledger shape, rather than a fixture that just
  // executes the schema and incorrectly treats absent migration evidence as OK.
  await database.prepare(`CREATE TABLE d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`).run();
  for (const name of names) {
    for (const statement of statements(await readFile(`migrations/${name}`, 'utf8'))) await database.prepare(statement).run();
    await database.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name).run();
  }
  const trustedSchema = (await database.prepare(`SELECT type, name, sql FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger') ORDER BY type, name`).all<D1RecoverySchemaEntry>()).results
    .filter((entry) => entry.name !== 'd1_migrations' && !entry.name.startsWith('sqlite_') && !entry.name.startsWith('_cf_'));
  // Captured before synthetic data or any corruption; never derive expected
  // schema from an already restored or deliberately corrupted candidate.
  trustedSchemas.set(database, trustedSchema);
  const repository = new D1WorkspaceRepository(database, { readMode: 'blob' });
  for (let index = 0; index < tenants; index += 1) {
    const id = `tenant-${index}`;
    await repository.put(id, createData(), 0);
    await addUser(database, `owner-${index}`);
    await database.prepare(`INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
      VALUES (?, ?, 'owner', 1)`).bind(id, `owner-${index}`).run();
    await database.prepare(`INSERT INTO workspace_claims (workspace_id, claimed_by_user_id, claimed_at)
      VALUES (?, ?, 1)`).bind(id, `owner-${index}`).run();
  }
  return { database, repository, dispose };
};

const snapshot = async (database: D1Database) => {
  const schema = (await database.prepare(`SELECT name, type, sql FROM sqlite_master
    WHERE name NOT LIKE '_cf_%' ORDER BY type, name`).all()).results;
  const tables = schema.filter((row) => row.type === 'table');
  const reads = tables.map(({ name }) => {
    assert.match(String(name), /^[A-Za-z0-9_]+$/);
    return database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`);
  });
  const data = await database.batch(reads);
  const contents = tables.map(({ name }, index) => [name, data[index].results]);
  return JSON.stringify({ schema, contents });
};

const inspect = async (database: D1Database, overrides: Partial<D1RecoveryValidationOptions> = {}) => {
  const before = await snapshot(database);
  const report = await validateD1Recovery(database, { ...options, expectedSchema: trustedSchemas.get(database), ...overrides });
  assert.equal(await snapshot(database), before, 'recovery inspection must not mutate any table or schema');
  const output = JSON.stringify(report);
  for (const sensitive of [PRIVATE_TEXT, PRIVATE_EMAIL, PRIVATE_HASH, 'tenant-0', 'owner-0', 'shared-student', 'class-a', 'data_json']) {
    assert.equal(output.includes(sensitive), false, 'reports contain aggregate codes only');
  }
  assert.equal(report.privacyStatus, 'not_verified');
  return report;
};

const blocked = async (database: D1Database, code: D1RecoveryIssueCode, overrides: Partial<D1RecoveryValidationOptions> = {}) => {
  const report = await inspect(database, overrides);
  assert.equal(report.status, 'blocked');
  assert.ok(report.issues.some((issue) => issue.code === code), `${code}: ${JSON.stringify(report)}`);
  return report;
};

test('valid populated and empty candidates are structurally valid; cross-class and tenant IDs remain scoped', async (t) => {
  const { database } = await fixture(t, 2);
  const result = await inspect(database, { pageSize: 1, maxWorkspaces: 2 });
  assert.deepEqual(result, { status: 'structurally_valid', privacyStatus: 'not_verified', checkedWorkspaces: 2,
    legacyUnclaimedWorkspaces: 0, truncated: false, issues: [] });
  await database.prepare('DELETE FROM workspace_claims').run();
  await database.prepare('DELETE FROM workspaces').run();
  const empty = await inspect(database);
  assert.equal(empty.status, 'structurally_valid');
  assert.equal(empty.checkedWorkspaces, 0);
});

test('same-count corrupt projection content, cached verified flags, redundant parents and scalar columns fail closed', async (t) => {
  const { database } = await fixture(t);
  await database.prepare(`UPDATE workspace_projection_documents SET reconciliation_status = 'verified',
    source_checksum = 'matching-but-untrusted', projection_checksum = 'matching-but-untrusted'`).run();
  const row = await database.prepare(`SELECT record_json FROM students WHERE class_id = 'class-a'`).first<{ record_json: string }>();
  await database.prepare(`UPDATE students SET record_json = json_set(record_json, '$.points', 99) WHERE class_id = 'class-a'`).run();
  await blocked(database, 'PROJECTION_MISMATCH');
  await database.prepare(`UPDATE students SET record_json = ? WHERE class_id = 'class-a'`).bind(row!.record_json).run();
  await database.prepare(`UPDATE classes SET record_json = json_set(record_json, '$.students[0].points', 99) WHERE class_id = 'class-a'`).run();
  await blocked(database, 'PROJECTION_MISMATCH');
  await database.prepare(`UPDATE classes SET record_json = json_set(record_json, '$.students[0].points', 11) WHERE class_id = 'class-a'`).run();
  await database.prepare(`UPDATE students SET points = 99 WHERE class_id = 'class-a'`).run();
  await blocked(database, 'PROJECTION_MISMATCH');
});

test('stale revisions, wrong keys, exact positions, root content and missing documents cannot use a blob fallback', async (t) => {
  const { database } = await fixture(t);
  await database.prepare(`UPDATE students SET source_revision = 2 WHERE class_id = 'class-a'`).run();
  await blocked(database, 'PROJECTION_MISMATCH');
  await database.prepare(`UPDATE students SET source_revision = 1, sort_index = 5 WHERE class_id = 'class-a'`).run();
  await blocked(database, 'PROJECTION_MISMATCH');
  await database.prepare(`UPDATE students SET sort_index = 0 WHERE class_id = 'class-a'`).run();
  await database.prepare(`UPDATE point_adjustments SET adjustment_id = 'wrong-key' WHERE class_id = 'class-a'`).run();
  await blocked(database, 'PROJECTION_MISMATCH');
  await database.prepare(`UPDATE point_adjustments SET adjustment_id = 'adjustment' WHERE class_id = 'class-a'`).run();
  await database.prepare(`UPDATE workspace_projection_documents SET root_json = '{}'`).run();
  await blocked(database, 'PROJECTION_MISMATCH');
  await database.prepare('DELETE FROM workspace_projection_documents').run();
  await blocked(database, 'PROJECTION_MISMATCH');
});

test('claimed workspaces need exactly one matching owner; unclaimed legacy requires explicit acceptance', async (t) => {
  const { database } = await fixture(t);
  await addUser(database, 'other-owner');
  await database.prepare(`UPDATE workspace_claims SET claimed_by_user_id = 'other-owner'`).run();
  await blocked(database, 'OWNERSHIP_MISMATCH');
  await database.prepare(`UPDATE workspace_claims SET claimed_by_user_id = 'owner-0'`).run();
  await database.prepare(`INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
    VALUES ('tenant-0', 'other-owner', 'owner', 1)`).run();
  await blocked(database, 'OWNERSHIP_MISMATCH');
  await database.prepare('DELETE FROM workspace_claims').run();
  await blocked(database, 'OWNERSHIP_MISMATCH', { allowUnclaimedLegacy: true });
  await database.prepare('DELETE FROM workspace_memberships').run();
  const legacy = await blocked(database, 'UNCLAIMED_LEGACY');
  assert.equal(legacy.legacyUnclaimedWorkspaces, 1);
  assert.equal((await inspect(database, { allowUnclaimedLegacy: true })).status, 'structurally_valid');
});

test('unknown, missing, unordered and absent migration evidence block; harmless positive ledger ID gaps are accepted', async (t) => {
  const { database } = await fixture(t);
  await database.prepare('UPDATE d1_migrations SET id = id + 100').run();
  assert.equal((await inspect(database)).status, 'structurally_valid');
  await database.prepare('UPDATE d1_migrations SET id = id - 100').run();
  await database.prepare(`UPDATE d1_migrations SET name = '9999_unknown.sql' WHERE id = 2`).run();
  await blocked(database, 'MIGRATION_UNKNOWN');
  await blocked(database, 'MIGRATION_MISSING');
  await database.prepare('UPDATE d1_migrations SET name = ? WHERE id = 2').bind(names[1]).run();
  await database.prepare('UPDATE d1_migrations SET id = 20 WHERE id = 2').run();
  await blocked(database, 'MIGRATION_ORDER');
  await database.prepare('DROP TABLE d1_migrations').run();
  await blocked(database, 'MIGRATION_LEDGER_MISSING');
});

test('missing expected schema objects and trigger protection block validation', async (t) => {
  const { database } = await fixture(t);
  await blocked(database, 'SCHEMA_EVIDENCE_MISSING', { expectedSchema: undefined });
  await database.prepare('CREATE TABLE unexpected_table (id TEXT)').run();
  await blocked(database, 'SCHEMA_MISMATCH');
  await database.prepare('DROP TABLE unexpected_table').run();
  await database.prepare('DROP TRIGGER trg_workspace_class_assignments_insert').run();
  await database.prepare(`CREATE TRIGGER trg_workspace_class_assignments_insert
    BEFORE INSERT ON workspace_class_assignments BEGIN SELECT 1; END`).run();
  await blocked(database, 'SCHEMA_MISMATCH');
  await database.prepare('DROP TRIGGER trg_workspace_class_assignments_insert').run();
  await blocked(database, 'SCHEMA_MISMATCH');
  await database.prepare('DROP INDEX idx_auth_sessions_expiry').run();
  await blocked(database, 'SCHEMA_MISMATCH');
});

test('same-named tables with changed CHECK constraints and unexpected schema objects are rejected', async (t) => {
  const { database } = await fixture(t);
  await database.prepare('DROP TABLE auth_rate_limits').run();
  await database.prepare(`CREATE TABLE auth_rate_limits (
    scope TEXT NOT NULL, subject_hash TEXT NOT NULL, window_started_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, subject_hash)
  )`).run();
  await database.prepare(`CREATE INDEX idx_auth_rate_limits_blocked ON auth_rate_limits (blocked_until) WHERE blocked_until > 0`).run();
  await blocked(database, 'SCHEMA_MISMATCH');
  await database.prepare('CREATE TABLE unexpected_table (id TEXT)').run();
  await blocked(database, 'SCHEMA_MISMATCH');
});

test('ledger defaults and uniqueness required by future Wrangler migrations survive restoration', async (t) => {
  for (const missing of ['timestamp-default', 'name-unique']) {
    const { database } = await fixture(t);
    await database.prepare('ALTER TABLE d1_migrations RENAME TO ledger_copy').run();
    await database.prepare(`CREATE TABLE d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT ${missing === 'name-unique' ? '' : 'UNIQUE'},
      applied_at TIMESTAMP ${missing === 'timestamp-default' ? '' : 'DEFAULT CURRENT_TIMESTAMP'} NOT NULL
    )`).run();
    await database.prepare('INSERT INTO d1_migrations SELECT * FROM ledger_copy').run();
    await database.prepare('DROP TABLE ledger_copy').run();
    await blocked(database, 'SCHEMA_MISMATCH');
    if (missing === 'timestamp-default') await assert.rejects(database.prepare('INSERT INTO d1_migrations(name) VALUES (?)').bind('0008_synthetic_probe.sql').run());
  }
});

test('retained history must support future privacy cleanup without rejecting unrelated legacy scalars', async (t) => {
  const { database, repository } = await fixture(t);
  await repository.put('tenant-0', createData(), 1);
  for (const data of [{}, { classes: [{}] }, { classes: [{ id: 'class-a', students: null }] },
    { classes: [{ id: 'class-a', students: [], examRecords: [{ results: null }] }] },
    { classes: [{ id: 'class-a', students: [], activeBoss: {} }] }]) {
    const json = JSON.stringify(data);
    await database.prepare('UPDATE workspace_revisions SET data_json=?, data_size_bytes=? WHERE workspace_id=? AND revision=1')
      .bind(json, utf8Size(json), 'tenant-0').run();
    await blocked(database, 'HISTORY_INVALID');
  }
  const historic = { classes: [{ id: 'class-a', students: [{ id: 'shared-student', warningPoints: 999_999 }],
    learningEvidenceRecords: null, examRecords: null, activeBoss: null, legacyExtension: 'preserved' }] };
  const json = JSON.stringify(historic);
  await database.prepare('UPDATE workspace_revisions SET data_json=?, data_size_bytes=? WHERE workspace_id=? AND revision=1')
    .bind(json, utf8Size(json), 'tenant-0').run();
  assert.equal((await inspect(database)).status, 'structurally_valid');
  const current = await repository.get('tenant-0');
  assert.ok(current.data);
  await repository.put('tenant-0', { ...current.data, classes: current.data.classes.map((classroom) =>
    classroom.id === 'class-a' ? { ...classroom, students: [], examRecords: [], learningEvidenceRecords: [] } : classroom) }, current.revision);
  const retained = await database.prepare('SELECT data_json FROM workspace_revisions WHERE workspace_id=? AND revision=1').bind('tenant-0').first<{ data_json: string }>();
  assert.deepEqual(JSON.parse(retained!.data_json).classes[0].students, []);
  assert.equal(JSON.parse(retained!.data_json).classes[0].legacyExtension, 'preserved');
});

test('bad current JSON, oversized blobs and invalid current revisions produce sanitized errors', async (t) => {
  const { database } = await fixture(t);
  const original = (await database.prepare('SELECT data_json FROM workspaces').first<{ data_json: string }>())!.data_json;
  await database.prepare('UPDATE workspaces SET data_json = ?').bind(`{"invalid":"${PRIVATE_TEXT}`).run();
  await blocked(database, 'WORKSPACE_INVALID');
  await database.prepare('UPDATE workspaces SET data_json = ?').bind('x'.repeat(MAX_D1_STATE_BYTES + 1)).run();
  await blocked(database, 'WORKSPACE_TOO_LARGE');
  await database.prepare('UPDATE workspaces SET data_json = ?, revision = 1.5').bind(original).run();
  await blocked(database, 'WORKSPACE_INVALID');
});

test('retained history validates bytes, JSON, latest equality, retention and consecutive suffix without normalizing privacy rewrites', async (t) => {
  const { database, repository } = await fixture(t);
  await repository.put('tenant-0', createData(), 1);
  // Privacy cleanup may retain unrelated old values beyond today's field schema.
  const historic = JSON.stringify({ classes: [], legacyField: 'x'.repeat(5_000), warningPoints: 999_999 });
  await database.prepare('UPDATE workspace_revisions SET data_json = ?, data_size_bytes = ? WHERE revision = 1')
    .bind(historic, utf8Size(historic)).run();
  assert.equal((await inspect(database)).status, 'structurally_valid');
  await database.prepare('UPDATE workspace_revisions SET data_size_bytes = 1 WHERE revision = 1').run();
  await blocked(database, 'HISTORY_INVALID');
  await database.prepare('UPDATE workspace_revisions SET data_json = ?, data_size_bytes = ? WHERE revision = 1')
    .bind('{', 1).run();
  await blocked(database, 'HISTORY_INVALID');
  await database.prepare('UPDATE workspace_revisions SET data_json = ?, data_size_bytes = ? WHERE revision = 1')
    .bind('x'.repeat(MAX_D1_STATE_BYTES + 1), MAX_D1_STATE_BYTES + 1).run();
  await blocked(database, 'HISTORY_TOO_LARGE');
  await database.prepare('UPDATE workspace_revisions SET data_json = ?, data_size_bytes = ? WHERE revision = 1')
    .bind(historic, utf8Size(historic)).run();
  await database.prepare(`UPDATE workspace_revisions SET data_json = '{}', data_size_bytes = 2 WHERE revision = 2`).run();
  await blocked(database, 'HISTORY_LATEST_MISMATCH');
  for (let revision = 3; revision <= 27; revision += 1) {
    await database.prepare(`INSERT INTO workspace_revisions (workspace_id, revision, updated_at, data_size_bytes, data_json)
      VALUES ('tenant-0', ?, 1, 2, '{}')`).bind(revision).run();
  }
  await blocked(database, 'HISTORY_LIMIT');
  await database.prepare('DELETE FROM workspace_revisions WHERE revision <> 1').run();
  await blocked(database, 'HISTORY_LATEST_MISMATCH');
});

test('class assignment checks reject missing classes and elevated role assignments even with valid tenant foreign keys', async (t) => {
  const { database } = await fixture(t, 2);
  await addUser(database, 'teacher');
  await database.prepare(`INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
    VALUES ('tenant-0', 'teacher', 'teacher', 1)`).run();
  await database.prepare(`INSERT INTO workspace_class_assignments (workspace_id, user_id, class_id, created_at)
    VALUES ('tenant-0', 'teacher', 'class-a', 1)`).run();
  assert.equal((await inspect(database)).status, 'structurally_valid');
  // Corrupt an otherwise valid fixture without changing schema protection: the
  // membership update path is deliberately outside the assignment SQL trigger.
  await database.prepare(`UPDATE workspace_memberships SET role = 'admin' WHERE user_id = 'teacher'`).run();
  await blocked(database, 'CLASS_ASSIGNMENT_INVALID');
  await database.prepare(`UPDATE workspace_memberships SET role = 'teacher' WHERE user_id = 'teacher'`).run();
  // Classes are deleted and recreated by native projection writes, so class IDs
  // are protected by assignment triggers rather than a cascading class FK.
  await database.prepare(`DELETE FROM classes WHERE workspace_id = 'tenant-0' AND class_id = 'class-a'`).run();
  await blocked(database, 'CLASS_ASSIGNMENT_INVALID');
});

test('foreign-key checks include orphans outside paginated tenant keys and quick check rejects persisted CHECK violations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-recovery-orphan-'));
  const expectedPrefix = `${resolve(tmpdir())}${sep}`;
  assert.ok(resolve(directory).startsWith(expectedPrefix));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(expectedPrefix));
    await rm(directory, { recursive: true, force: true });
  });
  const original = await fixture(t, 1, directory);
  const trusted = trustedSchemas.get(original.database)!;
  await original.dispose();
  const findSqlite = async (path: string): Promise<string[]> => {
    const files: string[] = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(...await findSqlite(join(path, entry.name)));
      else if (entry.name.endsWith('.sqlite')) files.push(join(path, entry.name));
    }
    return files;
  };
  const files = (await findSqlite(directory)).filter((path) => {
    const candidate = new DatabaseSync(path, { readOnly: true });
    try { return Boolean(candidate.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'`).get()); }
    finally { candidate.close(); }
  });
  assert.equal(files.length, 1, 'exactly one freshly created fixture file contains the application schema');
  // D1 correctly refuses to disable FK enforcement. Offline modification is
  // confined to this newly created synthetic SQLite file, with Miniflare closed.
  const local = new DatabaseSync(files[0]);
  try {
    local.exec('PRAGMA foreign_keys = OFF');
    local.exec(`UPDATE students SET workspace_id = 'orphaned-tenant' WHERE class_id = 'class-a'`);
    local.exec('PRAGMA ignore_check_constraints = ON');
    local.exec(`UPDATE auth_rate_limits SET attempt_count = -1`);
    local.exec(`INSERT INTO auth_rate_limits (scope, subject_hash, window_started_at, attempt_count, blocked_until)
      VALUES ('login', 'synthetic-hash', 1, -1, 0)`);
  } finally { local.close(); }
  const reopened = new Miniflare({ modules: true, script: 'export default {}', d1Databases: ['DB'], d1Persist: directory });
  // Dispose before the earlier directory cleanup callback runs.
  try {
    const database = await reopened.getD1Database('DB') as unknown as D1Database;
    trustedSchemas.set(database, trusted);
    const result = await blocked(database, 'FOREIGN_KEY_VIOLATION');
    assert.ok(result.issues.some((issue) => issue.code === 'INTEGRITY_CHECK_FAILED'));
  } finally { await reopened.dispose(); }
});

test('limits are explicit incomplete validation and invalid options do not query the database', async (t) => {
  const { database } = await fixture(t, 2);
  const capped = await blocked(database, 'VALIDATION_TRUNCATED', { pageSize: 1, maxWorkspaces: 1 });
  assert.equal(capped.checkedWorkspaces, 1);
  assert.equal(capped.truncated, true);
  await blocked(database, 'PROJECTION_LIMIT', { maxProjectionRowsPerWorkspace: 1 });
  for (const overrides of [{ pageSize: 0 }, { maxWorkspaces: Infinity }, { maxProjectionRowsPerWorkspace: NaN },
    { expectedMigrations: [] }, { expectedMigrations: [names[0], names[0]] }, { expectedMigrations: ['../../private.sql'] }]) {
    await blocked(database, 'INVALID_OPTIONS', overrides);
  }
  const noQueries = { prepare() { throw new Error('must not query'); } } as unknown as D1Database;
  assert.deepEqual((await validateD1Recovery(noQueries, { ...options, pageSize: -1 })).issues, [{ code: 'INVALID_OPTIONS', count: 1 }]);
});

test('database exceptions never reveal database paths, SQL contents, identities or credentials', async () => {
  const throwing = { prepare() { throw new Error(`${PRIVATE_TEXT} ${PRIVATE_EMAIL} ${PRIVATE_HASH} tenant-0 SELECT secret`); } } as unknown as D1Database;
  const result = await validateD1Recovery(throwing, { ...options,
    expectedSchema: [{ type: 'table', name: 'sample', sql: 'CREATE TABLE sample (id TEXT)' }] });
  assert.deepEqual(result, { status: 'blocked', privacyStatus: 'not_verified', checkedWorkspaces: 0,
    legacyUnclaimedWorkspaces: 0, truncated: false, issues: [{ code: 'QUERY_FAILED', count: 1 }] });
});

test('optional onboarding recovery validates calendar and state without exposing account identifiers', async (t) => {
  const { database } = await fixture(t);
  await database.prepare(`INSERT INTO auth_product_onboarding
    (user_id, cohort_day, started, local_reported, backend_persisted)
    VALUES ('owner-0', '2026-02-31', 1, 1, 1)`).run();
  await blocked(database, 'ONBOARDING_INVALID');
  await database.prepare(`UPDATE auth_product_onboarding SET cohort_day = '2026-11-02'`).run();
  assert.equal((await inspect(database)).status, 'structurally_valid');
  await assert.rejects(database.prepare(`UPDATE auth_product_onboarding SET started = 0`).run());
});

test('trusted historical seven-migration recovery evidence remains compatible without optional onboarding', async (t) => {
  const { database } = await fixture(t, 0);
  await database.prepare('DROP TABLE auth_product_onboarding').run();
  await database.prepare("DELETE FROM d1_migrations WHERE name = '0008_product_onboarding.sql'").run();
  const historicalSchema = trustedSchemas.get(database)!.filter((entry) =>
    entry.name !== 'auth_product_onboarding' && entry.name !== 'idx_auth_product_onboarding_cohort');
  // This represents separately trusted schema evidence for the historical
  // migration set, rather than blessing a damaged eight-migration candidate.
  const result = await inspect(database, { expectedMigrations: names.filter((name) => name !== '0008_product_onboarding.sql'),
    expectedSchema: historicalSchema });
  assert.equal(result.status, 'structurally_valid');
});
