
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS results (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), shoe_id TEXT NOT NULL,
 round INTEGER NOT NULL CHECK(round>0), outcome TEXT NOT NULL CHECK(outcome IN ('B','P','T')),
 confidence REAL NOT NULL, source TEXT NOT NULL, historical INTEGER NOT NULL,
 occurred_at TEXT, recorded_at TEXT NOT NULL, UNIQUE(room_id,shoe_id,round)
);
CREATE TABLE IF NOT EXISTS forecasts (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), shoe_id TEXT NOT NULL,
 target_round INTEGER NOT NULL, cutoff_round INTEGER NOT NULL, horizon INTEGER NOT NULL CHECK(horizon IN (1,2)),
 method TEXT NOT NULL CHECK(method IN ('A','B','C','D')), probabilities TEXT NOT NULL, pick TEXT NOT NULL,
 sample_size INTEGER NOT NULL, basis TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK(target_round>cutoff_round), UNIQUE(room_id,shoe_id,target_round,cutoff_round,method)
);
CREATE TABLE IF NOT EXISTS settlements (
 forecast_id TEXT PRIMARY KEY REFERENCES forecasts(id), result_id TEXT NOT NULL REFERENCES results(id),
 actual TEXT NOT NULL, mark TEXT NOT NULL CHECK(mark IN ('O','X')), scored_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending (
 id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, reason TEXT NOT NULL,
 observed_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS result_lookup ON results(room_id,shoe_id,round);
CREATE INDEX IF NOT EXISTS forecast_lookup ON forecasts(room_id,shoe_id,target_round);
CREATE TRIGGER IF NOT EXISTS immutable_forecast_update BEFORE UPDATE ON forecasts BEGIN SELECT RAISE(ABORT,'immutable forecast'); END;
CREATE TRIGGER IF NOT EXISTS immutable_forecast_delete BEFORE DELETE ON forecasts BEGIN SELECT RAISE(ABORT,'immutable forecast'); END;
CREATE TRIGGER IF NOT EXISTS immutable_result_update BEFORE UPDATE ON results BEGIN SELECT RAISE(ABORT,'immutable result'); END;
CREATE TRIGGER IF NOT EXISTS immutable_result_delete BEFORE DELETE ON results BEGIN SELECT RAISE(ABORT,'immutable result'); END;
CREATE TRIGGER IF NOT EXISTS immutable_score_update BEFORE UPDATE ON settlements BEGIN SELECT RAISE(ABORT,'immutable score'); END;
CREATE TRIGGER IF NOT EXISTS immutable_score_delete BEFORE DELETE ON settlements BEGIN SELECT RAISE(ABORT,'immutable score'); END;
PRAGMA user_version=1;
