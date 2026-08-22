import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  AuthService,
  AuthValidationError,
  InvalidCredentialsError,
  InvalidPasswordResetTokenError,
  InvalidSessionError,
} from '../server/auth';
import {
  EmailAlreadyExistsError,
  WorkspaceAlreadyClaimedError,
} from '../server/contracts';
import { JsonWorkspaceRepository } from '../server/repository';
import type { AppData } from '../src/store/types';
import {
  canAdministerWorkspace,
  canExportWorkspace,
  canWriteWorkspace,
  runWorkspaceMutation,
} from '../src/auth/workspaceAccess';

const createState = (name = 'Class A'): AppData => ({
  lastOpened: 1_700_000_000_000,
  currentClassId: 'class-a',
  classes: [{
    id: 'class-a',
    name,
    students: [],
  }],
});

const registerInput = (
  email: string,
  displayName: string,
  workspaceName = 'Teaching Workspace',
) => ({
  email,
  password: 'correct horse battery staple',
  displayName,
  workspaceName,
  initialWorkspaceData: createState(),
});

test('viewer client permissions never invoke a workspace mutation while teacher roles remain writable', () => {
  let mutationCalls = 0;
  let deniedCalls = 0;
  const mutation = () => {
    mutationCalls += 1;
    return 'changed';
  };

  const viewerResult = runWorkspaceMutation(
    canWriteWorkspace('viewer'),
    mutation,
    () => { deniedCalls += 1; },
  );
  assert.equal(viewerResult, undefined);
  assert.equal(mutationCalls, 0);
  assert.equal(deniedCalls, 1);

  for (const role of ['teacher', 'admin', 'owner'] as const) {
    assert.equal(runWorkspaceMutation(canWriteWorkspace(role), mutation), 'changed');
  }
  assert.equal(mutationCalls, 3);
});

test('only owners and admins can request a full workspace export', () => {
  assert.equal(canExportWorkspace('owner'), true);
  assert.equal(canExportWorkspace('admin'), true);
  assert.equal(canExportWorkspace('teacher'), false);
  assert.equal(canExportWorkspace('viewer'), false);
  assert.equal(canExportWorkspace(null), false);
  assert.equal(canExportWorkspace(undefined), false);
});

test('only owners and admins can administer workspace-wide settings', () => {
  assert.equal(canAdministerWorkspace('owner'), true);
  assert.equal(canAdministerWorkspace('admin'), true);
  assert.equal(canAdministerWorkspace('teacher'), false);
  assert.equal(canAdministerWorkspace('viewer'), false);
});

