// @vitest-environment jsdom
// SchuelerApp: Hard-Stop der Übung, sobald der Countdown 0:00 erreicht (#11),
// und die Bonusrunde (Ziel beim Start schon erreicht → kein Hard-Stop).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SchuelerApp } from '@/schueler/SchuelerApp';
import type { HeuteStand, ServerWort } from '@/services/api';

const profil = { id: 'k1', name: 'Lina', lernstand: 'klasse2', dailyGoalSeconds: 300 };

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

/** Fetch-Mock mit URL-Routing; sammelt alle Aufrufe für Assertions. */
function mockApi(heute: HeuteStand) {
  const aufrufe: { url: string; method: string }[] = [];
  const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    aufrufe.push({ url: u, method: init?.method ?? 'GET' });
    if (u.includes('/auth/kid-me')) return Promise.resolve(jsonResponse(profil));
    if (u.includes('/practice/today')) return Promise.resolve(jsonResponse(heute));
    if (u.includes('/practice/due'))
      return Promise.resolve(jsonResponse([wort('w1', 'Sommer'), wort('w2', 'Haus')]));
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

describe('SchuelerApp Hard-Stop (#11)', () => {
  it('beendet die Runde automatisch, wenn der Countdown 0 erreicht — ohne Interaktion', async () => {
    // 297/300 s: nach ~3 s aktiver Zeit ist das Ziel erreicht.
    const aufrufe = mockApi({ secondsToday: 297, goalSeconds: 300, goalMet: false, sessionsToday: 1 });

    render(<SchuelerApp />);
    const startButton = await screen.findByText('▶ Üben starten');

    // Fake-Timer VOR dem Start aktivieren, damit Intervall + Stoppuhr darauf laufen.
    vi.useFakeTimers();
    act(() => {
      startButton.click();
    });
    expect(screen.getByText('Abdecken')).toBeTruthy(); // Runde läuft, Phase anschauen

    // 5 s verstreichen — kein Tippen. Der Tick muss die Runde hart beenden.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    vi.useRealTimers();

    expect(await screen.findByText('Gut gemacht!')).toBeTruthy(); // Fertigkarte
    expect(screen.queryByText('Abdecken')).toBeNull();

    // Das angefangene, nie bewertete Wort erzeugt kein Event → kein Practice-POST.
    const praxisPosts = aufrufe.filter((a) => a.method === 'POST' && a.url.includes('/practice'));
    expect(praxisPosts).toHaveLength(0);
  });

  it('Bonusrunde: Ziel beim Start schon erreicht → kein Hard-Stop, Badge statt Countdown', async () => {
    mockApi({ secondsToday: 400, goalSeconds: 300, goalMet: true, sessionsToday: 2 });

    render(<SchuelerApp />);
    const startButton = await screen.findByText('▶ Üben starten');

    vi.useFakeTimers();
    act(() => {
      startButton.click();
    });
    expect(screen.getByText('✓ Ziel geschafft')).toBeTruthy(); // Badge statt ⏱

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    vi.useRealTimers();

    // Runde läuft weiter — keine Fertigkarte, Übungskarte noch da.
    expect(screen.queryByText('Gut gemacht!')).toBeNull();
    expect(screen.getByText('Abdecken')).toBeTruthy();
  });
});
