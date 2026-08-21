-- Class access is explicit for teacher/viewer memberships. Owners and admins
-- retain workspace-wide access and therefore do not need assignment rows.
--
-- Do not add a foreign key to classes here: every workspace write rebuilds the
-- class projection with DELETE + INSERT in one transaction. Insert/update
-- triggers still reject class ids that do not belong to the same workspace,
-- and the repository removes assignments for classes absent after a rebuild.
CREATE TABLE IF NOT EXISTS workspace_class_assignments (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  class_id TEXT NOT NULL CHECK (length(trim(class_id)) > 0),
  created_at INTEGER NOT NULL,
  created_by_user_id TEXT,
  PRIMARY KEY (workspace_id, user_id, class_id),
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships (workspace_id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_class_assignments_class
  ON workspace_class_assignments (workspace_id, class_id);

CREATE TRIGGER IF NOT EXISTS trg_workspace_class_assignments_insert
BEFORE INSERT ON workspace_class_assignments
WHEN
  NOT EXISTS (
    SELECT 1
    FROM classes
    WHERE
      classes.workspace_id = NEW.workspace_id AND
      classes.class_id = NEW.class_id
  ) OR
  NOT EXISTS (
    SELECT 1
    FROM workspace_memberships
    WHERE
      workspace_memberships.workspace_id = NEW.workspace_id AND
      workspace_memberships.user_id = NEW.user_id AND
      workspace_memberships.role IN ('teacher', 'viewer')
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid workspace class assignment');
END;

CREATE TRIGGER IF NOT EXISTS trg_workspace_class_assignments_update
BEFORE UPDATE OF workspace_id, user_id, class_id
ON workspace_class_assignments
WHEN
  NOT EXISTS (
    SELECT 1
    FROM classes
    WHERE
      classes.workspace_id = NEW.workspace_id AND
      classes.class_id = NEW.class_id
  ) OR
  NOT EXISTS (
    SELECT 1
    FROM workspace_memberships
    WHERE
      workspace_memberships.workspace_id = NEW.workspace_id AND
      workspace_memberships.user_id = NEW.user_id AND
      workspace_memberships.role IN ('teacher', 'viewer')
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid workspace class assignment');
END;

-- Existing teacher/viewer users previously had full-workspace access. Grant
-- their current classes once during migration; memberships created later have
-- no rows and therefore fail closed until an administrator assigns classes.
INSERT OR IGNORE INTO workspace_class_assignments (
  workspace_id,
  user_id,
  class_id,
  created_at,
  created_by_user_id
)
SELECT
  memberships.workspace_id,
  memberships.user_id,
  classes.class_id,
  memberships.created_at,
  memberships.created_by_user_id
FROM workspace_memberships AS memberships
INNER JOIN classes
  ON classes.workspace_id = memberships.workspace_id
WHERE memberships.role IN ('teacher', 'viewer');
