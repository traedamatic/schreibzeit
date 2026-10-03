// Server-side session store backed by the `auth_sessions` table. Sessions are
// opaque random ids referenced by an httpOnly cookie. Fail closed: an unknown,
// expired, or wrong-subject token resolves to null.
import type { Database } from 'bun:sqlite';
import type { AuthSessionRow, SubjectType } from '../types';
import { newId, now } from '../ids';

/** Create a session and return its token. */
export function createSession(
  db: Database,
  subjectType: SubjectType,
  subjectId: string,
  ttlSeconds: number,
): string {
  const id = newId();
  const ts = now();
  db.query(
    `INSERT INTO auth_sessions (id, subject_type, subject_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, subjectType, subjectId, ts, ts + ttlSeconds * 1000, ts);
  return id;
}

/**
 * Resolve a token to its session row if valid for `expected` subject type.
 * Deletes and rejects expired sessions; refreshes `last_seen_at` on success.
 */
export function getValidSession(
  db: Database,
  token: string,
  expected: SubjectType,
): AuthSessionRow | null {
  const row = db.query('SELECT * FROM auth_sessions WHERE id = ?;').get(token) as
    | AuthSessionRow
    | null;
  if (!row || row.subject_type !== expected) return null;
  if (row.expires_at <= now()) {
    deleteSession(db, token);
    return null;
  }
  db.query('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?;').run(now(), token);
  return row;
}

export function deleteSession(db: Database, token: string): void {
  db.query('DELETE FROM auth_sessions WHERE id = ?;').run(token);
}
