// Familien-Isolation (#12): Admins sehen nur die Kinder ihrer eigenen Familie;
// fremde Familien erhalten 404 (Existenz wird nicht bestätigt).
//
// Hinweis: Über die API kann nur eine Familie entstehen (Signup ist nach dem
// ersten Admin admin-gated). Die zweite Familie wird daher direkt in der DB
// angelegt — die Isolation ist Defense-in-Depth für den Mehr-Familien-Fall.
import { describe, expect, it } from 'bun:test';
import { createApp } from '../app';
import { openDatabase } from '../db';
import { runMigrations } from '../migrations';
import { loadConfig } from '../config';
import { createAdmin, createFamily } from '../auth/admins';
import { createKid } from '../kids/data';
import { hashSecret } from '../auth/password';
import { newId, now } from '../ids';

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

/** Familie A über die API (Signup), Familie B direkt in der DB. */
async function setup() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const app = createApp(db, loadConfig({ TZ: 'UTC' }));

  // Familie A: regulärer Signup + Kind über die API.
  const signup = await app.handle(
    req('POST', '/api/auth/signup', { email: 'a@fam-a.de', password: 'supersecret' }),
  );
  const cookieA = cookieFrom(signup);
  const kidARes = await app.handle(
    req('POST', '/api/kids', { name: 'Lina', lernstand: 'klasse2' }, cookieA),
  );
  const kidA = ((await kidARes.json()) as { id: string }).id;

  // Familie B: direkt angelegt (zweite Familie ist via API absichtlich nicht möglich).
  const familieB = createFamily(db, 'Familie B');
  createAdmin(db, {
    email: 'b@fam-b.de',
    passwordHash: await hashSecret('supersecret'),
    displayName: null,
    familyId: familieB.id,
  });
  const kidB = createKid(db, { name: 'Max', lernstand: 'klasse3', familyId: familieB.id }).id;
  const wortB = newId();
  const t = now();
  db.query(
    'INSERT INTO words (id, kid_id, wort, status, fach, faellig_am, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
  ).run(wortB, kidB, 'Baum', 'neu', t, t, t);

  const loginB = await app.handle(
    req('POST', '/api/auth/login', { email: 'b@fam-b.de', password: 'supersecret' }),
  );
  const cookieB = cookieFrom(loginB);

  return { app, db, cookieA, cookieB, kidA, kidB, wortB };
}

describe('family isolation', () => {
  it('ein eingeladener Admin landet in der Familie des Einladenden und sieht dieselben Kinder', async () => {
    const { app, cookieA } = await setup();
    const invite = await app.handle(
      req('POST', '/api/auth/signup', { email: 'a2@fam-a.de', password: 'supersecret' }, cookieA),
    );
    expect(invite.status).toBe(201);
    const cookieA2 = cookieFrom(invite);

    const listeA2 = await app.handle(req('GET', '/api/kids', undefined, cookieA2));
    const kinder = (await listeA2.json()) as { name: string }[];
    expect(kinder.map((k) => k.name)).toEqual(['Lina']);
  });

  it('GET /api/kids und /api/stats/overview enthalten nur Kinder der eigenen Familie', async () => {
    const { app, cookieA, cookieB } = await setup();

    const listeA = (await (await app.handle(req('GET', '/api/kids', undefined, cookieA))).json()) as {
      name: string;
    }[];
    expect(listeA.map((k) => k.name)).toEqual(['Lina']);

    const listeB = (await (await app.handle(req('GET', '/api/kids', undefined, cookieB))).json()) as {
      name: string;
    }[];
    expect(listeB.map((k) => k.name)).toEqual(['Max']);

    const overviewA = (await (
      await app.handle(req('GET', '/api/stats/overview', undefined, cookieA))
    ).json()) as { kid: { name: string } }[];
    expect(overviewA.map((z) => z.kid.name)).toEqual(['Lina']);
  });

  it('fremde Kinder sind für Admin A unsichtbar: read/update/delete/pin/words/stats → 404', async () => {
    const { app, cookieA, kidB, wortB } = await setup();

    const faelle: [string, string, unknown?][] = [
      ['GET', `/api/kids/${kidB}`],
      ['PUT', `/api/kids/${kidB}`, { name: 'Gekapert' }],
      ['DELETE', `/api/kids/${kidB}`],
      ['PUT', `/api/kids/${kidB}/pin`, { pin: '9999' }],
      ['GET', `/api/kids/${kidB}/words`],
      ['POST', `/api/kids/${kidB}/words`, { wort: 'Hack' }],
      ['GET', `/api/words/${wortB}`],
      ['PUT', `/api/words/${wortB}`, { wort: 'Hack' }],
      ['DELETE', `/api/words/${wortB}`],
      ['GET', `/api/kids/${kidB}/practice/due`],
      ['GET', `/api/kids/${kidB}/practice/today`],
      ['GET', `/api/kids/${kidB}/stats/streak`],
    ];
    for (const [method, pfad, body] of faelle) {
      const res = await app.handle(req(method, pfad, body, cookieA));
      expect(`${method} ${pfad} -> ${res.status}`).toBe(`${method} ${pfad} -> 404`);
    }
  });

  it('bulk-delete ignoriert fremde Wort-ids stillschweigend', async () => {
    const { app, db, cookieA, wortB } = await setup();
    const res = await app.handle(req('POST', '/api/words/bulk-delete', { ids: [wortB] }, cookieA));
    expect(((await res.json()) as { deleted: number }).deleted).toBe(0);
    expect((db.query('SELECT COUNT(*) AS c FROM words;').get() as { c: number }).c).toBe(1);
  });

  it('Kid-Login mit gleichem Namen in zwei Familien: die PIN entscheidet', async () => {
    const { app, db, cookieA, kidA } = await setup();
    // Familie B bekommt ebenfalls eine „Lina" — mit anderer PIN.
    const familieB2 = createFamily(db, 'Familie C');
    const linaB = createKid(db, { name: 'Lina', lernstand: 'klasse4', familyId: familieB2.id });
    db.query('UPDATE kids SET pin_hash = ? WHERE id = ?;').run(
      await hashSecret('8888'),
      linaB.id,
    );
    await app.handle(req('PUT', `/api/kids/${kidA}/pin`, { pin: '1234' }, cookieA));

    const loginA = await app.handle(req('POST', '/api/auth/kid-login', { name: 'Lina', pin: '1234' }));
    expect(loginA.status).toBe(200);
    expect(((await loginA.json()) as { id: string }).id).toBe(kidA);

    const loginB = await app.handle(req('POST', '/api/auth/kid-login', { name: 'lina', pin: '8888' }));
    expect(loginB.status).toBe(200);
    expect(((await loginB.json()) as { id: string }).id).toBe(linaB.id);
  });
});
