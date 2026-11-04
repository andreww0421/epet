import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  isWorkspaceAccess, workspaceAccessKey, type WorkspaceAccess,
} from '../shared/contracts/workspace';
import {
  clearPendingDraft, DRAFT_STORAGE_PREFIX, DRAFT_TTL_MS, draftStorageKey,
  isDraftDataWithinAccess, readPendingDraft, sameWorkspaceData, writePendingDraft,
  type PendingWorkspaceDraft,
} from '../src/services/workspaceDrafts';
import type { AppData } from '../src/store/types';
import { normalizeAppData } from '../src/store/utils';
import { createEnrolledStudent } from '../src/studentEnrollment';

const now = Date.parse('2026-10-19T09:00:00Z');
const teacherAccess = (): WorkspaceAccess => ({
  userId: 'teacher-a', workspaceId: 'workspace-one', role: 'teacher', classIds: ['class-a'],
});
const adminAccess = (): WorkspaceAccess => ({
  userId: 'admin-a', workspaceId: 'workspace-one', role: 'admin', classIds: null,
});
const dataFor = (...classIds: string[]): AppData => ({
  lastOpened: now, currentClassId: classIds[0] ?? '',
  classes: classIds.map((id) => ({
    id, name: `Synthetic ${id}`, students: [{
      id: `student-${id}`, name: `Synthetic learner ${id}`, points: 100,
      pet: { type: 'cat', fullness: 80, happiness: 80, level: 1 },
    }],
  })),
});
const createDraft = (access = teacherAccess()): PendingWorkspaceDraft => ({
  version: 2, access, baseRevision: 7, requestId: 'synthetic-draft-request',
  createdAt: now - 10_000, updatedAt: now - 1_000,
  expiresAt: now - 1_000 + DRAFT_TTL_MS,
  data: dataFor('class-a'),
});

class MemorySessionStorage implements Storage {
  values = new Map<string, string>();
  reads: string[] = [];
  removals: string[] = [];
  writes: string[] = [];
  enumerations = 0;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  key(index: number) {
    this.enumerations += 1;
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    this.reads.push(key);
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes.push(key);
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.removals.push(key);
    this.values.delete(key);
  }
}

const installStorage = (t: TestContext, storage: unknown = new MemorySessionStorage()) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  t.after(() => {
    // A deliberately failed discard now keeps the fallback. Isolate each test
    // document rather than letting that intentional retention leak fixtures.
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemorySessionStorage() });
    clearPendingDraft(teacherAccess());
    clearPendingDraft(adminAccess());
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  return storage as MemorySessionStorage;
};
const seed = (storage: MemorySessionStorage, access: WorkspaceAccess, value: unknown) => {
  storage.values.set(draftStorageKey(access), JSON.stringify(value));
};

test('draft authority keys bind user, workspace, role, and exact class scope', () => {
  const original = teacherAccess();
  const originalKey = draftStorageKey(original);
  assert.ok(originalKey.startsWith(DRAFT_STORAGE_PREFIX));
  for (const changed of [
    { ...original, userId: 'teacher-b' },
    { ...original, workspaceId: 'workspace-two' },
    { ...original, role: 'viewer' as const },
    { ...original, classIds: ['class-a', 'class-b'] },
    { ...original, classIds: ['class-b'] },
  ]) assert.notEqual(draftStorageKey(changed), originalKey);
});

test('scope order and duplicate class IDs do not change an authority key', () => {
  const access = { ...teacherAccess(), classIds: ['class-b', 'class-a', 'class-b'] };
  assert.equal(workspaceAccessKey(access), workspaceAccessKey({ ...access, classIds: ['class-a', 'class-b'] }));
  assert.equal(draftStorageKey(access), draftStorageKey({ ...access, classIds: ['class-a', 'class-b'] }));
});

test('tuple encoding prevents identity delimiter collisions', () => {
  const access = teacherAccess();
  assert.notEqual(
    workspaceAccessKey({ ...access, userId: 'user:workspace', workspaceId: 'one' }),
    workspaceAccessKey({ ...access, userId: 'user', workspaceId: 'workspace:one' }),
  );
  assert.notEqual(
    workspaceAccessKey({ ...access, classIds: ['class-a,class-b'] }),
    workspaceAccessKey({ ...access, classIds: ['class-a', 'class-b'] }),
  );
});

