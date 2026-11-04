import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { AuthService, type AuthSessionEnvelope } from '../server/auth';
import { createApiHandler } from '../server/api';
import { WorkspaceConflictError, type StoredWorkspace } from '../server/contracts';
import { errorResponse } from '../server/middleware/errorResponse';
import { createCsrfToken } from '../server/middleware/csrf';
import { JsonWorkspaceRepository } from '../server/repository';
import { scopeStoredWorkspace } from '../server/workspaceScope';
import type { AppData, ClassData } from '../src/store/types';
import { normalizeAppData } from '../src/store/utils';
import { D1WorkspaceRepository } from '../worker/repository';

// All people, grades, notes, and identifiers below are synthetic canaries.
const ORIGIN = 'https://epet.example.test';
const PASSWORD = 'synthetic security fixture password';
const CLASS_A = 'synthetic-class-a';
const CLASS_B = 'secret-class-b-H01';
const STUDENT_A = 'synthetic-student-a';
const B_CANARIES = [
  CLASS_B, 'secret-student-b-H01', 'Secret Student B H01',
  'Secret Class B H01', 'secret-exam-b-H01', 'secret-comment-b-H01',
  'secret-evidence-b-H01', 'secret-learning-note-b-H01', '73.125',
];
const OTHER_CANARY = 'other-workspace-secret-H01';

const createData = (): AppData => JSON.parse(JSON.stringify(normalizeAppData({
  lastOpened: 1_700_000_000_000,
  currentClassId: CLASS_B,
  classes: [{
    id: CLASS_A,
    name: 'Synthetic Class A',
    students: [{ id: STUDENT_A, name: 'Synthetic Student A', points: 5,
      pet: { type: 'cat', level: 1, fullness: 80, happiness: 80 } }],
    learningEvidenceRecords: [],
  }, {
    id: CLASS_B,
    name: 'Secret Class B H01',
    students: [{ id: 'secret-student-b-H01', name: 'Secret Student B H01', points: 90,
      pet: { type: 'dog', level: 9, fullness: 90, happiness: 90 } }],
    examRecords: [{
      id: 'secret-exam-b-H01', title: 'Secret Class B examination',
      examDate: '2026-10-18', items: [{ id: 'secret-subject-b', name: 'Synthetic Math', maxScore: 100 }],
      results: [{ studentId: 'secret-student-b-H01', scores: { 'secret-subject-b': 73.125 },
        mentorComment: 'secret-comment-b-H01', updatedAt: 1_700_000_000_001 }],
      createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_001,
    }],
    learningEvidenceRecords: [{
      id: 'secret-evidence-b-H01', classId: CLASS_B, studentId: 'secret-student-b-H01',
      competency: 'growth', level: 'mastered', evidenceType: 'assessment',
      title: 'Secret Class B learning', note: 'secret-learning-note-b-H01',
      actor: 'mentor', source: 'manual', rubricVersion: '1.0', revision: 1,
      createdAt: 1_700_000_000_002,
    }],
  }],
}, 1_700_000_000_000)));

const migrationPaths = [
  '0001_create_workspaces.sql', '0002_auth_rbac.sql', '0003_core_entities.sql',
  '0004_workspace_class_assignments.sql', '0005_workspace_invitations.sql',
  '0006_projection_read_model.sql', '0007_email_verification.sql',
];

// Triggers contain internal semicolons; keep their BEGIN/END bodies together.
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

type Repository = JsonWorkspaceRepository | D1WorkspaceRepository;
type Client = AuthSessionEnvelope & { csrf: string };
const client = (session: AuthSessionEnvelope): Client => ({ ...session, csrf: createCsrfToken() });

