import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { AuthService, type AuthSessionEnvelope } from '../server/auth';
import { createApiHandler } from '../server/api';
import { WorkspaceDataTooLargeError } from '../server/contracts';
import { MAX_AUTH_BODY_BYTES, MAX_BODY_BYTES, readJsonBody } from '../server/http/body';
import { createCsrfToken } from '../server/middleware/csrf';
import { errorResponse } from '../server/middleware/errorResponse';
import { JsonWorkspaceRepository } from '../server/repository';
import { MAX_D1_STATE_BYTES, jsonUtf8Size } from '../shared/domain/repositoryPolicy';
import { assertWorkspaceData } from '../shared/validation/workspaceValidation';
import type { AppData, LearningEvidenceRecord } from '../src/store/types';
import { normalizeAppData } from '../src/store/utils';
import { D1WorkspaceRepository } from '../worker/repository';

// Synthetic classroom records only. The maximum fixture is about 902 KiB, not an OOM probe.
const NOW = 1_700_000_000_000;
const ORIGIN = 'https://epet.example.test';
const PASSWORD = 'Synthetic H04 capacity fixture password';
const CLASS_A = 'synthetic-capacity-class-a';
const CLASS_B = 'synthetic-private-class-b';
const PRIVATE_B = 'Synthetic Private B Learner Capacity';
type Adapter = 'node' | 'd1';
type Repository = JsonWorkspaceRepository | D1WorkspaceRepository;
type Client = AuthSessionEnvelope & { csrf: string };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const createData = (): AppData => copy(normalizeAppData({ currentClassId: CLASS_A, lastOpened: NOW,
  classes: [
    { id: CLASS_A, name: 'Synthetic Class A', students: [{ id: 'student-a', name: 'Synthetic Alice',
      points: 10, pet: { type: 'cat', fullness: 80, happiness: 80, level: 1 } }] },
    { id: CLASS_B, name: 'Synthetic Class B', students: [{ id: 'student-b', name: PRIVATE_B,
      points: 77, pet: { type: 'dog', fullness: 70, happiness: 80, level: 2 } }] },
  ],
}, NOW));
const scopeA = (data: AppData): AppData => ({ ...copy(data), currentClassId: CLASS_A,
  classes: copy(data.classes.filter((classroom) => classroom.id === CLASS_A)) });

const sizedData = (base: AppData, targetBytes: number) => {
  const data = copy(base);
  const records: LearningEvidenceRecord[] = Array.from({ length: 600 }, (_, index) => ({
    id: `synthetic-capacity-evidence-${index}`, classId: CLASS_A, studentId: 'student-a',
    competency: 'growth', level: 'progressing', evidenceType: 'observation',
    title: 'Synthetic capacity observation', note: 'x', actor: 'mentor', source: 'manual',
    rubricVersion: '1.0', revision: 1, createdAt: NOW - index,
  }));
  data.classes[0].learningEvidenceRecords = records;
  let remaining = targetBytes - jsonUtf8Size(data);
  assert.ok(remaining > 0);
  for (const record of records) {
    // At most 500 Unicode characters per note, exactly counted as UTF-8 bytes.
    const delta = Math.min(remaining, 1497);
    const bytes = 1 + delta;
    record.note = '學'.repeat(Math.floor(bytes / 3)) + 'x'.repeat(bytes % 3);
    remaining -= delta;
  }
  assert.equal(remaining, 0);
  assert.equal(jsonUtf8Size(data), targetBytes);
  assertWorkspaceData(data);
  assert.equal(jsonUtf8Size(copy(normalizeAppData(data, NOW))), targetBytes,
    'capacity fixtures must survive normalization without losing records or bytes');
  return data;
};

const migrations = ['0001_create_workspaces.sql', '0002_auth_rbac.sql', '0003_core_entities.sql',
  '0004_workspace_class_assignments.sql', '0005_workspace_invitations.sql',
  '0006_projection_read_model.sql', '0007_email_verification.sql'];
