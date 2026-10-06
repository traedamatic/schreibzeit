// Reine Übungslogik des Schüler-Clients: Zeitziel-Rechnung, aktive Stoppuhr
// und die Offline-Warteschlange für noch nicht übertragene Sessions.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baueQuizRunde,
  erzeugeStoppuhr,
  formatZeit,
  heuteGeuebteArten,
  istNomen,
  istZeitUm,
  merkeGeuebteArt,
  naechsterArtVorschlag,
  offeneZeitErfassen,
  restSekunden,
  sessionAnhaengen,
  wartendeAbspielen,
  wartendeLaden,
  type QuizWort,
  type WartendeSession,
} from '@/schueler/uebung';
import type { UebungsEreignis } from '@/services/api';

describe('Zeitziel', () => {
  it('restSekunden zählt Tagesstand und laufende Session zusammen', () => {
    // Ziel 300 s, heute schon 100 s geübt, Session läuft seit 50 s.
    expect(restSekunden(300, 100, 50_000)).toBe(150);
  });

  it('wird nie negativ und kippt istZeitUm genau am Ziel', () => {
    expect(restSekunden(300, 290, 20_000)).toBe(0);
    expect(istZeitUm(300, 290, 20_000)).toBe(true);
    expect(istZeitUm(300, 290, 9_000)).toBe(false);
  });

  it('formatZeit liefert M:SS', () => {
    expect(formatZeit(0)).toBe('0:00');
    expect(formatZeit(65)).toBe('1:05');
    expect(formatZeit(300)).toBe('5:00');
  });
});

describe('offeneZeitErfassen (Restzeit-Gutschrift #17)', () => {
  const ereignis = (wordId: string, durationMs: number): UebungsEreignis => ({
    wordId,
    correct: true,
    durationMs,
    practicedAt: 0,
  });

  it('schreibt dem laufenden Wort die nicht erfasste aktive Zeit gut', () => {
    // 20 s aktiv, 7 s bereits in w1 erfasst → 13 s offen für das laufende w2.
    const gut = offeneZeitErfassen(20_000, [ereignis('w1', 7000)], { id: 'w2' }, 123);
    expect(gut).toEqual({
      wordId: 'w2',
      correct: false,
      durationMs: 13_000,
      practicedAt: 123,
      nurZeit: true,
    });
  });

  it('gilt auch, wenn noch kein Wort bewertet wurde (Hard-Stop im ersten Wort)', () => {
    const gut = offeneZeitErfassen(3000, [], { id: 'w1' }, 5);
    expect(gut?.durationMs).toBe(3000);
    expect(gut?.nurZeit).toBe(true);
  });

  it('liefert null, wenn die Restzeit unter einer Sekunde liegt (normaler Abschluss)', () => {
    expect(offeneZeitErfassen(20_040, [ereignis('w1', 20_000)], { id: 'w1' }, 0)).toBeNull();
  });

  it('liefert null, wenn das laufende Wort bereits ein Ereignis hat', () => {
    // Verhindert eine (session_id, word_id)-Kollision — der Server würde es sonst
    // verwerfen und die Zeit ginge verloren.
    expect(offeneZeitErfassen(30_000, [ereignis('w1', 10_000)], { id: 'w1' }, 0)).toBeNull();
  });

  it('liefert null ohne laufendes Wort', () => {
    expect(offeneZeitErfassen(30_000, [], undefined, 0)).toBeNull();
  });
});

describe('Stoppuhr (aktive Zeit, pausierbar)', () => {
  it('zählt nur während aktiver Phasen', () => {
    let zeit = 0;
    const uhr = erzeugeStoppuhr(() => zeit);

    uhr.start();
    zeit = 10_000;
    uhr.pause(); // 10 s aktiv
    zeit = 60_000; // Tab war 50 s im Hintergrund — zählt nicht
    uhr.start();
    zeit = 75_000; // weitere 15 s aktiv

    expect(uhr.aktiveMs()).toBe(25_000);
  });

  it('doppeltes start/pause ist unschädlich', () => {
    let zeit = 0;
    const uhr = erzeugeStoppuhr(() => zeit);
    uhr.start();
    uhr.start();
    zeit = 5_000;
    uhr.pause();
    uhr.pause();
    expect(uhr.aktiveMs()).toBe(5_000);
  });
});

