import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { AuthService, type AuthSessionEnvelope } from '../server/auth';
import { createApiHandler } from '../server/api';
import { MAX_BODY_BYTES, MAX_AUTH_BODY_BYTES } from '../server/http/body';
import { createCsrfToken } from '../server/middleware/csrf';
import { JsonWorkspaceRepository } from '../server/repository';
import {
  assertWorkspaceData, assertWorkspaceResourceBounds, checkedWarningPoints,
  WORKSPACE_INPUT_LIMITS, WorkspaceValidationError,
} from '../shared/validation/workspaceValidation';
import type { AppData } from '../src/store/types';
import { normalizeAppData, normalizeStudent } from '../src/store/utils';
import { D1WorkspaceRepository } from '../worker/repository';

// All data are synthetic. Counts stay small enough to run safely on the vulnerable code.
const NOW = 1_700_000_000_000;
const ORIGIN = 'https://epet.example.test';
const PASSWORD = 'synthetic M02 validation fixture password';
const CLASS_A = 'synthetic-class-a';
const CLASS_B = 'synthetic-private-class-b';
const PRIVATE_B = 'Synthetic private B learner M02';
type Adapter = 'node' | 'd1';
type Repository = JsonWorkspaceRepository | D1WorkspaceRepository;
type Client = AuthSessionEnvelope & { csrf: string };

const rawData = () => ({ currentClassId: CLASS_A, lastOpened: NOW, classes: [
  { id: CLASS_A, name: 'Synthetic Class A', students: [{ id: 'student-a', name: 'Synthetic Alice',
    points: 10, warningPoints: 2, pet: { type: 'cat', fullness: 80, happiness: 80, level: 1 } }] },
  { id: CLASS_B, name: 'Synthetic Class B', students: [{ id: 'student-b', name: PRIVATE_B,
    points: 22, pet: { type: 'dog', fullness: 70, happiness: 80, level: 2 } }] },
] });
const createData = (): AppData => JSON.parse(JSON.stringify(normalizeAppData(rawData(), NOW)));
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const invalid = (operation: () => unknown, message?: string) => assert.throws(operation,
  (error: unknown) => error instanceof WorkspaceValidationError && error.code === 'INVALID_APP_DATA', message);
const deepValue = (depth = WORKSPACE_INPUT_LIMITS.maxDepth + 5): unknown => {
  let value: unknown = 'synthetic leaf';
  for (let index = 0; index < depth; index++) value = { child: value };
  return value;
};
const withStudent = (data: AppData, change: (student: Record<string, unknown>) => void) => {
  const candidate = copy(data);
  change(candidate.classes[0].students[0] as unknown as Record<string, unknown>);
  return candidate;
};
const invalidCandidates = (base: AppData) => [
  ['negative warning count', withStudent(base, (student) => { student.warningPoints = -1; delete student.activeWarningTimestamps; })],
  ['fractional warning count', withStudent(base, (student) => { student.warningPoints = 1.5; delete student.activeWarningTimestamps; })],
  ['over-limit warning count', withStudent(base, (student) => {
    student.warningPoints = WORKSPACE_INPUT_LIMITS.maxWarningPoints + 1; delete student.activeWarningTimestamps;
  })],
  ['numeric string warning count', withStudent(base, (student) => { student.warningPoints = '2'; })],
  ['null warning count', withStudent(base, (student) => { student.warningPoints = null; })],
  ['wrong student name type', withStudent(base, (student) => { student.name = { value: 'synthetic' }; })],
  ['overlong string', withStudent(base, (student) => { student.name = 'x'.repeat(WORKSPACE_INPUT_LIMITS.maxString + 1); })],
  ['overlong student name', withStudent(base, (student) => { student.name = 'x'.repeat(201); })],
  ['negative student points', withStudent(base, (student) => { student.points = -1; })],
  ['numeric string student points', withStudent(base, (student) => { student.points = '17'; })],
  ['invalid pet boolean', withStudent(base, (student) => {
    student.pet = { ...(student.pet as Record<string, unknown>), isDead: 'false' };
  })],
  ['over-limit active warning timestamps', withStudent(base, (student) => {
    student.activeWarningTimestamps = Array(WORKSPACE_INPUT_LIMITS.maxWarningPoints + 1).fill(NOW);
  })],
  ['invalid warning timestamp type', withStudent(base, (student) => { student.activeWarningTimestamps = ['not-a-timestamp']; })],
  ['nested safety effect warning count', withStudent(base, (student) => {
    student.disciplineRecords = [{ id: 'synthetic-discipline', type: 'discipline', createdAt: NOW,
      safetyEffect: { before: { warningPoints: WORKSPACE_INPUT_LIMITS.maxWarningPoints + 1 } } }];
  })],
  ['negative setting', { ...copy(base), settings: { ...base.settings, feedCost: -1 } }],
  ['invalid setting boolean', { ...copy(base), settings: { ...base.settings, inclusiveMode: 'yes' } }],
  ['invalid exam score type', { ...copy(base), classes: base.classes.map((classroom, index) => index === 0
    ? { ...copy(classroom), examRecords: [{ id: 'synthetic-exam', title: 'Synthetic exam',
      items: [{ id: 'math', name: 'Math', maxScore: 100 }], results: [{ studentId: 'student-a', scores: { math: 'ninety' } }] }] }
    : copy(classroom)) }],
  ['deep extension', { ...copy(base), syntheticExtension: deepValue() }],
  ['wrong students container', { ...copy(base), classes: [{ ...copy(base.classes[0]), students: {} }] }],
] as const;

