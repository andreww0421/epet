import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AuthService, type AuthSessionEnvelope } from '../server/auth';
import { createApiHandler } from '../server/api';
import { JsonWorkspaceRepository } from '../server/repository';
import { createCsrfToken } from '../server/middleware/csrf';
import { isWorkspaceAccess, workspaceAccessHeader, workspaceAccessKey, type WorkspaceAccess } from '../shared/contracts/workspace';
import { normalizeAppData } from '../src/store/utils';

const ORIGIN = 'https://epet.example.test';
const PASSWORD = 'synthetic sync access fixture password';
const CLASS_A = 'synthetic-class-a';
const CLASS_B = 'synthetic-private-class-b';
const B_MARKER = 'Synthetic private student B M01';
const data = () => JSON.parse(JSON.stringify(normalizeAppData({
  currentClassId: CLASS_A,
  classes: [
    { id: CLASS_A, name: 'Synthetic Class A', students: [{ id: 'student-a', name: 'Synthetic Student A' }] },
    { id: CLASS_B, name: 'Synthetic Class B', students: [{ id: 'student-b', name: B_MARKER }] },
  ],
}, 1_700_000_000_000)));

type Client = AuthSessionEnvelope & { csrf: string };
const client = (session: AuthSessionEnvelope): Client => ({ ...session, csrf: createCsrfToken() });

const createFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-sync-access-'));
  const repository = new JsonWorkspaceRepository(join(directory, 'data.json'));
  const auth = new AuthService(repository, { passwordIterations: 10 });
  const owner = client(await auth.register({ email: 'sync-owner@example.test', password: PASSWORD,
    displayName: 'Synthetic Owner', workspaceName: 'Synthetic Workspace', initialWorkspaceData: data() }));
  const workspaceId = owner.session.activeWorkspaceId!;
  const invite = async (role: 'admin' | 'teacher' | 'viewer', classIds: string[]) => {
    const invitation = await auth.createWorkspaceInvitation(owner.sessionToken, workspaceId,
      `sync-${role}@example.test`, role, classIds);
    return client(await auth.acceptWorkspaceInvitation(invitation.token, `Synthetic ${role}`, PASSWORD));
  };
  const admin = await invite('admin', []);
  const teacher = await invite('teacher', [CLASS_B, CLASS_A]);
  const viewer = await invite('viewer', [CLASS_A]);
  const handler = createApiHandler(repository, { auth: { passwordIterations: 10 } });
  const request = (who: Client, method = 'GET', headers: Record<string, string> = {},
    body?: unknown, workspace = workspaceId) => new Request(`${ORIGIN}/api/v1/state`, {
      method,
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-epet-workspace': workspace,
        cookie: `__Host-epet_session=${who.sessionToken}; __Host-epet_csrf=${who.csrf}`,
        'x-csrf-token': who.csrf, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const access = async (who: Client, workspace = workspaceId) => {
    const response = await handler(request(who, 'GET', { 'x-epet-sync-user': who.session.user.id }, undefined, workspace));
    assert.equal(response.status, 200);
    const snapshot = await response.json() as { access: WorkspaceAccess; data: ReturnType<typeof data>; revision: number };
    assert.ok(isWorkspaceAccess(snapshot.access));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return snapshot;
  };
  return { repository, auth, owner, admin, teacher, viewer, workspaceId, handler, request, access,
    dispose: () => rm(directory, { recursive: true, force: true }) };
};

test('sync access contract requires an explicit principal and role-compatible scope and uses unambiguous keys', () => {
  const base = { userId: 'synthetic-user', workspaceId: 'synthetic-workspace' };
  for (const role of ['owner', 'admin'] as const) {
    assert.ok(isWorkspaceAccess({ ...base, role, classIds: null }));
    assert.equal(isWorkspaceAccess({ ...base, role, classIds: [CLASS_A] }), false);
  }
  for (const role of ['teacher', 'viewer'] as const) {
    assert.ok(isWorkspaceAccess({ ...base, role, classIds: [CLASS_A] }));
    for (const classIds of [null, [], [''], [' '], [42], 'all']) {
      assert.equal(isWorkspaceAccess({ ...base, role, classIds }), false);
    }
  }
  for (const invalid of [null, [], {}, { ...base, role: 'superuser', classIds: null },
    { ...base, userId: '', role: 'admin', classIds: null },
    { ...base, workspaceId: 42, role: 'admin', classIds: null }]) {
    assert.equal(isWorkspaceAccess(invalid), false);
  }
  const scoped: WorkspaceAccess = { ...base, role: 'teacher', classIds: [CLASS_B, CLASS_A, CLASS_A] };
  assert.equal(workspaceAccessKey(scoped), workspaceAccessKey({ ...scoped, classIds: [CLASS_A, CLASS_B] }));
  assert.notEqual(workspaceAccessKey({ ...scoped, userId: 'a,b', workspaceId: 'c' }),
    workspaceAccessKey({ ...scoped, userId: 'a', workspaceId: 'b,c' }));
  assert.notEqual(workspaceAccessKey({ ...scoped, classIds: ['a,b', 'c'] }),
    workspaceAccessKey({ ...scoped, classIds: ['a', 'b,c'] }));
});

test('sync access header binds Unicode identities using an ASCII-safe canonical digest', async () => {
  const access: WorkspaceAccess = { userId: 'synthetic-使用者', workspaceId: 'synthetic-工作區',
    role: 'teacher', classIds: ['synthetic-班級-α', 'synthetic-a/b?c#d'] };
  const header = await workspaceAccessHeader(access);
  assert.match(header, /^v1\.[0-9a-f]{64}$/);
  assert.equal(header, `v1.${createHash('sha256').update(workspaceAccessKey(access), 'utf8').digest('hex')}`);
  assert.equal(new Headers({ 'x-epet-sync-access': header }).get('x-epet-sync-access'), header);
  assert.equal(header, await workspaceAccessHeader({ ...access, classIds: [...access.classIds!].reverse() }));
});

test('sync access header stays 67 ASCII bytes for 200 long Unicode class IDs without weakening scope binding', async () => {
  const classIds = Array.from({ length: 200 }, (_, index) => `synthetic-班級-${index}-${'資料'.repeat(35)}`);
  const access: WorkspaceAccess = { userId: 'synthetic-user', workspaceId: 'synthetic-workspace',
    role: 'teacher', classIds };
  assert.ok(Buffer.byteLength(encodeURIComponent(workspaceAccessKey(access)), 'ascii') > 16 * 1024);
  const header = await workspaceAccessHeader(access);
  assert.equal(Buffer.byteLength(header, 'ascii'), 67);
  assert.match(header, /^v1\.[0-9a-f]{64}$/);
  assert.equal(header, `v1.${createHash('sha256').update(workspaceAccessKey(access), 'utf8').digest('hex')}`);
  assert.equal(header, await workspaceAccessHeader({ ...access, classIds: [...classIds].reverse().concat(classIds[0]) }));
  assert.notEqual(header, await workspaceAccessHeader({ ...access, classIds: classIds.slice(0, -1) }));
});

test('GET sync access is server-derived for owner, admin, teacher and viewer and legacy GET stays compatible', async () => {
  const f = await createFixture();
  try {
    for (const [who, role, classIds] of [
      [f.owner, 'owner', null], [f.admin, 'admin', null],
      [f.teacher, 'teacher', [CLASS_A, CLASS_B]], [f.viewer, 'viewer', [CLASS_A]],
    ] as const) {
      const snapshot = await f.access(who);
      assert.deepEqual(snapshot.access, { userId: who.session.user.id, workspaceId: f.workspaceId, role, classIds });
    }
    const viewer = await f.access(f.viewer);
    assert.deepEqual(viewer.data.classes.map((item: { id: string }) => item.id), [CLASS_A]);
    assert.ok(!JSON.stringify(viewer).includes(B_MARKER));
    const legacyResponse = await f.handler(f.request(f.owner));
    assert.equal(legacyResponse.status, 200);
    const legacy = await legacyResponse.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(legacy).sort(), ['data', 'revision', 'updatedAt']);
  } finally { await f.dispose(); }
});

test('GET rejects an account switch before reading a workspace and cannot claim another user identity', async () => {
  const f = await createFixture();
  try {
    const get = f.repository.get.bind(f.repository);
    let reads = 0;
    f.repository.get = async (...args) => { reads++; return get(...args); };
    for (const syncUser of [f.owner.session.user.id, '']) {
      const response = await f.handler(f.request(f.teacher, 'GET', { 'x-epet-sync-user': syncUser }));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'FORBIDDEN' });
    }
    assert.equal(reads, 0);
  } finally { await f.dispose(); }
});

test('PUT rejects a switched account or forged authority before consuming draft bytes or changing revision', async () => {
  const f = await createFixture();
  try {
    const owner = await f.access(f.owner);
    const teacher = await f.access(f.teacher);
    const before = await f.repository.get(f.workspaceId);
    const get = f.repository.get.bind(f.repository);
    let reads = 0;
    f.repository.get = async (...args) => { reads++; return get(...args); };
    for (const access of [owner.access,
      { ...teacher.access, classIds: null },
      { ...teacher.access, role: 'admin' as const, classIds: null },
      { ...teacher.access, userId: f.owner.session.user.id }]) {
      const request = f.request(f.teacher, 'PUT', { 'x-epet-sync-access': await workspaceAccessHeader(access) },
        { baseRevision: before.revision, data: owner.data });
      const response = await f.handler(request);
      assert.equal(response.status, 403);
      assert.equal(request.bodyUsed, false, 'an unauthorized draft must not be parsed');
      assert.deepEqual(await response.json(), { error: 'FORBIDDEN' });
    }
    assert.equal(reads, 0);
    assert.deepEqual(await get(f.workspaceId), before);
  } finally { await f.dispose(); }
});

