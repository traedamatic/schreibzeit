// Server-synchronisierte Repository-Implementierung (offline-first).
//
// Schreibvorgänge laufen zuerst lokal über das innere DexieRepository (die UI
// aktualisiert sich sofort über Live-Queries) und werden zusätzlich als Op in
// die Outbox gestellt. Der Sync spielt die Outbox zum Server und zieht danach
// den server-autoritativen Stand zurück nach Dexie.
//
// Nur Kinder + Lernwörter werden synchronisiert. Klassen, Übungstexte und
// Einstellungen bleiben bewusst geräte-lokal (Klassen sind ein Lehrer-Konzept,
// Einstellungen enthalten API-Schlüssel des jeweiligen Geräts).
import { DexieRepository } from './dexieRepository';
import { enqueueOp, stosseSyncAn } from '@/services/serverSync';
import type { Repository } from './repository';
import type {
  Einstellungen,
  Id,
  Kind,
  Klasse,
  Lernwort,
  Uebungstext,
} from '@/types';

export class RemoteRepository implements Repository {
  private readonly lokal = new DexieRepository();

  // --- synchronisiert: Kinder -------------------------------------------

  getKinder(): Promise<Kind[]> {
    return this.lokal.getKinder();
  }

  async saveKind(input: Partial<Kind> & { name: string }): Promise<Kind> {
    const istUpdate = Boolean(input.id);
    const kind = await this.lokal.saveKind(input);
    await enqueueOp(istUpdate ? { typ: 'kind.update', kind } : { typ: 'kind.create', kind });
    stosseSyncAn();
    return kind;
  }

  async deleteKind(id: Id): Promise<void> {
    await this.lokal.deleteKind(id);
    await enqueueOp({ typ: 'kind.delete', id });
    stosseSyncAn();
  }

  // --- synchronisiert: Lernwörter ----------------------------------------

  getLernwoerter(kindId: Id): Promise<Lernwort[]> {
    return this.lokal.getLernwoerter(kindId);
  }

  async addLernwort(kindId: Id, wort: string, extra?: Partial<Lernwort>): Promise<Lernwort> {
    const lernwort = await this.lokal.addLernwort(kindId, wort, extra);
    await enqueueOp({ typ: 'wort.create', wort: lernwort });
    stosseSyncAn();
    return lernwort;
  }

  async updateLernwort(id: Id, patch: Partial<Lernwort>): Promise<void> {
    await this.lokal.updateLernwort(id, patch);
    await enqueueOp({ typ: 'wort.update', id, patch });
    stosseSyncAn();
  }

  async deleteLernwort(id: Id): Promise<void> {
    await this.lokal.deleteLernwort(id);
    await enqueueOp({ typ: 'wort.delete', ids: [id] });
    stosseSyncAn();
  }

  async deleteLernwoerter(ids: Id[]): Promise<void> {
    await this.lokal.deleteLernwoerter(ids);
    await enqueueOp({ typ: 'wort.delete', ids });
    stosseSyncAn();
  }

  // --- geräte-lokal (nicht synchronisiert) --------------------------------

  getKlassen(): Promise<Klasse[]> {
    return this.lokal.getKlassen();
  }
  saveKlasse(input: Partial<Klasse> & { name: string }): Promise<Klasse> {
    return this.lokal.saveKlasse(input);
  }
  deleteKlasse(id: Id): Promise<void> {
    return this.lokal.deleteKlasse(id);
  }
  getUebungstexte(kindId: Id): Promise<Uebungstext[]> {
    return this.lokal.getUebungstexte(kindId);
  }
  saveUebungstext(input: Partial<Uebungstext> & { kindId: Id; titel: string }): Promise<Uebungstext> {
    return this.lokal.saveUebungstext(input);
  }
  deleteUebungstext(id: Id): Promise<void> {
    return this.lokal.deleteUebungstext(id);
  }
  getEinstellungen(): Promise<Einstellungen> {
    return this.lokal.getEinstellungen();
  }
  saveEinstellungen(patch: Partial<Einstellungen>): Promise<Einstellungen> {
    return this.lokal.saveEinstellungen(patch);
  }
  clearAll(): Promise<void> {
    return this.lokal.clearAll();
  }
}