test('workspace schema rejects unsafe numeric values and warning counts before normalization', () => {
  const base = createData();
  for (const value of [-1, 1.5, '2', null, 1001, 1e12, NaN, Infinity, -Infinity]) {
    invalid(() => assertWorkspaceData(withStudent(base, (student) => {
      student.warningPoints = value; delete student.activeWarningTimestamps;
    })), `warningPoints=${String(value)}`);
  }
  for (const value of [NaN, Infinity, -Infinity, WORKSPACE_INPUT_LIMITS.maxNumber + 1]) {
    invalid(() => assertWorkspaceData(withStudent(base, (student) => { student.points = value; })));
  }
  for (const value of [-1, Infinity, WORKSPACE_INPUT_LIMITS.maxTimestamp + 1]) {
    invalid(() => assertWorkspaceData({ ...base, lastOpened: value }));
  }
  for (const [, candidate] of invalidCandidates(base)) invalid(() => assertWorkspaceData(candidate));
});

test('resource traversal enforces depth, width, arrays, strings, keys and aggregate node budgets', () => {
  const limits = WORKSPACE_INPUT_LIMITS;
  for (const value of [deepValue(), Array(limits.maxArray + 1).fill(0),
    'x'.repeat(limits.maxString + 1), { ['x'.repeat(limits.maxKey + 1)]: 0 },
    Object.fromEntries(Array.from({ length: limits.maxObjectKeys + 1 }, (_, index) => [`k${index}`, 0])),
    Array.from({ length: Math.ceil(limits.maxNodes / limits.maxArray) + 1 }, () => Array(limits.maxArray).fill(0)),
  ]) invalid(() => assertWorkspaceResourceBounds(value));
  const cyclic: { child?: unknown } = {}; cyclic.child = cyclic;
  invalid(() => assertWorkspaceResourceBounds(cyclic));
});

test('schema bounds class, student and aggregate synthetic warning timestamp allocations', () => {
  const limits = WORKSPACE_INPUT_LIMITS;
  const base = rawData();
  invalid(() => assertWorkspaceData({ ...base, classes: Array.from({ length: limits.maxClasses + 1 },
    (_, index) => ({ id: `class-${index}`, students: [] })) }));
  invalid(() => assertWorkspaceData({ ...base, classes: [{ id: CLASS_A,
    students: Array.from({ length: limits.maxStudentsPerClass + 1 }, (_, index) => ({ id: `student-${index}` })) }] }));
  invalid(() => assertWorkspaceData({ ...base, classes: Array.from({ length: 11 }, (_, classIndex) => ({
    id: `class-${classIndex}`, students: Array.from({ length: 500 }, (_, index) => ({ id: `student-${index}` })),
  })) }));
  invalid(() => assertWorkspaceData({ ...base, classes: [{ id: CLASS_A,
    students: Array.from({ length: 11 }, (_, index) => ({ id: `student-${index}`, warningPoints: 1000 })),
  }] }));
});

