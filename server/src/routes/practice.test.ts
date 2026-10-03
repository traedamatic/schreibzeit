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
  // TZ=UTC makes "today" boundaries deterministic in tests.
  const app = createApp(db, loadConfig({ TZ: 'UTC' }));
  const signup = await app.handle(
    req('POST', '/api/auth/signup', { email: 'p@home.de', password: 'supersecret' }),
  );
  const adminCookie = cookieFrom(signup);

  async function makeKid(name: string, pin: string) {
    const created = await app.handle(req('POST', '/api/kids', { name, lernstand: 'klasse2' }, adminCookie));
    const id = ((await created.json()) as { id: string }).id;
    await app.handle(req('PUT', `/api/kids/${id}/pin`, { pin }, adminCookie));
    const login = await app.handle(req('POST', '/api/auth/kid-login', { name, pin }));
    return { id, cookie: cookieFrom(login) };
  }
  async function addWord(kidId: string, wort: string) {
    const res = await app.handle(req('POST', `/api/kids/${kidId}/words`, { wort }, adminCookie));
    return ((await res.json()) as { id: string }).id;
  }

  return { app, db, adminCookie, makeKid, addWord };
}

describe('practice API', () => {
  it('records events, advances SRS, and shrinks the due list', async () => {
    const { app, makeKid, addWord } = await setup();
    const lina = await makeKid('Lina', '1234');
    const w1 = await addWord(lina.id, 'Sommer');
    const w2 = await addWord(lina.id, 'Haus');

    const dueBefore = await app.handle(req('GET', `/api/kids/${lina.id}/practice/due`, undefined, lina.cookie));
    expect(((await dueBefore.json()) as unknown[]).length).toBe(2);

    const submit = await app.handle(
      req(
        'POST',
        `/api/kids/${lina.id}/practice`,
        {
          sessionId: 'sess-1',
          events: [{ wordId: w1, correct: true, durationMs: 200000, practicedAt: now() }],
        },
        lina.cookie,
      ),
    );
    expect(submit.status).toBe(200);
    const result = (await submit.json()) as { applied: number; updated: { id: string; fach: number; status: string }[] };
    expect(result.applied).toBe(1);
    expect(result.updated[0]?.fach).toBe(2);
    expect(result.updated[0]?.status).toBe('wird_geuebt');

    const dueAfter = await app.handle(req('GET', `/api/kids/${lina.id}/practice/due`, undefined, lina.cookie));
    const dueIds = ((await dueAfter.json()) as { id: string }[]).map((w) => w.id);
    expect(dueIds).toContain(w2);
    expect(dueIds).not.toContain(w1);
  });

  it('today summary accumulates time and flips goalMet', async () => {
    const { app, makeKid, addWord } = await setup();
    const lina = await makeKid('Lina', '1234');
    const w1 = await addWord(lina.id, 'Sommer');

    const before = await app.handle(req('GET', `/api/kids/${lina.id}/practice/today`, undefined, lina.cookie));
    const b = (await before.json()) as { secondsToday: number; goalMet: boolean; goalSeconds: number };
    expect(b.secondsToday).toBe(0);
    expect(b.goalSeconds).toBe(300);
    expect(b.goalMet).toBe(false);

    await app.handle(
      req(
        'POST',
        `/api/kids/${lina.id}/practice`,
        { sessionId: 's1', events: [{ wordId: w1, correct: true, durationMs: 350000, practicedAt: now() }] },
        lina.cookie,
      ),
    );
    const after = await app.handle(req('GET', `/api/kids/${lina.id}/practice/today`, undefined, lina.cookie));
    const a = (await after.json()) as { secondsToday: number; goalMet: boolean; sessionsToday: number };
    expect(a.secondsToday).toBe(350);
    expect(a.goalMet).toBe(true);
    expect(a.sessionsToday).toBe(1);
  });

  it('is idempotent: resubmitting the same (session, word) does not double-apply or double-count time', async () => {
    const { app, makeKid, addWord } = await setup();
    const lina = await makeKid('Lina', '1234');
    const w1 = await addWord(lina.id, 'Sommer');
    const payload = {
      sessionId: 'dup',
      events: [{ wordId: w1, correct: true, durationMs: 120000, practicedAt: now() }],
    };
    const first = await app.handle(req('POST', `/api/kids/${lina.id}/practice`, payload, lina.cookie));
    expect(((await first.json()) as { applied: number }).applied).toBe(1);

    const second = await app.handle(req('POST', `/api/kids/${lina.id}/practice`, payload, lina.cookie));
    const r2 = (await second.json()) as { applied: number; skipped: number };
    expect(r2.applied).toBe(0);
    expect(r2.skipped).toBe(1);

    const today = await app.handle(req('GET', `/api/kids/${lina.id}/practice/today`, undefined, lina.cookie));
    expect(((await today.json()) as { secondsToday: number }).secondsToday).toBe(120);
  });

  it('rejects an event referencing another kid’s word (400) and cross-kid practice (403)', async () => {
    const { app, makeKid, addWord } = await setup();
    const lina = await makeKid('Lina', '1234');
    const max = await makeKid('Max', '4321');
    const maxWord = await addWord(max.id, 'Baum');

    // Lina submits Max's word under her own kid id → rolled back as 400.
    const bad = await app.handle(
      req(
        'POST',
        `/api/kids/${lina.id}/practice`,
        { sessionId: 'x', events: [{ wordId: maxWord, correct: true, durationMs: 1000, practicedAt: now() }] },
        lina.cookie,
      ),
    );
    expect(bad.status).toBe(400);

    // Lina pokes Max's practice endpoint → forbidden.
    const forbidden = await app.handle(
      req('GET', `/api/kids/${max.id}/practice/due`, undefined, lina.cookie),
    );
    expect(forbidden.status).toBe(403);
  });
});