const applyMigrations = async (database: D1Database) => {
  for (const file of migrations) {
    let lines: string[] = [];
    let insideTrigger = false;
    for (const raw of (await readFile(join('migrations', file), 'utf8')).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('--')) continue;
      if (/^CREATE\s+TRIGGER\b/i.test(line)) insideTrigger = true;
      lines.push(raw);
      if (insideTrigger ? /^END;$/i.test(line) : line.endsWith(';')) {
        await database.prepare(lines.join('\n')).run(); lines = []; insideTrigger = false;
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
        script: 'export default { fetch() { return new Response("synthetic H04 fixture"); } }' });
      database = await miniflare.getD1Database('DB') as unknown as D1Database;
      dispose = () => miniflare.dispose(); await applyMigrations(database);
      repository = new D1WorkspaceRepository(database, { readMode: 'normalized' });
    } else {
      const directory = await mkdtemp(join(tmpdir(), 'epet-H04-'));
      filePath = join(directory, 'data.json'); repository = new JsonWorkspaceRepository(filePath);
      dispose = () => rm(directory, { recursive: true, force: true });
    }
    const auth = new AuthService(repository, { passwordIterations: 10 });
    const client = (session: AuthSessionEnvelope): Client => ({ ...session, csrf: createCsrfToken() });
    const owner = client(await auth.register({ email: 'h04-owner@example.test', password: PASSWORD,
      displayName: 'Synthetic Owner', workspaceName: 'Synthetic Capacity Workspace', initialWorkspaceData: createData() }));
    const workspaceId = owner.session.activeWorkspaceId!;
    const invitation = await auth.createWorkspaceInvitation(owner.sessionToken, workspaceId,
      'h04-teacher@example.test', 'teacher', [CLASS_A]);
    const teacher = client(await auth.acceptWorkspaceInvitation(invitation.token, 'Synthetic Teacher', PASSWORD));
    const options = { auth: { passwordIterations: 10 } };
    let handler = createApiHandler(repository, options);
    const request = (path: string, method = 'GET', body?: unknown, who = owner,
      extraHeaders: Record<string, string> = {}) => handler(new Request(`${ORIGIN}/api/v1${path}`, {
      method, headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-epet-workspace': workspaceId,
        cookie: `__Host-epet_session=${who.sessionToken}; __Host-epet_csrf=${who.csrf}`,
        'x-csrf-token': who.csrf, ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const snapshot = async () => {
      // A normalized read may finish reconciliation metadata. Capture the
      // projection after that read so before/after compare the same lifecycle.
      const workspace = await repository.get(workspaceId);
      const revisions = await repository.listWorkspaceRevisions(workspaceId);
      const projection: Record<string, unknown> = {};
      if (database) {
        for (const table of ['workspaces', 'workspace_revisions', 'workspace_projection_state', 'workspace_projection_documents',
          'classes', 'students', 'exam_records', 'exam_results', 'learning_evidence',
          'point_adjustments', 'discipline_records', 'boss_rewards']) {
          const rows = await database.prepare(`SELECT * FROM ${table} WHERE workspace_id = ?`).bind(workspaceId).all();
          projection[table] = rows.results.map((row) => JSON.stringify(row)).sort();
        }
      }
      return copy({ workspace, revisions,
        history: await Promise.all(revisions.map((revision) => repository.getWorkspaceRevision(workspaceId, revision.revision))),
        audit: await repository.listWorkspaceAuditEvents(workspaceId, { limit: 200 }), projection });
    };
    const poisonHistory = async (data: AppData) => {
      const current = await repository.get(workspaceId);
      if (database) {
        const serialized = JSON.stringify(data);
        await database.prepare('UPDATE workspace_revisions SET data_json = ?, data_size_bytes = ? WHERE workspace_id = ? AND revision = ?')
          .bind(serialized, jsonUtf8Size(data), workspaceId, current.revision).run();
      } else {
        const raw = JSON.parse(await readFile(filePath!, 'utf8'));
        const history = raw.workspaceRevisions[workspaceId];
        const revision = history.find((item: { revision: number }) => item.revision === current.revision);
        assert.ok(revision); revision.data = data;
        await writeFile(filePath!, JSON.stringify(raw));
        repository = new JsonWorkspaceRepository(filePath!);
        handler = createApiHandler(repository, options);
      }
      return current.revision;
    };
    const reload = () => database ? new D1WorkspaceRepository(database, { readMode: 'normalized' })
      : new JsonWorkspaceRepository(filePath!);
    return { get repository() { return repository; }, database, owner, teacher, workspaceId,
      request, snapshot, poisonHistory, reload, dispose };
  } catch (error) { await dispose?.(); throw error; }
};

const assertCapacityResponse = async (response: Response, limitBytes = MAX_D1_STATE_BYTES,
  limitKind = 'workspace_snapshot') => {
  const text = await response.text();
  assert.equal(response.status, 413, text);
  assert.deepEqual(JSON.parse(text), { error: 'PAYLOAD_TOO_LARGE', limitBytes, limitKind });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const denied of [PRIVATE_B, CLASS_B, 'student-b', 'dataSizeBytes', 'data_json', 'current', 'classes']) {
    assert.ok(!text.includes(denied), `413 must not reveal ${denied}`);
  }
};
const importBody = (data: AppData, expectedRevision: number) => ({ data, expectedRevision,
  confirmation: 'IMPORT WORKSPACE', acknowledgeReplacement: true });

