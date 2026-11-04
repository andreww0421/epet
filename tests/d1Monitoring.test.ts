import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { WorkspaceConflictError } from '../server/contracts';
import type { AppData } from '../src/store/types';
import { D1WorkspaceRepository } from '../worker/repository';

const canary = 'SYNTHETIC-STUDENT-SCORE-COMMENT-SQL-COOKIE-TOKEN';
const data = (): AppData => ({
  lastOpened: 1_800_000_000_000, currentClassId: 'class-monitoring',
  classes: [{ id: 'class-monitoring', name: 'Synthetic Class', students: [{
    id: '100', name: canary, points: 4, rankPoints: 2, warningPoints: 0,
    pet: { type: 'cat', fullness: 80, happiness: 75, level: 1 },
  }] }],
});
type Issue = 'database' | 'projection';
let runtime: Miniflare;
let database: D1Database;

// A fresh, ephemeral synthetic DB only. Historical SQL is never replayed into
// an existing DB or a remote binding by this test fixture.
before(async () => {
  runtime = new Miniflare({ modules: true, d1Databases: ['DB'],
    script: 'export default {fetch(){return new Response("synthetic");}}',
    outboundService: async () => { throw new Error('External network forbidden'); },
  });
  database = await runtime.getD1Database('DB') as unknown as D1Database;
  for (const file of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
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
    assert.equal(lines.length, 0, 'synthetic migration fixture must be complete');
  }
});
after(async () => { await runtime?.dispose(); });

const facade = (overrides: Partial<D1Database>): D1Database => new Proxy({} as D1Database, {
  get: (_, property) => {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const value = Reflect.get(database, property, database);
    return typeof value === 'function' ? value.bind(database) : value;
  },
});
const seed = async (workspace: string) => {
  const repository = new D1WorkspaceRepository(database, { readMode: 'blob' });
  await repository.put(workspace, data(), 0);
  return repository.get(workspace);
};
const capture = (issues: Issue[], shouldThrow = false) => (...args: unknown[]) => {
  assert.equal(args.length, 1, 'no error, SQL, identifier, data or metadata argument may cross the callback');
  assert.ok(args[0] === 'database' || args[0] === 'projection');
  issues.push(args[0]);
  if (shouldThrow) throw new Error(canary);
};

test('metadata read failure reports only database and preserves the original error despite a broken observer', async () => {
  const original = new Error(canary);
  const issues: Issue[] = [];
  const repository = new D1WorkspaceRepository(facade({ prepare() { throw original; } }), {
    onOperationalIssue: capture(issues, true),
  });
  await assert.rejects(repository.get(canary), (error) => error === original);
  assert.deepEqual(issues, ['database']);
  assert.ok(!JSON.stringify(issues).includes(canary));
});

test('explicit blob read failure reports database without adding projection warnings or changing the failure', async () => {
  await seed('monitoring-blob-fail');
  const original = new Error(canary);
  const issues: Issue[] = [];
  const repository = new D1WorkspaceRepository(facade({ prepare(sql) {
    if (sql.includes('data_json')) throw original;
    return database.prepare(sql);
  } }), { readMode: 'blob', onOperationalIssue: capture(issues) });
  await assert.rejects(repository.get('monitoring-blob-fail'), (error) => error === original);
  assert.deepEqual(issues, ['database']);
});

test('healthy normalized reads and missing workspaces produce no operational issue', async () => {
  const expected = await seed('monitoring-healthy');
  const issues: Issue[] = [];
  const repository = new D1WorkspaceRepository(database, { onOperationalIssue: capture(issues) });
  assert.deepEqual(await repository.get('monitoring-healthy'), expected);
  assert.deepEqual(await repository.get('monitoring-nonexistent'), { revision: 0, updatedAt: 0, data: null });
  assert.deepEqual(issues, []);
});

test('normalized database failure preserves exact blob fallback even when the observer throws', async (t) => {
  const expected = await seed('monitoring-normalized-fail');
  const issues: Issue[] = [];
  const logs: unknown[][] = [];
  t.mock.method(console, 'error', (...values: unknown[]) => { logs.push(values); });
  const repository = new D1WorkspaceRepository(facade({ async batch() { throw new Error(canary); } }), {
    onOperationalIssue: capture(issues, true),
  });
  assert.deepEqual(await repository.get('monitoring-normalized-fail'), expected);
  assert.deepEqual(issues, ['database']);
  assert.ok(!JSON.stringify({ issues, logs }).includes(canary));
  assert.deepEqual(logs, [['Normalized workspace read failed; using blob fallback']]);
});

test('missing projection warns only in normalized mode and retains the original workspace data', async () => {
  const expected = await seed('monitoring-missing-projection');
  await database.prepare('DELETE FROM workspace_projection_documents WHERE workspace_id = ?')
    .bind('monitoring-missing-projection').run();
  const issues: Issue[] = [];
  const normalized = new D1WorkspaceRepository(database, { onOperationalIssue: capture(issues, true) });
  assert.deepEqual(await normalized.get('monitoring-missing-projection'), expected);
  assert.deepEqual(issues, ['projection']);
  const blobIssues: Issue[] = [];
  assert.deepEqual(await new D1WorkspaceRepository(database, {
    readMode: 'blob', onOperationalIssue: capture(blobIssues),
  }).get('monitoring-missing-projection'), expected);
  assert.deepEqual(blobIssues, []);
});

test('same-count mismatched projection reports only a fixed projection category and returns the blob', async () => {
  const expected = await seed('monitoring-mismatch');
  await database.prepare('UPDATE students SET record_json = ? WHERE workspace_id = ?')
    .bind(JSON.stringify({ ...data().classes[0].students[0], name: `${canary}-corrupt` }), 'monitoring-mismatch').run();
  const issues: Issue[] = [];
  const repository = new D1WorkspaceRepository(database, { onOperationalIssue: capture(issues) });
  assert.deepEqual(await repository.get('monitoring-mismatch'), expected);
  assert.deepEqual(issues, ['projection']);
  assert.ok(!JSON.stringify(issues).includes(canary));
});

test('multiple storage failures within one read produce one database issue and preserve the final fallback error', async (t) => {
  await seed('monitoring-multiple-failures');
  t.mock.method(console, 'error', () => undefined);
  const fallbackError = new Error(`${canary}-fallback`);
  const issues: Issue[] = [];
  const repository = new D1WorkspaceRepository(facade({
    async batch() { throw new Error(`${canary}-projection`); },
    prepare(sql) {
      if (sql.includes('data_json')) throw fallbackError;
      return database.prepare(sql);
    },
  }), { onOperationalIssue: capture(issues, true) });
  await assert.rejects(repository.get('monitoring-multiple-failures'), (error) => error === fallbackError);
  assert.deepEqual(issues, ['database']);
});

test('normal stale revision conflict remains a conflict and does not create a database failure event', async () => {
  await seed('monitoring-stale-write');
  const issues: Issue[] = [];
  const repository = new D1WorkspaceRepository(database, { onOperationalIssue: capture(issues) });
  await assert.rejects(repository.put('monitoring-stale-write', data(), 0), WorkspaceConflictError);
  assert.deepEqual(issues, []);
});