test('workspace-wide authority is distinct from an empty class allowlist', () => {
  const access = adminAccess();
  assert.notEqual(workspaceAccessKey(access), workspaceAccessKey({ ...access, classIds: [] }));
  assert.equal(isWorkspaceAccess(access), true);
  assert.equal(isWorkspaceAccess({ ...teacherAccess(), classIds: [] }), false);
  assert.equal(isWorkspaceAccess({ ...teacherAccess(), classIds: null }), false);
  assert.equal(isWorkspaceAccess({ ...access, classIds: ['class-a'] }), false);
});

test('access validation rejects malformed identities and unsupported authority', () => {
  const access = teacherAccess();
  for (const value of [null, [], {}, { ...access, userId: '' },
    { ...access, userId: ' ' }, { ...access, workspaceId: 1 },
    { ...access, role: 'superuser' }, { ...access, classIds: ['class-a', ''] },
    { ...access, classIds: ['class-a', 1] }]) {
    assert.equal(isWorkspaceAccess(value), false);
  }
  assert.equal(isWorkspaceAccess({ ...access, role: 'viewer' }), true);
  assert.equal(isWorkspaceAccess({ ...adminAccess(), role: 'owner' }), true);
});

test('same authenticated principal with unchanged authority can recover its exact draft', (t) => {
  const storage = installStorage(t);
  const draft = createDraft();
  draft.uncertainData = dataFor('class-a');
  writePendingDraft(draft);
  assert.deepEqual(readPendingDraft(teacherAccess(), now), draft);
  assert.deepEqual(storage.reads, [draftStorageKey(draft.access)]);
});

test('equivalent reordered authority can recover a draft without changing the stored binding', (t) => {
  const storage = installStorage(t);
  const access = { ...teacherAccess(), classIds: ['class-a', 'class-b'] };
  const draft = createDraft(access);
  draft.data = dataFor('class-a', 'class-b');
  seed(storage, access, draft);
  assert.deepEqual(readPendingDraft({ ...access, classIds: ['class-b', 'class-a', 'class-b'] }, now), draft);
});

test('another user never reads, enumerates, or deletes an admin draft namespace', (t) => {
  const storage = installStorage(t);
  const draft = createDraft(adminAccess());
  draft.data = dataFor('class-a', 'class-b');
  seed(storage, draft.access, draft);
  const raw = storage.values.get(draftStorageKey(draft.access));
  assert.equal(readPendingDraft(teacherAccess(), now), null);
  clearPendingDraft(teacherAccess());
  assert.equal(storage.values.get(draftStorageKey(draft.access)), raw);
  assert.deepEqual(storage.reads, [draftStorageKey(teacherAccess())]);
  assert.deepEqual(storage.removals, [draftStorageKey(teacherAccess())]);
  assert.equal(storage.enumerations, 0);
});

test('workspace switching keeps another workspace draft isolated and recoverable', (t) => {
  const storage = installStorage(t);
  const access = teacherAccess();
  const draft = createDraft(access);
  seed(storage, access, draft);
  assert.equal(readPendingDraft({ ...access, workspaceId: 'workspace-two' }, now), null);
  assert.deepEqual(readPendingDraft(access, now), draft);
  assert.equal(storage.removals.length, 0);
});

test('role changes cannot recover a draft even for the same user and class scope', (t) => {
  const storage = installStorage(t);
  const access = teacherAccess();
  const draft = createDraft(access);
  seed(storage, access, draft);
  assert.equal(readPendingDraft({ ...access, role: 'viewer' }, now), null);
  assert.deepEqual(readPendingDraft(access, now), draft);
});

test('a reduced class scope cannot recover the earlier broader draft', (t) => {
  const storage = installStorage(t);
  const broader = { ...teacherAccess(), classIds: ['class-a', 'class-b'] };
  const draft = createDraft(broader);
  draft.data = dataFor('class-a', 'class-b');
  seed(storage, broader, draft);
  assert.equal(readPendingDraft(teacherAccess(), now), null);
  assert.deepEqual(storage.reads, [draftStorageKey(teacherAccess())]);
  assert.deepEqual(readPendingDraft(broader, now), draft);
});

