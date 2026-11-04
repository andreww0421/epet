import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import type { AppData } from '../src/store/types';
import { assertWorkspaceData } from '../shared/validation/workspaceValidation';
import { planSyntheticSqlImport, RECOVERY_SQL_STATEMENT_LIMIT_BYTES, runSyntheticD1RecoveryDrill } from '../scripts/disaster-recovery';

test('synthetic D1 SQL backup/restore preserves tenants, schema and history and enforces privacy/security replay before reopening', async () => {
  const reviewedPolicy = JSON.parse(await readFile('migrations/policy.json', 'utf8')) as {
    historical: Record<string, string>; expansions: Record<string, unknown>;
  };
  const reviewedMigrations = Object.keys({ ...reviewedPolicy.historical, ...reviewedPolicy.expansions }).sort();
  assert.ok(reviewedMigrations.includes('0008_product_onboarding.sql'));
  let exported = false;
  const result = await runSyntheticD1RecoveryDrill((backup) => {
    assert.ok(backup.sql.includes('Synthetic Alice'));
    assert.deepEqual(backup.expectedMigrations, reviewedMigrations);
    assert.ok(backup.expectedSchema.length > 0);
    assert.ok(backup.expectedSchema.some((entry) => entry.type === 'table' && entry.name === 'auth_product_onboarding'));
    assert.ok(planSyntheticSqlImport(backup.sql).maxStatementBytes <= RECOVERY_SQL_STATEMENT_LIMIT_BYTES);
    // Caller-owned output metadata cannot alter the drill's trusted baseline.
    (backup.expectedSchema[0] as { sql: string }).sql = 'synthetic caller mutation';
    exported = true;
  });
  assert.equal(exported, true);
  assert.equal(result.mode, 'local_synthetic');
  assert.ok(result.backupBytes > 0);
  assert.ok(result.maxSqlStatementBytes <= RECOVERY_SQL_STATEMENT_LIMIT_BYTES);
  assert.match(result.backupSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.migrationCount, reviewedMigrations.length);
  assert.equal(result.checks.onboardingProgressRoundTrip, true);
  assert.equal(result.checks.onboardingUnaffectedByStudentPrivacyReplay, true);
  assert.ok(Object.values(result.checks).every((check) => check === true));
  assert.equal(result.structural.status, 'structurally_valid');
  assert.equal(result.structural.privacyStatus, 'not_verified');
  assert.equal(result.platformTimeTravel, 'not_executed');
  assert.equal(result.rpo, 'not_measured');
  assert.equal(result.rto, 'not_measured');
  const output = JSON.stringify(result);
  for (const secret of ['Synthetic Alice', 'Synthetic Bob', 'Synthetic Charlie', '@example.test',
    'tokenHash', 'password_hash', 'password_salt', 'correct horse', 'studentId', 'workspaceId']) {
    assert.equal(output.includes(secret), false, 'drill reports aggregates, never fixture identities or credentials');
  }
});

test('SQL recovery preflight measures UTF-8 bytes and rejects oversized statements before import', () => {
  const atLimit = `SELECT '${'x'.repeat(RECOVERY_SQL_STATEMENT_LIMIT_BYTES - 10)}';`;
  assert.equal(Buffer.byteLength(atLimit), RECOVERY_SQL_STATEMENT_LIMIT_BYTES);
  assert.equal(planSyntheticSqlImport(atLimit).maxStatementBytes, RECOVERY_SQL_STATEMENT_LIMIT_BYTES);
  assert.throws(() => planSyntheticSqlImport(atLimit.replace("';", "x';")), /RECOVERY_SQL_STATEMENT_TOO_LARGE/);
  assert.throws(() => planSyntheticSqlImport(`SELECT '${'學'.repeat(40_000)}';`), /RECOVERY_SQL_STATEMENT_TOO_LARGE/);
  assert.throws(() => planSyntheticSqlImport(''), /RECOVERY_SQL_EMPTY/);
});

test('a valid large bound JSON row exports an oversized SQL literal and cannot enter the simple SQL restore path', async () => {
  const runtime = new Miniflare({ modules: true, d1Databases: ['SOURCE', 'EMPTY_TARGET'],
    script: 'export default { fetch() { return new Response("synthetic capacity fixture"); } }',
    outboundService: () => { throw new Error('Synthetic fixture blocks outbound network'); } });
  try {
    const source = await runtime.getD1Database('SOURCE');
    const target = await runtime.getD1Database('EMPTY_TARGET');
    await source.prepare('CREATE TABLE synthetic_documents (id INTEGER PRIMARY KEY, data_json TEXT NOT NULL CHECK(json_valid(data_json)))').run();
    const data: AppData = { lastOpened: 1_800_000_000_000, currentClassId: 'synthetic-capacity-class', classes: [{
      id: 'synthetic-capacity-class', name: 'Synthetic capacity class',
      students: [{ id: '100', name: 'Synthetic capacity student', points: 1, rankPoints: 0, warningPoints: 0,
        pet: { type: 'cat', fullness: 80, happiness: 80, level: 1 } }],
      learningEvidenceRecords: Array.from({ length: 150 }, (_, i) => ({
        id: `synthetic-capacity-${i}`, classId: 'synthetic-capacity-class', studentId: '100',
        competency: 'participation', level: 'progressing', evidenceType: 'observation', title: 'Synthetic capacity record',
        note: 'x'.repeat(1_000), actor: 'mentor', source: 'manual', rubricVersion: '1.0', revision: 1,
        createdAt: 1_800_000_000_000,
      } as const)),
    }] };
    assertWorkspaceData(data);
    const json = JSON.stringify(data);
    assert.ok(Buffer.byteLength(json) < 900 * 1024, 'bounded fixture is below the existing snapshot guard');
    await source.prepare('INSERT INTO synthetic_documents(id, data_json) VALUES (?, ?)').bind(1, json).run();
    const dump = await source.prepare('PRAGMA miniflare_d1_export(?,?,?);').bind(false, false).raw<string[]>();
    assert.throws(() => planSyntheticSqlImport(dump[0].join('\n')), /RECOVERY_SQL_STATEMENT_TOO_LARGE/);
    assert.equal((await target.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name='synthetic_documents'").first<{ count: number }>())?.count, 0);
  } finally { await runtime.dispose(); }
});

test('local recovery CLI rejects remote flags, resource selectors and input files', async () => {
  for (const args of [['--remote'], ['--database', 'epet-production'], ['--file', 'production.sql']]) {
    await assert.rejects(promisify(execFile)(process.execPath,
      ['--import', 'tsx', resolve('scripts/disaster-recovery.ts'), ...args],
      { timeout: 30_000, env: { ...process.env, CLOUDFLARE_API_TOKEN: 'synthetic-must-never-be-used' } }),
    (error: Error & { code?: number; stdout?: string; stderr?: string }) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout?.trim(), '');
      assert.match(error.stderr ?? '', /accepts no arguments/);
      assert.equal((error.stdout + error.stderr).includes('synthetic-must-never-be-used'), false);
      return true;
    });
  }
});
