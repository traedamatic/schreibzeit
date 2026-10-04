// Persistenz-Abstraktion. Die gesamte App spricht nur dieses Interface an.
//
// Zwei Implementierungen:
//   - DexieRepository  — rein lokal (IndexedDB), das bisherige Verhalten
//   - RemoteRepository — offline-first mit Sync zum Familien-Server
// Die Auswahl erfolgt zur Laufzeit: ist `VITE_API_URL` gesetzt, wird gegen den
// Server synchronisiert, sonst bleibt alles lokal wie gehabt.

import { istRemoteAktiv } from '@/services/api';
import { DexieRepository } from './dexieRepository';
import { RemoteRepository } from './remoteRepository';
import type {
  Einstellungen,
  Id,
  Kind,
  Klasse,
  Lernwort,
  Uebungstext,
} from '@/types';

// Re-Export für bestehende Importe (hooks.ts u. a.).
export { DEFAULT_EINSTELLUNGEN } from './defaults';
export { DexieRepository } from './dexieRepository';

export interface Repository {
  // Klassen
  getKlassen(): Promise<Klasse[]>;
  saveKlasse(input: Partial<Klasse> & { name: string }): Promise<Klasse>;
  deleteKlasse(id: Id): Promise<void>;

  // Kinder
  getKinder(): Promise<Kind[]>;
  saveKind(input: Partial<Kind> & { name: string }): Promise<Kind>;
  deleteKind(id: Id): Promise<void>;

  // Lernwörter
  getLernwoerter(kindId: Id): Promise<Lernwort[]>;
  addLernwort(kindId: Id, wort: string, extra?: Partial<Lernwort>): Promise<Lernwort>;
  updateLernwort(id: Id, patch: Partial<Lernwort>): Promise<void>;
  deleteLernwort(id: Id): Promise<void>;
  deleteLernwoerter(ids: Id[]): Promise<void>;

  // Übungstexte
  getUebungstexte(kindId: Id): Promise<Uebungstext[]>;
  saveUebungstext(input: Partial<Uebungstext> & { kindId: Id; titel: string }): Promise<Uebungstext>;
  deleteUebungstext(id: Id): Promise<void>;

  // Einstellungen
  getEinstellungen(): Promise<Einstellungen>;
  saveEinstellungen(patch: Partial<Einstellungen>): Promise<Einstellungen>;

  // Wartung
  clearAll(): Promise<void>;
}

/** Singleton-Repository — Auswahl je nach Konfiguration (siehe oben). */
export const repository: Repository = istRemoteAktiv()
  ? new RemoteRepository()
  : new DexieRepository();
