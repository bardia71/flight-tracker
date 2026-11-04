-- One row per flight leg from the roster (or added by hand).
CREATE TABLE IF NOT EXISTS flights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  flight_no     TEXT NOT NULL,          -- as shown on the roster, e.g. "1234"
  callsign      TEXT NOT NULL,          -- what the aircraft broadcasts, e.g. "UAL1234"
  dep           TEXT NOT NULL,          -- IATA, e.g. "ORD"
  arr           TEXT NOT NULL,          -- IATA, e.g. "LGA"
  sched_out     TEXT NOT NULL,          -- UTC ISO time
  sched_in      TEXT NOT NULL,          -- UTC ISO time
  deadhead      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | airborne | landed | no_data | cancelled
  actual_off    TEXT,
  actual_on     TEXT,
  actual_arr    TEXT,                   -- IATA where it really landed (diversions)
  hex           TEXT,                   -- ICAO 24-bit aircraft address
  reg           TEXT,                   -- tail number
  aircraft_type TEXT,
  last_seen     TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (callsign, sched_out)
);
CREATE INDEX IF NOT EXISTS flights_sched ON flights (sched_out);

-- Positions recorded while the flight is tracked.
CREATE TABLE IF NOT EXISTS positions (
  flight_id INTEGER NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  ts        TEXT NOT NULL,
  lat       REAL NOT NULL,
  lon       REAL NOT NULL,
  alt       INTEGER,        -- feet, 0 on ground
  gs        INTEGER,        -- knots
  trk       INTEGER,        -- degrees
  PRIMARY KEY (flight_id, ts)
);
