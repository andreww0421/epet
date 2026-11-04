import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { AuthService, type AuthSessionEnvelope } from '../server/auth';
import { createApiHandler } from '../server/api';
import type { TransferWorkspaceOwnershipInput } from '../server/contracts';
import { createCsrfToken } from '../server/middleware/csrf';
import { errorResponse } from '../server/middleware/errorResponse';
import { JsonWorkspaceRepository } from '../server/repository';
import type { AccountLifecycleDelivery } from '../shared/contracts/authDelivery';
import type { AppData } from '../src/store/types';
import { D1WorkspaceRepository } from '../worker/repository';

// All accounts, classes and audit events in this file are synthetic.
const ORIGIN = 'https://ownership.example.test';
const PASSWORD = 'synthetic ownership fixture password';
const CLASS_ID = 'synthetic-class-a';
type Adapter = 'node' | 'd1';
type Repository = JsonWorkspaceRepository | D1WorkspaceRepository;
type Client = AuthSessionEnvelope & { csrf: string };
const client = (session: AuthSessionEnvelope): Client => ({ ...session, csrf: createCsrfToken() });
const initialData = (): AppData => ({ lastOpened: 1_800_000_000_000,
  currentClassId: CLASS_ID, classes: [{ id: CLASS_ID, name: 'Synthetic Class A', students: [] }] });

const mutableDatabaseFacade = (remote: D1Database): D1Database => new Proxy({} as D1Database, {
  get: (local, property) => {
    if (Object.hasOwn(local, property)) return Reflect.get(local, property);
    const value = Reflect.get(remote, property, remote);
    return typeof value === 'function' ? value.bind(remote) : value;
  },
  // Miniflare's RPC proxy does not retain ordinary method assignments. Store
  // instrumentation on a local target while forwarding real database methods.
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
        await database.prepare(lines.join('\n')).run();
        lines = [];
        insideTrigger = false;
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
        script: 'export default { fetch() { return new Response("synthetic ownership fixture"); } }' });
      database = mutableDatabaseFacade(await miniflare.getD1Database('DB') as unknown as D1Database);
      dispose = () => miniflare.dispose();
      await applyMigrations(database);
      repository = new D1WorkspaceRepository(database);
    } else {
      const directory = await mkdtemp(join(tmpdir(), 'epet-M03-'));
      filePath = join(directory, 'data.json');
      dispose = () => rm(directory, { recursive: true, force: true });
      repository = new JsonWorkspaceRepository(filePath);
    }
    const auth = new AuthService(repository, { passwordIterations: 10 });
    const owner = client(await auth.register({ email: 'owner-a-m03@example.test', password: PASSWORD,
      displayName: 'Synthetic Owner A', workspaceName: 'Synthetic Ownership Workspace',
      initialWorkspaceData: initialData() }));
    const workspaceId = owner.session.activeWorkspaceId!;
    const invite = async (label: string, role: 'admin' | 'teacher') => {
      const delivery = await auth.createWorkspaceInvitation(owner.sessionToken, workspaceId,
        `${label}-m03@example.test`, role, role === 'teacher' ? [CLASS_ID] : []);
      return client(await auth.acceptWorkspaceInvitation(delivery.token, `Synthetic ${label}`, PASSWORD));
    };
    const memberB = await invite('admin-b', 'admin');
    const memberC = await invite('admin-c', 'admin');
    const teacher = await invite('teacher-observer', 'teacher');
    const outsider = client(await auth.register({ email: 'other-owner-m03@example.test', password: PASSWORD,
      displayName: 'Synthetic Other Owner', workspaceName: 'Synthetic Other Workspace',
      initialWorkspaceData: initialData() }));
    const otherWorkspaceId = outsider.session.activeWorkspaceId!;
    // Separate D1 repository objects prove that a process-local lock is insufficient.
    // The Node HTTP server intentionally owns a single JSON repository instance.
    const repositories = database ? [repository, new D1WorkspaceRepository(database)] : [repository];
    const deliveries: AccountLifecycleDelivery[] = [];
    const backgroundTasks: Promise<void>[] = [];
    const handlers = repositories.map((repo) => createApiHandler(repo, {
      auth: { passwordIterations: 10 },
      accountLifecycleMailer: async (delivery) => { deliveries.push(delivery); },
      deferBackgroundTask: (task) => { backgroundTasks.push(task); },
    }));
    const request = (targetUserId: string, options: {
      who?: Client; workspace?: string; handler?: number; csrf?: boolean;
    } = {}) => {
      const who = options.who ?? owner;
      return handlers[options.handler ?? 0](new Request(
        `${ORIGIN}/api/v1/members/${encodeURIComponent(targetUserId)}/transfer-ownership`, {
          method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json',
            'x-epet-workspace': options.workspace ?? workspaceId,
            cookie: `__Host-epet_session=${who.sessionToken}; __Host-epet_csrf=${who.csrf}`,
            ...(options.csrf === false ? {} : { 'x-csrf-token': who.csrf }) },
        }));
    };
    const reload = () => database ? new D1WorkspaceRepository(database) : new JsonWorkspaceRepository(filePath!);
    return { adapter, database, filePath, repository, repositories, auth, owner, memberB, memberC,
      teacher, outsider, workspaceId, otherWorkspaceId, request, reload, deliveries, backgroundTasks, dispose };
  } catch (error) { await dispose?.(); throw error; }
};
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const transferInput = (f: Fixture, toUserId: string, fromUserId = f.owner.session.user.id): TransferWorkspaceOwnershipInput => ({
  workspaceId: f.workspaceId, fromUserId, toUserId, transferredAt: Date.now(),
  auditEvent: { id: crypto.randomUUID(), workspaceId: f.workspaceId, actorUserId: fromUserId,
    action: 'workspace.owner.transfer', targetType: 'user', targetId: toUserId, createdAt: Date.now() },
});