test('draft TTL is exactly 24 hours after its latest local change', (t) => {
  const storage = installStorage(t);
  const draft = createDraft();
  assert.equal(DRAFT_TTL_MS, 24 * 60 * 60 * 1_000);
  seed(storage, draft.access, draft);
  assert.deepEqual(readPendingDraft(draft.access, draft.expiresAt - 1), draft);
  assert.equal(storage.removals.length, 0);
  assert.equal(readPendingDraft(draft.access, draft.expiresAt), null);
  assert.equal(storage.values.has(draftStorageKey(draft.access)), false);
});

test('an older draft stays recoverable when a recent local edit legitimately renewed its TTL', (t) => {
  const storage = installStorage(t);
  const draft = { ...createDraft(), createdAt: now - 7 * DRAFT_TTL_MS };
  seed(storage, draft.access, draft);
  assert.deepEqual(readPendingDraft(draft.access, now), draft);
  assert.equal(readPendingDraft(draft.access, draft.expiresAt), null);
});

test('expiration clears only the freshly authorized draft key', (t) => {
  const storage = installStorage(t);
  const draft = createDraft();
  const another = createDraft({ ...teacherAccess(), userId: 'other-user' });
  seed(storage, draft.access, draft);
  seed(storage, another.access, another);
  const otherRaw = storage.values.get(draftStorageKey(another.access));
  assert.equal(readPendingDraft(draft.access, draft.expiresAt + 1), null);
  assert.deepEqual(storage.removals, [draftStorageKey(draft.access)]);
  assert.equal(storage.values.get(draftStorageKey(another.access)), otherRaw);
});

test('reads and repeated persistence for retry never renew the draft expiry', (t) => {
  const storage = installStorage(t);
  const draft = createDraft();
  seed(storage, draft.access, draft);
  for (const time of [now, now + 60_000, draft.expiresAt - 1]) {
    const recovered = readPendingDraft(draft.access, time);
    assert.deepEqual(recovered, draft);
    writePendingDraft(recovered!);
  }
  assert.deepEqual(JSON.parse(storage.values.get(draftStorageKey(draft.access))!), draft);
  assert.equal(readPendingDraft(draft.access, draft.expiresAt), null);
});

test('draft payload binding must match its storage namespace exactly', (t) => {
  const storage = installStorage(t);
  const access = teacherAccess();
  for (const foreign of [
    { ...access, userId: 'other-user' },
    { ...access, workspaceId: 'other-workspace' },
    { ...access, role: 'viewer' as const },
    { ...access, classIds: ['class-a', 'class-b'] },
  ]) {
    seed(storage, access, { ...createDraft(), access: foreign });
    assert.equal(readPendingDraft(access, now), null);
  }
});

test('both pending and uncertain snapshots must stay within the authorized class scope', (t) => {
  const storage = installStorage(t);
  const access = teacherAccess();
  for (const field of ['data', 'uncertainData'] as const) {
    const draft = createDraft();
    draft[field] = dataFor('class-a', 'class-b');
    seed(storage, access, draft);
    assert.equal(readPendingDraft(access, now), null, `${field} must not contain Class B`);
  }
});

test('an unauthorized current class selection is rejected even when no class object leaks', (t) => {
  const storage = installStorage(t);
  const draft = createDraft();
  draft.data.currentClassId = 'class-b';
  seed(storage, draft.access, draft);
  assert.equal(readPendingDraft(draft.access, now), null);
});

test('workspace-wide admins may recover both classes while scoped empty data remains valid', (t) => {
  const storage = installStorage(t);
  const draft = createDraft(adminAccess());
  draft.data = dataFor('class-a', 'class-b');
  seed(storage, draft.access, draft);
  assert.deepEqual(readPendingDraft(draft.access, now), draft);
  assert.equal(isDraftDataWithinAccess(dataFor(), teacherAccess()), true);
});

test('malformed workspace snapshots are never returned as recoverable drafts', (t) => {
  const storage = installStorage(t);
  const access = teacherAccess();
  for (const data of [null, {}, [], { classes: [], currentClassId: 1 },
    { classes: null, currentClassId: '' }, { classes: [null], currentClassId: '' },
    { classes: [{ id: 'class-a', students: {} }], currentClassId: 'class-a' }]) {
    seed(storage, access, { ...createDraft(), data });
    assert.equal(readPendingDraft(access, now), null);
  }
});

