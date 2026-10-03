# Schreibzeit — Backend (`server/`)

Self-hosted API for the Schreibzeit family fork. Built on **Bun + Elysia + `bun:sqlite`**.
Server-only — the frontend (PWA/Electron) stays on Node/Vite and talks to this over HTTP.
See the repo root `CLAUDE.md` → "Runtime split".

> Status: ticket #1 — a running skeleton (health check, validated config, DB connection,
> tests, Dockerfile). Schema/auth/business endpoints follow in later tickets.

## Requirements

- [Bun](https://bun.com) ≥ 1.4

## Run

```bash
cd server
bun install
cp .env.example .env     # optional — defaults are fine for local dev
bun run dev              # hot-reload on http://localhost:3000
```

Check it:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","version":"0.1.0"}
```

## Configuration

Validated at startup (via Zod in `src/config.ts`); invalid values exit with a clear message.

| Env       | Default              | Description                               |
| --------- | -------------------- | ----------------------------------------- |
| `PORT`    | `3000`               | Port the API listens on                   |
| `DB_PATH` | `schreibzeit.sqlite` | SQLite file path (created if missing, WAL)|

## Test

```bash
bun test          # unit + smoke tests
bun run typecheck # tsc --noEmit
```

## Docker

```bash
docker build -t schreibzeit-api .
docker run --rm -p 3000:3000 -v schreibzeit-data:/data schreibzeit-api
```

The SQLite database is stored under `/data` (mount a volume to persist it).

## Layout

```
src/
  config.ts   validated env → typed Config (fail fast)
  db.ts       bun:sqlite connection bootstrap (WAL, foreign keys)
  app.ts      Elysia app factory; routes under /api
  index.ts    entry: load config → open db → listen
  *.test.ts   co-located tests (bun test)
```
