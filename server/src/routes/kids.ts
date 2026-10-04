// Admin-only Kids CRUD, auf die Familie des Admins begrenzt (#12): alle Admins
// derselben Familie verwalten dieselben Kinder; fremde Familien erhalten 404.
import { Elysia, t } from 'elysia';
import type { Database } from 'bun:sqlite';
import { adminContext } from '../auth/guards';
import {
  createKid,
  deleteKid,
  getKidFuerFamilie,
  listKids,
  updateKid,
} from '../kids/data';
import { toPublicKid } from '../kids/public';
import {
  LERNSTAND_VALUES,
  UEBUNGS_MODUS_VALUES,
  type Lernstand,
  type UebungsModus,
} from '../types';

function isLernstand(value: string): value is Lernstand {
  return (LERNSTAND_VALUES as readonly string[]).includes(value);
}

function isUebungsModus(value: string): value is UebungsModus {
  return (UEBUNGS_MODUS_VALUES as readonly string[]).includes(value);
}

/** Returns an error string if dailyGoalSeconds is present but invalid. */
function badGoal(goal: number | undefined): string | null {
  if (goal === undefined) return null;
  if (!Number.isInteger(goal) || goal <= 0) return 'dailyGoalSeconds must be a positive integer.';
  return null;
}

export function kidsRoutes(db: Database) {
  return new Elysia({ prefix: '/kids' })
    .use(adminContext(db))
    .post(
      '/',
      ({ body, admin, set }) => {
        if (!admin) {
          set.status = 401;
          return { error: 'Not authenticated.' };
        }
        if (!isLernstand(body.lernstand)) {
          set.status = 400;
          return { error: 'Invalid lernstand.' };
        }
        const goalError = badGoal(body.dailyGoalSeconds);
        if (goalError) {
          set.status = 400;
          return { error: goalError };
        }
        // Idempotent offline-sync replay: a resent create with a known id is a
        // no-op — aber nur innerhalb der eigenen Familie.
        if (body.id) {
          const existing = getKidFuerFamilie(db, body.id, admin.family_id);
          if (existing) return toPublicKid(existing);
        }
        const kid = createKid(db, {
          id: body.id,
          name: body.name,
          lernstand: body.lernstand,
          notiz: body.notiz ?? null,
          dailyGoalSeconds: body.dailyGoalSeconds,
          adminId: admin.id,
          familyId: admin.family_id,
        });
        set.status = 201;
        return toPublicKid(kid);
      },
      {
        body: t.Object({
          id: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
          name: t.String({ minLength: 1, maxLength: 120 }),
          lernstand: t.String(),
          notiz: t.Optional(t.String({ maxLength: 2000 })),
          dailyGoalSeconds: t.Optional(t.Integer()),
        }),
      },
    )
    .get('/', ({ admin, set }) => {
      if (!admin) {
        set.status = 401;
        return { error: 'Not authenticated.' };
      }
      return listKids(db, admin.family_id).map(toPublicKid);
    })
    .get('/:id', ({ params, admin, set }) => {
      if (!admin) {
        set.status = 401;
        return { error: 'Not authenticated.' };
      }
      const kid = getKidFuerFamilie(db, params.id, admin.family_id);
      if (!kid) {
        set.status = 404;
        return { error: 'Kid not found.' };
      }
      return toPublicKid(kid);
    })
    .put(
      '/:id',
      ({ params, body, admin, set }) => {
        if (!admin) {
          set.status = 401;
          return { error: 'Not authenticated.' };
        }
        if (body.lernstand !== undefined && !isLernstand(body.lernstand)) {
          set.status = 400;
          return { error: 'Invalid lernstand.' };
        }
        if (body.uebungsModus !== undefined && !isUebungsModus(body.uebungsModus)) {
          set.status = 400;
          return { error: 'Invalid uebungsModus.' };
        }
        const goalError = badGoal(body.dailyGoalSeconds);
        if (goalError) {
          set.status = 400;
          return { error: goalError };
        }
        if (!getKidFuerFamilie(db, params.id, admin.family_id)) {
          set.status = 404;
          return { error: 'Kid not found.' };
        }
        const kid = updateKid(db, params.id, {
          name: body.name,
          lernstand: body.lernstand as Lernstand | undefined,
          notiz: body.notiz,
          dailyGoalSeconds: body.dailyGoalSeconds,
          uebungsModus: body.uebungsModus as UebungsModus | undefined,
        });
        if (!kid) {
          set.status = 404;
          return { error: 'Kid not found.' };
        }
        return toPublicKid(kid);
      },
      {
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
          lernstand: t.Optional(t.String()),
          notiz: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
          dailyGoalSeconds: t.Optional(t.Integer()),
          uebungsModus: t.Optional(t.String({ maxLength: 20 })),
        }),
      },
    )
    .delete('/:id', ({ params, admin, set }) => {
      if (!admin) {
        set.status = 401;
        return { error: 'Not authenticated.' };
      }
      if (!getKidFuerFamilie(db, params.id, admin.family_id)) {
        set.status = 404;
        return { error: 'Kid not found.' };
      }
      deleteKid(db, params.id);
      return { ok: true };
    });
}
