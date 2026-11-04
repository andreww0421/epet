import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { AuthService, type AuthSessionEnvelope } from '../server/auth';
import { createApiHandler } from '../server/api';
import { WorkspaceConflictError, type StoredWorkspace } from '../server/contracts';
import { createCsrfToken } from '../server/middleware/csrf';
import { JsonWorkspaceRepository } from '../server/repository';
import type { AppData, ClassData } from '../src/store/types';
import { normalizeAppData } from '../src/store/utils';
import { D1WorkspaceRepository } from '../worker/repository';

// Synthetic people and records only. Student IDs are intentionally class-local.
const NOW = Date.parse('2026-10-19T01:00:00Z');
const ORIGIN = 'https://epet.example.test';
const CLASS_A = 'class-a';
const CLASS_B = 'class-b';
const STUDENT_ID = '100';
const PASSWORD = 'synthetic H02 privacy fixture password';
type Adapter = 'node' | 'd1';
type Repository = JsonWorkspaceRepository | D1WorkspaceRepository;
type Client = AuthSessionEnvelope & { csrf: string };

const createData = (): AppData => JSON.parse(JSON.stringify(normalizeAppData({
  lastOpened: NOW, currentClassId: CLASS_A,
  classes: [CLASS_A, CLASS_B].map((classId, index) => {
    const name = index === 0 ? 'Alice' : 'Bob';
    return {
      id: classId, name: `Synthetic Class ${index === 0 ? 'A' : 'B'}`,
      students: [{ id: STUDENT_ID, name, points: 210 + index * 100, rankPoints: 20 + index,
        pet: { type: index === 0 ? 'dog' : 'cat', level: index + 2, fullness: 80, happiness: 70 },
        stats: { wins: index + 1, losses: 1 },
        pointAdjustmentRecords: [{ id: `${name}-points`, amount: 10 + index, source: 'manual',
          reasonLabel: `${name} synthetic feedback`, createdAt: NOW - 1 }],
        disciplineRecords: [{ id: `${name}-discipline`, type: 'warning', createdAt: NOW - 2,
          reason: `${name} synthetic discipline` }],
        dailyProgress: { streak: 2, lastClaimDate: '2026-10-18', reflections: [{
          id: `${name}-reflection`, competency: 'growth', author: 'mentor',
          mentorAssessment: 'progressing', date: '2026-10-18', createdAt: NOW - 3,
          text: `${name} synthetic reflection` }] },
        economyEventRecords: [{ id: `${name}-economy`, kind: 'spend', source: 'feed',
          amount: 10 + index, createdAt: NOW - 4 }],
        bossRewardRecords: [{ id: `${name}-reward`, bossId: `${name}-prior-boss`,
          bossName: `${name} synthetic prior boss`, createdAt: NOW - 8,
          rank: 1, damage: 10 + index, attackCount: 1, fairScore: 10 + index,
          previousDamage: 0, previousFairScore: 0, improvementAmount: 10 + index,
          fairImprovementAmount: 10 + index, rewardPoints: 3, rewardRankPoints: 1,
          rewardHappiness: 1, rankRewardPoints: 1, rankRewardRankPoints: 1,
          rankRewardHappiness: 1, participationRewardPoints: 1,
          participationRewardRankPoints: 0, participationRewardHappiness: 0,
          improvementRewardPoints: 1, improvementRewardRankPoints: 0,
          improvementRewardHappiness: 0, receivedImprovementReward: true }],
      }],
      learningEvidenceRecords: [{ id: `${name}-evidence`, classId, studentId: STUDENT_ID,
        competency: 'growth', level: 'progressing', evidenceType: 'observation',
        title: `${name} synthetic observation`, note: `${name} synthetic learning note`,
        actor: 'mentor', source: 'manual', rubricVersion: '1.0', revision: 1, createdAt: NOW - 5 }],
      examRecords: [{ id: `${name}-exam`, title: `${name} synthetic assessment`, examDate: '2026-10-18',
        items: [{ id: 'math', name: 'Math', maxScore: 100 }],
        results: [{ studentId: STUDENT_ID, scores: { math: 81 + index * 10 },
          mentorComment: `${name} synthetic exam comment`, updatedAt: NOW - 6 }],
        createdAt: NOW - 7, updatedAt: NOW - 6 }],
      activeBoss: { id: `${name}-boss`, name: `${name} synthetic boss`, maxHp: 100, currentHp: 60,
        isActive: true, contributions: { [STUDENT_ID]: 10 + index * 10 },
        attackCounts: { [STUDENT_ID]: 1 + index }, rewardTiers: [] },
    };
  }),
}, NOW)));

