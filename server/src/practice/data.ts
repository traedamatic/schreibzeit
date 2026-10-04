// Practice recording + queries. Applies SRS server-side (authoritative) and
// records one practice_event per word attempt with its duration. Idempotent on
// repeated (session_id, word_id) so offline-sync retries can't double-apply.
import type { Database } from 'bun:sqlite';
import type { UebungsModus, WordRow } from '../types';
import { getWordById } from '../words/data';
import { naechsterStand } from '../srs';
import { newId, now } from '../ids';

/** Thrown for a malformed/unauthorized event; carries an HTTP status. */
export class PracticeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PracticeError';
  }
}

export interface PracticeEventInput {
  wordId: string;
  correct: boolean;
  durationMs: number;
  practicedAt: number;
}

export interface RecordResult {
  updated: WordRow[];
  applied: number;
  skipped: number;
}

/**
 * Words currently due for a kid (SRS: faellig_am ≤ now), oldest first.
 * Im Übungsmodus 'nomen' (#15) werden nur Nomen geliefert: Artikel der/die/das
 * oder wortart 'Nomen'.
 */
export function getDueWords(
  db: Database,
  kidId: string,
  nowMs: number,
  modus: UebungsModus = 'alle',
): WordRow[] {
  const nomenFilter =
    modus === 'nomen' ? " AND (artikel IN ('der','die','das') OR lower(wortart) = 'nomen')" : '';
  return db
    .query(
      `SELECT * FROM words WHERE kid_id = ? AND faellig_am IS NOT NULL AND faellig_am <= ?${nomenFilter} ORDER BY faellig_am ASC;`,
    )
    .all(kidId, nowMs) as WordRow[];
}

/**
 * Record a practice run. Each event advances the word's SRS state and inserts a
 * practice_events row. A repeated (sessionId, wordId) is skipped (idempotent).
 * The whole run is one transaction; an invalid word reference rolls it back.
 */
export function recordSession(
  db: Database,
  kidId: string,
  sessionId: string,
  events: PracticeEventInput[],
): RecordResult {
  const updated: WordRow[] = [];
  let applied = 0;
  let skipped = 0;

  const run = db.transaction(() => {
    for (const ev of events) {
      const word = getWordById(db, ev.wordId);
      if (!word || word.kid_id !== kidId) {
        throw new PracticeError(`Word ${ev.wordId} does not belong to this kid.`, 400);
      }
      const already = db
        .query('SELECT 1 FROM practice_events WHERE session_id = ? AND word_id = ?;')
        .get(sessionId, ev.wordId);
      if (already) {
        skipped += 1;
        continue;
      }
      const next = naechsterStand(word.fach, ev.correct, ev.practicedAt);
      db.query(
        `INSERT INTO practice_events
           (id, kid_id, word_id, session_id, correct, duration_ms, fach_before, fach_after, practiced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId(),
        kidId,
        ev.wordId,
        sessionId,
        ev.correct ? 1 : 0,
        ev.durationMs,
        word.fach,
        next.fach,
        ev.practicedAt,
      );
      db.query('UPDATE words SET fach = ?, faellig_am = ?, status = ?, updated_at = ? WHERE id = ?;').run(
        next.fach,
        next.faelligAm,
        next.status,
        now(),
        ev.wordId,
      );
      applied += 1;
      const refreshed = getWordById(db, ev.wordId);
      if (refreshed) updated.push(refreshed);
    }
  });
  run();

  return { updated, applied, skipped };
}

export interface TodaySummary {
  secondsToday: number;
  goalSeconds: number;
  goalMet: boolean;
  sessionsToday: number;
}

/** Aggregate today's practice time for a kid vs its goal. `startMs` = local midnight. */
export function getTodaySummary(
  db: Database,
  kidId: string,
  goalSeconds: number,
  startMs: number,
): TodaySummary {
  const row = db
    .query(
      `SELECT COALESCE(SUM(duration_ms), 0) AS ms, COUNT(DISTINCT session_id) AS sessions
       FROM practice_events WHERE kid_id = ? AND practiced_at >= ?;`,
    )
    .get(kidId, startMs) as { ms: number; sessions: number };
  const secondsToday = Math.round(row.ms / 1000);
  return {
    secondsToday,
    goalSeconds,
    goalMet: secondsToday >= goalSeconds,
    sessionsToday: row.sessions,
  };
}
