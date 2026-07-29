import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEpetServer } from '../server/app';

const workspaceId = 'server-test';

const createState = () => ({
  currentClassId: 'class-a',
  classes: [{
    id: 'class-a',
    name: 'Class A',
    students: [{
      id: 'student-a',
      name: 'Alpha',
      points: 200,
      rankPoints: 20,
      warningPoints: 0,
      pet: {
        type: 'dog',
        fullness: 80,
        happiness: 60,
        level: 2,
      },
      stats: { wins: 0, losses: 0 },
    }],
    classGoals: [{
      id: 'goal-a',
      title: 'Collaborate with evidence',
      competency: 'collaboration',
      targetCount: 3,
      createdAt: Date.now() - 60_000,
    }],
    learningEvidenceRecords: [],
  }],
  settings: {
    language: 'zh',
    maxPoints: 700,
  },
});

test('backend persists state, prevents lost updates, and serves education analytics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-server-test-'));
  const { server } = createEpetServer({
    dataFile: join(directory, 'workspaces.json'),
    distDirectory: join(directory, 'dist'),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const request = async (
    path: string,
    init: RequestInit = {},
  ) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-epet-workspace': workspaceId,
      ...init.headers,
    },
  });

  try {
    const healthResponse = await request('/api/v1/health');
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      ok: true,
      service: 'epet-api',
      version: 1,
    });

    const initialSaveResponse = await request('/api/v1/state', {
      method: 'PUT',
      body: JSON.stringify({ baseRevision: 0, data: createState() }),
    });
    assert.equal(initialSaveResponse.status, 200);
    const initialSave = await initialSaveResponse.json() as {
      revision: number;
      data: ReturnType<typeof createState>;
    };
    assert.equal(initialSave.revision, 1);
    assert.equal(initialSave.data.classes[0].students[0].points, 200);

    const evidenceResponse = await request('/api/v1/classes/class-a/evidence', {
      method: 'POST',
      body: JSON.stringify({
        studentId: 'student-a',
        input: {
          competency: 'collaboration',
          level: 'progressing',
          evidenceType: 'observation',
          title: 'Explains a strategy to a teammate',
          note: 'References the assignment rubric.',
        },
      }),
    });
    assert.equal(evidenceResponse.status, 201);
    const evidenceResult = await evidenceResponse.json() as {
      revision: number;
      record: { source: string; rubricVersion: string };
    };
    assert.equal(evidenceResult.revision, 2);
    assert.equal(evidenceResult.record.source, 'manual');
    assert.equal(evidenceResult.record.rubricVersion, '1.0');

    const invalidEvidenceResponse = await request('/api/v1/classes/class-a/evidence', {
      method: 'POST',
      body: JSON.stringify({
        studentId: 'student-a',
        input: {
          competency: 'not-a-competency',
          level: 'mastered',
          evidenceType: 'observation',
          title: 'Invalid evidence',
        },
      }),
    });
    assert.equal(invalidEvidenceResponse.status, 400);

    const classAnalyticsResponse = await request(
      '/api/v1/classes/class-a/analytics?windowDays=28',
    );
    assert.equal(classAnalyticsResponse.status, 200);
    const classAnalytics = await classAnalyticsResponse.json() as {
      evidenceCount: number;
      coverageRate: number;
      goalAlignmentRate: number;
    };
    assert.equal(classAnalytics.evidenceCount, 1);
    assert.equal(classAnalytics.coverageRate, 1);
    assert.equal(classAnalytics.goalAlignmentRate, 1);

    const studentAnalyticsResponse = await request(
      '/api/v1/classes/class-a/students/student-a/analytics',
    );
    assert.equal(studentAnalyticsResponse.status, 200);
    const studentAnalytics = await studentAnalyticsResponse.json() as {
      studentId: string;
      evidenceCount: number;
      progressingCount: number;
    };
    assert.equal(studentAnalytics.studentId, 'student-a');
    assert.equal(studentAnalytics.evidenceCount, 1);
    assert.equal(studentAnalytics.progressingCount, 1);

    const persistedResponse = await request('/api/v1/state');
    const persisted = await persistedResponse.json() as {
      revision: number;
      data: ReturnType<typeof createState>;
    };
    assert.equal(persisted.revision, 2);
    assert.equal(persisted.data.classes[0].students[0].points, 200);
    assert.equal(persisted.data.classes[0].learningEvidenceRecords.length, 1);

    const staleResponse = await request('/api/v1/state', {
      method: 'PUT',
      body: JSON.stringify({ baseRevision: 0, data: persisted.data }),
    });
    assert.equal(staleResponse.status, 409);

    const concurrentPayload = JSON.stringify({
      baseRevision: persisted.revision,
      data: persisted.data,
    });
    const concurrentResponses = await Promise.all([
      request('/api/v1/state', { method: 'PUT', body: concurrentPayload }),
      request('/api/v1/state', { method: 'PUT', body: concurrentPayload }),
    ]);
    assert.deepEqual(
      concurrentResponses.map((response) => response.status).sort(),
      [200, 409],
    );

    const bossResponse = await request('/api/v1/boss/resolve', {
      method: 'POST',
      body: JSON.stringify({
        students: persisted.data.classes[0].students,
        boss: {
          id: 'boss-a',
          name: 'Assessment Boss',
          maxHp: 100,
          currentHp: 0,
          rewardTiers: [
            { rank: 1, points: 30, happiness: 5, rankPoints: 10 },
          ],
          participationReward: { points: 5, happiness: 2, rankPoints: 3 },
          improvementReward: { points: 0, happiness: 0, rankPoints: 0 },
          contributions: { 'student-a': 50 },
          attackCounts: { 'student-a': 3 },
          isActive: false,
        },
        now: Date.now(),
        maxPoints: 700,
      }),
    });
    assert.equal(bossResponse.status, 200);
    const bossResult = await bossResponse.json() as {
      standings: Array<{ studentId: string; fairScore: number }>;
      students: Array<{ points: number; rankPoints: number }>;
    };
    assert.equal(bossResult.standings[0].studentId, 'student-a');
    assert.ok(bossResult.standings[0].fairScore > 0);
    assert.equal(bossResult.students[0].points, 235);
    assert.equal(bossResult.students[0].rankPoints, 33);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
