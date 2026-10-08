import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  CLASS_ARCHIVE_CONFIRMATIONS, getActiveClasses, isArchivedClass,
  normalizeArchivedAt, updateClassArchive,
} from '../shared/domain/classArchive';
import { createApiHandler } from '../server/api';
import { AuthService, type AuthorizedWorkspace } from '../server/auth';
import type { StoredWorkspace, WorkspaceRole, WorkspaceWriteContext } from '../server/contracts';
import { errorResponse } from '../server/middleware/errorResponse';
import { JsonWorkspaceRepository } from '../server/repository';
import { handleClassRoutes } from '../server/routes/classRoutes';
import type { WorkspaceRouteContext } from '../server/routes/types';
import { mergeTeacherWorkspaceData, scopeWorkspaceData, WorkspaceScopeViolationError } from '../server/workspaceScope';
import { buildClassroomPresentation } from '../src/features/classroom/model/classroomPresentation';
import { applyDecay, normalizeAppData } from '../src/store/utils';
import type { AppData } from '../src/store/types';
import { anonymizeStudentInWorkspaceData } from '../shared/domain/studentPrivacy';

const now = Date.parse('2026-10-08T09:00:00Z');
const createData = (): AppData => ({
  lastOpened: now,
  currentClassId: 'class-a',
  settings: {
    decayAmount: 2, decayType: 'hourly', pauseDecayOnWeekends: false,
    inclusiveMode: false, publicNameMode: 'full', publicLeaderboardMode: 'rank',
  },
  classes: [{
    id: 'class-a', name: 'Class A',
    students: [{
      id: 'private-student-a', name: 'Private learner A', points: 271,
      rankPoints: 42, warningPoints: 1, activeWarningTimestamps: [now - 10],
      pet: { type: 'dog', fullness: 75, happiness: 64, level: 3 },
      stats: { wins: 2, losses: 1 }, nextUpgradeGachaLevel: 5,
      disciplineRecords: [{ id: 'discipline-a', type: 'warning', createdAt: now, reason: 'Private note' }],
      pointAdjustmentRecords: [{ id: 'points-a', amount: 11, createdAt: now, source: 'manual', reasonLabel: 'Private point reason' }],
      dailyProgress: { streak: 3, lastClaimDate: '2026-10-08', reflections: [{
        id: 'reflection-a', date: '2026-10-08', createdAt: now,
        competency: 'participation', author: 'mentor', text: 'Private comment',
      }] },
    }],
    dailyTaskCalendar: { schoolTimeZone: 'Asia/Taipei', schoolWeekdays: [1, 2, 3, 4, 5], schoolHolidayDates: [], dailyTaskMakeupWindowDays: 2 },
    learningEvidenceRecords: [{
      id: 'evidence-a', classId: 'class-a', studentId: 'private-student-a',
      competency: 'participation', level: 'mastered', evidenceType: 'observation',
      title: 'Private evidence', actor: 'mentor', source: 'manual',
      rubricVersion: '1.0', revision: 1, createdAt: now,
    }],
    classGoals: [{ id: 'goal-a', title: 'Weekly goal', competency: 'collaboration', targetCount: 4, createdAt: now }],
    examRecords: [{
      id: 'exam-a', title: 'Exam A', examDate: '2026-10-08',
      items: [{ id: 'math', name: 'Math', maxScore: 100 }],
      results: [{ studentId: 'private-student-a', scores: { math: 93 }, mentorComment: 'Private exam note', updatedAt: now }],
      createdAt: now, updatedAt: now,
    }],
    activeBoss: {
      id: 'boss-a', name: 'Boss A', maxHp: 120, currentHp: 65,
      rewardTiers: [], contributions: { 'private-student-a': 22 },
      attackCounts: { 'private-student-a': 2 }, isActive: true,
    },
  }, {
    id: 'class-b', name: 'Class B',
    students: [{ id: 'student-b', name: 'Learner B', points: 123,
      pet: { type: 'cat', fullness: 81, happiness: 72, level: 2 } }],
  }],
});

