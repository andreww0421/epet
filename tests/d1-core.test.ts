import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import type { AppData } from '../src/store/types';
import {
  AuthService,
  EmailVerificationRequiredError,
  InvalidEmailVerificationTokenError,
} from '../server/auth';
import {
  InvalidWorkspaceInvitationError,
  WorkspaceConflictError,
  WorkspaceDataTooLargeError,
} from '../server/contracts';
import { D1WorkspaceRepository } from '../worker/repository';

const migrations = [
  'migrations/0001_create_workspaces.sql',
  'migrations/0002_auth_rbac.sql',
  'migrations/0003_core_entities.sql',
  'migrations/0004_workspace_class_assignments.sql',
  'migrations/0005_workspace_invitations.sql',
  'migrations/0006_projection_read_model.sql',
  'migrations/0007_email_verification.sql',
];

const splitMigrationStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let current: string[] = [];
  let insideTrigger = false;
  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;
    if (/^CREATE\s+TRIGGER\b/i.test(line)) insideTrigger = true;
    current.push(rawLine);
    const statementComplete = insideTrigger
      ? /^END;$/i.test(line)
      : line.endsWith(';');
    if (!statementComplete) continue;
    statements.push(current.join('\n'));
    current = [];
    insideTrigger = false;
  }
  assert.equal(current.length, 0, 'migration contains an incomplete statement');
  return statements;
};

const applyMigration = async (database: D1Database, path: string) => {
  const statements = splitMigrationStatements(await readFile(path, 'utf8'));
  for (const statement of statements) {
    await database.prepare(statement).run();
  }
};

const createData = (studentName: string, points: number): AppData => ({
  lastOpened: 1_700_000_000_000,
  currentClassId: 'class-shared-id',
  classes: [{
    id: 'class-shared-id',
    name: `${studentName} class`,
    students: [{
      id: 'student-shared-id',
      name: studentName,
      points,
      rankPoints: 7,
      warningPoints: 1,
      pet: {
        type: 'cat',
        fullness: 80,
        happiness: 75,
        level: 3,
      },
      disciplineRecords: [{
        id: 'discipline-1',
        type: 'levelDecrease',
        warningCount: 1,
        reason: 'Repeated unsafe conduct',
        actionKind: 'levelDecrease',
        createdAt: 1_700_000_000_100,
      }, {
        id: 'discipline-reversal-1',
        type: 'reversal',
        reason: 'Decision overturned after review',
        reversesRecordId: 'discipline-1',
        createdAt: 1_700_000_000_150,
      }],
      pointAdjustmentRecords: [{
        id: 'adjustment-1',
        amount: 5,
        source: 'manual',
        reasonId: 'helping',
        reasonLabel: 'Helping',
        competency: 'collaboration',
        createdAt: 1_700_000_000_200,
      }],
      bossRewardRecords: [{
        id: 'reward-1',
        bossId: 'boss-1',
        bossName: 'Ancient Slime',
        createdAt: 1_700_000_000_300,
        rank: 1,
        damage: 120,
        attackCount: 4,
        fairScore: 30,
        previousDamage: 60,
        previousFairScore: 20,
        improvementAmount: 60,
        fairImprovementAmount: 10,
        rewardPoints: 13,
        rewardRankPoints: 5,
        rewardHappiness: 9,
        rankRewardPoints: 10,
        rankRewardRankPoints: 4,
        rankRewardHappiness: 6,
        participationRewardPoints: 2,
        participationRewardRankPoints: 1,
        participationRewardHappiness: 1,
        improvementRewardPoints: 1,
        improvementRewardRankPoints: 0,
        improvementRewardHappiness: 2,
        receivedImprovementReward: true,
      }],
    }],
    examRecords: [{
      id: 'exam-1',
      title: 'Midterm',
      examDate: '2026-07-01',
      items: [
        { id: 'math', name: 'Math', maxScore: 100 },
        { id: 'reading', name: 'Reading', maxScore: 100 },
      ],
      results: [{
        studentId: 'student-shared-id',
        scores: { math: 88, reading: 92 },
        mentorComment: `${studentName} is improving`,
        updatedAt: 1_700_000_000_400,
      }],
      createdAt: 1_700_000_000_350,
      updatedAt: 1_700_000_000_400,
    }],
    learningEvidenceRecords: [{
      id: 'evidence-1',
      classId: 'class-shared-id',
      studentId: 'student-shared-id',
      competency: 'growth',
      level: 'progressing',
      evidenceType: 'assessment',
      title: 'Midterm growth',
      note: 'Improved in both items',
      actor: 'mentor',
      source: 'manual',
      rubricVersion: '1.0',
      revision: 1,
      createdAt: 1_700_000_000_500,
    }],
  }],
});

