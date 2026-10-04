// Per-kid Lernwörter API. Reads allowed for an admin (any kid) or the owning
// kid (own only); create/update/delete are admin-only.
import { Elysia, t } from 'elysia';
import type { Database } from 'bun:sqlite';
import { adminContext, kidContext, kidOwns } from '../auth/guards';
import { getKidById } from '../kids/data';
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
  type KidRow,
  type WortStatus,
} from '../types';

function validArtikel(a: string | undefined): boolean {
  return a === undefined || (ARTIKEL_VALUES as readonly string[]).includes(a);
}
function validStatus(s: string | undefined): boolean {
  return s === undefined || (WORT_STATUS_VALUES as readonly string[]).includes(s);
}

/** 0 = allowed; otherwise the HTTP status to return for a read on `kidId`. */
function readDenial(admin: AdminRow | null, kid: KidRow | null, kidId: string): 0 | 401 | 403 {
  if (admin) return 0;
  if (!kid) return 401;
  return kidOwns(kid, kidId) ? 0 : 403;
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
      const denial = readDenial(admin, kid, params.id);
      if (denial) {
        set.status = denial;
        return { error: denial === 401 ? 'Not authenticated.' : 'Forbidden.' };
      }
      if (!getKidById(db, params.id)) {
        set.status = 404;
        return { error: 'Kid not found.' };
      }
      return listWordsByKid(db, params.id).map(toPublicWord);
    })
    // Create a word (admin only).
    .post(
      '/kids/:id/words',
      ({ params, body, admin, set }) => {
        if (!admin) {
          set.status = 401;
          return { error: 'Not authenticated.' };
        }
        if (!getKidById(db, params.id)) {
          set.status = 404;
          return { error: 'Kid not found.' };
        }
        if (!validArtikel(body.artikel) || !validStatus(body.status)) {
          set.status = 400;
          return { error: 'Invalid artikel or status.' };
        }
        // Idempotent offline-sync replay: a resent create with a known id is a no-op.
        if (body.id) {
          const existing = getWordById(db, body.id);
          if (existing) return toPublicWord(existing);
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
      const denial = readDenial(admin, kid, word.kid_id);
      if (denial) {
        set.status = denial;
        return { error: denial === 401 ? 'Not authenticated.' : 'Forbidden.' };
      }
      return toPublicWord(word);
    })
    // Update a word (admin only).
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
    // Delete a word (admin only).
    .delete('/words/:id', ({ params, admin, set }) => {
      if (!admin) {
        set.status = 401;
        return { error: 'Not authenticated.' };
      }
      if (!deleteWord(db, params.id)) {
        set.status = 404;
        return { error: 'Word not found.' };
      }
      return { ok: true };
    })
    // Bulk delete (admin only) — mirrors repository.deleteLernwoerter.
    .post(
      '/words/bulk-delete',
      ({ body, admin, set }) => {
        if (!admin) {
          set.status = 401;
          return { error: 'Not authenticated.' };
        }
        return { deleted: deleteWords(db, body.ids) };
      },
      { body: t.Object({ ids: t.Array(t.String(), { minItems: 1 }) }) },
    );
}
