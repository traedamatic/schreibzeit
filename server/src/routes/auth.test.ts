import { describe, expect, it } from 'bun:test';
import { createApp } from '../app';
import { openDatabase } from '../db';
import { runMigrations } from '../migrations';
import { loadConfig } from '../config';
import { now } from '../ids';

const BASE = 'http://localhost';

function makeApp() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const app = createApp(db, loadConfig({}));
  return { app, db };
}

/** First `name=value` pair from a Set-Cookie header, for resending as `Cookie`. */
function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0] ?? '';
}

function post(path: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

function get(path: string, cookie?: string): Request {
  return new Request(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
}

describe('admin auth', () => {
  it('first signup (no admin yet) creates an admin and sets a session cookie', async () => {
    const { app } = makeApp();
    const res = await app.handle(post('/api/auth/signup', { email: 'a@b.de', password: 'supersecret' }));
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie') ?? '').toContain('sz_admin=');
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe('a@b.de');
  });

  it('me returns the admin with a valid cookie, 401 without', async () => {
    const { app } = makeApp();
    const signup = await app.handle(post('/api/auth/signup', { email: 'a@b.de', password: 'supersecret' }));
    const cookie = cookieFrom(signup);

    const me = await app.handle(get('/api/auth/me', cookie));
    expect(me.status).toBe(200);

    const anon = await app.handle(get('/api/auth/me'));
    expect(anon.status).toBe(401);
  });

  it('blocks anonymous signup once an admin exists (403)', async () => {
    const { app } = makeApp();
    await app.handle(post('/api/auth/signup', { email: 'a@b.de', password: 'supersecret' }));
    const second = await app.handle(post('/api/auth/signup', { email: 'c@d.de', password: 'anotherpass' }));
    expect(second.status).toBe(403);
  });

  it('login rejects a wrong password (401) and accepts the right one', async () => {
    const { app } = makeApp();
    await app.handle(post('/api/auth/signup', { email: 'a@b.de', password: 'supersecret' }));

    const bad = await app.handle(post('/api/auth/login', { email: 'a@b.de', password: 'nope-nope' }));
    expect(bad.status).toBe(401);

    const good = await app.handle(post('/api/auth/login', { email: 'a@b.de', password: 'supersecret' }));
    expect(good.status).toBe(200);
    expect(good.headers.get('set-cookie') ?? '').toContain('sz_admin=');
  });

  it('logout invalidates the session', async () => {
    const { app } = makeApp();
    const signup = await app.handle(post('/api/auth/signup', { email: 'a@b.de', password: 'supersecret' }));
    const cookie = cookieFrom(signup);

    const out = await app.handle(post('/api/auth/logout', {}, cookie));
    expect(out.status).toBe(200);

    const me = await app.handle(get('/api/auth/me', cookie));
    expect(me.status).toBe(401);
  });

  it('rejects an expired session (fail closed)', async () => {
    const { app, db } = makeApp();
    const signup = await app.handle(post('/api/auth/signup', { email: 'a@b.de', password: 'supersecret' }));
    const adminId = ((await signup.json()) as { id: string }).id;

    const token = 'expired-token';
    db.query(
      `INSERT INTO auth_sessions (id, subject_type, subject_id, created_at, expires_at, last_seen_at)
       VALUES (?, 'admin', ?, ?, ?, ?)`,
    ).run(token, adminId, now() - 1000, now() - 1, now() - 1000);

    const me = await app.handle(get('/api/auth/me', `sz_admin=${token}`));
    expect(me.status).toBe(401);
  });
});
