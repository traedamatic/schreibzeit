// @vitest-environment jsdom
// DashboardView: Familien-Überblick mit gemockter Stats-API.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { DashboardView } from '@/views/DashboardView';
import { formatDatum, formatMinuten } from '@/views/dashboardFormat';
import { DEFAULT_EINSTELLUNGEN } from '@/db/repository';
import type { KidUebersicht } from '@/services/api';

const zeile = (
  patch: Partial<Omit<KidUebersicht, 'kid'>> & { kid?: Partial<KidUebersicht['kid']> },
): KidUebersicht => ({
  kid: {
    id: 'k1',
    name: 'Lina Muster',
    lernstand: 'klasse2',
    dailyGoalSeconds: 300,
    ...patch.kid,
  },
  today: patch.today ?? { secondsPracticed: 310, goalMet: true },
  streak: patch.streak ?? 3,
  week: patch.week ?? { secondsPracticed: 1200, daysGoalMet: 4 },
  dueCount: patch.dueCount ?? 5,
  masteryPct: patch.masteryPct ?? 40,
  weakWordsCount: patch.weakWordsCount ?? 2,
  lastPracticedAt: patch.lastPracticedAt ?? 1_700_000_000_000,
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Format-Helfer', () => {
  it('formatMinuten rundet auf Minuten, darunter M:SS', () => {
    expect(formatMinuten(1200)).toBe('20 min');
    expect(formatMinuten(45)).toBe('0:45');
  });
  it('formatDatum zeigt — ohne Zeitstempel', () => {
    expect(formatDatum(null)).toBe('—');
  });
});

describe('DashboardView', () => {
  it('zeigt die Schlagzeile und eine KPI-Zeile pro Kind', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse([
            zeile({}),
            zeile({ kid: { id: 'k2', name: 'Max Muster' }, today: { secondsPracticed: 60, goalMet: false } }),
          ]),
        ),
      ),
    );

    render(<DashboardView einstellungen={DEFAULT_EINSTELLUNGEN} />);

    await waitFor(() => {
      expect(screen.getByText(/1 von 2/)).toBeTruthy();
    });
    expect(screen.getByText('Lina Muster')).toBeTruthy();
    expect(screen.getByText('Max Muster')).toBeTruthy();
    expect(screen.getByText(/5 min/)).toBeTruthy(); // 310 s heute
    expect(screen.getAllByText(/🔥 3/)).toHaveLength(2);
  });

  it('respektiert die „nur Initialen"-Einstellung', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse([zeile({})]))));

    render(<DashboardView einstellungen={{ ...DEFAULT_EINSTELLUNGEN, nurInitialen: true }} />);

    await waitFor(() => {
      expect(screen.getByText('L. M.')).toBeTruthy();
    });
    expect(screen.queryByText('Lina Muster')).toBeNull();
  });

  it('zeigt den Leerzustand ohne Kinder', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse([]))));
    render(<DashboardView einstellungen={DEFAULT_EINSTELLUNGEN} />);
    await waitFor(() => {
      expect(screen.getByText('Noch keine Kinder')).toBeTruthy();
    });
  });

  it('zeigt eine Fehlermeldung mit Retry, wenn der Server nicht erreichbar ist', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    render(<DashboardView einstellungen={DEFAULT_EINSTELLUNGEN} />);
    await waitFor(() => {
      expect(screen.getByText('Dashboard nicht verfügbar')).toBeTruthy();
    });
    expect(screen.getByText('Erneut versuchen')).toBeTruthy();
  });
});