test('class archive changes only availability metadata and never game or educational data', () => {
  const original = createData();
  const before = structuredClone(original);
  const archived = updateClassArchive(original, 'class-a', 'archive', now);
  assert.deepEqual(original, before, 'input must not be mutated');
  assert.deepEqual(archived.classes[0], { ...original.classes[0], archivedAt: now });
  assert.equal(archived.classes[1], original.classes[1]);
  assert.equal(archived.settings, original.settings);
  assert.equal(archived.lastOpened, original.lastOpened);
  assert.equal(archived.currentClassId, 'class-b');
  const reopened = updateClassArchive(archived, 'class-a', 'reopen', now + 1);
  assert.deepEqual(reopened.classes[0], original.classes[0]);
  assert.equal(Object.hasOwn(reopened.classes[0], 'archivedAt'), false);
  assert.equal(reopened.currentClassId, 'class-b', 'reopening does not unexpectedly switch the teacher’s selected class');
});

test('archive timestamp normalization fails closed on malformed metadata', () => {
  for (const value of [undefined, null, 0, -1, 1.5, '123', true, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
    assert.equal(normalizeArchivedAt(value), undefined);
  }
  assert.equal(normalizeArchivedAt(now), now);
  assert.equal(isArchivedClass({ archivedAt: 0 }), false);
  assert.equal(isArchivedClass({ archivedAt: now }), true);
  const state = createData();
  state.classes[0].archivedAt = now;
  const normalized = normalizeAppData(state, now);
  assert.equal(normalized.classes[0].archivedAt, now);
  assert.equal(normalized.currentClassId, 'class-b');
  state.classes[0].archivedAt = -10;
  const malformed = normalizeAppData(state, now);
  assert.equal(malformed.classes[0].archivedAt, undefined);
  assert.equal(malformed.currentClassId, 'class-a');
});

test('class archive and reopening are idempotent and the last active class cannot be archived', () => {
  const original = createData();
  assert.equal(updateClassArchive(original, 'class-a', 'reopen', now), original);
  const archived = updateClassArchive(original, 'class-a', 'archive', now);
  assert.equal(updateClassArchive(archived, 'class-a', 'archive', now + 1), archived);
  assert.deepEqual(getActiveClasses(archived.classes).map((item) => item.id), ['class-b']);
  assert.throws(() => updateClassArchive(archived, 'class-b', 'archive', now), /LAST_ACTIVE_CLASS/);
  assert.throws(() => updateClassArchive(original, 'missing-class', 'archive', now), /CLASS_NOT_FOUND/);
  assert.deepEqual(CLASS_ARCHIVE_CONFIRMATIONS, { archive: 'ARCHIVE CLASS', reopen: 'REOPEN CLASS' });
});

test('current-class fallback skips archived classes and preserves another active selection', () => {
  const state = createData();
  state.classes.unshift({ id: 'older-archive', name: 'Older class', students: [], archivedAt: now - 1 });
  const archived = updateClassArchive(state, 'class-a', 'archive', now);
  assert.equal(archived.currentClassId, 'class-b');
  const other = createData();
  other.currentClassId = 'class-b';
  assert.equal(updateClassArchive(other, 'class-a', 'archive', now).currentClassId, 'class-b');
});

test('teacher-scoped views use an active assigned class or a safe empty current selection', () => {
  const state = updateClassArchive(createData(), 'class-a', 'archive', now);
  state.currentClassId = 'class-a';
  const both = scopeWorkspaceData(state, new Set(['class-a', 'class-b']));
  assert.equal(both.currentClassId, 'class-b');
  const archivedOnly = scopeWorkspaceData(state, new Set(['class-a']));
  assert.equal(archivedOnly.currentClassId, '');
  assert.equal(archivedOnly.classes[0].id, 'class-a', 'archived data remains retained in a scoped response');
  assert.deepEqual(archivedOnly.classes[0], state.classes[0]);
});

test('a directly supplied archived class cannot project students, rankings or boss information', () => {
  const data = createData();
  data.classes[0].archivedAt = now;
  const before = structuredClone(data);
  const projection = buildClassroomPresentation(data.classes[0], data.settings, {
    maskNames: false, inclusiveLeaderboard: false,
  });
  assert.deepEqual(projection.students, []);
  assert.deepEqual(projection.leaderboard.students, []);
  assert.equal(projection.boss, null);
  assert.equal(JSON.stringify(projection).includes('Private'), false);
  assert.deepEqual(data, before);
});

test('background decay preserves archived class identity while active classes use unchanged decay rules', () => {
  const state = createData();
  state.classes[0].archivedAt = now - 10;
  const archived = state.classes[0];
  const before = structuredClone(archived);
  const decayed = applyDecay(state, now + 2 * 60 * 60 * 1_000);
  assert.equal(decayed.classes[0], archived);
  assert.deepEqual(decayed.classes[0], before);
  assert.equal(decayed.classes[1].students[0].pet.fullness, 77);
  assert.equal(decayed.classes[1].students[0].points, 123);
  assert.equal(state.classes[1].students[0].pet.fullness, 81);
  assert.equal(decayed.lastOpened, now + 2 * 60 * 60 * 1_000);
  const baseline = createData();
  const baselineDecayed = applyDecay(baseline, now + 2 * 60 * 60 * 1_000);
  assert.deepEqual(decayed.classes[1], baselineDecayed.classes[1]);
});

test('zero-period rest-mode reconciliation does not revive or rewrite an archived pet', () => {
  const state = createData();
  state.classes[0].archivedAt = now - 10;
  state.classes[0].students[0].pet.isDead = true;
  state.classes[1].students[0].pet.isDead = true;
  const archived = state.classes[0];
  const reconciled = applyDecay(state, now + 1);
  assert.equal(reconciled.classes[0], archived);
  assert.equal(reconciled.classes[0].students[0].pet.isDead, true);
  assert.equal(reconciled.classes[1].students[0].pet.isDead, false);
});

test('archived normalization freezes expiry and life-state clocks while active classes still use current time', () => {
  const state = createData();
  const learner = state.classes[0].students[0];
  learner.nextUpgradeGachaLevel = 4;
  learner.pet = { ...learner.pet, fullness: 0, zeroFullnessSince: now, isDead: false };
  learner.penaltyStatus = { source: 'discipline', until: now + 60_000 };
  learner.bossRecovery = { impact: 5, startedAt: now - 1, recoverAt: now + 60_000 };
  state.classes[1].students = [{ ...structuredClone(learner), id: 'active-learner' }];
  const canonical = normalizeAppData(state, now);
  const archived = updateClassArchive(canonical, 'class-a', 'archive', now);
  const future = normalizeAppData(archived, now + 3 * 24 * 60 * 60 * 1_000);
  assert.deepEqual(future.classes[0], archived.classes[0]);
  assert.equal(future.classes[0].students[0].pet.isDead, false);
  assert.deepEqual(future.classes[0].students[0].penaltyStatus, learner.penaltyStatus);
  assert.deepEqual(future.classes[0].students[0].bossRecovery, learner.bossRecovery);
  assert.equal(future.classes[1].students[0].penaltyStatus, undefined);
  assert.equal(future.classes[1].students[0].bossRecovery, undefined);
  assert.equal(future.classes[1].students[0].pet.isDead, true);
});

test('legacy archived fallback identifiers and dates normalize using a stable class clock', () => {
  const legacy = {
    currentClassId: 'active-class',
    classes: [{
      archivedAt: now, name: 'Legacy archive',
      students: [{ name: 'Legacy learner', points: 100,
        pet: { type: 'dog', fullness: 0, happiness: 70, level: 2 } }],
      classGoals: [{ competency: 'collaboration', targetCount: 3 }],
      activeBoss: { maxHp: 100, currentHp: 90, isActive: true, contributions: {} },
    }, { id: 'active-class', name: 'Active class', students: [] }],
  };
  const first = normalizeAppData(legacy, now);
  const later = normalizeAppData(legacy, now + 14 * 24 * 60 * 60 * 1_000);
  assert.deepEqual(later.classes[0], first.classes[0]);
  assert.equal(first.classes[0].id, `class-${now}-0`);
  assert.equal(first.classes[0].students[0].id, `student-${now}-0`);
  assert.equal(first.classes[0].activeBoss?.id, `boss-${now}-0`);
});

test('canonical archive comparison permits normalization shape drift but retains the trusted raw snapshot', () => {
  const canonical = normalizeAppData(createData(), now);
  const archived = updateClassArchive(canonical, 'class-a', 'archive', now);
  const current = anonymizeStudentInWorkspaceData(archived, 'private-student-a', 'anonymous-fresh');
  const before = structuredClone(current.classes[0]);
  const future = now + 3 * 24 * 60 * 60 * 1_000;
  const comparison = normalizeAppData(current, future);
  const draft = normalizeAppData(scopeWorkspaceData(current, new Set(['class-a', 'class-b'])), future);
  assert.notEqual(JSON.stringify(draft.classes[0]), JSON.stringify(current.classes[0]),
    'privacy projection and normalizer have different field order/defaults');
  draft.classes[1].students[0].points += 1;
  const merged = mergeTeacherWorkspaceData(current, draft, new Set(['class-a', 'class-b']), { comparison });
  assert.equal(merged.classes[0], current.classes[0]);
  assert.deepEqual(merged.classes[0], before);
  assert.equal(merged.classes[1].students[0].points, 124);
  draft.classes[0].students[0].points += 1;
  assert.throws(() => mergeTeacherWorkspaceData(current, draft, new Set(['class-a', 'class-b']), { comparison }),
    /CLASS_ARCHIVE_CHANGED/);
});

test('teachers cannot bypass archive or privacy administration through ordinary state merging', () => {
  const state = createData();
  const assignments = new Set(['class-a']);
  const teacherDraft = () => scopeWorkspaceData(state, assignments);
  const archiveDraft = teacherDraft();
  archiveDraft.classes[0].archivedAt = now;
  assert.throws(() => mergeTeacherWorkspaceData(state, archiveDraft, assignments),
    (error: unknown) => error instanceof WorkspaceScopeViolationError && error.code === 'CLASS_ARCHIVE_CHANGED');
  const removal = teacherDraft();
  removal.classes[0].students = [];
  assert.throws(() => mergeTeacherWorkspaceData(state, removal, assignments),
    (error: unknown) => error instanceof WorkspaceScopeViolationError && error.code === 'STUDENT_PRIVACY_ADMIN_REQUIRED');
  const rotatedId = teacherDraft();
  rotatedId.classes[0].students[0].id = 'replacement-student-id';
  assert.throws(() => mergeTeacherWorkspaceData(state, rotatedId, assignments), /STUDENT_PRIVACY_ADMIN_REQUIRED/);
  const removedClass = teacherDraft();
  removedClass.classes = [];
  assert.throws(() => mergeTeacherWorkspaceData(state, removedClass, assignments), /CLASS_SCOPE_CHANGED/);
});

test('teachers cannot reopen or modify retained archived classes but can still edit active assigned students', () => {
  const archived = updateClassArchive(createData(), 'class-a', 'archive', now);
  const assignments = new Set(['class-a', 'class-b']);
  const reopenDraft = scopeWorkspaceData(archived, assignments);
  delete reopenDraft.classes[0].archivedAt;
  assert.throws(() => mergeTeacherWorkspaceData(archived, reopenDraft, assignments), /CLASS_ARCHIVE_CHANGED/);
  const archivedEdit = scopeWorkspaceData(archived, assignments);
  archivedEdit.classes[0].students[0].points += 1;
  assert.throws(() => mergeTeacherWorkspaceData(archived, archivedEdit, assignments), /CLASS_ARCHIVE_CHANGED/);
  const activeEdit = scopeWorkspaceData(archived, assignments);
  activeEdit.classes[1].students[0].points += 1;
  const merged = mergeTeacherWorkspaceData(archived, activeEdit, assignments);
  assert.deepEqual(merged.classes[0], archived.classes[0]);
  assert.equal(merged.classes[1].students[0].points, 124);
  assert.equal(merged.currentClassId, 'class-b');
});

class TrackingRepository extends JsonWorkspaceRepository {
  readonly reads: string[] = [];
  readonly writes: Array<{ workspaceId: string; data: AppData; baseRevision?: number; context?: WorkspaceWriteContext }> = [];
  raceData: AppData | undefined;
  override async get(workspaceId: string): Promise<StoredWorkspace> {
    this.reads.push(workspaceId);
    return super.get(workspaceId);
  }
  override async put(workspaceId: string, data: AppData, baseRevision?: number, context?: WorkspaceWriteContext): Promise<StoredWorkspace> {
    this.writes.push({ workspaceId, data, baseRevision, context });
    if (this.raceData) {
      const replacement = this.raceData;
      this.raceData = undefined;
      await super.put(workspaceId, replacement, baseRevision, { action: 'fixture.concurrent-write' });
    }
    return super.put(workspaceId, data, baseRevision, context);
  }
}

const createFixture = async () => {
  // Keep atomic rename inside the writable workspace; some Windows sandboxes
  // expose os.tmpdir() as a read/write directory but reject file renames there.
  const fixtureRoot = join(process.cwd(), 'output', 'privacy-unit');
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(join(fixtureRoot, 'class-archive-'));
  try {
    const repository = new TrackingRepository(join(directory, 'data.json'));
    const authService = new AuthService(repository, { passwordIterations: 10 });
    const owner = await authService.register({
      email: 'archive-owner@example.test', password: 'synthetic archive fixture password',
      displayName: 'Archive Owner', workspaceName: 'Archive Workspace', initialWorkspaceData: createData(),
    });
    const workspaceId = owner.session.activeWorkspaceId;
    assert.ok(workspaceId);
    const authorized = await authService.authorizeWorkspace(owner.sessionToken, workspaceId);
    repository.reads.length = 0;
    repository.writes.length = 0;
    const context = (
      role: WorkspaceRole = 'owner', body: unknown = { expectedRevision: 1, confirmation: 'ARCHIVE CLASS' },
      classId = 'class-a', action = 'archive', method = 'POST',
    ): WorkspaceRouteContext => {
      const url = new URL(`http://localhost/api/v1/classes/${encodeURIComponent(classId)}/privacy/${action}`);
      const request = new Request(url, { method,
        ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const roleAuthorization: AuthorizedWorkspace = {
        ...authorized, membership: { ...authorized.membership, role },
      };
      return { request, url, headers: {}, repository, authService, workspaceId,
        token: owner.sessionToken, authorized: roleAuthorization,
        getClassScope: async () => null, requireClassAccess: async () => undefined,
      };
    };
    return { repository, authService, owner, authorized, workspaceId, context,
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

const dispatch = async (context: WorkspaceRouteContext): Promise<Response> => {
  try {
    const response = await handleClassRoutes(context);
    assert.ok(response);
    return response;
  } catch (error) {
    return errorResponse(error, context.headers);
  }
};

test('class lifecycle routes require admin or owner before reading bodies or workspace data', async () => {
  const fixture = await createFixture();
  try {
    for (const role of ['teacher', 'viewer'] as const) {
      const response = await dispatch(fixture.context(role, { confirmation: 'WRONG' }));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'FORBIDDEN' });
    }
    assert.deepEqual(fixture.repository.reads, []);
    assert.deepEqual(fixture.repository.writes, []);
  } finally { await fixture.dispose(); }
});

test('class lifecycle routes require exact second confirmation and a safe integer base revision', async () => {
  const fixture = await createFixture();
  try {
    for (const confirmation of [undefined, 'archive class', 'ARCHIVE CLASS ', 'REOPEN CLASS']) {
      const response = await dispatch(fixture.context('owner', { confirmation, expectedRevision: 1 }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'CONFIRMATION_REQUIRED' });
    }
    for (const expectedRevision of [undefined, null, '1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const response = await dispatch(fixture.context('owner', { confirmation: 'ARCHIVE CLASS', expectedRevision }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'BASE_REVISION_REQUIRED' });
    }
    assert.deepEqual(fixture.repository.reads, []);
    assert.deepEqual(fixture.repository.writes, []);
  } finally { await fixture.dispose(); }
});

test('admin archive and owner reopen use one atomic audited revision write and preserve retained records', async () => {
  const fixture = await createFixture();
  try {
    const before = await fixture.repository.get(fixture.workspaceId);
    fixture.repository.reads.length = 0;
    const response = await dispatch(fixture.context('admin'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const archived = await response.json() as StoredWorkspace & { action: string };
    assert.equal(archived.action, 'archive');
    assert.equal(archived.revision, 2);
    assert.equal(archived.data?.currentClassId, 'class-b');
    assert.equal(isArchivedClass(archived.data!.classes[0]), true);
    assert.deepEqual(archived.data?.classes[0].students, before.data?.classes[0].students);
    assert.deepEqual(archived.data?.classes[0].examRecords, before.data?.classes[0].examRecords);
    assert.deepEqual(archived.data?.classes[0].learningEvidenceRecords, before.data?.classes[0].learningEvidenceRecords);
    assert.deepEqual(fixture.repository.reads, [fixture.workspaceId]);
    assert.equal(fixture.repository.writes.length, 1);
    assert.equal(fixture.repository.writes[0].baseRevision, 1);
    assert.equal(fixture.repository.writes[0].context?.actorUserId, fixture.authorized.user.id);
    assert.equal(fixture.repository.writes[0].context?.action, 'class.privacy.archive');
    const reopen = await dispatch(fixture.context('owner', { expectedRevision: 2, confirmation: 'REOPEN CLASS' }, 'class-a', 'reopen'));
    assert.equal(reopen.status, 200);
    const reopened = await reopen.json() as StoredWorkspace;
    assert.equal(reopened.revision, 3);
    assert.deepEqual(reopened.data?.classes[0], before.data?.classes[0]);
    const events = await fixture.repository.listWorkspaceAuditEvents(fixture.workspaceId);
    const sensitive = events.filter((event) => event.action.startsWith('class.privacy.'));
    assert.deepEqual(sensitive.map((event) => event.action).sort(), ['class.privacy.archive', 'class.privacy.reopen']);
    assert.equal(sensitive.every((event) => event.actorUserId === fixture.authorized.user.id), true);
    assert.equal(JSON.stringify(sensitive).includes('Private'), false);
    assert.equal(JSON.stringify(sensitive).includes('private-student-a'), false);
    assert.equal(JSON.stringify(sensitive).includes(fixture.owner.sessionToken), false);
  } finally { await fixture.dispose(); }
});

test('repeated class lifecycle requests do not create extra revisions or sensitive audit events', async () => {
  const fixture = await createFixture();
  try {
    assert.equal((await dispatch(fixture.context())).status, 200);
    const repeated = await dispatch(fixture.context('owner', { expectedRevision: 2, confirmation: 'ARCHIVE CLASS' }));
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json() as StoredWorkspace).revision, 2);
    assert.equal(fixture.repository.writes.length, 1);
    const events = await fixture.repository.listWorkspaceAuditEvents(fixture.workspaceId, { action: 'class.privacy.archive' });
    assert.equal(events.length, 1);
  } finally { await fixture.dispose(); }
});

test('missing classes, stale revisions and last-active class archives reject without a write', async () => {
  const fixture = await createFixture();
  try {
    const missing = await dispatch(fixture.context('owner', { expectedRevision: 1, confirmation: 'ARCHIVE CLASS' }, 'foreign-class'));
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'CLASS_NOT_FOUND' });
    const stale = await dispatch(fixture.context('owner', { expectedRevision: 0, confirmation: 'ARCHIVE CLASS' }));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as { error: string }).error, 'REVISION_CONFLICT');
    assert.equal(fixture.repository.writes.length, 0);
    await dispatch(fixture.context());
    const lastActive = await dispatch(fixture.context('owner', { expectedRevision: 2, confirmation: 'ARCHIVE CLASS' }, 'class-b'));
    assert.equal(lastActive.status, 409);
    assert.deepEqual(await lastActive.json(), { error: 'LAST_ACTIVE_CLASS' });
    assert.equal(fixture.repository.writes.length, 1);
  } finally { await fixture.dispose(); }
});

test('repository CAS still prevents a race between the route revision read and archive write', async () => {
  const fixture = await createFixture();
  try {
    const concurrent = createData();
    concurrent.classes[0].students[0].points = 299;
    fixture.repository.raceData = concurrent;
    const response = await dispatch(fixture.context());
    assert.equal(response.status, 409);
    const body = await response.json() as { error: string; current: StoredWorkspace };
    assert.equal(body.error, 'REVISION_CONFLICT');
    assert.equal(body.current.revision, 2);
    assert.equal(body.current.data?.classes[0].students[0].points, 299);
    assert.equal(body.current.data?.classes[0].archivedAt, undefined);
    const sensitive = await fixture.repository.listWorkspaceAuditEvents(fixture.workspaceId, { action: 'class.privacy.archive' });
    assert.deepEqual(sensitive, []);
  } finally { await fixture.dispose(); }
});

test('the shared API pipeline rejects missing CSRF and cross-tenant archive requests before mutations', async () => {
  const fixture = await createFixture();
  try {
    const foreign = await fixture.authService.register({
      email: 'foreign-archive-owner@example.test', password: 'synthetic foreign archive fixture password',
      displayName: 'Foreign Owner', workspaceName: 'Foreign Workspace', initialWorkspaceData: createData(),
    });
    const foreignWorkspaceId = foreign.session.activeWorkspaceId;
    assert.ok(foreignWorkspaceId);
    const before = await fixture.repository.get(foreignWorkspaceId);
    fixture.repository.writes.length = 0;
    const handler = createApiHandler(fixture.repository, { auth: { passwordIterations: 10 } });
    const csrfToken = 'a'.repeat(43);
    const request = (workspaceId: string, withCsrf: boolean) => new Request('http://localhost/api/v1/classes/class-a/privacy/archive', {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'http://localhost',
        cookie: `__Host-epet_session=${fixture.owner.sessionToken}; __Host-epet_csrf=${csrfToken}`,
        'x-epet-workspace': workspaceId,
        ...(withCsrf ? { 'x-csrf-token': csrfToken } : {}),
      }, body: JSON.stringify({ expectedRevision: 1, confirmation: 'ARCHIVE CLASS' }),
    });
    const csrfDenied = await handler(request(fixture.workspaceId, false));
    assert.equal(csrfDenied.status, 403);
    assert.deepEqual(await csrfDenied.json(), { error: 'CSRF_INVALID' });
    const tenantDenied = await handler(request(foreignWorkspaceId, true));
    assert.equal(tenantDenied.status, 403);
    assert.deepEqual(await tenantDenied.json(), { error: 'FORBIDDEN' });
    assert.deepEqual(fixture.repository.writes, []);
    assert.deepEqual(await fixture.repository.get(foreignWorkspaceId), before);
    assert.equal((await fixture.repository.get(fixture.workspaceId)).revision, 1);
  } finally { await fixture.dispose(); }
});

