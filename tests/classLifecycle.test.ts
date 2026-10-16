import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createApiHandler } from '../server/api';
import { AuthService, type AuthorizedWorkspace } from '../server/auth';
import type { StoredWorkspace, WorkspaceRole, WorkspaceWriteContext } from '../server/contracts';
import { errorResponse } from '../server/middleware/errorResponse';
import { JsonWorkspaceRepository } from '../server/repository';
import { handleBossRoutes } from '../server/routes/bossRoutes';
import { handleClassRoutes } from '../server/routes/classRoutes';
import { handleLearningRoutes } from '../server/routes/learningRoutes';
import { handleWorkspaceRoutes } from '../server/routes/workspaceRoutes';
import type { RouteHandler, WorkspaceRouteContext } from '../server/routes/types';
import { protectClassLifecycleWrite } from '../server/workspaceScope';
import { CLASS_DELETE_CONFIRMATION, deleteClassFromWorkspace, findActiveClassIndex,
  getClassDeletionImpact, getClassLifecycleStatus,
  updateClassArchive } from '../shared/domain/classArchive';
import { anonymizeStudentInWorkspaceData } from '../shared/domain/studentPrivacy';
import type { AppData, WorldBoss } from '../src/store/types';
import { normalizeAppData } from '../src/store/utils';

const now = Date.parse('2026-10-14T01:00:00Z');
const createData = (): AppData => JSON.parse(JSON.stringify(normalizeAppData({
  lastOpened: now, currentClassId: 'class-a', settings: { language: 'zh', maxPoints: 700 },
  classes: [{
    id: 'class-a', name: 'Synthetic class A',
    students: [{ id: 'student-a', name: 'Synthetic learner A', points: 210,
      pet: { type: 'dog', level: 2, fullness: 80, happiness: 70 },
      stats: { wins: 2, losses: 1 } }],
    learningEvidenceRecords: [{ id: 'evidence-a', classId: 'class-a', studentId: 'student-a',
      competency: 'participation', level: 'mastered', evidenceType: 'observation',
      title: 'Synthetic retained observation', actor: 'mentor', source: 'manual',
      rubricVersion: '1.0', revision: 1, createdAt: now }],
    examRecords: [{ id: 'exam-a', title: 'Synthetic assessment', examDate: '2026-10-14',
      items: [{ id: 'math', name: 'Math', maxScore: 100 }],
      results: [{ studentId: 'student-a', scores: { math: 87 }, updatedAt: now }],
      createdAt: now, updatedAt: now }],
    activeBoss: { id: 'boss-a', name: 'Synthetic boss', maxHp: 100, currentHp: 1,
      isActive: true, contributions: { 'student-a': 25 }, attackCounts: { 'student-a': 1 },
      rewardTiers: [{ rank: 1, points: 10, happiness: 2, rankPoints: 3 }] },
  }, { id: 'class-b', name: 'Synthetic class B',
    students: [{ id: 'student-b', name: 'Synthetic learner B', points: 220,
      pet: { type: 'cat', level: 3, fullness: 90, happiness: 60 } }] }],
}, now))) as AppData;

class LifecycleRepository extends JsonWorkspaceRepository {
  reads = 0;
  writes: Array<{ data: AppData; baseRevision?: number; context?: WorkspaceWriteContext }> = [];
  raceData: AppData | undefined;
  override async get(workspaceId: string): Promise<StoredWorkspace> {
    this.reads += 1;
    return super.get(workspaceId);
  }
  override async put(workspaceId: string, data: AppData, baseRevision?: number,
    context?: WorkspaceWriteContext): Promise<StoredWorkspace> {
    this.writes.push({ data, baseRevision, context });
    if (this.raceData) {
      const replacement = this.raceData;
      this.raceData = undefined;
      await super.put(workspaceId, replacement, baseRevision, { action: 'fixture.concurrent' });
    }
    return super.put(workspaceId, data, baseRevision, context);
  }
}