type Fixture = {
  miniflare: Miniflare;
  database: D1Database;
};

const createFixture = async (migrationCount = migrations.length): Promise<Fixture> => {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'],
  });
  const database = await miniflare.getD1Database('DB') as unknown as D1Database;
  for (const migration of migrations.slice(0, migrationCount)) {
    await applyMigration(database, migration);
  }
  return { miniflare, database };
};

let fixture: Fixture;

before(async () => {
  fixture = await createFixture(2);
  await fixture.database
    .prepare(
      `INSERT INTO workspaces (
         workspace_id, revision, updated_at, data_json, name, created_at
       ) VALUES (?, 1, ?, ?, ?, ?)`,
    )
    .bind(
      'tenant-a',
      1_700_000_001_000,
      JSON.stringify(createData('Alice', 10)),
      'Tenant A',
      1_700_000_001_000,
    )
    .run();
  await fixture.database
    .prepare(
      `INSERT INTO workspaces (
         workspace_id, revision, updated_at, data_json, name, created_at
       ) VALUES (?, 1, ?, ?, ?, ?)`,
    )
    .bind(
      'tenant-b',
      1_700_000_002_000,
      JSON.stringify(createData('Bob', 20)),
      'Tenant B',
      1_700_000_002_000,
    )
    .run();
  await applyMigration(fixture.database, migrations[2]);
  for (const userId of [
    'teacher-a',
    'viewer-a',
    'teacher-b',
    'admin-b',
  ]) {
    await fixture.database
      .prepare(
        `INSERT INTO users (
           user_id, email, email_normalized, display_name, status,
           password_algorithm, password_salt, password_hash,
           password_iterations, created_at, updated_at, password_changed_at
         ) VALUES (?, ?, ?, ?, 'active', 'PBKDF2-HMAC-SHA256', ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        userId,
        `${userId}@example.test`,
        `${userId}@example.test`,
        userId,
        'test-salt',
        'test-hash',
        1_700_000_002_000,
        1_700_000_002_000,
        1_700_000_002_000,
      )
      .run();
  }
  const memberships = [
    ['tenant-a', 'teacher-a', 'teacher'],
    ['tenant-a', 'viewer-a', 'viewer'],
    ['tenant-b', 'teacher-b', 'teacher'],
    ['tenant-b', 'admin-b', 'admin'],
  ] as const;
  for (const [workspaceId, userId, role] of memberships) {
    await fixture.database
      .prepare(
        `INSERT INTO workspace_memberships (
           workspace_id, user_id, role, created_at, created_by_user_id
         ) VALUES (?, ?, ?, ?, NULL)`,
      )
      .bind(workspaceId, userId, role, 1_700_000_002_000)
      .run();
  }
  await applyMigration(fixture.database, migrations[3]);
  await applyMigration(fixture.database, migrations[4]);
  await applyMigration(fixture.database, migrations[5]);
  await applyMigration(fixture.database, migrations[6]);
});

after(async () => {
  await fixture.miniflare.dispose();
});

test('0003 backfills every core entity with tenant keys and source revision', async () => {
  const expectedCounts: Record<string, number> = {
    classes: 2,
    students: 2,
    exam_records: 2,
    exam_results: 2,
    learning_evidence: 2,
    point_adjustments: 2,
    discipline_records: 4,
    boss_rewards: 2,
  };
  for (const [table, expected] of Object.entries(expectedCounts)) {
    const row = await fixture.database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .first<{ count: number }>();
    assert.equal(row?.count, expected, `${table} should be backfilled`);
  }

  const reward = await fixture.database
    .prepare(
      `SELECT
         reward_points,
         reward_rank_points,
         reward_happiness,
         rank_reward_points,
         participation_reward_points,
         improvement_reward_points,
         received_improvement_reward,
         source_revision
       FROM boss_rewards
       WHERE workspace_id = ? AND student_id = ?`,
    )
    .bind('tenant-a', 'student-shared-id')
    .first<Record<string, number>>();
  assert.deepEqual(reward, {
    reward_points: 13,
    reward_rank_points: 5,
    reward_happiness: 9,
    rank_reward_points: 10,
    participation_reward_points: 2,
    improvement_reward_points: 1,
    received_improvement_reward: 1,
    source_revision: 1,
  });

  const sourceRevisions = await fixture.database
    .prepare(
      `SELECT source_revision
       FROM workspace_projection_state
       WHERE workspace_id IN ('tenant-a', 'tenant-b')
       ORDER BY workspace_id`,
    )
    .all<{ source_revision: number }>();
  assert.deepEqual(
    sourceRevisions.results.map((row) => row.source_revision),
    [1, 1],
  );

  const reversal = await fixture.database
    .prepare(
      `SELECT record_type, reason, action_kind, reverses_record_id
       FROM discipline_records
       WHERE workspace_id = ? AND discipline_id = ?`,
    )
    .bind('tenant-a', 'discipline-reversal-1')
    .first<{
      record_type: string;
      reason: string;
      action_kind: string | null;
      reverses_record_id: string;
    }>();
  assert.deepEqual(reversal, {
    record_type: 'reversal',
    reason: 'Decision overturned after review',
    action_kind: null,
    reverses_record_id: 'discipline-1',
  });
});

test('0007 verifies existing accounts and adds the verification rate-limit scope', async () => {
  const user = await fixture.database
    .prepare(
      `SELECT created_at, email_verified_at
       FROM users
       WHERE user_id = ?`,
    )
    .bind('teacher-a')
    .first<{ created_at: number; email_verified_at: number | null }>();
  assert.ok(user);
  assert.equal(user.email_verified_at, user.created_at);

  await fixture.database
    .prepare(
      `INSERT INTO auth_rate_limits (
         scope, subject_hash, window_started_at, attempt_count, blocked_until
       ) VALUES ('verify', 'verification-subject', 1, 1, 0)`,
    )
    .run();
  const rateLimit = await fixture.database
    .prepare(
      `SELECT scope FROM auth_rate_limits WHERE subject_hash = ?`,
    )
    .bind('verification-subject')
    .first<{ scope: string }>();
  assert.equal(rateLimit?.scope, 'verify');
});

test('0004 backfills legacy class access and new memberships fail closed', async () => {
  const assignments = await fixture.database
    .prepare(
      `SELECT workspace_id, user_id, class_id
       FROM workspace_class_assignments
       ORDER BY workspace_id, user_id, class_id`,
    )
    .all<{
      workspace_id: string;
      user_id: string;
      class_id: string;
    }>();
  assert.deepEqual(assignments.results, [{
    workspace_id: 'tenant-a',
    user_id: 'teacher-a',
    class_id: 'class-shared-id',
  }, {
    workspace_id: 'tenant-a',
    user_id: 'viewer-a',
    class_id: 'class-shared-id',
  }, {
    workspace_id: 'tenant-b',
    user_id: 'teacher-b',
    class_id: 'class-shared-id',
  }]);

  const repository = new D1WorkspaceRepository(fixture.database);
  assert.deepEqual(
    await repository.listWorkspaceClassIds('tenant-a', 'teacher-a'),
    ['class-shared-id'],
  );
  assert.deepEqual(
    await repository.listWorkspaceClassIds('tenant-b', 'admin-b'),
    [],
  );

  await fixture.database
    .prepare(
      `INSERT INTO users (
         user_id, email, email_normalized, display_name, status,
         password_algorithm, password_salt, password_hash,
         password_iterations, created_at, updated_at, password_changed_at
       ) VALUES (?, ?, ?, ?, 'active', 'PBKDF2-HMAC-SHA256', ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      'new-viewer-a',
      'new-viewer-a@example.test',
      'new-viewer-a@example.test',
      'New viewer A',
      'test-salt',
      'test-hash',
      1_700_000_003_000,
      1_700_000_003_000,
      1_700_000_003_000,
    )
    .run();
  await fixture.database
    .prepare(
      `INSERT INTO workspace_memberships (
         workspace_id, user_id, role, created_at, created_by_user_id
       ) VALUES (?, ?, 'viewer', ?, NULL)`,
    )
    .bind('tenant-a', 'new-viewer-a', 1_700_000_003_000)
    .run();
  assert.deepEqual(
    await repository.listWorkspaceClassIds('tenant-a', 'new-viewer-a'),
    [],
  );

  await assert.rejects(
    fixture.database
      .prepare(
        `INSERT INTO workspace_class_assignments (
           workspace_id, user_id, class_id, created_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .bind(
        'tenant-a',
        'teacher-b',
        'class-shared-id',
        1_700_000_003_000,
      )
      .run(),
    /invalid workspace class assignment/i,
  );
});

test('0006 verifies normalized reads, falls back on drift, and repairs projections', async () => {
  const isolated = await createFixture(2);
  try {
    const source = createData('Normalized source', 31);
    source.classes.unshift({
      id: 'class-first-by-position',
      name: 'Position first',
      students: [],
      learningEvidenceRecords: [],
      examRecords: [],
    });
    source.currentClassId = 'class-first-by-position';
    await isolated.database
      .prepare(
        `INSERT INTO workspaces (
           workspace_id, revision, updated_at, data_json, name, created_at
         ) VALUES (?, 1, ?, ?, ?, ?)`,
      )
      .bind(
        'normalized-tenant',
        1_700_000_010_000,
        JSON.stringify(source),
        'Normalized tenant',
        1_700_000_010_000,
      )
      .run();
    for (const migration of migrations.slice(2)) {
      await applyMigration(isolated.database, migration);
    }

    const repository = new D1WorkspaceRepository(isolated.database);
    const firstRead = await repository.get('normalized-tenant');
    assert.deepEqual(firstRead.data, source);
    assert.deepEqual(
      firstRead.data?.classes.map((classroom) => classroom.id),
      ['class-first-by-position', 'class-shared-id'],
    );
    const verified = await isolated.database
      .prepare(
        `SELECT reconciliation_status, source_checksum, projection_checksum
         FROM workspace_projection_documents
         WHERE workspace_id = ?`,
      )
      .bind('normalized-tenant')
      .first<{
        reconciliation_status: string;
        source_checksum: string;
        projection_checksum: string;
      }>();
    assert.equal(verified?.reconciliation_status, 'verified');
    assert.equal(verified?.source_checksum, verified?.projection_checksum);

    const corruptedStudent = {
      ...source.classes[1].students[0],
      name: 'Projection corruption',
    };
    await isolated.database
      .prepare(
        `UPDATE students
         SET record_json = ?
         WHERE workspace_id = ? AND class_id = ? AND student_id = ?`,
      )
      .bind(
        JSON.stringify(corruptedStudent),
        'normalized-tenant',
        'class-shared-id',
        'student-shared-id',
      )
      .run();
    const safeFallback = await repository.get('normalized-tenant');
    assert.equal(
      safeFallback.data?.classes[1].students[0].name,
      'Normalized source',
    );
    const mismatched = await isolated.database
      .prepare(
        `SELECT reconciliation_status
         FROM workspace_projection_documents
         WHERE workspace_id = ?`,
      )
      .bind('normalized-tenant')
      .first<{ reconciliation_status: string }>();
    assert.equal(mismatched?.reconciliation_status, 'mismatch');

    const repaired = await repository.reconcileWorkspaceProjection(
      'normalized-tenant',
      true,
    );
    assert.equal(repaired.status, 'verified');
    assert.equal(repaired.repaired, true);
    assert.deepEqual((await repository.get('normalized-tenant')).data, source);

    const report = await repository.reconcileWorkspaceProjections({
      repair: true,
      batchSize: 10,
      maxBatches: 1,
    });
    assert.deepEqual(report, {
      checked: 1,
      verified: 1,
      mismatched: 0,
      missing: 0,
      repaired: 0,
      truncated: false,
    });
  } finally {
    await isolated.miniflare.dispose();
  }
});

test('D1 email verification tokens are hashed, rotated, and single-use', async () => {
  const isolated = await createFixture();
  try {
    let now = 1_800_000_000_000;
    const lifecycleKinds: string[] = [];
    const repository = new D1WorkspaceRepository(isolated.database);
    const auth = new AuthService(repository, {
      now: () => now,
      passwordIterations: 10,
      emailVerificationRequired: true,
      lifecycleNotifier: (delivery) => lifecycleKinds.push(delivery.kind),
    });
    const registration = await auth.register({
      email: 'd1-unverified@example.test',
      password: 'd1 unverified secure password',
      displayName: 'D1 Unverified',
      workspaceName: 'D1 Verification',
      initialWorkspaceData: createData('D1 Verification Student', 14),
    });
    assert.equal(registration.session.user.emailVerified, false);
    assert.ok(registration.emailVerification);
    const workspaceId = registration.session.activeWorkspaceId;
    assert.ok(workspaceId);
    await assert.rejects(
      auth.authorizeWorkspace(registration.sessionToken, workspaceId),
      EmailVerificationRequiredError,
    );

    const persisted = await isolated.database
      .prepare(
        `SELECT token_hash, used_at
         FROM email_verification_tokens
         ORDER BY created_at`,
      )
      .all<{ token_hash: string; used_at: number | null }>();
    assert.equal(persisted.results.length, 1);
    assert.notEqual(
      persisted.results[0].token_hash,
      registration.emailVerification.token,
    );

    const verifiedOwnerAuth = new AuthService(repository, {
      now: () => now,
      passwordIterations: 10,
    });
    const verifiedOwner = await verifiedOwnerAuth.register({
      email: 'd1-inviter@example.test',
      password: 'd1 inviter secure password',
      displayName: 'D1 Inviter',
      workspaceName: 'D1 Invitation Guard',
      initialWorkspaceData: createData('D1 Invitation Student', 15),
    });
    assert.ok(verifiedOwner.session.activeWorkspaceId);
    const invitation = await verifiedOwnerAuth.createWorkspaceInvitation(
      verifiedOwner.sessionToken,
      verifiedOwner.session.activeWorkspaceId,
      'd1-unverified@example.test',
      'teacher',
      ['class-shared-id'],
    );
    const invitationSummary = (await verifiedOwnerAuth
      .listWorkspaceInvitations(
        verifiedOwner.sessionToken,
        verifiedOwner.session.activeWorkspaceId,
      )).find((candidate) => candidate.email === 'd1-unverified@example.test');
    assert.ok(invitationSummary);
    await verifiedOwnerAuth.revokeWorkspaceInvitation(
      verifiedOwner.sessionToken,
      verifiedOwner.session.activeWorkspaceId,
      invitationSummary.id,
    );
    await assert.rejects(
      auth.acceptWorkspaceInvitation(
        invitation.token,
        '',
        'd1 unverified secure password',
      ),
      InvalidWorkspaceInvitationError,
    );
    assert.equal(
      (await repository.getUserById(registration.session.user.id))
        ?.emailVerifiedAt,
      null,
    );

    now += 1;
    const rotated = await auth.requestEmailVerification(
      registration.sessionToken,
    );
    assert.ok(rotated);
    await assert.rejects(
      auth.verifyEmail(registration.emailVerification.token),
      InvalidEmailVerificationTokenError,
    );
    await auth.verifyEmail(rotated.token);
    await assert.rejects(
      auth.verifyEmail(rotated.token),
      InvalidEmailVerificationTokenError,
    );
    assert.equal(
      (await repository.getUserById(registration.session.user.id))
        ?.emailVerifiedAt,
      now,
    );
    assert.equal(
      (await auth.authorizeWorkspace(
        registration.sessionToken,
        workspaceId,
      )).user.emailVerified,
      true,
    );
    assert.deepEqual(lifecycleKinds, ['email_verified']);
  } finally {
    await isolated.miniflare.dispose();
  }
});

test('D1 invitation, member, ownership, account, and cleanup lifecycle is atomic', async () => {
  const isolated = await createFixture();
  try {
    let now = 1_800_000_000_000;
    const repository = new D1WorkspaceRepository(isolated.database);
    const auth = new AuthService(repository, {
      now: () => now,
      passwordIterations: 10,
    });
    const owner = await auth.register({
      email: 'd1-owner@example.test',
      password: 'd1 owner secure password',
      displayName: 'D1 Owner',
      workspaceName: 'D1 Lifecycle',
      initialWorkspaceData: createData('D1 Student', 10),
    });
    const workspaceId = owner.session.activeWorkspaceId;
    assert.ok(workspaceId);
    const delivery = await auth.createWorkspaceInvitation(
      owner.sessionToken,
      workspaceId,
      'd1-invited@example.test',
      'teacher',
      ['class-shared-id'],
    );
    const invited = await auth.acceptWorkspaceInvitation(
      delivery.token,
      'D1 Invited',
      'd1 invited secure password',
    );
    const invitedUserId = invited.session.user.id;
    await auth.updateWorkspaceMember(
      owner.sessionToken,
      workspaceId,
      invitedUserId,
      'viewer',
      ['class-shared-id'],
    );
    assert.equal(
      (await repository.getWorkspaceMembership(workspaceId, invitedUserId))?.role,
      'viewer',
    );
    await auth.transferWorkspaceOwnership(
      owner.sessionToken,
      workspaceId,
      invitedUserId,
    );
    assert.equal(
      (await repository.getWorkspaceMembership(workspaceId, invitedUserId))?.role,
      'owner',
    );
    await auth.removeWorkspaceMember(
      invited.sessionToken,
      workspaceId,
      owner.session.user.id,
    );
    await auth.deleteAccount(
      owner.sessionToken,
      'd1 owner secure password',
      'DELETE',
    );
    assert.equal(await repository.getUserById(owner.session.user.id), null);

    await auth.deleteWorkspace(
      invited.sessionToken,
      workspaceId,
      'd1 invited secure password',
      'D1 Lifecycle',
    );
    assert.equal((await repository.get(workspaceId)).data, null);

    now += 100 * 24 * 60 * 60 * 1_000;
    const cleanup = await repository.cleanupExpiredAuthData(now);
    assert.ok(cleanup.sessions >= 1);
  } finally {
    await isolated.miniflare.dispose();
  }
});

test('dual-write updates one tenant without changing matching entity IDs in another', async () => {
  const repository = new D1WorkspaceRepository(fixture.database);
  const nextData = createData('Alice updated', 42);
  nextData.classes[0].students[0].pointAdjustmentRecords = [];
  const stored = await repository.put('tenant-a', nextData, 1, {
    actorUserId: 'teacher-a',
    action: 'workspace.update',
    requestId: 'request-tenant-a-revision-2',
  });
  assert.equal(stored.revision, 2);

  const students = await fixture.database
    .prepare(
      `SELECT workspace_id, name, points, source_revision
       FROM students
       WHERE student_id = ?
       ORDER BY workspace_id`,
    )
    .bind('student-shared-id')
    .all<{
      workspace_id: string;
      name: string;
      points: number;
      source_revision: number;
    }>();
  assert.deepEqual(students.results, [
    {
      workspace_id: 'tenant-a',
      name: 'Alice updated',
      points: 42,
      source_revision: 2,
    },
    {
      workspace_id: 'tenant-b',
      name: 'Bob',
      points: 20,
      source_revision: 1,
    },
  ]);

  const adjustments = await fixture.database
    .prepare(
      `SELECT workspace_id
       FROM point_adjustments
       WHERE adjustment_id = ?
       ORDER BY workspace_id`,
    )
    .bind('adjustment-1')
    .all<{ workspace_id: string }>();
  assert.deepEqual(adjustments.results, [{ workspace_id: 'tenant-b' }]);

  const audit = await fixture.database
    .prepare(
      `SELECT actor_user_id, action
       FROM audit_events
       WHERE event_id = ?`,
    )
    .bind('request-tenant-a-revision-2')
    .first<{ actor_user_id: string; action: string }>();
  assert.deepEqual(audit, {
    actor_user_id: 'teacher-a',
    action: 'workspace.update',
  });
  assert.deepEqual(
    await repository.listWorkspaceClassIds('tenant-a', 'teacher-a'),
    ['class-shared-id'],
  );
});

test('D1 audit queries isolate tenants, filter, and paginate deterministically', async () => {
  const repository = new D1WorkspaceRepository(fixture.database);
  await repository.appendAuditEvent({
    id: 'audit-query-a-1',
    workspaceId: 'tenant-a',
    actorUserId: 'teacher-a',
    action: 'audit.test',
    targetType: 'student',
    targetId: 'student-1',
    metadata: { sequence: 1 },
    createdAt: 1_700_000_010_100,
  });
  await repository.appendAuditEvent({
    id: 'audit-query-a-2',
    workspaceId: 'tenant-a',
    actorUserId: 'teacher-a',
    action: 'audit.test',
    targetType: 'student',
    targetId: 'student-2',
    metadata: { sequence: 2 },
    createdAt: 1_700_000_010_200,
  });
  await repository.appendAuditEvent({
    id: 'audit-query-a-3',
    workspaceId: 'tenant-a',
    actorUserId: 'teacher-a',
    action: 'audit.test',
    targetType: 'student',
    targetId: 'student-3',
    metadata: { sequence: 3 },
    createdAt: 1_700_000_010_300,
  });
  await repository.appendAuditEvent({
    id: 'audit-query-b-1',
    workspaceId: 'tenant-b',
    actorUserId: 'teacher-b',
    action: 'audit.test',
    targetType: 'student',
    targetId: 'student-b',
    createdAt: 1_700_000_010_400,
  });

  const firstPage = await repository.listWorkspaceAuditEvents('tenant-a', {
    action: 'audit.test',
    actorUserId: 'teacher-a',
    targetType: 'student',
    fromCreatedAt: 1_700_000_010_000,
    toCreatedAt: 1_700_000_011_000,
    limit: 2,
  });
  assert.deepEqual(
    firstPage.map((event) => event.id),
    ['audit-query-a-3', 'audit-query-a-2'],
  );
  assert.deepEqual(firstPage[0].metadata, { sequence: 3 });

  const secondPage = await repository.listWorkspaceAuditEvents('tenant-a', {
    action: 'audit.test',
    cursor: {
      createdAt: firstPage[1].createdAt,
      id: firstPage[1].id,
    },
    limit: 2,
  });
  assert.deepEqual(
    secondPage.map((event) => event.id),
    ['audit-query-a-1'],
  );
  assert.equal(
    firstPage.some((event) => event.id === 'audit-query-b-1'),
    false,
  );
});

test('projection rebuild removes assignments only when their class is deleted', async () => {
  const isolated = await createFixture();
  try {
    const repository = new D1WorkspaceRepository(isolated.database);
    await repository.put('cleanup-tenant', createData('Cleanup', 10), 0);
    await isolated.database
      .prepare(
        `INSERT INTO users (
           user_id, email, email_normalized, display_name, status,
           password_algorithm, password_salt, password_hash,
           password_iterations, created_at, updated_at, password_changed_at
         ) VALUES (?, ?, ?, ?, 'active', 'PBKDF2-HMAC-SHA256', ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        'cleanup-teacher',
        'cleanup-teacher@example.test',
        'cleanup-teacher@example.test',
        'Cleanup teacher',
        'test-salt',
        'test-hash',
        1_700_000_004_000,
        1_700_000_004_000,
        1_700_000_004_000,
      )
      .run();
    await isolated.database
      .prepare(
        `INSERT INTO workspace_memberships (
           workspace_id, user_id, role, created_at, created_by_user_id
         ) VALUES (?, ?, 'teacher', ?, NULL)`,
      )
      .bind('cleanup-tenant', 'cleanup-teacher', 1_700_000_004_000)
      .run();
    await isolated.database
      .prepare(
        `INSERT INTO workspace_class_assignments (
           workspace_id, user_id, class_id, created_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .bind(
        'cleanup-tenant',
        'cleanup-teacher',
        'class-shared-id',
        1_700_000_004_000,
      )
      .run();

    await repository.put('cleanup-tenant', {
      lastOpened: 1_700_000_004_100,
      currentClassId: '',
      classes: [],
    }, 1);
    assert.deepEqual(
      await repository.listWorkspaceClassIds(
        'cleanup-tenant',
        'cleanup-teacher',
      ),
      [],
    );
    const remaining = await isolated.database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM workspace_class_assignments
         WHERE workspace_id = ? AND user_id = ?`,
      )
      .bind('cleanup-tenant', 'cleanup-teacher')
      .first<{ count: number }>();
    assert.equal(remaining?.count, 0);
  } finally {
    await isolated.miniflare.dispose();
  }
});

test('foreign keys reject a cross-tenant child relationship', async () => {
  await fixture.database
    .prepare(
      `INSERT INTO students (
         workspace_id, class_id, student_id, name, source_revision, record_json
       ) VALUES (?, ?, ?, ?, 1, ?)`,
    )
    .bind(
      'tenant-b',
      'class-shared-id',
      'student-only-in-tenant-b',
      'Tenant B only',
      JSON.stringify({ id: 'student-only-in-tenant-b', name: 'Tenant B only' }),
    )
    .run();
  await assert.rejects(
    fixture.database
      .prepare(
        `INSERT INTO exam_results (
           workspace_id, class_id, exam_id, student_id, scores_json,
           updated_at, source_revision, record_json
         ) VALUES (?, ?, ?, ?, '{}', 0, 2, '{}')`,
      )
      .bind(
        'tenant-a',
        'class-shared-id',
        'exam-1',
        'student-only-in-tenant-b',
      )
      .run(),
    /FOREIGN KEY constraint failed/i,
  );
});

test('workspace revision trigger retains only the latest 25 snapshots', async () => {
  const repository = new D1WorkspaceRepository(fixture.database);
  const data = createData('Bob', 20);
  for (let baseRevision = 1; baseRevision < 30; baseRevision += 1) {
    data.lastOpened += 1;
    await repository.put('tenant-b', data, baseRevision, {
      action: 'workspace.snapshot-retention-test',
      requestId: `tenant-b-revision-${baseRevision + 1}`,
    });
  }
  const snapshots = await fixture.database
    .prepare(
      `SELECT COUNT(*) AS count, MIN(revision) AS oldest, MAX(revision) AS newest
       FROM workspace_revisions
       WHERE workspace_id = ?`,
    )
    .bind('tenant-b')
    .first<{ count: number; oldest: number; newest: number }>();
  assert.deepEqual(snapshots, { count: 25, oldest: 6, newest: 30 });
});

test('concurrent same-revision writes preserve one blob/projection/audit winner', async () => {
  const leftRepository = new D1WorkspaceRepository(fixture.database);
  const rightRepository = new D1WorkspaceRepository(fixture.database);
  const leftData = createData('Concurrent left', 51);
  const rightData = createData('Concurrent right', 52);
  const results = await Promise.allSettled([
    leftRepository.put('tenant-a', leftData, 2, {
      action: 'workspace.update',
      requestId: 'concurrent-left',
    }),
    rightRepository.put('tenant-a', rightData, 2, {
      action: 'workspace.update',
      requestId: 'concurrent-right',
    }),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.ok(rejected.reason instanceof WorkspaceConflictError);

  const workspace = await leftRepository.get('tenant-a');
  assert.equal(workspace.revision, 3);
  const blobStudent = workspace.data?.classes[0].students[0];
  const projection = await fixture.database
    .prepare(
      `SELECT name, points, source_revision
       FROM students
       WHERE workspace_id = ? AND student_id = ?`,
    )
    .bind('tenant-a', 'student-shared-id')
    .first<{ name: string; points: number; source_revision: number }>();
  assert.deepEqual(projection, {
    name: blobStudent?.name,
    points: blobStudent?.points,
    source_revision: 3,
  });

  const audits = await fixture.database
    .prepare(
      `SELECT event_id
       FROM audit_events
       WHERE event_id IN ('concurrent-left', 'concurrent-right')`,
    )
    .all<{ event_id: string }>();
  assert.equal(audits.results.length, 1);
});

test('deleting a student purges that student from every retained D1 revision', async () => {
  const repository = new D1WorkspaceRepository(fixture.database);
  const current = await repository.get('tenant-b');
  assert.equal(current.revision, 30);
  assert.equal(current.data?.classes[0].students[0].id, 'student-shared-id');
  assert.ok(current.data);
  await repository.put('tenant-b', {
    ...current.data,
    classes: current.data.classes.map((classroom) => ({
      ...classroom,
      students: [],
      learningEvidenceRecords: [],
      examRecords: classroom.examRecords?.map((exam) => ({
        ...exam,
        results: [],
      })),
    })),
  }, current.revision, {
    action: 'workspace.student.delete',
    requestId: 'tenant-b-delete-student',
  });

  const snapshots = await fixture.database
    .prepare(
      `SELECT data_json
       FROM workspace_revisions
       WHERE workspace_id = ?`,
    )
    .bind('tenant-b')
    .all<{ data_json: string }>();
  assert.equal(snapshots.results.length, 25);
  assert.ok(snapshots.results.every(
    (snapshot) => !snapshot.data_json.includes('student-shared-id'),
  ));
});

test('a projection failure rolls back blob, revision, projection state, and audit', async () => {
  const isolated = await createFixture();
  try {
    const repository = new D1WorkspaceRepository(isolated.database);
    const original = createData('Rollback', 10);
    await repository.put('rollback-tenant', original, 0, {
      action: 'workspace.create',
      requestId: 'rollback-create',
    });
    await isolated.database.prepare('DROP TABLE boss_rewards').run();

    await assert.rejects(
      repository.put(
        'rollback-tenant',
        createData('Must roll back', 99),
        1,
        { action: 'workspace.update', requestId: 'must-not-commit' },
      ),
      /no such table: boss_rewards/i,
    );

    const persisted = await repository.get('rollback-tenant');
    assert.equal(persisted.revision, 1);
    assert.equal(persisted.data?.classes[0].students[0].name, 'Rollback');
    const projectionState = await isolated.database
      .prepare(
        `SELECT source_revision
         FROM workspace_projection_state
         WHERE workspace_id = ?`,
      )
      .bind('rollback-tenant')
      .first<{ source_revision: number }>();
    assert.equal(projectionState?.source_revision, 1);
    const forbiddenAudit = await isolated.database
      .prepare('SELECT event_id FROM audit_events WHERE event_id = ?')
      .bind('must-not-commit')
      .first<{ event_id: string }>();
    assert.equal(forbiddenAudit, null);
  } finally {
    await isolated.miniflare.dispose();
  }
});

test('900KB guard rejects oversized blobs before any D1 write', async () => {
  const repository = new D1WorkspaceRepository(fixture.database);
  const oversized = createData('x'.repeat(901 * 1024), 1);
  await assert.rejects(
    repository.put('tenant-a', oversized, 3),
    WorkspaceDataTooLargeError,
  );
  assert.equal((await repository.get('tenant-a')).revision, 3);
});
