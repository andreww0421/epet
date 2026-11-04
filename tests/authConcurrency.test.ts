import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { AuthService, hashOpaqueToken } from '../server/auth';
import { createApiHandler } from '../server/api';
import type { AuthSessionRecord, AuthUserRecord, AuditEventRecord, PasswordCredential } from '../server/contracts';
import { JsonWorkspaceRepository } from '../server/repository';
import type { AccountLifecycleDelivery } from '../shared/contracts/authDelivery';
import type { AppData } from '../src/store/types';
import { D1WorkspaceRepository } from '../worker/repository';

// Every account, token, class and database in this file is a disposable synthetic fixture.
const ORIGIN = 'https://auth-concurrency.example.test';
const NOW = 1_800_000_000_000;
const PASSWORD = 'synthetic original password for concurrency';
const NEW_PASSWORD = 'synthetic replacement password for concurrency';
const EMAIL = 'synthetic-invitee-auth-concurrency@example.test';
const CLASS_A = 'synthetic-auth-class-a';
const CLASS_B = 'synthetic-auth-class-b';
type Adapter = 'node' | 'd1';
type Repository = JsonWorkspaceRepository | D1WorkspaceRepository;
type Handler = ReturnType<typeof createApiHandler>;
const initialData = (): AppData => ({ lastOpened: NOW, currentClassId: CLASS_A,
  classes: [CLASS_A, CLASS_B].map((id) => ({ id, name: id, students: [] })) });

