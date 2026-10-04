// Dashboard-Statistiken (nur für Admins/Eltern). Kid-Sessions erhalten 403.
import { Elysia } from 'elysia';
import type { Database } from 'bun:sqlite';
import type { Config } from '../config';
import { adminContext, kidContext } from '../auth/guards';
import { getKidFuerFamilie } from '../kids/data';
import { aktivitaet, schwacheWoerter, streak, uebersicht } from '../stats/data';
import { now } from '../ids';
import type { AdminRow, KidRow } from '../types';

/** 0 = erlaubt; sonst HTTP-Status (403 für Kid-Sessions, 401 ohne Session). */
function adminDenial(admin: AdminRow | null, kid: KidRow | null): 0 | 401 | 403 {
  if (admin) return 0;
  return kid ? 403 : 401;
}

export function statsRoutes(db: Database, config: Config) {
  return new Elysia()
    .use(adminContext(db))
    .use(kidContext(db))
    .get('/stats/overview', ({ admin, kid, set }) => {
      const denial = adminDenial(admin, kid);
      if (denial) {
        set.status = denial;
        return { error: denial === 403 ? 'Forbidden.' : 'Not authenticated.' };
      }
      return uebersicht(db, config.TZ, now(), admin?.family_id ?? null);
    })
    .get('/kids/:id/stats/activity', ({ params, query, admin, kid, set }) => {
      const denial = adminDenial(admin, kid);
      if (denial) {
        set.status = denial;
        return { error: denial === 403 ? 'Forbidden.' : 'Not authenticated.' };
      }
      const theKid = getKidFuerFamilie(db, params.id, admin?.family_id ?? null);
      if (!theKid) {
        set.status = 404;
        return { error: 'Kid not found.' };
      }
      const tage = Math.min(90, Math.max(1, Number(query.days ?? 14) || 14));
      return aktivitaet(db, theKid, config.TZ, now(), tage);
    })
    .get('/kids/:id/stats/streak', ({ params, admin, kid, set }) => {
      const denial = adminDenial(admin, kid);
      if (denial) {
        set.status = denial;
        return { error: denial === 403 ? 'Forbidden.' : 'Not authenticated.' };
      }
      const theKid = getKidFuerFamilie(db, params.id, admin?.family_id ?? null);
      if (!theKid) {
        set.status = 404;
        return { error: 'Kid not found.' };
      }
      return streak(db, theKid, config.TZ, now());
    })
    .get('/kids/:id/stats/weak-words', ({ params, admin, kid, set }) => {
      const denial = adminDenial(admin, kid);
      if (denial) {
        set.status = denial;
        return { error: denial === 403 ? 'Forbidden.' : 'Not authenticated.' };
      }
      if (!getKidFuerFamilie(db, params.id, admin?.family_id ?? null)) {
        set.status = 404;
        return { error: 'Kid not found.' };
      }
      return schwacheWoerter(db, params.id);
    });
}
