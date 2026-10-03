// Elysia application factory. Routes are grouped under `/api`. The database is
// injected (decorated) so later tickets' route modules can reach it without a
// module-level singleton — keeping handlers testable with an in-memory DB.
import { Elysia } from 'elysia';
import type { Database } from 'bun:sqlite';
import pkg from '../package.json';
import { loadConfig, type Config } from './config';
import { authRoutes } from './routes/auth';

/**
 * Build the API app around an open database connection.
 * Return type is intentionally inferred — Elysia threads route/decorator types
 * through its generic, which an explicit `Elysia` annotation would erase.
 */
export function createApp(db: Database, config: Config = loadConfig({})) {
  return new Elysia({ prefix: '/api' })
    .decorate('db', db)
    .get('/health', () => ({ status: 'ok' as const, version: pkg.version }))
    .use(authRoutes(db, config));
}