const ownershipSnapshot = async (f: Fixture, workspaceId = f.workspaceId, repository = f.repository) => {
  const members = (await repository.listWorkspaceMembers(workspaceId))
    .sort((left, right) => left.userId.localeCompare(right.userId));
  const audit = await repository.listWorkspaceAuditEvents(workspaceId);
  let claim: { userId: string; claimedAt: number } | null;
  let assignments: { userId: string; classId: string }[];
  if (f.database) {
    const row = await f.database.prepare(
      'SELECT claimed_by_user_id, claimed_at FROM workspace_claims WHERE workspace_id = ?',
    ).bind(workspaceId).first<{ claimed_by_user_id: string; claimed_at: number }>();
    claim = row ? { userId: row.claimed_by_user_id, claimedAt: row.claimed_at } : null;
    const rows = await f.database.prepare(
      'SELECT user_id, class_id FROM workspace_class_assignments WHERE workspace_id = ? ORDER BY user_id, class_id',
    ).bind(workspaceId).all<{ user_id: string; class_id: string }>();
    assignments = rows.results.map((row) => ({ userId: row.user_id, classId: row.class_id }));
  } else {
    const raw = JSON.parse(await readFile(f.filePath!, 'utf8'));
    const record = raw.workspaceClaims[workspaceId];
    claim = record ? { userId: record.claimedByUserId, claimedAt: record.claimedAt } : null;
    assignments = Object.entries(raw.workspaceClassAssignments as Record<string, string[]>)
      .flatMap(([key, classIds]) => key.startsWith(`${workspaceId}:`)
        ? classIds.map((classId) => ({ userId: key.slice(workspaceId.length + 1), classId })) : [])
      .sort((left, right) => left.userId.localeCompare(right.userId) || left.classId.localeCompare(right.classId));
  }
  const snapshot = { members, claim, assignments, audit, workspace: await repository.get(workspaceId) };
  // JSON persistence omits optional properties whose value is undefined. Compare
  // the same serialized contract before/after reload without omitting any data.
  return JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
};

const expectConflict = async (response: Response) => {
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'OWNERSHIP_CONFLICT' });
};
const rejectedTransfer = async (repository: Repository, input: TransferWorkspaceOwnershipInput) => {
  const error = await repository.transferWorkspaceOwnership(input).then(() => null, (cause: unknown) => cause);
  assert.ok(error, 'the invalid transfer must reject');
  await expectConflict(errorResponse(error));
};

