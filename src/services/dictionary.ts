// Wörterbuch-gestützte Vorschläge beim Anlegen eines Lernworts:
//   - Silbentrennung aus der deutschen Trennmuster-Bibliothek (hyphen) –
//     funktioniert offline für *beliebige* Wörter und ist deutlich genauer als
//     eine reine Heuristik.
//   - Artikel (Genus) aus einer kuratierten Grundwortschatz-Liste.
//   - Merkstellen weiterhin aus der bestehenden Heuristik.
//
// Wird ausschließlich in der Oberfläche genutzt (nicht in der getesteten
// Kernlogik), damit die Kernlogik abhängigkeitsfrei und offline-fest bleibt.

import { hyphenateSync } from 'hyphen/de';
import { splitSyllables } from '@/core/syllables';
import { suggestMerkstellen } from '@/core/merkstellen';
import { GERMAN_NOUNS, type Artikel } from '@/data/germanNouns';

// Großes Wörterbuch (≈90.000 Nomen mit Artikel, aus dem deutschen Wiktionary,
// CC BY-SA). Wird einmalig nachgeladen und zwischengespeichert; bis dahin dient
// die kompakte kuratierte Liste als sofortige Grundlage (offline-fest).
let grossesWoerterbuch: Record<string, Artikel> | null = null;
let ladePromise: Promise<void> | null = null;

export function ladeWoerterbuch(): Promise<void> {
  if (ladePromise) return ladePromise;
  const url = `${import.meta.env.BASE_URL}data/nouns.json`;
  ladePromise = fetch(url)
    .then((r) => (r.ok ? r.json() : {}))
    .then((daten) => {
      grossesWoerterbuch = daten as Record<string, Artikel>;
    })
    .catch(() => {
      grossesWoerterbuch = {};
    });
  return ladePromise;
}

function findeArtikel(wort: string): Artikel | undefined {
  const trimmed = wort.trim();
  const key = trimmed.toLowerCase();
  // Kuratierte Liste hat Vorrang (geprüfte, reine Nomen-Liste für die
  // Grundschule) — sie darf case-insensitiv matchen („hund" → der).
  const kuratiert = GERMAN_NOUNS[key];
  if (kuratiert) return kuratiert;
  // Das große Wiktionary-Wörterbuch enthält auch substantivierte Verben und
  // Zahlwörter (sieben → die Sieben, essen → das Essen). Kleingeschriebene
  // Eingaben sind im Deutschen keine Nomen-Schreibweise — nur bei
  // großgeschriebenem Wortanfang nachschlagen, sonst keinen Artikel raten.
  const erstesZeichen = trimmed[0];
  const istGrossgeschrieben =
    erstesZeichen !== undefined && erstesZeichen === erstesZeichen.toLocaleUpperCase('de');
  if (!istGrossgeschrieben) return undefined;
  return grossesWoerterbuch?.[key];
}

export interface WortInfo {
  silben: string[];
  artikel?: 'der' | 'die' | 'das' | '';
  merkstellen: number[];
  /** Wurde ein Artikel im Wörterbuch gefunden? (für UI-Hinweis) */
  artikelGefunden: boolean;
}

const TRENN = ''; // unsichtbares Trennzeichen für die Zerlegung

/** Silbentrennung über die Wörterbuch-Bibliothek, mit Heuristik-Fallback. */
export function woerterbuchSilben(wort: string): string[] {
  const trimmed = wort.trim();
  if (trimmed.length < 2) return [trimmed];
  try {
    const getrennt = hyphenateSync(trimmed, { hyphenChar: TRENN });
    const teile = getrennt.split(TRENN).filter(Boolean);
    return teile.length > 0 ? teile : splitSyllables(trimmed);
  } catch {
    return splitSyllables(trimmed);
  }
}

/** Schlägt Silben, Artikel und Merkstellen für ein Wort vor. */
export function lookupWort(wort: string): WortInfo {
  const trimmed = wort.trim();
  const artikel = findeArtikel(trimmed);
  return {
    silben: woerterbuchSilben(trimmed),
    artikel: artikel ?? '',
    merkstellen: suggestMerkstellen(trimmed),
    artikelGefunden: artikel != null,
  };
}
