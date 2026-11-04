import type { D1Database } from '@cloudflare/workers-types';
import {
  MAX_D1_STATE_BYTES, MAX_STORED_REVISIONS, utf8Size,
} from '../shared/domain/repositoryPolicy';
import {
  assertRetainedRevisionSerializationBounds,
  assertWorkspaceData,
} from '../shared/validation/workspaceValidation';

export type D1RecoveryIssueCode =
  | 'INVALID_OPTIONS' | 'SCHEMA_MISMATCH' | 'SCHEMA_EVIDENCE_MISSING' | 'MIGRATION_LEDGER_MISSING'
  | 'MIGRATION_MISSING' | 'MIGRATION_UNKNOWN' | 'MIGRATION_ORDER'
  | 'INTEGRITY_CHECK_FAILED' | 'FOREIGN_KEY_VIOLATION' | 'QUERY_FAILED'
  | 'WORKSPACE_INVALID' | 'WORKSPACE_TOO_LARGE' | 'HISTORY_INVALID'
  | 'HISTORY_TOO_LARGE' | 'HISTORY_LIMIT' | 'HISTORY_LATEST_MISMATCH'
  | 'PROJECTION_LIMIT' | 'PROJECTION_MISMATCH' | 'OWNERSHIP_MISMATCH'
  | 'UNCLAIMED_LEGACY' | 'CLASS_ASSIGNMENT_INVALID' | 'ONBOARDING_INVALID' | 'VALIDATION_TRUNCATED';

export type D1RecoveryValidationOptions = {
  /** The complete, trusted migration filename list, in application order. */
  expectedMigrations: readonly string[];
  /**
   * Capture from a separate pristine database built from trusted migrations,
   * never from the candidate being inspected. Include all non-internal tables,
   * indexes and triggers, excluding the separately checked d1_migrations table.
   * Missing evidence can never produce structurally_valid.
   */
  expectedSchema?: readonly D1RecoverySchemaEntry[];
  maxWorkspaces?: number;
  pageSize?: number;
  maxProjectionRowsPerWorkspace?: number;
  /** Only genuinely unclaimed workspaces with zero memberships qualify. */
  allowUnclaimedLegacy?: boolean;
};

export type D1RecoverySchemaEntry = { type: 'table' | 'index' | 'trigger'; name: string; sql: string };

export type D1RecoveryValidationReport = {
  status: 'structurally_valid' | 'blocked';
  /** Structural equality cannot establish that restored deletions were replayed. */
  privacyStatus: 'not_verified';
  checkedWorkspaces: number;
  legacyUnclaimedWorkspaces: number;
  truncated: boolean;
  /** Fixed codes and aggregate counts only; never SQL errors or tenant records. */
  issues: { code: D1RecoveryIssueCode; count: number }[];
};

type Row = Record<string, unknown>;
type Scalar = string | number | null;
type Field = readonly [column: string, path: string, kind: 'text' | 'nullableText' |
  'number' | 'integer' | 'nullableInteger' | 'array' | 'object' | 'boolean', fallback?: Scalar];
type ProjectionSpec = { keys: readonly string[]; fields: readonly Field[] };