test('normalizer and direct count guard reject excessive allocation without constructing a large array', () => {
  invalid(() => checkedWarningPoints(1e12));
  invalid(() => normalizeStudent({ id: 'synthetic', warningPoints: 1001 }, 0, NOW));
  invalid(() => normalizeAppData({ currentClassId: CLASS_A, classes: [{ id: CLASS_A,
    students: [{ id: 'synthetic', warningPoints: 1001 }] }] }, NOW));
  const accepted = normalizeStudent({ id: 'synthetic', warningPoints: 3 }, 0, NOW);
  assert.deepEqual(accepted.activeWarningTimestamps, [NOW, NOW, NOW]);
  assert.equal(accepted.warningPoints, 3);
});

test('a synchronous Array.from sentinel proves huge numeric and numeric-string warning counts never reach allocation', () => {
  const original = Array.from;
  let forbiddenAllocations = 0;
  Array.from = ((...args: Parameters<typeof Array.from>) => {
    const source = args[0] as { length?: unknown } | null;
    if (source && !Array.isArray(source) && typeof source.length === 'number' && source.length > 1000) {
      forbiddenAllocations++;
      throw new Error('Synthetic test intercepted an unsafe array allocation');
    }
    return Reflect.apply(original, Array, args);
  }) as typeof Array.from;
  try {
    for (const warningPoints of [1e12, '1000000000000']) {
      invalid(() => normalizeStudent({ id: 'synthetic', warningPoints }, 0, NOW));
    }
    assert.equal(forbiddenAllocations, 0, 'the guard must throw the validation error before calling Array.from');
  } finally { Array.from = original; }
});

test('a mature synthetic workspace under 900 KiB remains valid before and after normalization', () => {
  const mature = { currentClassId: 'mature', lastOpened: NOW, classes: [{
    id: 'mature', name: 'Synthetic mature classroom',
    students: Array.from({ length: 10 }, (_, studentIndex) => ({
      id: `s-${studentIndex}`, name: `Synthetic learner ${studentIndex}`, points: studentIndex,
      pointAdjustmentRecords: Array.from({ length: 200 }, (_, recordIndex) => ({
        id: `p-${studentIndex}-${recordIndex}`, amount: recordIndex % 2 ? -1 : 2,
        source: 'manual', createdAt: NOW - recordIndex,
      })),
    })),
    learningEvidenceRecords: Array.from({ length: 2000 }, (_, index) => ({
      id: `e-${index}`, classId: 'mature', studentId: `s-${index % 10}`,
      competency: 'growth', level: 'progressing', evidenceType: 'observation',
      title: 'Synthetic observation', actor: 'mentor', source: 'manual', rubricVersion: '1.0',
      revision: 1, createdAt: NOW - index,
    })),
  }] };
  assert.ok(Buffer.byteLength(JSON.stringify(mature), 'utf8') < 900 * 1024);
  assert.doesNotThrow(() => assertWorkspaceData(mature));
  const normalized = normalizeAppData(mature, NOW);
  assert.equal(normalized.classes[0].learningEvidenceRecords?.length, 2000);
  assert.ok(normalized.classes[0].students.every((student) => student.pointAdjustmentRecords?.length === 200));
  assert.ok(Buffer.byteLength(JSON.stringify(normalized), 'utf8') < 900 * 1024);
  let nodes = 0;
  const pending: unknown[] = [normalized];
  while (pending.length) {
    const value = pending.pop(); nodes++;
    if (value && typeof value === 'object') pending.push(...Object.values(value));
  }
  assert.ok(nodes <= WORKSPACE_INPUT_LIMITS.maxNodes);
  assert.doesNotThrow(() => assertWorkspaceData(normalized));
});

test('legacy numeric-string migration accepts bounded decimals while strict API snapshots reject those same types', () => {
  const legacy = { currentClassId: CLASS_A, classes: [{ id: CLASS_A,
    students: [{ id: 'synthetic-legacy', warningPoints: '2', points: '17' }],
    activeBoss: { id: 'synthetic-boss', name: 'Synthetic old boss', maxHp: '50.8', currentHp: '40.2',
      contributions: { 'synthetic-legacy': '2.9' }, attackCounts: { 'synthetic-legacy': '1' } },
  }] };
  assert.doesNotThrow(() => assertWorkspaceData(legacy, 'legacy'));
  invalid(() => assertWorkspaceData(legacy));
  const normalized = normalizeAppData(legacy, NOW);
  assert.equal(normalized.classes[0].students[0].points, 17);
  assert.equal(normalized.classes[0].students[0].activeWarningTimestamps?.length, 2);
  assert.equal(normalized.classes[0].activeBoss?.maxHp, 50);
  assert.equal(normalized.classes[0].activeBoss?.currentHp, 40);
  assert.doesNotThrow(() => assertWorkspaceData(normalized));
});