const createFixture = async () => {
  const root = join(process.cwd(), 'output', 'privacy-unit');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'class-lifecycle-'));
  try {
    const repository = new LifecycleRepository(join(directory, 'data.json'));
    const authService = new AuthService(repository, { passwordIterations: 10 });
    const owner = await authService.register({ email: 'lifecycle-owner@example.test',
      password: 'synthetic lifecycle fixture password', displayName: 'Fixture Owner',
      workspaceName: 'Lifecycle fixture', initialWorkspaceData: createData() });
    const workspaceId = owner.session.activeWorkspaceId;
    assert.ok(workspaceId);
    const authorized = await authService.authorizeWorkspace(owner.sessionToken, workspaceId);
    repository.reads = 0;
    repository.writes = [];
    const context = (path: string, body?: unknown, role: WorkspaceRole = 'owner', method = 'POST') => {
      const url = new URL(`http://localhost${path}`);
      const request = new Request(url, { method, headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const roleAuthorization: AuthorizedWorkspace = {
        ...authorized, membership: { ...authorized.membership, role },
      };
      return { request, url, headers: {}, repository, authService, workspaceId,
        token: owner.sessionToken, authorized: roleAuthorization,
        getClassScope: async () => ['teacher', 'viewer'].includes(role)
          ? new Set(['class-a', 'class-b']) : null,
        requireClassAccess: async () => undefined,
      } satisfies WorkspaceRouteContext;
    };
    const handler = createApiHandler(repository, { auth: { passwordIterations: 10 } });
    const api = (path: string, body?: unknown, options: {
      token?: string; workspaceId?: string; csrf?: boolean; origin?: string | null; method?: string;
    } = {}) => {
      const csrf = 'a'.repeat(43);
      return handler(new Request(`http://localhost${path}`, {
        method: options.method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { 'content-type': 'application/json',
          ...(options.origin === null ? {} : { origin: options.origin ?? 'http://localhost' }),
          cookie: `__Host-epet_session=${options.token ?? owner.sessionToken}; __Host-epet_csrf=${csrf}`,
          ...(options.csrf === false ? {} : { 'x-csrf-token': csrf }),
          'x-epet-workspace': options.workspaceId ?? workspaceId },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
    };
    return { repository, authService, owner, authorized, workspaceId, context, api,
      dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

const dispatch = async (handler: RouteHandler<WorkspaceRouteContext>, context: WorkspaceRouteContext) => {
  try {
    const response = await handler(context);
    assert.ok(response);
    return response;
  } catch (error) { return errorResponse(error, context.headers); }
};
const deleteBody = (expectedRevision = 1) => ({ expectedRevision,
  confirmation: CLASS_DELETE_CONFIRMATION, acknowledgePermanentDeletion: true });
const deletePath = '/api/v1/classes/class-a/privacy/delete';

test('lifecycle status remains derived and deletion preserves other classes without mutating inputs', () => {
  const data = createData();
  const original = structuredClone(data);
  assert.equal(getClassLifecycleStatus(data.classes[0]), 'active');
  const archive = updateClassArchive(data, 'class-a', 'archive', now);
  assert.equal(getClassLifecycleStatus(archive.classes[0]), 'archived');
  assert.equal(findActiveClassIndex(archive), 1);
  assert.equal(findActiveClassIndex(archive, 'class-a'), -1);
  assert.equal(findActiveClassIndex(archive, 'missing'), -1);
  assert.deepEqual(getClassDeletionImpact(archive.classes[0]), {
    studentCount: 1, evidenceCount: 1, examCount: 1,
  });
  const deleted = deleteClassFromWorkspace(archive, 'class-a');
  assert.deepEqual(deleted.classes, [data.classes[1]]);
  assert.equal(deleted.classes[0], data.classes[1]);
  assert.equal(deleted.currentClassId, 'class-b');
  assert.equal(deleted.settings, data.settings);
  assert.deepEqual(data, original);
  assert.throws(() => deleteClassFromWorkspace(archive, 'class-b'), /LAST_ACTIVE_CLASS/);
  assert.throws(() => deleteClassFromWorkspace(archive, 'missing'), /CLASS_NOT_FOUND/);
});

test('delete requires admin authority before parsing bodies or reading data', async () => {
  const fixture = await createFixture();
  try {
    for (const role of ['teacher', 'viewer'] as const) {
      const context = fixture.context(deletePath, deleteBody(), role);
      context.request = new Request(context.url, { method: 'POST', body: '{invalid-json' });
      const response = await dispatch(handleClassRoutes, context);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'FORBIDDEN' });
    }
    assert.equal(fixture.repository.reads, 0);
    assert.equal(fixture.repository.writes.length, 0);
  } finally { await fixture.dispose(); }
});

test('permanent class deletion needs exact typed confirmation and separate boolean acknowledgement', async () => {
  const fixture = await createFixture();
  try {
    for (const confirmation of [undefined, 'delete class', 'DELETE CLASS ', 'ARCHIVE CLASS']) {
      const response = await dispatch(handleClassRoutes, fixture.context(deletePath,
        { ...deleteBody(), confirmation }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'CONFIRMATION_REQUIRED' });
    }
    for (const acknowledgePermanentDeletion of [undefined, false, 'true', 1, {}]) {
      const response = await dispatch(handleClassRoutes, fixture.context(deletePath,
        { ...deleteBody(), acknowledgePermanentDeletion }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'PERMANENT_DELETION_ACKNOWLEDGEMENT_REQUIRED' });
    }
    assert.equal(fixture.repository.reads, 0);
    assert.equal(fixture.repository.writes.length, 0);
  } finally { await fixture.dispose(); }
});

test('delete rejects unsafe revisions before reading or mutating the workspace', async () => {
  const fixture = await createFixture();
  try {
    for (const expectedRevision of [undefined, null, '1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const response = await dispatch(handleClassRoutes, fixture.context(deletePath,
        { ...deleteBody(), expectedRevision }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'BASE_REVISION_REQUIRED' });
    }
    assert.equal(fixture.repository.reads, 0);
    assert.equal(fixture.repository.writes.length, 0);
  } finally { await fixture.dispose(); }
});

test('admin and owner delete through one audited CAS write with no student data in the audit', async () => {
  for (const role of ['admin', 'owner'] as const) {
    const fixture = await createFixture();
    try {
      const before = await fixture.repository.get(fixture.workspaceId);
      const response = await dispatch(handleClassRoutes, fixture.context(deletePath, deleteBody(), role));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json() as StoredWorkspace & { action: string };
      assert.equal(result.action, 'delete');
      assert.equal(result.revision, 2);
      assert.deepEqual(result.data?.classes, [before.data?.classes[1]]);
      assert.equal(result.data?.currentClassId, 'class-b');
      assert.equal(fixture.repository.writes.length, 1);
      assert.equal(fixture.repository.writes[0].baseRevision, 1);
      assert.equal(fixture.repository.writes[0].context?.action, 'class.privacy.delete');
      assert.equal(fixture.repository.writes[0].context?.actorUserId, fixture.authorized.user.id);
      const audit = await fixture.repository.listWorkspaceAuditEvents(fixture.workspaceId,
        { action: 'class.privacy.delete' });
      assert.equal(audit.length, 1);
      assert.equal(JSON.stringify(audit).includes('Synthetic learner'), false);
      assert.equal(JSON.stringify(audit).includes('student-a'), false);
      assert.equal(JSON.stringify(audit).includes(fixture.owner.sessionToken), false);
      const repeated = await dispatch(handleClassRoutes, fixture.context(deletePath, deleteBody(2), role));
      assert.equal(repeated.status, 404);
      assert.equal(fixture.repository.writes.length, 1);
    } finally { await fixture.dispose(); }
  }
});

test('delete refuses missing targets, stale data and the only active class but allows deleting an archive', async () => {
  const fixture = await createFixture();
  try {
    assert.equal((await dispatch(handleClassRoutes,
      fixture.context('/api/v1/classes/missing/privacy/delete', deleteBody()))).status, 404);
    assert.equal((await dispatch(handleClassRoutes,
      fixture.context(deletePath, deleteBody(0)))).status, 409);
    const archived = await fixture.repository.put(fixture.workspaceId,
      updateClassArchive(createData(), 'class-a', 'archive', now), 1);
    const last = await dispatch(handleClassRoutes,
      fixture.context('/api/v1/classes/class-b/privacy/delete', deleteBody(archived.revision)));
    assert.equal(last.status, 409);
    assert.deepEqual(await last.json(), { error: 'LAST_ACTIVE_CLASS' });
    const response = await dispatch(handleClassRoutes, fixture.context(deletePath, deleteBody(archived.revision)));
    assert.equal(response.status, 200);
    assert.equal((await response.json() as StoredWorkspace).data?.classes.length, 1);
  } finally { await fixture.dispose(); }
});

test('a concurrent repository update wins over delete without an extra sensitive action audit', async () => {
  const fixture = await createFixture();
  try {
    const concurrent = createData();
    concurrent.classes[0].students[0].points += 1;
    fixture.repository.raceData = concurrent;
    const response = await dispatch(handleClassRoutes, fixture.context(deletePath, deleteBody()));
    assert.equal(response.status, 409);
    const saved = await fixture.repository.get(fixture.workspaceId);
    assert.equal(saved.revision, 2);
    assert.equal(saved.data?.classes.length, 2);
    assert.equal(saved.data?.classes[0].students[0].points, 211);
    assert.deepEqual(await fixture.repository.listWorkspaceAuditEvents(fixture.workspaceId,
      { action: 'class.privacy.delete' }), []);
  } finally { await fixture.dispose(); }
});

test('the API protects every lifecycle transition with Origin, CSRF and tenant authorization', async () => {
  const fixture = await createFixture();
  try {
    const foreign = await fixture.authService.register({ email: 'foreign-lifecycle@example.test',
      password: 'synthetic foreign lifecycle password', displayName: 'Foreign Fixture Owner',
      workspaceName: 'Foreign fixture', initialWorkspaceData: createData() });
    const foreignId = foreign.session.activeWorkspaceId;
    assert.ok(foreignId);
    fixture.repository.writes = [];
    const operations = [['archive', { expectedRevision: 1, confirmation: 'ARCHIVE CLASS' }],
      ['reopen', { expectedRevision: 1, confirmation: 'REOPEN CLASS' }], ['delete', deleteBody()]] as const;
    for (const [action, body] of operations) {
      const path = `/api/v1/classes/class-a/privacy/${action}`;
      for (const [options, error] of [
        [{ csrf: false }, 'CSRF_INVALID'], [{ origin: null }, 'ORIGIN_REQUIRED'],
        [{ origin: 'https://attacker.example.test' }, 'ORIGIN_NOT_ALLOWED'],
        [{ workspaceId: foreignId }, 'FORBIDDEN'],
      ] as const) {
        const response = await fixture.api(path, body, options);
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error });
      }
    }
    assert.equal(fixture.repository.writes.length, 0);
    assert.equal((await fixture.repository.get(fixture.workspaceId)).revision, 1);
    assert.equal((await fixture.repository.get(foreignId)).revision, 1);
  } finally { await fixture.dispose(); }
});

test('owner and admin cannot bypass class deletion or archive transitions through ordinary state PUT', async () => {
  const fixture = await createFixture();
  try {
    for (const role of ['owner', 'admin'] as const) {
      for (const mutate of [
        (data: AppData) => { data.classes.splice(0, 1); data.currentClassId = 'class-b'; },
        (data: AppData) => { data.classes[0].archivedAt = now; },
        (data: AppData) => { data.classes.push({ id: 'class-c', name: 'New archive', students: [], archivedAt: now }); },
      ]) {
        const draft = createData();
        mutate(draft);
        const response = await dispatch(handleWorkspaceRoutes,
          fixture.context('/api/v1/state', { data: draft, baseRevision: 1 }, role, 'PUT'));
        assert.equal(response.status, 403);
      }
    }
    assert.equal(fixture.repository.writes.length, 0);
  } finally { await fixture.dispose(); }
});

test('all writable roles reject archived points, battle, boss, evidence, exam and metadata mutations', async () => {
  const fixture = await createFixture();
  try {
    const archived = updateClassArchive(createData(), 'class-a', 'archive', now);
    await fixture.repository.put(fixture.workspaceId, archived, 1);
    fixture.repository.writes = [];
    for (const role of ['teacher', 'admin', 'owner'] as const) {
      for (const mutate of [
        (data: AppData) => { data.classes[0].students[0].points += 1; },
        (data: AppData) => { data.classes[0].students[0].stats!.wins += 1; },
        (data: AppData) => { data.classes[0].activeBoss!.currentHp = 20; },
        (data: AppData) => { data.classes[0].learningEvidenceRecords![0].title = 'changed'; },
        (data: AppData) => { data.classes[0].examRecords![0].results[0].scores.math = 99; },
        (data: AppData) => { delete data.classes[0].archivedAt; },
      ]) {
        const draft = structuredClone(archived);
        mutate(draft);
        const response = await dispatch(handleWorkspaceRoutes,
          fixture.context('/api/v1/state', { data: draft, baseRevision: 2 }, role, 'PUT'));
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: 'CLASS_ARCHIVE_CHANGED' });
      }
    }
    assert.equal(fixture.repository.writes.length, 0);
    assert.deepEqual((await fixture.repository.get(fixture.workspaceId)).data, archived);
  } finally { await fixture.dispose(); }
});

