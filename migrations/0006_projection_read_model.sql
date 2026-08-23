-- P1 normalized read model and reconciliation metadata.
--
-- The entity projections remain independently queryable, while this document
-- stores only the AppData root (everything except `classes`). Array positions
-- preserve the exact application ordering during normalized reconstruction.

CREATE TABLE IF NOT EXISTS workspace_projection_documents (
  workspace_id TEXT PRIMARY KEY,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  root_json TEXT NOT NULL CHECK (json_valid(root_json)),
  reconciliation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending', 'verified', 'mismatch')),
  source_checksum TEXT,
  projection_checksum TEXT,
  reconciled_at INTEGER,
  details_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(details_json)),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (workspace_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projection_documents_status
  ON workspace_projection_documents (reconciliation_status, workspace_id);

ALTER TABLE classes ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exam_records ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exam_results ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_evidence ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE point_adjustments ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discipline_records ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE boss_rewards ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;

INSERT OR REPLACE INTO workspace_projection_documents (
  workspace_id,
  source_revision,
  root_json,
  reconciliation_status,
  source_checksum,
  projection_checksum,
  reconciled_at,
  details_json
)
SELECT
  workspace_id,
  revision,
  json_remove(data_json, '$.classes'),
  'pending',
  NULL,
  NULL,
  NULL,
  '{}'
FROM workspaces
WHERE json_valid(data_json);

UPDATE classes
SET sort_index = COALESCE((
  SELECT CAST(class_item.key AS INTEGER)
  FROM workspaces
  JOIN json_each(
    CASE
      WHEN json_type(workspaces.data_json, '$.classes') = 'array'
        THEN json_extract(workspaces.data_json, '$.classes')
      ELSE '[]'
    END
  ) AS class_item
  WHERE
    workspaces.workspace_id = classes.workspace_id AND
    CAST(json_extract(class_item.value, '$.id') AS TEXT) = classes.class_id
  ORDER BY CAST(class_item.key AS INTEGER)
  LIMIT 1
), 0);

UPDATE students
SET sort_index = COALESCE((
  SELECT CAST(student_item.key AS INTEGER)
  FROM workspaces
  JOIN json_each(json_extract(workspaces.data_json, '$.classes')) AS class_item
  JOIN json_each(
    CASE
      WHEN json_type(class_item.value, '$.students') = 'array'
        THEN json_extract(class_item.value, '$.students')
      ELSE '[]'
    END
  ) AS student_item
  WHERE
    workspaces.workspace_id = students.workspace_id AND
    CAST(json_extract(class_item.value, '$.id') AS TEXT) = students.class_id AND
    CAST(json_extract(student_item.value, '$.id') AS TEXT) = students.student_id
  ORDER BY CAST(student_item.key AS INTEGER)
  LIMIT 1
), 0);

UPDATE exam_records
SET sort_index = COALESCE((
  SELECT CAST(exam_item.key AS INTEGER)
  FROM workspaces
  JOIN json_each(json_extract(workspaces.data_json, '$.classes')) AS class_item
  JOIN json_each(
    CASE
      WHEN json_type(class_item.value, '$.examRecords') = 'array'
        THEN json_extract(class_item.value, '$.examRecords')
      ELSE '[]'
    END
  ) AS exam_item
  WHERE
    workspaces.workspace_id = exam_records.workspace_id AND
    CAST(json_extract(class_item.value, '$.id') AS TEXT) = exam_records.class_id AND
    CAST(json_extract(exam_item.value, '$.id') AS TEXT) = exam_records.exam_id
  ORDER BY CAST(exam_item.key AS INTEGER)
  LIMIT 1
), 0);

UPDATE exam_results
SET sort_index = COALESCE((
  SELECT CAST(result_item.key AS INTEGER)
  FROM workspaces
  JOIN json_each(json_extract(workspaces.data_json, '$.classes')) AS class_item
  JOIN json_each(json_extract(class_item.value, '$.examRecords')) AS exam_item
  JOIN json_each(
    CASE
      WHEN json_type(exam_item.value, '$.results') = 'array'
        THEN json_extract(exam_item.value, '$.results')
      ELSE '[]'
    END
  ) AS result_item
  WHERE
    workspaces.workspace_id = exam_results.workspace_id AND
    CAST(json_extract(class_item.value, '$.id') AS TEXT) = exam_results.class_id AND
    CAST(json_extract(exam_item.value, '$.id') AS TEXT) = exam_results.exam_id AND
    CAST(json_extract(result_item.value, '$.studentId') AS TEXT) = exam_results.student_id
  ORDER BY CAST(result_item.key AS INTEGER)
  LIMIT 1
), 0);

UPDATE learning_evidence
SET sort_index = COALESCE((
  SELECT CAST(evidence_item.key AS INTEGER)
  FROM workspaces
  JOIN json_each(json_extract(workspaces.data_json, '$.classes')) AS class_item
  JOIN json_each(
    CASE
      WHEN json_type(class_item.value, '$.learningEvidenceRecords') = 'array'
        THEN json_extract(class_item.value, '$.learningEvidenceRecords')
      ELSE '[]'
    END
  ) AS evidence_item
  WHERE
    workspaces.workspace_id = learning_evidence.workspace_id AND
    CAST(json_extract(class_item.value, '$.id') AS TEXT) = learning_evidence.class_id AND
    CAST(json_extract(evidence_item.value, '$.id') AS TEXT) = learning_evidence.evidence_id
  ORDER BY CAST(evidence_item.key AS INTEGER)
  LIMIT 1
), 0);

UPDATE point_adjustments
SET sort_index = COALESCE((
  SELECT CAST(adjustment_item.key AS INTEGER)
  FROM workspaces
  JOIN json_each(json_extract(workspaces.data_json, '$.classes')) AS class_item
  JOIN json_each(json_extract(class_item.value, '$.students')) AS student_item
  JOIN json_each(
    CASE
      WHEN json_type(student_item.value, '$.pointAdjustmentRecords') = 'array'
        THEN json_extract(student_item.value, '$.pointAdjustmentRecords')
      ELSE '[]'
    END
  ) AS adjustment_item
  WHERE
    workspaces.workspace_id = point_adjustments.workspace_id AND
    CAST(json_extract(class_item.value, '$.id') AS TEXT) = point_adjustments.class_id AND
    CAST(json_extract(student_item.value, '$.id') AS TEXT) = point_adjustments.student_id AND
    CAST(json_extract(adjustment_item.value, '$.id') AS TEXT) = point_adjustments.adjustment_id
  ORDER BY CAST(adjustment_item.key AS INTEGER)
  LIMIT 1
), 0);

UPDATE discipline_records
SET sort_index = COALESCE((
  SELECT CAST(discipline_item.key AS INTEGER)
  FROM workspaces
  JOIN json_each(json_extract(workspaces.data_json, '$.classes')) AS class_item
  JOIN json_each(json_extract(class_item.value, '$.students')) AS student_item
  JOIN json_each(
    CASE
      WHEN json_type(student_item.value, '$.disciplineRecords') = 'array'
        THEN json_extract(student_item.value, '$.disciplineRecords')
      ELSE '[]'
    END
  ) AS discipline_item
  WHERE
    workspaces.workspace_id = discipline_records.workspace_id AND
    CAST(json_extract(class_item.value, '$.id') AS TEXT) = discipline_records.class_id AND
    CAST(json_extract(student_item.value, '$.id') AS TEXT) = discipline_records.student_id AND
    CAST(json_extract(discipline_item.value, '$.id') AS TEXT) = discipline_records.discipline_id
  ORDER BY CAST(discipline_item.key AS INTEGER)
  LIMIT 1
), 0);

UPDATE boss_rewards
SET sort_index = COALESCE((
  SELECT CAST(reward_item.key AS INTEGER)
  FROM workspaces
  JOIN json_each(json_extract(workspaces.data_json, '$.classes')) AS class_item
  JOIN json_each(json_extract(class_item.value, '$.students')) AS student_item
  JOIN json_each(
    CASE
      WHEN json_type(student_item.value, '$.bossRewardRecords') = 'array'
        THEN json_extract(student_item.value, '$.bossRewardRecords')
      ELSE '[]'
    END
  ) AS reward_item
  WHERE
    workspaces.workspace_id = boss_rewards.workspace_id AND
    CAST(json_extract(class_item.value, '$.id') AS TEXT) = boss_rewards.class_id AND
    CAST(json_extract(student_item.value, '$.id') AS TEXT) = boss_rewards.student_id AND
    CAST(json_extract(reward_item.value, '$.id') AS TEXT) = boss_rewards.reward_id
  ORDER BY CAST(reward_item.key AS INTEGER)
  LIMIT 1
), 0);
