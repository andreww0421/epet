import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createApiHandler } from '../server/api';
import { AuthService, type AuthorizedWorkspace } from '../server/auth';
import type { StoredWorkspace, WorkspaceRole, WorkspaceWriteContext } from '../server/contracts';
import { errorResponse } from '../server/middleware/errorResponse';
import { JsonWorkspaceRepository } from '../server/repository';
import { handleWorkspaceRoutes } from '../server/routes/workspaceRoutes';
import type { WorkspaceRouteContext } from '../server/routes/types';
import type { AppData } from '../src/store/types';
import { normalizeAppData } from '../src/store/utils';

const now = Date.parse('2026-10-14T01:00:00Z');
const path = '/api/v1/workspace/import';
const createData = (): AppData => JSON.parse(JSON.stringify(normalizeAppData({
  lastOpened: now - 86_400_000,
  currentClassId: 'class-active',
  settings: { inclusiveMode: false, decayAmount: 10, decayType: 'hourly' },
  classes: [{
    id: 'class-active', name: 'Synthetic active class',
    students: [{ id: 'student-active', name: 'Synthetic active learner', points: 210,
      pet: { type: 'dog', level: 2, fullness: 73, happiness: 70 } }],
  }, {
    id: 'class-archived', name: 'Synthetic archived class', archivedAt: now - 1_000,
    students: [{ id: 'student-archived', name: 'Synthetic archived learner', points: 220,
      pet: { type: 'cat', level: 3, fullness: 83, happiness: 60 },
      penaltyStatus: { source: 'discipline', until: now + 60_000 } }],
    learningEvidenceRecords: [{ id: 'evidence-archived', classId: 'class-archived',
      studentId: 'student-archived', competency: 'growth', level: 'progressing',
      evidenceType: 'observation', title: 'Synthetic retained observation', actor: 'mentor',
      source: 'manual', rubricVersion: '1.0', revision: 1, createdAt: now - 2_000 }],
    examRecords: [{ id: 'exam-archived', title: 'Synthetic assessment', examDate: '2026-10-14',
      items: [{ id: 'math', name: 'Math', maxScore: 100 }],
      results: [{ studentId: 'student-archived', scores: { math: 87 }, updatedAt: now }],
      createdAt: now, updatedAt: now }],
  }],
}, now))) as AppData;

class ImportRepository extends JsonWorkspaceRepository {
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
      const concurrent = this.raceData;
      this.raceData = undefined;
      await super.put(workspaceId, concurrent, baseRevision, { action: 'fixture.concurrent' });
    }
    return super.put(workspaceId, data, baseRevision, context);
  }
}

