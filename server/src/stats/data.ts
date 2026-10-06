// Dashboard-Aggregationen über practice_events + words. Tagesgrenzen laufen
// über die Familien-Zeitzone (config TZ), identisch zu practice/today (#7).
import type { Database } from 'bun:sqlite';
import type { KidRow, PracticeEventRow, WordRow } from '../types';
import { tagesSchluessel, tageRueckwaerts } from '../time';

/** Ein Wort gilt als „schwach": ≥ 2 Versuche und Fehlerquote ≥ 50 %. */
const SCHWACH_MIN_VERSUCHE = 2;
const SCHWACH_MIN_FEHLERQUOTE = 0.5;

export interface TagesAktivitaet {
  date: string;
  secondsPracticed: number;
  goalMet: boolean;
  wordsReviewed: number;
  /** Anteil richtiger Antworten (0–1); null ohne Versuche. */
  correctRate: number | null;
}

export interface StreakErgebnis {
  current: number;
  longest: number;
}

export interface SchwachesWort {
  wordId: string;
  wort: string;
  fach: number;
  attempts: number;
  wrong: number;
  missRate: number;
}

export interface KidUebersicht {
  kid: {
    id: string;
    name: string;
    lernstand: string;
    dailyGoalSeconds: number;
  };
  today: { secondsPracticed: number; goalMet: boolean };
  streak: number;
  week: { secondsPracticed: number; daysGoalMet: number };
  dueCount: number;
  masteryPct: number;
  weakWordsCount: number;
  lastPracticedAt: number | null;
}

interface TagesSumme {
  seconds: number;
  reviewed: number;
  correct: number;
}

function eventsVonKid(db: Database, kidId: string, abMs?: number): PracticeEventRow[] {
  if (abMs !== undefined) {
    return db
      .query('SELECT * FROM practice_events WHERE kid_id = ? AND practiced_at >= ?;')
      .all(kidId, abMs) as PracticeEventRow[];
  }
  return db.query('SELECT * FROM practice_events WHERE kid_id = ?;').all(kidId) as PracticeEventRow[];
}

/** Events nach lokalem Kalendertag aufsummieren. */
function proTag(events: PracticeEventRow[], tz: string): Map<string, TagesSumme> {
  const map = new Map<string, TagesSumme>();
  for (const ev of events) {
    const key = tagesSchluessel(tz, ev.practiced_at);
    const summe = map.get(key) ?? { seconds: 0, reviewed: 0, correct: 0 };
    summe.seconds += ev.duration_ms / 1000;
    // Reine Zeitgutschriften (#17) zählen zur Zeit, aber nicht als Versuch.
    if (ev.art !== 'zeit') {
      summe.reviewed += 1;
      summe.correct += ev.correct ? 1 : 0;
    }
    map.set(key, summe);
  }
  return map;
}

/** Tagesreihe (älteste zuerst) für die letzten `tage` Tage bis `nowMs`. */
export function aktivitaet(
  db: Database,
  kid: KidRow,
  tz: string,
  nowMs: number,
  tage: number,
): TagesAktivitaet[] {
  const abMs = nowMs - tage * 86_400_000;
  const summen = proTag(eventsVonKid(db, kid.id, abMs), tz);
  return tageRueckwaerts(tz, nowMs, tage)
    .map((date) => {
      const s = summen.get(date);
      const seconds = Math.round(s?.seconds ?? 0);
      return {
        date,
        secondsPracticed: seconds,
        goalMet: seconds >= kid.daily_goal_seconds,
        wordsReviewed: s?.reviewed ?? 0,
        correctRate: s && s.reviewed > 0 ? s.correct / s.reviewed : null,
      };
    })
    .reverse();
}

/**
 * Serien: `current` = Ziel-erfüllte Tage in Folge bis heute — ein noch nicht
 * erfülltes Heute bricht die Serie nicht (sie zählt dann ab gestern).
 * `longest` = längste Serie innerhalb des 365-Tage-Fensters.
 */