test('a teacher scope downgrade rejects the old draft and accepts only the freshly scoped legitimate write', async () => {
  const f = await createFixture();
  try {
    const previous = await f.access(f.teacher);
    await f.auth.updateWorkspaceMember(f.owner.sessionToken, f.workspaceId, f.teacher.session.user.id, 'teacher', [CLASS_A]);
    const before = await f.repository.get(f.workspaceId);
    const oldDraft = f.request(f.teacher, 'PUT', { 'x-epet-sync-access': await workspaceAccessHeader(previous.access) },
      { baseRevision: previous.revision, data: previous.data });
    const denied = await f.handler(oldDraft);
    assert.equal(denied.status, 403);
    assert.equal(oldDraft.bodyUsed, false);
    assert.deepEqual(await f.repository.get(f.workspaceId), before);
    const current = await f.access(f.teacher);
    assert.deepEqual(current.access.classIds, [CLASS_A]);
    assert.ok(!JSON.stringify(current).includes(B_MARKER));
    current.data.classes[0].students[0].points += 1;
    const saved = await f.handler(f.request(f.teacher, 'PUT', { 'x-epet-sync-access': await workspaceAccessHeader(current.access) },
      { baseRevision: current.revision, data: current.data }));
    assert.equal(saved.status, 200);
    assert.ok(!(await saved.text()).includes(B_MARKER));
    const after = await f.repository.get(f.workspaceId);
    assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(after.data!.classes.find((item) => item.id === CLASS_B), before.data!.classes.find((item) => item.id === CLASS_B));
  } finally { await f.dispose(); }
});

test('a valid sync access key is not a grant to submit another class and does not bypass CSRF or viewer RBAC', async () => {
  const f = await createFixture();
  try {
    await f.auth.updateWorkspaceMember(f.owner.sessionToken, f.workspaceId, f.teacher.session.user.id, 'teacher', [CLASS_A]);
    const teacher = await f.access(f.teacher);
    const owner = await f.access(f.owner);
    const denied = await f.handler(f.request(f.teacher, 'PUT', { 'x-epet-sync-access': await workspaceAccessHeader(teacher.access) },
      { baseRevision: owner.revision, data: owner.data }));
    assert.equal(denied.status, 403);
    const csrf = await f.handler(f.request(f.teacher, 'PUT', {
      'x-epet-sync-access': await workspaceAccessHeader(teacher.access), 'x-csrf-token': 'wrong-synthetic-token',
    }, { baseRevision: teacher.revision, data: teacher.data }));
    assert.equal(csrf.status, 403);
    assert.deepEqual(await csrf.json(), { error: 'CSRF_INVALID' });
    const viewer = await f.access(f.viewer);
    const forbidden = f.request(f.viewer, 'PUT', { 'x-epet-sync-access': await workspaceAccessHeader(viewer.access) },
      { baseRevision: viewer.revision, data: viewer.data });
    assert.equal((await f.handler(forbidden)).status, 403);
    assert.equal(forbidden.bodyUsed, false);
    assert.equal((await f.repository.get(f.workspaceId)).revision, owner.revision);
  } finally { await f.dispose(); }
});

test('a role downgrade invalidates the old authority even when user and class contents are unchanged', async () => {
  const f = await createFixture();
  try {
    const previous = await f.access(f.admin);
    await f.auth.updateWorkspaceMember(f.owner.sessionToken, f.workspaceId, f.admin.session.user.id, 'teacher', [CLASS_A]);
    const draft = f.request(f.admin, 'PUT', { 'x-epet-sync-access': await workspaceAccessHeader(previous.access) },
      { baseRevision: previous.revision, data: previous.data });
    assert.equal((await f.handler(draft)).status, 403);
    assert.equal(draft.bodyUsed, false);
    const next = await f.access(f.admin);
    assert.equal(next.access.role, 'teacher');
    assert.deepEqual(next.access.classIds, [CLASS_A]);
    assert.ok(!JSON.stringify(next).includes(B_MARKER));
  } finally { await f.dispose(); }
});

