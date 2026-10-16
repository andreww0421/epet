import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  findPermanentlyDeletedClassIds,
  purgeClassesFromWorkspaceData,
} from '../shared/domain/studentPrivacy';
import { JsonWorkspaceRepository } from '../server/repository';
import { WorkspaceConflictError } from '../server/contracts';
import type { AppData } from '../src/store/types';

const createData = (): AppData => ({
  lastOpened: 1_700_000_000_000,
  currentClassId: 'class-remove',
  classes: [{
    id: 'class-remove', name: 'Synthetic archived class', archivedAt: 1_700_000_000_000,
    students: [{
      id: 'synthetic-student-remove', name: 'Synthetic learner', points: 10,
      pet: { type: 'cat', level: 2, fullness: 70, happiness: 70 },
    }],
    learningEvidenceRecords: [{
      id: 'evidence-remove', classId: 'class-remove', studentId: 'synthetic-student-remove',
      title: 'Synthetic evidence', note: 'Synthetic note', competency: 'growth',
      level: 'progressing', evidenceType: 'observation', actor: 'mentor', source: 'manual',
      rubricVersion: '1.0', revision: 1, createdAt: 1_700_000_000_000,
    }],
    examRecords: [{
      id: 'exam-remove', title: 'Synthetic exam', examDate: '2026-10-14',
      items: [{ id: 'synthetic-item', name: 'Synthetic item', maxScore: 10 }],
      results: [{ studentId: 'synthetic-student-remove', scores: { 'synthetic-item': 5 },
        mentorComment: 'Synthetic comment', updatedAt: 1_700_000_000_000 }],
      createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
    }],
  }, { id: 'class-keep', name: 'Remaining active class', students: [] }],
});

