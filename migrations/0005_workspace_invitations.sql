CREATE TABLE IF NOT EXISTS workspace_invitations (
  invitation_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'viewer')),
  class_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(class_ids_json)),
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  accepted_by_user_id TEXT,
  revoked_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (workspace_id)
    ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users (user_id)
    ON DELETE CASCADE,
  FOREIGN KEY (accepted_by_user_id) REFERENCES users (user_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace_created
  ON workspace_invitations (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_active_email
  ON workspace_invitations (workspace_id, email_normalized, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
