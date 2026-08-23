import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createApiHandler,
  type ApiOptions,
} from '../server/api';
import { createEpetServer } from '../server/app';
import type {
  AccountLifecycleDelivery,
  EmailVerificationDelivery,
  PasswordResetDelivery,
  WorkspaceInvitationDelivery,
} from '../server/auth';
import type { WorkspaceRole } from '../server/contracts';
import { JsonWorkspaceRepository } from '../server/repository';
import { normalizeAppData } from '../src/store/utils';
import {
  createAccountLifecycleMailer,
  createEmailVerificationMailer,
} from '../worker/passwordResetEmail';
import { createTurnstileVerifier } from '../worker/turnstile';

const LEGACY_WORKSPACE_ID = 'ws_legacy_workspace_0123456789abcdef';
const OWNER_EMAIL = 'owner@example.test';
const OWNER_PASSWORD = 'correct horse battery staple';
const NEW_OWNER_PASSWORD = 'a newer correct horse password';

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

type AuthEnvelope = {
  sessionToken: string;
  session: {
    user: {
      id: string;
      email: string;
      role: string;
      emailVerified: boolean;
    };
    workspaces: Array<{
      id: string;
      name: string;
      role: string;
    }>;
    activeWorkspaceId: string | null;
  };
  legacyClaim?: {
    status: 'claimed' | 'failed';
    workspaceId: string;
    error?: string;
  };
};

type ApiRequestInit = RequestInit & {
  sessionToken?: string;
  workspaceId?: string;
};

const testApiClients = new Map<
  string,
  { cookie: string; csrfToken: string }
>();

const createRequester = (
  handler: ReturnType<typeof createApiHandler>,
) => {
  const cookieValue = (header: string, name: string) =>
    header.match(new RegExp(`${name}=([^;,\\s]+)`))?.[1] ?? '';

  return async (
    path: string,
    init: ApiRequestInit = {},
  ) => {
    const {
      sessionToken,
      workspaceId,
      headers: initialHeaders,
      ...requestInit
    } = init;
    const headers = new Headers(initialHeaders);
    headers.set('x-forwarded-for', '127.0.0.1');
    const method = (requestInit.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers.has('origin')) {
      headers.set('origin', 'http://localhost');
    }
    if (requestInit.body != null && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    if (sessionToken) {
      const client = testApiClients.get(sessionToken);
      assert.ok(client, 'test client session context should exist');
      headers.set('cookie', client.cookie);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        headers.set('x-csrf-token', client.csrfToken);
      }
    }
    if (workspaceId) {
      headers.set('x-epet-workspace', workspaceId);
    }
    const response = await handler(new Request(`http://localhost${path}`, {
      ...requestInit,
      headers,
    }));
    const setCookie = response.headers.get('set-cookie') ?? '';
    const sessionCookie = cookieValue(setCookie, '__Host-epet_session');
    if (!sessionCookie) return response;
    const body = await response.clone().json().catch(() => null) as
      | Record<string, unknown>
      | null;
    const csrfToken = typeof body?.csrfToken === 'string'
      ? body.csrfToken
      : '';
    const csrfCookie = cookieValue(setCookie, '__Host-epet_csrf');
    if (!body?.session || !csrfToken || !csrfCookie) return response;
    const clientId = `client_${csrfToken}`;
    testApiClients.set(clientId, {
      cookie:
        `__Host-epet_session=${sessionCookie}; ` +
        `__Host-epet_csrf=${csrfCookie}`,
      csrfToken,
    });
    return Response.json(
      { ...body, sessionToken: clientId },
      { status: response.status, headers: response.headers },
    );
  };
};

const createHandlerOptions = (
  deliveries: PasswordResetDelivery[],
  backgroundTasks?: Promise<void>[],
): ApiOptions => ({
  allowLocalWorkspaceIds: true,
  allowedOrigins: ['https://teacher.example.test'],
  auth: {
    passwordIterations: 10,
  },
  forgotResponseFloorMs: 5,
  passwordResetMailer: async (delivery) => {
    deliveries.push(delivery);
  },
  deferBackgroundTask: (task) => {
    backgroundTasks?.push(task);
  },
  registrationEnabled: true,
});

type TestServer = ReturnType<typeof createEpetServer>['server'];

