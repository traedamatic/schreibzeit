// Reusable auth context as an Elysia plugin. `adminContext` resolves the admin
// session cookie into `admin` (AdminRow | null) + `adminToken`, scoped so any
// router that `.use`s it gets those fields. Later tickets (kids/words/practice)
// reuse this to gate admin-only routes.
import { Elysia } from 'elysia';
import type { Database } from 'bun:sqlite';
import { getValidSession } from './sessions';
import { getAdminById } from './admins';
import { getKidById } from '../kids/data';
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
 * Authorize access to a kid-scoped resource: allowed for any admin, or the
 * owning kid. Returns 0 when allowed, else the HTTP status to respond with
 * (401 = no session, 403 = wrong kid).
 */
export function accessDenial(
  admin: AdminRow | null,
  kid: KidRow | null,
  kidId: string,
): 0 | 401 | 403 {
  if (admin) return 0;
  if (!kid) return 401;
  return kidOwns(kid, kidId) ? 0 : 403;
}
