import type {
  D1Database,
  D1PreparedStatement,
} from '@cloudflare/workers-types';
import type {
  AuditEventRecord,
  WorkspaceWriteContext,
} from '../server/contracts';

const auditMetadataJson = (event: AuditEventRecord) =>
  JSON.stringify(event.metadata ?? {});

export const projectionGateStatement = (
  database: D1Database,
  workspaceId: string,
  sourceRevision: number,
  writeToken: string,
  projectedAt: number,
  requirePreviousChange: boolean,
): D1PreparedStatement => {
  const source = requirePreviousChange
    ? `SELECT ?, ?, ?, ? WHERE changes() = 1`
    : `VALUES (?, ?, ?, ?)`;
  return database
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
};

export const projectionRebuildGateStatement = (
  database: D1Database,
  workspaceId: string,
  sourceRevision: number,
  writeToken: string,
  projectedAt: number,
): D1PreparedStatement => {
  return database
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
};

export const projectionStatements = (
  database: D1Database,
  workspaceId: string,
  sourceRevision: number,
  writeToken: string,
): D1PreparedStatement[] => {
  return [
    database
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
    database
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
    database
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
    database
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
    database
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

    database
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
    database
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
    database
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
    database
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
    database
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
    database
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
};

export const workspaceAuditStatement = (
  database: D1Database,
  workspaceId: string,
  sourceRevision: number,
  updatedAt: number,
  context: WorkspaceWriteContext,
  writeToken: string,
): D1PreparedStatement => {
  return database
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
};

export const auditStatement = (
  database: D1Database,
  event: AuditEventRecord,
) => {
  return database
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
};
