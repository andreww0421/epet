import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { workspaceAccessKey, type WorkspaceAccess } from '../shared/contracts/workspace';
import {
  buildTeacherSetupSteps, consumeTeacherSetupRegistration, createTeacherSetupState, isTeacherSetupState,
  markTeacherSetupRegistration, patchTeacherSetupState, readTeacherSetupState, teacherSetupStorageKey,
  TEACHER_SETUP_REGISTRATION_PREFIX, TEACHER_SETUP_STORAGE_PREFIX, writeTeacherSetupState,
  type TeacherSetupState,
} from '../src/features/teacher-console/model/teacherSetup';
import { createDashboardStudent } from '../src/features/students/model/createDashboardStudent';
import type { AppData, PointAdjustmentRecord } from '../src/store/types';

let fixtureId = 0;
const accessFor = (): WorkspaceAccess => ({
  userId: `setup-user-${++fixtureId}`, workspaceId: 'setup-workspace', role: 'owner', classIds: null,
});
const dataFor = (): AppData => ({ lastOpened: 1, currentClassId: 'default',
  classes: [{ id: 'default', name: 'Synthetic private class', students: [] }] });
class MemoryStorage implements Storage {
  values = new Map<string, string>();
  reads: string[] = [];
  writes: string[] = [];
  removals: string[] = [];
  enumerations = 0;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  key(index: number) { this.enumerations += 1; return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { this.reads.push(key); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes.push(key); this.values.set(key, value); }
  removeItem(key: string) { this.removals.push(key); this.values.delete(key); }
}
const installStorage = (t: TestContext, name: 'localStorage' | 'sessionStorage', storage: unknown = new MemoryStorage()) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value: storage });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  });
  return storage as MemoryStorage;
};
const fullState = (): TeacherSetupState => ({ mode: 'active', reviewed: true, gameMode: 'hidden' });

test('setup state validates only the three functional flags and every supported mode', () => {
  assert.deepEqual(createTeacherSetupState(), { mode: 'idle', reviewed: false, gameMode: null });
  for (const mode of ['idle', 'active', 'paused', 'skipped', 'completed']) {
    assert.equal(isTeacherSetupState({ mode, reviewed: false, gameMode: null }), true);
  }
  for (const value of [null, [], {}, { ...fullState(), mode: 'unknown' },
    { ...fullState(), reviewed: 'yes' }, { ...fullState(), gameMode: true },
    { ...fullState(), classes: [] }, { mode: 'active', reviewed: true }]) {
    assert.equal(isTeacherSetupState(value), false);
  }
});

test('functional flag patches preserve concurrent changes and reject malformed runtime values', () => {
  const reviewed = patchTeacherSetupState(createTeacherSetupState(), { reviewed: true });
  const chosen = patchTeacherSetupState(reviewed, { gameMode: 'shown' });
  assert.deepEqual(chosen, { mode: 'idle', reviewed: true, gameMode: 'shown' });
  assert.deepEqual(patchTeacherSetupState(chosen, { mode: 'paused' }), { ...chosen, mode: 'paused' });
  assert.deepEqual(patchTeacherSetupState(chosen, { mode: 'invalid', reviewed: null, gameMode: 3 } as never), chosen);
  assert.deepEqual(patchTeacherSetupState(chosen, { gameMode: null }), { ...chosen, gameMode: null });
});

