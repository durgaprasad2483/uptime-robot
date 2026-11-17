CREATE TABLE monitors (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  url             TEXT    NOT NULL,
  method          TEXT    NOT NULL DEFAULT 'GET',
  interval_min    INTEGER NOT NULL DEFAULT 10,
  timeout_sec     INTEGER NOT NULL DEFAULT 90,
  expected_status TEXT    NOT NULL DEFAULT '200-399',
  keyword         TEXT,
  active_from     TEXT,              -- 'HH:MM' in TIMEZONE, NULL = 24/7
  active_to       TEXT,
  fail_threshold  INTEGER NOT NULL DEFAULT 2,
  enabled         INTEGER NOT NULL DEFAULT 1,
  status          TEXT    NOT NULL DEFAULT 'pending',
  since           INTEGER,           -- when status last changed
  fails           INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  last_ms         INTEGER,
  last_code       INTEGER,
  last_error      TEXT,
  next_check_at   INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
-- No index on next_check_at on purpose: a scan of a few dozen rows is cheap,
-- while every index adds a billed row write to each check.

-- Hourly rollup: one upsert per check, raw checks are never stored.
CREATE TABLE stats (
  monitor_id INTEGER NOT NULL,
  hour       INTEGER NOT NULL,       -- floor(unix_ms / 3_600_000)
  n          INTEGER NOT NULL,       -- checks
  up         INTEGER NOT NULL,       -- successful checks
  sum_ms     INTEGER NOT NULL,       -- sum of successful response times
  max_ms     INTEGER NOT NULL,
  PRIMARY KEY (monitor_id, hour)
) WITHOUT ROWID;

CREATE TABLE incidents (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER NOT NULL,
  started_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  cause       TEXT
);
CREATE INDEX incidents_monitor ON incidents (monitor_id, started_at);

-- Single row: tick lock (prevents overlapping cron runs) + heartbeat for /api/health
CREATE TABLE tick (id INTEGER PRIMARY KEY CHECK (id = 1), lock_until INTEGER NOT NULL, last_tick INTEGER NOT NULL);
INSERT INTO tick VALUES (1, 0, 0);
