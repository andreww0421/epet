import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { AuthService, type AuthSessionEnvelope } from '../server/auth';
import { createApiHandler } from '../server/api';
import { createCsrfToken } from '../server/middleware/csrf';
import { JsonWorkspaceRepository } from '../server/repository';
import type { AppData } from '../src/store/types';
import { D1WorkspaceRepository } from '../worker/repository';

// Only synthetic accounts/content; local JSON and local Miniflare D1.
const ORIGIN = 'https://onboarding.example.test';
const PASSWORD = 'synthetic onboarding password';
type Adapter = 'node' | 'd1';
type Client = AuthSessionEnvelope & { csrf: string };
const initialData = (): AppData => ({ lastOpened: Date.now(), currentClassId: 'default',
  classes: [{ id: 'default', name: 'Synthetic default classroom', students: [] }] });
const extraClass = (data: AppData, id: string): AppData => ({ ...structuredClone(data),
  classes: [...data.classes, { id, name: 'Synthetic explicit classroom', students: [] }] });
const mutableDatabaseFacade = (remote: D1Database): D1Database => new Proxy({} as D1Database, {
  get: (local, property) => {
    if (Object.hasOwn(local, property)) return Reflect.get(local, property);
    const value = Reflect.get(remote, property, remote);
    return typeof value === 'function' ? value.bind(remote) : value;
  },
  set: (local, property, value) => Reflect.set(local, property, value),
});

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
        await database.prepare(lines.join('\n')).run(); lines = []; insideTrigger = false;
      }
    }
    assert.equal(lines.length, 0);
  }
};

