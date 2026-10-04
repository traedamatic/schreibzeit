// Lokale Repository-Implementierung über Dexie/IndexedDB (unverändert die
// Standard-Persistenz der App; im Remote-Betrieb dient sie als Cache-Schicht
// unter dem RemoteRepository).
import { db } from './db';
import { newId, now } from '@/core/id';
import { suggestMerkstellen } from '@/core/merkstellen';
import { splitSyllables } from '@/core/syllables';
import { DEFAULT_EINSTELLUNGEN } from './defaults';
import type { Repository } from './repository';
import type {
  Einstellungen,
  Id,
  Kind,
  Klasse,
  Lernwort,
  Uebungstext,
} from '@/types';

export class DexieRepository implements Repository {
  async getKlassen(): Promise<Klasse[]> {
    return (await db.klassen.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  async saveKlasse(input: Partial<Klasse> & { name: string }): Promise<Klasse> {
    const ts = now();
    if (input.id) {
      const existing = await db.klassen.get(input.id);
      const updated: Klasse = {
        ...(existing as Klasse),
        ...input,
        geaendertAm: ts,
      };
      await db.klassen.put(updated);
      return updated;
    }
    const klasse: Klasse = {
      id: newId(),
      name: input.name,
      notiz: input.notiz,
      erstelltAm: ts,
      geaendertAm: ts,
    };
    await db.klassen.put(klasse);
    return klasse;
  }

  async deleteKlasse(id: Id): Promise<void> {
    // Zugeordnete Kinder bleiben erhalten, verlieren aber die Klassenzuordnung.
    await db.transaction('rw', db.klassen, db.kinder, async () => {
      await db.klassen.delete(id);
      const kinder = await db.kinder.where('klasseId').equals(id).toArray();
      await Promise.all(
        kinder.map((k) => db.kinder.update(k.id, { klasseId: undefined, geaendertAm: now() })),
      );
    });
  }

  async getKinder(): Promise<Kind[]> {
    return (await db.kinder.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  async saveKind(input: Partial<Kind> & { name: string }): Promise<Kind> {
    const ts = now();
    if (input.id) {
      const existing = await db.kinder.get(input.id);
      const updated: Kind = { ...(existing as Kind), ...input, geaendertAm: ts };
      await db.kinder.put(updated);
      return updated;
    }
    const kind: Kind = {
      id: newId(),
      name: input.name,
      klasseId: input.klasseId,
      lernstand: input.lernstand ?? 'klasse2',
      notiz: input.notiz,
      erstelltAm: ts,
      geaendertAm: ts,
    };
    await db.kinder.put(kind);
    return kind;
  }

  async deleteKind(id: Id): Promise<void> {
    await db.transaction('rw', db.kinder, db.lernwoerter, db.uebungstexte, async () => {
      await db.kinder.delete(id);
      await db.lernwoerter.where('kindId').equals(id).delete();
      await db.uebungstexte.where('kindId').equals(id).delete();
    });
  }

  async getLernwoerter(kindId: Id): Promise<Lernwort[]> {
    return (await db.lernwoerter.where('kindId').equals(kindId).toArray()).sort(
      (a, b) => b.erstelltAm - a.erstelltAm,
    );
  }

  async addLernwort(kindId: Id, wort: string, extra: Partial<Lernwort> = {}): Promise<Lernwort> {
    const ts = now();
    const trimmed = wort.trim();
    const lernwort: Lernwort = {
      id: newId(),
      kindId,
      wort: trimmed,
      artikel: extra.artikel ?? '',
      wortart: extra.wortart,
      silben: extra.silben ?? splitSyllables(trimmed),
      merkstellen: extra.merkstellen ?? suggestMerkstellen(trimmed),
      status: extra.status ?? 'neu',
      // Spaced Repetition: neue Wörter sind sofort fällig, starten in Fach 1.
      fach: extra.fach ?? 1,
      faelligAm: extra.faelligAm ?? ts,
      quelle: extra.quelle,
      notiz: extra.notiz,
      erstelltAm: ts,
      geaendertAm: ts,
    };
    await db.lernwoerter.put(lernwort);
    return lernwort;
  }

  async updateLernwort(id: Id, patch: Partial<Lernwort>): Promise<void> {
    await db.lernwoerter.update(id, { ...patch, geaendertAm: now() });
  }

  async deleteLernwort(id: Id): Promise<void> {
    await db.lernwoerter.delete(id);
  }

  async deleteLernwoerter(ids: Id[]): Promise<void> {
    await db.lernwoerter.bulkDelete(ids);
  }

  async getUebungstexte(kindId: Id): Promise<Uebungstext[]> {
    return (await db.uebungstexte.where('kindId').equals(kindId).toArray()).sort(
      (a, b) => b.erstelltAm - a.erstelltAm,
    );
  }

  async saveUebungstext(
    input: Partial<Uebungstext> & { kindId: Id; titel: string },
  ): Promise<Uebungstext> {
    const ts = now();
    if (input.id) {
      const existing = await db.uebungstexte.get(input.id);
      const updated: Uebungstext = { ...(existing as Uebungstext), ...input, geaendertAm: ts };
      await db.uebungstexte.put(updated);
      return updated;
    }
    const text: Uebungstext = {
      id: newId(),
      kindId: input.kindId,
      titel: input.titel,
      textart: input.textart ?? 'geschichte',
      text: input.text ?? '',
      loesungswoerter: input.loesungswoerter,
      verwendeteWoerter: input.verwendeteWoerter ?? [],
      erstelltAm: ts,
      geaendertAm: ts,
    };
    await db.uebungstexte.put(text);
    return text;
  }

  async deleteUebungstext(id: Id): Promise<void> {
    await db.uebungstexte.delete(id);
  }

  async getEinstellungen(): Promise<Einstellungen> {
    return db.transaction('rw', db.einstellungen, async () => {
      const e = await db.einstellungen.get('app');
      if (!e) {
        await db.einstellungen.put(DEFAULT_EINSTELLUNGEN);
        return DEFAULT_EINSTELLUNGEN;
      }
      return { ...DEFAULT_EINSTELLUNGEN, ...e };
    });
  }

  async saveEinstellungen(patch: Partial<Einstellungen>): Promise<Einstellungen> {
    const current = await this.getEinstellungen();
    const updated: Einstellungen = { ...current, ...patch, id: 'app' };
    await db.einstellungen.put(updated);
    return updated;
  }

  async clearAll(): Promise<void> {
    await db.transaction(
      'rw',
      [db.klassen, db.kinder, db.lernwoerter, db.uebungstexte, db.einstellungen],
      async () => {
        await Promise.all([
          db.klassen.clear(),
          db.kinder.clear(),
          db.lernwoerter.clear(),
          db.uebungstexte.clear(),
          db.einstellungen.clear(),
        ]);
      },
    );
  }
}