test('archive normalization shape drift permits active writes while retaining the trusted historical snapshot', async () => {
  const fixture = await createFixture();
  try {
    const archived = updateClassArchive(createData(), 'class-a', 'archive', now);
    const current = anonymizeStudentInWorkspaceData(archived, 'student-a', 'anonymous-fixture');
    await fixture.repository.put(fixture.workspaceId, current, 1);
    const rawDraft = structuredClone(current);
    rawDraft.classes[1].students[0].points += 1;
    assert.equal((await dispatch(handleWorkspaceRoutes,
      fixture.context('/api/v1/state', { data: rawDraft, baseRevision: 2 }, 'owner', 'PUT'))).status, 200);
    const saved = await fixture.repository.get(fixture.workspaceId);
    assert.deepEqual(saved.data?.classes[0], current.classes[0]);
    const normalizedDraft = normalizeAppData(saved.data, now + 86_400_000);
    normalizedDraft.classes[1].students[0].points += 1;
    assert.equal((await dispatch(handleWorkspaceRoutes,
      fixture.context('/api/v1/state', { data: normalizedDraft, baseRevision: 3 }, 'admin', 'PUT'))).status, 200);
    assert.deepEqual((await fixture.repository.get(fixture.workspaceId)).data?.classes[0], current.classes[0]);
  } finally { await fixture.dispose(); }
});

