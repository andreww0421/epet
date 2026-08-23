import type {
  D1Database,
  D1PreparedStatement,
} from '@cloudflare/workers-types';
import type {
  AppData,
  ClassData,
  ExamRecord,
  Student,
} from '../src/store/types';
import {
  findPermanentlyDeletedStudentIds,
  purgeStudentsFromWorkspaceData,
} from '../server/studentPrivacy';
import {
  EmailAlreadyExistsError,
  InvalidWorkspaceInvitationError,
  WorkspaceAlreadyClaimedError,
  WorkspaceConflictError,
  WorkspaceDataTooLargeError,
  WorkspaceMembershipNotFoundError,
  WorkspaceNotFoundError,
  WorkspaceOwnerTransferRequiredError,
  type AuditEventRecord,
  type AcceptWorkspaceInvitationInput,
  type AuthCleanupResult,
  type AuthRateLimitResult,
  type AuthRepository,
  type AuthSessionRecord,
  type AuthUserRecord,
  type ClaimLegacyWorkspaceInput,
  type ConsumeAuthRateLimitInput,
  type ConsumeEmailVerificationInput,
  type ConsumePasswordResetInput,
  type CreateUserWithWorkspaceInput,
  type CreateWorkspaceForUserInput,
  type DeleteUserInput,
  type DeleteWorkspaceInput,
  type EmailVerificationTokenRecord,
  type PasswordResetTokenRecord,
  type StoredWorkspace,
  type UserWorkspaceAccess,
  type WorkspaceMember,
  type WorkspaceInvitationRecord,
  type WorkspaceInvitationSummary,
  type WorkspaceMembershipRecord,
  type RemoveWorkspaceMemberInput,
  type TransferWorkspaceOwnershipInput,
  type UpdateWorkspaceMemberInput,
  type WorkspaceRepository,
  type WorkspaceRevisionRecord,
  type WorkspaceRevisionSnapshot,
  type WorkspaceAuditQuery,
  type WorkspaceWriteContext,
} from '../server/contracts';

const MAX_D1_STATE_BYTES = 900 * 1024;
const MAX_STORED_REVISIONS = 25;

type WorkspaceRow = {
  revision: number;
  updated_at: number;
  data_json: string;
};

type WorkspaceMetadataRow = Omit<WorkspaceRow, 'data_json'>;

type ProjectionStatus = 'pending' | 'verified' | 'mismatch';

type ProjectionDocumentRow = {
  workspace_id: string;
  source_revision: number;
  root_json: string;
  reconciliation_status: ProjectionStatus;
  source_checksum: string | null;
  projection_checksum: string | null;
  reconciled_at: number | null;
  details_json: string;
};

type ProjectionRecordRow = {
  class_id: string;
  student_id?: string;
  exam_id?: string;
  sort_index: number;
  record_json: string;
};

export type WorkspaceReadMode = 'normalized' | 'verify' | 'blob';

export type D1WorkspaceRepositoryOptions = {
  readMode?: WorkspaceReadMode;
};

export type WorkspaceProjectionReconciliationResult = {
  workspaceId: string;
  revision: number;
  status: 'verified' | 'mismatch' | 'missing';
  repaired: boolean;
  expectedCounts?: Record<string, number>;
  actualCounts?: Record<string, number>;
};

export type WorkspaceProjectionReconciliationReport = {
  checked: number;
  verified: number;
  mismatched: number;
  missing: number;
  repaired: number;
  truncated: boolean;
};

type UserRow = {
  user_id: string;
  email: string;
  email_normalized: string;
  email_verified_at: number | null;
  display_name: string;
  status: AuthUserRecord['status'];
  password_algorithm: AuthUserRecord['password']['algorithm'];
  password_salt: string;
  password_hash: string;
  password_iterations: number;
  created_at: number;
  updated_at: number;
  password_changed_at: number;
};

type AuditEventRow = {
  event_id: string;
  workspace_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata_json: string;
  created_at: number;
};

type MembershipRow = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceMembershipRecord['role'];
  created_at: number;
  created_by_user_id: string | null;
};

type UserWorkspaceRow = {
  workspace_id: string;
  name: string;
  role: UserWorkspaceAccess['role'];
};

type SessionRow = {
  token_hash: string;
  user_id: string;
  active_workspace_id: string | null;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  revoked_at: number | null;
};

type ClaimRow = {
  workspace_id: string;
  claimed_by_user_id: string;
  claimed_at: number;
};

type RateLimitRow = {
  window_started_at: number;
  attempt_count: number;
  blocked_until: number;
};

type RevisionRow = {
  workspace_id: string;
  revision: number;
  updated_at: number;
  actor_user_id: string | null;
  data_size_bytes: number;
};

type RevisionSnapshotRow = RevisionRow & {
  data_json: string;
};

type InvitationRow = {
  invitation_id: string;
  token_hash: string;
  workspace_id: string;
  email: string;
  email_normalized: string;
  role: Exclude<WorkspaceMembershipRecord['role'], 'owner'>;
  class_ids_json: string;
  created_by_user_id: string;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
  accepted_by_user_id: string | null;
  revoked_at: number | null;
};

const emptyWorkspace = (): StoredWorkspace => ({
  revision: 0,
  updatedAt: 0,
  data: null,
});