test('legacy missing defaults and signed point adjustments remain compatible with the bounded contract', () => {
  const legacy = { currentClassId: CLASS_A, classes: [{ id: CLASS_A, students: [{ id: 'synthetic-legacy',
    warningPoints: 2, pointAdjustmentRecords: [{ id: 'synthetic-adjustment', amount: -4, requestedAmount: -7,
      source: 'manual', createdAt: NOW }] }] }] };
  assert.doesNotThrow(() => assertWorkspaceData(legacy));
  assert.doesNotThrow(() => assertWorkspaceData({ students: [{ name: 'Synthetic old backup', warningPoints: 2 }] }, 'legacy'));
  const normalized = normalizeAppData(legacy, NOW);
  assert.equal(normalized.classes[0].students[0].warningPoints, 2);
  assert.equal(normalized.classes[0].students[0].activeWarningTimestamps?.length, 2);
  assert.equal(normalized.classes[0].students[0].pointAdjustmentRecords?.[0].amount, -4);
  assert.equal(normalized.classes[0].students[0].pet.type, 'egg');
  const legacyTeam = `legacy-team-${'a'.repeat(200)}-${'b'.repeat(200)}`;
  assert.doesNotThrow(() => assertWorkspaceData({ currentClassId: CLASS_A,
    settings: { feedbackReasonHistory: ['Synthetic old label', { label: 'Synthetic new label', competency: 'growth' }] },
    classes: [{ id: CLASS_A, students: [{ id: 'a'.repeat(200), teamId: legacyTeam }] }] }));
  assert.equal(normalizeStudent({ warningPoints: '2' }, 0, NOW).activeWarningTimestamps?.length, 2,
    'the direct legacy normalizer may still coerce a safely bounded old count');
});