test('admin active edits, class creation and settings retain the optional base-revision contract', async () => {
  const fixture = await createFixture();
  try {
    const draft = createData();
    draft.classes[0].students[0].points += 1;
    draft.classes.push({ id: 'class-c', name: 'New active class', students: [] });
    draft.settings = { ...draft.settings, language: 'en' };
    const response = await dispatch(handleWorkspaceRoutes,
      fixture.context('/api/v1/state', { data: draft }, 'admin', 'PUT'));
    assert.equal(response.status, 200);
    assert.equal(fixture.repository.writes[0].baseRevision, 1);
    const saved = await response.json() as StoredWorkspace;
    assert.equal(saved.data?.classes[0].students[0].points, 211);
    assert.equal(saved.data?.classes.length, 3);
    assert.equal(saved.data?.settings?.language, 'en');
  } finally { await fixture.dispose(); }
});

test('implicit admin CAS prevents a race that archives a class after ordinary PUT validation', async () => {
  const fixture = await createFixture();
  try {
    const draft = createData();
    draft.classes[0].students[0].points += 5;
    fixture.repository.raceData = updateClassArchive(createData(), 'class-a', 'archive', now);
    const response = await dispatch(handleWorkspaceRoutes,
      fixture.context('/api/v1/state', { data: draft }, 'owner', 'PUT'));
    assert.equal(response.status, 409);
    const saved = await fixture.repository.get(fixture.workspaceId);
    assert.equal(saved.data?.classes[0].archivedAt, now);
    assert.equal(saved.data?.classes[0].students[0].points, 210);
  } finally { await fixture.dispose(); }
});

