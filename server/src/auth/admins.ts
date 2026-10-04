// Data access for admin accounts and their family (tenant).
import type { Database } from 'bun:sqlite';
import type { AdminRow, FamilyRow } from '../types';
import { newId, now } from '../ids';

/** Create a family (tenant) and return its row. */
export function createFamily(db: Database, name: string | null = null): FamilyRow {
  const row: FamilyRow = { id: newId(), name, created_at: now() };
  db.query('INSERT INTO families (id, name, created_at) VALUES (?, ?, ?);').run(
    row.id,
    row.name,
    row.created_at,
  );
  return row;
}

export function countAdmins(db: Database): number {
  return (db.query('SELECT COUNT(*) AS c FROM admins;').get() as { c: number }).c;
}

export function getAdminByEmail(db: Database, email: string): AdminRow | null {
  return db.query('SELECT * FROM admins WHERE email = ?;').get(email) as AdminRow | null;
}

export function getAdminById(db: Database, id: string): AdminRow | null {
  return db.query('SELECT * FROM admins WHERE id = ?;').get(id) as AdminRow | null;
}

export function createAdmin(
  db: Database,
  input: {
    email: string;
    passwordHash: string;
    displayName: string | null;
    familyId: string | null;
  },
): AdminRow {
  const ts = now();
  const row: AdminRow = {
    id: newId(),
    email: input.email,
    password_hash: input.passwordHash,
    display_name: input.displayName,
    family_id: input.familyId,
    created_at: ts,
    updated_at: ts,
  };
  db.query(
    `INSERT INTO admins (id, email, password_hash, display_name, family_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.email,
    row.password_hash,
    row.display_name,
    row.family_id,
    row.created_at,
    row.updated_at,
  );
  return row;
}
