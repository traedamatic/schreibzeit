// Public (client-facing) word shape — camelCase, with silben/merkstellen parsed
// from their JSON text columns back into arrays.
import type { WordRow } from '../types';

function parseArray<T>(json: string): T[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

export function toPublicWord(w: WordRow) {
  return {
    id: w.id,
    kidId: w.kid_id,
    wort: w.wort,
    artikel: w.artikel,
    wortart: w.wortart,
    silben: parseArray<string>(w.silben),
    merkstellen: parseArray<number>(w.merkstellen),
    status: w.status,
    fach: w.fach,
    faelligAm: w.faellig_am,
    quelle: w.quelle,
    notiz: w.notiz,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
  };
}
