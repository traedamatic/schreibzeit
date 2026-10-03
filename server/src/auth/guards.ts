// Reusable auth context as an Elysia plugin. `adminContext` resolves the admin
// session cookie into `admin` (AdminRow | null) + `adminToken`, scoped so any
// router that `.use`s it gets those fields. Later tickets (kids/words/practice)
// reuse this to gate admin-only routes.
import { Elysia } from 'elysia';
import type { Database } from 'bun:sqlite';
import { getValidSession } from './sessions';
import { getAdminById } from './admins';
import { ADMIN_COOKIE } from './constants';
import type { AdminRow } from '../types';

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
