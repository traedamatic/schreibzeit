// Sync-Engine: Outbox-Abarbeitung, Server→Client-Mapping und der
// server-autoritative Pull-Merge (inkl. Erhalt lokaler Felder wie klasseId).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import {
  enqueueOp,
  mapServerKind,
  mapServerWort,
  verarbeiteOutbox,
  zieheServerdaten,
  zuServerPatch,
} from '@/services/serverSync';
import type { ServerKind, ServerWort } from '@/services/api';
import type { Kind } from '@/types';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const serverKind = (patch: Partial<ServerKind> = {}): ServerKind => ({
  id: 'k1',
  name: 'Lina',
  lernstand: 'klasse2',
  notiz: null,
  dailyGoalSeconds: 300,
  uebungsModus: 'alle',
  createdAt: 1000,
  updatedAt: 2000,
  ...patch,
});

const serverWort = (patch: Partial<ServerWort> = {}): ServerWort => ({
  id: 'w1',
  kidId: 'k1',
  wort: 'Sommer',
  artikel: 'der',
  wortart: null,
  silben: ['Som', 'mer'],
  merkstellen: [2],
  status: 'neu',
  fach: 1,
  faelligAm: 1000,
  quelle: null,
  notiz: null,
  createdAt: 1000,
  updatedAt: 2000,
  ...patch,
});

beforeEach(async () => {
  await Promise.all([
    db.kinder.clear(),
    db.lernwoerter.clear(),
    db.uebungstexte.clear(),
    db.outbox.clear(),
  ]);
  vi.restoreAllMocks();
});

describe('mapping', () => {
  it('mapServerKind übernimmt die lokale klasseId', () => {
    const lokal: Kind = {
      id: 'k1',
      name: 'Alt',
      klasseId: 'klasse-x',
      lernstand: 'klasse1',
      erstelltAm: 1,
      geaendertAm: 1,
    };
    const gemappt = mapServerKind(serverKind({ name: 'Neu' }), lokal);
    expect(gemappt.name).toBe('Neu');
    expect(gemappt.klasseId).toBe('klasse-x');
  });

  it('mapServerWort wandelt null-Felder in undefined/Leerwert', () => {
    const w = mapServerWort(serverWort({ artikel: null, faelligAm: null }));
    expect(w.artikel).toBe('');
    expect(w.faelligAm).toBeUndefined();
    expect(w.kindId).toBe('k1');
  });

  it('zuServerPatch lässt SRS-Felder weg (Server ist autoritativ)', () => {
    const patch = zuServerPatch({ wort: 'Haus', fach: 4, faelligAm: 99, status: 'sitzt' });
    expect(patch).toEqual({ wort: 'Haus', status: 'sitzt' });
  });
});

describe('verarbeiteOutbox', () => {
  it('spielt Ops in Reihenfolge ab und leert die Outbox', async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ ok: true })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await enqueueOp({ typ: 'kind.delete', id: 'k1' });
    await enqueueOp({ typ: 'wort.delete', ids: ['w1', 'w2'] });

    const leer = await verarbeiteOutbox();
    expect(leer).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('/kids/k1');
    expect(urls[1]).toContain('/words/bulk-delete');
  });

  it('bricht bei Netzwerkfehler ab und behält die Ops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await enqueueOp({ typ: 'kind.delete', id: 'k1' });

    const leer = await verarbeiteOutbox();
    expect(leer).toBe(false);
    expect(await db.outbox.count()).toBe(1);
  });

  it('verwirft dauerhaft abgelehnte Ops (400) und macht weiter', async () => {
    let aufruf = 0;
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        aufruf++ === 0 ? jsonResponse({ error: 'kaputt' }, 400) : jsonResponse({ ok: true }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await enqueueOp({ typ: 'kind.delete', id: 'ungueltig' });
    await enqueueOp({ typ: 'kind.delete', id: 'k2' });

    const leer = await verarbeiteOutbox();
    expect(leer).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('wertet 404 bei Lösch-Ops als Erfolg', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ error: 'weg' }, 404))));
    await enqueueOp({ typ: 'kind.delete', id: 'schon-geloescht' });

    const leer = await verarbeiteOutbox();
    expect(leer).toBe(true);
    expect(await db.outbox.count()).toBe(0);
  });

  it('bricht bei 401 ab, behält Ops und meldet die Abmeldung', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ error: 'auth' }, 401))));
    await enqueueOp({ typ: 'kind.delete', id: 'k1' });

    const leer = await verarbeiteOutbox();
    expect(leer).toBe(false);
    expect(await db.outbox.count()).toBe(1);
    const { useSyncStore } = await import('@/services/serverSync');
    expect(useSyncStore.getState().angemeldet).toBe(false);
  });
});

describe('zieheServerdaten (Pull-Merge)', () => {
  it('ersetzt per id, erhält klasseId und entfernt server-seitig gelöschte Kinder samt Kaskade', async () => {
    // Lokaler Stand: Kind A (mit Klasse) + Kind B (remote gelöscht) mit Daten.
    await db.kinder.bulkPut([
      { id: 'k1', name: 'Alt', klasseId: 'klasse-x', lernstand: 'klasse1', erstelltAm: 1, geaendertAm: 1 },
      { id: 'k2', name: 'Weg', lernstand: 'klasse2', erstelltAm: 1, geaendertAm: 1 },
    ]);
    await db.lernwoerter.bulkPut([
      mapServerWort(serverWort({ id: 'w1', kidId: 'k1' })),
      mapServerWort(serverWort({ id: 'w2', kidId: 'k2' })),
      mapServerWort(serverWort({ id: 'w3', kidId: 'k1', wort: 'RemoteGelöscht' })),
    ]);
    await db.uebungstexte.put({
      id: 'u1', kindId: 'k2', titel: 'T', textart: 'geschichte', text: '',
      verwendeteWoerter: [], erstelltAm: 1, geaendertAm: 1,
    });

    // Server kennt nur noch k1 mit w1.
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/kids')) return Promise.resolve(jsonResponse([serverKind({ name: 'Neu' })]));
      if (u.includes('/words')) return Promise.resolve(jsonResponse([serverWort({ id: 'w1' })]));
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500));
    });
    vi.stubGlobal('fetch', fetchMock);

    await zieheServerdaten();

    const kinder = await db.kinder.toArray();
    expect(kinder.map((k) => k.id)).toEqual(['k1']);
    expect(kinder[0]?.name).toBe('Neu');
    expect(kinder[0]?.klasseId).toBe('klasse-x');

    const woerter = await db.lernwoerter.toArray();
    expect(woerter.map((w) => w.id)).toEqual(['w1']);
    expect(await db.uebungstexte.count()).toBe(0);
  });
});