test('class route handler ignores other methods and unrelated URLs', async () => {
  const fixture = await createFixture();
  try {
    assert.equal(await handleClassRoutes(fixture.context('owner', undefined, 'class-a', 'archive', 'GET')), undefined);
    const unrelated = fixture.context();
    unrelated.url = new URL('http://localhost/api/v1/classes/class-a/privacy/delete');
    assert.equal(await handleClassRoutes(unrelated), undefined);
    assert.deepEqual(fixture.repository.reads, []);
    assert.deepEqual(fixture.repository.writes, []);
  } finally { await fixture.dispose(); }
});

test('teacher API saves an active class after another assigned class is archived and de-identified', async () => {
  const fixture = await createFixture();
  try {
    const invitation = await fixture.authService.createWorkspaceInvitation(fixture.owner.sessionToken,
      fixture.workspaceId, 'archive-teacher@example.test', 'teacher', ['class-a', 'class-b']);
    const teacher = await fixture.authService.acceptWorkspaceInvitation(invitation.token,
      'Archive teacher', 'synthetic archive teacher password');
    const handler = createApiHandler(fixture.repository, { auth: { passwordIterations: 10 } });
    const csrfToken = 'a'.repeat(43);
    const request = (token: string, path: string, method = 'GET', body?: unknown) => handler(new Request(`http://localhost${path}`, {
      method,
      headers: { origin: 'http://localhost', 'content-type': 'application/json',
        cookie: `__Host-epet_session=${token}; __Host-epet_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken, 'x-epet-workspace': fixture.workspaceId },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    // Real registration/state APIs normalize settings before persisting. The
    // low-level AuthService fixture intentionally does not, so initialize via
    // that same production boundary before testing teacher state writes.
    const initialized = await request(fixture.owner.sessionToken, '/api/v1/state', 'PUT',
      { data: createData(), baseRevision: 1 });
    assert.equal(initialized.status, 200);
    const archive = await request(fixture.owner.sessionToken, '/api/v1/classes/class-a/privacy/archive', 'POST',
      { expectedRevision: 2, confirmation: 'ARCHIVE CLASS' });
    assert.equal(archive.status, 200);
    const anonymous = await request(fixture.owner.sessionToken,
      '/api/v1/classes/class-a/students/private-student-a/privacy/anonymize', 'POST',
      { expectedRevision: 3, confirmation: 'ANONYMIZE STUDENT' });
    assert.equal(anonymous.status, 200);
    const before = await fixture.repository.get(fixture.workspaceId);
    const response = await request(teacher.sessionToken, '/api/v1/state');
    assert.equal(response.status, 200);
    const scoped = await response.json() as StoredWorkspace;
    assert.ok(scoped.data);
    const rawDraft = structuredClone(scoped.data);
    rawDraft.classes[1].students[0].points += 1;
    const rawSave = await request(teacher.sessionToken, '/api/v1/state', 'PUT', { data: rawDraft, baseRevision: scoped.revision });
    assert.equal(rawSave.status, 200, 'an existing API client can round-trip the unchanged raw archive');
    const roundTripped = await rawSave.json() as StoredWorkspace;
    assert.ok(roundTripped.data);
    const draft = normalizeAppData(roundTripped.data, Date.now() + 3 * 24 * 60 * 60 * 1_000);
    draft.classes[1].students[0].points += 1;
    const save = await request(teacher.sessionToken, '/api/v1/state', 'PUT', { data: draft, baseRevision: roundTripped.revision });
    assert.equal(save.status, 200, 'normalization of a read-only archive must not block an active-class write');
    const saved = await fixture.repository.get(fixture.workspaceId);
    assert.equal(saved.revision, 6);
    assert.deepEqual(saved.data?.classes[0], before.data?.classes[0]);
    assert.equal(saved.data?.classes[1].students[0].points, 125);
    draft.classes[0].students[0].points += 1;
    const denied = await request(teacher.sessionToken, '/api/v1/state', 'PUT', { data: draft, baseRevision: saved.revision });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'CLASS_ARCHIVE_CHANGED' });
    assert.equal((await fixture.repository.get(fixture.workspaceId)).revision, 6);
  } finally { await fixture.dispose(); }
});