test('a stale pre-archive state PUT reports a revision conflict before lifecycle checks for every writable role', async () => {
  const fixture = await createFixture();
  try {
    const stale = createData();
    const current = await fixture.repository.put(fixture.workspaceId,
      updateClassArchive(stale, 'class-a', 'archive', now), 1);
    fixture.repository.writes = [];
    for (const role of ['owner', 'admin', 'teacher'] as const) {
      const response = await dispatch(handleWorkspaceRoutes,
        fixture.context('/api/v1/state', { data: stale, baseRevision: 1 }, role, 'PUT'));
      assert.equal(response.status, 409);
      const result = await response.json() as { error: string; current: StoredWorkspace };
      assert.equal(result.error, 'REVISION_CONFLICT');
      assert.equal(result.current.revision, current.revision);
      assert.deepEqual(result.current.data?.classes, current.data?.classes);
    }
    assert.equal(fixture.repository.writes.length, 0);
  } finally { await fixture.dispose(); }
});

test('stale teacher conflict responses retain assigned-class scoping before rejecting the old archive state', async () => {
  const fixture = await createFixture();
  try {
    const stale = createData();
    await fixture.repository.put(fixture.workspaceId,
      updateClassArchive(stale, 'class-a', 'archive', now), 1);
    fixture.repository.writes = [];
    const context = fixture.context('/api/v1/state', {
      data: { ...stale, classes: [stale.classes[0]] }, baseRevision: 1,
    }, 'teacher', 'PUT');
    context.getClassScope = async () => new Set(['class-a']);
    const response = await dispatch(handleWorkspaceRoutes, context);
    assert.equal(response.status, 409);
    const result = await response.json() as { error: string; current: StoredWorkspace };
    assert.equal(result.error, 'REVISION_CONFLICT');
    assert.deepEqual(result.current.data?.classes.map((classroom) => classroom.id), ['class-a']);
    assert.equal(result.current.data?.classes[0].archivedAt, now);
    assert.equal(JSON.stringify(result.current).includes('student-b'), false);
    assert.equal(fixture.repository.writes.length, 0);
  } finally { await fixture.dispose(); }
});

