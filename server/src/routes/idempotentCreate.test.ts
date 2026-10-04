// Offline-first sync replays creates with client-supplied ids — a resent
// create must return the existing row instead of duplicating or failing.
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

async function setup() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const app = createApp(db, loadConfig({}));
  const signup = await app.handle(
    req('POST', '/api/auth/signup', { email: 'p@home.de', password: 'supersecret' }),
  );
  const adminCookie = (signup.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { app, db, adminCookie };
}

describe('idempotent create with client-supplied id', () => {
  it('kid create with the same id twice yields one row and returns the existing kid', async () => {
    const { app, db, adminCookie } = await setup();
    const payload = { id: 'client-kid-1', name: 'Lina', lernstand: 'klasse2' };

    const first = await app.handle(req('POST', '/api/kids', payload, adminCookie));
    expect(first.status).toBe(201);

    const second = await app.handle(
      req('POST', '/api/kids', { ...payload, name: 'Lina geändert' }, adminCookie),
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { id: string; name: string };
    expect(body.id).toBe('client-kid-1');
    // Replay returns the stored row — it does not overwrite.
    expect(body.name).toBe('Lina');
    expect((db.query('SELECT COUNT(*) AS c FROM kids;').get() as { c: number }).c).toBe(1);
  });

  it('word create with the same id twice yields one row', async () => {
    const { app, db, adminCookie } = await setup();
    const kidRes = await app.handle(
      req('POST', '/api/kids', { name: 'Max', lernstand: 'klasse3' }, adminCookie),
    );
    const kidId = ((await kidRes.json()) as { id: string }).id;

    const payload = { id: 'client-word-1', wort: 'Baum' };
    const first = await app.handle(req('POST', `/api/kids/${kidId}/words`, payload, adminCookie));
    expect(first.status).toBe(201);

    const second = await app.handle(req('POST', `/api/kids/${kidId}/words`, payload, adminCookie));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { id: string }).id).toBe('client-word-1');
    expect((db.query('SELECT COUNT(*) AS c FROM words;').get() as { c: number }).c).toBe(1);
  });
});