describe('Offline-Warteschlange', () => {
  const session = (id: string): WartendeSession => ({
    kindId: 'k1',
    sessionId: id,
    events: [{ wordId: 'w1', correct: true, durationMs: 1000, practicedAt: 123 }],
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('hängt Sessions an und lädt sie wieder', () => {
    sessionAnhaengen(session('a'));
    sessionAnhaengen(session('b'));
    expect(wartendeLaden().map((s) => s.sessionId)).toEqual(['a', 'b']);
  });

  it('spielt erfolgreich gesendete Sessions ab und leert die Warteschlange', async () => {
    sessionAnhaengen(session('a'));
    sessionAnhaengen(session('b'));
    const senden = vi.fn().mockResolvedValue({ applied: 1 });

    const rest = await wartendeAbspielen(senden);
    expect(rest).toBe(0);
    expect(senden).toHaveBeenCalledTimes(2);
    expect(wartendeLaden()).toEqual([]);
  });

  it('stoppt beim ersten Fehler und behält den Rest', async () => {
    sessionAnhaengen(session('a'));
    sessionAnhaengen(session('b'));
    sessionAnhaengen(session('c'));
    const senden = vi
      .fn()
      .mockResolvedValueOnce({ applied: 1 })
      .mockRejectedValueOnce(new Error('offline'));

    const rest = await wartendeAbspielen(senden);
    expect(rest).toBe(2);
    expect(wartendeLaden().map((s) => s.sessionId)).toEqual(['b', 'c']);
  });

  it('übersteht kaputten Speicherinhalt', () => {
    localStorage.setItem('sz-ueben-warteschlange', '{kein json');
    expect(wartendeLaden()).toEqual([]);
  });
});

describe('Übungsmix-Anstupser (#18)', () => {
  beforeEach(() => localStorage.clear());

  it('merkt geübte Arten pro Tag und liefert sie zurück', () => {
    merkeGeuebteArt('k1', '2026-10-06', 'alle');
    merkeGeuebteArt('k1', '2026-10-06', 'quiz');
    const arten = heuteGeuebteArten('k1', '2026-10-06');
    expect([...arten].sort()).toEqual(['alle', 'quiz']);
  });

  it('setzt die Liste bei Tageswechsel zurück', () => {
    merkeGeuebteArt('k1', '2026-10-05', 'alle');
    expect(heuteGeuebteArten('k1', '2026-10-06').size).toBe(0);
  });

  it('trennt Kinder', () => {
    merkeGeuebteArt('k1', '2026-10-06', 'alle');
    expect(heuteGeuebteArten('k2', '2026-10-06').size).toBe(0);
  });

  it('schlägt die erste noch nicht geübte Art vor; null wenn alle dran waren', () => {
    expect(naechsterArtVorschlag(new Set())).toBe('alle');
    expect(naechsterArtVorschlag(new Set(['alle']))).toBe('nomen');
    expect(naechsterArtVorschlag(new Set(['alle', 'nomen']))).toBe('quiz');
    expect(naechsterArtVorschlag(new Set(['alle', 'nomen', 'quiz']))).toBeNull();
  });
});

describe('Groß/klein-Quiz (#16)', () => {
  const nomen = (name: string): QuizWort & { name: string } => ({
    name,
    artikel: 'der',
    wortart: null,
  });
  const verb = (name: string): QuizWort & { name: string } => ({
    name,
    artikel: null,
    wortart: null,
  });

  it('istNomen erkennt Artikel und wortart', () => {
    expect(istNomen({ artikel: 'die', wortart: null })).toBe(true);
    expect(istNomen({ artikel: null, wortart: 'Nomen' })).toBe(true);
    expect(istNomen({ artikel: '', wortart: 'Verb' })).toBe(false);
    expect(istNomen({ artikel: null, wortart: null })).toBe(false);
  });

  it('mischt Nomen und Nicht-Nomen ausgewogen und begrenzt auf max', () => {
    const woerter = [
      ...Array.from({ length: 10 }, (_, i) => nomen(`N${i}`)),
      ...Array.from({ length: 10 }, (_, i) => verb(`V${i}`)),
    ];
    const runde = baueQuizRunde(woerter, 6, () => 0.5);
    expect(runde).toHaveLength(6);
    const nomenAnzahl = runde.filter((w) => istNomen(w)).length;
    expect(nomenAnzahl).toBe(3); // ausgewogen bei genug Material
  });

  it('läuft auch mit nur einer Gruppe (reine Nomen-Kartei)', () => {
    const runde = baueQuizRunde([nomen('A'), nomen('B')], 20, () => 0.5);
    expect(runde).toHaveLength(2);
  });

  it('ist mit injiziertem Zufall deterministisch', () => {
    const woerter = [nomen('A'), verb('b'), nomen('C'), verb('d')];
    const a = baueQuizRunde(woerter, 4, () => 0.1).map((w) => w.name);
    const b = baueQuizRunde(woerter, 4, () => 0.1).map((w) => w.name);
    expect(a).toEqual(b);
  });
});