// These columns mirror the native dual-write projection in projectionStatements.ts.
// Compare redundant records AND indexed scalar columns: normalized reconstruction
// alone replaces nested arrays and can therefore hide a damaged parent record.
const projectionSpecs = {
  classes: { keys: ['class_id'], fields: [['name', 'name', 'text']] },
  students: { keys: ['class_id', 'student_id'], fields: [
    ['name', 'name', 'text'], ['points', 'points', 'number'],
    ['rank_points', 'rankPoints', 'number'], ['warning_points', 'warningPoints', 'number'],
    ['pet_type', 'pet.type', 'text'], ['pet_fullness', 'pet.fullness', 'number'],
    ['pet_happiness', 'pet.happiness', 'number'], ['pet_level', 'pet.level', 'integer', 1],
  ] },
  exam_records: { keys: ['class_id', 'exam_id'], fields: [
    ['title', 'title', 'text'], ['exam_date', 'examDate', 'text'], ['items_json', 'items', 'array'],
    ['created_at', 'createdAt', 'integer'], ['updated_at', 'updatedAt', 'integer'],
  ] },
  exam_results: { keys: ['class_id', 'exam_id', 'student_id'], fields: [
    ['scores_json', 'scores', 'object'], ['mentor_comment', 'mentorComment', 'nullableText'],
    ['updated_at', 'updatedAt', 'integer'],
  ] },
  learning_evidence: { keys: ['class_id', 'evidence_id'], fields: [
    ['student_id', 'studentId', 'text'], ['competency', 'competency', 'text'],
    ['level', 'level', 'text'], ['evidence_type', 'evidenceType', 'text'],
    ['title', 'title', 'text'], ['note', 'note', 'nullableText'],
    ['actor', 'actor', 'text', 'mentor'], ['source', 'source', 'text', 'manual'],
    ['source_id', 'sourceId', 'nullableText'], ['rubric_version', 'rubricVersion', 'text', '1.0'],
    ['evidence_revision', 'revision', 'integer', 1], ['created_at', 'createdAt', 'integer'],
  ] },
  point_adjustments: { keys: ['class_id', 'student_id', 'adjustment_id'], fields: [
    ['amount', 'amount', 'number'], ['source', 'source', 'text'],
    ['reason_id', 'reasonId', 'nullableText'], ['reason_label', 'reasonLabel', 'nullableText'],
    ['competency', 'competency', 'nullableText'], ['created_at', 'createdAt', 'integer'],
  ] },
  discipline_records: { keys: ['class_id', 'student_id', 'discipline_id'], fields: [
    ['record_type', 'type', 'text'], ['warning_count', 'warningCount', 'nullableInteger'],
    ['reason', 'reason', 'nullableText'], ['action_kind', 'actionKind', 'nullableText'],
    ['reverses_record_id', 'reversesRecordId', 'nullableText'], ['created_at', 'createdAt', 'integer'],
  ] },
  boss_rewards: { keys: ['class_id', 'student_id', 'reward_id'], fields: [
    ['boss_id', 'bossId', 'text'], ['boss_name', 'bossName', 'text'],
    ['rank', 'rank', 'integer'], ['damage', 'damage', 'number'], ['attack_count', 'attackCount', 'integer'],
    ['fair_score', 'fairScore', 'number'], ['previous_damage', 'previousDamage', 'number'],
    ['previous_fair_score', 'previousFairScore', 'number'], ['improvement_amount', 'improvementAmount', 'number'],
    ['fair_improvement_amount', 'fairImprovementAmount', 'number'], ['reward_points', 'rewardPoints', 'number'],
    ['reward_rank_points', 'rewardRankPoints', 'number'], ['reward_happiness', 'rewardHappiness', 'number'],
    ['rank_reward_points', 'rankRewardPoints', 'number'], ['rank_reward_rank_points', 'rankRewardRankPoints', 'number'],
    ['rank_reward_happiness', 'rankRewardHappiness', 'number'],
    ['participation_reward_points', 'participationRewardPoints', 'number'],
    ['participation_reward_rank_points', 'participationRewardRankPoints', 'number'],
    ['participation_reward_happiness', 'participationRewardHappiness', 'number'],
    ['improvement_reward_points', 'improvementRewardPoints', 'number'],
    ['improvement_reward_rank_points', 'improvementRewardRankPoints', 'number'],
    ['improvement_reward_happiness', 'improvementRewardHappiness', 'number'],
    ['received_improvement_reward', 'receivedImprovementReward', 'boolean'], ['created_at', 'createdAt', 'integer'],
  ] },
} as const satisfies Record<string, ProjectionSpec>;
type ProjectionTable = keyof typeof projectionSpecs;
const projectionTables = Object.keys(projectionSpecs) as ProjectionTable[];

