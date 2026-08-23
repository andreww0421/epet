ALTER TABLE users
  ADD COLUMN email_verified_at INTEGER;

-- Existing accounts predate verification and must not be locked out during
-- cutover. Only accounts created after this migration start unverified.
UPDATE users
SET email_verified_at = created_at
WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user
  ON email_verification_tokens (user_id, expires_at);

-- SQLite cannot alter a CHECK constraint in place. Rebuild the small rate
-- limit table to add the verification resend scope without losing counters.
CREATE TABLE auth_rate_limits_v2 (
  scope TEXT NOT NULL
    CHECK (scope IN ('login', 'register', 'forgot', 'reset', 'verify')),
  subject_hash TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  blocked_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, subject_hash)
);

INSERT INTO auth_rate_limits_v2 (
  scope, subject_hash, window_started_at, attempt_count, blocked_until
)
SELECT scope, subject_hash, window_started_at, attempt_count, blocked_until
FROM auth_rate_limits;

DROP TABLE auth_rate_limits;
ALTER TABLE auth_rate_limits_v2 RENAME TO auth_rate_limits;

CREATE INDEX idx_auth_rate_limits_blocked
  ON auth_rate_limits (blocked_until)
  WHERE blocked_until > 0;