const barrier = () => {
  let calls = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  // A changed route must fail with a useful assertion instead of hanging forever.
  const timeout = setTimeout(release, 10_000);
  return {
    wait: async () => { calls += 1; if (calls === 2) release(); await ready; },
    close: () => { clearTimeout(timeout); assert.equal(calls, 2, 'both writes must reach the concurrency barrier'); },
  };
};

const gateConcurrentTransfers = (f: Fixture) => {
  const entry = barrier();
  const originals = f.repositories.map((repo) => repo.transferWorkspaceOwnership.bind(repo));
  for (const [index, repo] of f.repositories.entries()) {
    repo.transferWorkspaceOwnership = async (input) => { await entry.wait(); return originals[index](input); };
  }
  const transactions = f.database ? barrier() : undefined;
  const originalBatch = f.database?.batch.bind(f.database);
  if (f.database && originalBatch) {
    f.database.batch = (async (statements: D1PreparedStatement[]) => {
      // Both old pre-transaction membership reads finish before either batch can
      // commit. The same barrier also works when the fixed path has no pre-reads.
      await transactions!.wait();
      return originalBatch(statements);
    }) as D1Database['batch'];
  }
  return () => {
    for (const [index, repo] of f.repositories.entries()) repo.transferWorkspaceOwnership = originals[index];
    if (f.database && originalBatch) f.database.batch = originalBatch;
    entry.close();
    transactions?.close();
  };
};

const setLegacyOwnership = async (f: Fixture, mode: 'missing-claim' | 'mismatched-claim' | 'multiple-owners'): Promise<Repository> => {
  if (f.database) {
    if (mode === 'missing-claim') {
      await f.database.prepare('DELETE FROM workspace_claims WHERE workspace_id = ?').bind(f.workspaceId).run();
    } else if (mode === 'mismatched-claim') {
      await f.database.prepare('UPDATE workspace_claims SET claimed_by_user_id = ? WHERE workspace_id = ?')
        .bind(f.memberB.session.user.id, f.workspaceId).run();
    } else {
      await f.database.prepare("UPDATE workspace_memberships SET role = 'owner' WHERE workspace_id = ? AND user_id = ?")
        .bind(f.workspaceId, f.memberB.session.user.id).run();
    }
    return f.repository;
  }
  const raw = JSON.parse(await readFile(f.filePath!, 'utf8'));
  if (mode === 'missing-claim') delete raw.workspaceClaims[f.workspaceId];
  else if (mode === 'mismatched-claim') raw.workspaceClaims[f.workspaceId].claimedByUserId = f.memberB.session.user.id;
  else raw.memberships[`${f.workspaceId}:${f.memberB.session.user.id}`].role = 'owner';
  await writeFile(f.filePath!, JSON.stringify(raw), 'utf8');
  return f.reload();
};