const schemaColumns: Record<string, readonly string[]> = {
  workspaces: ['workspace_id', 'revision', 'updated_at', 'data_json', 'name', 'created_at'],
  users: ['user_id', 'email', 'email_normalized', 'email_verified_at', 'display_name', 'status',
    'password_algorithm', 'password_salt', 'password_hash', 'password_iterations', 'created_at', 'updated_at', 'password_changed_at'],
  workspace_memberships: ['workspace_id', 'user_id', 'role', 'created_at', 'created_by_user_id'],
  workspace_claims: ['workspace_id', 'claimed_by_user_id', 'claimed_at'],
  auth_sessions: ['token_hash', 'user_id', 'active_workspace_id', 'created_at', 'expires_at', 'last_seen_at', 'revoked_at'],
  password_reset_tokens: ['token_hash', 'user_id', 'created_at', 'expires_at', 'used_at'],
  email_verification_tokens: ['token_hash', 'user_id', 'created_at', 'expires_at', 'used_at'],
  auth_rate_limits: ['scope', 'subject_hash', 'window_started_at', 'attempt_count', 'blocked_until'],
  workspace_revisions: ['workspace_id', 'revision', 'updated_at', 'actor_user_id', 'data_size_bytes', 'data_json'],
  audit_events: ['event_id', 'workspace_id', 'actor_user_id', 'action', 'target_type', 'target_id', 'metadata_json', 'created_at'],
  workspace_class_assignments: ['workspace_id', 'user_id', 'class_id', 'created_at', 'created_by_user_id'],
  workspace_invitations: ['invitation_id', 'token_hash', 'workspace_id', 'email', 'email_normalized', 'role',
    'class_ids_json', 'created_by_user_id', 'created_at', 'expires_at', 'accepted_at', 'accepted_by_user_id', 'revoked_at'],
  workspace_projection_state: ['workspace_id', 'source_revision', 'write_token', 'projected_at'],
  workspace_projection_documents: ['workspace_id', 'source_revision', 'root_json', 'reconciliation_status',
    'source_checksum', 'projection_checksum', 'reconciled_at', 'details_json'],
  ...Object.fromEntries(projectionTables.map((table) => [table, [
    'workspace_id', ...projectionSpecs[table].keys, ...(projectionSpecs[table] as ProjectionSpec).fields.map(([column]) => column),
    'source_revision', 'sort_index', 'record_json',
  ]])),
};
const requiredTriggers = [
  'trg_workspaces_revision_after_insert', 'trg_workspaces_revision_after_update',
  'trg_workspace_class_assignments_insert', 'trg_workspace_class_assignments_update',
];
const requiredIndexes = [
  'idx_workspaces_updated_at', 'idx_workspace_memberships_user', 'idx_auth_sessions_user_expiry',
  'idx_auth_sessions_expiry', 'idx_password_reset_tokens_user', 'idx_auth_rate_limits_blocked',
  'idx_audit_events_workspace_created', 'idx_audit_events_actor_created', 'idx_classes_workspace_revision',
  'idx_students_workspace_revision', 'idx_exam_records_workspace_revision', 'idx_exam_results_student',
  'idx_learning_evidence_student_created', 'idx_point_adjustments_student_created',
  'idx_discipline_records_student_created', 'idx_boss_rewards_student_created',
  'idx_workspace_class_assignments_class', 'idx_workspace_invitations_workspace_created',
  'idx_workspace_invitations_active_email', 'idx_projection_documents_status', 'idx_email_verification_tokens_user',
];

const object = (value: unknown): value is Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Row)[key])}`).join(',')}}`;
};
const parseBounded = (value: unknown): unknown => {
  if (typeof value !== 'string' || utf8Size(value) > MAX_D1_STATE_BYTES) throw new Error();
  const parsed: unknown = JSON.parse(value);
  assertRetainedRevisionSerializationBounds(parsed);
  return parsed;
};
const integer = (value: unknown, minimum = 0) => Number.isSafeInteger(value) && (value as number) >= minimum;
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
// Retained privacy rewrites deliberately preserve old scalars/extensions. Check
// the containers used by purge code without normalizing or applying new limits.
const historicalPrivacyShape = (value: unknown) => object(value) && Array.isArray(value.classes) &&
  value.classes.every((classroom: unknown) => object(classroom) && validId(classroom.id) &&
    Array.isArray(classroom.students) && classroom.students.every((student: unknown) => object(student) && validId(student.id)) &&
    (classroom.learningEvidenceRecords == null || (Array.isArray(classroom.learningEvidenceRecords) &&
      classroom.learningEvidenceRecords.every((record: unknown) => object(record) && validId(record.studentId)))) &&
    (classroom.examRecords == null || (Array.isArray(classroom.examRecords) &&
      classroom.examRecords.every((exam: unknown) => object(exam) && Array.isArray(exam.results) &&
        exam.results.every((result: unknown) => object(result) && validId(result.studentId))))) &&
    (classroom.activeBoss == null || (object(classroom.activeBoss) && object(classroom.activeBoss.contributions) &&
      (classroom.activeBoss.attackCounts == null || object(classroom.activeBoss.attackCounts)))));
