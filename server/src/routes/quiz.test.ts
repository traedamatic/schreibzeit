// Groß/klein-Quiz (#16): Quiz-Sessions zählen in die Übungszeit und tragen
// art = 'quiz'. Seit #18 speist auch das Quiz den SRS-Stand (Problemwörter),
// d. h. richtig rückt vor, falsch setzt zurück.
import { describe, expect, it } from 'bun:test';
import { createApp } from '../app';
import { openDatabase } from '../db';
import { runMigrations } from '../migrations';
import { loadConfig } from '../config';
import { now } from '../ids';

const BASE = 'http://localhost';

function req(method: string, path: string, body?: unknown, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const cookieFrom = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

async function setup() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const app = createApp(db, loadConfig({ TZ: 'UTC' }));
  const signup = await app.handle(
    req('POST', '/api/auth/signup', { email: 'p@home.de', password: 'supersecret' }),
  );
  const adminCookie = cookieFrom(signup);
  const kidRes = await app.handle(
    req('POST', '/api/kids', { name: 'Lina', lernstand: 'klasse2' }, adminCookie),
  );
  const kidId = ((await kidRes.json()) as { id: string }).id;
  const wortRes = await app.handle(
    req('POST', `/api/kids/${kidId}/words`, { wort: 'Sommer', artikel: 'der' }, adminCookie),
  );
  const wortId = ((await wortRes.json()) as { id: string }).id;
  return { app, db, adminCookie, kidId, wortId };
}

describe('Groß/klein-Quiz (#16)', () => {
  it("Modus 'quiz' ist ein gültiger uebungsModus", async () => {
    const { app, adminCookie, kidId } = await setup();
    const res = await app.handle(
      req('PUT', `/api/kids/${kidId}`, { uebungsModus: 'quiz' }, adminCookie),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { uebungsModus: string }).uebungsModus).toBe('quiz');
  });

  it('Quiz-Submit: Zeit zählt, Event trägt art=quiz, SRS schreitet fort (#18)', async () => {
    const { app, db, adminCookie, kidId, wortId } = await setup();

    const submit = await app.handle(
      req(
        'POST',
        `/api/kids/${kidId}/practice`,
        {
          sessionId: 'quiz-1',
          art: 'quiz',
          events: [{ wordId: wortId, correct: true, durationMs: 120000, practicedAt: now() }],
        },
        adminCookie,
      ),
    );
    expect(submit.status).toBe(200);
    const result = (await submit.json()) as { applied: number; updated: { fach: number; status: string }[] };
    expect(result.applied).toBe(1);
    // #18: richtige Quiz-Antwort rückt den SRS-Stand vor (Fach 1 → 2).
    expect(result.updated[0]?.fach).toBe(2);
    expect(result.updated[0]?.status).toBe('wird_geuebt');

    const event = db.query('SELECT art, fach_before, fach_after FROM practice_events;').get() as {
      art: string;
      fach_before: number;
      fach_after: number;
    };
    expect(event.art).toBe('quiz');
    expect(event.fach_before).toBe(1);
    expect(event.fach_after).toBe(2);

    const today = await app.handle(req('GET', `/api/kids/${kidId}/practice/today`, undefined, adminCookie));
    expect(((await today.json()) as { secondsToday: number }).secondsToday).toBe(120);
  });

  it('Quiz-Submit: falsche Antwort setzt das Wort zurück (Problemwort, #18)', async () => {
    const { app, db, adminCookie, kidId, wortId } = await setup();
    // Wort erst auf Fach 3 heben …
    await app.handle(
      req(
        'POST',
        `/api/kids/${kidId}/practice`,
        {
          sessionId: 's-up-1',
          events: [{ wordId: wortId, correct: true, durationMs: 1000, practicedAt: now() }],
        },
        adminCookie,
      ),
    );
    await app.handle(
      req(
        'POST',
        `/api/kids/${kidId}/practice`,
        {
          sessionId: 's-up-2',
          events: [{ wordId: wortId, correct: true, durationMs: 1000, practicedAt: now() }],
        },
        adminCookie,
      ),
    );
    expect((db.query('SELECT fach FROM words WHERE id = ?;').get(wortId) as { fach: number }).fach).toBe(3);

    // … dann im Quiz falsch → zurück auf Fach 1.
    await app.handle(
      req(
        'POST',
        `/api/kids/${kidId}/practice`,
        {
          sessionId: 'quiz-wrong',
          art: 'quiz',
          events: [{ wordId: wortId, correct: false, durationMs: 1000, practicedAt: now() }],
        },
        adminCookie,
      ),
    );
    expect((db.query('SELECT fach FROM words WHERE id = ?;').get(wortId) as { fach: number }).fach).toBe(1);
  });

  it("Schreib-Submit (ohne art / art='schreiben') verhält sich unverändert (SRS schreitet fort)", async () => {
    const { app, db, adminCookie, kidId, wortId } = await setup();
    await app.handle(
      req(
        'POST',
        `/api/kids/${kidId}/practice`,
        {
          sessionId: 's-1',
          events: [{ wordId: wortId, correct: true, durationMs: 1000, practicedAt: now() }],
        },
        adminCookie,
      ),
    );
    const wort = db.query('SELECT fach FROM words WHERE id = ?;').get(wortId) as { fach: number };
    expect(wort.fach).toBe(2);
    const event = db.query('SELECT art FROM practice_events;').get() as { art: string };
    expect(event.art).toBe('schreiben');
  });

  it('ungültige art → 400', async () => {
    const { app, adminCookie, kidId, wortId } = await setup();
    const res = await app.handle(
      req(
        'POST',
        `/api/kids/${kidId}/practice`,
        {
          sessionId: 'x',
          art: 'raten',
          events: [{ wordId: wortId, correct: true, durationMs: 1, practicedAt: now() }],
        },
        adminCookie,
      ),
    );
    expect(res.status).toBe(400);
  });
});
