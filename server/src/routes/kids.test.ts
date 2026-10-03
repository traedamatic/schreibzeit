import { describe, expect, it } from 'bun:test';
import { createApp } from '../app';
import { openDatabase } from '../db';
import { runMigrations } from '../migrations';
import { loadConfig } from '../config';
import { newId, now } from '../ids';

const BASE = 'http://localhost';

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
  return { app, db, adminCookie };
}

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

describe('kids CRUD', () => {
  it('rejects unauthenticated access', async () => {
    const { app } = await setup();
    const res = await app.handle(req('GET', '/api/kids'));
    expect(res.status).toBe(401);
  });

  it('creates, lists, gets, and updates a kid', async () => {
    const { app, adminCookie } = await setup();

    const created = await app.handle(
      req('POST', '/api/kids', { name: 'Lina', lernstand: 'klasse2' }, adminCookie),
    );
    expect(created.status).toBe(201);
    const kid = (await created.json()) as { id: string; dailyGoalSeconds: number };
    expect(kid.dailyGoalSeconds).toBe(300);

    const list = await app.handle(req('GET', '/api/kids', undefined, adminCookie));
    expect(((await list.json()) as unknown[]).length).toBe(1);

    const one = await app.handle(req('GET', `/api/kids/${kid.id}`, undefined, adminCookie));
    expect(one.status).toBe(200);

    const updated = await app.handle(
      req('PUT', `/api/kids/${kid.id}`, { lernstand: 'lrs', dailyGoalSeconds: 600 }, adminCookie),
    );
    const body = (await updated.json()) as { lernstand: string; dailyGoalSeconds: number };
    expect(body.lernstand).toBe('lrs');
    expect(body.dailyGoalSeconds).toBe(600);
  });

  it('rejects an invalid lernstand (400) and a non-positive goal (400)', async () => {
    const { app, adminCookie } = await setup();
    const bad = await app.handle(
      req('POST', '/api/kids', { name: 'X', lernstand: 'klasse9' }, adminCookie),
    );
    expect(bad.status).toBe(400);
    const badGoal = await app.handle(
      req('POST', '/api/kids', { name: 'Y', lernstand: 'klasse1', dailyGoalSeconds: 0 }, adminCookie),
    );
    expect(badGoal.status).toBe(400);
  });

  it('404s for a missing kid', async () => {
    const { app, adminCookie } = await setup();
    const res = await app.handle(req('GET', `/api/kids/${newId()}`, undefined, adminCookie));
    expect(res.status).toBe(404);
  });

  it('delete cascades to words and practice_events', async () => {
    const { app, db, adminCookie } = await setup();
    const created = await app.handle(
      req('POST', '/api/kids', { name: 'Max', lernstand: 'klasse3' }, adminCookie),
    );
    const kidId = ((await created.json()) as { id: string }).id;

    const wordId = newId();
    const t = now();
    db.query(
      'INSERT INTO words (id, kid_id, wort, status, fach, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(wordId, kidId, 'Baum', 'neu', 1, t, t);
    db.query(
      'INSERT INTO practice_events (id, kid_id, word_id, session_id, correct, duration_ms, practiced_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(newId(), kidId, wordId, 's1', 1, 1000, t);

    const del = await app.handle(req('DELETE', `/api/kids/${kidId}`, undefined, adminCookie));
    expect(del.status).toBe(200);
    expect((db.query('SELECT COUNT(*) AS c FROM words;').get() as { c: number }).c).toBe(0);
    expect((db.query('SELECT COUNT(*) AS c FROM practice_events;').get() as { c: number }).c).toBe(0);
  });

  it('a kid session cannot touch /api/kids', async () => {
    const { app, db, adminCookie } = await setup();
    const created = await app.handle(
      req('POST', '/api/kids', { name: 'Lina', lernstand: 'klasse2' }, adminCookie),
    );
    const kidId = ((await created.json()) as { id: string }).id;
    await app.handle(req('PUT', `/api/kids/${kidId}/pin`, { pin: '1234' }, adminCookie));
    const login = await app.handle(req('POST', '/api/auth/kid-login', { name: 'Lina', pin: '1234' }));
    const kidCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const res = await app.handle(req('GET', '/api/kids', undefined, kidCookie));
    expect(res.status).toBe(401);
    void db;
  });
});
