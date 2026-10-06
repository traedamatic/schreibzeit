// Kid data access. Auth-related helpers (#4) live here; #5 extends this module
// with create/list/update/delete.
import type { Database } from 'bun:sqlite';
import type { KidRow, Lernstand, UebungsModus } from '../types';
import { newId, now } from '../ids';

export const DEFAULT_DAILY_GOAL_SECONDS = 300;

export interface CreateKidInput {
  /** Optional client-supplied id (offline-first sync replays stay idempotent). */
  id?: string;
  name: string;
  lernstand: Lernstand;
  notiz?: string | null;
  dailyGoalSeconds?: number;
  adminId?: string | null;
  familyId?: string | null;
}

export interface UpdateKidInput {
  name?: string;
  lernstand?: Lernstand;
  notiz?: string | null;
  dailyGoalSeconds?: number;
  dailyCapSeconds?: number;
  uebungsModus?: UebungsModus;
}

export function getKidById(db: Database, id: string): KidRow | null {
  return db.query('SELECT * FROM kids WHERE id = ?;').get(id) as KidRow | null;
}

/**
 * Kind für einen Admin auflösen: nur, wenn es zur Familie des Admins gehört.
 * Fremde Familie → null (Routen antworten mit 404 und bestätigen nichts).
 */
export function getKidFuerFamilie(
  db: Database,
  id: string,
  familyId: string | null,
): KidRow | null {
  const kid = getKidById(db, id);
  if (!kid || kid.family_id !== familyId) return null;
  return kid;
}

export function listKids(db: Database, familyId: string | null): KidRow[] {
  return db
    .query('SELECT * FROM kids WHERE family_id IS ? ORDER BY name COLLATE NOCASE;')
    .all(familyId) as KidRow[];
}

export function createKid(db: Database, input: CreateKidInput): KidRow {
  const ts = now();
  const id = input.id ?? newId();
  db.query(
    `INSERT INTO kids (id, admin_id, family_id, name, lernstand, daily_goal_seconds, notiz, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.adminId ?? null,
    input.familyId ?? null,
    input.name.trim(),
    input.lernstand,
    input.dailyGoalSeconds ?? DEFAULT_DAILY_GOAL_SECONDS,
    input.notiz ?? null,
    ts,
    ts,
  );
  const created = getKidById(db, id);
  if (!created) throw new Error('Kid insert failed');
  return created;
}

export function updateKid(db: Database, id: string, patch: UpdateKidInput): KidRow | null {
  const kid = getKidById(db, id);
  if (!kid) return null;
  const name = (patch.name ?? kid.name).trim();
  const lernstand = patch.lernstand ?? kid.lernstand;
  const notiz = patch.notiz !== undefined ? patch.notiz : kid.notiz;
  const goal = patch.dailyGoalSeconds ?? kid.daily_goal_seconds;
  const cap = patch.dailyCapSeconds ?? kid.daily_cap_seconds;
  const modus = patch.uebungsModus ?? kid.uebungs_modus;
  db.query(
    'UPDATE kids SET name = ?, lernstand = ?, notiz = ?, daily_goal_seconds = ?, daily_cap_seconds = ?, uebungs_modus = ?, updated_at = ? WHERE id = ?;',
  ).run(name, lernstand, notiz, goal, cap, modus, now(), id);
  return getKidById(db, id);
}

export function deleteKid(db: Database, id: string): boolean {
  return db.query('DELETE FROM kids WHERE id = ?;').run(id).changes > 0;
}

/**
 * Alle Kinder mit diesem Namen (case-insensitiv) — über Familien hinweg kann
 * es Namensgleichheit geben; die PIN-Prüfung disambiguiert beim Login.
 */
export function getKidsByName(db: Database, name: string): KidRow[] {
  return db
    .query('SELECT * FROM kids WHERE lower(name) = lower(?);')
    .all(name.trim()) as KidRow[];
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
