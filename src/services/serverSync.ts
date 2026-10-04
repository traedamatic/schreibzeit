// Sync-Engine für den Familien-Server.
//
// Prinzip: Dexie bleibt der reaktive Cache der UI (Live-Queries). Schreibzu-
// griffe landen sofort lokal UND als Op in der Outbox; die Outbox wird bei
// nächster Gelegenheit sequenziell zum Server gespielt (offline-fähig, durch
// client-seitige IDs idempotent). Danach zieht ein Pull den Server-Stand und
// merged ihn server-autoritativ in Dexie — lokale Zusatzfelder, die der Server
// nicht kennt (z. B. `klasseId`), bleiben dabei erhalten.
import { create } from 'zustand';
import { db } from '@/db/db';
import type { Kind, Lernwort, SyncOp } from '@/types';
import {
  ApiError,
  adminApi,
  istRemoteAktiv,
  kidsApi,
  wortApi,
  type ServerKind,
  type ServerWort,
  type WortServerPatch,
} from './api';
import { now } from '@/core/id';

// ---------------------------------------------------------------------------
// Sync-Status (für die UI: Anmelde-Banner, Status-Chip)
// ---------------------------------------------------------------------------

export interface SyncState {
  /** Remote-Betrieb konfiguriert (VITE_API_URL gesetzt)? */
  aktiv: boolean;
  /** null = noch unbekannt (Prüfung läuft), sonst Anmeldestatus. */
  angemeldet: boolean | null;
  adminEmail: string | null;
  laeuft: boolean;
  fehler: string | null;
  letzterSync: number | null;
  setAngemeldet: (angemeldet: boolean, email?: string | null) => void;
  setLaeuft: (laeuft: boolean) => void;
  setFehler: (fehler: string | null) => void;
  setLetzterSync: (ts: number) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  aktiv: istRemoteAktiv(),
  angemeldet: null,
  adminEmail: null,
  laeuft: false,
  fehler: null,
  letzterSync: null,
  setAngemeldet: (angemeldet, email = null) =>
    set({ angemeldet, adminEmail: email, fehler: null }),
  setLaeuft: (laeuft) => set({ laeuft }),
  setFehler: (fehler) => set({ fehler }),
  setLetzterSync: (ts) => set({ letzterSync: ts }),
}));

// ---------------------------------------------------------------------------
// Mapping Server ⇄ Client
// ---------------------------------------------------------------------------

/** Server-Kind → lokales `Kind`; lokale Felder (klasseId) werden übernommen. */
export function mapServerKind(s: ServerKind, lokal?: Kind): Kind {
  return {
    id: s.id,
    name: s.name,
    klasseId: lokal?.klasseId,
    lernstand: s.lernstand,
    notiz: s.notiz ?? undefined,
    erstelltAm: s.createdAt,
    geaendertAm: s.updatedAt,
  };
}

export function mapServerWort(s: ServerWort): Lernwort {
  return {
    id: s.id,
    kindId: s.kidId,
    wort: s.wort,
    artikel: (s.artikel ?? '') as Lernwort['artikel'],
    wortart: s.wortart ?? undefined,
    silben: s.silben,
    merkstellen: s.merkstellen,
    status: s.status,
    fach: s.fach,
    faelligAm: s.faelligAm ?? undefined,
    quelle: s.quelle ?? undefined,
    notiz: s.notiz ?? undefined,
    erstelltAm: s.createdAt,
    geaendertAm: s.updatedAt,
  };
}

/** Lernwort-Patch auf die vom Server verwalteten Felder einschränken. */
export function zuServerPatch(patch: Partial<Lernwort>): WortServerPatch {
  const out: WortServerPatch = {};
  if (patch.wort !== undefined) out.wort = patch.wort;
  if (patch.artikel !== undefined) out.artikel = patch.artikel;
  if (patch.wortart !== undefined) out.wortart = patch.wortart;
  if (patch.silben !== undefined) out.silben = patch.silben;
  if (patch.merkstellen !== undefined) out.merkstellen = patch.merkstellen;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.quelle !== undefined) out.quelle = patch.quelle;
  if (patch.notiz !== undefined) out.notiz = patch.notiz;
  return out;
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export async function enqueueOp(op: SyncOp): Promise<void> {
  await db.outbox.add({ op, erstelltAm: now() });
}

async function sendeOp(op: SyncOp): Promise<void> {
  switch (op.typ) {
    case 'kind.create':
      await kidsApi.create({
        id: op.kind.id,
        name: op.kind.name,
        lernstand: op.kind.lernstand,
        notiz: op.kind.notiz,
      });
      return;
    case 'kind.update':
      await kidsApi.update(op.kind.id, {
        name: op.kind.name,
        lernstand: op.kind.lernstand,
        notiz: op.kind.notiz ?? null,
      });
      return;
    case 'kind.delete':
      await kidsApi.remove(op.id);
      return;
    case 'wort.create':
      await wortApi.create(op.wort.kindId, {
        id: op.wort.id,
        wort: op.wort.wort,
        ...zuServerPatch(op.wort),
      });
      return;
    case 'wort.update':
      await wortApi.update(op.id, zuServerPatch(op.patch));
      return;
    case 'wort.delete':
      await wortApi.bulkDelete(op.ids);
      return;
  }
}

