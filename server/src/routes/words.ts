// Per-kid Lernwörter API, familien-begrenzt (#12): Admins erreichen nur die
// Kinder ihrer eigenen Familie (fremde → 404); eine Kind-Session liest nur die
// eigenen Wörter. Schreiben bleibt admin-only.
import { Elysia, t } from 'elysia';
import type { Database } from 'bun:sqlite';
import { adminContext, kidContext, kidZugriff, zugriffsFehler } from '../auth/guards';
import {
  createWord,
  deleteWord,
  deleteWords,
  getWordById,
  listWordsByKid,
  updateWord,
} from '../words/data';
import { toPublicWord } from '../words/public';
import {
  ARTIKEL_VALUES,
  WORT_STATUS_VALUES,
  type AdminRow,
  type WordRow,
  type WortStatus,
} from '../types';
import { getKidFuerFamilie } from '../kids/data';

function validArtikel(a: string | undefined): boolean {
  return a === undefined || (ARTIKEL_VALUES as readonly string[]).includes(a);
}
function validStatus(s: string | undefined): boolean {
  return s === undefined || (WORT_STATUS_VALUES as readonly string[]).includes(s);
}

/** Gehört das Wort zu einem Kind der Familie des Admins? */
function wordInFamilie(db: Database, word: WordRow, admin: AdminRow): boolean {
  return getKidFuerFamilie(db, word.kid_id, admin.family_id) !== null;
}

const WordBody = t.Object({
  id: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
  wort: t.String({ minLength: 1, maxLength: 120 }),
  artikel: t.Optional(t.String({ maxLength: 10 })),
  wortart: t.Optional(t.String({ maxLength: 40 })),
  silben: t.Optional(t.Array(t.String({ maxLength: 120 }))),
  merkstellen: t.Optional(t.Array(t.Integer({ minimum: 0 }))),
  status: t.Optional(t.String({ maxLength: 20 })),
  quelle: t.Optional(t.String({ maxLength: 200 })),
  notiz: t.Optional(t.String({ maxLength: 2000 })),
});

const WordPatch = t.Partial(WordBody);

export function wordsRoutes(db: Database) {
  return new Elysia()
    .use(adminContext(db))
    .use(kidContext(db))
    // List a kid's words.
    .get('/kids/:id/words', ({ params, admin, kid, set }) => {
      const zugriff = kidZugriff(db, admin, kid, params.id);
      if ('status' in zugriff) {
        set.status = zugriff.status;
        return zugriffsFehler(zugriff.status);
      }
      return listWordsByKid(db, zugriff.kid.id).map(toPublicWord);
    })
    // Create a word (admin only, own family).
    .post(
      '/kids/:id/words',
      ({ params, body, admin, set }) => {
        if (!admin) {
          set.status = 401;
          return { error: 'Not authenticated.' };
        }
        if (!getKidFuerFamilie(db, params.id, admin.family_id)) {
          set.status = 404;
          return { error: 'Kid not found.' };
        }
        if (!validArtikel(body.artikel) || !validStatus(body.status)) {
          set.status = 400;
          return { error: 'Invalid artikel or status.' };
        }
        // Idempotent offline-sync replay (nur innerhalb der eigenen Familie).
        if (body.id) {
          const existing = getWordById(db, body.id);
          if (existing && wordInFamilie(db, existing, admin)) return toPublicWord(existing);
        }
        const word = createWord(db, params.id, {
          id: body.id,
          wort: body.wort,
          artikel: body.artikel ?? null,
          wortart: body.wortart ?? null,
          silben: body.silben,
          merkstellen: body.merkstellen,
          status: body.status as WortStatus | undefined,
          quelle: body.quelle ?? null,
          notiz: body.notiz ?? null,
        });
        set.status = 201;
        return toPublicWord(word);
      },
      { body: WordBody },
    )
    // Read a single word.
    .get('/words/:id', ({ params, admin, kid, set }) => {
      const word = getWordById(db, params.id);
      if (!word) {
        set.status = 404;
        return { error: 'Word not found.' };
      }
      const zugriff = kidZugriff(db, admin, kid, word.kid_id);
      if ('status' in zugriff) {
        // Für Admins fremder Familien wie "nicht vorhanden" behandeln.
        const status = zugriff.status === 404 ? 404 : zugriff.status;
        set.status = status;
        return status === 404 ? { error: 'Word not found.' } : zugriffsFehler(zugriff.status);
      }
      return toPublicWord(word);
    })
    // Update a word (admin only, own family).
    .put(
      '/words/:id',
      ({ params, body, admin, set }) => {
        if (!admin) {
          set.status = 401;
          return { error: 'Not authenticated.' };
        }
        if (!validArtikel(body.artikel) || !validStatus(body.status)) {
          set.status = 400;
          return { error: 'Invalid artikel or status.' };
        }
        const existing = getWordById(db, params.id);
        if (!existing || !wordInFamilie(db, existing, admin)) {
          set.status = 404;
          return { error: 'Word not found.' };
        }
        const word = updateWord(db, params.id, {
          wort: body.wort,
          artikel: body.artikel,
          wortart: body.wortart,
          silben: body.silben,
          merkstellen: body.merkstellen,
          status: body.status as WortStatus | undefined,
          quelle: body.quelle,
          notiz: body.notiz,
        });
        if (!word) {
          set.status = 404;
          return { error: 'Word not found.' };
        }
        return toPublicWord(word);
      },
      { body: WordPatch },
    )
    // Delete a word (admin only, own family).
    .delete('/words/:id', ({ params, admin, set }) => {
      if (!admin) {
        set.status = 401;
        return { error: 'Not authenticated.' };
      }
      const existing = getWordById(db, params.id);
      if (!existing || !wordInFamilie(db, existing, admin)) {
        set.status = 404;
        return { error: 'Word not found.' };
      }
      deleteWord(db, params.id);
      return { ok: true };
    })
    // Bulk delete (admin only) — fremde ids werden stillschweigend ignoriert.
    .post(
      '/words/bulk-delete',
      ({ body, admin, set }) => {
        if (!admin) {
          set.status = 401;
          return { error: 'Not authenticated.' };
        }
        const eigene = body.ids.filter((id) => {
          const word = getWordById(db, id);
          return word !== null && wordInFamilie(db, word, admin);
        });
        return { deleted: deleteWords(db, eigene) };
      },
      { body: t.Object({ ids: t.Array(t.String(), { minItems: 1 }) }) },
    );
}