test('auth stores only derived secrets and keeps restorable workspace revisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-auth-test-'));
  const filePath = join(directory, 'auth.json');
  let now = 1_700_000_000_000;
  const repository = new JsonWorkspaceRepository(filePath);
  const auth = new AuthService(repository, {
    now: () => now,
    passwordIterations: 1_000,
  });

  try {
    const registered = await auth.register(
      registerInput('Teacher@Example.com', 'Teacher A'),
    );
    assert.match(registered.sessionToken, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(registered.session.user.email, 'Teacher@Example.com');
    assert.equal(registered.session.user.role, 'owner');
    assert.equal(registered.session.workspaces.length, 1);
    const workspaceId = registered.session.activeWorkspaceId;
    assert.ok(workspaceId);

    const persisted = await readFile(filePath, 'utf8');
    assert.equal(persisted.includes(registered.sessionToken), false);
    assert.equal(persisted.includes('correct horse battery staple'), false);

    const session = await auth.getSession(registered.sessionToken);
    assert.equal(session.activeWorkspaceId, workspaceId);
    await auth.authorizeWorkspace(
      registered.sessionToken,
      workspaceId,
      'owner',
    );

    now += 1_000;
    const secondState = createState('Updated Class');
    await repository.put(workspaceId, secondState, 1, {
      actorUserId: session.user.id,
      action: 'workspace.state_updated',
      requestId: 'request-a',
    });
    const revisions = await repository.listWorkspaceRevisions(workspaceId);
    assert.deepEqual(revisions.map((revision) => revision.revision), [2, 1]);
    assert.equal('data' in revisions[0], false);
    const snapshot = await repository.getWorkspaceRevision(workspaceId, 1);
    assert.equal(snapshot?.data.classes[0].name, 'Class A');

    const secondWorkspaceSession = await auth.createWorkspace(
      registered.sessionToken,
      'Second Workspace',
      createState('Class B'),
    );
    assert.notEqual(secondWorkspaceSession.activeWorkspaceId, workspaceId);
    await auth.authorizeWorkspace(
      registered.sessionToken,
      workspaceId,
      'viewer',
    );
    assert.equal(
      (await auth.getSession(registered.sessionToken)).activeWorkspaceId,
      workspaceId,
    );

    await assert.rejects(
      auth.register(registerInput('teacher@example.com', 'Duplicate')),
      EmailAlreadyExistsError,
    );
    await assert.rejects(
      auth.login({
        email: 'teacher@example.com',
        password: 'x'.repeat(2 * 1024 * 1024),
      }),
      InvalidCredentialsError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('password reset tokens are hashed, expire once, and revoke every session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-reset-test-'));
  const filePath = join(directory, 'auth.json');
  let now = 1_700_000_000_000;
  const repository = new JsonWorkspaceRepository(filePath);
  const auth = new AuthService(repository, {
    now: () => now,
    passwordIterations: 1_000,
    passwordResetTtlMs: 30 * 60 * 1000,
  });

  try {
    const first = await auth.register(
      registerInput('teacher@example.com', 'Teacher'),
    );
    const second = await auth.login({
      email: 'teacher@example.com',
      password: 'correct horse battery staple',
    });
    assert.equal(
      await auth.requestPasswordReset('missing@example.com'),
      null,
    );

    const delivery = await auth.requestPasswordReset('teacher@example.com');
    assert.ok(delivery);
    const persisted = await readFile(filePath, 'utf8');
    assert.equal(persisted.includes(delivery.token), false);

    await assert.rejects(
      auth.resetPassword('malformed-token', 'short'),
      InvalidPasswordResetTokenError,
    );

    now += 1_000;
    await auth.resetPassword(
      delivery.token,
      'a new password with enough length',
    );
    await assert.rejects(
      auth.getSession(first.sessionToken),
      InvalidSessionError,
    );
    await assert.rejects(
      auth.getSession(second.sessionToken),
      InvalidSessionError,
    );
    await assert.rejects(
      auth.resetPassword(
        delivery.token,
        'another password with enough length',
      ),
      InvalidPasswordResetTokenError,
    );
    await assert.rejects(
      auth.login({
        email: 'teacher@example.com',
        password: 'correct horse battery staple',
      }),
      InvalidCredentialsError,
    );
    const loggedIn = await auth.login({
      email: 'teacher@example.com',
      password: 'a new password with enough length',
    });
    assert.equal(loggedIn.session.user.email, 'teacher@example.com');

    const expiring = await auth.requestPasswordReset('teacher@example.com');
    assert.ok(expiring);
    now = expiring.expiresAt;
    await assert.rejects(
      auth.resetPassword(
        expiring.token,
        'a third password with enough length',
      ),
      InvalidPasswordResetTokenError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy workspace claim is atomic and rate limits persist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-claim-test-'));
  const filePath = join(directory, 'auth.json');
  let now = 1_700_000_000_000;
  const repository = new JsonWorkspaceRepository(filePath);
  const auth = new AuthService(repository, {
    now: () => now,
    passwordIterations: 1_000,
  });
  const legacyWorkspaceId = `ws_${'a'.repeat(32)}`;

  try {
    await repository.put(legacyWorkspaceId, createState('Legacy'), 0);
    const first = await auth.register(
      registerInput('first@example.com', 'First'),
    );
    const second = await auth.register(
      registerInput('second@example.com', 'Second'),
    );

    const claims = await Promise.allSettled([
      auth.claimLegacyWorkspace(first.sessionToken, legacyWorkspaceId),
      auth.claimLegacyWorkspace(second.sessionToken, legacyWorkspaceId),
    ]);
    assert.deepEqual(
      claims.map((result) => result.status).sort(),
      ['fulfilled', 'rejected'],
    );
    const rejected = claims.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    );
    assert.ok(rejected?.reason instanceof WorkspaceAlreadyClaimedError);

    await assert.rejects(
      auth.claimLegacyWorkspace(first.sessionToken, 'local-demo'),
      AuthValidationError,
    );

    const policy = {
      windowMs: 60_000,
      maxAttempts: 2,
      blockMs: 120_000,
    };
    assert.deepEqual(
      await auth.consumeRateLimit('login', '198.51.100.10', policy),
      { allowed: true, remaining: 1, retryAfterMs: 0 },
    );
    assert.deepEqual(
      await auth.consumeRateLimit('login', '198.51.100.10', policy),
      { allowed: true, remaining: 0, retryAfterMs: 0 },
    );
    assert.deepEqual(
      await auth.consumeRateLimit('login', '198.51.100.10', policy),
      { allowed: false, remaining: 0, retryAfterMs: 120_000 },
    );

    const reloadedRepository = new JsonWorkspaceRepository(filePath);
    const reloadedAuth = new AuthService(reloadedRepository, {
      now: () => now,
      passwordIterations: 1_000,
    });
    assert.deepEqual(
      await reloadedAuth.consumeRateLimit(
        'login',
        '198.51.100.10',
        policy,
      ),
      { allowed: false, remaining: 0, retryAfterMs: 120_000 },
    );
    now += 181_000;
    assert.deepEqual(
      await reloadedAuth.consumeRateLimit(
        'login',
        '198.51.100.10',
        policy,
      ),
      { allowed: true, remaining: 1, retryAfterMs: 0 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('v2 JSON class access backfills once and explicit v3 empty access fails closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-access-migration-'));
  const filePath = join(directory, 'auth.json');
  const workspaceId = 'legacy-workspace';
  const teacherKey = `${workspaceId}:teacher-a`;
  const viewerKey = `${workspaceId}:viewer-a`;
  const adminKey = `${workspaceId}:admin-a`;
  const legacyData: AppData = {
    lastOpened: 1_700_000_000_000,
    currentClassId: 'class-b',
    classes: [{
      id: 'class-b',
      name: 'Class B',
      students: [],
    }, {
      id: 'class-a',
      name: 'Class A',
      students: [],
    }],
  };
  const membership = (
    userId: string,
    role: 'admin' | 'teacher' | 'viewer',
  ) => ({
    workspaceId,
    userId,
    role,
    createdAt: 1_700_000_000_000,
  });

  try {
    await writeFile(filePath, JSON.stringify({
      version: 2,
      workspaces: {
        [workspaceId]: {
          revision: 1,
          updatedAt: 1_700_000_000_000,
          data: legacyData,
        },
      },
      workspaceMetadata: {},
      workspaceRevisions: {},
      workspaceClaims: {},
      users: {},
      memberships: {
        [teacherKey]: membership('teacher-a', 'teacher'),
        [viewerKey]: membership('viewer-a', 'viewer'),
        [adminKey]: membership('admin-a', 'admin'),
      },
      sessions: {},
      passwordResetTokens: {},
      authRateLimits: {},
      auditEvents: [],
    }, null, 2), 'utf8');

    const repository = new JsonWorkspaceRepository(filePath);
    assert.deepEqual(
      await repository.listWorkspaceClassIds(workspaceId, 'teacher-a'),
      ['class-a', 'class-b'],
    );
    assert.deepEqual(
      await repository.listWorkspaceClassIds(workspaceId, 'viewer-a'),
      ['class-a', 'class-b'],
    );
    assert.deepEqual(
      await repository.listWorkspaceClassIds(workspaceId, 'admin-a'),
      [],
    );

    const migrated = JSON.parse(await readFile(filePath, 'utf8')) as {
      version: number;
      workspaceClassAssignments: Record<string, string[]>;
    };
    assert.equal(migrated.version, 4);
    assert.deepEqual(
      migrated.workspaceClassAssignments[teacherKey],
      ['class-a', 'class-b'],
    );
    assert.deepEqual(
      migrated.workspaceClassAssignments[viewerKey],
      ['class-a', 'class-b'],
    );
    assert.equal(migrated.workspaceClassAssignments[adminKey], undefined);

    await repository.put(workspaceId, {
      ...legacyData,
      classes: legacyData.classes.filter(
        (classroom) => classroom.id === 'class-b',
      ),
    }, 1);
    assert.deepEqual(
      await repository.listWorkspaceClassIds(workspaceId, 'teacher-a'),
      ['class-b'],
    );

    const explicitEmpty = JSON.parse(await readFile(filePath, 'utf8')) as {
      workspaceClassAssignments: Record<string, string[]>;
    };
    explicitEmpty.workspaceClassAssignments[teacherKey] = [];
    await writeFile(filePath, JSON.stringify(explicitEmpty, null, 2), 'utf8');
    const reloaded = new JsonWorkspaceRepository(filePath);
    assert.deepEqual(
      await reloaded.listWorkspaceClassIds(workspaceId, 'teacher-a'),
      [],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
