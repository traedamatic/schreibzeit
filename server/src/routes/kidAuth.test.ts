import { describe, expect, it } from 'bun:test';
import { createApp } from '../app';
import { openDatabase } from '../db';
import { runMigrations } from '../migrations';
import { loadConfig } from '../config';
import { newId, now } from '../ids';

const BASE = 'http://localhost';

/** Fresh app + an admin cookie + one kid row (id returned) to work with. */
async function setup() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const app = createApp(db, loadConfig({}));

  const signup = await app.handle(
    new Request(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'parent@home.de', password: 'supersecret' }),
    }),
  );
  const adminCookie = (signup.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const kidId = newId();
  const t = now();
  db.query('INSERT INTO kids (id, name, lernstand, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    kidId,
    'Lina',
    'klasse2',
    t,
    t,
  );
  return { app, db, adminCookie, kidId };
}

function put(path: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request(`${BASE}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
}
function post(path: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
function get(path: string, cookie?: string): Request {
  return new Request(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
}
const cookieFrom = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

describe('kid auth', () => {
  it('admin sets a PIN, then the kid can log in and read its own profile', async () => {
    const { app, adminCookie, kidId } = await setup();

    const setPin = await app.handle(put(`/api/kids/${kidId}/pin`, { pin: '1234' }, adminCookie));
    expect(setPin.status).toBe(200);

    const login = await app.handle(post('/api/auth/kid-login', { name: 'Lina', pin: '1234' }));
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie') ?? '').toContain('sz_kid=');

    const me = await app.handle(get('/api/auth/kid-me', cookieFrom(login)));
    expect(me.status).toBe(200);
    const body = (await me.json()) as { name: string; dailyGoalSeconds: number };
    expect(body.name).toBe('Lina');
    expect(body.dailyGoalSeconds).toBe(300);
  });

  it('a non-admin cannot set a PIN (401)', async () => {
    const { app, kidId } = await setup();
    const res = await app.handle(put(`/api/kids/${kidId}/pin`, { pin: '1234' }));
    expect(res.status).toBe(401);
  });

  it('a wrong PIN is rejected generically, and lockout kicks in after 5 tries', async () => {
    const { app, adminCookie, kidId } = await setup();
    await app.handle(put(`/api/kids/${kidId}/pin`, { pin: '1234' }, adminCookie));

    for (let i = 0; i < 5; i++) {
      const bad = await app.handle(post('/api/auth/kid-login', { name: 'Lina', pin: '0000' }));
      expect(bad.status).toBe(401);
    }
    // Even the correct PIN is now locked out.
    const locked = await app.handle(post('/api/auth/kid-login', { name: 'Lina', pin: '1234' }));
    expect(locked.status).toBe(429);
  });

  it('kid-me is 401 without a kid session; a kid session cannot set a PIN', async () => {
    const { app, adminCookie, kidId } = await setup();
    await app.handle(put(`/api/kids/${kidId}/pin`, { pin: '4321' }, adminCookie));
    const login = await app.handle(post('/api/auth/kid-login', { name: 'Lina', pin: '4321' }));
    const kidCookie = cookieFrom(login);

    const anon = await app.handle(get('/api/auth/kid-me'));
    expect(anon.status).toBe(401);

    // Kid session must not reach the admin-only PIN endpoint.
    const denied = await app.handle(put(`/api/kids/${kidId}/pin`, { pin: '9999' }, kidCookie));
    expect(denied.status).toBe(401);
  });

  it('logout invalidates the kid session', async () => {
    const { app, adminCookie, kidId } = await setup();
    await app.handle(put(`/api/kids/${kidId}/pin`, { pin: '1111' }, adminCookie));
    const login = await app.handle(post('/api/auth/kid-login', { name: 'Lina', pin: '1111' }));
    const kidCookie = cookieFrom(login);

    const out = await app.handle(post('/api/auth/kid-logout', {}, kidCookie));
    expect(out.status).toBe(200);
    const me = await app.handle(get('/api/auth/kid-me', kidCookie));
    expect(me.status).toBe(401);
  });
});
