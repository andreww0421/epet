import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { AuthService, type AuthSessionEnvelope } from '../server/auth';
import { createApiHandler } from '../server/api';
import { createCsrfToken } from '../server/middleware/csrf';
import { JsonWorkspaceRepository } from '../server/repository';
import type { StoredWorkspace } from '../server/contracts';
import type { AppData } from '../src/store/types';
import { normalizeAppData } from '../src/store/utils';
import { D1WorkspaceRepository } from '../worker/repository';

// Isolated, synthetic databases only. IDs intentionally repeat across classes.
const ORIGIN = 'https://epet.example.test';
const PASSWORD = 'synthetic game feature fixture password';
const NOW = Date.parse('2026-11-15T01:00:00Z');
const FULL = { pets: true, battles: true, bosses: true, leaderboards: true };
const SIMPLE = { pets: true, battles: false, bosses: false, leaderboards: false };
const HIDDEN = { pets: false, battles: false, bosses: false, leaderboards: false };
type Adapter = 'node' | 'd1';
type Repository = JsonWorkspaceRepository | D1WorkspaceRepository;
type Client = AuthSessionEnvelope & { csrf: string };
// Repository memory may contain optional undefined fields; wire/disk JSON omits
// them. Compare the complete persisted representation without dropping values.
const assertPersistedEqual = (actual: unknown, expected: unknown) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

const createData = (legacy = false): AppData => JSON.parse(JSON.stringify(normalizeAppData({
  lastOpened: NOW, currentClassId: 'class-a',
  settings: { decayAmount: 2, decayType: 'hourly', inclusiveMode: false,
    petCareMode: 'death', publicLeaderboardMode: 'rank', battleEnabled: true,
    battleMode: 'both', feedCost: 17, feedGain: 19,
    ...(legacy ? {} : { gameFeatures: FULL }) },
  classes: ['class-a', 'class-b'].map((classId, index) => ({
    id: classId, name: `Synthetic ${classId}`, students: [{
      id: '100', name: index === 0 ? 'Synthetic Alice' : 'Synthetic Bob secret',
      points: 310 + index, rankPoints: 81 + index,
      pet: { type: 'dog', level: 4 + index, fullness: 87, happiness: 74 },
      stats: { wins: 3 + index, losses: 2 }, teamId: `team-${index}`,
      nextUpgradeGachaLevel: 6, warningPoints: 1, activeWarningTimestamps: [NOW - 2_000],
      disciplineRecords: [{ id: `warning-${index}`, type: 'warning', createdAt: NOW - 2_000 }],
      economyEventRecords: [{ id: `spend-${index}`, kind: 'spend', source: 'feed', amount: 17, createdAt: NOW - 3_000 }],
      pointAdjustmentRecords: [{ id: `feedback-${index}`, source: 'manual', amount: 3,
        reasonLabel: 'Synthetic feedback', createdAt: NOW - 4_000 }],
      dailyProgress: { streak: 3, lastClaimDate: '2026-11-14' },
    }],
    activeBoss: { id: `boss-${index}`, name: `Synthetic boss ${index}`, maxHp: 1_000,
      currentHp: 750, isActive: true, contributions: { '100': 250 },
      attackCounts: { '100': 2 }, rewardTiers: [{ rank: 1, points: 13, rankPoints: 2, happiness: 3 }] },
    learningEvidenceRecords: [{ id: `evidence-${index}`, classId, studentId: '100',
      competency: 'growth', level: 'progressing', evidenceType: 'observation',
      title: `Synthetic observation ${index}`, actor: 'mentor', source: 'manual',
      rubricVersion: '1.0', revision: 1, createdAt: NOW - 5_000 }],
    examRecords: [{ id: `exam-${index}`, title: 'Synthetic exam', examDate: '2026-11-14',
      items: [{ id: 'math', name: 'Math', maxScore: 100 }],
      results: [{ studentId: '100', scores: { math: 84 + index }, updatedAt: NOW - 6_000 }],
      createdAt: NOW - 6_000, updatedAt: NOW - 6_000 }],
  })),
}, NOW)));

const applyMigrations = async (database: D1Database) => {
  for (const file of (await readdir('migrations')).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    let lines: string[] = [];
    let trigger = false;
    for (const raw of (await readFile(join('migrations', file), 'utf8')).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('--')) continue;
      if (/^CREATE\s+TRIGGER\b/i.test(line)) trigger = true;
      lines.push(raw);
      if (trigger ? /^END;$/i.test(line) : line.endsWith(';')) {
        await database.prepare(lines.join('\n')).run();
        lines = [];
        trigger = false;
      }
    }
    assert.equal(lines.length, 0, `incomplete migration: ${file}`);
  }
};

