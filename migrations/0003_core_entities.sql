-- Staged dual-write projections for the legacy AppData blob.
--
-- `workspaces.data_json` remains the compatibility read model.  Every row in
-- the tables below carries both the tenant key and the blob revision that
-- produced it, so stale projections are detectable and cannot cross tenants.

CREATE TABLE IF NOT EXISTS workspace_projection_state (
  workspace_id TEXT PRIMARY KEY,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  write_token TEXT NOT NULL,
  projected_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (workspace_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS classes (
  workspace_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (workspace_id, class_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (workspace_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_classes_workspace_revision
  ON classes (workspace_id, source_revision);

CREATE TABLE IF NOT EXISTS students (
  workspace_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  name TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  rank_points REAL NOT NULL DEFAULT 0,
  warning_points REAL NOT NULL DEFAULT 0,
  pet_type TEXT NOT NULL DEFAULT '',
  pet_fullness REAL NOT NULL DEFAULT 0,
  pet_happiness REAL NOT NULL DEFAULT 0,
  pet_level INTEGER NOT NULL DEFAULT 1,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (workspace_id, class_id, student_id),
  FOREIGN KEY (workspace_id, class_id)
    REFERENCES classes (workspace_id, class_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_students_workspace_revision
  ON students (workspace_id, source_revision);

CREATE TABLE IF NOT EXISTS exam_records (
  workspace_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  title TEXT NOT NULL,
  exam_date TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL CHECK (json_valid(items_json)),
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (workspace_id, class_id, exam_id),
  FOREIGN KEY (workspace_id, class_id)
    REFERENCES classes (workspace_id, class_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exam_records_workspace_revision
  ON exam_records (workspace_id, source_revision);

CREATE TABLE IF NOT EXISTS exam_results (
  workspace_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  scores_json TEXT NOT NULL CHECK (json_valid(scores_json)),
  mentor_comment TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (workspace_id, class_id, exam_id, student_id),
  FOREIGN KEY (workspace_id, class_id, exam_id)
    REFERENCES exam_records (workspace_id, class_id, exam_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, class_id, student_id)
    REFERENCES students (workspace_id, class_id, student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exam_results_student
  ON exam_results (workspace_id, class_id, student_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS learning_evidence (
  workspace_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  competency TEXT NOT NULL,
  level TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  actor TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  rubric_version TEXT NOT NULL,
  evidence_revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (workspace_id, class_id, evidence_id),
  FOREIGN KEY (workspace_id, class_id, student_id)
    REFERENCES students (workspace_id, class_id, student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_evidence_student_created
  ON learning_evidence (workspace_id, class_id, student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS point_adjustments (
  workspace_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  adjustment_id TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  reason_id TEXT,
  reason_label TEXT,
  competency TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (workspace_id, class_id, student_id, adjustment_id),
  FOREIGN KEY (workspace_id, class_id, student_id)
    REFERENCES students (workspace_id, class_id, student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_point_adjustments_student_created
  ON point_adjustments (workspace_id, class_id, student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS discipline_records (
  workspace_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  discipline_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  warning_count INTEGER,
  reason TEXT,
  action_kind TEXT,
  reverses_record_id TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (workspace_id, class_id, student_id, discipline_id),
  FOREIGN KEY (workspace_id, class_id, student_id)
    REFERENCES students (workspace_id, class_id, student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discipline_records_student_created
  ON discipline_records (workspace_id, class_id, student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS boss_rewards (
  workspace_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  boss_id TEXT NOT NULL,
  boss_name TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  damage REAL NOT NULL DEFAULT 0,
  attack_count INTEGER NOT NULL DEFAULT 0,
  fair_score REAL NOT NULL DEFAULT 0,
  previous_damage REAL NOT NULL DEFAULT 0,
  previous_fair_score REAL NOT NULL DEFAULT 0,
  improvement_amount REAL NOT NULL DEFAULT 0,
  fair_improvement_amount REAL NOT NULL DEFAULT 0,
  reward_points REAL NOT NULL DEFAULT 0,
  reward_rank_points REAL NOT NULL DEFAULT 0,
  reward_happiness REAL NOT NULL DEFAULT 0,
  rank_reward_points REAL NOT NULL DEFAULT 0,
  rank_reward_rank_points REAL NOT NULL DEFAULT 0,
  rank_reward_happiness REAL NOT NULL DEFAULT 0,
  participation_reward_points REAL NOT NULL DEFAULT 0,
  participation_reward_rank_points REAL NOT NULL DEFAULT 0,
  participation_reward_happiness REAL NOT NULL DEFAULT 0,
  improvement_reward_points REAL NOT NULL DEFAULT 0,
  improvement_reward_rank_points REAL NOT NULL DEFAULT 0,
  improvement_reward_happiness REAL NOT NULL DEFAULT 0,
  received_improvement_reward INTEGER NOT NULL DEFAULT 0
    CHECK (received_improvement_reward IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT 0,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (workspace_id, class_id, student_id, reward_id),
  FOREIGN KEY (workspace_id, class_id, student_id)
    REFERENCES students (workspace_id, class_id, student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_boss_rewards_student_created
  ON boss_rewards (workspace_id, class_id, student_id, created_at DESC);

-- Backfill projection state and all core entities from valid legacy blobs.
INSERT OR REPLACE INTO workspace_projection_state (
  workspace_id, source_revision, write_token, projected_at
)
SELECT workspace_id, revision, 'migration-0003', updated_at
FROM workspaces
WHERE json_valid(data_json);

INSERT OR REPLACE INTO classes (
  workspace_id, class_id, name, source_revision, record_json
)
SELECT
  w.workspace_id,
  CAST(json_extract(class_item.value, '$.id') AS TEXT),
  COALESCE(CAST(json_extract(class_item.value, '$.name') AS TEXT), ''),
  w.revision,
  class_item.value
FROM workspaces AS w
JOIN json_each(
  CASE
    WHEN json_valid(w.data_json)
      AND json_type(w.data_json, '$.classes') = 'array'
      THEN json_extract(w.data_json, '$.classes')
    ELSE '[]'
  END
) AS class_item
WHERE
  json_type(class_item.value) = 'object' AND
  NULLIF(TRIM(CAST(json_extract(class_item.value, '$.id') AS TEXT)), '')
    IS NOT NULL;

INSERT OR REPLACE INTO students (
  workspace_id, class_id, student_id, name, points, rank_points,
  warning_points, pet_type, pet_fullness, pet_happiness, pet_level,
  source_revision, record_json
)
SELECT
  c.workspace_id,
  c.class_id,
  CAST(json_extract(student_item.value, '$.id') AS TEXT),
  COALESCE(CAST(json_extract(student_item.value, '$.name') AS TEXT), ''),
  CAST(COALESCE(json_extract(student_item.value, '$.points'), 0) AS REAL),
  CAST(COALESCE(json_extract(student_item.value, '$.rankPoints'), 0) AS REAL),
  CAST(COALESCE(json_extract(student_item.value, '$.warningPoints'), 0) AS REAL),
  COALESCE(CAST(json_extract(student_item.value, '$.pet.type') AS TEXT), ''),
  CAST(COALESCE(json_extract(student_item.value, '$.pet.fullness'), 0) AS REAL),
  CAST(COALESCE(json_extract(student_item.value, '$.pet.happiness'), 0) AS REAL),
  CAST(COALESCE(json_extract(student_item.value, '$.pet.level'), 1) AS INTEGER),
  c.source_revision,
  student_item.value
FROM classes AS c
JOIN json_each(
  CASE
    WHEN json_type(c.record_json, '$.students') = 'array'
      THEN json_extract(c.record_json, '$.students')
    ELSE '[]'
  END
) AS student_item
WHERE
  json_type(student_item.value) = 'object' AND
  NULLIF(TRIM(CAST(json_extract(student_item.value, '$.id') AS TEXT)), '')
    IS NOT NULL;

INSERT OR REPLACE INTO exam_records (
  workspace_id, class_id, exam_id, title, exam_date, items_json,
  created_at, updated_at, source_revision, record_json
)
SELECT
  c.workspace_id,
  c.class_id,
  CAST(json_extract(exam_item.value, '$.id') AS TEXT),
  COALESCE(CAST(json_extract(exam_item.value, '$.title') AS TEXT), ''),
  COALESCE(CAST(json_extract(exam_item.value, '$.examDate') AS TEXT), ''),
  CASE
    WHEN json_type(exam_item.value, '$.items') = 'array'
      THEN json_extract(exam_item.value, '$.items')
    ELSE '[]'
  END,
  CAST(COALESCE(json_extract(exam_item.value, '$.createdAt'), 0) AS INTEGER),
  CAST(COALESCE(json_extract(exam_item.value, '$.updatedAt'), 0) AS INTEGER),
  c.source_revision,
  exam_item.value
FROM classes AS c
JOIN json_each(
  CASE
    WHEN json_type(c.record_json, '$.examRecords') = 'array'
      THEN json_extract(c.record_json, '$.examRecords')
    ELSE '[]'
  END
) AS exam_item
WHERE
  json_type(exam_item.value) = 'object' AND
  NULLIF(TRIM(CAST(json_extract(exam_item.value, '$.id') AS TEXT)), '')
    IS NOT NULL;

INSERT OR REPLACE INTO exam_results (
  workspace_id, class_id, exam_id, student_id, scores_json,
  mentor_comment, updated_at, source_revision, record_json
)
SELECT
  e.workspace_id,
  e.class_id,
  e.exam_id,
  CAST(json_extract(result_item.value, '$.studentId') AS TEXT),
  CASE
    WHEN json_type(result_item.value, '$.scores') = 'object'
      THEN json_extract(result_item.value, '$.scores')
    ELSE '{}'
  END,
  CAST(json_extract(result_item.value, '$.mentorComment') AS TEXT),
  CAST(COALESCE(json_extract(result_item.value, '$.updatedAt'), 0) AS INTEGER),
  e.source_revision,
  result_item.value
FROM exam_records AS e
JOIN json_each(
  CASE
    WHEN json_type(e.record_json, '$.results') = 'array'
      THEN json_extract(e.record_json, '$.results')
    ELSE '[]'
  END
) AS result_item
JOIN students AS s
  ON s.workspace_id = e.workspace_id
  AND s.class_id = e.class_id
  AND s.student_id = CAST(json_extract(result_item.value, '$.studentId') AS TEXT)
WHERE json_type(result_item.value) = 'object';

INSERT OR REPLACE INTO learning_evidence (
  workspace_id, class_id, evidence_id, student_id, competency, level,
  evidence_type, title, note, actor, source, source_id, rubric_version,
  evidence_revision, created_at, source_revision, record_json
)
SELECT
  c.workspace_id,
  c.class_id,
  CAST(json_extract(evidence_item.value, '$.id') AS TEXT),
  CAST(json_extract(evidence_item.value, '$.studentId') AS TEXT),
  COALESCE(CAST(json_extract(evidence_item.value, '$.competency') AS TEXT), ''),
  COALESCE(CAST(json_extract(evidence_item.value, '$.level') AS TEXT), ''),
  COALESCE(CAST(json_extract(evidence_item.value, '$.evidenceType') AS TEXT), ''),
  COALESCE(CAST(json_extract(evidence_item.value, '$.title') AS TEXT), ''),
  CAST(json_extract(evidence_item.value, '$.note') AS TEXT),
  COALESCE(CAST(json_extract(evidence_item.value, '$.actor') AS TEXT), 'mentor'),
  COALESCE(CAST(json_extract(evidence_item.value, '$.source') AS TEXT), 'manual'),
  CAST(json_extract(evidence_item.value, '$.sourceId') AS TEXT),
  COALESCE(CAST(json_extract(evidence_item.value, '$.rubricVersion') AS TEXT), '1.0'),
  CAST(COALESCE(json_extract(evidence_item.value, '$.revision'), 1) AS INTEGER),
  CAST(COALESCE(json_extract(evidence_item.value, '$.createdAt'), 0) AS INTEGER),
  c.source_revision,
  evidence_item.value
FROM classes AS c
JOIN json_each(
  CASE
    WHEN json_type(c.record_json, '$.learningEvidenceRecords') = 'array'
      THEN json_extract(c.record_json, '$.learningEvidenceRecords')
    ELSE '[]'
  END
) AS evidence_item
JOIN students AS s
  ON s.workspace_id = c.workspace_id
  AND s.class_id = c.class_id
  AND s.student_id = CAST(json_extract(evidence_item.value, '$.studentId') AS TEXT)
WHERE
  json_type(evidence_item.value) = 'object' AND
  NULLIF(TRIM(CAST(json_extract(evidence_item.value, '$.id') AS TEXT)), '')
    IS NOT NULL;

INSERT OR REPLACE INTO point_adjustments (
  workspace_id, class_id, student_id, adjustment_id, amount, source,
  reason_id, reason_label, competency, created_at, source_revision, record_json
)
SELECT
  s.workspace_id,
  s.class_id,
  s.student_id,
  CAST(json_extract(adjustment_item.value, '$.id') AS TEXT),
  CAST(COALESCE(json_extract(adjustment_item.value, '$.amount'), 0) AS REAL),
  COALESCE(CAST(json_extract(adjustment_item.value, '$.source') AS TEXT), ''),
  CAST(json_extract(adjustment_item.value, '$.reasonId') AS TEXT),
  CAST(json_extract(adjustment_item.value, '$.reasonLabel') AS TEXT),
  CAST(json_extract(adjustment_item.value, '$.competency') AS TEXT),
  CAST(COALESCE(json_extract(adjustment_item.value, '$.createdAt'), 0) AS INTEGER),
  s.source_revision,
  adjustment_item.value
FROM students AS s
JOIN json_each(
  CASE
    WHEN json_type(s.record_json, '$.pointAdjustmentRecords') = 'array'
      THEN json_extract(s.record_json, '$.pointAdjustmentRecords')
    ELSE '[]'
  END
) AS adjustment_item
WHERE
  json_type(adjustment_item.value) = 'object' AND
  NULLIF(TRIM(CAST(json_extract(adjustment_item.value, '$.id') AS TEXT)), '')
    IS NOT NULL;

INSERT OR REPLACE INTO discipline_records (
  workspace_id, class_id, student_id, discipline_id, record_type,
  warning_count, reason, action_kind, reverses_record_id, created_at,
  source_revision, record_json
)
SELECT
  s.workspace_id,
  s.class_id,
  s.student_id,
  CAST(json_extract(discipline_item.value, '$.id') AS TEXT),
  COALESCE(CAST(json_extract(discipline_item.value, '$.type') AS TEXT), ''),
  CAST(json_extract(discipline_item.value, '$.warningCount') AS INTEGER),
  CAST(json_extract(discipline_item.value, '$.reason') AS TEXT),
  CAST(json_extract(discipline_item.value, '$.actionKind') AS TEXT),
  CAST(json_extract(discipline_item.value, '$.reversesRecordId') AS TEXT),
  CAST(COALESCE(json_extract(discipline_item.value, '$.createdAt'), 0) AS INTEGER),
  s.source_revision,
  discipline_item.value
FROM students AS s
JOIN json_each(
  CASE
    WHEN json_type(s.record_json, '$.disciplineRecords') = 'array'
      THEN json_extract(s.record_json, '$.disciplineRecords')
    ELSE '[]'
  END
) AS discipline_item
WHERE
  json_type(discipline_item.value) = 'object' AND
  NULLIF(TRIM(CAST(json_extract(discipline_item.value, '$.id') AS TEXT)), '')
    IS NOT NULL;

INSERT OR REPLACE INTO boss_rewards (
  workspace_id, class_id, student_id, reward_id, boss_id, boss_name, rank,
  damage, attack_count, fair_score, previous_damage, previous_fair_score,
  improvement_amount, fair_improvement_amount, reward_points,
  reward_rank_points, reward_happiness, rank_reward_points,
  rank_reward_rank_points, rank_reward_happiness, participation_reward_points,
  participation_reward_rank_points, participation_reward_happiness,
  improvement_reward_points, improvement_reward_rank_points,
  improvement_reward_happiness, received_improvement_reward, created_at,
  source_revision, record_json
)
SELECT
  s.workspace_id,
  s.class_id,
  s.student_id,
  CAST(json_extract(reward_item.value, '$.id') AS TEXT),
  COALESCE(CAST(json_extract(reward_item.value, '$.bossId') AS TEXT), ''),
  COALESCE(CAST(json_extract(reward_item.value, '$.bossName') AS TEXT), ''),
  CAST(COALESCE(json_extract(reward_item.value, '$.rank'), 0) AS INTEGER),
  CAST(COALESCE(json_extract(reward_item.value, '$.damage'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.attackCount'), 0) AS INTEGER),
  CAST(COALESCE(json_extract(reward_item.value, '$.fairScore'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.previousDamage'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.previousFairScore'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.improvementAmount'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.fairImprovementAmount'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.rewardPoints'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.rewardRankPoints'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.rewardHappiness'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.rankRewardPoints'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.rankRewardRankPoints'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.rankRewardHappiness'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.participationRewardPoints'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.participationRewardRankPoints'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.participationRewardHappiness'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.improvementRewardPoints'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.improvementRewardRankPoints'), 0) AS REAL),
  CAST(COALESCE(json_extract(reward_item.value, '$.improvementRewardHappiness'), 0) AS REAL),
  CASE WHEN json_extract(reward_item.value, '$.receivedImprovementReward') = 1
    THEN 1 ELSE 0 END,
  CAST(COALESCE(json_extract(reward_item.value, '$.createdAt'), 0) AS INTEGER),
  s.source_revision,
  reward_item.value
FROM students AS s
JOIN json_each(
  CASE
    WHEN json_type(s.record_json, '$.bossRewardRecords') = 'array'
      THEN json_extract(s.record_json, '$.bossRewardRecords')
    ELSE '[]'
  END
) AS reward_item
WHERE
  json_type(reward_item.value) = 'object' AND
  NULLIF(TRIM(CAST(json_extract(reward_item.value, '$.id') AS TEXT)), '')
    IS NOT NULL;
