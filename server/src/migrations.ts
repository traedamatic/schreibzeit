// Minimal forward-only migration runner. State is tracked via SQLite's
// `PRAGMA user_version`, so running the full set repeatedly is idempotent.
// Each migration is applied in its own transaction (DDL is transactional in
// SQLite). Foreign keys are enabled per-connection in `openDatabase` (db.ts).
import type { Database } from 'bun:sqlite';

export interface Migration {
  /** Monotonic version number; applied in ascending order. */
  id: number;
  name: string;
  up: string;
}

const INIT = `
CREATE TABLE admins (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE kids (
  id                 TEXT PRIMARY KEY,
  admin_id           TEXT REFERENCES admins(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  pin_hash           TEXT,
  lernstand          TEXT NOT NULL,
  daily_goal_seconds INTEGER NOT NULL DEFAULT 300,
  pin_failed_count   INTEGER NOT NULL DEFAULT 0,
  pin_locked_until   INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE words (
  id          TEXT PRIMARY KEY,
  kid_id      TEXT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
  wort        TEXT NOT NULL,
  artikel     TEXT,
  wortart     TEXT,
  silben      TEXT NOT NULL DEFAULT '[]',
  merkstellen TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'neu',
  fach        INTEGER NOT NULL DEFAULT 1,
  faellig_am  INTEGER,
  quelle      TEXT,
  notiz       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE practice_events (
  id           TEXT PRIMARY KEY,
  kid_id       TEXT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
  word_id      TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  session_id   TEXT NOT NULL,
  correct      INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  fach_before  INTEGER,
  fach_after   INTEGER,
  practiced_at INTEGER NOT NULL,
  UNIQUE (session_id, word_id)
);

CREATE TABLE auth_sessions (
  id           TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE INDEX idx_kids_admin ON kids(admin_id);
CREATE INDEX idx_words_kid ON words(kid_id);
CREATE INDEX idx_events_kid ON practice_events(kid_id);
CREATE INDEX idx_events_practiced_at ON practice_events(practiced_at);
CREATE INDEX idx_sessions_subject ON auth_sessions(subject_type, subject_id);
`;

// Adds the optional free-text note on kids (used by Kids CRUD, #5).
const KID_NOTIZ = `ALTER TABLE kids ADD COLUMN notiz TEXT;`;

export const migrations: readonly Migration[] = [
  { id: 1, name: 'init', up: INIT },
  { id: 2, name: 'kid_notiz', up: KID_NOTIZ },
];

function userVersion(db: Database): number {
  const row = db.query('PRAGMA user_version;').get() as { user_version: number };
  return row.user_version;
}

/**
 * Apply all pending migrations in order. Idempotent: already-applied migrations
 * (id ≤ current `user_version`) are skipped. Returns the resulting version.
 */
export function runMigrations(db: Database): number {
  const current = userVersion(db);
  for (const migration of migrations) {
    if (migration.id <= current) continue;
    const apply = db.transaction(() => {
      db.run(migration.up);
      // PRAGMA cannot be parameterized; id is a trusted integer literal.
      db.run(`PRAGMA user_version = ${migration.id};`);
    });
    apply();
  }
  return userVersion(db);
}