test('invalid metadata, future timestamps, and forged TTLs cannot recover a draft', (t) => {
  const storage = installStorage(t);
  const access = teacherAccess();
  const draft = createDraft();
  for (const changes of [
    { version: 1 }, { access: null }, { baseRevision: -1 }, { baseRevision: 1.5 },
    { baseRevision: Number.MAX_SAFE_INTEGER + 1 }, { baseRevision: '7' },
    { requestId: '' }, { requestId: 12 },
    { createdAt: 0 }, { createdAt: -1 }, { createdAt: 1.5 },
    { createdAt: now + 1, updatedAt: now + 1, expiresAt: now + 1 + DRAFT_TTL_MS },
    { updatedAt: draft.createdAt - 1 }, { updatedAt: now + 1, expiresAt: now + 1 + DRAFT_TTL_MS },
    { updatedAt: '123' }, { expiresAt: draft.expiresAt + 1 }, { expiresAt: undefined },
  ]) {
    seed(storage, access, { ...draft, ...changes });
    assert.equal(readPendingDraft(access, now), null, JSON.stringify(changes));
  }
});

test('revision zero remains a valid draft base for an uninitialized workspace', (t) => {
  const storage = installStorage(t);
  const draft = { ...createDraft(), baseRevision: 0 };
  seed(storage, draft.access, draft);
  assert.deepEqual(readPendingDraft(draft.access, now), draft);
});

test('malformed JSON and primitive payloads do not throw or expose draft data', (t) => {
  const storage = installStorage(t);
  const access = teacherAccess();
  for (const raw of ['{broken', 'null', 'false', '1', '"draft"', '[]']) {
    storage.values.set(draftStorageKey(access), raw);
    assert.equal(readPendingDraft(access, now), null);
  }
});

test('unbound legacy v1 drafts remain retained but cannot be inferred or restored', (t) => {
  const storage = installStorage(t);
  const access = teacherAccess();
  const legacyKey = `epet-unsynced-workspace-v1:${access.workspaceId}`;
  const legacy = JSON.stringify({ version: 1, workspaceId: access.workspaceId,
    baseRevision: 7, updatedAt: now, data: dataFor('class-a', 'class-b') });
  storage.values.set(legacyKey, legacy);
  assert.equal(readPendingDraft(access, now), null);
  clearPendingDraft(access);
  assert.equal(storage.values.get(legacyKey), legacy);
  assert.deepEqual(storage.reads, [draftStorageKey(access)]);
  assert.equal(storage.enumerations, 0);
});

test('storage absence is safe for read, save, and clear', (t) => {
  installStorage(t);
  Reflect.deleteProperty(globalThis, 'sessionStorage');
  assert.equal(readPendingDraft(teacherAccess(), now), null);
  assert.doesNotThrow(() => writePendingDraft(createDraft()));
  assert.doesNotThrow(() => clearPendingDraft(teacherAccess()));
});

test('a browser policy that blocks the sessionStorage property fails safely', (t) => {
  installStorage(t);
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() { throw new Error('Synthetic storage policy denial'); },
  });
  assert.equal(readPendingDraft(teacherAccess(), now), null);
  assert.doesNotThrow(() => writePendingDraft(createDraft()));
  assert.doesNotThrow(() => clearPendingDraft(teacherAccess()));
});

test('storage access failures do not interrupt the in-memory sync queue', (t) => {
  const failure = () => { throw new Error('Synthetic storage unavailable'); };
  installStorage(t, { getItem: failure, setItem: failure, removeItem: failure });
  assert.equal(readPendingDraft(teacherAccess(), now), null);
  assert.doesNotThrow(() => writePendingDraft(createDraft()));
  assert.deepEqual(readPendingDraft(teacherAccess(), now), createDraft());
  assert.equal(readPendingDraft({ ...teacherAccess(), userId: 'other-user' }, now), null);
  assert.equal(readPendingDraft({ ...teacherAccess(), classIds: ['class-b'] }, now), null);
  assert.equal(readPendingDraft(teacherAccess(), createDraft().expiresAt), null);
  assert.doesNotThrow(() => clearPendingDraft(teacherAccess()));
});