test('lifecycle state guard preserves trusted raw archives, rejects duplicates and never mutates inputs', () => {
  const current = updateClassArchive(createData(), 'class-a', 'archive', now);
  const submitted = structuredClone(current);
  const comparison = normalizeAppData(current, now + 1);
  const normalized = normalizeAppData(submitted, now + 1);
  const saved = protectClassLifecycleWrite(current, normalized, { comparison, submitted });
  assert.equal(saved.classes[0], current.classes[0]);
  assert.deepEqual(current, submitted);
  const duplicate = structuredClone(current);
  duplicate.classes.push(duplicate.classes[0]);
  assert.throws(() => protectClassLifecycleWrite(current, duplicate), /CLASS_SCOPE_CHANGED/);
});

test('boss resolution rejects archived roster, boss ID, contribution and attack references for all roles', async () => {
  const fixture = await createFixture();
  try {
    const data = updateClassArchive(createData(), 'class-a', 'archive', now);
    await fixture.repository.put(fixture.workspaceId, data, 1);
    fixture.repository.writes = [];
    const archivedClass = data.classes[0];
    const boss: WorldBoss = archivedClass.activeBoss!;
    for (const role of ['teacher', 'admin', 'owner'] as const) {
      for (const body of [
        { students: archivedClass.students, boss: { ...boss, id: 'different-boss', contributions: {}, attackCounts: {} } },
        { students: [], boss: { ...boss, contributions: {}, attackCounts: {} } },
        { students: [], boss: { ...boss, id: 'different-boss', attackCounts: {} } },
        { students: [], boss: { ...boss, id: 'different-boss', contributions: {} } },
      ]) {
        const response = await dispatch(handleBossRoutes,
          fixture.context('/api/v1/boss/resolve', body, role));
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { error: 'CLASS_ARCHIVED' });
      }
    }
    const activeResponse = await dispatch(handleBossRoutes, fixture.context('/api/v1/boss/resolve', {
      students: data.classes[1].students,
      boss: { ...boss, id: 'active-boss', contributions: { 'student-b': 10 }, attackCounts: {} },
    }));
    assert.equal(activeResponse.status, 200);
    assert.equal(fixture.repository.writes.length, 0, 'the existing calculator endpoint remains non-persisting');
  } finally { await fixture.dispose(); }
});

