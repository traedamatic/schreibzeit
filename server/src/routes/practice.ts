// Practice API: submit a run (records events + advances SRS), read due words,
// and read today's time-vs-goal summary. Zugriff: das eigene Kind oder ein
// Admin derselben Familie (#12 — fremde Familien sehen 404).
import { Elysia, t } from 'elysia';
import type { Database } from 'bun:sqlite';
import type { Config } from '../config';
import { adminContext, kidContext, kidZugriff, zugriffsFehler } from '../auth/guards';
import { toPublicWord } from '../words/public';
import {
  PracticeError,
  getDueWords,
  getTodaySummary,
  recordSession,
} from '../practice/data';
import { startOfDayMs } from '../time';
import { now } from '../ids';
import { PRACTICE_ART_VALUES, type PracticeArt } from '../types';

export function practiceRoutes(db: Database, config: Config) {
  return new Elysia()
    .use(adminContext(db))
    .use(kidContext(db))
    .post(
      '/kids/:id/practice',
      ({ params, body, admin, kid, set }) => {
        const zugriff = kidZugriff(db, admin, kid, params.id);
        if ('status' in zugriff) {
          set.status = zugriff.status;
          return zugriffsFehler(zugriff.status);
        }
        if (body.art !== undefined && !(PRACTICE_ART_VALUES as readonly string[]).includes(body.art)) {
          set.status = 400;
          return { error: 'Invalid art.' };
        }
        try {
          const result = recordSession(
            db,
            zugriff.kid.id,
            body.sessionId,
            body.events.map((e) => ({
              wordId: e.wordId,
              correct: e.correct,
              durationMs: e.durationMs,
              practicedAt: e.practicedAt,
            })),
            (body.art as PracticeArt | undefined) ?? 'schreiben',
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
          art: t.Optional(t.String({ maxLength: 20 })),
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
      const zugriff = kidZugriff(db, admin, kid, params.id);
      if ('status' in zugriff) {
        set.status = zugriff.status;
        return zugriffsFehler(zugriff.status);
      }
      return getDueWords(db, zugriff.kid.id, now()).map(toPublicWord);
    })
    .get('/kids/:id/practice/today', ({ params, admin, kid, set }) => {
      const zugriff = kidZugriff(db, admin, kid, params.id);
      if ('status' in zugriff) {
        set.status = zugriff.status;
        return zugriffsFehler(zugriff.status);
      }
      const startMs = startOfDayMs(config.TZ, now());
      return getTodaySummary(
        db,
        zugriff.kid.id,
        zugriff.kid.daily_goal_seconds,
        zugriff.kid.daily_cap_seconds,
        startMs,
      );
    });
}