test('workspace switching rejects the previous workspace key and permits the current workspace and legacy PUT', async () => {
  const f = await createFixture();
  try {
    const previous = await f.access(f.owner);
    const second = await f.auth.createWorkspace(f.owner.sessionToken, 'Synthetic second workspace', data());
    const secondWorkspace = second.activeWorkspaceId!;
    assert.notEqual(secondWorkspace, f.workspaceId);
    const switched = f.request(f.owner, 'PUT', { 'x-epet-sync-access': await workspaceAccessHeader(previous.access) },
      { baseRevision: previous.revision, data: previous.data }, secondWorkspace);
    assert.equal((await f.handler(switched)).status, 403);
    assert.equal(switched.bodyUsed, false);
    const current = await f.access(f.owner, secondWorkspace);
    const saved = await f.handler(f.request(f.owner, 'PUT', { 'x-epet-sync-access': await workspaceAccessHeader(current.access) },
      { baseRevision: current.revision, data: current.data }, secondWorkspace));
    assert.equal(saved.status, 200);
    const savedBody = await saved.json() as { revision: number };
    const legacy = await f.handler(f.request(f.owner, 'PUT', {},
      { baseRevision: savedBody.revision, data: current.data }, secondWorkspace));
    assert.equal(legacy.status, 200);
    assert.equal((await f.repository.get(f.workspaceId)).revision, previous.revision);
  } finally { await f.dispose(); }
});

test('sync headers require a real session and preserve scoped revision conflict protection', async () => {
  const f = await createFixture();
  try {
    const unauthenticated = new Request(`${ORIGIN}/api/v1/state`, {
      headers: { origin: ORIGIN, 'x-epet-workspace': f.workspaceId,
        'x-epet-sync-user': f.owner.session.user.id },
    });
    const unauthorized = await f.handler(unauthenticated);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { error: 'INVALID_SESSION' });
    await f.auth.updateWorkspaceMember(f.owner.sessionToken, f.workspaceId, f.teacher.session.user.id, 'teacher', [CLASS_A]);
    const teacher = await f.access(f.teacher);
    const before = await f.repository.get(f.workspaceId);
    const updated = structuredClone(before.data!);
    updated.classes.find((item) => item.id === CLASS_A)!.students[0].points += 1;
    await f.repository.put(f.workspaceId, updated, before.revision);
    const conflict = await f.handler(f.request(f.teacher, 'PUT', {
      'x-epet-sync-access': await workspaceAccessHeader(teacher.access),
    }, { baseRevision: teacher.revision, data: teacher.data }));
    assert.equal(conflict.status, 409);
    const text = await conflict.text();
    assert.ok(!text.includes(B_MARKER));
    assert.ok(!text.includes(CLASS_B));
    const body = JSON.parse(text) as { error: string; current: { revision: number; data: { classes: { id: string }[] } } };
    assert.equal(body.error, 'REVISION_CONFLICT');
    assert.equal(body.current.revision, before.revision + 1);
    assert.deepEqual(body.current.data.classes.map((item) => item.id), [CLASS_A]);
    assert.equal((await f.repository.get(f.workspaceId)).revision, before.revision + 1);
  } finally { await f.dispose(); }
});

test('a teacher can sync an imported Unicode class ID without changing other classes', async () => {
  const f = await createFixture();
  try {
    const unicodeClassId = 'synthetic-班級-α';
    const before = await f.repository.get(f.workspaceId);
    const imported = structuredClone(before.data!);
    imported.classes.push({ ...structuredClone(imported.classes[0]), id: unicodeClassId, name: 'Synthetic Unicode Class' });
    await f.repository.put(f.workspaceId, imported, before.revision);
    await f.auth.updateWorkspaceMember(f.owner.sessionToken, f.workspaceId, f.teacher.session.user.id, 'teacher', [unicodeClassId]);
    const snapshot = await f.access(f.teacher);
    assert.deepEqual(snapshot.access.classIds, [unicodeClassId]);
    assert.deepEqual(snapshot.data.classes.map((item: { id: string }) => item.id), [unicodeClassId]);
    const header = await workspaceAccessHeader(snapshot.access);
    assert.match(header, /^[\x20-\x7e]+$/);
    snapshot.data.classes[0].students[0].points += 1;
    const response = await f.handler(f.request(f.teacher, 'PUT', { 'x-epet-sync-access': header },
      { baseRevision: snapshot.revision, data: snapshot.data }));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes(B_MARKER));
    const saved = JSON.parse(text) as { revision: number; data: { classes: { id: string }[] } };
    assert.equal(saved.revision, snapshot.revision + 1);
    assert.deepEqual(saved.data.classes.map((item) => item.id), [unicodeClassId]);
    const after = await f.repository.get(f.workspaceId);
    for (const untouched of imported.classes.filter((item) => item.id !== unicodeClassId)) {
      assert.deepEqual(after.data!.classes.find((item) => item.id === untouched.id), untouched);
    }
  } finally { await f.dispose(); }
});
