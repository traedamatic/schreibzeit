// Gemeinsame Hilfsfunktion: ein Wort mit Wörterbuch-Vorschlägen (Silben,
// Artikel, Merkstellen) als Lernwort übernehmen. Wird von mehreren Stellen
// genutzt (Text-Extraktion, Grundwortschatz), um Doppelung zu vermeiden.
import { repository } from '@/db/repository';
import { lookupWort, ladeWoerterbuch } from './dictionary';

export async function uebernehmeWort(
  kindId: string,
  wort: string,
  quelle: string,
  /**
   * Kuratierter Artikel aus einer Liste (#14): 'der'|'die'|'das' überschreibt
   * den Wörterbuch-Vorschlag, `null` heißt „bewusst kein Artikel" (kein
   * Nomen). `undefined` = keine Vorgabe → das Wörterbuch schlägt vor.
   */
  artikelVorgabe?: 'der' | 'die' | 'das' | null,
): Promise<void> {
  // Sicherstellen, dass das große Wörterbuch geladen ist – sonst fehlen beim
  // (frühen) Import die Artikel, weil lookupWort nur die kleine Liste sähe.
  await ladeWoerterbuch();
  const info = lookupWort(wort);
  const artikel = artikelVorgabe !== undefined ? (artikelVorgabe ?? '') : info.artikel || '';
  await repository.addLernwort(kindId, wort, {
    quelle,
    silben: info.silben,
    merkstellen: info.merkstellen,
    artikel,
  });
}

/** Übernimmt mehrere Wörter nacheinander. */
export async function uebernehmeWoerter(
  kindId: string,
  woerter: string[],
  quelle: string,
): Promise<void> {
  await ladeWoerterbuch();
  for (const w of woerter) await uebernehmeWort(kindId, w, quelle);
}
