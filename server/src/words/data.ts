// Word (Lernwort) data access. Mirrors the client `Repository` word ops in
// `src/db/repository.ts`; silben/merkstellen are stored as JSON text.
import type { Database } from 'bun:sqlite';
import type { WordRow, WortStatus } from '../types';
import { newId, now } from '../ids';

export interface CreateWordInput {
  /** Optional client-supplied id (offline-first sync replays stay idempotent). */
  id?: string;
  wort: string;
  artikel?: string | null;
  wortart?: string | null;
  silben?: string[];
  merkstellen?: number[];
  status?: WortStatus;
  quelle?: string | null;
  notiz?: string | null;
}

export interface UpdateWordInput {
  wort?: string;
  artikel?: string | null;
  wortart?: string | null;
  silben?: string[];
  merkstellen?: number[];
  status?: WortStatus;
  quelle?: string | null;
  notiz?: string | null;
}

export function listWordsByKid(db: Database, kidId: string): WordRow[] {
  return db
    .query('SELECT * FROM words WHERE kid_id = ? ORDER BY created_at DESC;')
    .all(kidId) as WordRow[];
}

export function getWordById(db: Database, id: string): WordRow | null {
  return db.query('SELECT * FROM words WHERE id = ?;').get(id) as WordRow | null;
}

export function createWord(db: Database, kidId: string, input: CreateWordInput): WordRow {
  const ts = now();
  const id = input.id ?? newId();
  // Defaults match repository.addLernwort: status 'neu', fach 1, due now.
  db.query(
    `INSERT INTO words
       (id, kid_id, wort, artikel, wortart, silben, merkstellen, status, fach, faellig_am, quelle, notiz, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    kidId,
    input.wort.trim(),
    input.artikel ?? null,
    input.wortart ?? null,
    JSON.stringify(input.silben ?? []),
    JSON.stringify(input.merkstellen ?? []),
    input.status ?? 'neu',
    1,
    ts,
    input.quelle ?? null,
    input.notiz ?? null,
    ts,
    ts,
  );
  const created = getWordById(db, id);
  if (!created) throw new Error('Word insert failed');
  return created;
}

export function updateWord(db: Database, id: string, patch: UpdateWordInput): WordRow | null {
  const word = getWordById(db, id);
  if (!word) return null;
  const wort = (patch.wort ?? word.wort).trim();
  const artikel = patch.artikel !== undefined ? patch.artikel : word.artikel;
  const wortart = patch.wortart !== undefined ? patch.wortart : word.wortart;
  const silben = patch.silben !== undefined ? JSON.stringify(patch.silben) : word.silben;
  const merkstellen =
    patch.merkstellen !== undefined ? JSON.stringify(patch.merkstellen) : word.merkstellen;
  const status = patch.status ?? word.status;
  const quelle = patch.quelle !== undefined ? patch.quelle : word.quelle;
  const notiz = patch.notiz !== undefined ? patch.notiz : word.notiz;
  db.query(
    `UPDATE words SET wort = ?, artikel = ?, wortart = ?, silben = ?, merkstellen = ?, status = ?, quelle = ?, notiz = ?, updated_at = ?
     WHERE id = ?;`,
  ).run(wort, artikel, wortart, silben, merkstellen, status, quelle, notiz, now(), id);
  return getWordById(db, id);
}

export function deleteWord(db: Database, id: string): boolean {
  return db.query('DELETE FROM words WHERE id = ?;').run(id).changes > 0;
}

export function deleteWords(db: Database, ids: string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  return db.query(`DELETE FROM words WHERE id IN (${placeholders});`).run(...ids).changes;
}
