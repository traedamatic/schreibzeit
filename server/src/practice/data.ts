// Practice recording + queries. Applies SRS server-side (authoritative) and
// records one practice_event per word attempt with its duration. Idempotent on
// repeated (session_id, word_id) so offline-sync retries can't double-apply.
import type { Database } from 'bun:sqlite';
import type { PracticeArt, WordRow } from '../types';
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
  /**
   * Reine Zeitgutschrift (#17): ein angefangenes, aber nie bewertetes Wort beim
   * Hard-Stop. Zählt zur Übungszeit, lässt SRS + Trefferstatistik unberührt.
   */
  nurZeit?: boolean;
}

export interface RecordResult {
  updated: WordRow[];
  applied: number;
  skipped: number;
}

/**
 * Words currently due for a kid (SRS: faellig_am ≤ now), oldest first.
 *
 * Seit #18 liefert dies immer alle fälligen Wörter — die Wahl der Übung (alle
 * Wörter / nur Nomen / Quiz) trifft das Kind pro Session clientseitig; der Server
 * schreibt sie dem Kind nicht mehr vor.
 */
export function getDueWords(db: Database, kidId: string, nowMs: number): WordRow[] {
  return db
    .query(
      'SELECT * FROM words WHERE kid_id = ? AND faellig_am IS NOT NULL AND faellig_am <= ? ORDER BY faellig_am ASC;',
    )
    .all(kidId, nowMs) as WordRow[];
}

/**
 * Record a practice run. Each event inserts a practice_events row; repeated
 * (sessionId, wordId) pairs are skipped (idempotent). The whole run is one
 * transaction; an invalid word reference rolls it back.
 *
 * Seit #18 speist **jede** echte Übungsart den SRS-Stand: eine falsche Antwort
 * setzt das Wort zurück (Box 1 → es taucht bald wieder auf), eine richtige rückt
 * es vor. So wirken auch das Quiz und die Groß/klein-Übung auf die Problemwort-
 * Erkennung. Ausnahme: reine Zeitgutschriften (#17, `nurZeit` → `art = 'zeit'`)
 * zählen nur zur Übungszeit und lassen den SRS-Stand unberührt. `art` bleibt am
 * Event erhalten (Statistik/Übungstyp).
 */
export function recordSession(
  db: Database,
  kidId: string,
  sessionId: string,
  events: PracticeEventInput[],
  art: PracticeArt = 'schreiben',
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
      const eventArt = ev.nurZeit ? 'zeit' : art;
      // Seit #18 speist jede echte Übung den SRS-Stand (auch das Quiz): richtig
      // rückt vor, falsch setzt zurück. Reine Zeitgutschriften (#17, 'zeit')
      // bleiben SRS-neutral und aus der Trefferstatistik ausgenommen (stats/data.ts).
      const srsWirksam = eventArt !== 'zeit';
      const next = naechsterStand(word.fach, ev.correct, ev.practicedAt);
      const fachNachher = srsWirksam ? next.fach : word.fach;
      db.query(
        `INSERT INTO practice_events
           (id, kid_id, word_id, session_id, correct, duration_ms, art, fach_before, fach_after, practiced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId(),
        kidId,
        ev.wordId,
        sessionId,
        ev.correct ? 1 : 0,
        ev.durationMs,
        eventArt,
        word.fach,
        fachNachher,
        ev.practicedAt,
      );
      if (srsWirksam) {
        db.query(
          'UPDATE words SET fach = ?, faellig_am = ?, status = ?, updated_at = ? WHERE id = ?;',
        ).run(next.fach, next.faelligAm, next.status, now(), ev.wordId);
      }
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
  /** Harte Tagesobergrenze (#18): ab hier ist für heute Schluss. */
  capSeconds: number;
  capMet: boolean;
  sessionsToday: number;
}

/**
 * Aggregate today's practice time for a kid vs its goal and hard cap (#18).
 * `startMs` = local midnight.
 */
export function getTodaySummary(
  db: Database,
  kidId: string,
  goalSeconds: number,
  capSeconds: number,
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
    capSeconds,
    capMet: secondsToday >= capSeconds,
    sessionsToday: row.sessions,
  };
}