for (const adapter of ['node', 'd1'] as const) {
  test(`${adapter}: simultaneous authorized A-to-B and A-to-C transfers have exactly one winner`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await ownershipSnapshot(f);
      const otherBefore = await ownershipSnapshot(f, f.otherWorkspaceId);
      const targets = [f.memberB, f.memberC];
      const restore = gateConcurrentTransfers(f);
      let responses: Response[];
      try {
        responses = await Promise.all(targets.map((target, index) => f.request(target.session.user.id,
          { handler: adapter === 'd1' ? index : 0 })));
      } finally { restore(); }
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      const winningIndex = responses.findIndex((response) => response.status === 200);
      const winner = targets[winningIndex].session.user.id;
      const loser = targets[1 - winningIndex].session.user.id;
      await expectConflict(responses[1 - winningIndex]);
      const success = await responses[winningIndex].json() as { session: { user: { role: string } } };
      assert.equal(success.session.user.role, 'admin', 'the former owner session reflects its demotion');
      const after = await ownershipSnapshot(f);
      assert.deepEqual(after.members.filter((member) => member.role === 'owner').map((member) => member.userId), [winner]);
      assert.equal(after.members.length, before.members.length, 'a transfer cannot create orphan memberships');
      assert.equal(after.members.find((member) => member.userId === f.owner.session.user.id)?.role, 'admin');
      assert.deepEqual(after.members.find((member) => member.userId === loser), before.members.find((member) => member.userId === loser));
      assert.equal(after.claim?.userId, winner);
      assert.deepEqual(after.assignments, before.assignments, 'unrelated teacher class assignments remain intact');
      assert.deepEqual(after.workspace, before.workspace, 'ownership does not change workspace data or revisions');
      const events = after.audit.filter((event) => event.action === 'workspace.owner.transfer');
      assert.equal(after.audit.length, before.audit.length + 1);
      assert.equal(events.length, 1);
      assert.equal(events[0].targetId, winner);
      assert.equal(events[0].actorUserId, f.owner.session.user.id);
      assert.deepEqual(await ownershipSnapshot(f, f.otherWorkspaceId), otherBefore);
      assert.deepEqual(await ownershipSnapshot(f, f.workspaceId, f.reload()), after, 'reload sees the same committed invariant');
      await Promise.all(f.backgroundTasks);
      assert.deepEqual(f.deliveries.map((delivery) => delivery.kind).sort(), ['ownership_received', 'ownership_transferred']);
      assert.equal(f.deliveries.find((delivery) => delivery.kind === 'ownership_received')?.email, targets[winningIndex].session.user.email);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: stale admitted owner, missing target and foreign-workspace target reject without side effects`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await ownershipSnapshot(f);
      const otherBefore = await ownershipSnapshot(f, f.otherWorkspaceId);
      for (const target of ['synthetic-user-not-a-member', f.outsider.session.user.id, f.owner.session.user.id]) {
        await rejectedTransfer(f.repository, transferInput(f, target));
        assert.deepEqual(await ownershipSnapshot(f), before);
        assert.deepEqual(await ownershipSnapshot(f, f.otherWorkspaceId), otherBefore);
      }
      await f.repository.transferWorkspaceOwnership(transferInput(f, f.memberB.session.user.id));
      const committed = await ownershipSnapshot(f);
      await rejectedTransfer(f.repository, transferInput(f, f.memberC.session.user.id));
      assert.deepEqual(await ownershipSnapshot(f), committed);
      const forbidden = await f.request(f.memberC.session.user.id);
      assert.equal(forbidden.status, 403, 'a new request from the demoted user fails authorization');
      assert.deepEqual(await forbidden.json(), { error: 'FORBIDDEN' });
      assert.deepEqual(await ownershipSnapshot(f), committed);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: replaying the identical transfer input and timestamp succeeds only once`, async () => {
    const f = await createFixture(adapter);
    try {
      const input = transferInput(f, f.memberB.session.user.id);
      input.transferredAt = 1_800_000_123_456;
      await f.repository.transferWorkspaceOwnership(input);
      const committed = await ownershipSnapshot(f);
      await rejectedTransfer(f.repository, input);
      assert.deepEqual(await ownershipSnapshot(f), committed);
      assert.equal(committed.audit.filter((event) => event.action === 'workspace.owner.transfer').length, 1);
      assert.equal(committed.claim?.claimedAt, input.transferredAt);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: RBAC, CSRF and tenant authorization still protect ownership transfers`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await ownershipSnapshot(f);
      for (const who of [f.memberB, f.teacher, f.outsider]) {
        const response = await f.request(f.memberC.session.user.id, { who });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: 'FORBIDDEN' });
      }
      const noCsrf = await f.request(f.memberB.session.user.id, { csrf: false });
      assert.equal(noCsrf.status, 403);
      assert.deepEqual(await noCsrf.json(), { error: 'CSRF_INVALID' });
      assert.equal((await f.request(f.memberB.session.user.id, { workspace: f.otherWorkspaceId })).status, 403);
      assert.deepEqual(await ownershipSnapshot(f), before);
      assert.equal(f.deliveries.length, 0);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: legitimate transfer to a scoped teacher clears only the promoted target scope and permits a later transfer`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await ownershipSnapshot(f);
      assert.deepEqual(before.assignments, [{ userId: f.teacher.session.user.id, classId: CLASS_ID }]);
      assert.equal((await f.request(f.teacher.session.user.id)).status, 200);
      const first = await ownershipSnapshot(f);
      assert.deepEqual(first.members.filter((member) => member.role === 'owner').map((member) => member.userId), [f.teacher.session.user.id]);
      assert.deepEqual(first.assignments, []);
      assert.equal(first.claim?.userId, f.teacher.session.user.id);
      assert.equal((await f.request(f.memberB.session.user.id, { who: f.teacher })).status, 200);
      const second = await ownershipSnapshot(f);
      assert.deepEqual(second.members.filter((member) => member.role === 'owner').map((member) => member.userId), [f.memberB.session.user.id]);
      assert.equal(second.members.find((member) => member.userId === f.teacher.session.user.id)?.role, 'admin');
      assert.equal(second.claim?.userId, f.memberB.session.user.id);
      assert.equal(second.audit.filter((event) => event.action === 'workspace.owner.transfer').length, 2);
      assert.deepEqual(second.workspace, before.workspace);
      assert.deepEqual(await ownershipSnapshot(f, f.workspaceId, f.reload()), second);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: a valid legacy sole owner without a claim can transfer atomically`, async () => {
    const f = await createFixture(adapter);
    try {
      const repository = await setLegacyOwnership(f, 'missing-claim');
      const before = await ownershipSnapshot(f, f.workspaceId, repository);
      assert.equal(before.claim, null);
      await repository.transferWorkspaceOwnership(transferInput(f, f.memberB.session.user.id));
      const after = await ownershipSnapshot(f, f.workspaceId, repository);
      assert.deepEqual(after.members.filter((member) => member.role === 'owner').map((member) => member.userId), [f.memberB.session.user.id]);
      assert.equal(after.claim?.userId, f.memberB.session.user.id);
      assert.deepEqual(after.workspace, before.workspace);
      assert.equal(after.audit.filter((event) => event.action === 'workspace.owner.transfer').length, 1);
      assert.deepEqual(await ownershipSnapshot(f, f.workspaceId, f.reload()), after);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: inconsistent claim or multiple legacy owners fail closed without silently repairing data`, async (t) => {
    for (const mode of ['mismatched-claim', 'multiple-owners'] as const) {
      await t.test(mode, async () => {
        const f = await createFixture(adapter);
        try {
          const repository = await setLegacyOwnership(f, mode);
          const before = await ownershipSnapshot(f, f.workspaceId, repository);
          await rejectedTransfer(repository, transferInput(f, f.memberC.session.user.id));
          assert.deepEqual(await ownershipSnapshot(f, f.workspaceId, repository), before);
          assert.deepEqual(await ownershipSnapshot(f, f.workspaceId, f.reload()), before);
        } finally { await f.dispose(); }
      });
    }
  });

  test(`${adapter}: a missing legacy claim cannot let another user create a second owner`, async () => {
    const f = await createFixture(adapter);
    try {
      const repository = await setLegacyOwnership(f, 'missing-claim');
      const before = await ownershipSnapshot(f, f.workspaceId, repository);
      const error = await repository.claimLegacyWorkspace({ workspaceId: f.workspaceId,
        userId: f.outsider.session.user.id, createdAt: Date.now(), auditEvent: {
          id: crypto.randomUUID(), workspaceId: f.workspaceId, actorUserId: f.outsider.session.user.id,
          action: 'workspace.legacy_claim', targetType: 'workspace', targetId: f.workspaceId, createdAt: Date.now(),
        } }).then(() => null, (cause: unknown) => cause);
      assert.ok(error);
      const response = errorResponse(error);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'WORKSPACE_ALREADY_CLAIMED' });
      assert.deepEqual(await ownershipSnapshot(f, f.workspaceId, repository), before);
      assert.deepEqual(await ownershipSnapshot(f, f.workspaceId, f.reload()), before);
    } finally { await f.dispose(); }
  });

  test(`${adapter}: a genuinely ownerless unclaimed legacy workspace can still be claimed exactly once`, async () => {
    const f = await createFixture(adapter);
    const workspaceId = `ws_${'d'.repeat(32)}`;
    try {
      await f.repository.put(workspaceId, initialData(), 0);
      const before = await ownershipSnapshot(f, workspaceId);
      assert.equal(before.members.length, 0);
      assert.equal(before.claim, null);
      const claimInput = (userId: string) => ({ workspaceId, userId, createdAt: Date.now(), auditEvent: {
        id: crypto.randomUUID(), workspaceId, actorUserId: userId, action: 'workspace.legacy_claim',
        targetType: 'workspace', targetId: workspaceId, createdAt: Date.now(),
      } });
      const claimed = await f.repository.claimLegacyWorkspace(claimInput(f.outsider.session.user.id));
      assert.equal(claimed.role, 'owner');
      const committed = await ownershipSnapshot(f, workspaceId);
      assert.deepEqual(committed.members.map((member) => [member.userId, member.role]), [[f.outsider.session.user.id, 'owner']]);
      assert.equal(committed.claim?.userId, f.outsider.session.user.id);
      assert.deepEqual(committed.workspace, before.workspace);
      const error = await f.repository.claimLegacyWorkspace(claimInput(f.owner.session.user.id))
        .then(() => null, (cause: unknown) => cause);
      assert.ok(error);
      const response = errorResponse(error);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'WORKSPACE_ALREADY_CLAIMED' });
      assert.deepEqual(await ownershipSnapshot(f, workspaceId), committed);
    } finally { await f.dispose(); }
  });
}

