// Admin-only Kids CRUD. Family-only: all admins co-manage all kids, so routes
// gate on "is an admin", not per-admin ownership (see CLAUDE.md / #5).
import { Elysia, t } from 'elysia';
import type { Database } from 'bun:sqlite';
import { adminContext } from '../auth/guards';
import {
  createKid,
  deleteKid,
  getKidById,
  listKids,
  updateKid,
} from '../kids/data';
import { toPublicKid } from '../kids/public';
import { LERNSTAND_VALUES, type Lernstand } from '../types';

function isLernstand(value: string): value is Lernstand {
  return (LERNSTAND_VALUES as readonly string[]).includes(value);
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
        const kid = createKid(db, {
          name: body.name,
          lernstand: body.lernstand,
          notiz: body.notiz ?? null,
          dailyGoalSeconds: body.dailyGoalSeconds,
          adminId: admin.id,
        });
        set.status = 201;
        return toPublicKid(kid);
      },
      {
        body: t.Object({
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
      return listKids(db).map(toPublicKid);
    })
    .get('/:id', ({ params, admin, set }) => {
      if (!admin) {
        set.status = 401;
        return { error: 'Not authenticated.' };
      }
      const kid = getKidById(db, params.id);
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
        const goalError = badGoal(body.dailyGoalSeconds);
        if (goalError) {
          set.status = 400;
          return { error: goalError };
        }
        const kid = updateKid(db, params.id, {
          name: body.name,
          lernstand: body.lernstand as Lernstand | undefined,
          notiz: body.notiz,
          dailyGoalSeconds: body.dailyGoalSeconds,
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
        }),
      },
    )
    .delete('/:id', ({ params, admin, set }) => {
      if (!admin) {
        set.status = 401;
        return { error: 'Not authenticated.' };
      }
      const ok = deleteKid(db, params.id);
      if (!ok) {
        set.status = 404;
        return { error: 'Kid not found.' };
      }
      return { ok: true };
    });
}
