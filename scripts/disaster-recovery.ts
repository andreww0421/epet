import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';
import { AuthService, InvalidSessionError, verifyPassword } from '../server/auth';
import { createApiHandler } from '../server/api';
import { WorkspaceConflictError } from '../server/contracts';
import { createCsrfToken } from '../server/middleware/csrf';
import { deleteClassFromWorkspace, updateClassArchive } from '../shared/domain/classArchive';
import { anonymizeStudentInWorkspaceData, purgeStudentsFromWorkspaceData } from '../shared/domain/studentPrivacy';
import type { AppData } from '../src/store/types';
import { D1WorkspaceRepository } from '../worker/repository';
import { validateD1Recovery, type D1RecoverySchemaEntry } from '../worker/recoveryValidation';
import { validateMigrationCatalog } from './migration-policy.mjs';

const NOW = 1_800_000_000_000;
const PASSWORD = 'synthetic disaster recovery original password';
const NEW_PASSWORD = 'synthetic disaster recovery changed password';
const ORIGIN = 'https://synthetic-recovery.example.test';
const CLASS_A = 'synthetic-class-a';
const CLASS_B = 'synthetic-class-b';
const CLASS_C = 'synthetic-empty-retired-class';

// This is a fixed synthetic rehearsal, never a general database import tool.
// No config, binding, URL, credentials, SQL file or target can be supplied.
const syntheticData = (suffix = ''): AppData => ({
  lastOpened: NOW, currentClassId: CLASS_A,
  classes: [{
    id: CLASS_A, name: `Synthetic A${suffix}`,
    students: [{ id: '100', name: `Synthetic Alice${suffix}`, points: 23, rankPoints: 7,
      warningPoints: 0, pet: { type: 'cat', fullness: 80, happiness: 75, level: 3 } },
    { id: '101', name: `Synthetic Charlie${suffix}`, points: 41, rankPoints: 9,
      warningPoints: 0, pet: { type: 'dog', fullness: 60, happiness: 85, level: 4 } }],
    learningEvidenceRecords: [{ id: 'synthetic-evidence-a', classId: CLASS_A, studentId: '100', competency: 'collaboration',
      level: 'mastered', evidenceType: 'observation', title: 'Synthetic evidence',
      note: 'Synthetic Alice evidence', actor: 'mentor', source: 'manual', rubricVersion: '1.0', revision: 1, createdAt: NOW }],
    examRecords: [{ id: 'synthetic-exam', title: 'Synthetic exam', examDate: '2026-10-01',
      items: [{ id: 'math', name: 'Synthetic mathematics', maxScore: 100 }],
      results: [{ studentId: '100', scores: { math: 88 }, mentorComment: 'Synthetic Alice result', updatedAt: NOW }],
      createdAt: NOW, updatedAt: NOW }],
  }, {
    id: CLASS_B, name: `Synthetic B${suffix}`,
    students: [{ id: '100', name: `Synthetic Bob${suffix}`, points: 59, rankPoints: 11,
      warningPoints: 0, pet: { type: 'cat', fullness: 90, happiness: 65, level: 5 } }],
    learningEvidenceRecords: [{ id: 'synthetic-evidence-b', classId: CLASS_B, studentId: '100', competency: 'collaboration',
      level: 'mastered', evidenceType: 'observation', title: 'Synthetic Bob evidence',
      note: 'Synthetic Bob remains unchanged', actor: 'mentor', source: 'manual', rubricVersion: '1.0', revision: 1, createdAt: NOW }],
  }, { id: CLASS_C, name: 'Synthetic empty archived class', students: [],
    examRecords: [{ id: 'synthetic-empty-exam', title: 'Synthetic empty class history', examDate: '2026-09-01',
      items: [], results: [], createdAt: NOW, updatedAt: NOW }] }],
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const RECOVERY_SQL_STATEMENT_LIMIT_BYTES = 100_000;

// D1's row/bound-value limit and SQL text limit are different. A valid 900 KiB
// workspace can export as one oversized INSERT: never start a partial import.
export const planSyntheticSqlImport = (sql: string) => {
  if (!sql.trim()) throw new Error('RECOVERY_SQL_EMPTY');
  const statements = splitSqlQuery(sql);
  if (!statements.length) throw new Error('RECOVERY_SQL_EMPTY');
  const maxStatementBytes = statements.reduce((maximum, statement) => Math.max(maximum, Buffer.byteLength(statement)), 0);
  if (maxStatementBytes > RECOVERY_SQL_STATEMENT_LIMIT_BYTES) {
    throw new Error('RECOVERY_SQL_STATEMENT_TOO_LARGE');
  }
  return { statements, maxStatementBytes };
};

const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
    : JSON.stringify(value);

const databaseManifest = async (database: D1Database) => {
  const schema = (await database.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_schema
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
     ORDER BY type, name`,
  ).all<{ type: string; name: string; tbl_name: string; sql: string }>()).results;
  const tables = [] as Array<{ name: string; count: number; checksum: string }>;
  for (const table of schema.filter((row) => row.type === 'table')) {
    const identifier = `"${table.name.replaceAll('"', '""')}"`;
    const rows = (await database.prepare(`SELECT * FROM ${identifier}`).all()).results.map(canonical).sort();
    tables.push({ name: table.name, count: rows.length, checksum: sha256(rows.join('\n')) });
  }
  return { schema, tables };
};

const applySyntheticBootstrap = async (database: D1Database) => {
  const names = (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort();
  const files = new Map(await Promise.all(names.map(async (name) => [name, await readFile(`migrations/${name}`, 'utf8')] as const)));
  const catalog = validateMigrationCatalog({ policy: JSON.parse(await readFile('migrations/policy.json', 'utf8')), files });
  // Match Wrangler's ledger format, only in this newly created empty fixture.
  await database.prepare(`CREATE TABLE d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`).run();
  for (const migration of catalog) {
    await database.batch([
      ...splitSqlQuery(migration.sql).map((sql) => database.prepare(sql)),
      database.prepare('INSERT INTO d1_migrations(name) VALUES (?)').bind(migration.name),
    ]);
  }
  return names;
};

type SyntheticSuppression =
  | { kind: 'delete-student'; classId: string; studentId: string }
  | { kind: 'anonymize-student'; classId: string; studentId: string; replacementId: string }
  | { kind: 'delete-class'; classId: string };

const replaySyntheticSuppressions = async (
  repository: D1WorkspaceRepository, workspaceId: string, journal: readonly SyntheticSuppression[],
) => {
  for (const entry of journal) {
    const current = await repository.get(workspaceId);
    assert.ok(current.data);
    const classroom = current.data.classes.find((item) => item.id === entry.classId);
    if (!classroom) continue;
    let data: AppData;
    if (entry.kind === 'delete-class') data = deleteClassFromWorkspace(current.data, entry.classId);
    else {
      if (!classroom.students.some((item) => item.id === entry.studentId)) continue;
      const identity = { classId: entry.classId, studentId: entry.studentId };
      data = entry.kind === 'delete-student'
        ? purgeStudentsFromWorkspaceData(current.data, [identity])
        : anonymizeStudentInWorkspaceData(current.data, identity, entry.replacementId);
    }
    await repository.put(workspaceId, data, current.revision, {
      action: entry.kind === 'delete-class' ? 'class.privacy.delete' : 'student.privacy.delete',
    });
  }
};

export type SyntheticRecoveryBackup = {
  sql: string;
  expectedMigrations: readonly string[];
  expectedSchema: readonly D1RecoverySchemaEntry[];
};

export const runSyntheticD1RecoveryDrill = async (
  onSyntheticBackup?: (backup: SyntheticRecoveryBackup) => void | Promise<void>,
) => {
  const started = performance.now();
  const miniflare = new Miniflare({
    modules: true, compatibilityDate: '2026-07-29',
    d1Databases: { SOURCE: crypto.randomUUID(), RESTORED: crypto.randomUUID() },
    script: 'export default { fetch() { return new Response("local synthetic recovery only"); } }',
    outboundService: () => { throw new Error('Synthetic recovery prohibits outbound network access'); },
  });
  try {
    const source = await miniflare.getD1Database('SOURCE') as unknown as D1Database;
    const restored = await miniflare.getD1Database('RESTORED') as unknown as D1Database;
    const migrationNames = await applySyntheticBootstrap(source);
    const expectedSchema = (await databaseManifest(source)).schema
      .filter((entry) => entry.name !== 'd1_migrations')
      .map(({ type, name, sql }) => ({ type, name, sql } as D1RecoverySchemaEntry));
    const repository = new D1WorkspaceRepository(source, { readMode: 'blob' });
    const auth = new AuthService(repository, { passwordIterations: 10 });
    const owner = await auth.register({ email: 'synthetic-owner-recovery@example.test', password: PASSWORD,
      displayName: 'Synthetic Owner', workspaceName: 'Synthetic source', initialWorkspaceData: syntheticData() });
    const workspaceId = owner.session.activeWorkspaceId!;
    const other = await auth.register({ email: 'synthetic-other-recovery@example.test', password: PASSWORD,
      displayName: 'Synthetic Other Owner', workspaceName: 'Synthetic other tenant', initialWorkspaceData: syntheticData(' other') });
    const otherId = other.session.activeWorkspaceId!;
    // Exercise populated optional expansion data, not merely an empty table.
    // These two first-party account states never enter the returned report.
    const cohortStart = Date.now() - 60_000;
    for (const userId of [owner.session.user.id, other.session.user.id]) {
      assert.ok(await repository.enrollProductOnboarding({ userId, cohortStart, now: Date.now() }));
      await repository.updateProductOnboarding(userId, 'started');
    }
    await repository.updateProductOnboarding(owner.session.user.id, 'local_completed');
    await repository.confirmProductOnboarding(owner.session.user.id);
    const ownerOnboardingAtBackup = await repository.getProductOnboarding(owner.session.user.id);
    const otherOnboardingAtBackup = await repository.getProductOnboarding(other.session.user.id);
    assert.equal(ownerOnboardingAtBackup?.backendPersisted, true);
    assert.equal(otherOnboardingAtBackup?.backendPersisted, false);
    const delivery = await auth.createWorkspaceInvitation(owner.sessionToken, workspaceId,
      'synthetic-teacher-recovery@example.test', 'teacher', [CLASS_A, CLASS_B]);
    const teacher = await auth.acceptWorkspaceInvitation(delivery.token, 'Synthetic Teacher', PASSWORD);
    const resetBeforeBackup = await auth.requestPasswordReset('synthetic-teacher-recovery@example.test');
    assert.ok(resetBeforeBackup);
    const unusedInvitation = await auth.createWorkspaceInvitation(owner.sessionToken, workspaceId,
      'synthetic-unused-recovery@example.test', 'viewer', [CLASS_A]);
    let state = await repository.get(workspaceId);
    assert.ok(state.data);
    state = await repository.put(workspaceId,
      updateClassArchive(state.data, CLASS_C, 'archive', NOW), state.revision);
    assert.ok(state.data);
    state = await repository.put(workspaceId,
      updateClassArchive(state.data, CLASS_A, 'archive', NOW), state.revision);
    const stateAtBackup = structuredClone(state);
    const otherAtBackup = await repository.get(otherId);
    const bobAtBackup = state.data!.classes.find((item) => item.id === CLASS_B)!;
    const manifest = await databaseManifest(source);
    const raw = await source.prepare('PRAGMA miniflare_d1_export(?,?,?);').bind(false, false).raw<string[]>();
    assert.equal(raw.length, 1);
    const backupSql = raw[0].join('\n');
    assert.ok(backupSql.length > 0);
    const importPlan = planSyntheticSqlImport(backupSql);
    // Optional fixture export for a separately approved non-production drill.
    // The callback only receives fixed synthetic data, never a database handle;
    // do not let it mutate the trusted schema used by the remaining checks.
    if (onSyntheticBackup) await onSyntheticBackup(structuredClone({
      sql: backupSql, expectedMigrations: migrationNames, expectedSchema,
    }));

    // These decisions live outside the backup/restore failure domain. The
    // in-memory synthetic journal is not a durable operational case register.
    const journal: readonly SyntheticSuppression[] = [
      { kind: 'delete-student', classId: CLASS_A, studentId: '100' },
      { kind: 'anonymize-student', classId: CLASS_A, studentId: '101', replacementId: 'anon-synthetic-dr' },
      { kind: 'delete-class', classId: CLASS_C },
    ];
    await replaySyntheticSuppressions(repository, workspaceId, journal);
    await auth.updateWorkspaceMember(owner.sessionToken, workspaceId, teacher.session.user.id, 'teacher', [CLASS_A]);
    const currentReset = await auth.requestPasswordReset('synthetic-teacher-recovery@example.test');
    assert.ok(currentReset);
    await auth.resetPassword(currentReset.token, NEW_PASSWORD);
    const expectedTeacher = await repository.getUserById(teacher.session.user.id);
    assert.ok(expectedTeacher);

    const empty = await restored.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").first<{ count: number }>();
    assert.equal(empty?.count, 0, 'Import target must be a newly created empty synthetic database');
    // This is the same local SQL export mechanism used by pinned Wrangler,
    // not the hosted Time Travel service. Do not replay migrations on the dump.
    await restored.batch(importPlan.statements.map((sql) => restored.prepare(sql)));
    assert.deepEqual(await databaseManifest(restored), manifest, 'all application schema/rows/ledger must round-trip exactly');
    const restoredRepository = new D1WorkspaceRepository(restored, { readMode: 'blob' });
    const restoredAuth = new AuthService(restoredRepository, { passwordIterations: 10 });
    assert.deepEqual(await restoredRepository.getProductOnboarding(owner.session.user.id), ownerOnboardingAtBackup);
    assert.deepEqual(await restoredRepository.getProductOnboarding(other.session.user.id), otherOnboardingAtBackup);
    const structural = await validateD1Recovery(restored, { expectedMigrations: migrationNames, expectedSchema });
    assert.equal(structural.status, 'structurally_valid', JSON.stringify(structural));
    assert.equal(structural.privacyStatus, 'not_verified', 'structural validity is not deletion-policy clearance');
    const beforeInspection = await databaseManifest(restored);
    assert.equal((await restoredRepository.inspectWorkspaceProjection(workspaceId)).status, 'verified');
    assert.deepEqual(await databaseManifest(restored), beforeInspection, 'inspection must not write cached status');
    assert.deepEqual(await restoredRepository.get(workspaceId), stateAtBackup);

    // Demonstrate why an otherwise perfect restore must remain quarantined:
    // it resurrects data, access and old credentials that were valid at backup.
    assert.equal((await restoredAuth.getSession(teacher.sessionToken)).user.id, teacher.session.user.id);
    assert.deepEqual(await restoredRepository.listWorkspaceClassIds(workspaceId, teacher.session.user.id), [CLASS_A, CLASS_B]);
    const staleTeacher = await restoredRepository.getUserById(teacher.session.user.id);
    assert.ok(staleTeacher);
    assert.equal(await verifyPassword(PASSWORD, staleTeacher.password), true);

    await replaySyntheticSuppressions(restoredRepository, workspaceId, journal);
    const afterReplay = await restoredRepository.get(workspaceId);
    await replaySyntheticSuppressions(restoredRepository, workspaceId, journal);
    assert.deepEqual(await restoredRepository.get(workspaceId), afterReplay, 'replaying the same completed suppressions is idempotent');
    assert.ok(afterReplay.data);
    assert.deepEqual(afterReplay.data.classes.find((item) => item.id === CLASS_B), bobAtBackup);
    assert.equal(afterReplay.data.classes.find((item) => item.id === CLASS_A)?.archivedAt, NOW);
    assert.equal(afterReplay.data.classes.find((item) => item.id === CLASS_C), undefined);
    const anonymous = afterReplay.data.classes.find((item) => item.id === CLASS_A)?.students.find((item) => item.id === 'anon-synthetic-dr');
    assert.equal(anonymous?.points, 41);
    assert.equal(anonymous?.name, 'Anonymous student');
    for (const snapshot of (await restored.prepare('SELECT data_json FROM workspace_revisions WHERE workspace_id = ?').bind(workspaceId).all<{ data_json: string }>()).results) {
      const data = JSON.parse(snapshot.data_json) as AppData;
      assert.equal(data.classes.find((item) => item.id === CLASS_C), undefined);
      assert.equal(data.classes.find((item) => item.id === CLASS_A)?.students.some((item) => item.id === '100' || item.id === '101'), false);
      assert.deepEqual(data.classes.find((item) => item.id === CLASS_B), bobAtBackup);
    }
    assert.deepEqual(await restoredRepository.get(otherId), otherAtBackup, 'same class/student IDs in another tenant are untouched');
    assert.deepEqual(await restoredRepository.getProductOnboarding(owner.session.user.id), ownerOnboardingAtBackup,
      'student privacy suppression must not modify the account onboarding identity');
    assert.deepEqual(await restoredRepository.getProductOnboarding(other.session.user.id), otherOnboardingAtBackup,
      'student privacy suppression must not modify another account onboarding state');

    // Recovery security decisions must be replayed too. This SQL only runs
    // against the freshly created in-process synthetic RESTORED binding.
    await restored.batch([
      restored.prepare('UPDATE users SET password_algorithm=?, password_salt=?, password_hash=?, password_iterations=?, password_changed_at=? WHERE user_id=?')
        .bind(expectedTeacher.password.algorithm, expectedTeacher.password.salt, expectedTeacher.password.hash,
          expectedTeacher.password.iterations, expectedTeacher.passwordChangedAt, teacher.session.user.id),
      restored.prepare('UPDATE auth_sessions SET revoked_at=? WHERE revoked_at IS NULL').bind(Date.now()),
      restored.prepare('UPDATE password_reset_tokens SET used_at=? WHERE used_at IS NULL').bind(Date.now()),
      restored.prepare('UPDATE email_verification_tokens SET used_at=? WHERE used_at IS NULL').bind(Date.now()),
      restored.prepare('UPDATE workspace_invitations SET revoked_at=? WHERE accepted_at IS NULL AND revoked_at IS NULL').bind(Date.now()),
      restored.prepare('DELETE FROM workspace_class_assignments WHERE workspace_id=? AND user_id=? AND class_id=?')
        .bind(workspaceId, teacher.session.user.id, CLASS_B),
    ]);
    await assert.rejects(restoredAuth.getSession(teacher.sessionToken), InvalidSessionError);
    const currentTeacher = await restoredRepository.getUserById(teacher.session.user.id);
    assert.ok(currentTeacher);
    assert.equal(await verifyPassword(PASSWORD, currentTeacher.password), false);
    assert.equal(await verifyPassword(NEW_PASSWORD, currentTeacher.password), true);
    await assert.rejects(restoredAuth.resetPassword(resetBeforeBackup.token, NEW_PASSWORD));
    await assert.rejects(restoredAuth.acceptWorkspaceInvitation(unusedInvitation.token, 'Synthetic unused', PASSWORD));
    const freshTeacher = await restoredAuth.login({ email: 'synthetic-teacher-recovery@example.test', password: NEW_PASSWORD });
    const handler = createApiHandler(restoredRepository, { auth: { passwordIterations: 10 } });
    const csrf = createCsrfToken();
    const scopedRequest = (target: string) => handler(new Request(`${ORIGIN}/api/v1/state`, { headers: {
      origin: ORIGIN, 'x-epet-workspace': target,
      cookie: `__Host-epet_session=${freshTeacher.sessionToken}; __Host-epet_csrf=${csrf}`,
    } }));
    const scoped = await scopedRequest(workspaceId);
    assert.equal(scoped.status, 200);
    assert.deepEqual((await scoped.json() as { data: AppData }).data.classes.map((item) => item.id), [CLASS_A]);
    assert.equal((await scopedRequest(otherId)).status, 403);

    const revision = await restoredRepository.get(workspaceId);
    assert.ok(revision.data);
    const requests = await Promise.allSettled([
      restoredRepository.put(workspaceId, { ...revision.data, lastOpened: NOW + 1 }, revision.revision),
      new D1WorkspaceRepository(restored, { readMode: 'blob' }).put(workspaceId,
        { ...revision.data, lastOpened: NOW + 2 }, revision.revision),
    ]);
    assert.equal(requests.filter((item) => item.status === 'fulfilled').length, 1);
    const lost = requests.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    assert.ok(lost.reason instanceof WorkspaceConflictError);
    assert.deepEqual(await restoredRepository.get(otherId), otherAtBackup);
    const finalStructural = await validateD1Recovery(restored, { expectedMigrations: migrationNames, expectedSchema });
    assert.equal(finalStructural.status, 'structurally_valid', JSON.stringify(finalStructural));
    assert.equal(finalStructural.privacyStatus, 'not_verified');
    return {
      mode: 'local_synthetic' as const,
      backupBytes: Buffer.byteLength(backupSql), backupSha256: sha256(backupSql),
      maxSqlStatementBytes: importPlan.maxStatementBytes,
      tables: manifest.tables.length, migrationCount: migrationNames.length,
      checks: { exactSqlRoundTrip: true, readOnlyInspection: true, privacyReplayIdempotent: true,
        compositeIdentityPreserved: true, retainedHistoryScrubbed: true, archivePreserved: true,
        onboardingProgressRoundTrip: true, onboardingUnaffectedByStudentPrivacyReplay: true,
        oldCredentialsAndTokensDenied: true, scopeAndTenantIsolation: true, revisionCas: true },
      structural: finalStructural,
      localElapsedMs: Math.round(performance.now() - started),
      platformTimeTravel: 'not_executed' as const, rpo: 'not_measured' as const, rto: 'not_measured' as const,
    };
  } finally { await miniflare.dispose(); }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Local synthetic recovery accepts no arguments, files, remote configuration or database targets.');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await runSyntheticD1RecoveryDrill(), null, 2)); }
    catch { console.error('Local synthetic recovery failed; keep recovery quarantined and inspect synthetic test diagnostics.'); process.exitCode = 1; }
  }
}
