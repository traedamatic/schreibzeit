// @vitest-environment jsdom
// Auth-Gate der Eltern-App (#12): Bei bestätigter Abmeldung im Server-Betrieb
// werden keine (gecachten) Kinderdaten gezeigt — nur die Anmeldung. Ein
// unbekannter Status (offline) bleibt offline-first nutzbar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import App from '@/App';
import { useSyncStore } from '@/services/serverSync';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '/api');
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse([]))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('App Auth-Gate (#12)', () => {
  it('abgemeldet (401 bestätigt): zeigt nur die Anmeldung, keine App-Inhalte', async () => {
    useSyncStore.setState({ aktiv: true, angemeldet: false });
    render(<App />);

    expect(await screen.findByText('Familien-Server')).toBeTruthy();
    expect(screen.getByPlaceholderText('E-Mail')).toBeTruthy();
    // Keine App-Oberfläche: weder Willkommens-Karte noch Kinder-Sidebar.
    expect(screen.queryByText('Willkommen bei Schreibzeit')).toBeNull();
    expect(screen.queryByText('Zur Kinderliste')).toBeNull();
  });

  it('Status unbekannt (offline): App bleibt mit Cache nutzbar', async () => {
    useSyncStore.setState({ aktiv: true, angemeldet: null });
    render(<App />);

    expect(await screen.findByText('Willkommen bei Schreibzeit')).toBeTruthy();
    expect(screen.queryByPlaceholderText('E-Mail')).toBeNull();
  });

  it('angemeldet: App normal, kein Anmelde-Banner', async () => {
    useSyncStore.setState({ aktiv: true, angemeldet: true, adminEmail: 'a@b.de' });
    render(<App />);

    expect(await screen.findByText('Willkommen bei Schreibzeit')).toBeTruthy();
    expect(screen.queryByText('Familien-Server')).toBeNull();
  });
});
