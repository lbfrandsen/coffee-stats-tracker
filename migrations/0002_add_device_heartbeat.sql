CREATE TABLE heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  reported_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  service_status TEXT NOT NULL DEFAULT 'unknown',

  reader_connected INTEGER NOT NULL DEFAULT 0
    CHECK (reader_connected IN (0, 1)),

  uptime_seconds INTEGER,

  memory_usage_percent REAL
    CHECK (
      memory_usage_percent IS NULL
      OR memory_usage_percent BETWEEN 0 AND 100
    ),

  disk_usage_percent REAL
    CHECK (
      disk_usage_percent IS NULL
      OR disk_usage_percent BETWEEN 0 AND 100
    ),

  cpu_temperature_celsius REAL,

  last_scan_at TEXT,
  last_upload_at TEXT,

  pending_events INTEGER NOT NULL DEFAULT 0
    CHECK (pending_events >= 0),

  app_version TEXT
);

CREATE INDEX idx_heartbeats_reported_at
  ON heartbeats(reported_at DESC);