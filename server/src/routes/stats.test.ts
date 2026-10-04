// Zugriffsschutz der Statistik-Routen: Admin ja, Kid-Session 403, anonym 401.
import { describe, expect, it } from 'bun:test';
import { createApp } from '../app';
import { openDatabase } from '../db';
import { runMigrations } from '../migrations';
import { loadConfig } from '../config';

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
  await app.handle(req('PUT', `/api/kids/${kidId}/pin`, { pin: '1234' }, adminCookie));
  const login = await app.handle(req('POST', '/api/auth/kid-login', { name: 'Lina', pin: '1234' }));
  return { app, adminCookie, kidCookie: cookieFrom(login), kidId };
}

describe('stats routes (admin-only)', () => {
  it('admin erhält Overview + per-Kid-Statistiken', async () => {
    const { app, adminCookie, kidId } = await setup();

    const overview = await app.handle(req('GET', '/api/stats/overview', undefined, adminCookie));
    expect(overview.status).toBe(200);
    const zeilen = (await overview.json()) as { kid: { id: string } }[];
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.kid.id).toBe(kidId);

    for (const pfad of ['activity', 'streak', 'weak-words']) {
      const res = await app.handle(
        req('GET', `/api/kids/${kidId}/stats/${pfad}`, undefined, adminCookie),
      );
      expect(res.status).toBe(200);
    }
  });

  it('Kid-Session wird mit 403 abgewiesen, anonym mit 401', async () => {
    const { app, kidCookie, kidId } = await setup();

    const kidOverview = await app.handle(req('GET', '/api/stats/overview', undefined, kidCookie));
    expect(kidOverview.status).toBe(403);
    const kidActivity = await app.handle(
      req('GET', `/api/kids/${kidId}/stats/activity`, undefined, kidCookie),
    );
    expect(kidActivity.status).toBe(403);

    const anon = await app.handle(req('GET', '/api/stats/overview'));
    expect(anon.status).toBe(401);
  });

  it('unbekanntes Kind → 404', async () => {
    const { app, adminCookie } = await setup();
    const res = await app.handle(
      req('GET', '/api/kids/gibt-es-nicht/stats/streak', undefined, adminCookie),
    );
    expect(res.status).toBe(404);
  });
});