test('preference namespace binds exact principal, workspace, role and normalized class scope', () => {
  const access: WorkspaceAccess = { ...accessFor(), role: 'teacher', classIds: ['class-b', 'class-a', 'class-a'] };
  const key = teacherSetupStorageKey(access);
  assert.equal(key, `${TEACHER_SETUP_STORAGE_PREFIX}${encodeURIComponent(workspaceAccessKey(access))}`);
  assert.equal(teacherSetupStorageKey({ ...access, classIds: ['class-a', 'class-b'] }), key);
  for (const changed of [{ ...access, userId: 'another-user' }, { ...access, workspaceId: 'another-workspace' },
    { ...access, role: 'viewer' as const }, { ...access, classIds: ['class-a'] },
    { ...access, role: 'owner' as const, classIds: null }]) {
    assert.notEqual(teacherSetupStorageKey(changed), key);
  }
  assert.notEqual(teacherSetupStorageKey({ ...access, userId: 'a:b', workspaceId: 'c' }),
    teacherSetupStorageKey({ ...access, userId: 'a', workspaceId: 'b:c' }));
});

test('existing accounts remain idle and read only their own verified preference key', (t) => {
  const storage = installStorage(t, 'localStorage');
  const access = accessFor();
  const another = { ...access, userId: 'private-other-user' };
  storage.values.set(teacherSetupStorageKey(another), JSON.stringify(fullState()));
  assert.deepEqual(readTeacherSetupState(access), { state: createTeacherSetupState(), storageAvailable: true });
  assert.deepEqual(storage.reads, [teacherSetupStorageKey(access)]);
  assert.equal(storage.enumerations, 0);
  assert.equal(storage.writes.length, 0);
});

test('preference reads isolate every scope change and recover only the exact authority', (t) => {
  installStorage(t, 'localStorage');
  const access: WorkspaceAccess = { ...accessFor(), role: 'teacher', classIds: ['class-a', 'class-b'] };
  assert.equal(writeTeacherSetupState(access, fullState()), true);
  assert.deepEqual(readTeacherSetupState({ ...access, classIds: ['class-b', 'class-a', 'class-b'] }).state, fullState());
  for (const changed of [{ ...access, userId: 'different-user' }, { ...access, workspaceId: 'different-workspace' },
    { ...access, role: 'viewer' as const }, { ...access, classIds: ['class-a'] }]) {
    assert.deepEqual(readTeacherSetupState(changed).state, createTeacherSetupState());
  }
});

test('malformed and snapshot-shaped preferences do not become functional state', (t) => {
  const storage = installStorage(t, 'localStorage');
  const access = accessFor();
  for (const raw of ['{invalid', ` ${JSON.stringify(fullState())}${' '.repeat(256)}`, JSON.stringify({ ...fullState(), classes: [{ name: 'Private learner' }] }),
    JSON.stringify({ ...fullState(), reviewed: 1 })]) {
    storage.values.set(teacherSetupStorageKey(access), raw);
    assert.deepEqual(readTeacherSetupState(access).state, createTeacherSetupState());
  }
  assert.equal(writeTeacherSetupState(access, { ...fullState(), snapshot: 'Private learner' } as never), false);
  assert.equal(storage.writes.length, 0);
});

test('stored flags contain no class, student or activity snapshots', (t) => {
  const storage = installStorage(t, 'localStorage');
  const access = accessFor();
  const data = dataFor();
  const student = createDashboardStudent('Synthetic confidential learner', 'confidential-student-id');
  student.pointAdjustmentRecords = [{ id: 'confidential-record-id', amount: 1, source: 'manual', createdAt: 1, reasonLabel: 'Private note' }];
  data.classes[0].students.push(student);
  const state = fullState();
  buildTeacherSetupSteps(data, state, access);
  writeTeacherSetupState(access, state);
  assert.deepEqual([...storage.values.values()], [JSON.stringify(state)]);
  const raw = [...storage.values.values()].join('');
  for (const privateText of [student.name, student.id, 'confidential-record-id', 'Private note', data.classes[0].name, 'students', 'steps']) {
    assert.equal(raw.includes(privateText), false);
  }
});

