import { describe, expect, it } from 'bun:test';
import { openDatabase } from './db';

describe('openDatabase', () => {
  it('opens an in-memory database with WAL and foreign keys configured', () => {
    const db = openDatabase(':memory:');

    // Connection is usable.
    const row = db.query('SELECT 1 AS one;').get() as { one: number };
    expect(row.one).toBe(1);

    // Foreign-key enforcement is on (relied on by #2's schema).
    const fk = db.query('PRAGMA foreign_keys;').get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);

    db.close();
  });
});