const fieldValue = (record: Row, field: Field): Scalar => {
  const [, path, kind, fallback] = field;
  let value: unknown = record;
  for (const key of path.split('.')) value = object(value) ? value[key] : undefined;
  if (kind === 'array') return canonical(Array.isArray(value) ? value : []);
  if (kind === 'object') return canonical(object(value) ? value : {});
  if (kind === 'boolean') return value === true ? 1 : 0;
  if (kind === 'nullableText') return value == null ? null : String(value);
  if (kind === 'nullableInteger') return value == null ? null : Math.trunc(Number(value));
  if (kind === 'text') return String(value ?? fallback ?? '');
  const numeric = Number(value ?? fallback ?? 0);
  return kind === 'integer' ? Math.trunc(numeric) : numeric;
};

const expectedProjection = (data: Row, revision: number) => {
  const expected = Object.fromEntries(projectionTables.map((table) => [table, new Map<string, Row>()])) as Record<ProjectionTable, Map<string, Row>>;
  const append = (table: ProjectionTable, record: unknown, index: number, keys: Row) => {
    if (!object(record) || Object.values(keys).some((value) => !validId(value))) throw new Error();
    const spec: ProjectionSpec = projectionSpecs[table];
    const key = canonical(spec.keys.map((column) => keys[column]));
    if (expected[table].has(key)) throw new Error();
    expected[table].set(key, {
      ...keys, ...Object.fromEntries(spec.fields.map((field) => [field[0], fieldValue(record, field)])),
      source_revision: revision, sort_index: index, record_json: canonical(record),
    });
  };
  for (const [classIndex, classroom] of (data.classes as Row[]).entries()) {
    const classId = classroom.id;
    append('classes', classroom, classIndex, { class_id: classId });
    const students = Array.isArray(classroom.students) ? classroom.students as Row[] : [];
    for (const [studentIndex, student] of students.entries()) {
      const keys = { class_id: classId, student_id: student.id };
      append('students', student, studentIndex, keys);
      for (const [table, property, idColumn] of [
        ['point_adjustments', 'pointAdjustmentRecords', 'adjustment_id'],
        ['discipline_records', 'disciplineRecords', 'discipline_id'],
        ['boss_rewards', 'bossRewardRecords', 'reward_id'],
      ] as const) {
        const records = student[property];
        if (Array.isArray(records)) records.forEach((record: Row, index) => append(table, record, index, { ...keys, [idColumn]: record.id }));
      }
    }
    const studentIds = new Set(students.map((student) => student.id));
    const exams = classroom.examRecords;
    if (Array.isArray(exams)) exams.forEach((exam: Row, index) => {
      const keys = { class_id: classId, exam_id: exam.id };
      append('exam_records', exam, index, keys);
      if (Array.isArray(exam.results)) exam.results.forEach((result: Row, resultIndex) => {
        if (!studentIds.has(result.studentId)) throw new Error();
        append('exam_results', result, resultIndex, { ...keys, student_id: result.studentId });
      });
    });
    const evidence = classroom.learningEvidenceRecords;
    if (Array.isArray(evidence)) evidence.forEach((record: Row, index) => {
      if (!studentIds.has(record.studentId) || (record.classId !== undefined && record.classId !== classId)) throw new Error();
      append('learning_evidence', record, index, { class_id: classId, evidence_id: record.id });
    });
  }
  return expected;
};

/**
 * Read-only inspection of a quiescent, quarantined recovery candidate. The caller
 * must stop concurrent writers and separately replay/verify its external privacy
 * suppression journal before considering release. No request route invokes this.
 * No repository get/reconcile methods are used because those can persist status.
 */
