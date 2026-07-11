-- Migration number: 0001 	 2026-07-11T22:53:15.257Z
CREATE TABLE persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE cups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  nfc_uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),

  FOREIGN KEY (owner_id) REFERENCES persons(id)
);

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

CREATE INDEX idx_drinks_person_consumed_at
  ON drinks(person_id, consumed_at);

CREATE INDEX idx_drinks_cup_consumed_at
  ON drinks(cup_id, consumed_at);

CREATE INDEX idx_drinks_consumed_at
  ON drinks(consumed_at);