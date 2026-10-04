import { describe, expect, it } from 'bun:test';
import { openDatabase } from '../db';
import { runMigrations } from '../migrations';
import { aktivitaet, schwacheWoerter, streak, uebersicht } from './data';
import { newId } from '../ids';
import type { KidRow } from '../types';

const TZ = 'UTC';
const TAG = 86_400_000;
// Fester Bezugspunkt: 2026-01-20 12:00 UTC (Mittag → keine Tagesgrenzen-Effekte).
const JETZT = Date.UTC(2026, 0, 20, 12, 0, 0);

function setup() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const kidId = newId();
  db.query(
    'INSERT INTO kids (id, name, lernstand, daily_goal_seconds, created_at, updated_at) VALUES (?, ?, ?, 300, ?, ?)',
  ).run(kidId, 'Lina', 'klasse2', JETZT, JETZT);
  const kid = db.query('SELECT * FROM kids WHERE id = ?;').get(kidId) as KidRow;

  function wort(wortText: string, fach = 1, faelligAm: number | null = JETZT - 1000): string {
    const id = newId();
    db.query(
      'INSERT INTO words (id, kid_id, wort, status, fach, faellig_am, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, kidId, wortText, 'neu', fach, faelligAm, JETZT, JETZT);
    return id;
  }
  function event(wordId: string, korrekt: boolean, sekunden: number, am: number): void {
    db.query(
      'INSERT INTO practice_events (id, kid_id, word_id, session_id, correct, duration_ms, practiced_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(newId(), kidId, wordId, newId(), korrekt ? 1 : 0, sekunden * 1000, am);
  }
  return { db, kid, kidId, wort, event };
}

describe('aktivitaet', () => {
  it('summiert pro Tag Zeit, Wörter und Trefferquote; goalMet gegen das Tagesziel', () => {
    const { db, kid, wort, event } = setup();
    const w = wort('Sommer');
    // Heute: 2 Versuche à 200 s (400 s ≥ 300-s-Ziel), 1 richtig.
    event(w, true, 200, JETZT - 1000);
    event(w, false, 200, JETZT - 2000);
    // Gestern: 100 s (< Ziel), richtig.
    event(w, true, 100, JETZT - TAG);

    const reihe = aktivitaet(db, kid, TZ, JETZT, 3);
    expect(reihe).toHaveLength(3);
    const [vorgestern, gestern, heute] = reihe;
    expect(vorgestern?.secondsPracticed).toBe(0);
    expect(vorgestern?.correctRate).toBeNull();
    expect(gestern?.secondsPracticed).toBe(100);
    expect(gestern?.goalMet).toBe(false);
    expect(heute?.secondsPracticed).toBe(400);
    expect(heute?.goalMet).toBe(true);
    expect(heute?.wordsReviewed).toBe(2);
    expect(heute?.correctRate).toBe(0.5);
  });
});

describe('streak', () => {
  it('zählt erfüllte Tage in Folge; ein offenes Heute bricht die Serie nicht', () => {
    const { db, kid, wort, event } = setup();
    const w = wort('Haus');
    // Gestern + Vorgestern erfüllt (je 300 s), heute (noch) nichts.
    event(w, true, 300, JETZT - TAG);
    event(w, true, 300, JETZT - 2 * TAG);
    // Lücke vor 3 Tagen; davor 3 erfüllte Tage → longest = 3.
    event(w, true, 300, JETZT - 4 * TAG);
    event(w, true, 300, JETZT - 5 * TAG);
    event(w, true, 300, JETZT - 6 * TAG);

    const s = streak(db, kid, TZ, JETZT);
    expect(s.current).toBe(2);
    expect(s.longest).toBe(3);
  });

  it('zählt das erfüllte Heute in die laufende Serie', () => {
    const { db, kid, wort, event } = setup();
    const w = wort('Baum');
    event(w, true, 300, JETZT - 1000);
    event(w, true, 300, JETZT - TAG);
    expect(streak(db, kid, TZ, JETZT).current).toBe(2);
  });
});

describe('schwacheWoerter', () => {
  it('liefert nur Wörter mit ≥2 Versuchen und ≥50% Fehlerquote, sortiert nach Quote', () => {
    const { db, kidId, wort, event } = setup();
    const schwach = wort('Fahrrad');
    event(schwach, false, 10, JETZT - 1000);
    event(schwach, false, 10, JETZT - 2000);
    event(schwach, true, 10, JETZT - 3000); // 2/3 falsch
    const halb = wort('Straße');
    event(halb, false, 10, JETZT - 1000);
    event(halb, true, 10, JETZT - 2000); // 1/2 falsch — gerade noch schwach
    const stark = wort('Hund');
    event(stark, true, 10, JETZT - 1000);
    event(stark, true, 10, JETZT - 2000); // 0% falsch
    const einmal = wort('Katze');
    event(einmal, false, 10, JETZT - 1000); // nur 1 Versuch — zu wenig Daten

    const liste = schwacheWoerter(db, kidId);
    expect(liste.map((w) => w.wort)).toEqual(['Fahrrad', 'Straße']);
    expect(liste[0]?.missRate).toBeCloseTo(2 / 3);
    expect(liste[0]?.attempts).toBe(3);
  });
});

describe('uebersicht', () => {
  it('liefert eine KPI-Zeile pro Kind (heute, Woche, Serie, fällig, Beherrschung, zuletzt)', () => {
    const { db, wort, event } = setup();
    const w1 = wort('Sommer', 5, null); // sitzt, nicht fällig
    const w2 = wort('Winter', 1, JETZT - 1000); // fällig
    event(w1, true, 300, JETZT - 1000); // heute Ziel erfüllt
    event(w2, true, 120, JETZT - TAG); // gestern unter Ziel

    const [zeile] = uebersicht(db, TZ, JETZT);
    expect(zeile?.kid.name).toBe('Lina');
    expect(zeile?.today).toEqual({ secondsPracticed: 300, goalMet: true });
    expect(zeile?.streak).toBe(1);
    expect(zeile?.week.secondsPracticed).toBe(420);
    expect(zeile?.week.daysGoalMet).toBe(1);
    expect(zeile?.dueCount).toBe(1);
    expect(zeile?.masteryPct).toBe(50);
    expect(zeile?.weakWordsCount).toBe(0);
    expect(zeile?.lastPracticedAt).toBe(JETZT - 1000);
  });

  it('rendert ein Kind ohne jede Übung mit Null-Werten', () => {
    const { db } = setup();
    const [zeile] = uebersicht(db, TZ, JETZT);
    expect(zeile?.today).toEqual({ secondsPracticed: 0, goalMet: false });
    expect(zeile?.streak).toBe(0);
    expect(zeile?.masteryPct).toBe(0);
    expect(zeile?.lastPracticedAt).toBeNull();
  });
});