const createFixture = async (adapter: 'node' | 'd1') => {
  let database: D1Database | undefined;
  let dispose: (() => Promise<void>) | undefined;
  let repository: Repository;
  try {
    if (adapter === 'd1') {
      const miniflare = new Miniflare({ modules: true,
        script: 'export default { fetch() { return new Response("synthetic fixture"); } }',
        d1Databases: ['DB'] });
      database = await miniflare.getD1Database('DB') as unknown as D1Database;
      dispose = () => miniflare.dispose();
      await applyMigrations(database);
      repository = new D1WorkspaceRepository(database);
    } else {
      const directory = await mkdtemp(join(tmpdir(), 'epet-H01-'));
      repository = new JsonWorkspaceRepository(join(directory, 'data.json'));
      dispose = () => rm(directory, { recursive: true, force: true });
    }
    const auth = new AuthService(repository, { passwordIterations: 10 });
    const owner = client(await auth.register({ email: 'owner-h01@example.test', password: PASSWORD,
      displayName: 'Synthetic Owner', workspaceName: 'Synthetic Workspace', initialWorkspaceData: createData() }));
    const workspaceId = owner.session.activeWorkspaceId!;
    const invite = async (email: string, role: 'teacher' | 'viewer') => {
      const invitation = await auth.createWorkspaceInvitation(owner.sessionToken, workspaceId,
        email, role, [CLASS_A]);
      return client(await auth.acceptWorkspaceInvitation(invitation.token, 'Synthetic Teacher', PASSWORD));
    };
    const teacher = await invite('teacher-h01@example.test', 'teacher');
    const viewer = await invite('viewer-h01@example.test', 'viewer');
    const unassigned = await invite('unassigned-h01@example.test', 'teacher');
    // Persist a legacy/revoked assignment through the real adapter, without replacing authorization.
    await repository.updateWorkspaceMember({ workspaceId, userId: unassigned.session.user.id,
      role: 'teacher', classIds: [], actorUserId: owner.session.user.id, updatedAt: Date.now(),
      auditEvent: { id: crypto.randomUUID(), workspaceId, action: 'test.assignment.revoked', createdAt: Date.now() } });
    const otherOwner = client(await auth.register({ email: 'other-h01@example.test', password: PASSWORD,
      displayName: 'Other Synthetic Owner', workspaceName: 'Other Synthetic Workspace',
      initialWorkspaceData: { ...createData(), classes: [{ id: CLASS_A, name: OTHER_CANARY,
        students: [{ id: STUDENT_A, name: OTHER_CANARY, points: 1,
          pet: { type: 'cat', fullness: 80, happiness: 80, level: 1 } }] }] } }));
    const otherWorkspaceId = otherOwner.session.activeWorkspaceId!;
    const handler = createApiHandler(repository, { auth: { passwordIterations: 10 } });
    const request = (who: Client, path: string, method = 'GET', body?: unknown,
      workspace = workspaceId, headerOverrides: Record<string, string> = {}) => handler(new Request(`${ORIGIN}/api/v1${path}`, {
      method,
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-epet-workspace': workspace,
        cookie: `__Host-epet_session=${who.sessionToken}; __Host-epet_csrf=${who.csrf}`,
        'x-csrf-token': who.csrf, ...headerOverrides },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    return { repository, database, auth, owner, teacher, viewer, unassigned,
      workspaceId, otherWorkspaceId, request, dispose };
  } catch (error) {
    await dispose?.();
    throw error;
  }
};

type Fixture = Awaited<ReturnType<typeof createFixture>>;
const evidenceBody = (title: string, studentId = STUDENT_A) => ({ studentId,
  input: { competency: 'growth', level: 'progressing', evidenceType: 'observation', title } });
const postEvidence = (f: Fixture, title: string, who = f.teacher, classId = CLASS_A,
  workspace = f.workspaceId, headers: Record<string, string> = {}) =>
  f.request(who, `/classes/${classId}/evidence`, 'POST', evidenceBody(title), workspace, headers);

const safeBody = async (response: Response): Promise<Record<string, any>> => {
  const text = await response.text();
  for (const marker of [...B_CANARIES, OTHER_CANARY]) {
    assert.ok(!text.includes(marker), `unauthorized canary leaked (${marker}): ${text}`);
  }
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return JSON.parse(text);
};
const metadataConflict = async (response: Response, current: StoredWorkspace) => {
  assert.equal(response.status, 409);
  assert.deepEqual(await safeBody(response), { error: 'REVISION_CONFLICT',
    revision: current.revision, updatedAt: current.updatedAt });
};
const getClassB = (workspace: StoredWorkspace): ClassData => workspace.data!.classes.find((item) => item.id === CLASS_B)!;

const assertSingleWinner = async (f: Fixture, before: StoredWorkspace, title: string, loser: string) => {
  const current = await f.repository.get(f.workspaceId);
  assert.equal(current.revision, before.revision + 1);
  assert.deepEqual(getClassB(current), getClassB(before));
  const a = current.data!.classes.find((item) => item.id === CLASS_A)!;
  assert.equal(a.learningEvidenceRecords!.filter((record) => record.title === title).length, 1);
  assert.ok(!JSON.stringify(current).includes(loser));
  const revisions = await f.repository.listWorkspaceRevisions(f.workspaceId);
  assert.equal(revisions[0].revision, current.revision);
  assert.equal(revisions.filter((item) => item.revision > before.revision).length, 1,
    'the rejected mutation must not append a revision snapshot');
  const snapshot = await f.repository.getWorkspaceRevision(f.workspaceId, current.revision);
  assert.ok(snapshot);
  assert.ok(!JSON.stringify(snapshot).includes(loser));
  const events = await f.repository.listWorkspaceAuditEvents(f.workspaceId, { action: 'learning_evidence.create' });
  assert.equal(events.length, 1, 'only the winning evidence mutation may append an audit event');
  assert.equal(events[0].actorUserId, f.teacher.session.user.id);
  if (f.database) {
    const evidence = await f.database.prepare('SELECT title, source_revision FROM learning_evidence WHERE workspace_id = ? AND class_id = ?')
      .bind(f.workspaceId, CLASS_A).all<{ title: string; source_revision: number }>();
    assert.deepEqual(evidence.results, [{ title, source_revision: current.revision }]);
    const gate = await f.database.prepare('SELECT source_revision FROM workspace_projection_state WHERE workspace_id = ?')
      .bind(f.workspaceId).first<{ source_revision: number }>();
    assert.equal(gate!.source_revision, current.revision);
    const history = await f.database.prepare('SELECT revision, data_json FROM workspace_revisions WHERE workspace_id = ? ORDER BY revision')
      .bind(f.workspaceId).all<{ revision: number; data_json: string }>();
    assert.equal(history.results.filter((row) => row.revision > before.revision).length, 1);
    assert.ok(history.results.every((row) => !row.data_json.includes(loser)));
  }
};

// Both handlers reach put before either adapter is allowed to commit.
const gateTwoPuts = (repository: Repository) => {
  const original = repository.put.bind(repository);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  // A route regression before put should fail the test instead of hanging it.
  const timeout = setTimeout(release, 10_000);
  repository.put = async (...args) => {
    calls++;
    if (calls === 2) release();
    await gate;
    return original(...args);
  };
  return () => { clearTimeout(timeout); repository.put = original; assert.equal(calls, 2); };
};

// Use a real competing write; never manufacture adapter conflict errors.
const injectWinner = (f: Fixture, mode: 'precheck' | 'cas', title: string) => {
  const originalPut = f.repository.put.bind(f.repository);
  const originalGet = f.repository.get.bind(f.repository);
  let armed = false;
  let fired = false;
  const writeWinner = async (current: StoredWorkspace) => {
    const next = structuredClone(current.data!);
    next.classes.find((item) => item.id === CLASS_A)!.name = title;
    const winner = mode === 'cas'
      ? new D1WorkspaceRepository(f.database!) : f.repository;
    const put = mode === 'cas' ? winner.put.bind(winner) : originalPut;
    await put(f.workspaceId, next, current.revision,
      { actorUserId: f.teacher.session.user.id, action: 'test.concurrent.winner', requestId: crypto.randomUUID() });
  };
  f.repository.get = async (id) => {
    const snapshot = await originalGet(id);
    if (armed && !fired && mode === 'cas') {
      fired = true;
      await writeWinner(snapshot);
    }
    return snapshot;
  };
  f.repository.put = async (...args) => {
    armed = true;
    if (mode === 'precheck' && !fired) {
      fired = true;
      await writeWinner(await originalGet(f.workspaceId));
    }
    try { return await originalPut(...args); } finally { armed = false; }
  };
  return () => { f.repository.put = originalPut; f.repository.get = originalGet;
    assert.ok(fired, `the real ${mode} conflict path must execute`); };
};

test('generic conflict serialization allowlists metadata and never copies nested extensions', async () => {
  const current = Object.assign({ revision: 42, updatedAt: 123, data: createData() },
    { snapshot: { secret: B_CANARIES[0] }, extension: { current: createData() } });
  const response = errorResponse(new WorkspaceConflictError(current), { 'x-test-response': 'preserved' });
  assert.equal(response.headers.get('x-test-response'), 'preserved');
  await metadataConflict(response, current);
});

for (const adapter of ['node', 'd1'] as const) {
  test(`${adapter}: scoped evidence success and authorization failures never disclose another class or tenant`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      const otherBefore = await f.repository.get(f.otherWorkspaceId);
      const success = await postEvidence(f, 'Authorized Class A evidence');
      assert.equal(success.status, 201);
      const saved = await safeBody(success);
      assert.deepEqual(Object.keys(saved).sort(), ['record', 'revision']);
      assert.equal(saved.record.classId, CLASS_A);
      assert.equal(saved.record.studentId, STUDENT_A);
      assert.equal(saved.revision, before.revision + 1);
      const scoped = await f.request(f.teacher, '/state');
      assert.equal(scoped.status, 200);
      assert.deepEqual((await safeBody(scoped)).data.classes.map((item: ClassData) => item.id), [CLASS_A]);
      for (const response of [
        await postEvidence(f, 'deny Class B', f.teacher, CLASS_B),
        await postEvidence(f, 'deny other workspace', f.teacher, CLASS_A, f.otherWorkspaceId),
        await postEvidence(f, 'deny viewer', f.viewer),
        await postEvidence(f, 'deny no assignment', f.unassigned),
        await postEvidence(f, 'deny CSRF', f.teacher, CLASS_A, f.workspaceId, { 'x-csrf-token': '' }),
        await postEvidence(f, 'deny Origin', f.teacher, CLASS_A, f.workspaceId, { origin: 'https://attacker.example.test' }),
        await postEvidence(f, 'deny session', f.teacher, CLASS_A, f.workspaceId, { cookie: '' }),
      ]) {
        assert.ok([401, 403].includes(response.status));
        await safeBody(response);
      }
      const wrongStudent = await f.request(f.teacher, `/classes/${CLASS_A}/evidence`, 'POST',
        evidenceBody('deny wrong class student', 'secret-student-b-H01'));
      assert.equal(wrongStudent.status, 400);
      assert.deepEqual(await safeBody(wrongStudent), { error: 'INVALID_EVIDENCE' });
      await assertSingleWinner(f, before, 'Authorized Class A evidence', 'deny ');
      assert.deepEqual(await f.repository.get(f.otherWorkspaceId), otherBefore);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: two parallel evidence requests preserve one winner and return metadata-only 409`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      const restore = gateTwoPuts(f.repository);
      let responses: Response[];
      try { responses = await Promise.all([postEvidence(f, 'parallel-a'), postEvidence(f, 'parallel-b')]); }
      finally { restore(); }
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      const winner = await safeBody(responses.find((response) => response.status === 201)!);
      const current = await f.repository.get(f.workspaceId);
      await metadataConflict(responses.find((response) => response.status === 409)!, current);
      await assertSingleWinner(f, before, winner.record.title, winner.record.title === 'parallel-a' ? 'parallel-b' : 'parallel-a');
    } finally { await f.dispose(); }
  });

  for (const mode of adapter === 'd1' ? ['precheck', 'cas'] as const : ['precheck'] as const) {
    test(`${adapter}: evidence ${mode} conflict is metadata-only and the losing write has no effects`, async () => {
      const f = await createFixture(adapter);
      try {
        const before = await f.repository.get(f.workspaceId);
        const restore = injectWinner(f, mode, 'Real competing winner');
        let response: Response;
        try { response = await postEvidence(f, 'Losing evidence must not persist'); } finally { restore(); }
        const current = await f.repository.get(f.workspaceId);
        await metadataConflict(response, current);
        assert.equal(current.revision, before.revision + 1);
        assert.deepEqual(getClassB(current), getClassB(before));
        assert.ok(!JSON.stringify(current).includes('Losing evidence must not persist'));
        assert.equal((await f.repository.listWorkspaceAuditEvents(f.workspaceId, { action: 'learning_evidence.create' })).length, 0);
        assert.equal((await f.repository.listWorkspaceAuditEvents(f.workspaceId, { action: 'test.concurrent.winner' })).length, 1);
        const revision = await f.repository.getWorkspaceRevision(f.workspaceId, current.revision);
        assert.ok(revision && !JSON.stringify(revision).includes('Losing evidence must not persist'));
        if (f.database) {
          const rows = await f.database.prepare('SELECT title, source_revision FROM learning_evidence WHERE workspace_id = ? AND class_id = ?')
            .bind(f.workspaceId, CLASS_A).all();
          assert.deepEqual(rows.results, []);
          const gate = await f.database.prepare('SELECT source_revision FROM workspace_projection_state WHERE workspace_id = ?')
            .bind(f.workspaceId).first<{ source_revision: number }>();
          assert.equal(gate!.source_revision, current.revision);
        }
      } finally { await f.dispose(); }
    });
  }

  test(`${adapter}: /state stale precheck returns only the authenticated teacher's snapshot`, async () => {
    const f = await createFixture(adapter);
    try {
      const current = await f.repository.get(f.workspaceId);
      const scoped = scopeStoredWorkspace(current, new Set([CLASS_A]));
      const response = await f.request(f.teacher, '/state', 'PUT', { data: scoped.data, baseRevision: current.revision - 1 });
      assert.equal(response.status, 409);
      assert.deepEqual(await safeBody(response), { error: 'REVISION_CONFLICT', current: scoped });
      assert.deepEqual(await f.repository.get(f.workspaceId), current);
      const owner = await f.request(f.owner, '/state', 'PUT', { data: current.data, baseRevision: current.revision - 1 });
      assert.equal(owner.status, 409);
      assert.deepEqual(await owner.json(), { error: 'REVISION_CONFLICT', current });
    } finally { await f.dispose(); }
  });

  for (const role of ['teacher', 'owner'] as const) {
    test(`${adapter}: /state repository ${adapter === 'd1' ? 'CAS' : 'revision'} conflict preserves ${role} snapshot scope`, async () => {
      const f = await createFixture(adapter);
      try {
        const before = await f.repository.get(f.workspaceId);
        const incoming = role === 'teacher' ? scopeStoredWorkspace(before, new Set([CLASS_A])) : before;
        const restore = injectWinner(f, adapter === 'd1' ? 'cas' : 'precheck', 'Winning Class A state');
        let response: Response;
        try { response = await f.request(f[role], '/state', 'PUT', { data: incoming.data, baseRevision: before.revision }); }
        finally { restore(); }
        assert.equal(response.status, 409);
        const current = await f.repository.get(f.workspaceId);
        const body = role === 'teacher' ? await safeBody(response) : await response.json();
        assert.deepEqual(body, { error: 'REVISION_CONFLICT', current: role === 'teacher'
          ? scopeStoredWorkspace(current, new Set([CLASS_A])) : current });
        assert.equal(current.revision, before.revision + 1);
        assert.deepEqual(getClassB(current), getClassB(before));
      } finally { await f.dispose(); }
    });
  }
}
