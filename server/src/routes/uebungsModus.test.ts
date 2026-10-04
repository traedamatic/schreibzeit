// Übungsmodus „Nur Nomen" (#15): Admin setzt den Modus, der Due-Filter
// liefert dann ausschließlich Nomen (Artikel oder wortart), das Kind-Profil
// trägt den Modus.
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

  async function addWord(wort: string, extra: Record<string, unknown> = {}) {
    const res = await app.handle(
      req('POST', `/api/kids/${kidId}/words`, { wort, ...extra }, adminCookie),
    );
    return ((await res.json()) as { id: string }).id;
  }
  return { app, adminCookie, kidId, addWord };
}

describe('Übungsmodus „Nur Nomen" (#15)', () => {
  it('Default ist "alle"; PUT setzt den Modus; ungültiger Wert → 400', async () => {
    const { app, adminCookie, kidId } = await setup();

    const kid = await app.handle(req('GET', `/api/kids/${kidId}`, undefined, adminCookie));
    expect(((await kid.json()) as { uebungsModus: string }).uebungsModus).toBe('alle');

    const gesetzt = await app.handle(
      req('PUT', `/api/kids/${kidId}`, { uebungsModus: 'nomen' }, adminCookie),
    );
    expect(((await gesetzt.json()) as { uebungsModus: string }).uebungsModus).toBe('nomen');

    const ungueltig = await app.handle(
      req('PUT', `/api/kids/${kidId}`, { uebungsModus: 'quatsch' }, adminCookie),
    );
    expect(ungueltig.status).toBe(400);
  });

  it('due liefert im Modus "nomen" nur Nomen (Artikel ODER wortart), sonst alles', async () => {
    const { app, adminCookie, kidId, addWord } = await setup();
    await addWord('Apfel', { artikel: 'der' }); // Nomen via Artikel
    await addWord('Fahrrad', { wortart: 'Nomen' }); // Nomen via wortart
    await addWord('laufen'); // kein Nomen-Signal

    const alle = await app.handle(req('GET', `/api/kids/${kidId}/practice/due`, undefined, adminCookie));
    expect(((await alle.json()) as { wort: string }[]).map((w) => w.wort).sort()).toEqual([
      'Apfel',
      'Fahrrad',
      'laufen',
    ]);

    await app.handle(req('PUT', `/api/kids/${kidId}`, { uebungsModus: 'nomen' }, adminCookie));
    const nurNomen = await app.handle(
      req('GET', `/api/kids/${kidId}/practice/due`, undefined, adminCookie),
    );
    expect(((await nurNomen.json()) as { wort: string }[]).map((w) => w.wort).sort()).toEqual([
      'Apfel',
      'Fahrrad',
    ]);
  });

  it('kid-me trägt den Übungsmodus (für die Startkarte des Schüler-Clients)', async () => {
    const { app, adminCookie, kidId } = await setup();
    await app.handle(req('PUT', `/api/kids/${kidId}`, { uebungsModus: 'nomen' }, adminCookie));
    await app.handle(req('PUT', `/api/kids/${kidId}/pin`, { pin: '1234' }, adminCookie));
    const login = await app.handle(req('POST', '/api/auth/kid-login', { name: 'Lina', pin: '1234' }));
    const me = await app.handle(
      new Request(`${BASE}/api/auth/kid-me`, { headers: { cookie: cookieFrom(login) } }),
    );
    expect(((await me.json()) as { uebungsModus: string }).uebungsModus).toBe('nomen');
  });
});
