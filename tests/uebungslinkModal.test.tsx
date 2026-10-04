// @vitest-environment jsdom
// Übungslink-Modal: Übungsmodus-Auswahl (#15) — lädt den aktuellen Modus vom
// Server und speichert Änderungen per PUT.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UebungslinkModal } from '@/components/UebungslinkModal';
import { DEFAULT_EINSTELLUNGEN } from '@/db/repository';
import type { Kind } from '@/types';

const kind: Kind = {
  id: 'k1',
  name: 'Lina',
  lernstand: 'klasse2',
  erstelltAm: 0,
  geaendertAm: 0,
};

const serverKind = (uebungsModus: string) => ({
  id: 'k1',
  name: 'Lina',
  lernstand: 'klasse2',
  notiz: null,
  dailyGoalSeconds: 300,
  uebungsModus,
  createdAt: 0,
  updatedAt: 0,
});

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '/api');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('UebungslinkModal Übungsmodus (#15)', () => {
  it('lädt den aktuellen Modus und speichert eine Änderung per PUT', async () => {
    const aufrufe: { url: string; method: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        aufrufe.push({
          url: String(url),
          method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (method === 'GET') return Promise.resolve(jsonResponse(serverKind('alle')));
        return Promise.resolve(jsonResponse(serverKind('nomen')));
      }),
    );

    render(
      <UebungslinkModal
        offen
        kind={kind}
        woerter={[]}
        einstellungen={DEFAULT_EINSTELLUNGEN}
        onClose={() => {}}
      />,
    );

    const select = (await screen.findByLabelText('Übungsmodus')) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(select.value).toBe('alle');

    fireEvent.change(select, { target: { value: 'nomen' } });

    await waitFor(() => {
      const put = aufrufe.find((a) => a.method === 'PUT' && a.url.includes('/kids/k1'));
      expect(put?.body).toEqual({ uebungsModus: 'nomen' });
    });
    expect(screen.getByText(/Nomen schreibt man groß/)).toBeTruthy();
  });

  it('ohne Server: erklärender Hinweis statt Formular', () => {
    vi.unstubAllEnvs(); // VITE_API_URL weg → lokaler Betrieb
    render(
      <UebungslinkModal
        offen
        kind={kind}
        woerter={[]}
        einstellungen={DEFAULT_EINSTELLUNGEN}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Familien-Server/)).toBeTruthy();
    expect(screen.queryByLabelText('Übungsmodus')).toBeNull();
  });
});
