// Kid data access. Auth-related helpers (#4) live here; #5 extends this module
// with create/list/update/delete.
import type { Database } from 'bun:sqlite';
import type { KidRow } from '../types';
import { now } from '../ids';

export function getKidById(db: Database, id: string): KidRow | null {
  return db.query('SELECT * FROM kids WHERE id = ?;').get(id) as KidRow | null;
}

/** Look up a kid by name, case-insensitively (single-family server). */
export function getKidByName(db: Database, name: string): KidRow | null {
  return db.query('SELECT * FROM kids WHERE lower(name) = lower(?);').get(name.trim()) as
    | KidRow
    | null;
}

export function setKidPinHash(db: Database, id: string, pinHash: string): void {
  db.query(
    'UPDATE kids SET pin_hash = ?, pin_failed_count = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ?;',
  ).run(pinHash, now(), id);
}

export function isKidLocked(kid: KidRow): boolean {
  return kid.pin_locked_until !== null && kid.pin_locked_until > now();
}

/** Increment the failed-PIN counter; lock the kid once `maxFailures` is hit. */
export function recordPinFailure(
  db: Database,
  kid: KidRow,
  maxFailures: number,
  lockMs: number,
): void {
  const count = kid.pin_failed_count + 1;
  const lockedUntil = count >= maxFailures ? now() + lockMs : kid.pin_locked_until;
  db.query(
    'UPDATE kids SET pin_failed_count = ?, pin_locked_until = ?, updated_at = ? WHERE id = ?;',
  ).run(count, lockedUntil, now(), kid.id);
}

export function clearPinFailures(db: Database, id: string): void {
  db.query(
    'UPDATE kids SET pin_failed_count = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ?;',
  ).run(now(), id);
}