const fixture = async (adapter: Adapter) => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-product-onboarding-'));
  const filePath = join(directory, 'database.json');
  let miniflare: Miniflare | undefined;
  let database: D1Database | undefined;
  try {
    if (adapter === 'd1') {
      miniflare = new Miniflare({ modules: true, d1Databases: ['DB'],
        script: 'export default { fetch() { return new Response("synthetic onboarding"); } }' });
      database = mutableDatabaseFacade(await miniflare.getD1Database('DB') as unknown as D1Database);
      await applyMigrations(database);
    }
    const repository = database ? new D1WorkspaceRepository(database) : new JsonWorkspaceRepository(filePath);
    const auth = new AuthService(repository, { passwordIterations: 10 });
    let sequence = 0;
    const register = async (): Promise<Client> => {
      sequence += 1;
      return { ...await auth.register({ email: `synthetic-${sequence}@example.test`, password: PASSWORD,
        displayName: 'Synthetic educator', workspaceName: 'Synthetic workspace',
        initialWorkspaceData: initialData() }), csrf: createCsrfToken() };
    };
    const owner = await register();
    const workspaceId = owner.session.activeWorkspaceId!;
    const invite = async (role: 'admin' | 'teacher'): Promise<Client> => {
      sequence += 1;
      const invitation = await auth.createWorkspaceInvitation(owner.sessionToken, workspaceId,
        `synthetic-${sequence}@example.test`, role, role === 'teacher' ? ['default'] : []);
      return { ...await auth.acceptWorkspaceInvitation(invitation.token, 'Synthetic member', PASSWORD),
        csrf: createCsrfToken() };
    };
    const admin = await invite('admin');
    const teacher = await invite('teacher');
    const outsider = await register();
    const cohortStart = Date.now() - 60_000;
    const backgroundTasks: Promise<void>[] = [];
    const api = createApiHandler(repository, { auth: { passwordIterations: 10 },
      productAnalytics: { enabled: true, environment: 'staging', cohortStart },
      deferBackgroundTask: (task) => { backgroundTasks.push(task); } });
    const disabled = createApiHandler(repository, { auth: { passwordIterations: 10 } });
    const request = (path: string, options: {
      who?: Client; method?: string; body?: unknown; headers?: Record<string, string>;
      workspace?: string; csrf?: boolean; disabled?: boolean; origin?: string;
    } = {}) => {
      const who = options.who ?? owner;
      return (options.disabled ? disabled : api)(new Request(`${ORIGIN}${path}`, {
        method: options.method ?? 'GET', headers: {
          origin: options.origin ?? ORIGIN, 'content-type': 'application/json',
          'x-epet-workspace': options.workspace ?? who.session.activeWorkspaceId!,
          cookie: `__Host-epet_session=${who.sessionToken}; __Host-epet_csrf=${who.csrf}`,
          ...(options.csrf === false ? {} : { 'x-csrf-token': who.csrf }), ...options.headers,
        }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }));
    };
    const stage = (stageName: string, who = owner) => request('/api/v1/product-onboarding', {
      method: 'POST', who, body: { stage: stageName },
    });
    const enroll = (who = owner) => repository.enrollProductOnboarding({
      userId: who.session.user.id, cohortStart, now: Date.now(),
    });
    const reload = () => database ? new D1WorkspaceRepository(database) : new JsonWorkspaceRepository(filePath);
    return { adapter, directory, filePath, database, repository, auth, owner, admin, teacher, outsider,
      workspaceId, cohortStart, request, stage, enroll, reload, register,
      drain: async () => { await Promise.all(backgroundTasks); },
      dispose: async () => { await miniflare?.dispose(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    await miniflare?.dispose(); await rm(directory, { recursive: true, force: true }); throw error;
  }
};

for (const adapter of ['node', 'd1'] as const) {
  test(`${adapter}: public registration defaults hydrate before enrollment and completion survives a real login`, async () => {
    const f = await fixture(adapter);
    try {
      const background: Promise<void>[] = [];
      // Registration is enabled only on this isolated synthetic handler.
      const api = createApiHandler(f.repository, { registrationEnabled: true, auth: { passwordIterations: 10 },
        productAnalytics: { enabled: true, environment: 'staging', cohortStart: f.cohortStart },
        deferBackgroundTask: (task) => { background.push(task); } });
      const registered = await api(new Request(`${ORIGIN}/api/v1/auth/register`, { method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'synthetic-public-creator@example.test', password: PASSWORD,
          displayName: 'Synthetic public creator' }) }));
      assert.equal(registered.status, 201);
      const registration = await registered.json() as { csrfToken: string; session: { activeWorkspaceId: string; user: { id: string } } };
      const cookie = registered.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
      const send = (path: string, method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) =>
        api(new Request(`${ORIGIN}${path}`, { method,
          headers: { origin: ORIGIN, 'content-type': 'application/json', cookie,
            'x-csrf-token': registration.csrfToken, 'x-epet-workspace': registration.session.activeWorkspaceId,
            ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      const loaded = await send('/api/v1/state');
      assert.equal(loaded.status, 200);
      const initial = await loaded.json() as { data: AppData; revision: number };
      assert.deepEqual(initial.data.classes.map((classroom) => ({ id: classroom.id, students: classroom.students })),
        [{ id: 'default', students: [] }]);
      assert.equal((await f.repository.listWorkspaceAuditEvents(registration.session.activeWorkspaceId))
        .filter((event) => event.action === 'workspace.state.put').length, 0);
      const enrollment = await send('/api/v1/product-onboarding', 'POST', { stage: 'enroll' });
      assert.equal(enrollment.status, 200);
      assert.equal((await enrollment.json() as { eligible: boolean }).eligible, true);
      await send('/api/v1/product-onboarding', 'POST', { stage: 'started' });
      await send('/api/v1/product-onboarding', 'POST', { stage: 'local_completed' });
      assert.equal((await send('/api/v1/state', 'PUT', {
        data: extraClass(initial.data, 'synthetic-first-explicit-class'), baseRevision: initial.revision,
      }, { 'x-epet-class-create-intent': '1' })).status, 200);
      await Promise.all(background);
      const previous = await f.repository.getProductOnboarding(registration.session.user.id);
      assert.equal(previous?.backendPersisted, true);
      const token = /(?:^|; )__Host-epet_session=([^;]+)/.exec(cookie)?.[1];
      assert.ok(token); await f.auth.logout(token);
      const relogin = { ...await f.auth.login({ email: 'synthetic-public-creator@example.test', password: PASSWORD }),
        csrf: createCsrfToken() };
      const resumed = await f.request('/api/v1/product-onboarding', { who: relogin });
      assert.equal(resumed.status, 200);
      assert.deepEqual((await resumed.json() as { state: unknown }).state, previous);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: minimal new educator cohort resumes across login and repository reload`, async () => {
    const f = await fixture(adapter);
    try {
      const [a, b] = await Promise.all([f.stage('enroll'), f.stage('enroll')]);
      assert.equal(a.status, 200); assert.deepEqual(await a.json(), await b.json());
      assert.equal((await f.stage('local_completed')).status, 200);
      assert.equal((await f.repository.getProductOnboarding(f.owner.session.user.id))?.localReported, false);
      await f.stage('started'); await f.stage('local_completed');
      await f.auth.logout(f.owner.sessionToken);
      const relogin = { ...await f.auth.login({ email: 'synthetic-1@example.test', password: PASSWORD }),
        csrf: createCsrfToken() };
      const response = await f.request('/api/v1/product-onboarding', { who: relogin });
      const result = await response.json() as { eligible: boolean; state: unknown };
      assert.equal(result.eligible, true);
      assert.deepEqual(result.state, await f.reload().getProductOnboarding(f.owner.session.user.id));
      const existing = await f.reload().enrollProductOnboarding({ userId: f.owner.session.user.id,
        cohortStart: f.cohortStart, now: Date.now() + 86_400_000 });
      assert.deepEqual(existing, result.state);
      const day = new Date().toISOString().slice(0, 10);
      const summary = await f.repository.summarizeProductOnboarding({ fromDay: day, toDay: day });
      assert.deepEqual(summary, [{ cohortDay: day, enrolled: 1, started: 1, localReported: 1, backendPersisted: 0 }]);
      for (const value of [f.owner.session.user.id, f.workspaceId, 'synthetic-1@example.test', 'Synthetic educator']) {
        assert.equal(JSON.stringify({ result, summary }).includes(value), false);
      }
    } finally { await f.dispose(); }
  });

  test(`${adapter}: disabled, DNT/GPC, RBAC, CSRF, Origin and tenant gates prevent progress access`, async () => {
    const f = await fixture(adapter);
    try {
      assert.equal((await f.request('/api/v1/product-onboarding', { disabled: true })).status, 404);
      for (const headers of [{ dnt: '1' }, { dnt: 'yes' }, { 'sec-gpc': '1' }]) {
        assert.equal((await f.request('/api/v1/product-onboarding', {
          method: 'POST', body: { stage: 'enroll' }, headers,
        })).status, 204);
      }
      assert.equal(await f.repository.getProductOnboarding(f.owner.session.user.id), null);
      assert.equal((await f.stage('enroll', f.teacher)).status, 403);
      assert.equal((await f.request('/api/v1/product-onboarding', {
        method: 'POST', body: { stage: 'enroll' }, csrf: false,
      })).status, 403);
      assert.equal((await f.request('/api/v1/product-onboarding', {
        who: f.outsider, workspace: f.workspaceId,
      })).status, 403);
      assert.equal((await f.request('/api/v1/product-onboarding', { origin: 'https://untrusted.test' })).status, 403);
      await f.enroll(); await f.stage('started');
      const own = await f.request('/api/v1/product-onboarding', { who: f.admin });
      assert.deepEqual(await own.json(), { eligible: false, state: null });
      assert.equal((await f.stage('invented')).status, 400);
      assert.equal((await f.request('/api/v1/product-onboarding', { method: 'POST',
        body: { stage: 'enroll', userId: f.owner.session.user.id } })).status, 400);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: old, pre-cohort and prior-write/import accounts are excluded without backfill`, async () => {
    const f = await fixture(adapter);
    try {
      const user = (await f.repository.getUserById(f.owner.session.user.id))!;
      for (const input of [{ cohortStart: f.cohortStart, now: user.createdAt + 300_001 },
        { cohortStart: user.createdAt + 1, now: Date.now() + 1 },
        { cohortStart: NaN, now: Date.now() }]) {
        assert.equal(await f.repository.enrollProductOnboarding({ userId: user.id, ...input }), null);
      }
      for (const [who, action] of [[f.owner, 'workspace.state.put'], [f.admin, 'workspace.privacy.import']] as const) {
        await f.repository.appendAuditEvent({ id: crypto.randomUUID(), workspaceId: f.workspaceId,
          actorUserId: who.session.user.id, action, createdAt: Date.now() });
        assert.equal(await f.enroll(who), null);
      }
      assert.deepEqual(await f.repository.summarizeProductOnboarding({
        fromDay: '2026-01-01', toDay: '2026-01-02',
      }), []);
      await assert.rejects(f.repository.summarizeProductOnboarding({ fromDay: '2026-02-30', toDay: '2026-03-01' }));
      await assert.rejects(f.repository.summarizeProductOnboarding({ fromDay: '2026-01-01', toDay: '2026-12-31' }));
    } finally { await f.dispose(); }
  });

  test(`${adapter}: authoritative class proof requires intent, actual new nondefault class and privacy consent`, async () => {
    const f = await fixture(adapter);
    try {
      await f.enroll();
      let current = await f.repository.get(f.workspaceId);
      const put = (data: AppData, headers: Record<string, string> = {}) => f.request('/api/v1/state', {
        method: 'PUT', body: { data, baseRevision: current.revision }, headers,
      });
      assert.equal((await put(current.data!, { 'x-epet-class-create-intent': '1' })).status, 200);
      current = await f.repository.get(f.workspaceId);
      assert.equal((await put(extraClass(current.data!, 'without-intent'))).status, 200);
      current = await f.repository.get(f.workspaceId);
      assert.equal((await put(extraClass(current.data!, 'dnt-blocked'), {
        'x-epet-class-create-intent': '1', dnt: '1',
      })).status, 200);
      assert.equal((await f.repository.getProductOnboarding(f.owner.session.user.id))?.backendPersisted, false);
      current = await f.repository.get(f.workspaceId);
      // A body flag cannot substitute for the trusted intent header.
      assert.equal((await f.request('/api/v1/state', { method: 'PUT', body: {
        data: extraClass(current.data!, 'body-flag'), baseRevision: current.revision,
        productFirstClassCreated: true,
      } })).status, 200);
      current = await f.repository.get(f.workspaceId);
      assert.equal((await put(extraClass(current.data!, 'confirmed-class'), {
        'x-epet-class-create-intent': '1',
      })).status, 200);
      await f.drain();
      const progress = await f.repository.getProductOnboarding(f.owner.session.user.id);
      assert.equal(progress?.started, true); assert.equal(progress?.backendPersisted, true);
      assert.equal(progress?.localReported, false);
      assert.equal(await f.repository.getProductOnboarding(f.admin.session.user.id), null);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: import, restore and unenrolled creators never fabricate onboarding completion`, async () => {
    const f = await fixture(adapter);
    try {
      await f.enroll();
      const current = await f.repository.get(f.workspaceId);
      const headers = { 'x-epet-class-create-intent': '1' };
      const imported = await f.request('/api/v1/workspace/import', { method: 'POST', headers,
        body: { data: extraClass(current.data!, 'imported-only'), expectedRevision: current.revision,
          confirmation: 'IMPORT WORKSPACE', acknowledgeReplacement: true } });
      assert.equal(imported.status, 200);
      assert.equal((await f.request(`/api/v1/revisions/${current.revision}/restore`, {
        method: 'POST', headers,
      })).status, 200);
      await f.drain();
      assert.equal((await f.repository.getProductOnboarding(f.owner.session.user.id))?.backendPersisted, false);
      const other = await f.repository.get(f.outsider.session.activeWorkspaceId!);
      assert.equal((await f.request('/api/v1/state', { method: 'PUT', headers, who: f.outsider,
        body: { data: extraClass(other.data!, 'unenrolled-class'), baseRevision: other.revision },
      })).status, 200);
      await f.drain();
      assert.equal(await f.repository.getProductOnboarding(f.outsider.session.user.id), null);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: conflicting concurrent writes observe only the CAS winner and keep business audit atomic`, async () => {
    const f = await fixture(adapter);
    try {
      await f.enroll(); await f.enroll(f.admin);
      const current = await f.repository.get(f.workspaceId);
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      if (f.database) {
        // Both repositories have already read the old revision when their
        // actual write batches reach this gate: force a real D1 CAS loss.
        const batch = f.database.batch.bind(f.database);
        f.database.batch = async (statements) => {
          arrived += 1; if (arrived === 2) release();
          await gate; return batch(statements);
        };
      } else {
        const put = f.repository.put.bind(f.repository);
        f.repository.put = async (...args) => {
          arrived += 1; if (arrived === 2) release();
          await gate; return put(...args);
        };
      }
      const results = await Promise.all([f.owner, f.admin].map((who, index) =>
        f.request('/api/v1/state', { method: 'PUT', who, workspace: f.workspaceId,
          body: { data: extraClass(current.data!, `race-${index}`), baseRevision: current.revision },
          headers: { 'x-epet-class-create-intent': '1' } })));
      assert.equal(results.filter((result) => result.status === 200).length, 1);
      assert.equal(results.filter((result) => result.status === 409).length, 1);
      await f.drain();
      const flags = await Promise.all([f.owner, f.admin].map((who) => f.reload().getProductOnboarding(who.session.user.id)));
      assert.equal(flags.filter((state) => state?.backendPersisted).length, 1);
      const saved = await f.repository.get(f.workspaceId);
      const before = await f.repository.getProductOnboarding(f.owner.session.user.id);
      assert.equal((await f.request('/api/v1/state', { method: 'PUT',
        body: { data: extraClass(saved.data!, 'stale'), baseRevision: current.revision },
        headers: { 'x-epet-class-create-intent': '1' } })).status, 409);
      await f.drain();
      assert.deepEqual(await f.repository.getProductOnboarding(f.owner.session.user.id), before);
      assert.equal((await f.repository.listWorkspaceAuditEvents(f.workspaceId))
        .filter((event) => event.action === 'workspace.state.put').length, 1);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: persistence failure leaves workspace and onboarding uncommitted`, async () => {
    const f = await fixture(adapter);
    try {
      await f.enroll();
      const before = await f.repository.get(f.workspaceId);
      if (f.database) {
        await f.database.prepare(`CREATE TRIGGER synthetic_onboarding_abort BEFORE INSERT ON classes
          WHEN NEW.class_id = 'rollback-proof' BEGIN SELECT RAISE(ABORT, 'synthetic projection failure'); END`).run();
      } else {
        await rename(f.filePath, `${f.filePath}.safe`);
        await mkdir(`${f.filePath}.tmp`);
      }
      assert.equal((await f.request('/api/v1/state', { method: 'PUT',
        body: { data: extraClass(before.data!, 'rollback-proof'), baseRevision: before.revision },
        headers: { 'x-epet-class-create-intent': '1' } })).status, 500);
      await f.drain();
      if (!f.database) {
        await rm(`${f.filePath}.tmp`, { recursive: true });
        await rename(`${f.filePath}.safe`, f.filePath);
      }
      assert.deepEqual(await f.repository.get(f.workspaceId), before);
      assert.equal((await f.repository.getProductOnboarding(f.owner.session.user.id))?.backendPersisted, false);
      assert.equal((await f.repository.listWorkspaceAuditEvents(f.workspaceId))
        .filter((event) => event.action === 'workspace.state.put').length, 0);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: account deletion purges only that account onboarding record`, async () => {
    const f = await fixture(adapter);
    try {
      await f.enroll(); await f.enroll(f.admin);
      await f.repository.deleteUser({ userId: f.admin.session.user.id, deletedAt: Date.now(),
        auditEvent: { id: crypto.randomUUID(), action: 'auth.account.delete', createdAt: Date.now() } });
      assert.equal(await f.reload().getProductOnboarding(f.admin.session.user.id), null);
      assert.notEqual(await f.repository.getProductOnboarding(f.owner.session.user.id), null);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: failed or hanging optional observer cannot block a committed class creation`, async () => {
    const f = await fixture(adapter);
    try {
      await f.enroll();
      const before = await f.repository.get(f.workspaceId);
      f.repository.confirmProductOnboarding = async () => { throw new Error('synthetic analytics failure'); };
      const response = await f.request('/api/v1/state', { method: 'PUT',
        body: { data: extraClass(before.data!, 'observer-fails'), baseRevision: before.revision },
        headers: { 'x-epet-class-create-intent': '1' } });
      assert.equal(response.status, 200);
      await f.drain();
      assert.equal((await f.repository.get(f.workspaceId)).revision, before.revision + 1);
      assert.equal((await f.repository.getProductOnboarding(f.owner.session.user.id))?.backendPersisted, false);
      f.repository.confirmProductOnboarding = () => new Promise(() => undefined);
      const saved = await f.repository.get(f.workspaceId);
      const second = await Promise.race([
        f.request('/api/v1/state', { method: 'PUT',
          body: { data: extraClass(saved.data!, 'observer-hangs'), baseRevision: saved.revision },
          headers: { 'x-epet-class-create-intent': '1' } }),
        new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('observer blocked business response')), 2_000).unref(); }),
      ]);
      assert.equal(second.status, 200);
      assert.equal((await f.repository.get(f.workspaceId)).revision, before.revision + 2);
    } finally { await f.dispose(); }
  });
}