const migrationPaths = [
  '0001_create_workspaces.sql', '0002_auth_rbac.sql', '0003_core_entities.sql',
  '0004_workspace_class_assignments.sql', '0005_workspace_invitations.sql',
  '0006_projection_read_model.sql', '0007_email_verification.sql',
];
const applyMigrations = async (database: D1Database) => {
  for (const file of migrationPaths) {
    let lines: string[] = [];
    let insideTrigger = false;
    for (const raw of (await readFile(join('migrations', file), 'utf8')).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('--')) continue;
      if (/^CREATE\s+TRIGGER\b/i.test(line)) insideTrigger = true;
      lines.push(raw);
      if (insideTrigger ? /^END;$/i.test(line) : line.endsWith(';')) {
        await database.prepare(lines.join('\n')).run();
        lines = [];
        insideTrigger = false;
      }
    }
    assert.equal(lines.length, 0, `incomplete migration: ${file}`);
  }
};

const createFixture = async (adapter: Adapter) => {
  let database: D1Database | undefined;
  let filePath: string | undefined;
  let dispose: (() => Promise<void>) | undefined;
  let repository: Repository;
  try {
    if (adapter === 'd1') {
      const miniflare = new Miniflare({ modules: true, d1Databases: ['DB'],
        script: 'export default { fetch() { return new Response("synthetic privacy fixture"); } }' });
      database = await miniflare.getD1Database('DB') as unknown as D1Database;
      dispose = () => miniflare.dispose();
      await applyMigrations(database);
      repository = new D1WorkspaceRepository(database, { readMode: 'normalized' });
    } else {
      const directory = await mkdtemp(join(tmpdir(), 'epet-H02-'));
      filePath = join(directory, 'data.json');
      repository = new JsonWorkspaceRepository(filePath);
      dispose = () => rm(directory, { recursive: true, force: true });
    }
    const auth = new AuthService(repository, { passwordIterations: 10 });
    const withCsrf = (session: AuthSessionEnvelope): Client => ({ ...session, csrf: createCsrfToken() });
    const owner = withCsrf(await auth.register({ email: 'h02-owner@example.test', password: PASSWORD,
      displayName: 'Synthetic Owner', workspaceName: 'Synthetic H02 Workspace', initialWorkspaceData: createData() }));
    const workspaceId = owner.session.activeWorkspaceId!;
    const invitation = await auth.createWorkspaceInvitation(owner.sessionToken, workspaceId,
      'h02-teacher@example.test', 'teacher', [CLASS_A]);
    const teacher = withCsrf(await auth.acceptWorkspaceInvitation(invitation.token, 'Synthetic Teacher', PASSWORD));
    const otherOwner = withCsrf(await auth.register({ email: 'h02-other@example.test', password: PASSWORD,
      displayName: 'Synthetic Other Owner', workspaceName: 'Synthetic Other Workspace', initialWorkspaceData: createData() }));
    const otherWorkspaceId = otherOwner.session.activeWorkspaceId!;
    const handler = createApiHandler(repository, { auth: { passwordIterations: 10 } });
    const request = (path: string, method = 'GET', body?: unknown, who = owner,
      workspace = workspaceId, validCsrf = true) => handler(new Request(`${ORIGIN}/api/v1${path}`, {
      method, headers: { origin: ORIGIN, 'content-type': 'application/json',
        'x-epet-workspace': workspace,
        cookie: `__Host-epet_session=${who.sessionToken}; __Host-epet_csrf=${who.csrf}`,
        ...(validCsrf ? { 'x-csrf-token': who.csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const reload = () => database
      ? new D1WorkspaceRepository(database, { readMode: 'normalized' })
      : new JsonWorkspaceRepository(filePath!);
    return { repository, database, filePath, owner, teacher, workspaceId, otherWorkspaceId, request, reload, dispose };
  } catch (error) { await dispose?.(); throw error; }
};
type Fixture = Awaited<ReturnType<typeof createFixture>>;
const classroom = (data: AppData | null, classId: string): ClassData => {
  const found = data?.classes.find((item) => item.id === classId);
  assert.ok(found, `expected class ${classId}`);
  return found;
};
const studentPath = (classId: string, action: string) =>
  `/classes/${encodeURIComponent(classId)}/students/${STUDENT_ID}/privacy/${action}`;
const bodyFor = (action: 'delete' | 'anonymize', expectedRevision: number) => ({ expectedRevision,
  confirmation: action === 'delete' ? 'DELETE STUDENT' : 'ANONYMIZE STUDENT' });
const decode = async (response: Response, status = 200): Promise<any> => {
  const body = await response.text();
  assert.equal(response.status, status, body);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return JSON.parse(body);
};
const stripExportTime = (value: any) => ({ class: value.class, student: value.student,
  learningEvidenceRecords: value.learningEvidenceRecords, examRecords: value.examRecords,
  activeBossParticipation: value.activeBossParticipation });
const exportBob = async (f: Fixture) => stripExportTime(await decode(await f.request(studentPath(CLASS_B, 'export'))));
const assertAliceErased = (data: AppData) => {
  const a = data.classes.find((item) => item.id === CLASS_A);
  if (!a) return;
  assert.ok(a.students.every((student) => student.id !== STUDENT_ID));
  assert.ok((a.learningEvidenceRecords ?? []).every((record) => record.studentId !== STUDENT_ID));
  assert.ok((a.examRecords ?? []).every((exam) => exam.results.every((result) => result.studentId !== STUDENT_ID)));
  assert.equal(a.activeBoss?.contributions[STUDENT_ID], undefined);
  assert.equal(a.activeBoss?.attackCounts?.[STUDENT_ID], undefined);
  assert.ok(a.students.every((student) => student.name !== 'Alice'));
};

const readBobProjection = async (f: Fixture) => {
  if (!f.database) return undefined;
  const result: Record<string, unknown[]> = {};
  for (const table of ['students', 'exam_records', 'exam_results', 'learning_evidence',
    'point_adjustments', 'discipline_records', 'boss_rewards']) {
    const rows = await f.database.prepare(
      `SELECT record_json FROM ${table} WHERE workspace_id = ? AND class_id = ? ORDER BY record_json`,
    ).bind(f.workspaceId, CLASS_B).all<{ record_json: string }>();
    result[table] = rows.results.map((row) => JSON.parse(row.record_json));
  }
  return result;
};
const assertPersistedPrivacy = async (f: Fixture, bob: ClassData, other: StoredWorkspace,
  projectionBefore: Awaited<ReturnType<typeof readBobProjection>>) => {
  const reloaded = await f.reload().get(f.workspaceId);
  assert.ok(reloaded.data);
  assertAliceErased(reloaded.data);
  assert.deepEqual(classroom(reloaded.data, CLASS_B), bob);
  assert.deepEqual(await f.reload().get(f.otherWorkspaceId), other, 'another workspace must remain byte-equivalent');
  for (const revision of await f.repository.listWorkspaceRevisions(f.workspaceId)) {
    const retained = await f.repository.getWorkspaceRevision(f.workspaceId, revision.revision);
    assert.ok(retained);
    assertAliceErased(retained.data);
    // JSON snapshots omit undefined optional fields; compare their persisted representation.
    assert.deepEqual(JSON.parse(JSON.stringify(classroom(retained.data, CLASS_B))), bob,
      `Bob changed in retained revision ${revision.revision}`);
  }
  assert.deepEqual(await readBobProjection(f), projectionBefore, 'normalized Bob records must remain unchanged');
  if (f.database) {
    assert.equal((await (f.repository as D1WorkspaceRepository)
      .reconcileWorkspaceProjection(f.workspaceId, false)).status, 'verified');
    const row = await f.database.prepare('SELECT data_json FROM workspaces WHERE workspace_id = ?')
      .bind(f.workspaceId).first<{ data_json: string }>();
    assert.ok(row);
    assertAliceErased(JSON.parse(row.data_json));
    const retained = await f.database.prepare('SELECT data_json FROM workspace_revisions WHERE workspace_id = ?')
      .bind(f.workspaceId).all<{ data_json: string }>();
    for (const snapshot of retained.results) assertAliceErased(JSON.parse(snapshot.data_json));
    const leakedRows = await f.database.prepare(
      'SELECT student_id FROM students WHERE workspace_id = ? AND class_id = ? AND student_id = ?',
    ).bind(f.workspaceId, CLASS_A, STUDENT_ID).all();
    assert.equal(leakedRows.results.length, 0);
  }
};

const removeAlice = (data: AppData): AppData => {
  const next = structuredClone(data);
  const a = classroom(next, CLASS_A);
  a.students = [];
  a.learningEvidenceRecords = [];
  a.examRecords = (a.examRecords ?? []).map((exam) => ({ ...exam, results: [] }));
  if (a.activeBoss) { a.activeBoss.contributions = {}; a.activeBoss.attackCounts = {}; }
  return next;
};

for (const adapter of ['node', 'd1'] as const) {
  for (const action of ['delete', 'anonymize'] as const) {
    test(`${adapter}: ${action} Alice is class-scoped in API, history, restore, audit, export, projections and reload`, async () => {
      const f = await createFixture(adapter);
      try {
        const before = await f.repository.get(f.workspaceId);
        const bob = structuredClone(classroom(before.data, CLASS_B));
        const other = await f.repository.get(f.otherWorkspaceId);
        const projection = await readBobProjection(f);
        const bobExport = await exportBob(f);
        await decode(await f.request(studentPath(CLASS_A, 'export')));
        await f.repository.appendAuditEvent({ id: 'h02-ambiguous-legacy-target', workspaceId: f.workspaceId,
          targetType: 'student', targetId: STUDENT_ID, action: 'fixture.legacy.export', createdAt: NOW });
        // Keep more than the initial revision, proving every retained snapshot is scrubbed.
        const saved = await f.repository.put(f.workspaceId, before.data!, before.revision,
          { action: 'fixture.history', requestId: crypto.randomUUID() });
        const response = await decode(await f.request(studentPath(CLASS_A, action), 'POST', bodyFor(action, saved.revision)));
        assert.equal(response.action, action);
        assert.equal(response.revision, saved.revision + 1);
        assert.deepEqual(classroom(response.data, CLASS_B), bob);
        assertAliceErased(response.data);
        const a = classroom(response.data, CLASS_A);
        if (action === 'anonymize') {
          assert.equal(a.students.length, 1);
          assert.equal(a.students[0].name, 'Anonymous student');
          assert.equal(a.students[0].points, 210);
          assert.equal(a.students[0].pet.type, 'dog');
        } else assert.equal(a.students.length, 0);
        assert.deepEqual(await exportBob(f), bobExport);
        const audit = await f.repository.listWorkspaceAuditEvents(f.workspaceId, { limit: 100 });
        const exports = audit.filter((event) => event.action === 'student.privacy.export');
        assert.equal(exports.find((event) => event.metadata?.classId === CLASS_A)?.targetId, undefined);
        assert.ok(exports.filter((event) => event.metadata?.classId === CLASS_B)
          .every((event) => event.targetId === STUDENT_ID), 'Bob audit targets must not be scrubbed');
        assert.equal(audit.find((event) => event.id === 'h02-ambiguous-legacy-target')?.targetId, STUDENT_ID,
          'ambiguous legacy targets cannot be attributed to Alice by student ID alone');
        await assertPersistedPrivacy(f, bob, other, projection);
        const oldest = Math.min(...(await f.repository.listWorkspaceRevisions(f.workspaceId)).map((row) => row.revision));
        const restored = await decode(await f.request(`/revisions/${oldest}/restore`, 'POST', {}));
        assert.equal(restored.restoredFromRevision, oldest);
        assertAliceErased(restored.data);
        assert.deepEqual(classroom(restored.data, CLASS_B), bob);
        assert.deepEqual(await exportBob(f), bobExport);
        await assertPersistedPrivacy(f, bob, other, projection);
        await decode(await f.request(studentPath(CLASS_A, 'export')), 404);
      } finally { await f.dispose(); }
    });
  }

  test(`${adapter}: normal state writes detect removal of the tuple even while Bob keeps ID 100`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      const bob = structuredClone(classroom(before.data, CLASS_B));
      const other = await f.repository.get(f.otherWorkspaceId);
      const projection = await readBobProjection(f);
      const result = await decode(await f.request('/state', 'PUT', {
        baseRevision: before.revision, data: removeAlice(before.data!),
      }));
      assertAliceErased(result.data);
      await assertPersistedPrivacy(f, bob, other, projection);
      const restore = await decode(await f.request(`/revisions/${before.revision}/restore`, 'POST', {}));
      assertAliceErased(restore.data);
      await assertPersistedPrivacy(f, bob, other, projection);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: imports preserve existing class-local collisions and purge only omitted Alice history`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      const bob = structuredClone(classroom(before.data, CLASS_B));
      const other = await f.repository.get(f.otherWorkspaceId);
      const projection = await readBobProjection(f);
      const imported = await decode(await f.request('/workspace/import', 'POST', {
        data: before.data, expectedRevision: before.revision,
        confirmation: 'IMPORT WORKSPACE', acknowledgeReplacement: true,
      }));
      assert.equal(classroom(imported.data, CLASS_A).students[0].name, 'Alice');
      assert.equal(classroom(imported.data, CLASS_B).students[0].name, 'Bob');
      assert.equal(classroom(imported.data, CLASS_A).students[0].id, STUDENT_ID);
      assert.equal(classroom(imported.data, CLASS_B).students[0].id, STUDENT_ID);
      await decode(await f.request('/workspace/import', 'POST', {
        data: removeAlice(imported.data), expectedRevision: imported.revision,
        confirmation: 'IMPORT WORKSPACE', acknowledgeReplacement: true,
      }));
      await assertPersistedPrivacy(f, bob, other, projection);
      const restored = await decode(await f.request(`/revisions/${before.revision}/restore`, 'POST', {}));
      assertAliceErased(restored.data);
      await assertPersistedPrivacy(f, bob, other, projection);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: class archive/reopen preserves collisions and deleting Class A preserves Bob`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      const bob = structuredClone(classroom(before.data, CLASS_B));
      const other = await f.repository.get(f.otherWorkspaceId);
      const projection = await readBobProjection(f);
      let revision = before.revision;
      for (const [action, confirmation] of [['archive', 'ARCHIVE CLASS'], ['reopen', 'REOPEN CLASS']] as const) {
        const result = await decode(await f.request(`/classes/${CLASS_A}/privacy/${action}`, 'POST',
          { confirmation, expectedRevision: revision }));
        revision = result.revision;
        assert.equal(classroom(result.data, CLASS_A).students[0].name, 'Alice');
        assert.deepEqual(classroom(result.data, CLASS_B), bob);
      }
      const deleted = await decode(await f.request(`/classes/${CLASS_A}/privacy/delete`, 'POST', {
        confirmation: 'DELETE CLASS', acknowledgePermanentDeletion: true, expectedRevision: revision,
      }));
      assert.ok(deleted.data.classes.every((item: ClassData) => item.id !== CLASS_A));
      await assertPersistedPrivacy(f, bob, other, projection);
      const restored = await decode(await f.request(`/revisions/${before.revision}/restore`, 'POST', {}));
      assert.ok(restored.data.classes.every((item: ClassData) => item.id !== CLASS_A));
      await assertPersistedPrivacy(f, bob, other, projection);
      assert.equal((await exportBob(f)).student.name, 'Bob');
    } finally { await f.dispose(); }
  });

  test(`${adapter}: stale privacy writes, teacher RBAC, CSRF and foreign workspace selection leave both students unchanged`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      await decode(await f.request(studentPath(CLASS_A, 'delete'), 'POST', bodyFor('delete', before.revision), f.teacher), 403);
      await decode(await f.request(studentPath(CLASS_A, 'delete'), 'POST', bodyFor('delete', before.revision),
        f.owner, f.workspaceId, false), 403);
      await decode(await f.request(studentPath(CLASS_A, 'delete'), 'POST', bodyFor('delete', before.revision),
        f.owner, f.otherWorkspaceId), 403);
      const current = await f.repository.put(f.workspaceId, before.data!, before.revision,
        { action: 'fixture.concurrent', requestId: crypto.randomUUID() });
      const conflict = await decode(await f.request(studentPath(CLASS_A, 'delete'), 'POST',
        bodyFor('delete', before.revision)), 409);
      assert.equal(conflict.error, 'REVISION_CONFLICT');
      assert.equal(conflict.revision, current.revision);
      assert.deepEqual(await f.reload().get(f.workspaceId), current);
      assert.equal((await f.repository.listWorkspaceAuditEvents(f.workspaceId,
        { action: 'student.privacy.delete' })).length, 0);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: restore racing a privacy deletion rejects the stale snapshot instead of resurrecting Alice`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      const bob = structuredClone(classroom(before.data, CLASS_B));
      const other = await f.repository.get(f.otherWorkspaceId);
      const projection = await readBobProjection(f);
      const originalGetSnapshot = f.repository.getWorkspaceRevision.bind(f.repository);
      let raced = false;
      f.repository.getWorkspaceRevision = async (workspaceId, revision) => {
        const stale = await originalGetSnapshot(workspaceId, revision);
        if (!raced && workspaceId === f.workspaceId) {
          raced = true;
          // JSON uses one in-process mutation queue; D1 also supports independent writers.
          const writer = adapter === 'node' ? f.repository : f.reload();
          const current = await writer.get(f.workspaceId);
          await writer.put(f.workspaceId, removeAlice(current.data!), current.revision,
            { action: 'student.privacy.delete', requestId: crypto.randomUUID() });
        }
        return stale;
      };
      try {
        const conflict = await decode(await f.request(`/revisions/${before.revision}/restore`, 'POST', {}), 409);
        assert.equal(conflict.error, 'REVISION_CONFLICT');
        assert.ok(raced);
      } finally { f.repository.getWorkspaceRevision = originalGetSnapshot; }
      await assertPersistedPrivacy(f, bob, other, projection);
      assert.equal((await f.repository.listWorkspaceAuditEvents(f.workspaceId,
        { action: 'workspace.revision.restore' })).length, 0);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: a delayed export audit cannot reintroduce Alice's deleted target identifier`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      const bob = structuredClone(classroom(before.data, CLASS_B));
      const other = await f.repository.get(f.otherWorkspaceId);
      const projection = await readBobProjection(f);
      await exportBob(f);
      const originalAppend = f.repository.appendAuditEvent.bind(f.repository);
      let raced = false;
      f.repository.appendAuditEvent = async (event) => {
        if (!raced && event.action === 'student.privacy.export' && event.metadata?.classId === CLASS_A) {
          raced = true;
          const writer = adapter === 'node' ? f.repository : f.reload();
          const current = await writer.get(f.workspaceId);
          await writer.put(f.workspaceId, removeAlice(current.data!), current.revision,
            { action: 'student.privacy.delete', requestId: crypto.randomUUID() });
        }
        return originalAppend(event);
      };
      try { await decode(await f.request(studentPath(CLASS_A, 'export'))); }
      finally { f.repository.appendAuditEvent = originalAppend; }
      assert.ok(raced);
      const exports = await f.repository.listWorkspaceAuditEvents(f.workspaceId,
        { action: 'student.privacy.export' });
      assert.equal(exports.find((event) => event.metadata?.classId === CLASS_A)?.targetId, undefined);
      assert.equal(exports.find((event) => event.metadata?.classId === CLASS_B)?.targetId, STUDENT_ID);
      await assertPersistedPrivacy(f, bob, other, projection);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: deleting both tuples with the same ID records two students and scrubs both classes`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      const other = await f.repository.get(f.otherWorkspaceId);
      await decode(await f.request(studentPath(CLASS_A, 'export')));
      await decode(await f.request(studentPath(CLASS_B, 'export')));
      const next = removeAlice(before.data!);
      const b = classroom(next, CLASS_B);
      b.students = [];
      b.learningEvidenceRecords = [];
      b.examRecords = (b.examRecords ?? []).map((exam) => ({ ...exam, results: [] }));
      b.activeBoss!.contributions = {};
      b.activeBoss!.attackCounts = {};
      await f.repository.put(f.workspaceId, next, before.revision,
        { action: 'fixture.delete.two.tuples', requestId: crypto.randomUUID() });
      const events = await f.repository.listWorkspaceAuditEvents(f.workspaceId, { limit: 100 });
      const purge = events.find((event) => event.action === 'privacy.student.purge');
      assert.deepEqual(purge?.metadata, { deletedStudentCount: 2 });
      const exports = events.filter((event) => event.action === 'student.privacy.export');
      assert.equal(exports.length, 2);
      assert.ok(exports.every((event) => event.targetId === undefined));
      const current = await f.reload().get(f.workspaceId);
      assert.equal(classroom(current.data, CLASS_A).students.length, 0);
      assert.equal(classroom(current.data, CLASS_B).students.length, 0);
      for (const revision of await f.repository.listWorkspaceRevisions(f.workspaceId)) {
        const snapshot = await f.repository.getWorkspaceRevision(f.workspaceId, revision.revision);
        assert.equal(classroom(snapshot!.data, CLASS_A).students.length, 0);
        assert.equal(classroom(snapshot!.data, CLASS_B).students.length, 0);
      }
      assert.deepEqual(await f.reload().get(f.otherWorkspaceId), other);
    } finally { await f.dispose(); }
  });
}

test('node: failed atomic persistence cannot publish composite deletion, history or audit changes', async () => {
  const f = await createFixture('node');
  try {
    const before = await f.repository.get(f.workspaceId);
    await decode(await f.request(studentPath(CLASS_A, 'export')));
    await decode(await f.request(studentPath(CLASS_B, 'export')));
    const events = await f.repository.listWorkspaceAuditEvents(f.workspaceId);
    const revisions = await f.repository.listWorkspaceRevisions(f.workspaceId);
    const persisted = await readFile(f.filePath!, 'utf8');
    const backup = `${f.filePath}.backup`;
    await rename(f.filePath!, backup);
    await mkdir(f.filePath!);
    try {
      await assert.rejects(f.repository.put(f.workspaceId, removeAlice(before.data!), before.revision,
        { action: 'student.privacy.delete', requestId: 'h02-failed-json-delete' }));
      assert.deepEqual(await f.repository.get(f.workspaceId), before);
      assert.deepEqual(await f.repository.listWorkspaceAuditEvents(f.workspaceId), events);
      assert.deepEqual(await f.repository.listWorkspaceRevisions(f.workspaceId), revisions);
      for (const revision of revisions) {
        const snapshot = await f.repository.getWorkspaceRevision(f.workspaceId, revision.revision);
        assert.equal(classroom(snapshot!.data, CLASS_A).students[0].name, 'Alice');
        assert.equal(classroom(snapshot!.data, CLASS_B).students[0].name, 'Bob');
      }
    } finally {
      // Only this synthetic fixture's empty rename obstacle is removed.
      await rmdir(f.filePath!);
      await rename(backup, f.filePath!);
    }
    assert.equal(await readFile(f.filePath!, 'utf8'), persisted);
    assert.deepEqual(await f.reload().get(f.workspaceId), before);
  } finally { await f.dispose(); }
});

test('d1: a real CAS loser cannot scrub either class, retained revisions or scoped audit targets', async () => {
  const f = await createFixture('d1');
  try {
    const before = await f.repository.get(f.workspaceId);
    const projection = await readBobProjection(f);
    await decode(await f.request(studentPath(CLASS_A, 'export')));
    await decode(await f.request(studentPath(CLASS_B, 'export')));
    const originalGet = f.repository.get.bind(f.repository);
    let winner: StoredWorkspace | undefined;
    let raced = false;
    f.repository.get = async (workspaceId) => {
      const stale = await originalGet(workspaceId);
      if (!raced && workspaceId === f.workspaceId) {
        raced = true;
        winner = await f.reload().put(f.workspaceId, before.data!, before.revision,
          { action: 'fixture.cas.winner', requestId: 'h02-cas-winner' });
      }
      return stale;
    };
    try {
      await assert.rejects(f.repository.put(f.workspaceId, removeAlice(before.data!), before.revision,
        { action: 'student.privacy.delete', requestId: 'h02-cas-loser' }), WorkspaceConflictError);
    } finally { f.repository.get = originalGet; }
    assert.ok(raced && winner);
    assert.equal(winner.revision, before.revision + 1);
    assert.deepEqual(await f.reload().get(f.workspaceId), winner);
    assert.equal(classroom(winner.data, CLASS_A).students[0].name, 'Alice');
    assert.equal(classroom(winner.data, CLASS_B).students[0].name, 'Bob');
    for (const revision of await f.repository.listWorkspaceRevisions(f.workspaceId)) {
      const snapshot = await f.repository.getWorkspaceRevision(f.workspaceId, revision.revision);
      assert.equal(classroom(snapshot!.data, CLASS_A).students[0].name, 'Alice');
      assert.equal(classroom(snapshot!.data, CLASS_B).students[0].name, 'Bob');
    }
    const events = await f.repository.listWorkspaceAuditEvents(f.workspaceId, { limit: 100 });
    const exports = events.filter((event) => event.action === 'student.privacy.export');
    assert.equal(exports.length, 2);
    assert.ok(exports.every((event) => event.targetId === STUDENT_ID));
    assert.equal(events.some((event) => event.id === 'h02-cas-loser' || event.action === 'privacy.student.purge'), false);
    assert.equal(events.filter((event) => event.id === 'h02-cas-winner').length, 1);
    assert.deepEqual(await readBobProjection(f), projection);
    const raw = await f.database!.prepare('SELECT revision, data_json FROM workspaces WHERE workspace_id = ?')
      .bind(f.workspaceId).first<{ revision: number; data_json: string }>();
    assert.equal(raw!.revision, winner.revision);
    assert.deepEqual(JSON.parse(raw!.data_json), before.data);
    assert.equal((await (f.repository as D1WorkspaceRepository)
      .reconcileWorkspaceProjection(f.workspaceId, false)).status, 'verified');
  } finally { await f.dispose(); }
});

test('d1: normalized projection joins use unambiguous class/student and class/exam tuple keys', async () => {
  const f = await createFixture('d1');
  try {
    const data = createData();
    const identities = [{ classId: 'a:b', studentId: 'c' }, { classId: 'a', studentId: 'b:c' }];
    data.currentClassId = identities[0].classId;
    for (let index = 0; index < data.classes.length; index++) {
      const a = data.classes[index];
      const identity = identities[index];
      a.id = identity.classId;
      a.students[0].id = identity.studentId;
      for (const evidence of a.learningEvidenceRecords ?? []) {
        evidence.classId = identity.classId;
        evidence.studentId = identity.studentId;
      }
      for (const exam of a.examRecords ?? []) {
        exam.id = identity.studentId;
        exam.results[0].studentId = identity.studentId;
      }
      a.activeBoss!.contributions = { [identity.studentId]: 10 + index * 10 };
      a.activeBoss!.attackCounts = { [identity.studentId]: 1 + index };
    }
    const before = await f.repository.get(f.workspaceId);
    await f.repository.put(f.workspaceId, data, before.revision,
      { action: 'fixture.delimiter.identities', requestId: crypto.randomUUID() });
    assert.equal((await (f.repository as D1WorkspaceRepository)
      .reconcileWorkspaceProjection(f.workspaceId, false)).status, 'verified',
    'blob fallback must not conceal a broken normalized join');
    const normalized = await f.reload().get(f.workspaceId);
    assert.deepEqual(normalized.data, data, 'point, discipline, reward and exam records must stay with their exact tuple');
    assert.equal(classroom(normalized.data, 'a:b').students[0].pointAdjustmentRecords![0].reasonLabel,
      'Alice synthetic feedback');
    assert.equal(classroom(normalized.data, 'a').students[0].pointAdjustmentRecords![0].reasonLabel,
      'Bob synthetic feedback');
    assert.equal(classroom(normalized.data, 'a:b').examRecords![0].results[0].scores.math, 81);
    assert.equal(classroom(normalized.data, 'a').examRecords![0].results[0].scores.math, 91);
  } finally { await f.dispose(); }
});

test('d1: projection failure rolls back composite privacy deletion, audit targets and revision scrubbing together', async () => {
  const f = await createFixture('d1');
  try {
    const before = await f.repository.get(f.workspaceId);
    await decode(await f.request(studentPath(CLASS_A, 'export')));
    await decode(await f.request(studentPath(CLASS_B, 'export')));
    const events = await f.repository.listWorkspaceAuditEvents(f.workspaceId);
    const snapshots = await f.repository.listWorkspaceRevisions(f.workspaceId);
    await f.database!.prepare('DROP TABLE boss_rewards').run();
    await assert.rejects(f.repository.put(f.workspaceId, removeAlice(before.data!), before.revision,
      { action: 'student.privacy.delete', requestId: 'h02-rolled-back-delete' }), /no such table/i);
    const blob = await f.database!.prepare('SELECT revision, data_json FROM workspaces WHERE workspace_id = ?')
      .bind(f.workspaceId).first<{ revision: number; data_json: string }>();
    assert.equal(blob!.revision, before.revision);
    assert.deepEqual(JSON.parse(blob!.data_json), before.data);
    assert.deepEqual(await f.repository.listWorkspaceAuditEvents(f.workspaceId), events);
    assert.deepEqual(await f.repository.listWorkspaceRevisions(f.workspaceId), snapshots);
    for (const revision of snapshots) {
      const snapshot = await f.repository.getWorkspaceRevision(f.workspaceId, revision.revision);
      assert.equal(classroom(snapshot!.data, CLASS_A).students[0].name, 'Alice');
      assert.equal(classroom(snapshot!.data, CLASS_B).students[0].name, 'Bob');
    }
    const gate = await f.database!.prepare('SELECT source_revision FROM workspace_projection_state WHERE workspace_id = ?')
      .bind(f.workspaceId).first<{ source_revision: number }>();
    assert.equal(gate!.source_revision, before.revision);
  } finally { await f.dispose(); }
});
