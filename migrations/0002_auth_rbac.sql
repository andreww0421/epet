ALTER TABLE workspaces
  ADD COLUMN name TEXT NOT NULL DEFAULT 'Workspace';

ALTER TABLE workspaces
  ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;

UPDATE workspaces
SET created_at = updated_at
WHERE created_at = 0;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  password_algorithm TEXT NOT NULL
    CHECK (password_algorithm = 'PBKDF2-HMAC-SHA256'),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL
    CHECK (password_iterations >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'admin', 'teacher', 'viewer')),
  created_at INTEGER NOT NULL,
  created_by_user_id TEXT,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (workspace_id)
    ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user
  ON workspace_memberships (user_id, workspace_id);

CREATE TABLE IF NOT EXISTS workspace_claims (
  workspace_id TEXT PRIMARY KEY,
  claimed_by_user_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (workspace_id)
    ON DELETE CASCADE,
  FOREIGN KEY (claimed_by_user_id) REFERENCES users (user_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  active_workspace_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE CASCADE,
  FOREIGN KEY (active_workspace_id) REFERENCES workspaces (workspace_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expiry
  ON auth_sessions (user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
  ON auth_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON password_reset_tokens (user_id, expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  scope TEXT NOT NULL
    CHECK (scope IN ('login', 'register', 'forgot', 'reset')),
  subject_hash TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  blocked_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, subject_hash)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_blocked
  ON auth_rate_limits (blocked_until)
  WHERE blocked_until > 0;

CREATE TABLE IF NOT EXISTS workspace_revisions (
  workspace_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL,
  actor_user_id TEXT,
  data_size_bytes INTEGER NOT NULL CHECK (data_size_bytes >= 0),
  data_json TEXT NOT NULL,
  PRIMARY KEY (workspace_id, revision),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (workspace_id)
    ON DELETE CASCADE
);

INSERT OR IGNORE INTO workspace_revisions (
  workspace_id,
  revision,
  updated_at,
  actor_user_id,
  data_size_bytes,
  data_json
)
SELECT
  workspace_id,
  revision,
  updated_at,
  NULL,
  length(CAST(data_json AS BLOB)),
  data_json
FROM workspaces;

CREATE TRIGGER IF NOT EXISTS trg_workspaces_revision_after_insert
AFTER INSERT ON workspaces
BEGIN
  INSERT OR REPLACE INTO workspace_revisions (
    workspace_id,
    revision,
    updated_at,
    actor_user_id,
    data_size_bytes,
    data_json
  )
  VALUES (
    NEW.workspace_id,
    NEW.revision,
    NEW.updated_at,
    NULL,
    length(CAST(NEW.data_json AS BLOB)),
    NEW.data_json
  );
  DELETE FROM workspace_revisions
  WHERE
    workspace_id = NEW.workspace_id AND
    revision NOT IN (
      SELECT revision
      FROM workspace_revisions
      WHERE workspace_id = NEW.workspace_id
      ORDER BY revision DESC
      LIMIT 25
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_workspaces_revision_after_update
AFTER UPDATE OF revision, updated_at, data_json ON workspaces
WHEN
  OLD.revision <> NEW.revision OR
  OLD.updated_at <> NEW.updated_at OR
  OLD.data_json <> NEW.data_json
BEGIN
  INSERT OR REPLACE INTO workspace_revisions (
    workspace_id,
    revision,
    updated_at,
    actor_user_id,
    data_size_bytes,
    data_json
  )
  VALUES (
    NEW.workspace_id,
    NEW.revision,
    NEW.updated_at,
    NULL,
    length(CAST(NEW.data_json AS BLOB)),
    NEW.data_json
  );
  DELETE FROM workspace_revisions
  WHERE
    workspace_id = NEW.workspace_id AND
    revision NOT IN (
      SELECT revision
      FROM workspace_revisions
      WHERE workspace_id = NEW.workspace_id
      ORDER BY revision DESC
      LIMIT 25
    );
END;

CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  workspace_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_workspace_created
  ON audit_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_created
  ON audit_events (actor_user_id, created_at DESC);
