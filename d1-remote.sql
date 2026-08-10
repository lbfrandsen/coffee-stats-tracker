PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_initial_schema.sql','2026-07-11 22:53:59');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0002_add_device_heartbeat.sql','2026-07-12 13:28:47');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0003_seed_cups.sql','2026-08-10 17:17:53');
CREATE TABLE persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
INSERT INTO "persons" ("id","name","display_name","created_at","active") VALUES(1,'Lucas','Paven','2026-07-11 22:57:07',1);
INSERT INTO "persons" ("id","name","display_name","created_at","active") VALUES(2,'Frederik','Burger Lars','2026-07-11 22:57:07',1);
CREATE TABLE cups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  nfc_uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),

  FOREIGN KEY (owner_id) REFERENCES persons(id)
);
INSERT INTO "cups" ("id","owner_id","nfc_uid","name","created_at","active") VALUES(1,1,'04:8E:76:4C:C7:2A:81','FCK Kop','2026-08-10 17:17:53',1);
INSERT INTO "cups" ("id","owner_id","nfc_uid","name","created_at","active") VALUES(2,1,'04:A8:69:4C:C7:2A:81','München Kop','2026-08-10 17:17:53',1);
INSERT INTO "cups" ("id","owner_id","nfc_uid","name","created_at","active") VALUES(3,1,'04:59:65:4C:C7:2A:81','DTU Kemi Kop','2026-08-10 17:17:53',1);
INSERT INTO "cups" ("id","owner_id","nfc_uid","name","created_at","active") VALUES(4,1,'04:BA:58:4C:C7:2A:81','Royal Copenhagen Kop','2026-08-10 17:17:53',1);
INSERT INTO "cups" ("id","owner_id","nfc_uid","name","created_at","active") VALUES(5,2,'04:DF:79:4C:C7:2A:81','Arbejdsløshedskoppen','2026-08-10 17:17:53',1);
INSERT INTO "cups" ("id","owner_id","nfc_uid","name","created_at","active") VALUES(6,2,'04:6D:5D:4C:C7:2A:81','Blå IKEA Kop','2026-08-10 17:17:53',1);
INSERT INTO "cups" ("id","owner_id","nfc_uid","name","created_at","active") VALUES(7,2,'04:BC:6F:4C:C7:2A:81','Eva Trio Kop','2026-08-10 17:17:53',1);
CREATE TABLE drinks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  cup_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  consumed_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (cup_id) REFERENCES cups(id),
  FOREIGN KEY (person_id) REFERENCES persons(id)
);
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
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',3);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('persons',2);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('cups',7);
CREATE INDEX idx_drinks_person_consumed_at
  ON drinks(person_id, consumed_at);
CREATE INDEX idx_drinks_cup_consumed_at
  ON drinks(cup_id, consumed_at);
CREATE INDEX idx_drinks_consumed_at
  ON drinks(consumed_at);
CREATE INDEX idx_heartbeats_reported_at
  ON heartbeats(reported_at DESC);
