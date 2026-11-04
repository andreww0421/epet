-- Dedicated ANALYTICS_DB only. Never apply this to the classroom/business DB.
CREATE TABLE product_analytics_attempts (
  environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  attempt TEXT NOT NULL CHECK (length(attempt) = 36),
  flow TEXT NOT NULL CHECK (flow IN ('class_create', 'roster_import', 'point_increase', 'point_decrease', 'exam_create', 'report_weekly', 'report_exam')),
  class_context TEXT NOT NULL DEFAULT '' CHECK (class_context IN ('', 'first', 'subsequent')),
  first_day TEXT NOT NULL CHECK (length(first_day) = 10),
  expires_at INTEGER NOT NULL,
  started INTEGER NOT NULL DEFAULT 0 CHECK (started IN (0, 1)),
  local_completed INTEGER NOT NULL DEFAULT 0 CHECK (local_completed IN (0, 1)),
  backend_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (backend_acknowledged IN (0, 1)),
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  rejected INTEGER NOT NULL DEFAULT 0 CHECK (rejected IN (0, 1)),
  unconfirmed INTEGER NOT NULL DEFAULT 0 CHECK (unconfirmed IN (0, 1)),
  PRIMARY KEY (environment, attempt),
  CHECK (flow = 'class_create' OR class_context = '')
);
CREATE INDEX product_analytics_attempts_expiry ON product_analytics_attempts (environment, expires_at);
CREATE TABLE product_analytics_workflow_daily (
  environment TEXT NOT NULL,
  day TEXT NOT NULL,
  flow TEXT NOT NULL,
  class_context TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  local_completed INTEGER NOT NULL DEFAULT 0,
  backend_acknowledged INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  unconfirmed INTEGER NOT NULL DEFAULT 0,
  abandoned INTEGER NOT NULL DEFAULT 0,
  orphans INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (environment, day, flow, class_context)
);
CREATE TABLE product_analytics_usage_daily (
  environment TEXT NOT NULL,
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  feature TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL,
  PRIMARY KEY (environment, day, name, feature)
);