const decodeWorkspace = (row: WorkspaceRow | null): StoredWorkspace => {
  if (!row) return emptyWorkspace();
  return {
    revision: row.revision,
    updatedAt: row.updated_at,
    data: JSON.parse(row.data_json) as AppData,
  };
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

const checksumData = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const workspaceEntityCounts = (data: AppData): Record<string, number> => ({
  classes: data.classes.length,
  students: data.classes.reduce(
    (count, classroom) => count + classroom.students.length,
    0,
  ),
  examRecords: data.classes.reduce(
    (count, classroom) => count + (classroom.examRecords?.length ?? 0),
    0,
  ),
  examResults: data.classes.reduce(
    (count, classroom) => count + (classroom.examRecords ?? []).reduce(
      (examCount, exam) => examCount + exam.results.length,
      0,
    ),
    0,
  ),
  learningEvidence: data.classes.reduce(
    (count, classroom) =>
      count + (classroom.learningEvidenceRecords?.length ?? 0),
    0,
  ),
  pointAdjustments: data.classes.reduce(
    (count, classroom) => count + classroom.students.reduce(
      (studentCount, student) =>
        studentCount + (student.pointAdjustmentRecords?.length ?? 0),
      0,
    ),
    0,
  ),
  disciplineRecords: data.classes.reduce(
    (count, classroom) => count + classroom.students.reduce(
      (studentCount, student) =>
        studentCount + (student.disciplineRecords?.length ?? 0),
      0,
    ),
    0,
  ),
  bossRewards: data.classes.reduce(
    (count, classroom) => count + classroom.students.reduce(
      (studentCount, student) =>
        studentCount + (student.bossRewardRecords?.length ?? 0),
      0,
    ),
    0,
  ),
});

type NormalizedProjection = {
  document: ProjectionDocumentRow;
  data: AppData;
};

const decodeUser = (row: UserRow | null): AuthUserRecord | null => {
  if (!row) return null;
  return {
    id: row.user_id,
    email: row.email,
    normalizedEmail: row.email_normalized,
    emailVerifiedAt: row.email_verified_at,
    displayName: row.display_name,
    status: row.status,
    password: {
      algorithm: row.password_algorithm,
      salt: row.password_salt,
      hash: row.password_hash,
      iterations: row.password_iterations,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passwordChangedAt: row.password_changed_at,
  };
};

const decodeMembership = (
  row: MembershipRow | null,
): WorkspaceMembershipRecord | null => {
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id ?? undefined,
  };
};

const decodeSession = (row: SessionRow | null): AuthSessionRecord | null => {
  if (!row) return null;
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    activeWorkspaceId: row.active_workspace_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
};

const decodeRevision = (row: RevisionRow): WorkspaceRevisionRecord => ({
  workspaceId: row.workspace_id,
  revision: row.revision,
  updatedAt: row.updated_at,
  actorUserId: row.actor_user_id ?? undefined,
  dataSizeBytes: row.data_size_bytes,
});

const decodeInvitation = (row: InvitationRow): WorkspaceInvitationRecord => ({
  id: row.invitation_id,
  tokenHash: row.token_hash,
  workspaceId: row.workspace_id,
  email: row.email,
  normalizedEmail: row.email_normalized,
  role: row.role,
  classIds: JSON.parse(row.class_ids_json) as string[],
  createdByUserId: row.created_by_user_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  acceptedAt: row.accepted_at,
  acceptedByUserId: row.accepted_by_user_id ?? undefined,
  revokedAt: row.revoked_at,
});

const serializeWorkspace = (data: AppData) => {
  const dataJson = JSON.stringify(data);
  const dataSizeBytes = new TextEncoder().encode(dataJson).byteLength;
  if (dataSizeBytes > MAX_D1_STATE_BYTES) {
    throw new WorkspaceDataTooLargeError();
  }
  return { dataJson, dataSizeBytes };
};

const auditMetadataJson = (event: AuditEventRecord) =>
  JSON.stringify(event.metadata ?? {});

const createProjectionWriteToken = () => crypto.randomUUID();

export class D1WorkspaceRepository
implements WorkspaceRepository, AuthRepository {
  constructor(
    private readonly database: D1Database,
    private readonly options: D1WorkspaceRepositoryOptions = {},
  ) {}

  async get(workspaceId: string): Promise<StoredWorkspace> {
    const metadata = await this.database
      .prepare(
        `SELECT revision, updated_at
         FROM workspaces
         WHERE workspace_id = ?`,
      )
      .bind(workspaceId)
      .first<WorkspaceMetadataRow>();
    if (!metadata) return emptyWorkspace();
    if (this.options.readMode === 'blob') {
      return this.getBlobWorkspace(workspaceId);
    }

    try {
      const projection = await this.loadNormalizedProjection(
        workspaceId,
        metadata.revision,
      );
      if (projection) {
        const projectionChecksum = await checksumData(projection.data);
        if (
          projection.document.reconciliation_status === 'verified' &&
          projection.document.projection_checksum === projectionChecksum
        ) {
          if (this.options.readMode !== 'verify') {
            return {
              revision: metadata.revision,
              updatedAt: metadata.updated_at,
              data: projection.data,
            };
          }
        } else {
          const blob = await this.getBlobWorkspace(workspaceId);
          const matched = await this.recordProjectionComparison(
            blob,
            projection,
            projectionChecksum,
          );
          if (matched && this.options.readMode !== 'verify') {
            return {
              revision: blob.revision,
              updatedAt: blob.updatedAt,
              data: projection.data,
            };
          }
          return blob;
        }
      }
    } catch (error) {
      console.error('Normalized workspace read failed; using blob fallback', {
        workspaceId,
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
    return this.getBlobWorkspace(workspaceId);
  }

  private async getBlobWorkspace(workspaceId: string): Promise<StoredWorkspace> {
    const row = await this.database
      .prepare(
        `SELECT revision, updated_at, data_json
         FROM workspaces
         WHERE workspace_id = ?`,
      )
      .bind(workspaceId)
      .first<WorkspaceRow>();
    return decodeWorkspace(row);
  }

  private async loadNormalizedProjection(
    workspaceId: string,
    revision: number,
  ): Promise<NormalizedProjection | null> {
    const results = await this.database.batch([
      this.database
        .prepare(
          `SELECT workspace_id, source_revision, root_json,
                  reconciliation_status, source_checksum,
                  projection_checksum, reconciled_at, details_json
           FROM workspace_projection_documents
           WHERE workspace_id = ? AND source_revision = ?`,
        )
        .bind(workspaceId, revision),
      this.database
        .prepare(
          `SELECT class_id, sort_index, record_json
           FROM classes
           WHERE workspace_id = ? AND source_revision = ?
           ORDER BY sort_index, class_id`,
        )
        .bind(workspaceId, revision),
      this.database
        .prepare(
          `SELECT class_id, student_id, sort_index, record_json
           FROM students
           WHERE workspace_id = ? AND source_revision = ?
           ORDER BY class_id, sort_index, student_id`,
        )
        .bind(workspaceId, revision),
      this.database
        .prepare(
          `SELECT class_id, exam_id, sort_index, record_json
           FROM exam_records
           WHERE workspace_id = ? AND source_revision = ?
           ORDER BY class_id, sort_index, exam_id`,
        )
        .bind(workspaceId, revision),
      this.database
        .prepare(
          `SELECT class_id, exam_id, student_id, sort_index, record_json
           FROM exam_results
           WHERE workspace_id = ? AND source_revision = ?
           ORDER BY class_id, exam_id, sort_index, student_id`,
        )
        .bind(workspaceId, revision),
      this.database
        .prepare(
          `SELECT class_id, sort_index, record_json
           FROM learning_evidence
           WHERE workspace_id = ? AND source_revision = ?
           ORDER BY class_id, sort_index, evidence_id`,
        )
        .bind(workspaceId, revision),
      this.database
        .prepare(
          `SELECT class_id, student_id, sort_index, record_json
           FROM point_adjustments
           WHERE workspace_id = ? AND source_revision = ?
           ORDER BY class_id, student_id, sort_index, adjustment_id`,
        )
        .bind(workspaceId, revision),
      this.database
        .prepare(
          `SELECT class_id, student_id, sort_index, record_json
           FROM discipline_records
           WHERE workspace_id = ? AND source_revision = ?
           ORDER BY class_id, student_id, sort_index, discipline_id`,
        )
        .bind(workspaceId, revision),
      this.database
        .prepare(
          `SELECT class_id, student_id, sort_index, record_json
           FROM boss_rewards
           WHERE workspace_id = ? AND source_revision = ?
           ORDER BY class_id, student_id, sort_index, reward_id`,
        )
        .bind(workspaceId, revision),
    ]);
    const rows = <T>(index: number) =>
      (results[index]?.results ?? []) as unknown as T[];
    const document = rows<ProjectionDocumentRow>(0)[0];
    if (!document) return null;

    const classRows = rows<ProjectionRecordRow>(1);
    const studentRows = rows<ProjectionRecordRow>(2);
    const examRows = rows<ProjectionRecordRow>(3);
    const examResultRows = rows<ProjectionRecordRow>(4);
    const evidenceRows = rows<ProjectionRecordRow>(5);
    const adjustmentRows = rows<ProjectionRecordRow>(6);
    const disciplineRows = rows<ProjectionRecordRow>(7);
    const rewardRows = rows<ProjectionRecordRow>(8);
    const classes = classRows.map((row) => {
      const classroom = JSON.parse(row.record_json) as ClassData;
      classroom.students = [];
      if (Array.isArray(classroom.examRecords)) classroom.examRecords = [];
      if (Array.isArray(classroom.learningEvidenceRecords)) {
        classroom.learningEvidenceRecords = [];
      }
      return classroom;
    });
    const classesById = new Map(classes.map((classroom) => [
      classroom.id,
      classroom,
    ]));
    const studentsById = new Map<string, Student>();

    for (const row of studentRows) {
      const classroom = classesById.get(row.class_id);
      if (!classroom) continue;
      const student = JSON.parse(row.record_json) as Student;
      if (Array.isArray(student.pointAdjustmentRecords)) {
        student.pointAdjustmentRecords = [];
      }
      if (Array.isArray(student.disciplineRecords)) {
        student.disciplineRecords = [];
      }
      if (Array.isArray(student.bossRewardRecords)) {
        student.bossRewardRecords = [];
      }
      classroom.students.push(student);
      studentsById.set(`${row.class_id}:${student.id}`, student);
    }

    const appendStudentRecord = (
      row: ProjectionRecordRow,
      key: 'pointAdjustmentRecords' | 'disciplineRecords' |
        'bossRewardRecords',
    ) => {
      const student = studentsById.get(`${row.class_id}:${row.student_id}`);
      if (!student) return;
      const records = student[key] ?? [];
      (records as unknown[]).push(JSON.parse(row.record_json));
      (student as unknown as Record<string, unknown>)[key] = records;
    };
    adjustmentRows.forEach((row) =>
      appendStudentRecord(row, 'pointAdjustmentRecords'));
    disciplineRows.forEach((row) =>
      appendStudentRecord(row, 'disciplineRecords'));
    rewardRows.forEach((row) =>
      appendStudentRecord(row, 'bossRewardRecords'));

    const examsById = new Map<string, ExamRecord>();
    for (const row of examRows) {
      const classroom = classesById.get(row.class_id);
      if (!classroom) continue;
      const exam = JSON.parse(row.record_json) as ExamRecord;
      exam.results = [];
      classroom.examRecords ??= [];
      classroom.examRecords.push(exam);
      examsById.set(`${row.class_id}:${exam.id}`, exam);
    }
    for (const row of examResultRows) {
      const exam = examsById.get(`${row.class_id}:${row.exam_id}`);
      if (exam) exam.results.push(JSON.parse(row.record_json));
    }
    for (const row of evidenceRows) {
      const classroom = classesById.get(row.class_id);
      if (!classroom) continue;
      classroom.learningEvidenceRecords ??= [];
      classroom.learningEvidenceRecords.push(JSON.parse(row.record_json));
    }

    const root = JSON.parse(document.root_json) as Omit<AppData, 'classes'>;
    return {
      document,
      data: { ...root, classes },
    };
  }

  private async setProjectionStatus(
    workspaceId: string,
    revision: number,
    status: ProjectionStatus,
    sourceChecksum: string,
    projectionChecksum: string,
    expectedCounts: Record<string, number>,
    actualCounts: Record<string, number>,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE workspace_projection_documents
         SET reconciliation_status = ?, source_checksum = ?,
             projection_checksum = ?, reconciled_at = ?, details_json = ?
         WHERE workspace_id = ? AND source_revision = ?`,
      )
      .bind(
        status,
        sourceChecksum,
        projectionChecksum,
        Date.now(),
        JSON.stringify({ expectedCounts, actualCounts }),
        workspaceId,
        revision,
      )
      .run();
  }

  private async recordProjectionComparison(
    blob: StoredWorkspace,
    projection: NormalizedProjection,
    knownProjectionChecksum?: string,
  ): Promise<boolean> {
    if (!blob.data || blob.revision !== projection.document.source_revision) {
      return false;
    }
    const [sourceChecksum, projectionChecksum] = await Promise.all([
      checksumData(blob.data),
      knownProjectionChecksum
        ? Promise.resolve(knownProjectionChecksum)
        : checksumData(projection.data),
    ]);
    const matched = sourceChecksum === projectionChecksum;
    await this.setProjectionStatus(
      projection.document.workspace_id,
      blob.revision,
      matched ? 'verified' : 'mismatch',
      sourceChecksum,
      projectionChecksum,
      workspaceEntityCounts(blob.data),
      workspaceEntityCounts(projection.data),
    );
    return matched;
  }

  private async rebuildProjection(
    workspaceId: string,
    revision: number,
  ): Promise<void> {
    const writeToken = createProjectionWriteToken();
    await this.database.batch([
      this.projectionRebuildGateStatement(
        workspaceId,
        revision,
        writeToken,
        Date.now(),
      ),
      ...this.projectionStatements(workspaceId, revision, writeToken),
    ]);
  }

  async reconcileWorkspaceProjection(
    workspaceId: string,
    repair = true,
  ): Promise<WorkspaceProjectionReconciliationResult> {
    const blob = await this.getBlobWorkspace(workspaceId);
    if (!blob.data) {
      return {
        workspaceId,
        revision: 0,
        status: 'missing',
        repaired: false,
      };
    }
    let projection = await this.loadNormalizedProjection(
      workspaceId,
      blob.revision,
    );
    let repaired = false;
    if (projection && await this.recordProjectionComparison(blob, projection)) {
      return {
        workspaceId,
        revision: blob.revision,
        status: 'verified',
        repaired,
        expectedCounts: workspaceEntityCounts(blob.data),
        actualCounts: workspaceEntityCounts(projection.data),
      };
    }
    if (repair) {
      await this.rebuildProjection(workspaceId, blob.revision);
      repaired = true;
      projection = await this.loadNormalizedProjection(
        workspaceId,
        blob.revision,
      );
      if (
        projection &&
        await this.recordProjectionComparison(blob, projection)
      ) {
        return {
          workspaceId,
          revision: blob.revision,
          status: 'verified',
          repaired,
          expectedCounts: workspaceEntityCounts(blob.data),
          actualCounts: workspaceEntityCounts(projection.data),
        };
      }
    }
    return {
      workspaceId,
      revision: blob.revision,
      status: projection ? 'mismatch' : 'missing',
      repaired,
      expectedCounts: workspaceEntityCounts(blob.data),
      actualCounts: projection
        ? workspaceEntityCounts(projection.data)
        : undefined,
    };
  }

  async reconcileWorkspaceProjections(options: {
    repair?: boolean;
    batchSize?: number;
    maxBatches?: number;
  } = {}): Promise<WorkspaceProjectionReconciliationReport> {
    const repair = options.repair ?? true;
    const batchSize = Math.max(1, Math.min(100, options.batchSize ?? 50));
    const maxBatches = Math.max(1, Math.min(100, options.maxBatches ?? 10));
    const report: WorkspaceProjectionReconciliationReport = {
      checked: 0,
      verified: 0,
      mismatched: 0,
      missing: 0,
      repaired: 0,
      truncated: false,
    };
    let cursor = '';
    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
      const result = await this.database
        .prepare(
          `SELECT workspace_id
           FROM workspaces
           WHERE workspace_id > ?
           ORDER BY workspace_id
           LIMIT ?`,
        )
        .bind(cursor, batchSize + 1)
        .all<{ workspace_id: string }>();
      const hasMore = result.results.length > batchSize;
      const rows = result.results.slice(0, batchSize);
      for (const row of rows) {
        const reconciliation = await this.reconcileWorkspaceProjection(
          row.workspace_id,
          repair,
        );
        report.checked += 1;
        if (reconciliation.status === 'verified') report.verified += 1;
        if (reconciliation.status === 'mismatch') report.mismatched += 1;
        if (reconciliation.status === 'missing') report.missing += 1;
        if (reconciliation.repaired) report.repaired += 1;
      }
      if (!hasMore || rows.length === 0) return report;
      cursor = rows.at(-1)?.workspace_id ?? cursor;
    }
    report.truncated = true;
    return report;
  }

  async put(
    workspaceId: string,
    data: AppData,
    baseRevision?: number,
    context: WorkspaceWriteContext = {},
  ): Promise<StoredWorkspace> {
    const { dataJson } = serializeWorkspace(data);
    const current = await this.get(workspaceId);
    const expectedRevision = baseRevision ?? current.revision;
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision !== current.revision
    ) {
      throw new WorkspaceConflictError(current);
    }

    const updatedAt = Date.now();
    const nextRevision = current.revision + 1;
    const writeToken = createProjectionWriteToken();
    const deletedStudentIds = findPermanentlyDeletedStudentIds(
      current.data,
      data,
    );
    const revisionPurgeStatements: D1PreparedStatement[] = [];
    if (deletedStudentIds.size > 0) {
      const snapshots = await this.database
        .prepare(
          `SELECT workspace_id, revision, updated_at, actor_user_id,
                  data_size_bytes, data_json
           FROM workspace_revisions
           WHERE workspace_id = ?`,
        )
        .bind(workspaceId)
        .all<RevisionSnapshotRow>();
      for (const snapshot of snapshots.results) {
        const purged = serializeWorkspace(purgeStudentsFromWorkspaceData(
          JSON.parse(snapshot.data_json) as AppData,
          deletedStudentIds,
        ));
        revisionPurgeStatements.push(
          this.database
            .prepare(
              `UPDATE workspace_revisions
               SET data_json = ?, data_size_bytes = ?
               WHERE workspace_id = ? AND revision = ?
                 AND EXISTS (
                   SELECT 1 FROM workspace_projection_state
                   WHERE workspace_id = ? AND source_revision = ?
                     AND write_token = ?
                 )`,
            )
            .bind(
              purged.dataJson,
              purged.dataSizeBytes,
              workspaceId,
              snapshot.revision,
              workspaceId,
              nextRevision,
              writeToken,
            ),
        );
      }
    }
    const writeStatement = current.revision === 0
      ? this.database
          .prepare(
            `INSERT OR IGNORE INTO workspaces
               (workspace_id, revision, updated_at, data_json)
             VALUES (?, 1, ?, ?)`,
          )
          .bind(workspaceId, updatedAt, dataJson)
      : this.database
          .prepare(
            `UPDATE workspaces
             SET revision = revision + 1, updated_at = ?, data_json = ?
             WHERE workspace_id = ? AND revision = ?`,
          )
          .bind(updatedAt, dataJson, workspaceId, expectedRevision);

    const statements: D1PreparedStatement[] = [
      writeStatement,
      this.projectionGateStatement(
        workspaceId,
        nextRevision,
        writeToken,
        updatedAt,
        true,
      ),
      ...revisionPurgeStatements,
      this.database
        .prepare(
          `UPDATE workspace_revisions
           SET actor_user_id = ?
           WHERE
             workspace_id = ? AND
             revision = ? AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = ? AND
                 source_revision = ? AND
                 write_token = ?
             )`,
        )
        .bind(
          context.actorUserId ?? null,
          workspaceId,
          nextRevision,
          workspaceId,
          nextRevision,
          writeToken,
        ),
      ...this.projectionStatements(workspaceId, nextRevision, writeToken),
      this.workspaceAuditStatement(
        workspaceId,
        nextRevision,
        updatedAt,
        context,
        writeToken,
      ),
      ...(deletedStudentIds.size > 0
        ? [this.workspaceAuditStatement(
            workspaceId,
            nextRevision,
            updatedAt,
            {
              actorUserId: context.actorUserId,
              action: 'privacy.student.purge',
              requestId: `evt_privacy_student_${workspaceId}_${nextRevision}`,
            },
            writeToken,
          )]
        : []),
    ];

    const [writeResult] = await this.database.batch(statements);
    // D1 includes writes performed by the workspace revision trigger in the
    // statement's change count, so a successful workspace write can report
    // more than one changed row. Zero remains the compare-and-swap failure.
    if ((writeResult.meta.changes ?? 0) < 1) {
      throw new WorkspaceConflictError(await this.get(workspaceId));
    }

    return {
      revision: nextRevision,
      updatedAt,
      data,
    };
  }

  async findUserByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<AuthUserRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT
           user_id,
           email,
           email_normalized,
           email_verified_at,
           display_name,
           status,
           password_algorithm,
           password_salt,
           password_hash,
           password_iterations,
           created_at,
           updated_at,
           password_changed_at
         FROM users
         WHERE email_normalized = ?`,
      )
      .bind(normalizedEmail)
      .first<UserRow>();
    return decodeUser(row);
  }

  async getUserById(userId: string): Promise<AuthUserRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT
           user_id,
           email,
           email_normalized,
           email_verified_at,
           display_name,
           status,
           password_algorithm,
           password_salt,
           password_hash,
           password_iterations,
           created_at,
           updated_at,
           password_changed_at
         FROM users
         WHERE user_id = ?`,
      )
      .bind(userId)
      .first<UserRow>();
    return decodeUser(row);
  }

  async createUserWithWorkspace(
    input: CreateUserWithWorkspaceInput,
  ): Promise<void> {
    if (
      await this.findUserByNormalizedEmail(input.user.normalizedEmail)
    ) {
      throw new EmailAlreadyExistsError();
    }
    const { dataJson } = serializeWorkspace(input.workspace.data);
    const {
      user,
      emailVerificationToken,
      workspace,
      membership,
      auditEvent,
    } = input;
    const projectionWriteToken = createProjectionWriteToken();

    try {
      await this.database.batch([
        this.database
          .prepare(
            `INSERT INTO users (
               user_id,
               email,
               email_normalized,
               email_verified_at,
               display_name,
               status,
               password_algorithm,
               password_salt,
               password_hash,
               password_iterations,
               created_at,
               updated_at,
               password_changed_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            user.id,
            user.email,
            user.normalizedEmail,
            user.emailVerifiedAt,
            user.displayName,
            user.status,
            user.password.algorithm,
            user.password.salt,
            user.password.hash,
            user.password.iterations,
            user.createdAt,
            user.updatedAt,
            user.passwordChangedAt,
          ),
        ...(emailVerificationToken
          ? [this.database
              .prepare(
                `INSERT INTO email_verification_tokens (
                   token_hash, user_id, created_at, expires_at, used_at
                 )
                 VALUES (?, ?, ?, ?, NULL)`,
              )
              .bind(
                emailVerificationToken.tokenHash,
                emailVerificationToken.userId,
                emailVerificationToken.createdAt,
                emailVerificationToken.expiresAt,
              )]
          : []),
        this.database
          .prepare(
            `INSERT INTO workspaces (
               workspace_id,
               revision,
               updated_at,
               data_json,
               name,
               created_at
             )
             VALUES (?, 1, ?, ?, ?, ?)`,
          )
          .bind(
            workspace.id,
            workspace.createdAt,
            dataJson,
            workspace.name,
            workspace.createdAt,
          ),
        this.projectionGateStatement(
          workspace.id,
          1,
          projectionWriteToken,
          workspace.createdAt,
          false,
        ),
        ...this.projectionStatements(
          workspace.id,
          1,
          projectionWriteToken,
        ),
        this.database
          .prepare(
            `UPDATE workspace_revisions
             SET actor_user_id = ?
             WHERE workspace_id = ? AND revision = 1`,
          )
          .bind(membership.userId, workspace.id),
        this.database
          .prepare(
            `INSERT INTO workspace_claims (
               workspace_id,
               claimed_by_user_id,
               claimed_at
             )
             VALUES (?, ?, ?)`,
          )
          .bind(workspace.id, membership.userId, membership.createdAt),
        this.database
          .prepare(
            `INSERT INTO workspace_memberships (
               workspace_id,
               user_id,
               role,
               created_at,
               created_by_user_id
             )
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            membership.workspaceId,
            membership.userId,
            membership.role,
            membership.createdAt,
            membership.createdByUserId ?? null,
          ),
        this.auditStatement(auditEvent),
      ]);
    } catch (error) {
      if (
        await this.findUserByNormalizedEmail(user.normalizedEmail)
      ) {
        throw new EmailAlreadyExistsError();
      }
      throw error;
    }
  }

  async createWorkspaceForUser(
    input: CreateWorkspaceForUserInput,
  ): Promise<void> {
    const { dataJson } = serializeWorkspace(input.workspace.data);
    const { workspace, membership, auditEvent } = input;
    const projectionWriteToken = createProjectionWriteToken();
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO workspaces (
             workspace_id,
             revision,
             updated_at,
             data_json,
             name,
             created_at
           )
           VALUES (?, 1, ?, ?, ?, ?)`,
        )
        .bind(
          workspace.id,
          workspace.createdAt,
          dataJson,
          workspace.name,
          workspace.createdAt,
        ),
      this.projectionGateStatement(
        workspace.id,
        1,
        projectionWriteToken,
        workspace.createdAt,
        false,
      ),
      ...this.projectionStatements(
        workspace.id,
        1,
        projectionWriteToken,
      ),
      this.database
        .prepare(
          `UPDATE workspace_revisions
           SET actor_user_id = ?
           WHERE workspace_id = ? AND revision = 1`,
        )
        .bind(membership.userId, workspace.id),
      this.database
        .prepare(
          `INSERT INTO workspace_claims (
             workspace_id,
             claimed_by_user_id,
             claimed_at
           )
           VALUES (?, ?, ?)`,
        )
        .bind(workspace.id, membership.userId, membership.createdAt),
      this.database
        .prepare(
          `INSERT INTO workspace_memberships (
             workspace_id,
             user_id,
             role,
             created_at,
             created_by_user_id
           )
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          membership.workspaceId,
          membership.userId,
          membership.role,
          membership.createdAt,
          membership.createdByUserId ?? null,
        ),
      this.auditStatement(auditEvent),
    ]);
  }

  async listUserWorkspaces(userId: string): Promise<UserWorkspaceAccess[]> {
    const result = await this.database
      .prepare(
        `SELECT
           memberships.workspace_id,
           workspaces.name,
           memberships.role
         FROM workspace_memberships AS memberships
         INNER JOIN workspaces
           ON workspaces.workspace_id = memberships.workspace_id
         WHERE memberships.user_id = ?
         ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC`,
      )
      .bind(userId)
      .all<UserWorkspaceRow>();
    return result.results.map((row) => ({
      id: row.workspace_id,
      name: row.name,
      role: row.role,
    }));
  }

  async getWorkspaceMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT
           workspace_id,
           user_id,
           role,
           created_at,
           created_by_user_id
         FROM workspace_memberships
         WHERE workspace_id = ? AND user_id = ?`,
      )
      .bind(workspaceId, userId)
      .first<MembershipRow>();
    return decodeMembership(row);
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const result = await this.database
      .prepare(
        `SELECT
           memberships.user_id,
           users.email,
           users.display_name,
           memberships.role,
           memberships.created_at
         FROM workspace_memberships AS memberships
         INNER JOIN users ON users.user_id = memberships.user_id
         WHERE memberships.workspace_id = ?
         ORDER BY memberships.created_at ASC, memberships.user_id ASC`,
      )
      .bind(workspaceId)
      .all<{
        user_id: string;
        email: string;
        display_name: string;
        role: WorkspaceMembershipRecord['role'];
        created_at: number;
      }>();
    return Promise.all(result.results.map(async (row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      classIds: await this.listWorkspaceClassIds(workspaceId, row.user_id),
      createdAt: row.created_at,
    })));
  }

  async updateWorkspaceMember(
    input: UpdateWorkspaceMemberInput,
  ): Promise<void> {
    const current = await this.getWorkspaceMembership(
      input.workspaceId,
      input.userId,
    );
    if (!current || current.role === 'owner') {
      throw new WorkspaceMembershipNotFoundError();
    }
    const classIds = [...new Set(input.classIds)].filter(Boolean);
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          `UPDATE workspace_memberships
           SET role = ?, created_by_user_id = ?
           WHERE workspace_id = ? AND user_id = ? AND role <> 'owner'`,
        )
        .bind(
          input.role,
          input.actorUserId,
          input.workspaceId,
          input.userId,
        ),
      this.database
        .prepare(
          `DELETE FROM workspace_class_assignments
           WHERE workspace_id = ? AND user_id = ?`,
        )
        .bind(input.workspaceId, input.userId),
    ];
    if (input.role === 'teacher' || input.role === 'viewer') {
      statements.push(...classIds.map((classId) => this.database
        .prepare(
          `INSERT INTO workspace_class_assignments (
             workspace_id, user_id, class_id, created_at, created_by_user_id
           )
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          input.workspaceId,
          input.userId,
          classId,
          input.updatedAt,
          input.actorUserId,
        )));
    }
    statements.push(this.auditStatement(input.auditEvent));
    await this.database.batch(statements);
  }

  async removeWorkspaceMember(
    input: RemoveWorkspaceMemberInput,
  ): Promise<void> {
    const current = await this.getWorkspaceMembership(
      input.workspaceId,
      input.userId,
    );
    if (!current || current.role === 'owner') {
      throw new WorkspaceMembershipNotFoundError();
    }
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE auth_sessions
           SET active_workspace_id = NULL, last_seen_at = ?
           WHERE user_id = ? AND active_workspace_id = ?`,
        )
        .bind(input.removedAt, input.userId, input.workspaceId),
      this.database
        .prepare(
          `DELETE FROM workspace_memberships
           WHERE workspace_id = ? AND user_id = ? AND role <> 'owner'`,
        )
        .bind(input.workspaceId, input.userId),
      this.auditStatement(input.auditEvent),
    ]);
  }

  async transferWorkspaceOwnership(
    input: TransferWorkspaceOwnershipInput,
  ): Promise<void> {
    const [source, target] = await Promise.all([
      this.getWorkspaceMembership(input.workspaceId, input.fromUserId),
      this.getWorkspaceMembership(input.workspaceId, input.toUserId),
    ]);
    if (source?.role !== 'owner' || !target || target.role === 'owner') {
      throw new WorkspaceMembershipNotFoundError();
    }
    await this.database.batch([
      this.database
        .prepare(
          `DELETE FROM workspace_class_assignments
           WHERE workspace_id = ? AND user_id IN (?, ?)`,
        )
        .bind(input.workspaceId, input.fromUserId, input.toUserId),
      this.database
        .prepare(
          `UPDATE workspace_memberships
           SET role = 'admin'
           WHERE workspace_id = ? AND user_id = ? AND role = 'owner'`,
        )
        .bind(input.workspaceId, input.fromUserId),
      this.database
        .prepare(
          `UPDATE workspace_memberships
           SET role = 'owner', created_by_user_id = ?
           WHERE workspace_id = ? AND user_id = ?`,
        )
        .bind(input.fromUserId, input.workspaceId, input.toUserId),
      this.database
        .prepare(
          `UPDATE workspace_claims
           SET claimed_by_user_id = ?, claimed_at = ?
           WHERE workspace_id = ?`,
        )
        .bind(input.toUserId, input.transferredAt, input.workspaceId),
      this.auditStatement(input.auditEvent),
    ]);
  }

  async deleteWorkspace(input: DeleteWorkspaceInput): Promise<void> {
    const existing = await this.get(input.workspaceId);
    if (!existing.data) throw new WorkspaceNotFoundError();
    await this.database.batch([
      this.database
        .prepare('DELETE FROM audit_events WHERE workspace_id = ?')
        .bind(input.workspaceId),
      this.database
        .prepare('DELETE FROM workspaces WHERE workspace_id = ?')
        .bind(input.workspaceId),
      this.auditStatement(input.auditEvent),
    ]);
  }

  async deleteUser(input: DeleteUserInput): Promise<void> {
    const owned = await this.database
      .prepare(
        `SELECT workspace_id
         FROM workspace_memberships
         WHERE user_id = ? AND role = 'owner'
         LIMIT 1`,
      )
      .bind(input.userId)
      .first<{ workspace_id: string }>();
    const claimed = await this.database
      .prepare(
        `SELECT workspace_id
         FROM workspace_claims
         WHERE claimed_by_user_id = ?
         LIMIT 1`,
      )
      .bind(input.userId)
      .first<{ workspace_id: string }>();
    if (owned || claimed) throw new WorkspaceOwnerTransferRequiredError();
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE audit_events
           SET actor_user_id = NULL
           WHERE actor_user_id = ?`,
        )
        .bind(input.userId),
      this.database
        .prepare('DELETE FROM users WHERE user_id = ?')
        .bind(input.userId),
      this.auditStatement(input.auditEvent),
    ]);
  }

  async cleanupExpiredAuthData(now: number): Promise<AuthCleanupResult> {
    const results = await this.database.batch([
      this.database
        .prepare(
          `DELETE FROM auth_sessions
           WHERE expires_at <= ? OR revoked_at IS NOT NULL`,
        )
        .bind(now),
      this.database
        .prepare(
          `DELETE FROM password_reset_tokens
           WHERE expires_at <= ? OR used_at IS NOT NULL`,
        )
        .bind(now),
      this.database
        .prepare(
          `DELETE FROM email_verification_tokens
           WHERE expires_at <= ? OR used_at IS NOT NULL`,
        )
        .bind(now),
      this.database
        .prepare(
          `DELETE FROM auth_rate_limits
           WHERE blocked_until <= ? AND window_started_at <= ?`,
        )
        .bind(now, now - 86_400_000),
      this.database
        .prepare(
          `DELETE FROM workspace_invitations
           WHERE expires_at <= ? OR accepted_at IS NOT NULL OR revoked_at IS NOT NULL`,
        )
        .bind(now),
    ]);
    return {
      sessions: results[0].meta.changes ?? 0,
      passwordResetTokens: results[1].meta.changes ?? 0,
      emailVerificationTokens: results[2].meta.changes ?? 0,
      rateLimits: results[3].meta.changes ?? 0,
      invitations: results[4].meta.changes ?? 0,
    };
  }

  async createWorkspaceInvitation(
    invitation: WorkspaceInvitationRecord,
  ): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE workspace_invitations
           SET revoked_at = ?
           WHERE workspace_id = ? AND email_normalized = ?
             AND accepted_at IS NULL AND revoked_at IS NULL`,
        )
        .bind(
          invitation.createdAt,
          invitation.workspaceId,
          invitation.normalizedEmail,
        ),
      this.database
        .prepare(
          `INSERT INTO workspace_invitations (
             invitation_id, token_hash, workspace_id, email, email_normalized,
             role, class_ids_json, created_by_user_id, created_at, expires_at,
             accepted_at, accepted_by_user_id, revoked_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
        )
        .bind(
          invitation.id,
          invitation.tokenHash,
          invitation.workspaceId,
          invitation.email,
          invitation.normalizedEmail,
          invitation.role,
          JSON.stringify(invitation.classIds),
          invitation.createdByUserId,
          invitation.createdAt,
          invitation.expiresAt,
        ),
    ]);
  }

  async getWorkspaceInvitationByTokenHash(
    tokenHash: string,
  ): Promise<WorkspaceInvitationRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT invitation_id, token_hash, workspace_id, email,
                email_normalized, role, class_ids_json, created_by_user_id,
                created_at, expires_at, accepted_at, accepted_by_user_id,
                revoked_at
         FROM workspace_invitations
         WHERE token_hash = ?`,
      )
      .bind(tokenHash)
      .first<InvitationRow>();
    return row ? decodeInvitation(row) : null;
  }

  async listWorkspaceInvitations(
    workspaceId: string,
  ): Promise<WorkspaceInvitationSummary[]> {
    const result = await this.database
      .prepare(
        `SELECT invitation_id, token_hash, workspace_id, email,
                email_normalized, role, class_ids_json, created_by_user_id,
                created_at, expires_at, accepted_at, accepted_by_user_id,
                revoked_at
         FROM workspace_invitations
         WHERE workspace_id = ?
         ORDER BY created_at DESC`,
      )
      .bind(workspaceId)
      .all<InvitationRow>();
    return result.results.map((row) => {
      const { tokenHash: _tokenHash, ...summary } = decodeInvitation(row);
      return summary;
    });
  }

  async revokeWorkspaceInvitation(
    workspaceId: string,
    invitationId: string,
    revokedAt: number,
    auditEvent: AuditEventRecord,
  ): Promise<void> {
    const result = await this.database.batch([
      this.database
        .prepare(
          `UPDATE workspace_invitations
           SET revoked_at = ?
           WHERE invitation_id = ? AND workspace_id = ?
             AND accepted_at IS NULL AND revoked_at IS NULL`,
        )
        .bind(revokedAt, invitationId, workspaceId),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             event_id, workspace_id, actor_user_id, action, target_type,
             target_id, metadata_json, created_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
           FROM workspace_invitations
           WHERE invitation_id = ? AND workspace_id = ? AND revoked_at = ?`,
        )
        .bind(
          auditEvent.id,
          auditEvent.workspaceId ?? null,
          auditEvent.actorUserId ?? null,
          auditEvent.action,
          auditEvent.targetType ?? null,
          auditEvent.targetId ?? null,
          auditMetadataJson(auditEvent),
          auditEvent.createdAt,
          invitationId,
          workspaceId,
          revokedAt,
        ),
    ]);
    if ((result[0].meta.changes ?? 0) !== 1) {
      throw new InvalidWorkspaceInvitationError();
    }
  }

  async acceptWorkspaceInvitation(
    input: AcceptWorkspaceInvitationInput,
  ): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    if (input.createUser) {
      statements.push(this.database
        .prepare(
          `INSERT INTO users (
             user_id, email, email_normalized, email_verified_at,
             display_name, status,
             password_algorithm, password_salt, password_hash,
             password_iterations, created_at, updated_at, password_changed_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM workspace_invitations
           WHERE invitation_id = ? AND token_hash = ?
             AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
        )
        .bind(
          input.user.id,
          input.user.email,
          input.user.normalizedEmail,
          input.user.emailVerifiedAt,
          input.user.displayName,
          input.user.status,
          input.user.password.algorithm,
          input.user.password.salt,
          input.user.password.hash,
          input.user.password.iterations,
          input.user.createdAt,
          input.user.updatedAt,
          input.user.passwordChangedAt,
          input.invitation.id,
          input.tokenHash,
          input.acceptedAt,
        ));
    } else {
      statements.push(this.database
        .prepare(
          `UPDATE users
           SET email_verified_at = COALESCE(email_verified_at, ?),
               updated_at = CASE
                 WHEN email_verified_at IS NULL THEN ?
                 ELSE updated_at
               END
           WHERE user_id = ? AND status = 'active'
             AND EXISTS (
               SELECT 1
               FROM workspace_invitations
               WHERE invitation_id = ? AND token_hash = ?
                 AND email_normalized = users.email_normalized
                 AND accepted_at IS NULL AND revoked_at IS NULL
                 AND expires_at > ?
             )`,
        )
        .bind(
          input.acceptedAt,
          input.acceptedAt,
          input.user.id,
          input.invitation.id,
          input.tokenHash,
          input.acceptedAt,
        ));
    }
    const invitationUpdateIndex = statements.length;
    statements.push(
      this.database
        .prepare(
          `UPDATE workspace_invitations
           SET accepted_at = ?, accepted_by_user_id = ?
           WHERE token_hash = ? AND invitation_id = ?
             AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
        )
        .bind(
          input.acceptedAt,
          input.user.id,
          input.tokenHash,
          input.invitation.id,
          input.acceptedAt,
        ),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO workspace_memberships (
             workspace_id, user_id, role, created_at, created_by_user_id
           )
           SELECT workspace_id, ?, role, ?, created_by_user_id
           FROM workspace_invitations
           WHERE invitation_id = ? AND accepted_at = ? AND accepted_by_user_id = ?`,
        )
        .bind(
          input.user.id,
          input.acceptedAt,
          input.invitation.id,
          input.acceptedAt,
          input.user.id,
        ),
    );
    if (
      input.membership.role === 'teacher' ||
      input.membership.role === 'viewer'
    ) {
      statements.push(...input.invitation.classIds.map((classId) =>
        this.database
          .prepare(
            `INSERT OR IGNORE INTO workspace_class_assignments (
               workspace_id, user_id, class_id, created_at, created_by_user_id
             )
             SELECT ?, ?, classes.class_id, ?, ?
             FROM classes
             INNER JOIN workspace_invitations AS invitations
               ON invitations.invitation_id = ?
               AND invitations.accepted_at = ?
               AND invitations.accepted_by_user_id = ?
             WHERE classes.workspace_id = ? AND classes.class_id = ?`,
          )
          .bind(
            input.invitation.workspaceId,
            input.user.id,
            input.acceptedAt,
            input.invitation.createdByUserId,
            input.invitation.id,
            input.acceptedAt,
            input.user.id,
            input.invitation.workspaceId,
            classId,
          ),
      ));
    }
    statements.push(this.database
      .prepare(
        `INSERT INTO audit_events (
           event_id, workspace_id, actor_user_id, action, target_type,
           target_id, metadata_json, created_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         FROM workspace_invitations
         WHERE invitation_id = ? AND accepted_at = ?
           AND accepted_by_user_id = ?`,
      )
      .bind(
        input.auditEvent.id,
        input.auditEvent.workspaceId ?? null,
        input.auditEvent.actorUserId ?? null,
        input.auditEvent.action,
        input.auditEvent.targetType ?? null,
        input.auditEvent.targetId ?? null,
        auditMetadataJson(input.auditEvent),
        input.auditEvent.createdAt,
        input.invitation.id,
        input.acceptedAt,
        input.user.id,
      ));
    const results = await this.database.batch(statements);
    if ((results[invitationUpdateIndex].meta.changes ?? 0) !== 1) {
      const membership = await this.getWorkspaceMembership(
        input.invitation.workspaceId,
        input.user.id,
      );
      if (!membership) throw new InvalidWorkspaceInvitationError();
    }
  }

  async listWorkspaceClassIds(
    workspaceId: string,
    userId: string,
  ): Promise<string[]> {
    const result = await this.database
      .prepare(
        `SELECT assignments.class_id
         FROM workspace_class_assignments AS assignments
         INNER JOIN workspace_memberships AS memberships
           ON memberships.workspace_id = assignments.workspace_id
           AND memberships.user_id = assignments.user_id
           AND memberships.role IN ('teacher', 'viewer')
         INNER JOIN classes
           ON classes.workspace_id = assignments.workspace_id
           AND classes.class_id = assignments.class_id
         WHERE assignments.workspace_id = ? AND assignments.user_id = ?
         ORDER BY assignments.class_id ASC`,
      )
      .bind(workspaceId, userId)
      .all<{ class_id: string }>();
    return result.results.map((row) => row.class_id);
  }

  async claimLegacyWorkspace(
    input: ClaimLegacyWorkspaceInput,
  ): Promise<WorkspaceMembershipRecord> {
    const existingWorkspace = await this.database
      .prepare(
        `SELECT workspace_id
         FROM workspaces
         WHERE workspace_id = ?`,
      )
      .bind(input.workspaceId)
      .first<{ workspace_id: string }>();
    if (!existingWorkspace) throw new WorkspaceNotFoundError();

    await this.database.batch([
      this.database
        .prepare(
          `INSERT OR IGNORE INTO workspace_claims (
             workspace_id,
             claimed_by_user_id,
             claimed_at
           )
           SELECT ?, ?, ?
           WHERE EXISTS (
             SELECT 1
             FROM workspaces
             WHERE workspace_id = ?
           )`,
        )
        .bind(
          input.workspaceId,
          input.userId,
          input.createdAt,
          input.workspaceId,
        ),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO workspace_memberships (
             workspace_id,
             user_id,
             role,
             created_at,
             created_by_user_id
           )
           SELECT ?, ?, 'owner', ?, ?
           WHERE EXISTS (
             SELECT 1
             FROM workspace_claims
             WHERE workspace_id = ? AND claimed_by_user_id = ?
           )`,
        )
        .bind(
          input.workspaceId,
          input.userId,
          input.createdAt,
          input.userId,
          input.workspaceId,
          input.userId,
        ),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO audit_events (
             event_id,
             workspace_id,
             actor_user_id,
             action,
             target_type,
             target_id,
             metadata_json,
             created_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
           WHERE changes() = 1`,
        )
        .bind(
          input.auditEvent.id,
          input.auditEvent.workspaceId ?? null,
          input.auditEvent.actorUserId ?? null,
          input.auditEvent.action,
          input.auditEvent.targetType ?? null,
          input.auditEvent.targetId ?? null,
          auditMetadataJson(input.auditEvent),
          input.auditEvent.createdAt,
        ),
    ]);

    const claim = await this.database
      .prepare(
        `SELECT workspace_id, claimed_by_user_id, claimed_at
         FROM workspace_claims
         WHERE workspace_id = ?`,
      )
      .bind(input.workspaceId)
      .first<ClaimRow>();
    if (!claim) throw new WorkspaceNotFoundError();
    if (claim.claimed_by_user_id !== input.userId) {
      throw new WorkspaceAlreadyClaimedError();
    }

    const membership = await this.getWorkspaceMembership(
      input.workspaceId,
      input.userId,
    );
    if (!membership) {
      throw new Error('Workspace claim did not create a membership');
    }
    return membership;
  }

  async createAuthSession(session: AuthSessionRecord): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO auth_sessions (
           token_hash,
           user_id,
           active_workspace_id,
           created_at,
           expires_at,
           last_seen_at,
           revoked_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        session.tokenHash,
        session.userId,
        session.activeWorkspaceId,
        session.createdAt,
        session.expiresAt,
        session.lastSeenAt,
        session.revokedAt,
      )
      .run();
  }

  async getAuthSessionByTokenHash(
    tokenHash: string,
  ): Promise<AuthSessionRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT
           token_hash,
           user_id,
           active_workspace_id,
           created_at,
           expires_at,
           last_seen_at,
           revoked_at
         FROM auth_sessions
         WHERE token_hash = ?`,
      )
      .bind(tokenHash)
      .first<SessionRow>();
    return decodeSession(row);
  }

  async setAuthSessionActiveWorkspace(
    tokenHash: string,
    workspaceId: string,
  ): Promise<void> {
    const session = await this.getAuthSessionByTokenHash(tokenHash);
    if (!session) return;
    const membership = await this.getWorkspaceMembership(
      workspaceId,
      session.userId,
    );
    if (!membership) throw new WorkspaceNotFoundError();
    await this.database
      .prepare(
        `UPDATE auth_sessions
         SET active_workspace_id = ?, last_seen_at = ?
         WHERE token_hash = ?`,
      )
      .bind(workspaceId, Date.now(), tokenHash)
      .run();
  }

  async revokeAuthSession(
    tokenHash: string,
    revokedAt: number,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE auth_sessions
         SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .bind(revokedAt, tokenHash)
      .run();
  }

  async revokeAllAuthSessions(
    userId: string,
    revokedAt: number,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE auth_sessions
         SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .bind(revokedAt, userId)
      .run();
  }

  async createPasswordResetToken(
    token: PasswordResetTokenRecord,
  ): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE password_reset_tokens
           SET used_at = ?
           WHERE user_id = ? AND used_at IS NULL`,
        )
        .bind(token.createdAt, token.userId),
      this.database
        .prepare(
          `INSERT INTO password_reset_tokens (
             token_hash,
             user_id,
             created_at,
             expires_at,
             used_at
           )
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          token.tokenHash,
          token.userId,
          token.createdAt,
          token.expiresAt,
          token.usedAt,
        ),
    ]);
  }

  async consumePasswordResetToken(
    input: ConsumePasswordResetInput,
  ): Promise<AuthUserRecord | null> {
    const results = await this.database.batch([
      this.database
        .prepare(
          `UPDATE password_reset_tokens
           SET used_at = ?
           WHERE
             token_hash = ? AND
             used_at IS NULL AND
             expires_at > ? AND
             EXISTS (
               SELECT 1
               FROM users
               WHERE
                 users.user_id = password_reset_tokens.user_id AND
                 users.status = 'active'
             )`,
        )
        .bind(input.usedAt, input.tokenHash, input.usedAt),
      this.database
        .prepare(
          `UPDATE users
           SET
             password_algorithm = ?,
             password_salt = ?,
             password_hash = ?,
             password_iterations = ?,
             updated_at = ?,
             password_changed_at = ?,
             email_verified_at = COALESCE(email_verified_at, ?)
           WHERE
             user_id = (
               SELECT user_id
               FROM password_reset_tokens
               WHERE token_hash = ? AND used_at = ?
             ) AND
             status = 'active' AND
             changes() = 1`,
        )
        .bind(
          input.password.algorithm,
          input.password.salt,
          input.password.hash,
          input.password.iterations,
          input.usedAt,
          input.usedAt,
          input.usedAt,
          input.tokenHash,
          input.usedAt,
        ),
      this.database
        .prepare(
          `UPDATE auth_sessions
           SET revoked_at = ?
           WHERE
             user_id = (
               SELECT user_id
               FROM password_reset_tokens
               WHERE token_hash = ? AND used_at = ?
             ) AND
             revoked_at IS NULL AND
             changes() = 1`,
        )
        .bind(input.usedAt, input.tokenHash, input.usedAt),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) return null;

    const row = await this.database
      .prepare(
        `SELECT
           users.user_id,
           users.email,
           users.email_normalized,
           users.email_verified_at,
           users.display_name,
           users.status,
           users.password_algorithm,
           users.password_salt,
           users.password_hash,
           users.password_iterations,
           users.created_at,
           users.updated_at,
           users.password_changed_at
         FROM users
         INNER JOIN password_reset_tokens
           ON password_reset_tokens.user_id = users.user_id
         WHERE password_reset_tokens.token_hash = ?`,
      )
      .bind(input.tokenHash)
      .first<UserRow>();
    return decodeUser(row);
  }

  async createEmailVerificationToken(
    token: EmailVerificationTokenRecord,
  ): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE email_verification_tokens
           SET used_at = ?
           WHERE user_id = ? AND used_at IS NULL`,
        )
        .bind(token.createdAt, token.userId),
      this.database
        .prepare(
          `INSERT INTO email_verification_tokens (
             token_hash, user_id, created_at, expires_at, used_at
           )
           SELECT ?, ?, ?, ?, NULL
           FROM users
           WHERE user_id = ? AND status = 'active'
             AND email_verified_at IS NULL`,
        )
        .bind(
          token.tokenHash,
          token.userId,
          token.createdAt,
          token.expiresAt,
          token.userId,
        ),
    ]);
  }

  async consumeEmailVerificationToken(
    input: ConsumeEmailVerificationInput,
  ): Promise<AuthUserRecord | null> {
    const results = await this.database.batch([
      this.database
        .prepare(
          `UPDATE email_verification_tokens
           SET used_at = ?
           WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
             AND EXISTS (
               SELECT 1 FROM users
               WHERE users.user_id = email_verification_tokens.user_id
                 AND users.status = 'active'
                 AND users.email_verified_at IS NULL
             )`,
        )
        .bind(input.verifiedAt, input.tokenHash, input.verifiedAt),
      this.database
        .prepare(
          `UPDATE users
           SET email_verified_at = COALESCE(email_verified_at, ?),
               updated_at = ?
           WHERE user_id = (
             SELECT user_id FROM email_verification_tokens
             WHERE token_hash = ? AND used_at = ?
           ) AND status = 'active' AND changes() = 1`,
        )
        .bind(
          input.verifiedAt,
          input.verifiedAt,
          input.tokenHash,
          input.verifiedAt,
        ),
      this.database
        .prepare(
          `UPDATE email_verification_tokens
           SET used_at = ?
           WHERE user_id = (
             SELECT user_id FROM email_verification_tokens
             WHERE token_hash = ?
           ) AND used_at IS NULL AND changes() = 1`,
        )
        .bind(input.verifiedAt, input.tokenHash),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) return null;
    const row = await this.database
      .prepare(
        `SELECT
           users.user_id,
           users.email,
           users.email_normalized,
           users.email_verified_at,
           users.display_name,
           users.status,
           users.password_algorithm,
           users.password_salt,
           users.password_hash,
           users.password_iterations,
           users.created_at,
           users.updated_at,
           users.password_changed_at
         FROM users
         INNER JOIN email_verification_tokens
           ON email_verification_tokens.user_id = users.user_id
         WHERE email_verification_tokens.token_hash = ?`,
      )
      .bind(input.tokenHash)
      .first<UserRow>();
    return decodeUser(row);
  }

  async consumeAuthRateLimit(
    input: ConsumeAuthRateLimitInput,
  ): Promise<AuthRateLimitResult> {
    const [, readResult] = await this.database.batch<RateLimitRow>([
      this.database
        .prepare(
          `INSERT INTO auth_rate_limits (
             scope,
             subject_hash,
             window_started_at,
             attempt_count,
             blocked_until
           )
           VALUES (?, ?, ?, 1, 0)
           ON CONFLICT (scope, subject_hash) DO UPDATE SET
             window_started_at = CASE
               WHEN auth_rate_limits.blocked_until > excluded.window_started_at
                 THEN auth_rate_limits.window_started_at
               WHEN excluded.window_started_at >=
                    auth_rate_limits.window_started_at + ?
                 THEN excluded.window_started_at
               ELSE auth_rate_limits.window_started_at
             END,
             attempt_count = CASE
               WHEN auth_rate_limits.blocked_until > excluded.window_started_at
                 THEN auth_rate_limits.attempt_count
               WHEN excluded.window_started_at >=
                    auth_rate_limits.window_started_at + ?
                 THEN 1
               ELSE auth_rate_limits.attempt_count + 1
             END,
             blocked_until = CASE
               WHEN auth_rate_limits.blocked_until > excluded.window_started_at
                 THEN auth_rate_limits.blocked_until
               WHEN excluded.window_started_at >=
                    auth_rate_limits.window_started_at + ?
                 THEN 0
               WHEN auth_rate_limits.attempt_count + 1 > ?
                 THEN excluded.window_started_at + ?
               ELSE 0
             END`,
        )
        .bind(
          input.scope,
          input.subjectHash,
          input.now,
          input.windowMs,
          input.windowMs,
          input.windowMs,
          input.maxAttempts,
          input.blockMs,
        ),
      this.database
        .prepare(
          `SELECT window_started_at, attempt_count, blocked_until
           FROM auth_rate_limits
           WHERE scope = ? AND subject_hash = ?`,
        )
        .bind(input.scope, input.subjectHash),
    ]);
    const row = readResult.results[0];
    if (!row) throw new Error('Authentication rate limit was not persisted');
    const blocked = row.blocked_until > input.now;
    return {
      allowed: !blocked && row.attempt_count <= input.maxAttempts,
      remaining: blocked
        ? 0
        : Math.max(0, input.maxAttempts - row.attempt_count),
      retryAfterMs: blocked
        ? Math.max(0, row.blocked_until - input.now)
        : 0,
    };
  }

  async appendAuditEvent(event: AuditEventRecord): Promise<void> {
    await this.auditStatement(event).run();
  }

  async listWorkspaceAuditEvents(
    workspaceId: string,
    query: WorkspaceAuditQuery = {},
  ): Promise<AuditEventRecord[]> {
    const clauses = ['workspace_id = ?'];
    const bindings: Array<string | number> = [workspaceId];
    if (query.action) {
      clauses.push('action = ?');
      bindings.push(query.action);
    }
    if (query.actorUserId) {
      clauses.push('actor_user_id = ?');
      bindings.push(query.actorUserId);
    }
    if (query.targetType) {
      clauses.push('target_type = ?');
      bindings.push(query.targetType);
    }
    if (query.fromCreatedAt != null) {
      clauses.push('created_at >= ?');
      bindings.push(query.fromCreatedAt);
    }
    if (query.toCreatedAt != null) {
      clauses.push('created_at <= ?');
      bindings.push(query.toCreatedAt);
    }
    if (query.cursor) {
      clauses.push('(created_at < ? OR (created_at = ? AND event_id < ?))');
      bindings.push(
        query.cursor.createdAt,
        query.cursor.createdAt,
        query.cursor.id,
      );
    }
    const safeLimit = Math.max(
      1,
      Math.min(201, Math.floor(query.limit ?? 50)),
    );
    bindings.push(safeLimit);
    const result = await this.database
      .prepare(
        `SELECT event_id, workspace_id, actor_user_id, action,
                target_type, target_id, metadata_json, created_at
         FROM audit_events
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC, event_id DESC
         LIMIT ?`,
      )
      .bind(...bindings)
      .all<AuditEventRow>();
    return result.results.map((row) => {
      let metadata: Record<string, unknown> | undefined;
      try {
        const candidate = JSON.parse(row.metadata_json) as unknown;
        if (
          candidate &&
          typeof candidate === 'object' &&
          !Array.isArray(candidate) &&
          Object.keys(candidate).length > 0
        ) metadata = candidate as Record<string, unknown>;
      } catch {
        metadata = undefined;
      }
      return {
        id: row.event_id,
        ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
        ...(row.actor_user_id ? { actorUserId: row.actor_user_id } : {}),
        action: row.action,
        ...(row.target_type ? { targetType: row.target_type } : {}),
        ...(row.target_id ? { targetId: row.target_id } : {}),
        ...(metadata ? { metadata } : {}),
        createdAt: row.created_at,
      };
    });
  }

  async listWorkspaceRevisions(
    workspaceId: string,
    limit = MAX_STORED_REVISIONS,
  ): Promise<WorkspaceRevisionRecord[]> {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(MAX_STORED_REVISIONS, Math.floor(limit)))
      : MAX_STORED_REVISIONS;
    const result = await this.database
      .prepare(
        `SELECT
           workspace_id,
           revision,
           updated_at,
           actor_user_id,
           data_size_bytes
         FROM workspace_revisions
         WHERE workspace_id = ?
         ORDER BY revision DESC
         LIMIT ?`,
      )
      .bind(workspaceId, safeLimit)
      .all<RevisionRow>();
    return result.results.map(decodeRevision);
  }

  async getWorkspaceRevision(
    workspaceId: string,
    revision: number,
  ): Promise<WorkspaceRevisionSnapshot | null> {
    const row = await this.database
      .prepare(
        `SELECT
           workspace_id,
           revision,
           updated_at,
           actor_user_id,
           data_size_bytes,
           data_json
         FROM workspace_revisions
         WHERE workspace_id = ? AND revision = ?`,
      )
      .bind(workspaceId, revision)
      .first<RevisionSnapshotRow>();
    if (!row) return null;
    return {
      ...decodeRevision(row),
      data: JSON.parse(row.data_json) as AppData,
    };
  }

  private projectionGateStatement(
    workspaceId: string,
    sourceRevision: number,
    writeToken: string,
    projectedAt: number,
    requirePreviousChange: boolean,
  ): D1PreparedStatement {
    const source = requirePreviousChange
      ? `SELECT ?, ?, ?, ? WHERE changes() = 1`
      : `VALUES (?, ?, ?, ?)`;
    return this.database
      .prepare(
        `INSERT INTO workspace_projection_state (
           workspace_id,
           source_revision,
           write_token,
           projected_at
         )
         ${source}
         ON CONFLICT (workspace_id) DO UPDATE SET
           source_revision = excluded.source_revision,
           write_token = excluded.write_token,
           projected_at = excluded.projected_at`,
      )
      .bind(workspaceId, sourceRevision, writeToken, projectedAt);
  }

  private projectionRebuildGateStatement(
    workspaceId: string,
    sourceRevision: number,
    writeToken: string,
    projectedAt: number,
  ): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT INTO workspace_projection_state (
           workspace_id, source_revision, write_token, projected_at
         )
         SELECT workspace_id, revision, ?, ?
         FROM workspaces
         WHERE workspace_id = ? AND revision = ?
         ON CONFLICT (workspace_id) DO UPDATE SET
           source_revision = excluded.source_revision,
           write_token = excluded.write_token,
           projected_at = excluded.projected_at`,
      )
      .bind(writeToken, projectedAt, workspaceId, sourceRevision);
  }

  private projectionStatements(
    workspaceId: string,
    sourceRevision: number,
    writeToken: string,
  ): D1PreparedStatement[] {
    return [
      this.database
        .prepare(
          `INSERT INTO workspace_projection_documents (
             workspace_id, source_revision, root_json,
             reconciliation_status, source_checksum,
             projection_checksum, reconciled_at, details_json
           )
           SELECT
             workspaces.workspace_id,
             workspaces.revision,
             json_remove(workspaces.data_json, '$.classes'),
             'pending',
             NULL,
             NULL,
             NULL,
             '{}'
           FROM workspaces
           WHERE
             workspaces.workspace_id = ? AND
             workspaces.revision = ? AND
             json_valid(workspaces.data_json) AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = workspaces.workspace_id AND
                 source_revision = workspaces.revision AND
                 write_token = ?
             )
           ON CONFLICT (workspace_id) DO UPDATE SET
             source_revision = excluded.source_revision,
             root_json = excluded.root_json,
             reconciliation_status = 'pending',
             source_checksum = NULL,
             projection_checksum = NULL,
             reconciled_at = NULL,
             details_json = '{}'`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `DELETE FROM classes
           WHERE
             workspace_id = ? AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = ? AND
                 source_revision = ? AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO classes (
             workspace_id,
             class_id,
             name,
             source_revision,
             sort_index,
             record_json
           )
           SELECT
             workspaces.workspace_id,
             CAST(json_extract(class_item.value, '$.id') AS TEXT),
             COALESCE(
               CAST(json_extract(class_item.value, '$.name') AS TEXT),
               ''
             ),
             workspaces.revision,
             CAST(class_item.key AS INTEGER),
             class_item.value
           FROM workspaces
           JOIN json_each(
             CASE
               WHEN
                 json_valid(workspaces.data_json) AND
                 json_type(workspaces.data_json, '$.classes') = 'array'
                 THEN json_extract(workspaces.data_json, '$.classes')
               ELSE '[]'
             END
           ) AS class_item
           WHERE
             workspaces.workspace_id = ? AND
             workspaces.revision = ? AND
             json_type(class_item.value) = 'object' AND
             NULLIF(
               TRIM(CAST(json_extract(class_item.value, '$.id') AS TEXT)),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = workspaces.workspace_id AND
                 source_revision = workspaces.revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO students (
             workspace_id,
             class_id,
             student_id,
             name,
             points,
             rank_points,
             warning_points,
             pet_type,
             pet_fullness,
             pet_happiness,
             pet_level,
             source_revision,
             sort_index,
             record_json
           )
           SELECT
             classes.workspace_id,
             classes.class_id,
             CAST(json_extract(student_item.value, '$.id') AS TEXT),
             COALESCE(
               CAST(json_extract(student_item.value, '$.name') AS TEXT),
               ''
             ),
             CAST(COALESCE(
               json_extract(student_item.value, '$.points'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(student_item.value, '$.rankPoints'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(student_item.value, '$.warningPoints'), 0
             ) AS REAL),
             COALESCE(
               CAST(json_extract(student_item.value, '$.pet.type') AS TEXT),
               ''
             ),
             CAST(COALESCE(
               json_extract(student_item.value, '$.pet.fullness'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(student_item.value, '$.pet.happiness'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(student_item.value, '$.pet.level'), 1
             ) AS INTEGER),
             classes.source_revision,
             CAST(student_item.key AS INTEGER),
             student_item.value
           FROM classes
           JOIN json_each(
             CASE
               WHEN json_type(classes.record_json, '$.students') = 'array'
                 THEN json_extract(classes.record_json, '$.students')
               ELSE '[]'
             END
           ) AS student_item
           WHERE
             classes.workspace_id = ? AND
             classes.source_revision = ? AND
             json_type(student_item.value) = 'object' AND
             NULLIF(
               TRIM(CAST(json_extract(student_item.value, '$.id') AS TEXT)),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = classes.workspace_id AND
                 source_revision = classes.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO exam_records (
             workspace_id,
             class_id,
             exam_id,
             title,
             exam_date,
             items_json,
             created_at,
             updated_at,
             source_revision,
             sort_index,
             record_json
           )
           SELECT
             classes.workspace_id,
             classes.class_id,
             CAST(json_extract(exam_item.value, '$.id') AS TEXT),
             COALESCE(
               CAST(json_extract(exam_item.value, '$.title') AS TEXT),
               ''
             ),
             COALESCE(
               CAST(json_extract(exam_item.value, '$.examDate') AS TEXT),
               ''
             ),
             CASE
               WHEN json_type(exam_item.value, '$.items') = 'array'
                 THEN json_extract(exam_item.value, '$.items')
               ELSE '[]'
             END,
             CAST(COALESCE(
               json_extract(exam_item.value, '$.createdAt'), 0
             ) AS INTEGER),
             CAST(COALESCE(
               json_extract(exam_item.value, '$.updatedAt'), 0
             ) AS INTEGER),
             classes.source_revision,
             CAST(exam_item.key AS INTEGER),
             exam_item.value
           FROM classes
           JOIN json_each(
             CASE
               WHEN json_type(classes.record_json, '$.examRecords') = 'array'
                 THEN json_extract(classes.record_json, '$.examRecords')
               ELSE '[]'
             END
           ) AS exam_item
           WHERE
             classes.workspace_id = ? AND
             classes.source_revision = ? AND
             json_type(exam_item.value) = 'object' AND
             NULLIF(
               TRIM(CAST(json_extract(exam_item.value, '$.id') AS TEXT)),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = classes.workspace_id AND
                 source_revision = classes.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),

      this.database
        .prepare(
          `INSERT OR REPLACE INTO exam_results (
             workspace_id,
             class_id,
             exam_id,
             student_id,
             scores_json,
             mentor_comment,
             updated_at,
             source_revision,
             sort_index,
             record_json
           )
           SELECT
             exam_records.workspace_id,
             exam_records.class_id,
             exam_records.exam_id,
             CAST(json_extract(result_item.value, '$.studentId') AS TEXT),
             CASE
               WHEN json_type(result_item.value, '$.scores') = 'object'
                 THEN json_extract(result_item.value, '$.scores')
               ELSE '{}'
             END,
             CAST(json_extract(result_item.value, '$.mentorComment') AS TEXT),
             CAST(COALESCE(
               json_extract(result_item.value, '$.updatedAt'), 0
             ) AS INTEGER),
             exam_records.source_revision,
             CAST(result_item.key AS INTEGER),
             result_item.value
           FROM exam_records
           JOIN json_each(
             CASE
               WHEN json_type(exam_records.record_json, '$.results') = 'array'
                 THEN json_extract(exam_records.record_json, '$.results')
               ELSE '[]'
             END
           ) AS result_item
           JOIN students
             ON students.workspace_id = exam_records.workspace_id
             AND students.class_id = exam_records.class_id
             AND students.student_id = CAST(
               json_extract(result_item.value, '$.studentId') AS TEXT
             )
           WHERE
             exam_records.workspace_id = ? AND
             exam_records.source_revision = ? AND
             json_type(result_item.value) = 'object' AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = exam_records.workspace_id AND
                 source_revision = exam_records.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO learning_evidence (
             workspace_id,
             class_id,
             evidence_id,
             student_id,
             competency,
             level,
             evidence_type,
             title,
             note,
             actor,
             source,
             source_id,
             rubric_version,
             evidence_revision,
             created_at,
             source_revision,
             sort_index,
             record_json
           )
           SELECT
             classes.workspace_id,
             classes.class_id,
             CAST(json_extract(evidence_item.value, '$.id') AS TEXT),
             CAST(json_extract(evidence_item.value, '$.studentId') AS TEXT),
             COALESCE(
               CAST(json_extract(evidence_item.value, '$.competency') AS TEXT),
               ''
             ),
             COALESCE(
               CAST(json_extract(evidence_item.value, '$.level') AS TEXT),
               ''
             ),
             COALESCE(
               CAST(
                 json_extract(evidence_item.value, '$.evidenceType') AS TEXT
               ),
               ''
             ),
             COALESCE(
               CAST(json_extract(evidence_item.value, '$.title') AS TEXT),
               ''
             ),
             CAST(json_extract(evidence_item.value, '$.note') AS TEXT),
             COALESCE(
               CAST(json_extract(evidence_item.value, '$.actor') AS TEXT),
               'mentor'
             ),
             COALESCE(
               CAST(json_extract(evidence_item.value, '$.source') AS TEXT),
               'manual'
             ),
             CAST(json_extract(evidence_item.value, '$.sourceId') AS TEXT),
             COALESCE(
               CAST(
                 json_extract(evidence_item.value, '$.rubricVersion') AS TEXT
               ),
               '1.0'
             ),
             CAST(COALESCE(
               json_extract(evidence_item.value, '$.revision'), 1
             ) AS INTEGER),
             CAST(COALESCE(
               json_extract(evidence_item.value, '$.createdAt'), 0
             ) AS INTEGER),
             classes.source_revision,
             CAST(evidence_item.key AS INTEGER),
             evidence_item.value
           FROM classes
           JOIN json_each(
             CASE
               WHEN
                 json_type(
                   classes.record_json,
                   '$.learningEvidenceRecords'
                 ) = 'array'
                 THEN json_extract(
                   classes.record_json,
                   '$.learningEvidenceRecords'
                 )
               ELSE '[]'
             END
           ) AS evidence_item
           JOIN students
             ON students.workspace_id = classes.workspace_id
             AND students.class_id = classes.class_id
             AND students.student_id = CAST(
               json_extract(evidence_item.value, '$.studentId') AS TEXT
             )
           WHERE
             classes.workspace_id = ? AND
             classes.source_revision = ? AND
             json_type(evidence_item.value) = 'object' AND
             NULLIF(
               TRIM(CAST(json_extract(evidence_item.value, '$.id') AS TEXT)),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = classes.workspace_id AND
                 source_revision = classes.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO point_adjustments (
             workspace_id,
             class_id,
             student_id,
             adjustment_id,
             amount,
             source,
             reason_id,
             reason_label,
             competency,
             created_at,
             source_revision,
             sort_index,
             record_json
           )
           SELECT
             students.workspace_id,
             students.class_id,
             students.student_id,
             CAST(json_extract(adjustment_item.value, '$.id') AS TEXT),
             CAST(COALESCE(
               json_extract(adjustment_item.value, '$.amount'), 0
             ) AS REAL),
             COALESCE(
               CAST(json_extract(adjustment_item.value, '$.source') AS TEXT),
               ''
             ),
             CAST(json_extract(adjustment_item.value, '$.reasonId') AS TEXT),
             CAST(
               json_extract(adjustment_item.value, '$.reasonLabel') AS TEXT
             ),
             CAST(
               json_extract(adjustment_item.value, '$.competency') AS TEXT
             ),
             CAST(COALESCE(
               json_extract(adjustment_item.value, '$.createdAt'), 0
             ) AS INTEGER),
             students.source_revision,
             CAST(adjustment_item.key AS INTEGER),
             adjustment_item.value
           FROM students
           JOIN json_each(
             CASE
               WHEN
                 json_type(
                   students.record_json,
                   '$.pointAdjustmentRecords'
                 ) = 'array'
                 THEN json_extract(
                   students.record_json,
                   '$.pointAdjustmentRecords'
                 )
               ELSE '[]'
             END
           ) AS adjustment_item
           WHERE
             students.workspace_id = ? AND
             students.source_revision = ? AND
             json_type(adjustment_item.value) = 'object' AND
             NULLIF(
               TRIM(
                 CAST(json_extract(adjustment_item.value, '$.id') AS TEXT)
               ),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = students.workspace_id AND
                 source_revision = students.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO discipline_records (
             workspace_id,
             class_id,
             student_id,
             discipline_id,
             record_type,
             warning_count,
             reason,
             action_kind,
             reverses_record_id,
             created_at,
             source_revision,
             sort_index,
             record_json
           )
           SELECT
             students.workspace_id,
             students.class_id,
             students.student_id,
             CAST(json_extract(discipline_item.value, '$.id') AS TEXT),
             COALESCE(
               CAST(json_extract(discipline_item.value, '$.type') AS TEXT),
               ''
             ),
             CAST(
               json_extract(discipline_item.value, '$.warningCount') AS INTEGER
             ),
             CAST(json_extract(discipline_item.value, '$.reason') AS TEXT),
             CAST(
               json_extract(discipline_item.value, '$.actionKind') AS TEXT
             ),
             CAST(
               json_extract(
                 discipline_item.value,
                 '$.reversesRecordId'
               ) AS TEXT
             ),
             CAST(COALESCE(
               json_extract(discipline_item.value, '$.createdAt'), 0
             ) AS INTEGER),
             students.source_revision,
             CAST(discipline_item.key AS INTEGER),
             discipline_item.value
           FROM students
           JOIN json_each(
             CASE
               WHEN
                 json_type(
                   students.record_json,
                   '$.disciplineRecords'
                 ) = 'array'
                 THEN json_extract(
                   students.record_json,
                   '$.disciplineRecords'
                 )
               ELSE '[]'
             END
           ) AS discipline_item
           WHERE
             students.workspace_id = ? AND
             students.source_revision = ? AND
             json_type(discipline_item.value) = 'object' AND
             NULLIF(
               TRIM(
                 CAST(json_extract(discipline_item.value, '$.id') AS TEXT)
               ),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = students.workspace_id AND
                 source_revision = students.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `INSERT OR REPLACE INTO boss_rewards (
             workspace_id, class_id, student_id, reward_id, boss_id,
             boss_name, rank, damage, attack_count, fair_score,
             previous_damage, previous_fair_score, improvement_amount,
             fair_improvement_amount, reward_points, reward_rank_points,
             reward_happiness, rank_reward_points, rank_reward_rank_points,
             rank_reward_happiness, participation_reward_points,
             participation_reward_rank_points, participation_reward_happiness,
             improvement_reward_points, improvement_reward_rank_points,
             improvement_reward_happiness, received_improvement_reward,
             created_at, source_revision, sort_index, record_json
           )
           SELECT
             students.workspace_id,
             students.class_id,
             students.student_id,
             CAST(json_extract(reward_item.value, '$.id') AS TEXT),
             COALESCE(
               CAST(json_extract(reward_item.value, '$.bossId') AS TEXT), ''
             ),
             COALESCE(
               CAST(json_extract(reward_item.value, '$.bossName') AS TEXT), ''
             ),
             CAST(COALESCE(json_extract(reward_item.value, '$.rank'), 0)
               AS INTEGER),
             CAST(COALESCE(json_extract(reward_item.value, '$.damage'), 0)
               AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.attackCount'), 0
             ) AS INTEGER),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.fairScore'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.previousDamage'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.previousFairScore'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.improvementAmount'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.fairImprovementAmount'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rewardPoints'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rewardRankPoints'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rewardHappiness'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rankRewardPoints'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rankRewardRankPoints'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.rankRewardHappiness'), 0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.participationRewardPoints'),
               0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(
                 reward_item.value,
                 '$.participationRewardRankPoints'
               ),
               0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(
                 reward_item.value,
                 '$.participationRewardHappiness'
               ),
               0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(reward_item.value, '$.improvementRewardPoints'),
               0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(
                 reward_item.value,
                 '$.improvementRewardRankPoints'
               ),
               0
             ) AS REAL),
             CAST(COALESCE(
               json_extract(
                 reward_item.value,
                 '$.improvementRewardHappiness'
               ),
               0
             ) AS REAL),
             CASE
               WHEN json_extract(
                 reward_item.value,
                 '$.receivedImprovementReward'
               ) = 1 THEN 1
               ELSE 0
             END,
             CAST(COALESCE(
               json_extract(reward_item.value, '$.createdAt'), 0
             ) AS INTEGER),
             students.source_revision,
             CAST(reward_item.key AS INTEGER),
             reward_item.value
           FROM students
           JOIN json_each(
             CASE
               WHEN
                 json_type(
                   students.record_json,
                   '$.bossRewardRecords'
                 ) = 'array'
                 THEN json_extract(
                   students.record_json,
                   '$.bossRewardRecords'
                 )
               ELSE '[]'
             END
           ) AS reward_item
           WHERE
             students.workspace_id = ? AND
             students.source_revision = ? AND
             json_type(reward_item.value) = 'object' AND
             NULLIF(
               TRIM(CAST(json_extract(reward_item.value, '$.id') AS TEXT)),
               ''
             ) IS NOT NULL AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = students.workspace_id AND
                 source_revision = students.source_revision AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, sourceRevision, writeToken),
      this.database
        .prepare(
          `DELETE FROM workspace_class_assignments
           WHERE
             workspace_id = ? AND
             NOT EXISTS (
               SELECT 1
               FROM classes
               WHERE
                 classes.workspace_id = workspace_class_assignments.workspace_id AND
                 classes.class_id = workspace_class_assignments.class_id
             ) AND
             EXISTS (
               SELECT 1
               FROM workspace_projection_state
               WHERE
                 workspace_id = ? AND
                 source_revision = ? AND
                 write_token = ?
             )`,
        )
        .bind(workspaceId, workspaceId, sourceRevision, writeToken),
    ];
  }

  private workspaceAuditStatement(
    workspaceId: string,
    sourceRevision: number,
    updatedAt: number,
    context: WorkspaceWriteContext,
    writeToken: string,
  ): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT OR IGNORE INTO audit_events (
           event_id,
           workspace_id,
           actor_user_id,
           action,
           target_type,
           target_id,
           metadata_json,
           created_at
         )
         SELECT ?, ?, ?, ?, 'workspace', ?, '{}', ?
         WHERE EXISTS (
           SELECT 1
           FROM workspace_projection_state
           WHERE
             workspace_id = ? AND
             source_revision = ? AND
             write_token = ?
         )`,
      )
      .bind(
        context.requestId ??
          `evt_workspace_${workspaceId}_${sourceRevision}`,
        workspaceId,
        context.actorUserId ?? null,
        context.action ?? 'workspace.put',
        workspaceId,
        updatedAt,
        workspaceId,
        sourceRevision,
        writeToken,
      );
  }

  private auditStatement(event: AuditEventRecord) {
    return this.database
      .prepare(
        `INSERT INTO audit_events (
           event_id,
           workspace_id,
           actor_user_id,
           action,
           target_type,
           target_id,
           metadata_json,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.workspaceId ?? null,
        event.actorUserId ?? null,
        event.action,
        event.targetType ?? null,
        event.targetId ?? null,
        auditMetadataJson(event),
        event.createdAt,
      );
  }
}