export function streak(db: Database, kid: KidRow, tz: string, nowMs: number): StreakErgebnis {
  const fenster = 365;
  const summen = proTag(eventsVonKid(db, kid.id, nowMs - fenster * 86_400_000), tz);
  const tage = tageRueckwaerts(tz, nowMs, fenster); // heute zuerst
  const erfuellt = tage.map(
    (key) => Math.round(summen.get(key)?.seconds ?? 0) >= kid.daily_goal_seconds,
  );

  let current = 0;
  const start = erfuellt[0] ? 0 : 1; // heute offen? -> ab gestern zählen
  for (let i = start; i < erfuellt.length && erfuellt[i]; i++) current++;
  if (erfuellt[0]) current = Math.max(current, 1);

  let longest = 0;
  let lauf = 0;
  for (const tag of erfuellt) {
    lauf = tag ? lauf + 1 : 0;
    longest = Math.max(longest, lauf);
  }
  return { current, longest };
}

/** Wörter mit hoher Fehlerquote (sortiert: Fehlerquote absteigend, Fach aufsteigend). */
export function schwacheWoerter(db: Database, kidId: string, limit = 10): SchwachesWort[] {
  const rows = db
    .query(
      `SELECT w.id AS wordId, w.wort AS wort, w.fach AS fach,
              COUNT(e.id) AS attempts, SUM(1 - e.correct) AS wrong
       FROM words w JOIN practice_events e ON e.word_id = w.id
       WHERE w.kid_id = ? AND e.art <> 'zeit'
       GROUP BY w.id
       HAVING attempts >= ?`,
    )
    .all(kidId, SCHWACH_MIN_VERSUCHE) as {
    wordId: string;
    wort: string;
    fach: number;
    attempts: number;
    wrong: number;
  }[];
  return rows
    .map((r) => ({ ...r, missRate: r.wrong / r.attempts }))
    .filter((r) => r.missRate >= SCHWACH_MIN_FEHLERQUOTE)
    .sort((a, b) => b.missRate - a.missRate || a.fach - b.fach)
    .slice(0, limit);
}

/** Familien-Überblick: eine KPI-Zeile pro Kind der angegebenen Familie. */
export function uebersicht(
  db: Database,
  tz: string,
  nowMs: number,
  familyId: string | null,
): KidUebersicht[] {
  const kids = db
    .query('SELECT * FROM kids WHERE family_id IS ? ORDER BY name COLLATE NOCASE;')
    .all(familyId) as KidRow[];
  return kids.map((kid) => {
    const woche = aktivitaet(db, kid, tz, nowMs, 7);
    const heute = woche[woche.length - 1];
    const serien = streak(db, kid, tz, nowMs);

    const woerter = db.query('SELECT * FROM words WHERE kid_id = ?;').all(kid.id) as WordRow[];
    const dueCount = woerter.filter((w) => w.faellig_am !== null && w.faellig_am <= nowMs).length;
    const sitzt = woerter.filter((w) => w.fach >= 5).length;

    const letzter = db
      .query('SELECT MAX(practiced_at) AS t FROM practice_events WHERE kid_id = ?;')
      .get(kid.id) as { t: number | null };

    return {
      kid: {
        id: kid.id,
        name: kid.name,
        lernstand: kid.lernstand,
        dailyGoalSeconds: kid.daily_goal_seconds,
      },
      today: {
        secondsPracticed: heute?.secondsPracticed ?? 0,
        goalMet: heute?.goalMet ?? false,
      },
      streak: serien.current,
      week: {
        secondsPracticed: woche.reduce((sum, t) => sum + t.secondsPracticed, 0),
        daysGoalMet: woche.filter((t) => t.goalMet).length,
      },
      dueCount,
      masteryPct: woerter.length > 0 ? Math.round((sitzt / woerter.length) * 100) : 0,
      weakWordsCount: schwacheWoerter(db, kid.id, 1000).length,
      lastPracticedAt: letzter.t,
    };
  });
}