const migrationPaths = ['0001_create_workspaces.sql', '0002_auth_rbac.sql', '0003_core_entities.sql',
  '0004_workspace_class_assignments.sql', '0005_workspace_invitations.sql',
  '0006_projection_read_model.sql', '0007_email_verification.sql'];
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
        script: 'export default { fetch() { return new Response("synthetic M02 fixture"); } }' });
      database = await miniflare.getD1Database('DB') as unknown as D1Database;
      dispose = () => miniflare.dispose(); await applyMigrations(database);
      repository = new D1WorkspaceRepository(database, { readMode: 'normalized' });
    } else {
      const directory = await mkdtemp(join(tmpdir(), 'epet-M02-'));
      filePath = join(directory, 'data.json'); repository = new JsonWorkspaceRepository(filePath);
      dispose = () => rm(directory, { recursive: true, force: true });
    }
    const auth = new AuthService(repository, { passwordIterations: 10 });
    const client = (session: AuthSessionEnvelope): Client => ({ ...session, csrf: createCsrfToken() });
    const owner = client(await auth.register({ email: 'm02-owner@example.test', password: PASSWORD,
      displayName: 'Synthetic Owner', workspaceName: 'Synthetic M02 Workspace', initialWorkspaceData: createData() }));
    const workspaceId = owner.session.activeWorkspaceId!;
    const invitation = await auth.createWorkspaceInvitation(owner.sessionToken, workspaceId,
      'm02-teacher@example.test', 'teacher', [CLASS_A]);
    const teacher = client(await auth.acceptWorkspaceInvitation(invitation.token, 'Synthetic Teacher', PASSWORD));
    const options = { auth: { passwordIterations: 10 }, registrationEnabled: true,
      clientIdentity: (request: Request) => request.headers.get('x-synthetic-client') ?? 'synthetic-default' };
    let handler = createApiHandler(repository, options);
    const request = (path: string, method = 'GET', body?: unknown, who = owner, rawBody?: string,
      extraHeaders: Record<string, string> = {}) => handler(new Request(`${ORIGIN}/api/v1${path}`, {
      method, headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-epet-workspace': workspaceId,
        cookie: `__Host-epet_session=${who.sessionToken}; __Host-epet_csrf=${who.csrf}`,
        'x-csrf-token': who.csrf, ...extraHeaders },
      ...(body === undefined && rawBody === undefined ? {} : { body: rawBody ?? JSON.stringify(body) }),
    }));
    const poisonHistory = async (data: unknown) => {
      const current = await repository.get(workspaceId);
      if (database) {
        const serialized = JSON.stringify(data);
        await database.prepare('UPDATE workspace_revisions SET data_json = ?, data_size_bytes = ? WHERE workspace_id = ? AND revision = ?')
          .bind(serialized, Buffer.byteLength(serialized, 'utf8'), workspaceId, current.revision).run();
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
    const projection = async () => {
      if (!database) return undefined;
      const result: Record<string, unknown> = {};
      for (const table of ['workspaces', 'workspace_revisions', 'workspace_projection_state', 'workspace_projection_documents',
        'classes', 'students', 'exam_records', 'exam_results', 'learning_evidence',
        'point_adjustments', 'discipline_records', 'boss_rewards']) {
        const rows = await database.prepare(`SELECT * FROM ${table} WHERE workspace_id = ?`).bind(workspaceId).all();
        result[table] = rows.results.map((row) => JSON.stringify(row)).sort();
      }
      return result;
    };
    const inventory = async () => {
      if (database) {
        const users = await database.prepare('SELECT user_id FROM users ORDER BY user_id').all();
        const workspaces = await database.prepare('SELECT workspace_id FROM workspaces ORDER BY workspace_id').all();
        return { users: users.results, workspaces: workspaces.results };
      }
      const raw = JSON.parse(await readFile(filePath!, 'utf8'));
      return { users: Object.keys(raw.users).sort(), workspaces: Object.keys(raw.workspaces).sort() };
    };
    const snapshot = async () => {
      const revisions = await repository.listWorkspaceRevisions(workspaceId);
      return copy({ workspace: await repository.get(workspaceId), revisions,
        history: await Promise.all(revisions.map((item) => repository.getWorkspaceRevision(workspaceId, item.revision))),
        audit: await repository.listWorkspaceAuditEvents(workspaceId, { limit: 200 }), projection: await projection(),
        inventory: await inventory() });
    };
    return { get repository() { return repository; }, database, auth, owner, teacher, workspaceId,
      request, snapshot, poisonHistory, dispose };
  } catch (error) { await dispose?.(); throw error; }
};
type Fixture = Awaited<ReturnType<typeof createFixture>>;
const assertValidationResponse = async (response: Response, label: string) => {
  const text = await response.text();
  assert.equal(response.status, 400, `${label}: ${text}`);
  assert.deepEqual(JSON.parse(text), { error: 'INVALID_APP_DATA' }, label);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(!text.includes(PRIVATE_B));
};
const importBody = (data: unknown, expectedRevision: number) => ({ data, expectedRevision,
  confirmation: 'IMPORT WORKSPACE', acknowledgeReplacement: true });
const scopeA = (data: AppData) => ({ ...copy(data), currentClassId: CLASS_A,
  classes: copy(data.classes.filter((item) => item.id === CLASS_A)) });

