// Tägliche Obergrenze pro Kind (#18): Admin setzt Ziel + Grenze; die Grenze darf
// nicht unter dem Ziel liegen; practice/today liefert capSeconds + capMet.
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
  return { app, db, adminCookie, kidId };
}

describe('Tägliche Obergrenze (#18)', () => {
  it('Default-Grenze ist 600 s (10 min)', async () => {
    const { app, adminCookie, kidId } = await setup();
    const kid = await app.handle(req('GET', `/api/kids/${kidId}`, undefined, adminCookie));
    expect(((await kid.json()) as { dailyCapSeconds: number }).dailyCapSeconds).toBe(600);
  });

  it('PUT setzt Ziel + Grenze pro Kind', async () => {
    const { app, adminCookie, kidId } = await setup();
    const res = await app.handle(
      req(
        'PUT',
        `/api/kids/${kidId}`,
        { dailyGoalSeconds: 300, dailyCapSeconds: 900 },
        adminCookie,
      ),
    );
    expect(res.status).toBe(200);
    const kid = (await res.json()) as { dailyGoalSeconds: number; dailyCapSeconds: number };
    expect(kid.dailyGoalSeconds).toBe(300);
    expect(kid.dailyCapSeconds).toBe(900);
  });

  it('Grenze unter dem Ziel → 400', async () => {
    const { app, adminCookie, kidId } = await setup();
    const res = await app.handle(
      req('PUT', `/api/kids/${kidId}`, { dailyGoalSeconds: 600, dailyCapSeconds: 300 }, adminCookie),
    );
    expect(res.status).toBe(400);
  });

  it('nicht-positive Grenze → 400', async () => {
    const { app, adminCookie, kidId } = await setup();
    const res = await app.handle(
      req('PUT', `/api/kids/${kidId}`, { dailyCapSeconds: 0 }, adminCookie),
    );
    expect(res.status).toBe(400);
  });

  it('practice/today liefert capSeconds und capMet', async () => {
    const { app, adminCookie, kidId } = await setup();
    await app.handle(
      req('PUT', `/api/kids/${kidId}`, { dailyGoalSeconds: 300, dailyCapSeconds: 600 }, adminCookie),
    );
    const wortRes = await app.handle(
      req('POST', `/api/kids/${kidId}/words`, { wort: 'Sommer' }, adminCookie),
    );
    const wortId = ((await wortRes.json()) as { id: string }).id;
    // 650 s üben → über der Grenze.
    await app.handle(
      req(
        'POST',
        `/api/kids/${kidId}/practice`,
        {
          sessionId: 'c-1',
          events: [{ wordId: wortId, correct: true, durationMs: 650_000, practicedAt: now() }],
        },
        adminCookie,
      ),
    );
    const today = await app.handle(
      req('GET', `/api/kids/${kidId}/practice/today`, undefined, adminCookie),
    );
    const stand = (await today.json()) as {
      capSeconds: number;
      capMet: boolean;
      goalMet: boolean;
    };
    expect(stand.capSeconds).toBe(600);
    expect(stand.capMet).toBe(true);
    expect(stand.goalMet).toBe(true);
  });
});