test('boss resolution denies a persisted roster outside teacher class assignments before exposing archive status', async () => {
  const fixture = await createFixture();
  try {
    await fixture.repository.put(fixture.workspaceId,
      updateClassArchive(createData(), 'class-a', 'archive', now), 1);
    const context = fixture.context('/api/v1/boss/resolve', {
      students: createData().classes[0].students, boss: createData().classes[0].activeBoss,
    }, 'teacher');
    context.getClassScope = async () => new Set(['class-b']);
    const response = await dispatch(handleBossRoutes, context);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'FORBIDDEN' });
  } finally { await fixture.dispose(); }
});

test('direct learning evidence writes reject an archive before reading request content', async () => {
  const fixture = await createFixture();
  try {
    await fixture.repository.put(fixture.workspaceId,
      updateClassArchive(createData(), 'class-a', 'archive', now), 1);
    fixture.repository.writes = [];
    for (const role of ['teacher', 'admin', 'owner'] as const) {
      const context = fixture.context('/api/v1/classes/class-a/evidence', undefined, role);
      context.request = new Request(context.url, { method: 'POST', body: '{invalid-json' });
      const response = await dispatch(handleLearningRoutes, context);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'CLASS_ARCHIVED' });
    }
    assert.equal(fixture.repository.writes.length, 0);
  } finally { await fixture.dispose(); }
});

test('archived class records, exam data and authorized analytics remain readable through shared API', async () => {
  const fixture = await createFixture();
  try {
    const before = await fixture.repository.get(fixture.workspaceId);
    assert.equal((await fixture.api('/api/v1/classes/class-a/privacy/archive',
      { expectedRevision: 1, confirmation: 'ARCHIVE CLASS' })).status, 200);
    const stateResponse = await fixture.api('/api/v1/state');
    const state = await stateResponse.json() as StoredWorkspace;
    assert.deepEqual(state.data?.classes[0].examRecords, before.data?.classes[0].examRecords);
    assert.deepEqual(state.data?.classes[0].learningEvidenceRecords, before.data?.classes[0].learningEvidenceRecords);
    assert.equal((await fixture.api('/api/v1/classes/class-a/analytics')).status, 200);
    assert.equal((await fixture.api('/api/v1/classes/class-a/students/student-a/analytics')).status, 200);
    assert.equal((await fixture.repository.listWorkspaceAuditEvents(fixture.workspaceId,
      { action: 'class.privacy.archive' })).length, 1);
    assert.equal((await fixture.api('/api/v1/classes/class-a/privacy/reopen',
      { expectedRevision: 2, confirmation: 'REOPEN CLASS' })).status, 200);
    assert.deepEqual((await fixture.repository.get(fixture.workspaceId)).data?.classes[0], before.data?.classes[0]);
  } finally { await fixture.dispose(); }
});
