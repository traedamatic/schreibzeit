import { describe, expect, it } from 'bun:test';
import { createApp } from '../app';
import { openDatabase } from '../db';
import { runMigrations } from '../migrations';
import { loadConfig } from '../config';
import { newId } from '../ids';

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

/** App with an admin cookie and a kid (id + its own kid cookie). */
async function setup() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const app = createApp(db, loadConfig({}));
  const signup = await app.handle(
    req('POST', '/api/auth/signup', { email: 'p@home.de', password: 'supersecret' }),
  );
  const adminCookie = cookieFrom(signup);

  async function makeKid(name: string, pin: string) {
    const created = await app.handle(
      req('POST', '/api/kids', { name, lernstand: 'klasse2' }, adminCookie),
    );
    const id = ((await created.json()) as { id: string }).id;
    await app.handle(req('PUT', `/api/kids/${id}/pin`, { pin }, adminCookie));
    const login = await app.handle(req('POST', '/api/auth/kid-login', { name, pin }));
    return { id, cookie: cookieFrom(login) };
  }

  return { app, db, adminCookie, makeKid };
}

describe('words API', () => {
  it('admin creates a word with repository defaults (fach 1, status neu)', async () => {
    const { app, adminCookie, makeKid } = await setup();
    const lina = await makeKid('Lina', '1234');
    const res = await app.handle(
      req(
        'POST',
        `/api/kids/${lina.id}/words`,
        { wort: 'Sommer', silben: ['Som', 'mer'], merkstellen: [2] },
        adminCookie,
      ),
    );
    expect(res.status).toBe(201);
    const word = (await res.json()) as {
      fach: number;
      status: string;
      silben: string[];
      merkstellen: number[];
      faelligAm: number;
    };
    expect(word.fach).toBe(1);
    expect(word.status).toBe('neu');
    expect(word.silben).toEqual(['Som', 'mer']);
    expect(word.merkstellen).toEqual([2]);
    expect(typeof word.faelligAm).toBe('number');
  });

  it('a kid can list/read its own words but cannot write them', async () => {
    const { app, adminCookie, makeKid } = await setup();
    const lina = await makeKid('Lina', '1234');
    const created = await app.handle(
      req('POST', `/api/kids/${lina.id}/words`, { wort: 'Haus' }, adminCookie),
    );
    const wordId = ((await created.json()) as { id: string }).id;

    const list = await app.handle(req('GET', `/api/kids/${lina.id}/words`, undefined, lina.cookie));
    expect(list.status).toBe(200);
    expect(((await list.json()) as unknown[]).length).toBe(1);

    const one = await app.handle(req('GET', `/api/words/${wordId}`, undefined, lina.cookie));
    expect(one.status).toBe(200);

    const write = await app.handle(
      req('POST', `/api/kids/${lina.id}/words`, { wort: 'Nope' }, lina.cookie),
    );
    expect(write.status).toBe(401);
  });

  it('a kid cannot read another kid’s words (cross-kid denied)', async () => {
    const { app, adminCookie, makeKid } = await setup();
    const lina = await makeKid('Lina', '1234');
    const max = await makeKid('Max', '4321');
    const created = await app.handle(
      req('POST', `/api/kids/${max.id}/words`, { wort: 'Baum' }, adminCookie),
    );
    const maxWordId = ((await created.json()) as { id: string }).id;

    const listOther = await app.handle(
      req('GET', `/api/kids/${max.id}/words`, undefined, lina.cookie),
    );
    expect(listOther.status).toBe(403);

    const readOther = await app.handle(req('GET', `/api/words/${maxWordId}`, undefined, lina.cookie));
    expect(readOther.status).toBe(403);
  });

  it('rejects an invalid status/artikel (400) and unauthenticated writes (401)', async () => {
    const { app, adminCookie, makeKid } = await setup();
    const lina = await makeKid('Lina', '1234');
    const bad = await app.handle(
      req('POST', `/api/kids/${lina.id}/words`, { wort: 'X', status: 'bogus' }, adminCookie),
    );
    expect(bad.status).toBe(400);

    const anon = await app.handle(req('POST', `/api/kids/${lina.id}/words`, { wort: 'X' }));
    expect(anon.status).toBe(401);
  });

  it('updates and deletes a word; bulk-delete removes many', async () => {
    const { app, adminCookie, makeKid } = await setup();
    const lina = await makeKid('Lina', '1234');
    const a = ((await (
      await app.handle(req('POST', `/api/kids/${lina.id}/words`, { wort: 'Apfel' }, adminCookie))
    ).json()) as { id: string }).id;
    const b = ((await (
      await app.handle(req('POST', `/api/kids/${lina.id}/words`, { wort: 'Birne' }, adminCookie))
    ).json()) as { id: string }).id;

    const upd = await app.handle(
      req('PUT', `/api/words/${a}`, { status: 'sitzt', artikel: 'der' }, adminCookie),
    );
    expect(((await upd.json()) as { status: string }).status).toBe('sitzt');

    const del = await app.handle(req('DELETE', `/api/words/${a}`, undefined, adminCookie));
    expect(del.status).toBe(200);

    const bulk = await app.handle(req('POST', '/api/words/bulk-delete', { ids: [b] }, adminCookie));
    expect(((await bulk.json()) as { deleted: number }).deleted).toBe(1);

    const list = await app.handle(req('GET', `/api/kids/${lina.id}/words`, undefined, adminCookie));
    expect(((await list.json()) as unknown[]).length).toBe(0);
  });

  it('404s when creating a word for a missing kid', async () => {
    const { app, adminCookie } = await setup();
    const res = await app.handle(
      req('POST', `/api/kids/${newId()}/words`, { wort: 'Haus' }, adminCookie),
    );
    expect(res.status).toBe(404);
  });
});
