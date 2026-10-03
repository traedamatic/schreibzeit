import { describe, expect, it } from 'bun:test';
import { openDatabase } from './db';
import { runMigrations } from './migrations';
import { newId, now } from './ids';

function freshDb() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

describe('runMigrations', () => {
  it('creates all core tables + indexes on a fresh database', () => {
    const db = freshDb();
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ['admins', 'auth_sessions', 'kids', 'practice_events', 'words']) {
      expect(tables).toContain(t);
    }
    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%';")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(indexes).toContain('idx_words_kid');
    expect(indexes).toContain('idx_events_practiced_at');
    db.close();
  });

  it('is idempotent — second run is a no-op at the same version', () => {
    const db = openDatabase(':memory:');
    const v1 = runMigrations(db);
    const v2 = runMigrations(db);
    expect(v1).toBe(1);
    expect(v2).toBe(1);
    db.close();
  });

  it('enforces foreign keys — a word with an unknown kid is rejected', () => {
    const db = freshDb();
    const t = now();
    expect(() =>
      db
        .query(
          'INSERT INTO words (id, kid_id, wort, status, fach, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(newId(), 'does-not-exist', 'Haus', 'neu', 1, t, t),
    ).toThrow();
    db.close();
  });

  it('cascades — deleting a kid removes its words and practice_events', () => {
    const db = freshDb();
    const kid = newId();
    const word = newId();
    const t = now();
    db.query('INSERT INTO kids (id, name, lernstand, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      kid,
      'Lina',
      'klasse2',
      t,
      t,
    );
    db.query(
      'INSERT INTO words (id, kid_id, wort, status, fach, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(word, kid, 'Haus', 'neu', 1, t, t);
    db.query(
      'INSERT INTO practice_events (id, kid_id, word_id, session_id, correct, duration_ms, practiced_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(newId(), kid, word, 's1', 1, 1000, t);

    db.query('DELETE FROM kids WHERE id = ?').run(kid);

    expect((db.query('SELECT COUNT(*) AS c FROM words;').get() as { c: number }).c).toBe(0);
    expect((db.query('SELECT COUNT(*) AS c FROM practice_events;').get() as { c: number }).c).toBe(0);
    db.close();
  });

  it('rejects a duplicate (session_id, word_id) practice event', () => {
    const db = freshDb();
    const kid = newId();
    const word = newId();
    const t = now();
    db.query('INSERT INTO kids (id, name, lernstand, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      kid,
      'Max',
      'klasse3',
      t,
      t,
    );
    db.query(
      'INSERT INTO words (id, kid_id, wort, status, fach, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(word, kid, 'Baum', 'neu', 1, t, t);
    const insertEvent = () =>
      db
        .query(
          'INSERT INTO practice_events (id, kid_id, word_id, session_id, correct, duration_ms, practiced_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(newId(), kid, word, 'sess-1', 1, 500, t);
    insertEvent();
    expect(insertEvent).toThrow();
    db.close();
  });
});