const withRepository = async (run: (repository: JsonWorkspaceRepository, path: string) => Promise<void>) => {
  const fixtureRoot = join(process.cwd(), 'output', 'privacy-unit');
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(join(fixtureRoot, 'class-deletion-'));
  try {
    const path = join(directory, 'data.json');
    await run(new JsonWorkspaceRepository(path), path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('class deletion detection includes empty classes and ignores archives or new classes', () => {
  const data = createData();
  data.classes[0].students = [];
  assert.deepEqual([...findPermanentlyDeletedClassIds(data, {
    ...data, classes: [data.classes[1]],
  })], ['class-remove']);
  assert.equal(findPermanentlyDeletedClassIds(null, data).size, 0);
  assert.equal(findPermanentlyDeletedClassIds(data, {
    ...data, classes: data.classes.map((classroom) => ({ ...classroom, archivedAt: 1_700_000_000_001 })),
  }).size, 0);
});

test('pure class purge removes the complete class without changing remaining records', () => {
  const original = createData();
  const data = structuredClone(original);
  const purged = purgeClassesFromWorkspaceData(data, new Set(['class-remove']));
  assert.deepEqual(purged, { ...data, currentClassId: 'class-keep', classes: [data.classes[1]] });
  assert.equal(purged.classes[0], data.classes[1]);
  assert.deepEqual(data, original);
  assert.equal(purgeClassesFromWorkspaceData(data, new Set()), data);
  assert.equal(purgeClassesFromWorkspaceData(data, new Set(['missing-class'])), data);
});

test('class purge has a valid empty selection when no active historical class remains', () => {
  const data = createData();
  data.classes[1].archivedAt = 1_700_000_000_000;
  assert.equal(purgeClassesFromWorkspaceData(data, new Set(['class-remove'])).currentClassId, '');
  const empty = purgeClassesFromWorkspaceData(data, new Set(['class-remove', 'class-keep']));
  assert.deepEqual(empty.classes, []);
  assert.equal(empty.currentClassId, '');
});

test('JSON deletion removes complete retained classes, preserves audit accountability and isolates tenants', async () => {
  await withRepository(async (repository, path) => {
    const data = createData();
    await repository.put('tenant-delete', data, 0);
    await repository.put('tenant-other', data, 0);
    await repository.appendAuditEvent({ id: 'earlier-student-export', workspaceId: 'tenant-delete',
      actorUserId: 'synthetic-admin', action: 'student.privacy.export', targetType: 'student',
      targetId: 'synthetic-student-remove', createdAt: 1 });
    await repository.appendAuditEvent({ id: 'earlier-class-archive', workspaceId: 'tenant-delete',
      actorUserId: 'synthetic-admin', action: 'class.privacy.archive', targetType: 'class',
      targetId: 'class-remove', createdAt: 2 });
    const emptyClass = structuredClone(data);
    emptyClass.classes[0].students = [];
    await repository.put('tenant-delete', emptyClass, 1);
    await repository.put('tenant-delete', purgeClassesFromWorkspaceData(emptyClass, new Set(['class-remove'])), 2, {
      action: 'class.privacy.delete', actorUserId: 'synthetic-admin', requestId: 'class-delete-audit',
    });
    for (const revision of await repository.listWorkspaceRevisions('tenant-delete')) {
      const snapshot = await repository.getWorkspaceRevision('tenant-delete', revision.revision);
      assert.ok(snapshot);
      assert.deepEqual(snapshot.data.classes, [data.classes[1]]);
      assert.equal(snapshot.data.currentClassId, 'class-keep');
      assert.equal(snapshot.dataSizeBytes, Buffer.byteLength(JSON.stringify(snapshot.data), 'utf8'));
      assert.equal(JSON.stringify(snapshot.data).includes('exam-remove'), false);
    }
    const audit = await repository.listWorkspaceAuditEvents('tenant-delete');
    assert.deepEqual(audit.find((event) => event.id === 'class-delete-audit')?.metadata, {
      deletedClassCount: 1, deletedStudentCount: 0,
    });
    assert.deepEqual(audit.find((event) => event.action === 'privacy.class.purge')?.metadata, {
      deletedClassCount: 1, deletedStudentCount: 0,
    });
    const earlierExport = audit.find((event) => event.id === 'earlier-student-export');
    assert.equal(earlierExport?.targetId, undefined);
    assert.equal(earlierExport?.actorUserId, 'synthetic-admin');
    assert.equal(earlierExport?.action, 'student.privacy.export');
    assert.equal(audit.find((event) => event.id === 'earlier-class-archive')?.targetId, 'class-remove');
    assert.deepEqual((await repository.get('tenant-other')).data, data);
    assert.deepEqual((await repository.getWorkspaceRevision('tenant-other', 1))?.data, data);
    assert.deepEqual((await new JsonWorkspaceRepository(path).get('tenant-delete')).data,
      (await repository.get('tenant-delete')).data);
  });
});

test('JSON class deletion with students records only counts and cannot restore erased retained content', async () => {
  await withRepository(async (repository) => {
    const data = createData();
    await repository.put('tenant-delete', data, 0);
    const deleted = await repository.put('tenant-delete', purgeClassesFromWorkspaceData(data, new Set(['class-remove'])), 1, {
      action: 'class.privacy.delete', requestId: 'class-delete-with-student',
    });
    const snapshot = await repository.getWorkspaceRevision('tenant-delete', 1);
    assert.ok(snapshot);
    await repository.put('tenant-delete', snapshot.data, deleted.revision, { action: 'workspace.revision.restore' });
    assert.deepEqual((await repository.get('tenant-delete')).data?.classes, [data.classes[1]]);
    const event = (await repository.listWorkspaceAuditEvents('tenant-delete'))
      .find((candidate) => candidate.id === 'class-delete-with-student');
    assert.deepEqual(event?.metadata, { deletedClassCount: 1, deletedStudentCount: 1 });
    assert.equal(JSON.stringify(event).includes('synthetic-student-remove'), false);
  });
});

test('stale JSON class deletion cannot scrub snapshots or audits', async () => {
  await withRepository(async (repository) => {
    const data = createData();
    await repository.put('tenant-delete', data, 0);
    await repository.put('tenant-delete', data, 1);
    await repository.appendAuditEvent({ id: 'stale-prior-export', workspaceId: 'tenant-delete',
      action: 'student.privacy.export', targetType: 'student', targetId: 'synthetic-student-remove', createdAt: 1 });
    await assert.rejects(repository.put('tenant-delete', purgeClassesFromWorkspaceData(data, new Set(['class-remove'])), 1, {
      action: 'class.privacy.delete', requestId: 'stale-delete',
    }), WorkspaceConflictError);
    assert.deepEqual((await repository.get('tenant-delete')).data, data);
    assert.deepEqual((await repository.getWorkspaceRevision('tenant-delete', 1))?.data, data);
    const audit = await repository.listWorkspaceAuditEvents('tenant-delete');
    assert.equal(audit.find((event) => event.id === 'stale-prior-export')?.targetId, 'synthetic-student-remove');
    assert.equal(audit.some((event) => event.id === 'stale-delete'), false);
  });
});

test('failed JSON persistence cannot publish a partial class, snapshot or audit deletion', async () => {
  await withRepository(async (repository, path) => {
    const data = createData();
    await repository.put('tenant-delete', data, 0);
    await repository.appendAuditEvent({ id: 'failed-prior-export', workspaceId: 'tenant-delete',
      action: 'student.privacy.export', targetType: 'student', targetId: 'synthetic-student-remove', createdAt: 1 });
    const persisted = await readFile(path, 'utf8');
    const backup = `${path}.backup`;
    await rename(path, backup);
    await mkdir(path);
    await assert.rejects(repository.put('tenant-delete', purgeClassesFromWorkspaceData(data, new Set(['class-remove'])), 1, {
      action: 'class.privacy.delete', requestId: 'failed-delete',
    }));
    assert.equal((await repository.get('tenant-delete')).revision, 1);
    assert.deepEqual((await repository.getWorkspaceRevision('tenant-delete', 1))?.data, data);
    const audit = await repository.listWorkspaceAuditEvents('tenant-delete');
    assert.equal(audit.find((event) => event.id === 'failed-prior-export')?.targetId, 'synthetic-student-remove');
    assert.equal(audit.some((event) => event.id === 'failed-delete'), false);
    // Remove only this fixture's empty obstacle, then restore its original file.
    await rmdir(path);
    await rename(backup, path);
    assert.equal(await readFile(path, 'utf8'), persisted);
    await repository.put('tenant-delete', purgeClassesFromWorkspaceData(data, new Set(['class-remove'])), 1, {
      action: 'class.privacy.delete', requestId: 'retry-delete',
    });
    assert.equal((await repository.get('tenant-delete')).revision, 2);
  });
});