test('storage failures preserve the newest memory state without crossing identities', (t) => {
  const access = accessFor();
  const storage = installStorage(t, 'localStorage');
  writeTeacherSetupState(access, { ...fullState(), gameMode: 'shown' });
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  assert.equal(writeTeacherSetupState(access, fullState()), false);
  assert.deepEqual(readTeacherSetupState(access), { state: fullState(), storageAvailable: false });
  assert.deepEqual(readTeacherSetupState({ ...access, userId: `${access.userId}-other` }).state, createTeacherSetupState());
  storage.setItem = MemoryStorage.prototype.setItem;
  assert.equal(writeTeacherSetupState(access, { ...fullState(), mode: 'paused' }), true);
  assert.deepEqual(readTeacherSetupState(access), { state: { ...fullState(), mode: 'paused' }, storageAvailable: true });
});

test('unavailable browser storage remains usable with exact-scope memory flags', (t) => {
  const access = accessFor();
  installStorage(t, 'localStorage', undefined);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage denied'); } });
  assert.deepEqual(readTeacherSetupState(access), { state: createTeacherSetupState(), storageAvailable: false });
  assert.equal(writeTeacherSetupState(access, fullState()), false);
  assert.deepEqual(readTeacherSetupState(access).state, fullState());
  if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
});

test('registration enrollment consumes only the exact new-account tuple after valid access', (t) => {
  const storage = installStorage(t, 'sessionStorage');
  const access = accessFor();
  markTeacherSetupRegistration(access.userId, access.workspaceId);
  assert.equal(consumeTeacherSetupRegistration({ ...access, userId: `${access.userId}-other` }), false);
  assert.equal(consumeTeacherSetupRegistration({ ...access, workspaceId: 'different-workspace' }), false);
  assert.equal(consumeTeacherSetupRegistration({ ...access, role: 'teacher', classIds: null } as never), false);
  assert.equal(storage.removals.length, 0);
  assert.equal(consumeTeacherSetupRegistration(access), true);
  assert.equal(consumeTeacherSetupRegistration(access), false);
  assert.equal(storage.removals.length, 1);
  assert.equal(storage.enumerations, 0);
  assert.equal(storage.writes.every((key) => key.startsWith(TEACHER_SETUP_REGISTRATION_PREFIX)), true);
  assert.deepEqual([...storage.values.values()], []);
});

test('registration can recover from session storage after reload without enumerating other tuples', (t) => {
  const storage = installStorage(t, 'sessionStorage');
  const access = accessFor();
  const key = `${TEACHER_SETUP_REGISTRATION_PREFIX}${encodeURIComponent(JSON.stringify([access.userId, access.workspaceId]))}`;
  storage.values.set(key, 'registered');
  assert.equal(consumeTeacherSetupRegistration(access), true);
  assert.deepEqual(storage.reads, [key]);
  assert.deepEqual(storage.removals, [key]);
});

test('registration fallback survives session storage denial and cannot be consumed twice', (t) => {
  installStorage(t, 'sessionStorage', { getItem() { throw new Error('Denied'); },
    setItem() { throw new Error('Denied'); }, removeItem() { throw new Error('Denied'); } });
  const access = accessFor();
  markTeacherSetupRegistration(access.userId, access.workspaceId);
  assert.equal(consumeTeacherSetupRegistration(access), true);
  assert.equal(consumeTeacherSetupRegistration(access), false);
});

test('the default class completes step one without creating another class or persisting facts', () => {
  const access = accessFor();
  const data = dataFor();
  const before = structuredClone(data);
  assert.deepEqual(buildTeacherSetupSteps(data, createTeacherSetupState(), access), [
    { id: 'class', completed: true }, { id: 'roster', completed: false }, { id: 'points', completed: false },
    { id: 'review', completed: false }, { id: 'game', completed: false },
  ]);
  assert.deepEqual(data, before);
});