const listenForTest = async (server: TestServer) => {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once('error', handleError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', handleError);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
};

const closeTestServer = async (server: TestServer) => {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
};

const createRoleScopedRepository = (
  repository: JsonWorkspaceRepository,
  role: WorkspaceRole,
  classIds: string[] = [],
) => new Proxy(repository, {
  get(target, property) {
    if (property === 'getWorkspaceMembership') {
      return async (workspaceId: string, userId: string) => {
        const membership = await target.getWorkspaceMembership(
          workspaceId,
          userId,
        );
        return membership ? { ...membership, role } : null;
      };
    }
    if (property === 'listWorkspaceClassIds') {
      return async () => [...classIds];
    }
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

const createTwoClassState = () => {
  const state = createState();
  state.classes.push({
    id: 'class-b',
    name: 'Class B',
    students: [{
      id: 'student-b',
      name: 'Beta',
      points: 90,
      rankPoints: 5,
      warningPoints: 0,
      pet: {
        type: 'cat',
        fullness: 70,
        happiness: 65,
        level: 1,
      },
      stats: { wins: 0, losses: 0 },
    }],
    classGoals: [],
    learningEvidenceRecords: [],
  });
  return state;
};

const createPrivacyState = () => {
  const now = 1_700_000_000_000;
  return {
    currentClassId: 'class-a',
    classes: [{
      id: 'class-a',
      name: 'Class A',
      students: [
        {
          id: 'student-a',
          name: 'Alpha',
          points: 200,
          rankPoints: 20,
          warningPoints: 1,
          teamId: 'team-ab',
          teammateId: 'student-b',
          pet: {
            type: 'dog',
            fullness: 80,
            happiness: 60,
            level: 2,
          },
          stats: { wins: 1, losses: 0 },
          disciplineRecords: [{
            id: 'discipline-a',
            type: 'warning',
            createdAt: now - 4_000,
            warningCount: 1,
          }],
          pointAdjustmentRecords: [{
            id: 'adjustment-a',
            amount: 10,
            createdAt: now - 3_000,
            source: 'manual',
            reasonLabel: 'Alpha private reason',
          }],
          dailyProgress: {
            streak: 2,
            reflections: [{
              id: 'reflection-a',
              date: '2023-11-14',
              createdAt: now - 2_000,
              competency: 'collaboration',
              author: 'student',
              selfAssessment: 'progressing',
              text: 'Alpha private reflection',
            }],
          },
        },
        {
          id: 'student-b',
          name: 'Beta',
          points: 150,
          rankPoints: 12,
          warningPoints: 0,
          teamId: 'team-ab',
          teammateId: 'student-a',
          pet: {
            type: 'cat',
            fullness: 70,
            happiness: 65,
            level: 2,
          },
          stats: { wins: 0, losses: 1 },
          pointAdjustmentRecords: [{
            id: 'adjustment-b',
            amount: -5,
            createdAt: now - 3_000,
            source: 'manual',
            reasonLabel: 'Beta private reason',
          }],
        },
      ],
      learningEvidenceRecords: [
        {
          id: 'evidence-a',
          classId: 'class-a',
          studentId: 'student-a',
          competency: 'collaboration',
          level: 'progressing',
          evidenceType: 'observation',
          title: 'Alpha private evidence',
          actor: 'mentor',
          source: 'manual',
          rubricVersion: '1.0',
          revision: 1,
          createdAt: now - 2_000,
        },
        {
          id: 'evidence-b',
          classId: 'class-a',
          studentId: 'student-b',
          competency: 'selfManagement',
          level: 'needsSupport',
          evidenceType: 'observation',
          title: 'Beta private evidence',
          actor: 'mentor',
          source: 'manual',
          rubricVersion: '1.0',
          revision: 1,
          createdAt: now - 1_000,
        },
      ],
      examRecords: [{
        id: 'exam-a',
        title: 'Midterm',
        examDate: '2023-11-14',
        items: [{ id: 'math', name: 'Math', maxScore: 100 }],
        results: [
          {
            studentId: 'student-a',
            scores: { math: 88 },
            mentorComment: 'Alpha private comment',
            updatedAt: now,
          },
          {
            studentId: 'student-b',
            scores: { math: 51 },
            mentorComment: 'Beta private comment',
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      }],
      activeBoss: {
        id: 'boss-a',
        name: 'Assessment Boss',
        maxHp: 100,
        currentHp: 50,
        rewardTiers: [],
        contributions: {
          'student-a': 11,
          'student-b': 39,
        },
        attackCounts: {
          'student-a': 1,
          'student-b': 4,
        },
        isActive: true,
      },
    }],
    settings: {
      language: 'zh',
      maxPoints: 700,
    },
  };
};

test('same-origin HttpOnly sessions enforce Origin and double-submit CSRF', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-cookie-test-'));
  const repository = new JsonWorkspaceRepository(join(directory, 'data.json'));
  const handler = createApiHandler(repository, {
    allowLocalWorkspaceIds: true,
    auth: { passwordIterations: 10 },
    registrationEnabled: true,
  });
  const cookieValue = (header: string, name: string) =>
    header.match(new RegExp(`${name}=([^;,\\s]+)`))?.[1] ?? '';
  try {
    const missingOrigin = await handler(new Request(
      'http://localhost/api/v1/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
      },
    ));
    assert.equal(missingOrigin.status, 403);
    assert.deepEqual(await missingOrigin.json(), { error: 'ORIGIN_REQUIRED' });

    const crossOrigin = await handler(new Request(
      'http://localhost/api/v1/auth/login',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://attacker.example.test',
        },
        body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
      },
    ));
    assert.equal(crossOrigin.status, 403);
    assert.deepEqual(await crossOrigin.json(), {
      error: 'ORIGIN_NOT_ALLOWED',
    });

    const register = await handler(new Request(
      'http://localhost/api/v1/auth/register',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          displayName: 'Cookie Owner',
          email: OWNER_EMAIL,
          password: OWNER_PASSWORD,
          workspaceName: 'Cookie Workspace',
          initialWorkspaceData: createState(),
        }),
      },
    ));
    assert.equal(register.status, 201);
    const authBody = await register.json() as {
      session: AuthEnvelope['session'];
      csrfToken: string;
      sessionToken?: string;
    };
    assert.equal(authBody.sessionToken, undefined);
    assert.match(authBody.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    const setCookie = register.headers.get('set-cookie') ?? '';
    assert.match(
      setCookie,
      /__Host-epet_session=[^;]+;[^,]*HttpOnly; Secure; SameSite=Lax/,
    );
    assert.match(setCookie, /__Host-epet_csrf=[^;]+/);
    const sessionCookie = cookieValue(setCookie, '__Host-epet_session');
    const csrfCookie = cookieValue(setCookie, '__Host-epet_csrf');
    const cookie =
      `__Host-epet_session=${sessionCookie}; ` +
      `__Host-epet_csrf=${csrfCookie}`;
    const workspaceId = authBody.session.activeWorkspaceId;
    assert.ok(workspaceId);

    const bearerOnly = await handler(new Request(
      'http://localhost/api/v1/auth/session',
      { headers: { authorization: `Bearer ${sessionCookie}` } },
    ));
    assert.equal(bearerOnly.status, 401);

    const missingCsrf = await handler(new Request(
      'http://localhost/api/v1/state',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: 'http://localhost',
          'x-epet-workspace': workspaceId,
        },
        body: JSON.stringify({ baseRevision: 1, data: createState() }),
      },
    ));
    assert.equal(missingCsrf.status, 403);
    assert.deepEqual(await missingCsrf.json(), { error: 'CSRF_INVALID' });

    const validWrite = await handler(new Request(
      'http://localhost/api/v1/state',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: 'http://localhost',
          'x-csrf-token': authBody.csrfToken,
          'x-epet-workspace': workspaceId,
        },
        body: JSON.stringify({ baseRevision: 1, data: createState() }),
      },
    ));
    assert.equal(validWrite.status, 200);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('authenticated API preserves owner workflows and enforces tenant isolation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-server-test-'));
  const dataFile = join(directory, 'workspaces.json');
  const deliveries: PasswordResetDelivery[] = [];
  const backgroundTasks: Promise<void>[] = [];
  const repository = new JsonWorkspaceRepository(dataFile);
  await repository.put(
    LEGACY_WORKSPACE_ID,
    normalizeAppData(createState()),
    0,
  );
  const request = createRequester(
    createApiHandler(
      repository,
      createHandlerOptions(deliveries, backgroundTasks),
    ),
  );

  try {
    const healthResponse = await request('/api/v1/health');
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      ok: true,
      service: 'epet-api',
      version: 1,
      authenticationEnabled: true,
      registrationEnabled: true,
      invitationEnabled: false,
      emailVerificationEnabled: false,
      lifecycleNotificationsEnabled: false,
      botProtectionEnabled: false,
    });

    const preflightResponse = await request('/api/v1/state', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://teacher.example.test',
      },
    });
    assert.equal(preflightResponse.status, 204);
    assert.match(
      preflightResponse.headers.get('access-control-allow-headers') ?? '',
      /x-csrf-token/,
    );

    const anonymousRead = await request('/api/v1/state', {
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(anonymousRead.status, 401);

    const anonymousWrite = await request('/api/v1/state', {
      method: 'PUT',
      workspaceId: LEGACY_WORKSPACE_ID,
      body: JSON.stringify({
        baseRevision: 1,
        data: createState(),
      }),
    });
    assert.equal(anonymousWrite.status, 401);
    assert.equal((await repository.get(LEGACY_WORKSPACE_ID)).revision, 1);

    const registerResponse = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Owner Teacher',
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        workspaceName: 'Owner Homeroom',
        initialWorkspaceData: createState(),
        legacyWorkspaceId: LEGACY_WORKSPACE_ID,
      }),
    });
    assert.equal(registerResponse.status, 201);
    const owner = await registerResponse.json() as AuthEnvelope;
    assert.ok(owner.sessionToken.length >= 20);
    assert.equal(owner.session.user.role, 'owner');
    assert.equal(owner.session.activeWorkspaceId, LEGACY_WORKSPACE_ID);
    assert.deepEqual(owner.legacyClaim, {
      status: 'claimed',
      workspaceId: LEGACY_WORKSPACE_ID,
    });

    const sessionResponse = await request('/api/v1/auth/session', {
      sessionToken: owner.sessionToken,
    });
    assert.equal(sessionResponse.status, 200);
    const sessionBody = await sessionResponse.json() as {
      session: AuthEnvelope['session'];
    };
    assert.equal(sessionBody.session.user.email, OWNER_EMAIL);
    assert.equal(
      sessionBody.session.activeWorkspaceId,
      LEGACY_WORKSPACE_ID,
    );

    const initialStateResponse = await request('/api/v1/state', {
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(initialStateResponse.status, 200);
    const initialState = await initialStateResponse.json() as {
      revision: number;
      data: ReturnType<typeof createState>;
    };
    assert.equal(initialState.revision, 1);
    assert.equal(initialState.data.classes[0].students[0].points, 200);

    const initialSaveResponse = await request('/api/v1/state', {
      method: 'PUT',
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
      headers: {
        'x-request-id': 'test-state-save',
      },
      body: JSON.stringify({
        baseRevision: initialState.revision,
        data: createState(),
      }),
    });
    assert.equal(initialSaveResponse.status, 200);
    const initialSave = await initialSaveResponse.json() as {
      revision: number;
      data: ReturnType<typeof createState>;
    };
    assert.equal(initialSave.revision, 2);

    const evidenceResponse = await request(
      '/api/v1/classes/class-a/evidence',
      {
        method: 'POST',
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
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
      },
    );
    assert.equal(evidenceResponse.status, 201);
    const evidenceResult = await evidenceResponse.json() as {
      revision: number;
      record: { source: string; rubricVersion: string };
    };
    assert.equal(evidenceResult.revision, 3);
    assert.equal(evidenceResult.record.source, 'manual');
    assert.equal(evidenceResult.record.rubricVersion, '1.0');

    const invalidEvidenceResponse = await request(
      '/api/v1/classes/class-a/evidence',
      {
        method: 'POST',
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
        body: JSON.stringify({
          studentId: 'student-a',
          input: {
            competency: 'not-a-competency',
            level: 'mastered',
            evidenceType: 'observation',
            title: 'Invalid evidence',
          },
        }),
      },
    );
    assert.equal(invalidEvidenceResponse.status, 400);

    const classAnalyticsResponse = await request(
      '/api/v1/classes/class-a/analytics?windowDays=28',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
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
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
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

    const persistedResponse = await request('/api/v1/state', {
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    const persisted = await persistedResponse.json() as {
      revision: number;
      data: ReturnType<typeof createState>;
    };
    assert.equal(persisted.revision, 3);
    assert.equal(
      persisted.data.classes[0].learningEvidenceRecords.length,
      1,
    );

    const staleResponse = await request('/api/v1/state', {
      method: 'PUT',
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
      body: JSON.stringify({
        baseRevision: 1,
        data: persisted.data,
      }),
    });
    assert.equal(staleResponse.status, 409);
    const staleBody = await staleResponse.json() as {
      error: string;
      current: { revision: number };
    };
    assert.equal(staleBody.error, 'REVISION_CONFLICT');
    assert.equal(staleBody.current.revision, 3);

    const concurrentPayload = JSON.stringify({
      baseRevision: persisted.revision,
      data: persisted.data,
    });
    const concurrentResponses = await Promise.all([
      request('/api/v1/state', {
        method: 'PUT',
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
        body: concurrentPayload,
      }),
      request('/api/v1/state', {
        method: 'PUT',
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
        body: concurrentPayload,
      }),
    ]);
    assert.deepEqual(
      concurrentResponses.map((response) => response.status).sort(),
      [200, 409],
    );

    const bossResponse = await request('/api/v1/boss/resolve', {
      method: 'POST',
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
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
          participationReward: {
            points: 5,
            happiness: 2,
            rankPoints: 3,
          },
          improvementReward: {
            points: 0,
            happiness: 0,
            rankPoints: 0,
          },
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

    const secondRegisterResponse = await request(
      '/api/v1/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Second Owner',
          email: 'second-owner@example.test',
          password: 'second owner secure password',
          workspaceName: 'Second Homeroom',
          initialWorkspaceData: createState(),
          legacyWorkspaceId: LEGACY_WORKSPACE_ID,
        }),
      },
    );
    assert.equal(secondRegisterResponse.status, 201);
    const secondOwner =
      await secondRegisterResponse.json() as AuthEnvelope;
    assert.equal(secondOwner.legacyClaim?.status, 'failed');
    assert.equal(
      secondOwner.legacyClaim?.error,
      'WORKSPACE_ALREADY_CLAIMED',
    );
    assert.notEqual(
      secondOwner.session.activeWorkspaceId,
      LEGACY_WORKSPACE_ID,
    );
    const secondWorkspaceId = secondOwner.session.activeWorkspaceId;
    assert.ok(secondWorkspaceId);

    const crossTenantRead = await request('/api/v1/state', {
      sessionToken: owner.sessionToken,
      workspaceId: secondWorkspaceId,
    });
    assert.equal(crossTenantRead.status, 403);

    const crossTenantWrite = await request('/api/v1/state', {
      method: 'PUT',
      sessionToken: owner.sessionToken,
      workspaceId: secondWorkspaceId,
      body: JSON.stringify({
        baseRevision: 1,
        data: createState(),
      }),
    });
    assert.equal(crossTenantWrite.status, 403);

    const reverseCrossTenantRead = await request('/api/v1/state', {
      sessionToken: secondOwner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(reverseCrossTenantRead.status, 403);

    const privacyExportResponse = await request(
      '/api/v1/privacy/export',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
    );
    assert.equal(privacyExportResponse.status, 200);
    const privacyExport = await privacyExportResponse.json() as {
      user: { id: string; email: string };
      activeWorkspace: {
        id: string;
        role: string;
        state: ReturnType<typeof createState>;
      };
      revision: {
        current: number;
        history: Array<{ actorUserId?: string }>;
      };
      exportedAt: string;
    };
    assert.equal(privacyExport.user.email, OWNER_EMAIL);
    assert.equal(
      privacyExport.activeWorkspace.id,
      LEGACY_WORKSPACE_ID,
    );
    assert.equal(privacyExport.activeWorkspace.role, 'owner');
    assert.equal(privacyExport.revision.current, 4);
    assert.ok(
      privacyExport.revision.history.some(
        (revision) =>
          revision.actorUserId === privacyExport.user.id,
      ),
    );
    assert.ok(Number.isFinite(Date.parse(privacyExport.exportedAt)));

    const missingForgotResponse = await request(
      '/api/v1/auth/password/forgot',
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'missing@example.test',
        }),
      },
    );
    assert.equal(missingForgotResponse.status, 202);
    assert.deepEqual(await missingForgotResponse.json(), {
      accepted: true,
    });
    assert.equal(deliveries.length, 0);

    const existingForgotResponse = await request(
      '/api/v1/auth/password/forgot',
      {
        method: 'POST',
        body: JSON.stringify({ email: OWNER_EMAIL }),
      },
    );
    assert.equal(existingForgotResponse.status, 202);
    assert.deepEqual(await existingForgotResponse.json(), {
      accepted: true,
    });
    await Promise.all(backgroundTasks);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].email, OWNER_EMAIL);

    const resetResponse = await request(
      '/api/v1/auth/password/reset',
      {
        method: 'POST',
        body: JSON.stringify({
          token: deliveries[0].token,
          password: NEW_OWNER_PASSWORD,
        }),
      },
    );
    assert.equal(resetResponse.status, 200);

    const reusedResetResponse = await request(
      '/api/v1/auth/password/reset',
      {
        method: 'POST',
        body: JSON.stringify({
          token: deliveries[0].token,
          password: 'another replacement password',
        }),
      },
    );
    assert.equal(reusedResetResponse.status, 400);
    assert.deepEqual(await reusedResetResponse.json(), {
      error: 'INVALID_PASSWORD_RESET_TOKEN',
    });

    const revokedSessionResponse = await request(
      '/api/v1/auth/session',
      {
        sessionToken: owner.sessionToken,
      },
    );
    assert.equal(revokedSessionResponse.status, 401);

    const revokedWorkspaceResponse = await request('/api/v1/state', {
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(revokedWorkspaceResponse.status, 401);

    const oldPasswordLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
      }),
    });
    assert.equal(oldPasswordLogin.status, 401);

    const newPasswordLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: OWNER_EMAIL,
        password: NEW_OWNER_PASSWORD,
      }),
    });
    assert.equal(newPasswordLogin.status, 200);
    const renewedOwner =
      await newPasswordLogin.json() as AuthEnvelope;

    const renewedStateResponse = await request('/api/v1/state', {
      sessionToken: renewedOwner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(renewedStateResponse.status, 200);

    const logoutResponse = await request('/api/v1/auth/logout', {
      method: 'POST',
      sessionToken: renewedOwner.sessionToken,
    });
    assert.equal(logoutResponse.status, 204);

    const loggedOutSessionResponse = await request(
      '/api/v1/auth/session',
      {
        sessionToken: renewedOwner.sessionToken,
      },
    );
    assert.equal(loggedOutSessionResponse.status, 401);

    const oversizedAuthResponse = await request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({
          email: `${'x'.repeat(17_000)}@example.test`,
          password: 'irrelevant password',
        }),
      },
    );
    assert.equal(oversizedAuthResponse.status, 413);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('teacher and viewer state access is limited to assigned classes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-class-scope-test-'));
  const dataFile = join(directory, 'workspaces.json');
  const repository = new JsonWorkspaceRepository(dataFile);
  await repository.put(
    LEGACY_WORKSPACE_ID,
    normalizeAppData(createTwoClassState()),
    0,
  );
  const options = createHandlerOptions([]);
  const ownerRequest = createRequester(createApiHandler(repository, options));

  try {
    const registration = await ownerRequest('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Scoped Owner',
        email: 'scoped-owner@example.test',
        password: 'scoped owner secure password',
        workspaceName: 'Scoped Homeroom',
        initialWorkspaceData: createState(),
        legacyWorkspaceId: LEGACY_WORKSPACE_ID,
      }),
    });
    assert.equal(registration.status, 201);
    const owner = await registration.json() as AuthEnvelope;
    assert.equal(owner.legacyClaim?.status, 'claimed');

    const teacherRequest = createRequester(createApiHandler(
      createRoleScopedRepository(repository, 'teacher', ['class-a']),
      options,
    ));
    const viewerRequest = createRequester(createApiHandler(
      createRoleScopedRepository(repository, 'viewer', ['class-a']),
      options,
    ));
    const unassignedTeacherRequest = createRequester(createApiHandler(
      createRoleScopedRepository(repository, 'teacher'),
      options,
    ));

    const teacherStateResponse = await teacherRequest('/api/v1/state', {
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(teacherStateResponse.status, 200);
    const teacherState = await teacherStateResponse.json() as {
      revision: number;
      data: ReturnType<typeof createTwoClassState>;
    };
    assert.deepEqual(
      teacherState.data.classes.map((classData) => classData.id),
      ['class-a'],
    );

    const viewerStateResponse = await viewerRequest('/api/v1/state', {
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(viewerStateResponse.status, 200);
    const viewerState = await viewerStateResponse.json() as {
      data: ReturnType<typeof createTwoClassState>;
    };
    assert.deepEqual(
      viewerState.data.classes.map((classData) => classData.id),
      ['class-a'],
    );

    const unassignedStateResponse = await unassignedTeacherRequest(
      '/api/v1/state',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
    );
    assert.equal(unassignedStateResponse.status, 403);

    const teacherUpdate = structuredClone(teacherState.data);
    teacherUpdate.classes[0].students[0].points = 333;
    const teacherUpdateResponse = await teacherRequest('/api/v1/state', {
      method: 'PUT',
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
      body: JSON.stringify({
        baseRevision: teacherState.revision,
        data: teacherUpdate,
      }),
    });
    assert.equal(teacherUpdateResponse.status, 200);
    const teacherSaved = await teacherUpdateResponse.json() as {
      revision: number;
      data: ReturnType<typeof createTwoClassState>;
    };
    assert.deepEqual(
      teacherSaved.data.classes.map((classData) => classData.id),
      ['class-a'],
    );
    assert.equal(teacherSaved.data.classes[0].students[0].points, 333);
    const fullAfterTeacherSave = await repository.get(LEGACY_WORKSPACE_ID);
    assert.equal(
      fullAfterTeacherSave.data?.classes.find(
        (classData) => classData.id === 'class-b',
      )?.students[0].points,
      90,
    );

    const staleResponse = await teacherRequest('/api/v1/state', {
      method: 'PUT',
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
      body: JSON.stringify({
        baseRevision: teacherState.revision,
        data: teacherUpdate,
      }),
    });
    assert.equal(staleResponse.status, 409);
    const staleBody = await staleResponse.json() as {
      current: { data: ReturnType<typeof createTwoClassState> };
    };
    assert.deepEqual(
      staleBody.current.data.classes.map((classData) => classData.id),
      ['class-a'],
    );

    const settingsAttack = structuredClone(teacherSaved.data);
    settingsAttack.settings = {
      ...settingsAttack.settings,
      maxPoints: 9_999,
    } as typeof settingsAttack.settings;
    const settingsAttackResponse = await teacherRequest('/api/v1/state', {
      method: 'PUT',
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
      body: JSON.stringify({
        baseRevision: teacherSaved.revision,
        data: settingsAttack,
      }),
    });
    assert.equal(settingsAttackResponse.status, 403);

    const classInjection = structuredClone(teacherSaved.data);
    classInjection.classes.push(createTwoClassState().classes[1]);
    const classInjectionResponse = await teacherRequest('/api/v1/state', {
      method: 'PUT',
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
      body: JSON.stringify({
        baseRevision: teacherSaved.revision,
        data: classInjection,
      }),
    });
    assert.equal(classInjectionResponse.status, 403);

    const viewerWriteResponse = await viewerRequest('/api/v1/state', {
      method: 'PUT',
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
      body: JSON.stringify({
        baseRevision: teacherSaved.revision,
        data: teacherSaved.data,
      }),
    });
    assert.equal(viewerWriteResponse.status, 403);

    const assignedAnalytics = await viewerRequest(
      '/api/v1/classes/class-a/analytics',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
    );
    assert.equal(assignedAnalytics.status, 200);
    const unassignedAnalytics = await viewerRequest(
      '/api/v1/classes/class-b/analytics',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
    );
    assert.equal(unassignedAnalytics.status, 403);

    const assignedEvidence = await teacherRequest(
      '/api/v1/classes/class-a/evidence',
      {
        method: 'POST',
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
        body: JSON.stringify({
          studentId: 'student-a',
          input: {
            competency: 'collaboration',
            level: 'progressing',
            evidenceType: 'observation',
            title: 'Assigned class evidence',
          },
        }),
      },
    );
    assert.equal(assignedEvidence.status, 201);
    const unassignedEvidence = await teacherRequest(
      '/api/v1/classes/class-b/evidence',
      {
        method: 'POST',
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
        body: JSON.stringify({
          studentId: 'student-b',
          input: {
            competency: 'collaboration',
            level: 'progressing',
            evidenceType: 'observation',
            title: 'Unassigned class evidence',
          },
        }),
      },
    );
    assert.equal(unassignedEvidence.status, 403);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('health reports when public registration is disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-health-test-'));
  const dataFile = join(directory, 'workspaces.json');
  const deliveries: PasswordResetDelivery[] = [];
  const repository = new JsonWorkspaceRepository(dataFile);
  const request = createRequester(createApiHandler(repository, {
    ...createHandlerOptions(deliveries),
    registrationEnabled: false,
  }));

  try {
    const response = await request('/api/v1/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: 'epet-api',
      version: 1,
      authenticationEnabled: true,
      registrationEnabled: false,
      invitationEnabled: false,
      emailVerificationEnabled: false,
      lifecycleNotificationsEnabled: false,
      botProtectionEnabled: false,
    });

    const registrationResponse = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Disabled Registration',
        email: 'disabled@example.test',
        password: 'disabled registration password',
        workspaceName: 'Disabled Workspace',
      }),
    });
    assert.equal(registrationResponse.status, 403);
    assert.deepEqual(await registrationResponse.json(), {
      error: 'REGISTRATION_DISABLED',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('email verification and bot protection fail closed without exposing raw tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-verification-test-'));
  const dataFile = join(directory, 'workspaces.json');
  const passwordDeliveries: PasswordResetDelivery[] = [];
  const verificationDeliveries: EmailVerificationDelivery[] = [];
  const lifecycleDeliveries: AccountLifecycleDelivery[] = [];
  const botChecks: Array<{
    token: string;
    action: string;
    remoteIp?: string;
    expectedHostname: string;
  }> = [];
  const backgroundTasks: Promise<void>[] = [];
  const repository = new JsonWorkspaceRepository(dataFile);
  const request = createRequester(createApiHandler(repository, {
    ...createHandlerOptions(passwordDeliveries, backgroundTasks),
    accountLifecycleMailer: async (delivery) => {
      lifecycleDeliveries.push(delivery);
    },
    botChallengeVerifier: async (input) => {
      botChecks.push(input);
      return input.token === `${input.action}-ok`;
    },
    botProtectionRequired: true,
    clientIp: () => '198.51.100.42',
    emailVerificationMailer: async (delivery) => {
      verificationDeliveries.push(delivery);
    },
    emailVerificationRequired: true,
    turnstileSiteKey: 'test-site-key',
  }));

  try {
    const health = await request('/api/v1/health');
    assert.deepEqual(await health.json(), {
      ok: true,
      service: 'epet-api',
      version: 1,
      authenticationEnabled: true,
      registrationEnabled: true,
      invitationEnabled: false,
      emailVerificationEnabled: true,
      lifecycleNotificationsEnabled: true,
      botProtectionEnabled: true,
      turnstileSiteKey: 'test-site-key',
    });

    const missingChallenge = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Verified Owner',
        email: 'verified-owner@example.test',
        password: OWNER_PASSWORD,
        workspaceName: 'Verified Workspace',
      }),
    });
    assert.equal(missingChallenge.status, 403);
    assert.deepEqual(await missingChallenge.json(), {
      error: 'BOT_CHALLENGE_FAILED',
    });

    const registration = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Verified Owner',
        email: 'verified-owner@example.test',
        password: OWNER_PASSWORD,
        workspaceName: 'Verified Workspace',
        turnstileToken: 'register-ok',
      }),
    });
    assert.equal(registration.status, 201);
    const owner = await registration.json() as AuthEnvelope;
    assert.equal(owner.session.user.emailVerified, false);
    assert.equal('emailVerification' in owner, false);
    assert.ok(owner.session.activeWorkspaceId);
    await Promise.all(backgroundTasks);
    assert.equal(verificationDeliveries.length, 1);
    const firstToken = verificationDeliveries[0].token;
    assert.equal((await readFile(dataFile, 'utf8')).includes(firstToken), false);

    const blockedWorkspaceRead = await request('/api/v1/state', {
      sessionToken: owner.sessionToken,
      workspaceId: owner.session.activeWorkspaceId ?? undefined,
    });
    assert.equal(blockedWorkspaceRead.status, 403);
    assert.deepEqual(await blockedWorkspaceRead.json(), {
      error: 'EMAIL_VERIFICATION_REQUIRED',
    });

    const loginWithoutChallenge = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'verified-owner@example.test',
        password: OWNER_PASSWORD,
      }),
    });
    assert.equal(loginWithoutChallenge.status, 403);

    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'verified-owner@example.test',
        password: OWNER_PASSWORD,
        turnstileToken: 'login-ok',
      }),
    });
    assert.equal(login.status, 200);

    const forgotWithoutChallenge = await request(
      '/api/v1/auth/password/forgot',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'verified-owner@example.test' }),
      },
    );
    assert.equal(forgotWithoutChallenge.status, 403);

    const forgot = await request('/api/v1/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({
        email: 'verified-owner@example.test',
        turnstileToken: 'forgot-ok',
      }),
    });
    assert.equal(forgot.status, 202);

    const resend = await request('/api/v1/auth/email/resend', {
      method: 'POST',
      sessionToken: owner.sessionToken,
    });
    assert.equal(resend.status, 202);
    await Promise.all(backgroundTasks);
    assert.equal(verificationDeliveries.length, 2);
    const currentToken = verificationDeliveries[1].token;
    assert.notEqual(currentToken, firstToken);

    const invalidated = await request('/api/v1/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ token: firstToken }),
    });
    assert.equal(invalidated.status, 400);

    const verified = await request('/api/v1/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ token: currentToken }),
    });
    assert.equal(verified.status, 200);
    const replayed = await request('/api/v1/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ token: currentToken }),
    });
    assert.equal(replayed.status, 400);

    await Promise.all(backgroundTasks);
    assert.ok(lifecycleDeliveries.some(
      (delivery) => delivery.kind === 'email_verified' &&
        delivery.email === 'verified-owner@example.test',
    ));
    const session = await request('/api/v1/auth/session', {
      sessionToken: owner.sessionToken,
    });
    assert.equal(session.status, 200);
    const sessionBody = await session.json() as { session: AuthEnvelope['session'] };
    assert.equal(sessionBody.session.user.emailVerified, true);
    const allowedWorkspaceRead = await request('/api/v1/state', {
      sessionToken: owner.sessionToken,
      workspaceId: owner.session.activeWorkspaceId ?? undefined,
    });
    assert.equal(allowedWorkspaceRead.status, 200);

    assert.equal(passwordDeliveries.length, 1);
    const passwordReset = await request('/api/v1/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({
        token: passwordDeliveries[0].token,
        password: 'replacement owner password',
      }),
    });
    assert.equal(passwordReset.status, 200);
    await Promise.all(backgroundTasks);
    assert.ok(lifecycleDeliveries.some(
      (delivery) => delivery.kind === 'password_changed',
    ));

    assert.deepEqual(
      botChecks.map(({ action, remoteIp, expectedHostname }) => ({
        action,
        remoteIp,
        expectedHostname,
      })),
      [
        { action: 'register', remoteIp: '198.51.100.42', expectedHostname: 'localhost' },
        { action: 'login', remoteIp: '198.51.100.42', expectedHostname: 'localhost' },
        { action: 'forgot', remoteIp: '198.51.100.42', expectedHostname: 'localhost' },
      ],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Turnstile Siteverify pins secret, action, hostname, and remote IP', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let siteverifyResult: Record<string, unknown> = {
    success: true,
    action: 'register',
    hostname: 'teacher.example.test',
  };
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Response.json(siteverifyResult);
  }) as typeof fetch;

  try {
    assert.equal(createTurnstileVerifier({}), undefined);
    const verifier = createTurnstileVerifier({
      TURNSTILE_SECRET_KEY: 'server-only-secret',
    });
    assert.ok(verifier);
    assert.equal(await verifier({
      token: 'browser-challenge-token',
      action: 'register',
      remoteIp: '198.51.100.45',
      expectedHostname: 'teacher.example.test',
    }), true);
    assert.equal(
      requests[0].url,
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    assert.equal(requests[0].body.secret, 'server-only-secret');
    assert.equal(requests[0].body.response, 'browser-challenge-token');
    assert.equal(requests[0].body.remoteip, '198.51.100.45');
    assert.match(String(requests[0].body.idempotency_key), /^[0-9a-f-]{36}$/i);

    siteverifyResult = {
      success: true,
      action: 'login',
      hostname: 'teacher.example.test',
    };
    assert.equal(await verifier({
      token: 'wrong-action-token',
      action: 'register',
      expectedHostname: 'teacher.example.test',
    }), false);
    siteverifyResult = {
      success: true,
      action: 'register',
      hostname: 'attacker.example.test',
    };
    assert.equal(await verifier({
      token: 'wrong-hostname-token',
      action: 'register',
      expectedHostname: 'teacher.example.test',
    }), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verification and lifecycle mailers use fragment links and idempotency keys', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (_input, init) => {
    requests.push({
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(null, { status: 202 });
  }) as typeof fetch;

  try {
    const env = {
      RESEND_API_KEY: 'resend-test-key',
      PASSWORD_RESET_FROM: 'ePet <security@example.test>',
      PUBLIC_APP_URL: 'https://teacher.example.test/',
    };
    const verificationMailer = createEmailVerificationMailer(env);
    const lifecycleMailer = createAccountLifecycleMailer(env);
    assert.ok(verificationMailer);
    assert.ok(lifecycleMailer);
    await verificationMailer({
      email: 'owner@example.test',
      displayName: 'Owner <Teacher>',
      token: 'verification_token-_123',
      expiresAt: Date.now() + 3_600_000,
    });
    await lifecycleMailer({
      eventId: 'mail_event_123',
      kind: 'ownership_received',
      email: 'owner@example.test',
      displayName: 'Owner <Teacher>',
      occurredAt: 1_800_000_000_000,
      workspaceName: '安全班級',
      previousRole: 'teacher',
      role: 'owner',
    });

    assert.match(
      String(requests[0].body.text),
      /https:\/\/teacher\.example\.test\/#\/verify-email\?token=/,
    );
    assert.doesNotMatch(
      String(requests[0].body.text),
      /teacher\.example\.test\/\?token=/,
    );
    assert.match(
      requests[0].headers.get('idempotency-key') ?? '',
      /^epet-email-verification-[A-Za-z0-9_-]{43}$/,
    );
    assert.equal(
      requests[1].headers.get('idempotency-key'),
      'epet-lifecycle-mail_event_123',
    );
    assert.match(String(requests[1].body.subject), /擁有者/);
    assert.doesNotMatch(String(requests[1].body.text), /學生|成績|評語/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('workspace invitations and destructive lifecycle operations enforce ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-lifecycle-test-'));
  const dataFile = join(directory, 'workspaces.json');
  const backgroundTasks: Promise<void>[] = [];
  const invitationDeliveries: WorkspaceInvitationDelivery[] = [];
  const lifecycleDeliveries: AccountLifecycleDelivery[] = [];
  const repository = new JsonWorkspaceRepository(dataFile);
  const request = createRequester(createApiHandler(repository, {
    ...createHandlerOptions([], backgroundTasks),
    accountLifecycleMailer: async (delivery) => {
      lifecycleDeliveries.push(delivery);
    },
    workspaceInvitationMailer: async (delivery) => {
      invitationDeliveries.push(delivery);
    },
  }));

  try {
    const registration = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Lifecycle Owner',
        email: 'lifecycle-owner@example.test',
        password: OWNER_PASSWORD,
        workspaceName: 'Lifecycle Workspace',
        initialWorkspaceData: createTwoClassState(),
      }),
    });
    assert.equal(registration.status, 201);
    const owner = await registration.json() as AuthEnvelope;
    const workspaceId = owner.session.activeWorkspaceId;
    assert.ok(workspaceId);

    const inviteResponse = await request('/api/v1/invitations', {
      method: 'POST',
      sessionToken: owner.sessionToken,
      workspaceId,
      body: JSON.stringify({
        email: 'invited-teacher@example.test',
        role: 'teacher',
        classIds: ['class-a'],
      }),
    });
    assert.equal(inviteResponse.status, 202);

    const revokedInviteResponse = await request('/api/v1/invitations', {
      method: 'POST',
      sessionToken: owner.sessionToken,
      workspaceId,
      body: JSON.stringify({
        email: 'revoked-viewer@example.test',
        role: 'viewer',
        classIds: ['class-b'],
      }),
    });
    assert.equal(revokedInviteResponse.status, 202);
    await Promise.all(backgroundTasks);
    assert.equal(invitationDeliveries.length, 2);

    const invitationsResponse = await request('/api/v1/invitations', {
      sessionToken: owner.sessionToken,
      workspaceId,
    });
    assert.equal(invitationsResponse.status, 200);
    const invitationList = await invitationsResponse.json() as {
      invitations: Array<{
        id: string;
        email: string;
        tokenHash?: string;
      }>;
    };
    assert.ok(invitationList.invitations.every(
      (invitation) => invitation.tokenHash === undefined,
    ));
    const revokedInvitation = invitationList.invitations.find(
      (invitation) => invitation.email === 'revoked-viewer@example.test',
    );
    assert.ok(revokedInvitation);
    const revokeResponse = await request(
      `/api/v1/invitations/${revokedInvitation.id}`,
      {
        method: 'DELETE',
        sessionToken: owner.sessionToken,
        workspaceId,
      },
    );
    assert.equal(revokeResponse.status, 200);
    const revokedDelivery = invitationDeliveries.find(
      (delivery) => delivery.email === 'revoked-viewer@example.test',
    );
    assert.ok(revokedDelivery);
    const revokedAcceptance = await request(
      '/api/v1/auth/invitations/accept',
      {
        method: 'POST',
        body: JSON.stringify({
          token: revokedDelivery.token,
          displayName: 'Revoked Viewer',
          password: 'revoked viewer secure password',
        }),
      },
    );
    assert.equal(revokedAcceptance.status, 400);

    const invitationDelivery = invitationDeliveries.find(
      (delivery) => delivery.email === 'invited-teacher@example.test',
    );
    assert.ok(invitationDelivery);
    const acceptance = await request('/api/v1/auth/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({
        token: invitationDelivery.token,
        displayName: 'Invited Teacher',
        password: 'invited teacher secure password',
      }),
    });
    assert.equal(acceptance.status, 201);
    const invited = await acceptance.json() as AuthEnvelope;
    assert.equal(invited.session.user.role, 'teacher');
    assert.equal(invited.session.activeWorkspaceId, workspaceId);

    const reusedAcceptance = await request('/api/v1/auth/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({
        token: invitationDelivery.token,
        displayName: 'Invited Teacher',
        password: 'invited teacher secure password',
      }),
    });
    assert.equal(reusedAcceptance.status, 400);

    const membersResponse = await request('/api/v1/members', {
      sessionToken: owner.sessionToken,
      workspaceId,
    });
    assert.equal(membersResponse.status, 200);
    const membersBody = await membersResponse.json() as {
      members: Array<{ userId: string; email: string; role: string }>;
    };
    const invitedMember = membersBody.members.find(
      (member) => member.email === 'invited-teacher@example.test',
    );
    assert.ok(invitedMember);

    const emptyScope = await request(
      `/api/v1/members/${invitedMember.userId}`,
      {
        method: 'PATCH',
        sessionToken: owner.sessionToken,
        workspaceId,
        body: JSON.stringify({ role: 'viewer', classIds: [] }),
      },
    );
    assert.equal(emptyScope.status, 400);
    const updateMember = await request(
      `/api/v1/members/${invitedMember.userId}`,
      {
        method: 'PATCH',
        sessionToken: owner.sessionToken,
        workspaceId,
        body: JSON.stringify({ role: 'viewer', classIds: ['class-b'] }),
      },
    );
    assert.equal(updateMember.status, 200);

    const viewerMembers = await request('/api/v1/members', {
      sessionToken: invited.sessionToken,
      workspaceId,
    });
    assert.equal(viewerMembers.status, 403);

    const transfer = await request(
      `/api/v1/members/${invitedMember.userId}/transfer-ownership`,
      {
        method: 'POST',
        sessionToken: owner.sessionToken,
        workspaceId,
      },
    );
    assert.equal(transfer.status, 200);

    const removePreviousOwner = await request(
      `/api/v1/members/${owner.session.user.id}`,
      {
        method: 'DELETE',
        sessionToken: invited.sessionToken,
        workspaceId,
      },
    );
    assert.equal(removePreviousOwner.status, 200);
    const deletePreviousOwner = await request('/api/v1/account', {
      method: 'DELETE',
      sessionToken: owner.sessionToken,
      body: JSON.stringify({ password: OWNER_PASSWORD, confirmation: 'DELETE' }),
    });
    assert.equal(deletePreviousOwner.status, 204);
    assert.equal((await request('/api/v1/auth/session', {
      sessionToken: owner.sessionToken,
    })).status, 401);

    const wrongWorkspaceConfirmation = await request('/api/v1/workspace', {
      method: 'DELETE',
      sessionToken: invited.sessionToken,
      workspaceId,
      body: JSON.stringify({
        password: 'invited teacher secure password',
        confirmation: 'wrong name',
      }),
    });
    assert.equal(wrongWorkspaceConfirmation.status, 400);
    const deleteWorkspace = await request('/api/v1/workspace', {
      method: 'DELETE',
      sessionToken: invited.sessionToken,
      workspaceId,
      body: JSON.stringify({
        password: 'invited teacher secure password',
        confirmation: 'Lifecycle Workspace',
      }),
    });
    assert.equal(deleteWorkspace.status, 200);
    const deletedSession = await request('/api/v1/auth/session', {
      sessionToken: invited.sessionToken,
    });
    assert.equal(deletedSession.status, 200);
    assert.deepEqual(
      (await deletedSession.json() as { session: AuthEnvelope['session'] })
        .session.workspaces,
      [],
    );
    const recreateWorkspace = await request('/api/v1/workspaces', {
      method: 'POST',
      sessionToken: invited.sessionToken,
      body: JSON.stringify({ name: 'Recreated Workspace' }),
    });
    assert.equal(recreateWorkspace.status, 201);
    const recreated = await recreateWorkspace.json() as {
      session: AuthEnvelope['session'];
    };
    assert.equal(recreated.session.workspaces.length, 1);
    assert.equal(recreated.session.workspaces[0].name, 'Recreated Workspace');
    assert.equal(recreated.session.workspaces[0].role, 'owner');
    await Promise.all(backgroundTasks);
    assert.deepEqual(
      lifecycleDeliveries.map((delivery) => delivery.kind),
      [
        'workspace_joined',
        'workspace_role_changed',
        'ownership_transferred',
        'ownership_received',
        'workspace_removed',
        'account_deleted',
        'workspace_deleted',
      ],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Node server requires explicit registration opt-in and ignores spoofed client IP headers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-node-security-test-'));
  const dataFile = join(directory, 'workspaces.json');
  const distDirectory = join(directory, 'missing-dist');
  const disabled = createEpetServer({
    dataFile,
    distDirectory,
    auth: { passwordIterations: 10 },
    forgotResponseFloorMs: 5,
  });
  let enabled: ReturnType<typeof createEpetServer> | undefined;

  try {
    const disabledBaseUrl = await listenForTest(disabled.server);
    const registrationBody = {
      displayName: 'Node Pilot Owner',
      email: 'node-owner@example.test',
      password: 'a secure node pilot password',
      workspaceName: 'Node Pilot',
    };
    const disabledResponse = await fetch(
      `${disabledBaseUrl}/api/v1/auth/register`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: disabledBaseUrl,
        },
        body: JSON.stringify(registrationBody),
      },
    );
    assert.equal(disabledResponse.status, 403);
    assert.deepEqual(await disabledResponse.json(), {
      error: 'REGISTRATION_DISABLED',
    });
    await closeTestServer(disabled.server);

    enabled = createEpetServer({
      dataFile,
      distDirectory,
      auth: { passwordIterations: 10 },
      forgotResponseFloorMs: 5,
      registrationEnabled: true,
    });
    const enabledBaseUrl = await listenForTest(enabled.server);
    const enabledResponse = await fetch(
      `${enabledBaseUrl}/api/v1/auth/register`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: enabledBaseUrl,
        },
        body: JSON.stringify(registrationBody),
      },
    );
    assert.equal(enabledResponse.status, 201);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${enabledBaseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'cf-connecting-ip': `198.51.100.${attempt + 1}`,
          'content-type': 'application/json',
          origin: enabledBaseUrl,
          'x-epet-transport-client': `spoof-${attempt}`,
          'x-forwarded-for': `203.0.113.${attempt + 1}`,
          'x-real-ip': `192.0.2.${attempt + 1}`,
        },
        body: JSON.stringify({
          email: `rotating-${attempt}@example.test`,
          password: 'an invalid password',
        }),
      });
      assert.equal(response.status, 401);
    }
    const globallyBlocked = await fetch(
      `${enabledBaseUrl}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '203.0.113.250',
          'content-type': 'application/json',
          origin: enabledBaseUrl,
          'x-epet-transport-client': 'spoof-final',
          'x-forwarded-for': '203.0.113.251',
          'x-real-ip': '203.0.113.252',
        },
        body: JSON.stringify({
          email: 'rotating-final@example.test',
          password: 'an invalid password',
        }),
      },
    );
    assert.equal(globallyBlocked.status, 429);
  } finally {
    await closeTestServer(disabled.server);
    if (enabled) await closeTestServer(enabled.server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('forgot responses share a floor and do not wait for email delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-forgot-timing-test-'));
  const dataFile = join(directory, 'workspaces.json');
  const repository = new JsonWorkspaceRepository(dataFile);
  const backgroundTasks: Promise<void>[] = [];
  let releaseMailer = () => undefined;
  const mailerGate = new Promise<void>((resolve) => {
    releaseMailer = resolve;
  });
  let mailerStarted = false;
  const request = createRequester(createApiHandler(repository, {
    ...createHandlerOptions([]),
    deferBackgroundTask: (task) => backgroundTasks.push(task),
    forgotResponseFloorMs: 40,
    passwordResetMailer: async () => {
      mailerStarted = true;
      await mailerGate;
    },
  }));

  try {
    const registration = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Timing Owner',
        email: 'timing-owner@example.test',
        password: 'a secure timing owner password',
        workspaceName: 'Timing Workspace',
      }),
    });
    assert.equal(registration.status, 201);

    const missingStartedAt = performance.now();
    const missing = await request('/api/v1/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email: 'missing-timing@example.test' }),
    });
    const missingElapsed = performance.now() - missingStartedAt;

    const existingStartedAt = performance.now();
    const existing = await Promise.race([
      request('/api/v1/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email: 'timing-owner@example.test' }),
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error('Forgot response waited for the mailer')),
          500,
        );
      }),
    ]);
    const existingElapsed = performance.now() - existingStartedAt;

    assert.equal(missing.status, 202);
    assert.equal(existing.status, 202);
    assert.deepEqual(await missing.json(), { accepted: true });
    assert.deepEqual(await existing.json(), { accepted: true });
    assert.ok(missingElapsed >= 25, `missing response was ${missingElapsed}ms`);
    assert.ok(existingElapsed >= 25, `existing response was ${existingElapsed}ms`);
    assert.ok(mailerStarted);
  } finally {
    releaseMailer();
    await Promise.all(backgroundTasks);
    await rm(directory, { recursive: true, force: true });
  }
});

test('revision recovery and student privacy exports enforce admin tenant boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-recovery-test-'));
  const dataFile = join(directory, 'workspaces.json');
  const deliveries: PasswordResetDelivery[] = [];
  const repository = new JsonWorkspaceRepository(dataFile);
  await repository.put(
    LEGACY_WORKSPACE_ID,
    normalizeAppData(createPrivacyState()),
    0,
  );
  const options = createHandlerOptions(deliveries);
  const request = createRequester(createApiHandler(repository, options));

  try {
    const registerResponse = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Recovery Admin',
        email: 'recovery-admin@example.test',
        password: 'recovery admin secure password',
        workspaceName: 'Recovery Homeroom',
        initialWorkspaceData: createState(),
        legacyWorkspaceId: LEGACY_WORKSPACE_ID,
      }),
    });
    assert.equal(registerResponse.status, 201);
    const owner = await registerResponse.json() as AuthEnvelope;
    assert.equal(owner.legacyClaim?.status, 'claimed');

    const viewerRequest = createRequester(createApiHandler(
      createRoleScopedRepository(repository, 'viewer'),
      options,
    ));
    const teacherRequest = createRequester(createApiHandler(
      createRoleScopedRepository(repository, 'teacher'),
      options,
    ));
    const adminRequest = createRequester(createApiHandler(
      createRoleScopedRepository(repository, 'admin'),
      options,
    ));
    const studentExportPath =
      '/api/v1/classes/class-a/students/student-a/privacy/export';
    const protectedRequests = [
      { path: '/api/v1/revisions', method: 'GET' },
      { path: '/api/v1/revisions/1', method: 'GET' },
      { path: '/api/v1/revisions/1/restore', method: 'POST' },
      { path: '/api/v1/privacy/export', method: 'GET' },
      { path: studentExportPath, method: 'GET' },
      { path: '/api/v1/audit', method: 'GET' },
    ] as const;

    for (const protectedRequest of protectedRequests) {
      const body = protectedRequest.method === 'POST' ? '{}' : undefined;
      const anonymous = await request(protectedRequest.path, {
        method: protectedRequest.method,
        workspaceId: LEGACY_WORKSPACE_ID,
        body,
      });
      assert.equal(anonymous.status, 401);

      const viewer = await viewerRequest(protectedRequest.path, {
        method: protectedRequest.method,
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
        body,
      });
      assert.equal(viewer.status, 403);

      const teacher = await teacherRequest(protectedRequest.path, {
        method: protectedRequest.method,
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
        body,
      });
      assert.equal(teacher.status, 403);

      const crossTenant = await adminRequest(protectedRequest.path, {
        method: protectedRequest.method,
        sessionToken: owner.sessionToken,
        workspaceId: 'ws_unrelated_workspace_0123456789abcdef',
        body,
      });
      assert.equal(crossTenant.status, 403);
    }
    assert.equal((await repository.get(LEGACY_WORKSPACE_ID)).revision, 1);

    const workspacePrivacyResponse = await adminRequest(
      '/api/v1/privacy/export',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
        headers: { 'x-request-id': 'workspace-export-request' },
      },
    );
    assert.equal(workspacePrivacyResponse.status, 200);
    const workspacePrivacyExport = await workspacePrivacyResponse.json() as {
      activeWorkspace: {
        id: string;
        role: string;
        state: ReturnType<typeof createPrivacyState>;
      };
      revision: { current: number };
      exportedAt: string;
    };
    assert.equal(workspacePrivacyExport.activeWorkspace.id, LEGACY_WORKSPACE_ID);
    assert.equal(workspacePrivacyExport.activeWorkspace.role, 'admin');
    assert.equal(workspacePrivacyExport.revision.current, 1);
    assert.equal(
      workspacePrivacyExport.activeWorkspace.state.classes[0].students[0].name,
      'Alpha',
    );
    assert.ok(Number.isFinite(Date.parse(workspacePrivacyExport.exportedAt)));

    const initial = await repository.get(LEGACY_WORKSPACE_ID);
    assert.ok(initial.data);
    const updatedData = structuredClone(initial.data);
    updatedData.classes[0].students[0].points = 444;
    const updateResponse = await adminRequest('/api/v1/state', {
      method: 'PUT',
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
      body: JSON.stringify({
        baseRevision: initial.revision,
        data: updatedData,
      }),
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await repository.get(LEGACY_WORKSPACE_ID)).revision, 2);

    const invalidLimitResponse = await adminRequest(
      '/api/v1/revisions?limit=invalid',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
    );
    assert.equal(invalidLimitResponse.status, 400);

    const listResponse = await adminRequest('/api/v1/revisions', {
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json() as {
      currentRevision: number;
      revisions: Array<{
        revision: number;
        actorUserId?: string;
        data?: unknown;
      }>;
    };
    assert.equal(list.currentRevision, 2);
    assert.deepEqual(
      list.revisions.map((revision) => revision.revision),
      [2, 1],
    );
    assert.ok(list.revisions.every((revision) => !('data' in revision)));

    const invalidRevisionResponse = await adminRequest(
      '/api/v1/revisions/0',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
    );
    assert.equal(invalidRevisionResponse.status, 400);

    const missingRevisionResponse = await adminRequest(
      '/api/v1/revisions/999',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
    );
    assert.equal(missingRevisionResponse.status, 404);

    const snapshotResponse = await adminRequest('/api/v1/revisions/1', {
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json() as {
      snapshot: {
        revision: number;
        data: ReturnType<typeof createPrivacyState>;
      };
    };
    assert.equal(snapshot.snapshot.revision, 1);
    assert.equal(
      snapshot.snapshot.data.classes[0].students[0].points,
      200,
    );

    const restoreResponse = await adminRequest(
      '/api/v1/revisions/1/restore',
      {
        method: 'POST',
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
        headers: { 'x-request-id': 'restore-request' },
        body: '{}',
      },
    );
    assert.equal(restoreResponse.status, 200);
    const restored = await restoreResponse.json() as {
      restoredFromRevision: number;
      revision: number;
      data: ReturnType<typeof createPrivacyState>;
    };
    assert.equal(restored.restoredFromRevision, 1);
    assert.equal(restored.revision, 3);
    assert.equal(restored.data.classes[0].students[0].points, 200);
    const restoredWorkspace = await repository.get(LEGACY_WORKSPACE_ID);
    assert.equal(restoredWorkspace.revision, 3);
    assert.equal(restoredWorkspace.data?.classes[0].students[0].points, 200);

    const persistedDatabase = JSON.parse(
      await readFile(dataFile, 'utf8'),
    ) as {
      auditEvents: Array<{
        actorUserId?: string;
        action: string;
      }>;
    };
    assert.ok(persistedDatabase.auditEvents.some(
      (event) =>
        event.actorUserId === owner.session.user.id &&
        event.action === 'workspace.revision.restore',
    ));
    assert.ok(persistedDatabase.auditEvents.some(
      (event) =>
        event.actorUserId === owner.session.user.id &&
        event.action === 'workspace.privacy.export',
    ));

    const privacyResponse = await adminRequest(studentExportPath, {
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(privacyResponse.status, 200);
    const privacyExport = await privacyResponse.json() as {
      workspace: { id: string; revision: number };
      class: { id: string; name: string };
      student: {
        id: string;
        name: string;
        disciplineRecords: Array<{ id: string }>;
        pointAdjustmentRecords: Array<{ id: string }>;
        dailyProgress: { reflections: Array<{ id: string }> };
        teamId?: string;
        teammateId?: string;
      };
      learningEvidenceRecords: Array<{
        id: string;
        studentId: string;
      }>;
      examRecords: Array<{
        results: Array<{
          studentId: string;
          mentorComment?: string;
        }>;
      }>;
      activeBossParticipation: {
        contribution: number;
        attackCount: number;
        contributions?: unknown;
        attackCounts?: unknown;
      };
      exportedAt: string;
    };
    assert.equal(privacyExport.workspace.id, LEGACY_WORKSPACE_ID);
    assert.equal(privacyExport.workspace.revision, 3);
    assert.equal(privacyExport.student.id, 'student-a');
    assert.equal(privacyExport.student.name, 'Alpha');
    assert.equal(privacyExport.student.teamId, undefined);
    assert.equal(privacyExport.student.teammateId, undefined);
    assert.deepEqual(
      privacyExport.student.disciplineRecords.map((record) => record.id),
      ['discipline-a'],
    );
    assert.deepEqual(
      privacyExport.student.pointAdjustmentRecords.map((record) => record.id),
      ['adjustment-a'],
    );
    assert.deepEqual(
      privacyExport.student.dailyProgress.reflections.map(
        (record) => record.id,
      ),
      ['reflection-a'],
    );
    assert.deepEqual(
      privacyExport.learningEvidenceRecords.map((record) => record.id),
      ['evidence-a'],
    );
    assert.deepEqual(
      privacyExport.examRecords[0].results.map((result) => result.studentId),
      ['student-a'],
    );
    assert.equal(
      privacyExport.examRecords[0].results[0].mentorComment,
      'Alpha private comment',
    );
    assert.equal(privacyExport.activeBossParticipation.contribution, 11);
    assert.equal(privacyExport.activeBossParticipation.attackCount, 1);
    assert.equal(
      privacyExport.activeBossParticipation.contributions,
      undefined,
    );
    assert.equal(
      privacyExport.activeBossParticipation.attackCounts,
      undefined,
    );
    const serializedExport = JSON.stringify(privacyExport);
    assert.equal(serializedExport.includes('student-b'), false);
    assert.equal(serializedExport.includes('Beta'), false);
    assert.ok(Number.isFinite(Date.parse(privacyExport.exportedAt)));

    const databaseAfterStudentExport = JSON.parse(
      await readFile(dataFile, 'utf8'),
    ) as {
      auditEvents: Array<{
        actorUserId?: string;
        action: string;
        targetId?: string;
        metadata?: Record<string, unknown>;
      }>;
    };
    assert.ok(databaseAfterStudentExport.auditEvents.some(
      (event) =>
        event.actorUserId === owner.session.user.id &&
        event.action === 'student.privacy.export' &&
        event.targetId === 'student-a' &&
        event.metadata?.classId === 'class-a' &&
        event.metadata?.revision === 3,
    ));

    await repository.appendAuditEvent({
      id: 'evt_sensitive_audit_fixture',
      workspaceId: LEGACY_WORKSPACE_ID,
      actorUserId: owner.session.user.id,
      action: 'security.test',
      targetType: 'workspace',
      targetId: LEGACY_WORKSPACE_ID,
      metadata: {
        safeField: 'visible',
        password: 'must-not-leave-server',
        nested: {
          note: 'retained',
          sessionToken: 'must-not-leave-server',
        },
      },
      createdAt: Date.now(),
    });

    const invalidAuditQuery = await adminRequest('/api/v1/audit?limit=0', {
      sessionToken: owner.sessionToken,
      workspaceId: LEGACY_WORKSPACE_ID,
    });
    assert.equal(invalidAuditQuery.status, 400);
    assert.deepEqual(await invalidAuditQuery.json(), {
      error: 'INVALID_AUDIT_QUERY',
    });

    const filteredAuditResponse = await adminRequest(
      '/api/v1/audit?action=security.test&limit=5',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
        headers: { 'x-request-id': 'audit-query-request' },
      },
    );
    assert.equal(filteredAuditResponse.status, 200);
    const filteredAudit = await filteredAuditResponse.json() as {
      events: Array<{
        action: string;
        workspaceId?: string;
        metadata?: Record<string, unknown>;
      }>;
      nextCursor?: string;
    };
    assert.equal(filteredAudit.events.length, 1);
    assert.equal(filteredAudit.events[0].action, 'security.test');
    assert.equal(filteredAudit.events[0].workspaceId, LEGACY_WORKSPACE_ID);
    assert.equal(filteredAudit.events[0].metadata?.safeField, 'visible');
    assert.equal(filteredAudit.events[0].metadata?.password, undefined);
    assert.deepEqual(filteredAudit.events[0].metadata?.nested, {
      note: 'retained',
    });
    assert.equal(filteredAudit.nextCursor, undefined);

    const firstAuditPageResponse = await adminRequest(
      '/api/v1/audit?limit=2',
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
    );
    assert.equal(firstAuditPageResponse.status, 200);
    const firstAuditPage = await firstAuditPageResponse.json() as {
      events: Array<{ id: string; workspaceId?: string }>;
      nextCursor?: string;
    };
    assert.equal(firstAuditPage.events.length, 2);
    assert.ok(firstAuditPage.nextCursor);
    assert.ok(firstAuditPage.events.every(
      (event) => event.workspaceId === LEGACY_WORKSPACE_ID,
    ));

    const secondAuditPageResponse = await adminRequest(
      `/api/v1/audit?limit=2&cursor=${encodeURIComponent(
        firstAuditPage.nextCursor ?? '',
      )}`,
      {
        sessionToken: owner.sessionToken,
        workspaceId: LEGACY_WORKSPACE_ID,
      },
    );
    assert.equal(secondAuditPageResponse.status, 200);
    const secondAuditPage = await secondAuditPageResponse.json() as {
      events: Array<{ id: string }>;
    };
    assert.equal(
      secondAuditPage.events.some((event) =>
        firstAuditPage.events.some((first) => first.id === event.id)
      ),
      false,
    );

    const databaseAfterAuditQuery = JSON.parse(
      await readFile(dataFile, 'utf8'),
    ) as {
      auditEvents: Array<{
        action: string;
        metadata?: Record<string, unknown>;
      }>;
    };
    assert.ok(databaseAfterAuditQuery.auditEvents.some(
      (event) =>
        event.action === 'audit.query' &&
        event.metadata?.requestId === 'audit-query-request' &&
        event.metadata?.action === 'security.test',
    ));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('authentication rate limits survive handler and repository recreation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epet-rate-limit-test-'));
  const dataFile = join(directory, 'workspaces.json');
  const email = 'rate-limited@example.test';
  const deliveries: PasswordResetDelivery[] = [];

  try {
    const firstRepository = new JsonWorkspaceRepository(dataFile);
    const firstRequest = createRequester(
      createApiHandler(
        firstRepository,
        createHandlerOptions(deliveries),
      ),
    );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await firstRequest('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password: 'an invalid password',
        }),
      });
      assert.equal(response.status, 401);
    }
    const blockedResponse = await firstRequest('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: 'an invalid password',
      }),
    });
    assert.equal(blockedResponse.status, 429);
    assert.ok(Number(blockedResponse.headers.get('retry-after')) > 0);

    const reloadedRepository = new JsonWorkspaceRepository(dataFile);
    const reloadedRequest = createRequester(
      createApiHandler(
        reloadedRepository,
        createHandlerOptions(deliveries),
      ),
    );
    const stillBlockedResponse = await reloadedRequest(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          password: 'an invalid password',
        }),
      },
    );
    assert.equal(stillBlockedResponse.status, 429);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