const applyMigrations = async (database: D1Database) => {
  for (const file of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
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

const request = (handler: Handler, path: string, body?: unknown, token?: string, workspaceId?: string,
  extraHeaders: Record<string, string> = {}) =>
  handler(new Request(`${ORIGIN}/api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: ORIGIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { cookie: `__Host-epet_session=${token}` } : {}),
      ...(workspaceId ? { 'x-epet-workspace': workspaceId } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));

const responseToken = (response: Response) => {
  const token = response.headers.get('set-cookie')?.match(/__Host-epet_session=([^;,\s]+)/)?.[1];
  assert.ok(token, 'successful authentication must return a session cookie');
  return token;
};

const assertInvalidCredentials = async (response: Response) => {
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'INVALID_CREDENTIALS' });
  assert.equal(/__Host-epet_session=[^;,\s]+/.test(response.headers.get('set-cookie') ?? ''), false);
};

// Pause exactly at the repository security boundary, after the service has
// loaded and verified its credential snapshot. All other operations stay real.
const intercept = (repository: Repository, method: 'createAuthSession' | 'acceptWorkspaceInvitation',
  hook: (invoke: () => Promise<unknown>, args: unknown[]) => Promise<unknown>): Repository =>
  new Proxy(repository, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === method) return (...args: unknown[]) =>
        hook(() => Reflect.apply(value, target, args), args);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

const createFixture = async (adapter: Adapter) => {
  let database: D1Database | undefined;
  let filePath: string | undefined;
  let dispose: (() => Promise<void>) | undefined;
  let repository: Repository;
  try {
    if (adapter === 'd1') {
      const miniflare = new Miniflare({ modules: true, d1Databases: ['DB'],
        script: 'export default { fetch() { return new Response("synthetic auth fixture"); } }' });
      dispose = () => miniflare.dispose();
      database = await miniflare.getD1Database('DB') as unknown as D1Database;
      await applyMigrations(database);
      repository = new D1WorkspaceRepository(database);
    } else {
      const directory = await mkdtemp(join(tmpdir(), 'epet-auth-concurrency-'));
      filePath = join(directory, 'synthetic.json');
      dispose = () => rm(directory, { recursive: true, force: true });
      repository = new JsonWorkspaceRepository(filePath);
    }
    const options = { passwordIterations: 10, now: () => NOW };
    const auth = new AuthService(repository, options);
    const owner = await auth.register({ email: 'synthetic-owner-auth-concurrency@example.test',
      password: PASSWORD, displayName: 'Synthetic Owner', workspaceName: 'Synthetic Target Workspace',
      initialWorkspaceData: initialData() });
    // Exercise the legitimate verification of an existing account during reset/acceptance.
    const invitee = await new AuthService(repository, { ...options, emailVerificationRequired: true })
      .register({ email: EMAIL, password: PASSWORD, displayName: 'Synthetic Existing Invitee',
        workspaceName: 'Synthetic Original Workspace', initialWorkspaceData: initialData() });
    const workspaceId = owner.session.activeWorkspaceId!;
    const userId = invitee.session.user.id;
    const deliveries: AccountLifecycleDelivery[] = [];
    const backgroundTasks: Promise<void>[] = [];
    const api = (repo: Repository = repository) => createApiHandler(repo, {
      auth: options, allowedOrigins: [ORIGIN],
      accountLifecycleMailer: async (delivery) => { deliveries.push(delivery); },
      deferBackgroundTask: (task) => { backgroundTasks.push(task); },
    });
    const handler = api();
    const reload = () => database ? new D1WorkspaceRepository(database) : new JsonWorkspaceRepository(filePath!);
    const sessions = async () => {
      if (database) {
        const result = await database.prepare(
          'SELECT token_hash AS tokenHash, revoked_at AS revokedAt FROM auth_sessions WHERE user_id = ? ORDER BY token_hash',
        ).bind(userId).all<{ tokenHash: string; revokedAt: number | null }>();
        return result.results;
      }
      const raw = JSON.parse(await readFile(filePath!, 'utf8'));
      return (Object.values(raw.sessions) as AuthSessionRecord[]).filter((session) => session.userId === userId)
        .map(({ tokenHash, revokedAt }) => ({ tokenHash, revokedAt }))
        .sort((left, right) => left.tokenHash.localeCompare(right.tokenHash));
    };
    const audit = async () => {
      if (database) {
        const result = await database.prepare(
          'SELECT event_id AS id, action FROM audit_events WHERE actor_user_id = ? ORDER BY event_id',
        ).bind(userId).all<{ id: string; action: string }>();
        return result.results;
      }
      const raw = JSON.parse(await readFile(filePath!, 'utf8'));
      return (raw.auditEvents as AuditEventRecord[]).filter((event) => event.actorUserId === userId)
        .map(({ id, action }) => ({ id, action })).sort((left, right) => left.id.localeCompare(right.id));
    };
    const rawAssignments = async () => {
      if (database) {
        const result = await database.prepare(
          'SELECT class_id FROM workspace_class_assignments WHERE workspace_id = ? AND user_id = ? ORDER BY class_id',
        ).bind(workspaceId, userId).all<{ class_id: string }>();
        return result.results.map((row) => row.class_id);
      }
      const raw = JSON.parse(await readFile(filePath!, 'utf8'));
      return (raw.workspaceClassAssignments[`${workspaceId}:${userId}`] ?? []).sort() as string[];
    };
    const reset = async (token: string, password = NEW_PASSWORD) => {
      const response = await request(handler, 'auth/password/reset', { token, password });
      assert.equal(response.status, 200, 'the interleaved reset must commit successfully');
      assert.deepEqual(await response.json(), { ok: true });
    };
    return { adapter, database, filePath, repository, auth, owner, invitee, workspaceId, userId,
      api, handler, reload, sessions, audit, rawAssignments, reset, deliveries, backgroundTasks, dispose };
  } catch (error) { await dispose?.(); throw error; }
};

type Fixture = Awaited<ReturnType<typeof createFixture>>;

const assertRevokedAfterReload = async (f: Fixture, token: string) => {
  const repository = f.reload();
  const stored = await repository.getAuthSessionByTokenHash(await hashOpaqueToken(token));
  assert.ok(stored);
  assert.equal(stored.revokedAt, NOW);
  const response = await request(f.api(repository), 'auth/session', undefined, token);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'INVALID_SESSION' });
};

const assertTeacherScope = async (f: Fixture, token: string) => {
  const repository = f.reload();
  assert.equal((await repository.getWorkspaceMembership(f.workspaceId, f.userId))?.role, 'teacher');
  assert.deepEqual(await repository.listWorkspaceClassIds(f.workspaceId, f.userId), [CLASS_A]);
  const response = await request(f.api(repository), 'state', undefined, token, f.workspaceId);
  assert.equal(response.status, 200);
  const state = await response.json() as { data: AppData };
  assert.deepEqual(state.data.classes.map((classroom) => classroom.id), [CLASS_A]);
};

for (const adapter of ['node', 'd1'] as const) {
  for (const resetPassword of [NEW_PASSWORD, PASSWORD]) {
    test(`${adapter}: reset before login session insert rejects the stale snapshot${resetPassword === PASSWORD ? ' even with the same password and timestamp' : ''}`, async () => {
      const f = await createFixture(adapter);
      try {
        const previousUser = await f.repository.getUserById(f.userId);
        assert.ok(previousUser);
        const beforeSessions = await f.sessions();
        const beforeAudit = await f.audit();
        const delivery = await f.auth.requestPasswordReset(EMAIL);
        assert.ok(delivery);
        let calls = 0;
        const staleRepository = intercept(f.repository, 'createAuthSession', async (invoke) => {
          calls += 1;
          assert.equal(calls, 1);
          await f.reset(delivery.token, resetPassword);
          return invoke();
        });
        await assertInvalidCredentials(await request(f.api(staleRepository), 'auth/login',
          { email: EMAIL, password: PASSWORD }));
        assert.equal(calls, 1, 'the login must reach session persistence after password verification');
        const afterSessions = await f.sessions();
        assert.deepEqual(afterSessions.map((session) => session.tokenHash), beforeSessions.map((session) => session.tokenHash));
        assert.ok(afterSessions.every((session) => session.revokedAt === NOW));
        const addedAudit = (await f.audit()).filter((event) => !beforeAudit.some((before) => before.id === event.id));
        assert.deepEqual(addedAudit.map((event) => event.action), ['auth.password_reset']);
        assert.equal(f.deliveries.some((delivery) => delivery.kind === 'workspace_joined'), false);
        const currentUser = await f.reload().getUserById(f.userId);
        assert.ok(currentUser);
        assert.equal(currentUser.passwordChangedAt, previousUser.passwordChangedAt);
        assert.notEqual(currentUser.password.salt, previousUser.password.salt);
        assert.notEqual(currentUser.password.hash, previousUser.password.hash);
        await assertRevokedAfterReload(f, f.invitee.sessionToken);
        if (resetPassword !== PASSWORD) {
          await assertInvalidCredentials(await request(f.handler, 'auth/login', { email: EMAIL, password: PASSWORD }));
        }
        const fresh = await request(f.handler, 'auth/login', { email: EMAIL, password: resetPassword });
        assert.equal(fresh.status, 200);
        const session = await request(f.api(f.reload()), 'auth/session', undefined, responseToken(fresh));
        assert.equal(session.status, 200, 'a newly verified credential must still create a usable persisted session');
      } finally { await f.dispose(); }
    });
  }

  test(`${adapter}: session insert before reset is persistently revoked by that reset`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.sessions();
      const delivery = await f.auth.requestPasswordReset(EMAIL);
      assert.ok(delivery);
      let calls = 0;
      const repository = intercept(f.repository, 'createAuthSession', async (invoke) => {
        calls += 1;
        const inserted = await invoke();
        await f.reset(delivery.token);
        return inserted;
      });
      const response = await request(f.api(repository), 'auth/login', { email: EMAIL, password: PASSWORD });
      assert.equal(response.status, 200);
      assert.equal(calls, 1);
      const after = await f.sessions();
      assert.equal(after.length, before.length + 1);
      assert.ok(after.every((session) => session.revokedAt === NOW));
      await assertRevokedAfterReload(f, responseToken(response));
      await assertRevokedAfterReload(f, f.invitee.sessionToken);
      const fresh = await request(f.handler, 'auth/login', { email: EMAIL, password: NEW_PASSWORD });
      assert.equal(fresh.status, 200);
      assert.equal((await request(f.api(f.reload()), 'auth/session', undefined, responseToken(fresh))).status, 200);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: existing-user invitation reset race leaves no membership, assignments, consumption, audit or session`, async () => {
    const f = await createFixture(adapter);
    try {
      const invitation = await f.auth.createWorkspaceInvitation(f.owner.sessionToken, f.workspaceId,
        EMAIL, 'teacher', [CLASS_A]);
      const tokenHash = await hashOpaqueToken(invitation.token);
      const beforeInvitation = await f.repository.getWorkspaceInvitationByTokenHash(tokenHash);
      const beforeSessions = await f.sessions();
      const beforeAudit = await f.audit();
      const beforeWorkspace = await f.repository.get(f.workspaceId);
      const delivery = await f.auth.requestPasswordReset(EMAIL);
      assert.ok(delivery);
      let calls = 0;
      let resetUser: AuthUserRecord | null = null;
      const staleRepository = intercept(f.repository, 'acceptWorkspaceInvitation', async (invoke) => {
        calls += 1;
        await f.reset(delivery.token);
        resetUser = await f.repository.getUserById(f.userId);
        return invoke();
      });
      const rejected = await request(f.api(staleRepository), 'auth/invitations/accept',
        { token: invitation.token, displayName: 'Synthetic Invitee', password: PASSWORD });
      assert.equal(rejected.status, 400);
      assert.deepEqual(await rejected.json(), { error: 'INVALID_WORKSPACE_INVITATION' });
      assert.equal(calls, 1, 'existing-user verification must complete before the gated acceptance');
      assert.equal(/__Host-epet_session=[^;,\s]+/.test(rejected.headers.get('set-cookie') ?? ''), false);
      const reloaded = f.reload();
      assert.equal(await reloaded.getWorkspaceMembership(f.workspaceId, f.userId), null);
      assert.deepEqual(await f.rawAssignments(), []);
      assert.deepEqual(await reloaded.getWorkspaceInvitationByTokenHash(tokenHash), beforeInvitation);
      assert.deepEqual(await reloaded.get(f.workspaceId), beforeWorkspace);
      assert.deepEqual(await reloaded.getUserById(f.userId), resetUser,
        'failed acceptance must not change the account beyond the legitimate reset');
      assert.deepEqual((await f.sessions()).map((session) => session.tokenHash), beforeSessions.map((session) => session.tokenHash));
      const addedAudit = (await f.audit()).filter((event) => !beforeAudit.some((before) => before.id === event.id));
      assert.deepEqual(addedAudit.map((event) => event.action), ['auth.password_reset']);
      assert.equal(f.deliveries.some((delivery) => delivery.kind === 'workspace_joined'), false);
      await assertRevokedAfterReload(f, f.invitee.sessionToken);
      const accepted = await request(f.handler, 'auth/invitations/accept',
        { token: invitation.token, displayName: 'Synthetic Invitee', password: NEW_PASSWORD });
      assert.equal(accepted.status, 201, 'the unused invitation must allow a legitimate retry with the new credential');
      await assertTeacherScope(f, responseToken(accepted));
      const committed = await f.reload().getWorkspaceInvitationByTokenHash(tokenHash);
      assert.equal(committed?.acceptedAt, NOW);
      assert.equal(committed?.acceptedByUserId, f.userId);
      assert.equal((await f.audit()).filter((event) => event.action === 'workspace.invitation.accept').length, 1);
      assert.equal(f.deliveries.filter((delivery) => delivery.kind === 'workspace_joined').length, 1);
      const loggedIn = await request(f.handler, 'auth/login', { email: EMAIL, password: NEW_PASSWORD });
      assert.equal(loggedIn.status, 200);
      await assertTeacherScope(f, responseToken(loggedIn));
    } finally { await f.dispose(); }
  });

  test(`${adapter}: session persistence compares every credential field and rejects inactive or missing users`, async () => {
    const f = await createFixture(adapter);
    try {
      const user = await f.repository.getUserById(f.userId);
      assert.ok(user);
      const before = await f.sessions();
      const makeSession = (): AuthSessionRecord => ({ tokenHash: crypto.randomUUID(), userId: f.userId,
        activeWorkspaceId: f.invitee.session.activeWorkspaceId, createdAt: NOW,
        expiresAt: NOW + 60_000, lastSeenAt: NOW, revokedAt: null });
      const mismatches: PasswordCredential[] = [
        { ...user.password, algorithm: 'synthetic-unsupported-algorithm' as PasswordCredential['algorithm'] },
        { ...user.password, salt: `${user.password.salt}-stale` },
        { ...user.password, hash: `${user.password.hash}-stale` },
        { ...user.password, iterations: user.password.iterations + 1 },
      ];
      for (const expected of mismatches) {
        const session = makeSession();
        assert.equal(await f.repository.createAuthSession(session, expected), false);
        assert.equal(await f.reload().getAuthSessionByTokenHash(session.tokenHash), null);
      }
      const missing = { ...makeSession(), userId: 'synthetic-missing-user', activeWorkspaceId: null };
      assert.equal(await f.repository.createAuthSession(missing, user.password), false);
      assert.deepEqual(await f.sessions(), before);
      if (f.database) {
        await f.database.prepare("UPDATE users SET status = 'disabled' WHERE user_id = ?").bind(f.userId).run();
      } else {
        const raw = JSON.parse(await readFile(f.filePath!, 'utf8'));
        raw.users[f.userId].status = 'disabled';
        await writeFile(f.filePath!, JSON.stringify(raw), 'utf8');
      }
      const inactive = makeSession();
      assert.equal(await f.reload().createAuthSession(inactive, user.password), false);
      assert.equal(await f.reload().getAuthSessionByTokenHash(inactive.tokenHash), null);
      assert.deepEqual(await f.sessions(), before);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: concurrent login limits share normalized subjects across clients and survive repository recreation`, async () => {
    const f = await createFixture(adapter);
    try {
      const beforeSessions = await f.sessions();
      const beforeAudit = await f.audit();
      const clients = Array.from({ length: 11 }, (_, index) => `synthetic-platform-client-${index}`);
      const responses = await Promise.all(clients.map((identity, index) => request(f.handler,
        'auth/login', { email: index % 2 ? `  ${EMAIL.toUpperCase()}  ` : EMAIL,
          password: 'synthetic incorrect password' }, undefined, undefined,
        { 'cf-connecting-ip': identity })));
      assert.deepEqual(responses.map((response) => response.status).sort(),
        [...Array(10).fill(401), 429]);
      for (const response of responses) {
        assert.deepEqual(await response.json(), { error: response.status === 429 ? 'RATE_LIMITED' : 'INVALID_CREDENTIALS' });
        if (response.status === 429) assert.ok(Number(response.headers.get('retry-after')) > 0);
        assert.equal(/__Host-epet_session=[^;,\s]+/.test(response.headers.get('set-cookie') ?? ''), false);
      }
      // A new handler and repository cannot bypass the persisted subject block,
      // including when the next attempt uses the correct credential and a new client.
      const blocked = await request(f.api(f.reload()), 'auth/login',
        { email: ` ${EMAIL.toUpperCase()} `, password: PASSWORD }, undefined, undefined,
        { 'cf-connecting-ip': 'synthetic-platform-client-recreated' });
      assert.equal(blocked.status, 429);
      assert.deepEqual(await blocked.json(), { error: 'RATE_LIMITED' });
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      assert.deepEqual(await f.sessions(), beforeSessions);
      assert.deepEqual(await f.audit(), beforeAudit);
      const persistedLimits = f.database
        ? JSON.stringify((await f.database.prepare('SELECT * FROM auth_rate_limits').all()).results)
        : JSON.stringify(JSON.parse(await readFile(f.filePath!, 'utf8')).authRateLimits);
      assert.equal(persistedLimits.toLowerCase().includes(EMAIL), false);
      assert.equal(persistedLimits.includes('synthetic-platform-client'), false);
    } finally { await f.dispose(); }
  });
}

test('d1: simultaneous existing-user invitation accepts at the same millisecond have exactly one winner', async () => {
  const f = await createFixture('d1');
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  const timeout = setTimeout(release, 10_000);
  try {
    const invitation = await f.auth.createWorkspaceInvitation(f.owner.sessionToken, f.workspaceId,
      EMAIL, 'teacher', [CLASS_A]);
    const beforeSessions = await f.sessions();
    let arrivals = 0;
    const handlers = [f.repository, f.reload()].map((repository) => f.api(intercept(repository,
      'acceptWorkspaceInvitation', async (invoke) => {
        arrivals += 1;
        if (arrivals === 2) release();
        await ready;
        return invoke();
      })));
    const responses = await Promise.all(handlers.map((handler) => request(handler, 'auth/invitations/accept',
      { token: invitation.token, displayName: 'Synthetic Invitee', password: PASSWORD })));
    assert.equal(arrivals, 2, 'both separately instantiated repositories must reach acceptance with verified snapshots');
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 400]);
    const winner = responses.find((response) => response.status === 201)!;
    const loser = responses.find((response) => response.status === 400)!;
    assert.deepEqual(await loser.json(), { error: 'INVALID_WORKSPACE_INVITATION' });
    assert.equal(/__Host-epet_session=[^;,\s]+/.test(loser.headers.get('set-cookie') ?? ''), false);
    assert.equal((await f.sessions()).length, beforeSessions.length + 1);
    assert.equal((await f.audit()).filter((event) => event.action === 'workspace.invitation.accept').length, 1);
    assert.equal(f.deliveries.filter((delivery) => delivery.kind === 'workspace_joined').length, 1);
    assert.deepEqual(await f.rawAssignments(), [CLASS_A]);
    await assertTeacherScope(f, responseToken(winner));
    const beforeReplayAudit = await f.audit();
    const replay = await request(f.api(f.reload()), 'auth/invitations/accept',
      { token: invitation.token, displayName: 'Synthetic Invitee', password: PASSWORD });
    assert.equal(replay.status, 400);
    assert.equal((await f.sessions()).length, beforeSessions.length + 1);
    assert.deepEqual(await f.audit(), beforeReplayAudit);
  } finally { clearTimeout(timeout); await f.dispose(); }
});
