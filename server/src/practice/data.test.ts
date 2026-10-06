// Zeitgutschrift-Events (#17): ein angefangenes, aber nie bewertetes Wort beim
// Hard-Stop zählt zur Übungszeit, lässt aber SRS + Trefferstatistik unberührt.
import { describe, expect, it } from 'bun:test';
import { openDatabase } from '../db';
import { runMigrations } from '../migrations';
import { getTodaySummary, recordSession } from './data';
import { aktivitaet, schwacheWoerter } from '../stats/data';
import { newId } from '../ids';
import type { KidRow, WordRow } from '../types';

const TZ = 'UTC';
const JETZT = Date.UTC(2026, 0, 20, 12, 0, 0);
const TAGESBEGINN = Date.UTC(2026, 0, 20, 0, 0, 0);

function setup() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const kidId = newId();
  db.query(
    'INSERT INTO kids (id, name, lernstand, daily_goal_seconds, created_at, updated_at) VALUES (?, ?, ?, 300, ?, ?)',
  ).run(kidId, 'Lina', 'klasse2', JETZT, JETZT);
  const kid = db.query('SELECT * FROM kids WHERE id = ?;').get(kidId) as KidRow;

  const wortId = newId();
  db.query(
    'INSERT INTO words (id, kid_id, wort, status, fach, faellig_am, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(wortId, kidId, 'Sommer', 'neu', 1, JETZT - 1000, JETZT, JETZT);

  return { db, kid, kidId, wortId };
}

describe('recordSession mit Zeitgutschrift (#17)', () => {
  it('zählt nurZeit-Dauer zur Übungszeit, ohne den SRS-Stand zu verändern', () => {
    const { db, kidId, wortId } = setup();
    recordSession(db, kidId, newId(), [
      { wordId: wortId, correct: false, durationMs: 13_000, practicedAt: JETZT, nurZeit: true },
    ]);

    const zusammenfassung = getTodaySummary(db, kidId, 300, 600, TAGESBEGINN);
    expect(zusammenfassung.secondsToday).toBe(13);

    // SRS unangetastet: Wort bleibt in Fach 1 mit unverändertem Status.
    const wort = db.query('SELECT * FROM words WHERE id = ?;').get(wortId) as WordRow;
    expect(wort.fach).toBe(1);
    expect(wort.status).toBe('neu');

    // Als 'zeit' gespeichert.
    const ev = db
      .query('SELECT art FROM practice_events WHERE word_id = ?;')
      .get(wortId) as { art: string };
    expect(ev.art).toBe('zeit');
  });

  it('wird aus Trefferstatistik und schwachen Wörtern ausgeklammert', () => {
    const { db, kid, kidId, wortId } = setup();
    // Zwei echte, falsche Schreibversuche + eine reine Zeitgutschrift.
    recordSession(db, kidId, newId(), [
      { wordId: wortId, correct: false, durationMs: 5000, practicedAt: JETZT },
    ]);
    recordSession(db, kidId, newId(), [
      { wordId: wortId, correct: false, durationMs: 5000, practicedAt: JETZT },
    ]);
    recordSession(db, kidId, newId(), [
      { wordId: wortId, correct: false, durationMs: 9000, practicedAt: JETZT, nurZeit: true },
    ]);

    // Tagesreihe: Zeit zählt voll (19 s), aber nur 2 Versuche, Trefferquote 0.
    const heute = aktivitaet(db, kid, TZ, JETZT, 1)[0];
    expect(heute?.secondsPracticed).toBe(19);
    expect(heute?.wordsReviewed).toBe(2);
    expect(heute?.correctRate).toBe(0);

    // Schwache Wörter: attempts = 2 (die Gutschrift zählt nicht mit).
    const schwach = schwacheWoerter(db, kidId);
    expect(schwach).toHaveLength(1);
    expect(schwach[0]?.attempts).toBe(2);
    expect(schwach[0]?.wrong).toBe(2);
  });
});