let outboxLaeuft = false;

/**
 * Outbox sequenziell abarbeiten. Gibt true zurück, wenn sie danach leer ist.
 * - Netzwerk-/Serverfehler (status 0/5xx): abbrechen, Ops behalten (Retry später)
 * - 401: abbrechen, Ops behalten, Anmelde-Banner zeigen
 * - 404 bei Lösch-Ops: Ziel existiert nicht mehr → als Erfolg werten
 * - übrige 4xx: Op ist dauerhaft ungültig → verwerfen (mit Warnung)
 */
export async function verarbeiteOutbox(): Promise<boolean> {
  if (outboxLaeuft) return false;
  outboxLaeuft = true;
  try {
    const eintraege = await db.outbox.orderBy('seq').toArray();
    for (const eintrag of eintraege) {
      try {
        await sendeOp(eintrag.op);
        await db.outbox.delete(eintrag.seq as number);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.status === 401) {
          useSyncStore.getState().setAngemeldet(false);
          return false;
        }
        if (error.status === 0 || error.status >= 500) return false;
        const istLoeschOp = eintrag.op.typ === 'kind.delete' || eintrag.op.typ === 'wort.delete';
        if (error.status === 404 && istLoeschOp) {
          await db.outbox.delete(eintrag.seq as number);
          continue;
        }
        console.warn('Sync: Vorgang dauerhaft abgelehnt und verworfen:', eintrag.op.typ, error.message);
        await db.outbox.delete(eintrag.seq as number);
      }
    }
    return (await db.outbox.count()) === 0;
  } finally {
    outboxLaeuft = false;
  }
}

// ---------------------------------------------------------------------------
// Pull (server-autoritativ)
// ---------------------------------------------------------------------------

/**
 * Server-Stand nach Dexie übernehmen. Ersetzt Kinder + Lernwörter per id;
 * lokal vorhandene Zeilen, die der Server nicht (mehr) kennt, werden entfernt
 * (inkl. Kaskade auf Lernwörter/Übungstexte gelöschter Kinder). Lokale
 * Zusatzfelder wie `klasseId` bleiben erhalten.
 */
export async function zieheServerdaten(): Promise<void> {
  const serverKinder = await kidsApi.list();
  const woerterProKind = await Promise.all(serverKinder.map((k) => wortApi.list(k.id)));
  const serverWoerter = woerterProKind.flat();

  await db.transaction('rw', [db.kinder, db.lernwoerter, db.uebungstexte], async () => {
    const lokaleKinder = new Map((await db.kinder.toArray()).map((k) => [k.id, k]));
    const serverKindIds = new Set(serverKinder.map((k) => k.id));

    await db.kinder.bulkPut(serverKinder.map((s) => mapServerKind(s, lokaleKinder.get(s.id))));
    for (const lokal of lokaleKinder.values()) {
      if (serverKindIds.has(lokal.id)) continue;
      await db.kinder.delete(lokal.id);
      await db.lernwoerter.where('kindId').equals(lokal.id).delete();
      await db.uebungstexte.where('kindId').equals(lokal.id).delete();
    }

    const serverWortIds = new Set(serverWoerter.map((w) => w.id));
    await db.lernwoerter.bulkPut(serverWoerter.map(mapServerWort));
    const verwaiste = (await db.lernwoerter.toArray()).filter((w) => !serverWortIds.has(w.id));
    await db.lernwoerter.bulkDelete(verwaiste.map((w) => w.id));
  });
}

// ---------------------------------------------------------------------------
// Orchestrierung
// ---------------------------------------------------------------------------

/** Outbox abspielen und — wenn vollständig — den Server-Stand ziehen. */
export async function vollSync(): Promise<void> {
  const store = useSyncStore.getState();
  if (!istRemoteAktiv() || store.laeuft) return;
  store.setLaeuft(true);
  try {
    const leer = await verarbeiteOutbox();
    if (leer && useSyncStore.getState().angemeldet !== false) {
      await zieheServerdaten();
      store.setLetzterSync(now());
      store.setFehler(null);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      store.setAngemeldet(false);
    } else {
      store.setFehler(error instanceof Error ? error.message : String(error));
    }
  } finally {
    store.setLaeuft(false);
  }
}

/** Nach einem lokalen Schreibvorgang den Sync anstoßen (fire-and-forget). */
export function stosseSyncAn(): void {
  if (!istRemoteAktiv()) return;
  void vollSync();
}

/**
 * Einmalig beim App-Start aufrufen: Anmeldestatus prüfen, initial
 * synchronisieren und bei Rückkehr der Verbindung erneut versuchen.
 */
export async function starteSync(): Promise<void> {
  if (!istRemoteAktiv()) return;
  const store = useSyncStore.getState();
  try {
    const me = await adminApi.me();
    store.setAngemeldet(true, me.email);
    await vollSync();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      store.setAngemeldet(false);
    } else {
      store.setFehler('Server nicht erreichbar – arbeite offline weiter.');
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void vollSync());
  }
}