test('capacity responses expose only validated public limits and retain the legacy error contract', async () => {
  assert.equal(MAX_D1_STATE_BYTES, 900 * 1024);
  assert.equal(MAX_BODY_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_AUTH_BODY_BYTES, 16 * 1024);
  assert.deepEqual(await errorResponse(new WorkspaceDataTooLargeError()).json(), { error: 'PAYLOAD_TOO_LARGE' });
  for (const limit of [
    { limitBytes: Infinity, limitKind: 'workspace_snapshot' },
    { limitBytes: -1, limitKind: 'request_body' },
    { limitBytes: 1.5, limitKind: 'request_body' },
    { limitBytes: 10, limitKind: PRIVATE_B },
  ]) {
    const error = new WorkspaceDataTooLargeError(limit as { limitBytes: number; limitKind: 'request_body' });
    assert.deepEqual(await errorResponse(error).json(), { error: 'PAYLOAD_TOO_LARGE' });
  }
  const error = new WorkspaceDataTooLargeError({ limitBytes: MAX_D1_STATE_BYTES, limitKind: 'workspace_snapshot' });
  Object.assign(error, { data: createData(), dataSizeBytes: MAX_D1_STATE_BYTES + 1 });
  await assertCapacityResponse(errorResponse(error));
});

test('existing request-body limits reject both declared and actual excess bytes with a request-body contract', async () => {
  for (const maximum of [MAX_AUTH_BODY_BYTES, MAX_BODY_BYTES]) {
    let reads = 0;
    const request = { headers: new Headers({ 'content-length': String(maximum + 1) }),
      arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } } as Request;
    await assert.rejects(readJsonBody(request, maximum), (error: unknown) => {
      assert.ok(error instanceof WorkspaceDataTooLargeError);
      assert.equal(error.limitBytes, maximum); assert.equal(error.limitKind, 'request_body'); return true;
    });
    assert.equal(reads, 0, 'declared over-limit bodies must not be buffered');
    await assert.rejects(readJsonBody(new Request(`${ORIGIN}/body`, {
      method: 'POST', body: 'x'.repeat(maximum + 1),
    }), maximum), (error: unknown) => {
      assert.ok(error instanceof WorkspaceDataTooLargeError);
      assert.equal(error.limitBytes, maximum); assert.equal(error.limitKind, 'request_body'); return true;
    });
  }
});