for (const adapter of ['node', 'd1'] as const) {
  test(`${adapter}: bounded validation rejects invalid State PUT, Import and register with no partial workspace write`, async (t) => {
    const f = await createFixture(adapter);
    try {
      await t.test('owner and scoped teacher State PUT reject the same malformed values before any repository write', async () => {
        const before = await f.snapshot();
        const put = f.repository.put.bind(f.repository);
        let writes = 0;
        f.repository.put = async (...args) => { writes++; return put(...args); };
        for (const [role, who, base] of [['owner', f.owner, before.workspace.data!],
          ['teacher', f.teacher, scopeA(before.workspace.data!)]] as const) {
          for (const [label, data] of invalidCandidates(base)) {
            await assertValidationResponse(await f.request('/state', 'PUT',
              { data, baseRevision: before.workspace.revision }, who), `${role}: ${label}`);
          }
          const body = JSON.stringify({ data: withStudent(base, (student) => { student.warningPoints = '__NONFINITE__'; }),
            baseRevision: before.workspace.revision }).replace('"__NONFINITE__"', '1e999');
          await assertValidationResponse(await f.request('/state', 'PUT', undefined, who, body), `${role}: parsed Infinity`);
        }
        assert.equal(writes, 0, 'invalid data must be rejected before repository.put');
        assert.deepEqual(await f.snapshot(), before);
        f.repository.put = put;
      });
      await t.test('explicit import uses the same safe validation policy and never purges history on failure', async () => {
        const before = await f.snapshot();
        for (const [label, data] of invalidCandidates(before.workspace.data!)) {
          await assertValidationResponse(await f.request('/workspace/import', 'POST',
            importBody(data, before.workspace.revision)), label);
        }
        assert.deepEqual(await f.snapshot(), before);
      });
      await t.test('invalid registration data fail before user or workspace creation instead of silently creating a default', async () => {
        const before = await f.snapshot();
        let index = 0;
        for (const [label, data] of [['null initial workspace', null], ['wrong initial workspace', { classes: 'wrong' }],
          ...invalidCandidates(rawData() as unknown as AppData)] as const) {
          const email = `m02-invalid-${index}@example.test`;
          const body = { email, password: PASSWORD, displayName: 'Synthetic Invalid Owner',
            workspaceName: 'Synthetic Invalid Workspace', initialWorkspaceData: data };
          assert.ok(Buffer.byteLength(JSON.stringify(body), 'utf8') < MAX_AUTH_BODY_BYTES, `small auth payload: ${label}`);
          const response = await f.request('/auth/register', 'POST', body,
          f.owner, undefined, { 'x-synthetic-client': `synthetic-registration-${index++}` });
          await assertValidationResponse(response, label);
          assert.equal(await f.repository.findUserByNormalizedEmail(email), null, `no partial user: ${label}`);
        }
        assert.deepEqual(await f.snapshot(), before);
      });
      await t.test('direct repository writes independently reject invalid data without blob, projection, history or audit changes', async () => {
        const before = await f.snapshot();
        const data = withStudent(before.workspace.data!, (student) => { student.warningPoints = 1001; delete student.activeWarningTimestamps; });
        await assert.rejects(f.repository.put(f.workspaceId, data, before.workspace.revision,
          { actorUserId: f.owner.session.user.id, action: 'synthetic.invalid.put' }), WorkspaceValidationError);
        assert.deepEqual(await f.snapshot(), before);
      });
      await t.test('existing body byte limits stay enforced independently of field validation', async () => {
        assert.equal(MAX_BODY_BYTES, 2 * 1024 * 1024);
        assert.equal(MAX_AUTH_BODY_BYTES, 16 * 1024);
        const before = await f.snapshot();
        const response = await f.request('/state', 'PUT', { data: before.workspace.data }, f.owner, undefined,
          { 'content-length': String(MAX_BODY_BYTES + 1) });
        assert.equal(response.status, 413);
        assert.deepEqual(await response.json(), { error: 'PAYLOAD_TOO_LARGE',
          limitBytes: MAX_BODY_BYTES, limitKind: 'request_body' });
        assert.deepEqual(await f.snapshot(), before);
      });
    } finally { await f.dispose(); }
  });

  test(`${adapter}: invalid historical snapshots are retained and cannot be restored or partially written`, async () => {
    const f = await createFixture(adapter);
    try {
      const original = (await f.repository.get(f.workspaceId)).data!;
      const source = withStudent(original, (student) => { student.warningPoints = 1001; delete student.activeWarningTimestamps; });
      const revision = await f.poisonHistory(source);
      const before = await f.snapshot();
      await assertValidationResponse(await f.request(`/revisions/${revision}/restore`, 'POST', {}), 'historical warning count');
      assert.deepEqual(await f.snapshot(), before, 'rejecting old data must preserve both original history and current state');
      const retained = await f.repository.getWorkspaceRevision(f.workspaceId, revision);
      assert.deepEqual(copy(retained!.data), source, 'over-limit historical source must not be silently dropped or truncated');
    } finally { await f.dispose(); }
  });

  test(`${adapter}: an over-limit legacy history cannot block privacy deletion of a different student`, async () => {
    const f = await createFixture(adapter);
    try {
      const original = copy((await f.repository.get(f.workspaceId)).data!);
      const historicalSource = withStudent(original, (student) => {
        student.warningPoints = 1001; delete student.activeWarningTimestamps;
      });
      const sourceRevision = await f.poisonHistory(historicalSource);
      // Current state is corrected and valid; only the retained source has old out-of-policy data.
      const corrected = await f.repository.put(f.workspaceId, original, sourceRevision);
      const response = await f.request(`/classes/${CLASS_B}/students/student-b/privacy/delete`, 'POST', {
        expectedRevision: corrected.revision, confirmation: 'DELETE STUDENT',
      });
      assert.equal(response.status, 200, await response.clone().text());
      assert.ok(!(await response.text()).includes(PRIVATE_B));
      const current = await f.repository.get(f.workspaceId);
      assert.equal(current.revision, corrected.revision + 1);
      assert.equal(current.data!.classes.find((classroom) => classroom.id === CLASS_B)?.students.length, 0);
      assert.deepEqual(copy(current.data!.classes.find((classroom) => classroom.id === CLASS_A)),
        original.classes.find((classroom) => classroom.id === CLASS_A));
      for (const revision of await f.repository.listWorkspaceRevisions(f.workspaceId)) {
        const snapshot = await f.repository.getWorkspaceRevision(f.workspaceId, revision.revision);
        assert.ok(snapshot);
        assert.equal(snapshot.data.classes.find((classroom) => classroom.id === CLASS_B)?.students.length, 0,
          `deleted B retained in history ${revision.revision}`);
        assert.ok(!JSON.stringify(snapshot.data).includes(PRIVATE_B));
      }
      const retained = await f.repository.getWorkspaceRevision(f.workspaceId, sourceRevision);
      assert.deepEqual(copy(retained!.data.classes.find((classroom) => classroom.id === CLASS_A)),
        historicalSource.classes.find((classroom) => classroom.id === CLASS_A),
        'the unrelated over-limit legacy student must remain exact, without truncation or coercion');
      const beforeRestore = await f.snapshot();
      await assertValidationResponse(await f.request(`/revisions/${sourceRevision}/restore`, 'POST', {}),
        'retained over-limit history after privacy deletion');
      assert.deepEqual(await f.snapshot(), beforeRestore);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: valid legacy snapshots still import, sync for a scoped teacher, restore and reload`, async () => {
    const f = await createFixture(adapter);
    try {
      const legacy = rawData();
      delete (legacy.classes[0].students[0] as { pet?: unknown }).pet;
      const before = await f.repository.get(f.workspaceId);
      const imported = await f.request('/workspace/import', 'POST', importBody(legacy, before.revision));
      assert.equal(imported.status, 200, await imported.clone().text());
      const saved = await imported.json() as { data: AppData; revision: number };
      assert.equal(saved.data.classes[0].students[0].warningPoints, 2);
      assert.equal(saved.data.classes[0].students[0].activeWarningTimestamps?.length, 2);
      assert.equal(saved.data.classes[0].students[0].pet.type, 'egg');
      const b = copy(saved.data.classes.find((item) => item.id === CLASS_B));
      const scoped = scopeA(saved.data);
      scoped.classes[0].students[0].points += 1;
      const update = await f.request('/state', 'PUT', { data: scoped, baseRevision: saved.revision }, f.teacher);
      assert.equal(update.status, 200, await update.clone().text());
      assert.ok(!(await update.text()).includes(PRIVATE_B));
      const current = await f.repository.get(f.workspaceId);
      assert.deepEqual(copy(current.data!.classes.find((item) => item.id === CLASS_B)), b);
      const restore = await f.request(`/revisions/${saved.revision}/restore`, 'POST', {});
      assert.equal(restore.status, 200, await restore.clone().text());
      const restored = await restore.json() as { data: AppData; revision: number };
      assert.equal(restored.data.classes[0].students[0].points, saved.data.classes[0].students[0].points);
      assert.deepEqual(copy((await f.repository.get(f.workspaceId)).data), restored.data);
      if (f.database) assert.equal((await (f.repository as D1WorkspaceRepository)
        .reconcileWorkspaceProjection(f.workspaceId, false)).status, 'verified');
    } finally { await f.dispose(); }
  });
}
