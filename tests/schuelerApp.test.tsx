// @vitest-environment jsdom
// SchuelerApp (#18): Das Kind wählt die Übung pro Session selbst; die Übung
// stoppt hart erst an der Tagesobergrenze (nicht schon am Ziel), und bei
// erreichtem Ziel läuft sie als Bonus bis zur Grenze weiter.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SchuelerApp } from '@/schueler/SchuelerApp';
import type { HeuteStand, ServerWort } from '@/services/api';

const profil = {
  id: 'k1',
  name: 'Lina',
  lernstand: 'klasse2',
  dailyGoalSeconds: 300,
  dailyCapSeconds: 600,
  uebungsModus: 'alle',
};

const wort = (id: string, text: string): ServerWort => ({
  id,
  kidId: 'k1',
  wort: text,
  artikel: 'der',
  wortart: null,
  silben: [text],
  merkstellen: [],
  status: 'neu',
  fach: 1,
  faelligAm: 0,
  quelle: null,
  notiz: null,
  createdAt: 0,
  updatedAt: 0,
});

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

interface Aufruf {
  url: string;
  method: string;
  body: unknown;
}

const WOERTER = [wort('w1', 'Sommer'), wort('w2', 'Haus')];

/** Fetch-Mock mit URL-Routing; sammelt alle Aufrufe (inkl. Body) für Assertions. */
function mockApi(heute: HeuteStand) {
  const aufrufe: Aufruf[] = [];
  const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    aufrufe.push({ url: u, method: init?.method ?? 'GET', body });
    if (u.includes('/auth/kid-me')) return Promise.resolve(jsonResponse(profil));
    if (u.includes('/practice/today')) return Promise.resolve(jsonResponse(heute));
    if (u.includes('/practice/due')) return Promise.resolve(jsonResponse(WOERTER));
    // Ganze Kartei (für Quiz + Startkarten-Anzahlen, #18).
    if (u.includes('/words')) return Promise.resolve(jsonResponse(WOERTER));
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return aufrufe;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '/api');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('SchuelerApp — Übungswahl durch das Kind (#18)', () => {
  it('zeigt nach dem Login drei wählbare Übungen und startet die gewählte', async () => {
    mockApi({ secondsToday: 0, goalSeconds: 300, goalMet: false, capSeconds: 600, capMet: false, sessionsToday: 0 });

    render(<SchuelerApp />);
    // Alle drei Übungen stehen zur Wahl.
    expect(await screen.findByRole('button', { name: /Wörter schreiben/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Groß & klein/ })).toBeTruthy();
    const quizBtn = screen.getByRole('button', { name: /Quiz/ });

    act(() => {
      quizBtn.click();
    });
    // Quiz-Karte läuft (Groß/klein-Frage) — nicht die Schreibkarte.
    expect(screen.getByText('Schreibt man dieses Wort groß oder klein?')).toBeTruthy();
    expect(screen.queryByText('Abdecken')).toBeNull();
  });

  it('stoppt die Übung hart erst an der Tagesobergrenze', async () => {
    // Ziel längst erreicht (100 s), aber 297/300 s bis zur Grenze → ~3 s Rest.
    const aufrufe = mockApi({ secondsToday: 297, goalSeconds: 100, goalMet: true, capSeconds: 300, capMet: false, sessionsToday: 1 });

    render(<SchuelerApp />);
    const startButton = await screen.findByRole('button', { name: /Wörter schreiben/ });

    vi.useFakeTimers();
    act(() => {
      startButton.click();
    });
    expect(screen.getByText('Abdecken')).toBeTruthy(); // Runde läuft

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    vi.useRealTimers();

    expect(await screen.findByText(/geschafft|Gut gemacht/)).toBeTruthy(); // Fertigkarte
    expect(screen.queryByText('Abdecken')).toBeNull();

    // #17: Das beim Hard-Stop angefangene, nie bewertete Wort schreibt seine
    // aktive Zeit als reines Zeit-Ereignis gut (sonst bliebe der Tagesstand
    // hinter dem Countdown zurück und „noch bis zum Ziel" spränge wieder hoch).
    const praxisPosts = aufrufe.filter((a) => a.method === 'POST' && a.url.includes('/practice'));
    expect(praxisPosts).toHaveLength(1);
    const events = (praxisPosts[0]?.body as { events: Array<Record<string, unknown>> }).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ nurZeit: true, correct: false });
    expect(events[0]?.durationMs as number).toBeGreaterThanOrEqual(3000);
  });

  it('läuft bei erreichtem Ziel als Bonus bis zur Grenze weiter (Badge statt Hard-Stop)', async () => {
    // Ziel erreicht (goalMet), aber weit unter der Grenze (400/600).
    mockApi({ secondsToday: 400, goalSeconds: 300, goalMet: true, capSeconds: 600, capMet: false, sessionsToday: 2 });

    render(<SchuelerApp />);
    const startButton = await screen.findByRole('button', { name: /Wörter schreiben/ });

    vi.useFakeTimers();
    act(() => {
      startButton.click();
    });
    expect(screen.getByText('✓ Ziel geschafft')).toBeTruthy(); // Badge statt ⏱

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    vi.useRealTimers();

    // Noch unter der Grenze → Runde läuft weiter, keine Fertigkarte.
    expect(screen.queryByText('Gut gemacht!')).toBeNull();
    expect(screen.getByText('Abdecken')).toBeTruthy();
  });

  it('blockt den Start, wenn die Tagesobergrenze schon erreicht ist', async () => {
    mockApi({ secondsToday: 600, goalSeconds: 300, goalMet: true, capSeconds: 600, capMet: true, sessionsToday: 3 });

    render(<SchuelerApp />);
    expect(await screen.findByText(/genug geübt/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Wörter schreiben/ })).toBeNull();
  });
});