test('a quota failure restores the latest isolated memory draft instead of an older readable storage value', (t) => {
  const storage = installStorage(t);
  const previous = createDraft();
  writePendingDraft(previous);
  const latest = { ...previous, requestId: 'latest-unsaved-request',
    data: dataFor('class-a'), updatedAt: previous.updatedAt + 1,
    expiresAt: previous.expiresAt + 1 };
  latest.data.classes[0].students[0].name = 'Latest unsynchronized learner';
  storage.setItem = () => { throw new Error('Synthetic quota exceeded'); };
  writePendingDraft(latest);
  assert.equal(storage.values.get(draftStorageKey(previous.access)), JSON.stringify(previous));
  assert.deepEqual(readPendingDraft(latest.access, now), latest);
  assert.equal(readPendingDraft({ ...latest.access, userId: 'other-user' }, now), null);
  clearPendingDraft(latest.access);
  assert.equal(readPendingDraft(latest.access, now), null);
});

test('explicit discard reports failed storage removal and retains both old storage and latest memory draft', (t) => {
  const storage = installStorage(t);
  const draft = createDraft({ ...teacherAccess(), userId: 'discard-removal-test' });
  assert.equal(writePendingDraft(draft), true);
  const raw = storage.values.get(draftStorageKey(draft.access));
  const latest = { ...draft, requestId: 'newer-unsynchronized-edit', data: dataFor('class-a') };
  latest.data.classes[0].students[0].name = 'Synthetic newest local edit';
  storage.setItem = () => { throw new Error('Synthetic quota failure'); };
  assert.equal(writePendingDraft(latest), false);
  const remove = storage.removeItem.bind(storage);
  storage.removeItem = () => { throw new Error('Synthetic removal policy denial'); };
  assert.equal(clearPendingDraft(draft.access), false);
  assert.equal(storage.values.get(draftStorageKey(draft.access)), raw);
  assert.deepEqual(readPendingDraft(draft.access, now), latest);
  storage.removeItem = remove;
  assert.equal(clearPendingDraft(draft.access), true);
  assert.equal(readPendingDraft(draft.access, now), null);
});

test('explicit discard clears only the exact authenticated namespace and cannot resurrect its memory fallback', (t) => {
  const storage = installStorage(t);
  const access = { ...teacherAccess(), userId: 'discard-namespace-test' };
  const otherAccess = { ...access, classIds: ['class-b'] };
  const draft = createDraft(access);
  const other = { ...createDraft(otherAccess), data: dataFor('class-b') };
  assert.equal(writePendingDraft(other), true);
  const write = storage.setItem.bind(storage);
  storage.setItem = () => { throw new Error('Synthetic quota failure'); };
  assert.equal(writePendingDraft(draft), false);
  assert.deepEqual(readPendingDraft(access, now), draft);
  storage.setItem = write;
  assert.equal(clearPendingDraft(access), true);
  assert.equal(readPendingDraft(access, now), null);
  assert.deepEqual(readPendingDraft(otherAccess, now), other);
  assert.equal(storage.enumerations, 0);
});

test('a committed normalized enrollment matches its in-flight draft without hiding a later real edit', () => {
  const draft = dataFor('class-a');
  draft.classes[0].students.push(createEnrolledStudent({ id: 'new-student', name: 'New synthetic student' }));
  const committed = normalizeAppData(draft, now);
  assert.notEqual(JSON.stringify(committed), JSON.stringify(draft), 'server adds canonical defaults');
  assert.equal(sameWorkspaceData(committed, draft, now), true);
  const changed = structuredClone(committed);
  changed.classes[0].students[1].points += 1;
  assert.equal(sameWorkspaceData(changed, draft, now), false);
  changed.classes[0].students[1].points -= 1;
  changed.classes[0].students[1].name = 'Different synthetic student';
  assert.equal(sameWorkspaceData(changed, draft, now), false);
});

test('snapshot equivalence ignores object property order but preserves class and student sequence', () => {
  const draft = dataFor('class-a', 'class-b');
  const reorderedObjects = JSON.parse(JSON.stringify(draft, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value));
  assert.equal(sameWorkspaceData(reorderedObjects, draft, now), true);
  assert.equal(sameWorkspaceData({ ...draft, classes: [...draft.classes].reverse() }, draft, now), false);
  assert.equal(sameWorkspaceData(null, draft, now), false);
});