export const validateD1Recovery = async (
  database: D1Database,
  options: D1RecoveryValidationOptions,
): Promise<D1RecoveryValidationReport> => {
  const counts = new Map<D1RecoveryIssueCode, number>();
  const report: D1RecoveryValidationReport = {
    status: 'blocked', privacyStatus: 'not_verified', checkedWorkspaces: 0,
    legacyUnclaimedWorkspaces: 0, truncated: false, issues: [],
  };
  const issue = (code: D1RecoveryIssueCode, count = 1) => { if (count > 0) counts.set(code, (counts.get(code) ?? 0) + count); };
  const finish = () => {
    report.issues = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count }));
    report.status = counts.size === 0 && !report.truncated ? 'structurally_valid' : 'blocked';
    return report;
  };
  const maxWorkspaces = options?.maxWorkspaces ?? 100;
  const pageSize = options?.pageSize ?? 10;
  const maxRows = options?.maxProjectionRowsPerWorkspace ?? 100_000;
  const migrations = options?.expectedMigrations;
  const expectedSchema = options?.expectedSchema;
  if (!Array.isArray(migrations) || migrations.length === 0 || migrations.length > 1_000 ||
    migrations.some((name) => typeof name !== 'string' || !/^\d{4,}_[A-Za-z0-9_-]+\.sql$/.test(name)) ||
    new Set(migrations).size !== migrations.length ||
    !integer(maxWorkspaces, 1) || maxWorkspaces > 10_000 || !integer(pageSize, 1) || pageSize > 100 ||
    !integer(maxRows, 1) || maxRows > 100_000 ||
    (expectedSchema !== undefined && (!Array.isArray(expectedSchema) || expectedSchema.length > 1_000 ||
      expectedSchema.some((entry) => !entry || !['table', 'index', 'trigger'].includes(entry.type) ||
        typeof entry.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,199}$/.test(entry.name) ||
        entry.name === 'd1_migrations' || entry.name.startsWith('sqlite_') || entry.name.startsWith('_cf_') ||
        typeof entry.sql !== 'string' || !entry.sql.trim() || entry.sql.length > 100_000) ||
      new Set(expectedSchema.map((entry) => `${entry.type}:${entry.name}`)).size !== expectedSchema.length)) ||
    (options.allowUnclaimedLegacy !== undefined && typeof options.allowUnclaimedLegacy !== 'boolean')) {
    issue('INVALID_OPTIONS');
    return finish();
  }
  if (!expectedSchema?.length) issue('SCHEMA_EVIDENCE_MISSING');
  const rows = async <T = Row>(sql: string, ...bindings: Scalar[]): Promise<T[]> => {
    const result = await database.prepare(sql).bind(...bindings).all<T>();
    if (!result.success) throw new Error();
    return result.results;
  };
  const count = async (sql: string, ...bindings: Scalar[]) => {
    const result = await rows<{ count: number }>(sql, ...bindings);
    if (result.length !== 1 || !integer(result[0].count)) throw new Error();
    return result[0].count;
  };
  try {
    const schema = await rows<{ type: string; name: string; sql: string | null }>(
      `SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'trigger', 'index', 'view') LIMIT 1001`,
    );
    if (schema.length > 1_000) { issue('SCHEMA_MISMATCH'); return finish(); }
    const has = (type: string, name: string) => schema.some((row) => row.type === type && row.name === name);
    if (expectedSchema?.length) {
      // D1 owns the _cf_ namespace (including current workerd's _cf_METADATA).
      // Match the platform export boundary, not one historical internal name.
      const userSchema = schema.filter((entry) => entry.name !== 'd1_migrations' && !entry.name.startsWith('sqlite_') && !entry.name.startsWith('_cf_'));
      if (userSchema.length !== expectedSchema.length || expectedSchema.some((expected) =>
        !userSchema.some((actual) => actual.type === expected.type && actual.name === expected.name && actual.sql?.trim() === expected.sql.trim()))) issue('SCHEMA_MISMATCH');
    }
    for (const name of requiredTriggers) if (!has('trigger', name)) issue('SCHEMA_MISMATCH');
    for (const name of requiredIndexes) if (!has('index', name)) issue('SCHEMA_MISMATCH');
    for (const [table, columns] of Object.entries(schemaColumns)) {
      if (!has('table', table)) { issue('SCHEMA_MISMATCH'); continue; }
      const actual = await rows<{ name: string }>(`SELECT name FROM pragma_table_info(?) LIMIT 201`, table);
      if (actual.length > 200 || columns.some((column) => !actual.some((entry) => entry.name === column))) issue('SCHEMA_MISMATCH');
    }
    // Optional expansion: historical seven-migration backups remain inspectable.
    // Pristine schema evidence still verifies its full PK/FK/CHECK definitions.
    const hasOnboarding = has('table', 'auth_product_onboarding');
    if (migrations.includes('0008_product_onboarding.sql') && !hasOnboarding) issue('SCHEMA_MISMATCH');
    if (hasOnboarding) {
      const columns = await rows<{ name: string }>(`SELECT name FROM pragma_table_info('auth_product_onboarding') LIMIT 7`);
      if (columns.length !== 5 || ['user_id', 'cohort_day', 'started', 'local_reported', 'backend_persisted']
        .some((column) => !columns.some((entry) => entry.name === column)) ||
        !has('index', 'idx_auth_product_onboarding_cohort')) issue('SCHEMA_MISMATCH');
    }
    if (!has('table', 'd1_migrations')) issue('MIGRATION_LEDGER_MISSING');
    else {
      const ledgerColumns = await rows<{ name: string; type: string; pk: number; notnull: number; dflt_value: string | null }>(
        `SELECT name, type, pk, "notnull", dflt_value FROM pragma_table_info('d1_migrations') LIMIT 5`,
      );
      if (ledgerColumns.length !== 3 || !ledgerColumns.some((column) => column.name === 'id' && column.type.toUpperCase() === 'INTEGER' && column.pk === 1) ||
        !ledgerColumns.some((column) => column.name === 'name' && column.type.toUpperCase() === 'TEXT') ||
        !ledgerColumns.some((column) => column.name === 'applied_at' && column.notnull === 1 &&
          typeof column.dflt_value === 'string' && /^(?:CURRENT_TIMESTAMP|\(CURRENT_TIMESTAMP\))$/i.test(column.dflt_value.trim()))) issue('SCHEMA_MISMATCH');
      const ledgerIndexes = await rows<{ name: string; unique: number; partial: number }>(
        `SELECT name, "unique", partial FROM pragma_index_list('d1_migrations') LIMIT 101`,
      );
      let uniqueName = false;
      if (ledgerIndexes.length > 100) issue('SCHEMA_MISMATCH');
      else for (const index of ledgerIndexes.filter((entry) => entry.unique === 1 && entry.partial === 0)) {
        const columns = await rows<{ name: string }>(`SELECT name FROM pragma_index_info(?) ORDER BY seqno LIMIT 3`, index.name);
        if (columns.length === 1 && columns[0].name === 'name') uniqueName = true;
      }
      if (!uniqueName) issue('SCHEMA_MISMATCH');
      const ledger = await rows<{ id: number; name: string }>(`SELECT id, name FROM d1_migrations ORDER BY id LIMIT ?`, migrations.length + 1);
      const names = new Set(ledger.map((entry) => entry.name));
      for (const name of migrations) if (!names.has(name)) issue('MIGRATION_MISSING');
      for (const entry of ledger) if (!migrations.includes(entry.name)) issue('MIGRATION_UNKNOWN');
      if (ledger.length > migrations.length || ledger.some((entry, index) => !integer(entry.id, 1) ||
        (index > 0 && entry.id <= ledger[index - 1].id) || entry.name !== migrations[index])) issue('MIGRATION_ORDER');
    }
    // SQLite's raw integrity errors can contain record contents. Never return them.
    // D1's authorizer rejects integrity_check; quick_check is its supported
    // read-only structural check. One result bounds potential error output.
    const integrity = await rows(`PRAGMA quick_check(1)`);
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') issue('INTEGRITY_CHECK_FAILED');
    issue('FOREIGN_KEY_VIOLATION', await count(`SELECT COUNT(*) AS count FROM pragma_foreign_key_check`));
    if (counts.has('SCHEMA_MISMATCH')) return finish();
    if (hasOnboarding) {
      // A 10-character CHECK does not establish a real calendar date. Never
      // emit the account key or the malformed value in recovery evidence.
      issue('ONBOARDING_INVALID', await count(`SELECT COUNT(*) AS count FROM auth_product_onboarding
        WHERE typeof(cohort_day) <> 'text' OR length(cohort_day) <> 10
          OR cohort_day NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          OR cohort_day < '1970-01-01' OR date(cohort_day, '+0 days') IS NULL
          OR date(cohort_day, '+0 days') <> cohort_day
          OR typeof(started) <> 'integer' OR started NOT IN (0, 1)
          OR typeof(local_reported) <> 'integer' OR local_reported NOT IN (0, 1)
          OR typeof(backend_persisted) <> 'integer' OR backend_persisted NOT IN (0, 1)
          OR local_reported > started OR backend_persisted > started`));
    }

    // Invalid children outside an existing tenant would be skipped by workspace
    // pagination; the global FK aggregate above explicitly includes those rows.
    issue('CLASS_ASSIGNMENT_INVALID', await count(`SELECT COUNT(*) AS count
      FROM workspace_class_assignments a
      LEFT JOIN classes c ON c.workspace_id = a.workspace_id AND c.class_id = a.class_id
      LEFT JOIN workspace_memberships m ON m.workspace_id = a.workspace_id AND m.user_id = a.user_id
      WHERE c.class_id IS NULL OR m.user_id IS NULL OR m.role NOT IN ('teacher', 'viewer')`));
    issue('WORKSPACE_INVALID', await count(`SELECT COUNT(*) AS count FROM workspaces
      WHERE workspace_id IS NULL OR typeof(workspace_id) <> 'text'
        OR length(trim(workspace_id)) = 0 OR length(workspace_id) > 200`));

    let cursor: string | null = null;
    while (report.checkedWorkspaces < maxWorkspaces) {
      const remaining = Math.min(pageSize, maxWorkspaces - report.checkedWorkspaces);
      const workspaces = await rows<{ workspace_id: string }>(
        `SELECT workspace_id FROM workspaces WHERE typeof(workspace_id) = 'text'
          AND length(trim(workspace_id)) > 0 AND length(workspace_id) <= 200
          AND (? IS NULL OR workspace_id > ?) ORDER BY workspace_id LIMIT ?`,
        cursor, cursor, remaining + 1,
      );
      for (const { workspace_id: workspaceId } of workspaces.slice(0, remaining)) {
        report.checkedWorkspaces += 1;
        cursor = workspaceId;
        const metadata = await rows<{ revision: number; updated_at: number; bytes: number }>(
          `SELECT revision, updated_at, length(CAST(data_json AS BLOB)) AS bytes FROM workspaces WHERE workspace_id = ?`, workspaceId,
        );
        const meta = metadata[0];
        if (!meta || !integer(meta.revision, 1) || !integer(meta.updated_at)) { issue('WORKSPACE_INVALID'); continue; }
        if (!integer(meta.bytes) || meta.bytes > MAX_D1_STATE_BYTES) { issue('WORKSPACE_TOO_LARGE'); continue; }
        const source = (await rows<{ data_json: string }>(`SELECT data_json FROM workspaces WHERE workspace_id = ?`, workspaceId))[0];
        let data: Row;
        let expected: ReturnType<typeof expectedProjection>;
        try {
          const parsed = parseBounded(source?.data_json);
          assertWorkspaceData(parsed);
          if (!object(parsed) || !Array.isArray(parsed.classes)) throw new Error();
          data = parsed;
          expected = expectedProjection(data, meta.revision);
        } catch { issue('WORKSPACE_INVALID'); continue; }

        const ownership = (await rows<{ claims: number; memberships: number; owners: number; matched: number }>(
          `SELECT
            (SELECT COUNT(*) FROM workspace_claims WHERE workspace_id = ?) AS claims,
            (SELECT COUNT(*) FROM workspace_memberships WHERE workspace_id = ?) AS memberships,
            (SELECT COUNT(*) FROM workspace_memberships WHERE workspace_id = ? AND role = 'owner') AS owners,
            (SELECT COUNT(*) FROM workspace_memberships m JOIN workspace_claims c
              ON c.workspace_id = m.workspace_id AND c.claimed_by_user_id = m.user_id
              WHERE m.workspace_id = ? AND m.role = 'owner') AS matched`,
          workspaceId, workspaceId, workspaceId, workspaceId,
        ))[0];
        if (ownership.claims === 0 && ownership.memberships === 0) {
          report.legacyUnclaimedWorkspaces += 1;
          if (!options.allowUnclaimedLegacy) issue('UNCLAIMED_LEGACY');
        } else if (ownership.claims !== 1 || ownership.owners !== 1 || ownership.matched !== 1) issue('OWNERSHIP_MISMATCH');

        const historyMeta = await rows<{ revision: number; bytes: number; data_size_bytes: number; updated_at: number }>(
          `SELECT revision, length(CAST(data_json AS BLOB)) AS bytes, data_size_bytes, updated_at
           FROM workspace_revisions WHERE workspace_id = ? ORDER BY revision DESC LIMIT ?`,
          workspaceId, MAX_STORED_REVISIONS + 1,
        );
        if (historyMeta.length > MAX_STORED_REVISIONS) issue('HISTORY_LIMIT');
        let previous = meta.revision + 1;
        for (const retained of historyMeta.slice(0, MAX_STORED_REVISIONS)) {
          if (!integer(retained.revision, 1) || retained.revision !== previous - 1 || !integer(retained.updated_at) ||
            !integer(retained.data_size_bytes) || retained.data_size_bytes !== retained.bytes) issue('HISTORY_INVALID');
          previous = retained.revision;
          if (!integer(retained.bytes) || retained.bytes > MAX_D1_STATE_BYTES) { issue('HISTORY_TOO_LARGE'); continue; }
          const snapshot = (await rows<{ data_json: string }>(`SELECT data_json FROM workspace_revisions WHERE workspace_id = ? AND revision = ?`, workspaceId, retained.revision))[0];
          try {
            // Historic privacy rewrites preserve unrelated legacy values; do not
            // impose today's current-snapshot schema on those retained records.
            const parsed = parseBounded(snapshot?.data_json);
            if (!historicalPrivacyShape(parsed)) throw new Error();
          } catch { issue('HISTORY_INVALID'); }
          if (retained.revision === meta.revision && (snapshot?.data_json !== source.data_json || retained.updated_at !== meta.updated_at)) issue('HISTORY_LATEST_MISMATCH');
        }
        if (!historyMeta.length || historyMeta[0].revision !== meta.revision) issue('HISTORY_LATEST_MISMATCH');

        const sizes: { count: number; bytes: number; stale: number }[] = [];
        // D1's compound-SELECT limit is lower than SQLite's default. Keep these
        // eight fixed aggregates separate rather than depending on UNION limits.
        for (const table of projectionTables) {
          const spec: ProjectionSpec = projectionSpecs[table];
          const byteColumns = [...new Set([...spec.keys, ...spec.fields.map(([column]) => column), 'record_json'])];
          const byteSize = byteColumns.map((column) => `COALESCE(length(CAST(${column} AS BLOB)), 0)`).join(' + ');
          sizes.push(...await rows<{ count: number; bytes: number; stale: number }>(
          `SELECT COUNT(*) AS count, COALESCE(SUM(${byteSize}), 0) AS bytes,
            COALESCE(SUM(CASE WHEN source_revision <> ? THEN 1 ELSE 0 END), 0) AS stale FROM ${table} WHERE workspace_id = ?`,
          meta.revision, workspaceId,
          ));
        }
        if (sizes.length !== projectionTables.length || sizes.some((value) => !integer(value.count) || !integer(value.bytes) || !integer(value.stale))) throw new Error();
        if (sizes.reduce((sum, value) => sum + value.count, 0) > maxRows || sizes.reduce((sum, value) => sum + value.bytes, 0) > 8 * MAX_D1_STATE_BYTES) {
          issue('PROJECTION_LIMIT'); continue;
        }
        if (sizes.some((value) => value.stale > 0)) issue('PROJECTION_MISMATCH');
        const state = await rows<{ source_revision: number }>(`SELECT source_revision FROM workspace_projection_state WHERE workspace_id = ? LIMIT 2`, workspaceId);
        const documents = await rows<{ source_revision: number; root_json: string; bytes: number }>(
          `SELECT source_revision, CASE WHEN length(CAST(root_json AS BLOB)) <= ? THEN root_json ELSE NULL END AS root_json,
            length(CAST(root_json AS BLOB)) AS bytes FROM workspace_projection_documents WHERE workspace_id = ? LIMIT 2`,
          MAX_D1_STATE_BYTES, workspaceId,
        );
        const { classes: _classes, ...root } = data;
        try {
          if (state.length !== 1 || state[0].source_revision !== meta.revision || documents.length !== 1 ||
            documents[0].source_revision !== meta.revision || canonical(parseBounded(documents[0].root_json)) !== canonical(root)) throw new Error();
        } catch { issue('PROJECTION_MISMATCH'); }
        for (const table of projectionTables) {
          const spec: ProjectionSpec = projectionSpecs[table];
          const columns = [...new Set([...spec.keys, ...spec.fields.map(([column]) => column), 'source_revision', 'sort_index', 'record_json'])];
          const actual = await rows(`SELECT ${columns.join(', ')} FROM ${table} WHERE workspace_id = ? LIMIT ?`, workspaceId, maxRows + 1);
          let mismatch = actual.length !== expected[table].size;
          for (const row of actual) {
            const key = canonical(spec.keys.map((column) => row[column]));
            const target = expected[table].get(key);
            if (!target) { mismatch = true; continue; }
            try {
              const normalized: Row = { ...row, record_json: canonical(parseBounded(row.record_json)) };
              for (const [column, , kind] of spec.fields) if (kind === 'array' || kind === 'object') normalized[column] = canonical(parseBounded(row[column]));
              if (canonical(normalized) !== canonical(target)) mismatch = true;
            } catch { mismatch = true; }
          }
          if (mismatch) issue('PROJECTION_MISMATCH');
        }
      }
      if (workspaces.length <= remaining) return finish();
      if (report.checkedWorkspaces === maxWorkspaces) {
        report.truncated = true;
        issue('VALIDATION_TRUNCATED');
      }
    }
  } catch {
    // Database errors can include SQL literals, IDs, and constraint values.
    issue('QUERY_FAILED');
  }
  return finish();
};
