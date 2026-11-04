-- Opt-in, account-scoped onboarding only. No classroom, student or event payload.
-- Existing accounts are not backfilled. Old Workers ignore this additive table.
CREATE TABLE IF NOT EXISTS auth_product_onboarding (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  cohort_day TEXT NOT NULL CHECK (length(cohort_day) = 10),
  started INTEGER NOT NULL DEFAULT 0 CHECK (started IN (0, 1)),
  local_reported INTEGER NOT NULL DEFAULT 0 CHECK (local_reported IN (0, 1)),
  backend_persisted INTEGER NOT NULL DEFAULT 0 CHECK (backend_persisted IN (0, 1)),
  CHECK (local_reported <= started AND backend_persisted <= started)
);
CREATE INDEX IF NOT EXISTS idx_auth_product_onboarding_cohort
  ON auth_product_onboarding (cohort_day);
