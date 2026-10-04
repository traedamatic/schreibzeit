// Reine Übungslogik des Schüler-Clients: Zeitziel-Rechnung, aktive Stoppuhr
// und die Offline-Warteschlange für noch nicht übertragene Sessions.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  erzeugeStoppuhr,
  formatZeit,
  istZeitUm,
  restSekunden,
  sessionAnhaengen,
  wartendeAbspielen,
  wartendeLaden,
  type WartendeSession,
} from '@/schueler/uebung';

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
