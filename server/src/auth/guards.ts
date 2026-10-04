// Reusable auth context as an Elysia plugin. `adminContext` resolves the admin
// session cookie into `admin` (AdminRow | null) + `adminToken`, scoped so any
// router that `.use`s it gets those fields. Later tickets (kids/words/practice)
// reuse this to gate admin-only routes.
import { Elysia } from 'elysia';
import type { Database } from 'bun:sqlite';
import { getValidSession } from './sessions';
import { getAdminById } from './admins';
import { getKidById, getKidFuerFamilie } from '../kids/data';
import { ADMIN_COOKIE, KID_COOKIE } from './constants';
import type { AdminRow, KidRow } from '../types';

export function adminContext(db: Database) {
  return new Elysia({ name: 'admin-context' }).derive({ as: 'scoped' }, ({ cookie }) => {
    const token = cookie[ADMIN_COOKIE]?.value;
    if (typeof token !== 'string' || token.length === 0) {
      return { admin: null as AdminRow | null, adminToken: null as string | null };
    }
    const session = getValidSession(db, token, 'admin');
    if (!session) {
      return { admin: null as AdminRow | null, adminToken: null as string | null };
    }
    return { admin: getAdminById(db, session.subject_id), adminToken: session.id as string | null };
  });
}

export function kidContext(db: Database) {
  return new Elysia({ name: 'kid-context' }).derive({ as: 'scoped' }, ({ cookie }) => {
    const token = cookie[KID_COOKIE]?.value;
    if (typeof token !== 'string' || token.length === 0) {
      return { kid: null as KidRow | null, kidToken: null as string | null };
    }
    const session = getValidSession(db, token, 'kid');
    if (!session) {
      return { kid: null as KidRow | null, kidToken: null as string | null };
    }
    return { kid: getKidById(db, session.subject_id), kidToken: session.id as string | null };
  });
}

/** True when a kid session is allowed to act on `kidId` (its own id only). */
export function kidOwns(kid: KidRow | null, kidId: string): boolean {
  return kid !== null && kid.id === kidId;
}

/**
 * Zugriff auf eine Kind-Ressource auflösen (#12, familien-begrenzt):
 *  - Admin: nur Kinder der eigenen Familie; fremde/unbekannte → 404
 *    (Existenz wird nicht bestätigt)
 *  - Kind-Session: nur das eigene Kind (fremdes → 403, keine Session → 401)
 * Liefert bei Erfolg die Kind-Zeile, sonst den HTTP-Status.
 */
export function kidZugriff(
  db: Database,
  admin: AdminRow | null,
  kidSession: KidRow | null,
  kidId: string,
): { kid: KidRow } | { status: 401 | 403 | 404 } {
  if (admin) {
    const kid = getKidFuerFamilie(db, kidId, admin.family_id);
    return kid ? { kid } : { status: 404 };
  }
  if (!kidSession) return { status: 401 };
  if (!kidOwns(kidSession, kidId)) return { status: 403 };
  return { kid: kidSession };
}

/** Fehlertext zum Status aus {@link kidZugriff}. */
export function zugriffsFehler(status: 401 | 403 | 404): { error: string } {
  if (status === 401) return { error: 'Not authenticated.' };
  if (status === 403) return { error: 'Forbidden.' };
  return { error: 'Kid not found.' };
}