const createFixture = async () => {
  const fixtureRoot = join(process.cwd(), 'output', 'privacy-unit');
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(join(fixtureRoot, 'workspace-import-'));
  try {
    const repository = new ImportRepository(join(directory, 'data.json'));
    const authService = new AuthService(repository, { passwordIterations: 10 });
    const owner = await authService.register({ email: 'import-owner@example.test',
      password: 'synthetic import fixture password', displayName: 'Fixture Owner',
      workspaceName: 'Import fixture', initialWorkspaceData: createData() });
    const workspaceId = owner.session.activeWorkspaceId;
    assert.ok(workspaceId);
    const authorized = await authService.authorizeWorkspace(owner.sessionToken, workspaceId);
    repository.reads = 0;
    repository.writes = [];
    const context = (body: unknown, role: WorkspaceRole = 'owner') => {
      const url = new URL(`http://localhost${path}`);
      const roleAuthorization: AuthorizedWorkspace = {
        ...authorized, membership: { ...authorized.membership, role },
      };
      return { request: new Request(url, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'untrusted-synthetic-student-name' },
        body: JSON.stringify(body) }), url, headers: {}, repository, authService,
      workspaceId, token: owner.sessionToken, authorized: roleAuthorization,
      getClassScope: async () => null, requireClassAccess: async () => undefined,
      } satisfies WorkspaceRouteContext;
    };
    const handler = createApiHandler(repository, { auth: { passwordIterations: 10 } });
    const api = (body: unknown, options: {
      token?: string | null; workspaceId?: string; csrf?: boolean; origin?: string | null;
    } = {}) => {
      const csrf = 'a'.repeat(43);
      return handler(new Request(`http://localhost${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json',
          ...(options.origin === null ? {} : { origin: options.origin ?? 'http://localhost' }),
          cookie: `${options.token === null ? '' : `__Host-epet_session=${options.token ?? owner.sessionToken}; `}__Host-epet_csrf=${csrf}`,
          ...(options.csrf === false ? {} : { 'x-csrf-token': csrf }),
          'x-epet-workspace': options.workspaceId ?? workspaceId },
        body: JSON.stringify(body),
      }));
    };
    return { repository, authService, owner, authorized, workspaceId, context, api,
      dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

const importBody = (data = createData(), expectedRevision = 1) => ({ data, expectedRevision,
  confirmation: 'IMPORT WORKSPACE', acknowledgeReplacement: true });
const dispatch = async (context: WorkspaceRouteContext) => {
  try {
    const response = await handleWorkspaceRoutes(context);
    assert.ok(response);
    return response;
  } catch (error) { return errorResponse(error, context.headers); }
};

test('workspace import checks admin authority before parsing bodies or reading workspace data', async () => {
  const fixture = await createFixture();
  try {
    for (const role of ['teacher', 'viewer'] as const) {
      const context = fixture.context(importBody(), role);
      context.request = new Request(context.url, { method: 'POST', body: '{invalid-json' });
      const response = await dispatch(context);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'FORBIDDEN' });
    }
    assert.equal(fixture.repository.reads, 0);
    assert.equal(fixture.repository.writes.length, 0);
  } finally { await fixture.dispose(); }
});

test('workspace import needs exact typed confirmation and a separate boolean replacement acknowledgement', async () => {
  const fixture = await createFixture();
  try {
    for (const confirmation of [undefined, 'import workspace', 'IMPORT WORKSPACE ', 'DELETE CLASS']) {
      const response = await dispatch(fixture.context({ ...importBody(), confirmation }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'CONFIRMATION_REQUIRED' });
    }
    for (const acknowledgeReplacement of [undefined, false, 'true', 1, {}]) {
      const response = await dispatch(fixture.context({ ...importBody(), acknowledgeReplacement }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'REPLACEMENT_ACKNOWLEDGEMENT_REQUIRED' });
    }
    assert.equal(fixture.repository.reads, 0);
    assert.equal(fixture.repository.writes.length, 0);
  } finally { await fixture.dispose(); }
});

test('workspace import rejects unsafe revisions, invalid data and duplicate normalized identifiers', async () => {
  const fixture = await createFixture();
  try {
    for (const expectedRevision of [undefined, null, '1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const response = await dispatch(fixture.context({ ...importBody(), expectedRevision }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'BASE_REVISION_REQUIRED' });
    }
    const duplicateClass = createData();
    duplicateClass.classes[1].id = duplicateClass.classes[0].id;
    const duplicateStudent = createData();
    duplicateStudent.classes[0].students.push(structuredClone(duplicateStudent.classes[0].students[0]));
    for (const data of [undefined, null, [], {}, { currentClassId: '', classes: [null] },
      { currentClassId: '', classes: [{ id: 'bad', students: {} }] }, duplicateClass, duplicateStudent]) {
      const response = await dispatch(fixture.context({ ...importBody(), data }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'INVALID_APP_DATA' });
    }
    const archivesOnly = createData();
    archivesOnly.classes[0].archivedAt = now;
    const response = await dispatch(fixture.context(importBody(archivesOnly)));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'LAST_ACTIVE_CLASS' });
    assert.equal(fixture.repository.reads, 0);
    assert.equal(fixture.repository.writes.length, 0);
  } finally { await fixture.dispose(); }
});

test('owner and admin can import complete snapshots including retained archives without replaying old decay', async () => {
  for (const role of ['owner', 'admin'] as const) {
    const fixture = await createFixture();
    try {
      const data = createData();
      data.currentClassId = 'class-archived';
      data.classes[0].students[0].points = 350;
      data.classes.push({ id: 'new-archive', name: 'Recovered archive', students: [], archivedAt: now });
      const before = Date.now();
      const response = await dispatch(fixture.context(importBody(data), role));
      const after = Date.now();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const saved = await response.json() as StoredWorkspace;
      assert.equal(saved.revision, 2);
      assert.ok(saved.data);
      assert.ok(saved.data.lastOpened >= before && saved.data.lastOpened <= after);
      assert.equal(saved.data.classes[0].students[0].points, 350);
      assert.equal(saved.data.classes[0].students[0].pet.fullness, 73);
      assert.deepEqual(saved.data.classes[1], data.classes[1]);
      assert.equal(saved.data.classes[2].archivedAt, now);
      assert.equal(saved.data.currentClassId, 'class-active');
      assert.equal(fixture.repository.writes.length, 1);
      assert.equal(fixture.repository.writes[0].baseRevision, 1);
      const context = fixture.repository.writes[0].context;
      assert.equal(context?.action, 'workspace.privacy.import');
      assert.equal(context?.actorUserId, fixture.authorized.user.id);
      assert.match(context?.requestId ?? '', /^privacy_[a-f0-9-]{36}$/);
      const audit = await fixture.repository.listWorkspaceAuditEvents(fixture.workspaceId,
        { action: 'workspace.privacy.import' });
      assert.equal(audit.length, 1);
      const serialized = JSON.stringify(audit);
      for (const sensitive of ['Synthetic active learner', 'Synthetic archived learner',
        'student-active', 'student-archived', 'untrusted-synthetic-student-name', fixture.owner.sessionToken]) {
        assert.equal(serialized.includes(sensitive), false);
      }
    } finally { await fixture.dispose(); }
  }
});

test('workspace import uses the API authentication, tenant, Origin and CSRF protections', async () => {
  const fixture = await createFixture();
  try {
    const foreign = await fixture.authService.register({ email: 'foreign-import@example.test',
      password: 'synthetic foreign import password', displayName: 'Foreign Fixture Owner',
      workspaceName: 'Foreign fixture', initialWorkspaceData: createData() });
    const foreignId = foreign.session.activeWorkspaceId;
    assert.ok(foreignId);
    fixture.repository.writes = [];
    for (const [options, status, error] of [
      [{ token: null }, 401, 'INVALID_SESSION'],
      [{ csrf: false }, 403, 'CSRF_INVALID'], [{ origin: null }, 403, 'ORIGIN_REQUIRED'],
      [{ origin: 'https://attacker.example.test' }, 403, 'ORIGIN_NOT_ALLOWED'],
      [{ workspaceId: foreignId }, 403, 'FORBIDDEN'],
    ] as const) {
      const response = await fixture.api(importBody(), options);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error });
    }
    assert.equal(fixture.repository.writes.length, 0);
    assert.equal((await fixture.repository.get(fixture.workspaceId)).revision, 1);
    assert.equal((await fixture.repository.get(foreignId)).revision, 1);
    assert.equal((await fixture.api(importBody())).status, 200);
  } finally { await fixture.dispose(); }
});

test('stale and concurrent imports preserve the winning state without an import audit or history purge', async () => {
  const fixture = await createFixture();
  try {
    const replacement = normalizeAppData({ currentClassId: 'replacement',
      classes: [{ id: 'replacement', name: 'Replacement class', students: [] }] }, now);
    const stale = await fixture.api(importBody(replacement, 0));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as { error: string }).error, 'REVISION_CONFLICT');
    const concurrent = createData();
    concurrent.classes[0].students[0].points = 211;
    fixture.repository.raceData = concurrent;
    const response = await fixture.api(importBody(replacement));
    assert.equal(response.status, 409);
    const saved = await fixture.repository.get(fixture.workspaceId);
    assert.equal(saved.revision, 2);
    assert.deepEqual(saved.data, concurrent);
    assert.deepEqual((await fixture.repository.getWorkspaceRevision(fixture.workspaceId, 1))?.data, createData());
    assert.deepEqual(await fixture.repository.listWorkspaceAuditEvents(fixture.workspaceId,
      { action: 'workspace.privacy.import' }), []);
    assert.deepEqual(await fixture.repository.listWorkspaceAuditEvents(fixture.workspaceId,
      { action: 'privacy.class.purge' }), []);
  } finally { await fixture.dispose(); }
});

test('explicit full replacement purges omitted classes and students from retained history within its tenant', async () => {
  const fixture = await createFixture();
  try {
    const foreign = await fixture.authService.register({ email: 'retained-import@example.test',
      password: 'synthetic retained import password', displayName: 'Retained Fixture Owner',
      workspaceName: 'Retained fixture', initialWorkspaceData: createData() });
    const foreignId = foreign.session.activeWorkspaceId;
    assert.ok(foreignId);
    await fixture.repository.appendAuditEvent({ id: 'prior-student-export',
      workspaceId: fixture.workspaceId, action: 'student.privacy.export', targetType: 'student',
      targetId: 'student-archived', createdAt: now });
    const replacement = normalizeAppData({ currentClassId: 'replacement', settings: { language: 'en' },
      classes: [{ id: 'replacement', name: 'Recovered complete snapshot', students: [{
        id: 'imported-student', name: 'Synthetic imported learner', points: 99,
        pet: { type: 'cat', fullness: 91, happiness: 72, level: 2 },
      }] }] }, now);
    const response = await fixture.api(importBody(replacement));
    assert.equal(response.status, 200);
    const saved = await response.json() as StoredWorkspace;
    assert.deepEqual(saved.data?.classes, JSON.parse(JSON.stringify(replacement.classes)));
    assert.equal(saved.data?.settings?.language, 'en');
    assert.equal(saved.data?.currentClassId, 'replacement');
    for (const revision of await fixture.repository.listWorkspaceRevisions(fixture.workspaceId)) {
      const snapshot = await fixture.repository.getWorkspaceRevision(fixture.workspaceId, revision.revision);
      const serialized = JSON.stringify(snapshot);
      for (const removed of ['class-active', 'class-archived', 'student-active', 'student-archived',
        'evidence-archived', 'exam-archived']) assert.equal(serialized.includes(removed), false);
    }
    assert.deepEqual((await fixture.repository.get(foreignId)).data, createData());
    assert.deepEqual((await fixture.repository.getWorkspaceRevision(foreignId, 1))?.data, createData());
    const audit = await fixture.repository.listWorkspaceAuditEvents(fixture.workspaceId);
    assert.equal(audit.filter((event) => event.action === 'workspace.privacy.import').length, 1);
    assert.equal(audit.find((event) => event.id === 'prior-student-export')?.targetId, undefined);
    assert.deepEqual(audit.find((event) => event.action === 'privacy.class.purge')?.metadata,
      { deletedClassCount: 2, deletedStudentCount: 2 });
    for (const sensitive of ['Synthetic imported learner', 'student-active', 'student-archived', 'imported-student']) {
      assert.equal(JSON.stringify(audit).includes(sensitive), false);
    }
  } finally { await fixture.dispose(); }
});
