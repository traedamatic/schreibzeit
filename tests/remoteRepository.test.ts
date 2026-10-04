// RemoteRepository: Schreibvorgänge landen sofort lokal (Dexie) und als Op in
// der Outbox; offline Geschriebenes wird beim nächsten Drain nachgespielt.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { RemoteRepository } from '@/db/remoteRepository';
import { verarbeiteOutbox } from '@/services/serverSync';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(async () => {
  await Promise.all([
    db.kinder.clear(),
    db.lernwoerter.clear(),
    db.uebungstexte.clear(),
    db.outbox.clear(),
  ]);
  vi.restoreAllMocks();
  // Standard: offline — jeder Netzwerkversuch schlägt fehl.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
});

describe('RemoteRepository (offline-first)', () => {
  it('saveKind schreibt lokal und stellt einen kind.create-Op in die Outbox', async () => {
    const repo = new RemoteRepository();
    const kind = await repo.saveKind({ name: 'Lina', lernstand: 'klasse2' });

    expect(await db.kinder.get(kind.id)).toBeTruthy();
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.op.typ).toBe('kind.create');
  });

  it('addLernwort + updateLernwort queuen Ops; der Update-Patch bleibt erhalten', async () => {
    const repo = new RemoteRepository();
    const kind = await repo.saveKind({ name: 'Lina', lernstand: 'klasse2' });
    const wort = await repo.addLernwort(kind.id, 'Sommer');
    await repo.updateLernwort(wort.id, { status: 'sitzt', fach: 5 });

    const ops = await db.outbox.toArray();
    expect(ops.map((o) => o.op.typ)).toEqual(['kind.create', 'wort.create', 'wort.update']);
    const update = ops[2]?.op;
    if (update?.typ !== 'wort.update') throw new Error('erwartete wort.update');
    expect(update.patch.status).toBe('sitzt');
  });

  it('offline Geschriebenes wird beim Drain nachgespielt (Outbox leer, ids identisch)', async () => {
    const repo = new RemoteRepository();
    const kind = await repo.saveKind({ name: 'Lina', lernstand: 'klasse2' });
    const wort = await repo.addLernwort(kind.id, 'Sommer');
    expect(await db.outbox.count()).toBe(2);

    // Verbindung kommt zurück — Server akzeptiert alles.
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ ok: true })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const leer = await verarbeiteOutbox();
    expect(leer).toBe(true);
    expect(await db.outbox.count()).toBe(0);

    // Die Replays tragen die client-seitig vergebenen ids (Idempotenz).
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies[0]?.id).toBe(kind.id);
    expect(bodies[1]?.id).toBe(wort.id);
  });

  it('deleteKind entfernt lokal mit Kaskade und queued kind.delete', async () => {
    const repo = new RemoteRepository();
    const kind = await repo.saveKind({ name: 'Max', lernstand: 'klasse3' });
    await repo.addLernwort(kind.id, 'Baum');
    await repo.deleteKind(kind.id);

    expect(await db.kinder.count()).toBe(0);
    expect(await db.lernwoerter.count()).toBe(0);
    const typen = (await db.outbox.toArray()).map((o) => o.op.typ);
    expect(typen).toEqual(['kind.create', 'wort.create', 'kind.delete']);
  });
});
