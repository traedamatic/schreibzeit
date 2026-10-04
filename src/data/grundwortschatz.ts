// Verfügbare Grundwortschatz-Listen (offizielle Wortschätze der Bundesländer).
// Die Wortlisten liegen als JSON unter public/data/grundwortschatz/ und werden
// bei Bedarf nachgeladen.
//
// Aktuell eingebaut: Bayern (LehrplanPLUS, Jgst. 1/2 und 3/4) und
// Nordrhein-Westfalen (Grundwortschatz, 533 Wörter). Weitere Bundesländer
// (z. B. Hessen, Baden-Württemberg) lassen sich als zusätzliche JSON-Dateien
// gleicher Struktur ergänzen.

import { db } from '@/db/db';
import { newId, now } from '@/core/id';
import type { Wortliste } from '@/types';

export interface GrundwortschatzListe {
  id: string;
  label: string;
  bundesland: string;
  klasse: string;
  datei: string;
}

/**
 * Normalisierter Listeneintrag (#14). `artikel` ist dreiwertig:
 *  - 'der'|'die'|'das' → kuratierter Artikel aus der Liste (überschreibt beim
 *    Import den Wörterbuch-Vorschlag)
 *  - null              → Wort hat bewusst keinen Artikel (kein Nomen)
 *  - undefined         → Liste macht keine Aussage → Wörterbuch darf vorschlagen
 */
export interface GrundwortschatzEintrag {
  wort: string;
  artikel?: 'der' | 'die' | 'das' | null;
}

const ARTIKEL = new Set(['der', 'die', 'das']);

/**
 * Wandelt rohe Listendaten in Einträge um. Unterstützt beide Datei-Schemata —
 * `["Apfel", …]` (Bayern/NRW) und `[{"word": "Apfel", "article": "der"}, …]`
 * (Berlin) — fehlertolerant: kaputte Einträge werden übersprungen, unbekannte
 * Artikel-Werte als „keine Aussage" behandelt.
 */
export function normalisiereEintraege(roh: unknown): GrundwortschatzEintrag[] {
  if (!Array.isArray(roh)) return [];
  const ergebnis: GrundwortschatzEintrag[] = [];
  for (const eintrag of roh) {
    if (typeof eintrag === 'string') {
      const wort = eintrag.trim();
      if (wort) ergebnis.push({ wort });
      continue;
    }
    if (eintrag && typeof eintrag === 'object') {
      const wort = String((eintrag as { word?: unknown }).word ?? '').trim();
      if (!wort) continue;
      const artikelRoh = (eintrag as { article?: unknown }).article;
      if (artikelRoh === null) {
        ergebnis.push({ wort, artikel: null });
      } else if (typeof artikelRoh === 'string' && ARTIKEL.has(artikelRoh)) {
        ergebnis.push({ wort, artikel: artikelRoh as 'der' | 'die' | 'das' });
      } else {
        ergebnis.push({ wort }); // unbekannter Wert → keine Aussage
      }
    }
    // Alles andere (Zahlen, null, …) wird still übersprungen.
  }
  return ergebnis;
}

export const GRUNDWORTSCHATZ_LISTEN: GrundwortschatzListe[] = [
  {
    id: 'bayern-1-2',
    label: 'Bayern · Grundwortschatz 1/2',
    bundesland: 'Bayern',
    klasse: '1/2',
    datei: 'bayern-1-2.json',
  },
  {
    id: 'bayern-3-4',
    label: 'Bayern · Grundwortschatz 3/4',
    bundesland: 'Bayern',
    klasse: '3/4',
    datei: 'bayern-3-4.json',
  },
  {
    id: 'nrw',
    label: 'Nordrhein-Westfalen · Grundwortschatz',
    bundesland: 'Nordrhein-Westfalen',
    klasse: '1–4',
    datei: 'nrw.json',
  },
  {
    id: 'berlin-1-4',
    label: 'Berlin/Brandenburg · Grundwortschatz 1–4',
    bundesland: 'Berlin/Brandenburg',
    klasse: '1–4',
    datei: 'grundwortschatz_berlin_1bis4.json',
  },
];

const cache = new Map<string, GrundwortschatzEintrag[]>();

/**
 * Lädt eine Grundwortschatz-Liste als normalisierte Einträge (mit Cache).
 * Eigene, importierte Listen (DB-Tabelle `wortlisten`, reine Wortarrays)
 * haben Vorrang vor den mitgelieferten JSON-Dateien.
 */
export async function ladeGrundwortschatz(id: string): Promise<GrundwortschatzEintrag[]> {
  if (cache.has(id)) return cache.get(id)!;
  // Importierte Liste?
  const eigene = await db.wortlisten.get(id);
  if (eigene) {
    const eintraege = normalisiereEintraege(eigene.woerter);
    cache.set(id, eintraege);
    return eintraege;
  }
  const liste = GRUNDWORTSCHATZ_LISTEN.find((l) => l.id === id);
  if (!liste) return [];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/grundwortschatz/${liste.datei}`);
    const eintraege = normalisiereEintraege(res.ok ? await res.json() : []);
    cache.set(id, eintraege);
    return eintraege;
  } catch {
    return [];
  }
}

/** Cache leeren – erzwingt ein erneutes Laden (z. B. nach App-Update). */
export function grundwortschatzCacheLeeren(): void {
  cache.clear();
}

/**
 * Wandelt eine importierte Datei (eine Wortliste) in ein Array um. Unterstützt
 * JSON-Arrays (["Apfel", …]) sowie reinen Text (ein Wort je Zeile oder durch
 * Komma/Semikolon getrennt). Duplikate werden entfernt.
 */
export function parseWortliste(inhalt: string): string[] {
  let roh: string[] = [];
  const text = inhalt.trim();
  if (text.startsWith('[')) {
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json)) roh = json.map((x) => String(x));
    } catch {
      /* fällt unten auf Textmodus zurück */
    }
  }
  if (roh.length === 0) {
    roh = text.split(/[\n,;]+/);
  }
  const gesehen = new Set<string>();
  const ergebnis: string[] = [];
  for (const w of roh) {
    const wort = w.trim();
    if (!wort) continue;
    const key = wort.toLowerCase();
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    ergebnis.push(wort);
  }
  return ergebnis;
}

/** Importiert eine neue eigene Wortliste. */
export async function wortlisteImportieren(label: string, woerter: string[]): Promise<Wortliste> {
  const eintrag: Wortliste = {
    id: `import:${newId()}`,
    label: label.trim() || 'Eigene Wortliste',
    woerter,
    erstelltAm: now(),
  };
  await db.wortlisten.put(eintrag);
  cache.delete(eintrag.id);
  return eintrag;
}

/** Ersetzt (aktualisiert) die Wörter einer vorhandenen eigenen Wortliste. */
export async function wortlisteAktualisieren(id: string, woerter: string[]): Promise<void> {
  await db.wortlisten.update(id, { woerter });
  cache.delete(id);
}

/** Löscht eine eigene Wortliste. */
export async function wortlisteLoeschen(id: string): Promise<void> {
  await db.wortlisten.delete(id);
  cache.delete(id);
}