const createFixture = async (adapter: Adapter, legacy = false) => {
  let database: D1Database | undefined;
  let dispose: (() => Promise<void>) | undefined;
  let repository: Repository;
  let file: string | undefined;
  try {
    if (adapter === 'd1') {
      const miniflare = new Miniflare({ modules: true,
        script: 'export default { fetch() { return new Response("synthetic fixture"); } }',
        d1Databases: ['DB'] });
      dispose = () => miniflare.dispose();
      database = await miniflare.getD1Database('DB') as unknown as D1Database;
      await applyMigrations(database);
      repository = new D1WorkspaceRepository(database);
    } else {
      const directory = await mkdtemp(join(tmpdir(), 'epet-game-features-'));
      file = join(directory, 'data.json');
      dispose = () => rm(directory, { recursive: true, force: true });
      repository = new JsonWorkspaceRepository(file);
    }
    const auth = new AuthService(repository, { passwordIterations: 10 });
    const asClient = (session: AuthSessionEnvelope): Client => ({ ...session, csrf: createCsrfToken() });
    const owner = asClient(await auth.register({ email: 'game-owner@example.test', password: PASSWORD,
      displayName: 'Synthetic owner', workspaceName: 'Synthetic game workspace', initialWorkspaceData: createData(legacy) }));
    const workspaceId = owner.session.activeWorkspaceId!;
    const invitation = await auth.createWorkspaceInvitation(owner.sessionToken, workspaceId,
      'game-teacher@example.test', 'teacher', ['class-a']);
    const teacher = asClient(await auth.acceptWorkspaceInvitation(invitation.token, 'Synthetic teacher', PASSWORD));
    const handler = createApiHandler(repository, { auth: { passwordIterations: 10 } });
    const request = (who: Client, path: string, method = 'GET', body?: unknown, workspace = workspaceId,
      overrides: Record<string, string> = {}) => handler(new Request(`${ORIGIN}/api/v1${path}`, {
      method, headers: { origin: ORIGIN, 'content-type': 'application/json',
        'x-epet-workspace': workspace,
        cookie: `__Host-epet_session=${who.sessionToken}; __Host-epet_csrf=${who.csrf}`,
        'x-csrf-token': who.csrf, ...overrides },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const reload = () => (database
      ? new D1WorkspaceRepository(database, { readMode: 'normalized' })
      : new JsonWorkspaceRepository(file!)).get(workspaceId);
    return { repository, database, owner, teacher, workspaceId, request, reload, dispose };
  } catch (error) { await dispose?.(); throw error; }
};

type Fixture = Awaited<ReturnType<typeof createFixture>>;
const put = (f: Fixture, snapshot: StoredWorkspace, features: typeof FULL, who = f.owner) => {
  assert.ok(snapshot.data?.settings);
  return f.request(who, '/state', 'PUT', { baseRevision: snapshot.revision,
    data: { ...snapshot.data, settings: { ...snapshot.data.settings, gameFeatures: features } } });
};
const parseSaved = async (response: Response): Promise<StoredWorkspace> => {
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body as StoredWorkspace;
};
const stableSettings = (data: AppData) => {
  const settings = { ...data.settings };
  delete settings.gameFeatures;
  return settings;
};
const assertProjectedPolicy = async (f: Fixture, snapshot: StoredWorkspace) => {
  const reloaded = await f.reload();
  assertPersistedEqual(reloaded.data, snapshot.data);
  if (f.database) {
    const projected = await f.database.prepare(
      'SELECT source_revision, root_json FROM workspace_projection_documents WHERE workspace_id = ?',
    ).bind(f.workspaceId).first<{ source_revision: number; root_json: string }>();
    assert.equal(projected?.source_revision, snapshot.revision);
    assert.deepEqual(JSON.parse(projected!.root_json).settings.gameFeatures, snapshot.data?.settings?.gameFeatures);
  }
};

for (const adapter of ['node', 'd1'] as const) {
  test(`${adapter}: toggling every activity off and on preserves progress, rules, ledgers and learning history`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      let current = before;
      for (const features of [SIMPLE, HIDDEN, FULL]) {
        current = await parseSaved(await put(f, current, features));
        assert.deepEqual(current.data?.settings?.gameFeatures, features);
        assertPersistedEqual(current.data?.classes, before.data?.classes);
        assert.deepEqual(stableSettings(current.data!), stableSettings(before.data!));
        await assertProjectedPolicy(f, current);
      }
      const revisions = await f.repository.listWorkspaceRevisions(f.workspaceId);
      assert.equal(revisions.filter((row) => row.revision > before.revision).length, 3);
      for (const revision of revisions) {
        const history = await f.repository.getWorkspaceRevision(f.workspaceId, revision.revision);
        assertPersistedEqual(history?.data.classes, before.data?.classes);
      }
    } finally { await f.dispose!(); }
  });

  test(`${adapter}: authorized import and controlled revision restore retain policy and exact game data`, async () => {
    const f = await createFixture(adapter);
    try {
      const original = await f.repository.get(f.workspaceId);
      const hidden = await parseSaved(await put(f, original, HIDDEN));
      const imported = await parseSaved(await f.request(f.owner, '/workspace/import', 'POST', {
        confirmation: 'IMPORT WORKSPACE', acknowledgeReplacement: true,
        expectedRevision: hidden.revision,
        data: { ...hidden.data, settings: { ...hidden.data!.settings, gameFeatures: SIMPLE } },
      }));
      assert.deepEqual(imported.data?.settings?.gameFeatures, SIMPLE);
      assert.deepEqual(imported.data?.classes, original.data?.classes);
      await assertProjectedPolicy(f, imported);
      const restored = await parseSaved(await f.request(f.owner, `/revisions/${hidden.revision}/restore`, 'POST'));
      assert.deepEqual(restored.data?.settings?.gameFeatures, HIDDEN);
      assert.deepEqual(restored.data?.classes, original.data?.classes);
      assert.deepEqual(stableSettings(restored.data!), stableSettings(original.data!));
      await assertProjectedPolicy(f, restored);
    } finally { await f.dispose!(); }
  });

  test(`${adapter}: teacher cannot forge workspace policy or cross class/workspace boundaries; authorized teaching still saves`, async () => {
    const f = await createFixture(adapter);
    try {
      const before = await f.repository.get(f.workspaceId);
      const scoped = await parseSaved(await f.request(f.teacher, '/state'));
      assert.deepEqual(scoped.data?.classes.map((item) => item.id), ['class-a']);
      const rejected = await put(f, scoped, HIDDEN, f.teacher);
      assert.equal(rejected.status, 403);
      assert.ok(!(await rejected.text()).includes('Synthetic Bob secret'));
      assertPersistedEqual(await f.repository.get(f.workspaceId), before);
      assert.equal((await f.repository.listWorkspaceAuditEvents(f.workspaceId,
        { action: 'workspace.state.put' })).length, 0);

      const savedPolicy = await parseSaved(await put(f, before, SIMPLE));
      const freshScoped = await parseSaved(await f.request(f.teacher, '/state'));
      freshScoped.data!.classes[0].students[0].points += 2;
      const authorized = await parseSaved(await f.request(f.teacher, '/state', 'PUT', {
        data: freshScoped.data, baseRevision: freshScoped.revision,
      }));
      assert.deepEqual(authorized.data?.settings?.gameFeatures, SIMPLE);
      assert.equal(authorized.data?.classes[0].students[0].points, before.data!.classes[0].students[0].points + 2);
      assert.ok(!JSON.stringify(authorized).includes('Synthetic Bob secret'));
      const after = await f.repository.get(f.workspaceId);
      assertPersistedEqual(after.data?.classes[1], before.data?.classes[1]);
      assert.equal(after.revision, savedPolicy.revision + 1);

      const crossClass = structuredClone(authorized.data!);
      crossClass.classes.push(before.data!.classes[1]);
      const wrongClass = await f.request(f.teacher, '/state', 'PUT', { data: crossClass, baseRevision: after.revision });
      assert.equal(wrongClass.status, 403);
      assert.ok(!(await wrongClass.text()).includes('Synthetic Bob secret'));
      const wrongWorkspace = await f.request(f.teacher, '/state', 'GET', undefined, 'unrelated-synthetic-workspace');
      assert.equal(wrongWorkspace.status, 403);
      const csrfRejected = await f.request(f.owner, '/state', 'PUT', {
        data: after.data, baseRevision: after.revision,
      }, f.workspaceId, { 'x-csrf-token': 'incorrect-synthetic-csrf' });
      assert.equal(csrfRejected.status, 403);
      assert.deepEqual(await f.repository.get(f.workspaceId), after);
    } finally { await f.dispose!(); }
  });

  test(`${adapter}: legacy missing policy survives reload, teacher write, import and revision restore without injected defaults`, async () => {
    const f = await createFixture(adapter, true);
    try {
      const original = await f.repository.get(f.workspaceId);
      assert.equal(Object.hasOwn(original.data!.settings!, 'gameFeatures'), false);
      const scoped = await parseSaved(await f.request(f.teacher, '/state'));
      scoped.data!.classes[0].students[0].points += 1;
      const teacherSaved = await parseSaved(await f.request(f.teacher, '/state', 'PUT', {
        data: scoped.data, baseRevision: scoped.revision,
      }));
      assert.equal(Object.hasOwn(teacherSaved.data!.settings!, 'gameFeatures'), false);
      const imported = await parseSaved(await f.request(f.owner, '/workspace/import', 'POST', {
        confirmation: 'IMPORT WORKSPACE', acknowledgeReplacement: true,
        expectedRevision: teacherSaved.revision, data: original.data,
      }));
      assert.equal(Object.hasOwn(imported.data!.settings!, 'gameFeatures'), false);
      await assertProjectedPolicy(f, imported);
      await parseSaved(await put(f, imported, SIMPLE));
      const restored = await parseSaved(await f.request(f.owner, `/revisions/${imported.revision}/restore`, 'POST'));
      assert.equal(Object.hasOwn(restored.data!.settings!, 'gameFeatures'), false);
      assert.deepEqual(restored.data!.classes, original.data!.classes);
      await assertProjectedPolicy(f, restored);
    } finally { await f.dispose!(); }
  });
}
