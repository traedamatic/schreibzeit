// SQLite connection bootstrap. This ticket (#1) only opens the connection —
// tables and migrations arrive in #2. `bun:sqlite` is server-only and must
// never run on-device (see CLAUDE.md → Runtime split).
import { Database } from 'bun:sqlite';

/**
 * Open (or create) the SQLite database at `path`.
 *
 * - `strict: true` requires prefixed bind params and surfaces typos as errors.
 * - WAL journaling suits a single-node self-hosted server (better concurrency).
 * - Foreign keys are enforced from the start so #2's schema relies on them.
 *
 * Pass `":memory:"` for an ephemeral database (used by tests).
 */
export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');
  return db;
}
