// @vitest-environment jsdom
// Übungslink-Modal (#18): kein Übungsmodus-Selektor mehr (das Kind wählt die
// Übung selbst); stattdessen setzt der Admin Tagesziel + harte Obergrenze.
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

const serverKind = () => ({
  id: 'k1',
  name: 'Lina',
  lernstand: 'klasse2',
  notiz: null,
  dailyGoalSeconds: 300,
  dailyCapSeconds: 600,
  uebungsModus: 'alle',
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

describe('UebungslinkModal (#18)', () => {
  it('lädt Ziel + Grenze (in Minuten) und speichert Änderungen per PUT', async () => {
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
        return Promise.resolve(jsonResponse(serverKind()));
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

    // 300 s / 600 s → 5 / 10 Minuten vorbefüllt.
    const ziel = (await screen.findByLabelText('Ziel (min)')) as HTMLInputElement;
    const grenze = screen.getByLabelText('Grenze (min)') as HTMLInputElement;
    await waitFor(() => expect(ziel.value).toBe('5'));
    expect(grenze.value).toBe('10');

    fireEvent.change(ziel, { target: { value: '6' } });
    fireEvent.change(grenze, { target: { value: '12' } });
    fireEvent.click(screen.getByText('Speichern'));

    await waitFor(() => {
      const put = aufrufe.find((a) => a.method === 'PUT' && a.url.includes('/kids/k1'));
      expect(put?.body).toEqual({ dailyGoalSeconds: 360, dailyCapSeconds: 720 });
    });
  });

  it('kein Übungsmodus-Selektor mehr — das Kind wählt selbst', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(serverKind()))));
    render(
      <UebungslinkModal
        offen
        kind={kind}
        woerter={[]}
        einstellungen={DEFAULT_EINSTELLUNGEN}
        onClose={() => {}}
      />,
    );
    await screen.findByLabelText('Ziel (min)');
    expect(screen.queryByLabelText('Übungsmodus')).toBeNull();
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