test('setup facts derive from active authorized classes and live roster or record changes', () => {
  const access: WorkspaceAccess = { ...accessFor(), role: 'teacher', classIds: ['default'] };
  const data = dataFor();
  const student = createDashboardStudent('Synthetic learner', 'synthetic-student');
  data.classes.push({ id: 'other', name: 'Other class', students: [student] });
  assert.deepEqual(buildTeacherSetupSteps(data, createTeacherSetupState(), access).map((step) => step.completed), [true, false, false, false, false]);
  data.classes[0].students.push(student);
  assert.equal(buildTeacherSetupSteps(data, createTeacherSetupState(), access)[1].completed, true);
  student.pointAdjustmentRecords = [{ id: 'point', source: 'manual', amount: -1, createdAt: 1 }];
  assert.equal(buildTeacherSetupSteps(data, createTeacherSetupState(), access)[2].completed, true);
  data.classes[0].students = [];
  assert.equal(buildTeacherSetupSteps(data, createTeacherSetupState(), access)[2].completed, false);
  data.classes[0].archivedAt = 1;
  assert.equal(buildTeacherSetupSteps(data, createTeacherSetupState(), access)[0].completed, false);
});

test('another populated authorized class does not skip the selected empty class roster', () => {
  const access = accessFor();
  const data = dataFor();
  const student = createDashboardStudent('Synthetic learner', 'student');
  student.pointAdjustmentRecords = [{ id: 'point', source: 'manual', amount: 1, createdAt: 1 }];
  data.classes.push({ id: 'another', name: 'Synthetic another class', students: [student] });
  assert.deepEqual(buildTeacherSetupSteps(data, createTeacherSetupState(), access).slice(0, 3).map((step) => step.completed), [true, false, false]);
  data.currentClassId = 'another';
  assert.deepEqual(buildTeacherSetupSteps(data, createTeacherSetupState(), access).slice(0, 3).map((step) => step.completed), [true, true, true]);
});

test('automated task/support rewards, zero or blocked adjustments do not complete teacher feedback', () => {
  const access = accessFor();
  const data = dataFor();
  const student = createDashboardStudent('Synthetic learner', 'student');
  data.classes[0].students.push(student);
  const automatic: PointAdjustmentRecord['source'][] = ['dailyTask', 'participationTopUp', 'catchUpBonus'];
  student.pointAdjustmentRecords = automatic.map((source) => ({ id: source, source, amount: 10, createdAt: 1 }));
  student.pointAdjustmentRecords.push({ id: 'zero', source: 'manual', amount: 0, createdAt: 1 },
    { id: 'blocked', source: 'quick', amount: 0, createdAt: 1, guardrailOutcome: 'blocked' });
  assert.equal(buildTeacherSetupSteps(data, createTeacherSetupState(), access)[2].completed, false);
  for (const source of ['manual', 'quick', 'airdrop'] as const) {
    student.pointAdjustmentRecords = [{ id: source, source, amount: 1, createdAt: 1 }];
    assert.equal(buildTeacherSetupSteps(data, createTeacherSetupState(), access)[2].completed, true);
  }
});

test('review and either game choice explicitly complete their individual steps', () => {
  const data = dataFor();
  const access = accessFor();
  for (const gameMode of ['shown', 'hidden'] as const) {
    const steps = buildTeacherSetupSteps(data, { mode: 'active', reviewed: true, gameMode }, access);
    assert.deepEqual(steps.slice(3), [{ id: 'review', completed: true }, { id: 'game', completed: true }]);
  }
});

test('future and invalid point timestamps do not prematurely complete a teacher adjustment', () => {
  const data = dataFor();
  const access = accessFor();
  const student = createDashboardStudent('Synthetic learner', 'student');
  data.classes[0].students.push(student);
  student.pointAdjustmentRecords = [{ id: 'future', source: 'manual', amount: 1, createdAt: 101 },
    { id: 'invalid', source: 'quick', amount: 1, createdAt: Number.NaN }];
  assert.equal(buildTeacherSetupSteps(data, createTeacherSetupState(), access, 100)[2].completed, false);
  assert.equal(buildTeacherSetupSteps(data, createTeacherSetupState(), access, 101)[2].completed, true);
});
