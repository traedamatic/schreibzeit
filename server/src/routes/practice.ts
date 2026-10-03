// Practice API: submit a run (records events + advances SRS), read due words,
// and read today's time-vs-goal summary. Accessible to the owning kid or an admin.
import { Elysia, t } from 'elysia';
import type { Database } from 'bun:sqlite';
import type { Config } from '../config';
import { accessDenial, adminContext, kidContext } from '../auth/guards';
import { getKidById } from '../kids/data';
import { toPublicWord } from '../words/public';
import {
  PracticeError,
  getDueWords,
  getTodaySummary,
  recordSession,
} from '../practice/data';
import { startOfDayMs } from '../time';
import { now } from '../ids';

export function practiceRoutes(db: Database, config: Config) {
  return new Elysia()
    .use(adminContext(db))
    .use(kidContext(db))
    .post(
      '/kids/:id/practice',
      ({ params, body, admin, kid, set }) => {
        const denial = accessDenial(admin, kid, params.id);
        if (denial) {
          set.status = denial;
          return { error: denial === 401 ? 'Not authenticated.' : 'Forbidden.' };
        }
        if (!getKidById(db, params.id)) {
          set.status = 404;
          return { error: 'Kid not found.' };
        }
        try {
          const result = recordSession(
            db,
            params.id,
            body.sessionId,
            body.events.map((e) => ({
              wordId: e.wordId,
              correct: e.correct,
              durationMs: e.durationMs,
              practicedAt: e.practicedAt,
            })),
          );
          return {
            applied: result.applied,
            skipped: result.skipped,
            updated: result.updated.map(toPublicWord),
          };
        } catch (error) {
          if (error instanceof PracticeError) {
            set.status = error.status;
            return { error: error.message };
          }
          throw error;
        }
      },
      {
        body: t.Object({
          sessionId: t.String({ minLength: 1, maxLength: 100 }),
          events: t.Array(
            t.Object({
              wordId: t.String({ minLength: 1 }),
              correct: t.Boolean(),
              durationMs: t.Integer({ minimum: 0 }),
              practicedAt: t.Integer({ minimum: 0 }),
            }),
            { minItems: 1 },
          ),
        }),
      },
    )
    .get('/kids/:id/practice/due', ({ params, admin, kid, set }) => {
      const denial = accessDenial(admin, kid, params.id);
      if (denial) {
        set.status = denial;
        return { error: denial === 401 ? 'Not authenticated.' : 'Forbidden.' };
      }
      return getDueWords(db, params.id, now()).map(toPublicWord);
    })
    .get('/kids/:id/practice/today', ({ params, admin, kid, set }) => {
      const denial = accessDenial(admin, kid, params.id);
      if (denial) {
        set.status = denial;
        return { error: denial === 401 ? 'Not authenticated.' : 'Forbidden.' };
      }
      const theKid = getKidById(db, params.id);
      if (!theKid) {
        set.status = 404;
        return { error: 'Kid not found.' };
      }
      const startMs = startOfDayMs(config.TZ, now());
      return getTodaySummary(db, params.id, theKid.daily_goal_seconds, startMs);
    });
}
