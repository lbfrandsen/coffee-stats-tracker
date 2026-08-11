-- Migration number: 0004 	 2026-08-11T18:44:05.002Z
CREATE TABLE weather_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  drink_id INTEGER NOT NULL UNIQUE,

  temperature_c REAL,
  precipitation_mm REAL,
  raining INTEGER CHECK (raining IN (0, 1)),
  cloud_cover INTEGER,
  humidity_percent REAL,

  wind_speed_ms REAL,
  wind_direction_degrees REAL,

  pressure_hpa REAL,
  visibility_m REAL,
  weather_code REAL,

  station_id TEXT NOT NULL,
  observed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (drink_id)
    REFERENCES drinks(id)
    ON DELETE CASCADE
);