test('d1: a late audit failure rolls back claim, both role changes and valid teacher assignments', async () => {
  const f = await createFixture('d1');
  try {
    const before = await ownershipSnapshot(f);
    await f.database!.prepare(`CREATE TRIGGER synthetic_m03_abort_audit
      BEFORE INSERT ON audit_events WHEN NEW.action = 'workspace.owner.transfer'
      BEGIN SELECT RAISE(ABORT, 'synthetic ownership audit failure'); END;`).run();
    await assert.rejects(f.repository.transferWorkspaceOwnership(transferInput(f, f.teacher.session.user.id)),
      /synthetic ownership audit failure/);
    assert.deepEqual(await ownershipSnapshot(f), before);
    assert.deepEqual(await ownershipSnapshot(f, f.workspaceId, f.reload()), before);
    await f.database!.prepare('DROP TRIGGER synthetic_m03_abort_audit').run();
    await f.repository.transferWorkspaceOwnership(transferInput(f, f.teacher.session.user.id));
    assert.equal((await ownershipSnapshot(f)).claim?.userId, f.teacher.session.user.id,
      'the failed transaction does not poison a later valid transfer');
  } finally { await f.dispose(); }
});

test('node: failed persistence cannot publish a partial ownership transfer in memory or on disk', async () => {
  const f = await createFixture('node');
  try {
    const before = await ownershipSnapshot(f);
    const internal = f.repository as unknown as { persist(database: unknown): Promise<void> };
    const original = internal.persist;
    internal.persist = async () => { throw new Error('synthetic ownership persistence failure'); };
    try {
      await assert.rejects(f.repository.transferWorkspaceOwnership(transferInput(f, f.teacher.session.user.id)),
        /synthetic ownership persistence failure/);
    } finally { internal.persist = original; }
    assert.deepEqual(await ownershipSnapshot(f), before);
    assert.deepEqual(await ownershipSnapshot(f, f.workspaceId, f.reload()), before);
    await f.repository.transferWorkspaceOwnership(transferInput(f, f.teacher.session.user.id));
    assert.equal((await ownershipSnapshot(f)).claim?.userId, f.teacher.session.user.id);
  } finally { await f.dispose(); }
});

test('d1: failure in the final assignment cleanup rolls back even the newly inserted ownership audit', async () => {
  const f = await createFixture('d1');
  try {
    const before = await ownershipSnapshot(f);
    await f.database!.prepare(`CREATE TRIGGER synthetic_m03_abort_assignment_cleanup
      BEFORE DELETE ON workspace_class_assignments
      BEGIN SELECT RAISE(ABORT, 'synthetic ownership assignment cleanup failure'); END;`).run();
    await assert.rejects(f.repository.transferWorkspaceOwnership(transferInput(f, f.teacher.session.user.id)),
      /synthetic ownership assignment cleanup failure/);
    assert.deepEqual(await ownershipSnapshot(f), before,
      'claim, both memberships, audit and assignments must all roll back after a late failure');
    assert.deepEqual(await ownershipSnapshot(f, f.workspaceId, f.reload()), before);
  } finally { await f.dispose(); }
});