for (const adapter of ['node', 'd1'] as const) {
  test(`${adapter}: normal, near-capacity, rejected or compatible oversized writes and cleanup preserve sync/revision/scope`, async (t) => {
    const f = await createFixture(adapter);
    try {
      const initial = await f.repository.get(f.workspaceId);
      const hidden = copy(initial.data!.classes[1]);
      await t.test('a normal state write remains valid', async () => {
        const data = copy(initial.data!); data.classes[0].students[0].points++;
        const response = await f.request('/state', 'PUT', { data, baseRevision: initial.revision });
        assert.equal(response.status, 200, await response.clone().text());
      });
      await t.test('a legitimate workspace near the unchanged 900 KiB boundary syncs without truncation', async () => {
        const current = await f.repository.get(f.workspaceId);
        const near = sizedData(current.data!, MAX_D1_STATE_BYTES - 1024);
        const response = await f.request('/state', 'PUT', { data: near, baseRevision: current.revision });
        assert.equal(response.status, 200, await response.clone().text());
        const saved = await f.repository.get(f.workspaceId);
        assert.equal(saved.data!.classes[0].learningEvidenceRecords!.length, 600);
        assert.equal(jsonUtf8Size(saved.data), MAX_D1_STATE_BYTES - 1024);
      });
      await t.test('exactly 900 KiB remains accepted at the repository boundary', async () => {
        const current = await f.repository.get(f.workspaceId);
        const atLimit = sizedData(current.data!, MAX_D1_STATE_BYTES);
        const saved = await f.repository.put(f.workspaceId, atLimit, current.revision);
        assert.equal(jsonUtf8Size(saved.data), MAX_D1_STATE_BYTES);
        assert.equal(saved.data!.classes[0].learningEvidenceRecords!.length, 600);
      });
      await t.test('a limited teacher gets only their authorized snapshot and may still save it', async () => {
        const current = await f.repository.get(f.workspaceId);
        const fetched = await f.request('/state', 'GET', undefined, f.teacher);
        const text = await fetched.text(); assert.equal(fetched.status, 200);
        assert.ok(!text.includes(PRIVATE_B)); assert.ok(!text.includes(CLASS_B));
        const data = scopeA(current.data!); data.classes[0].students[0].points++;
        const response = await f.request('/state', 'PUT', { data, baseRevision: current.revision }, f.teacher);
        assert.equal(response.status, 200, await response.clone().text());
        assert.ok(!(await response.text()).includes(PRIVATE_B));
        assert.deepEqual(copy((await f.repository.get(f.workspaceId)).data!.classes[1]), hidden);
      });
      await t.test('oversized owner/teacher writes expose no merged-snapshot contents or byte count', async () => {
        for (const who of [f.owner, f.teacher]) {
          const before = await f.snapshot();
          const full = sizedData(before.workspace.data!, MAX_D1_STATE_BYTES + 1024);
          const response = await f.request('/state', 'PUT', {
            data: who === f.teacher ? scopeA(full) : full, baseRevision: before.workspace.revision,
          }, who);
          if (adapter === 'd1') {
            await assertCapacityResponse(response);
            assert.deepEqual(await f.snapshot(), before, '413 must not modify state, history, projection or audit');
          } else {
            assert.equal(response.status, 200, await response.clone().text());
            assert.equal(jsonUtf8Size((await f.repository.get(f.workspaceId)).data), MAX_D1_STATE_BYTES + 1024,
              'JSON storage keeps its existing compatibility contract without a D1-only cap');
          }
          assert.deepEqual(copy((await f.repository.get(f.workspaceId)).data!.classes[1]), hidden);
        }
      });
      await t.test('explicit cleanup can save after capacity rejection and stale revisions remain protected', async () => {
        const current = await f.repository.get(f.workspaceId);
        const cleaned = scopeA(current.data!); cleaned.classes[0].learningEvidenceRecords = [];
        cleaned.classes[0].students[0].points++;
        const response = await f.request('/state', 'PUT', { data: cleaned, baseRevision: current.revision }, f.teacher);
        assert.equal(response.status, 200, await response.clone().text());
        const saved = await f.snapshot();
        const stale = await f.request('/state', 'PUT', { data: cleaned, baseRevision: current.revision }, f.teacher);
        assert.equal(stale.status, 409);
        const text = await stale.text(); assert.ok(!text.includes(PRIVATE_B)); assert.ok(!text.includes(CLASS_B));
        assert.deepEqual(await f.snapshot(), saved);
        assert.deepEqual(copy((await f.reload().get(f.workspaceId)).data), saved.workspace.data);
        assert.deepEqual(saved.workspace.data!.classes[1], hidden);
      });
      await t.test('the unchanged request byte guard produces safe capacity metadata and no partial write', async () => {
        const before = await f.snapshot();
        await assertCapacityResponse(await f.request('/state', 'PUT', { data: before.workspace.data,
          baseRevision: before.workspace.revision }, f.teacher, { 'content-length': String(MAX_BODY_BYTES + 1) }),
        MAX_BODY_BYTES, 'request_body');
        assert.deepEqual(await f.snapshot(), before);
      });
    } finally { await f.dispose(); }
  });

  test(`${adapter}: import and retained revision restore keep capacity failures atomic and history intact`, async (t) => {
    const f = await createFixture(adapter);
    try {
      await t.test('explicit oversized import either rejects atomically in D1 or remains JSON compatible', async () => {
        const before = await f.snapshot();
        const large = sizedData(before.workspace.data!, MAX_D1_STATE_BYTES + 1024);
        const response = await f.request('/workspace/import', 'POST', importBody(large, before.workspace.revision));
        if (adapter === 'd1') {
          await assertCapacityResponse(response);
          assert.deepEqual(await f.snapshot(), before);
        } else {
          assert.equal(response.status, 200, await response.clone().text());
          assert.equal((await f.repository.get(f.workspaceId)).data!.classes[0].learningEvidenceRecords!.length, 600);
        }
      });
      await t.test('oversized historical sources remain retained after a rejected D1 restore', async () => {
        const current = await f.repository.get(f.workspaceId);
        const source = sizedData(current.data!, MAX_D1_STATE_BYTES + 1024);
        const revision = await f.poisonHistory(source);
        const before = await f.snapshot();
        const response = await f.request(`/revisions/${revision}/restore`, 'POST', {});
        if (adapter === 'd1') {
          await assertCapacityResponse(response);
          assert.deepEqual(await f.snapshot(), before);
        } else {
          assert.equal(response.status, 200, await response.clone().text());
          assert.equal((await f.repository.get(f.workspaceId)).data!.classes[0].learningEvidenceRecords!.length, 600);
        }
        assert.deepEqual(copy((await f.repository.getWorkspaceRevision(f.workspaceId, revision))!.data), source,
          'rejected retained source must never be silently removed or truncated');
      });
      await t.test('a scoped teacher cannot import or restore a full workspace after a capacity error', async () => {
        const before = await f.snapshot();
        const imported = await f.request('/workspace/import', 'POST', importBody(before.workspace.data!, before.workspace.revision), f.teacher);
        assert.equal(imported.status, 403); assert.deepEqual(await imported.json(), { error: 'FORBIDDEN' });
        const restored = await f.request(`/revisions/${before.workspace.revision}/restore`, 'POST', {}, f.teacher);
        assert.equal(restored.status, 403); assert.deepEqual(await restored.json(), { error: 'FORBIDDEN' });
        assert.deepEqual(await f.snapshot(), before);
      });
    } finally { await f.dispose(); }
  });
}
