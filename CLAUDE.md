# Schreibzeit (traedamatic fork)

Fork of Schreibzeit being rebuilt for **family use**: one shared source of truth for a
kid's spelling practice across two separated-parent households and phones, with real
"did they practice?" visibility, time tracking, and (later) gamification.

Upstream (`larszu/schreibzeit`) is a local-first, serverless app for teachers. This fork
keeps that app as the **admin/parent client** and adds a synced backend so both households
see the same data. See `docs/` for upstream product docs.

## Direction / Roadmap

- **Family-only** (own children, own server → GDPR household exemption; not a multi-tenant product).
- **Self-hosted** on own server (Hetzner + Docker-Compose + Traefik tooling available).
- **Two roles only:** `admin` (parent/teacher/mentor collapsed into one) and `kid`.
- **Server-authoritative sync**, Dexie kept as a local cache so practice still works offline.
- The upstream **"teacher" view = the parent/admin view** — keep all print/PDF/card-download
  features (paper practice stays central; screen practice is additive).
- The old `#ueben=` payload-in-URL link gets replaced by **account-backed kid login** so
  practice completion + time are tracked server-side.
- Staged: (1) backend + sync, (2) kid login + synced practice, (3) parent dashboard, (4) gamification + LRS tips.

## Architecture

- **Frontend (existing, unchanged toolchain):** React 19 + TypeScript, Vite 8, Tailwind v4,
  Zustand + Dexie (IndexedDB) live-queries, PWA, Electron desktop. Print pipeline = dedicated
  print-CSS (A4-landscape, mm lineatur). Layers: `src/core` (pure logic) · `src/db`
  (persistence via `Repository` interface) · `src/services` · `src/views` · `src/schueler`
  (kid client) · `electron/`.
- **Backend (new, to be built):** **Bun + Elysia + `bun:sqlite`**, self-hosted. The
  `Repository` interface (`src/db/repository.ts`) is the seam for the remote adapter. Typed
  client via Elysia's Eden.

## Development

Frontend (run from repo root):

```bash
npm install
npm run dev         # Vite dev server → localhost:5173
npm run lint        # eslint, zero warnings
npm test            # Vitest (test command for the engineer loop)
npm run build       # tsc --noEmit && vite build
npm run electron:dev
```

Backend (once `server/` exists): `bun install`, `bun --hot`, `bun test`.

## Coding Conventions

See [`code_guidelines.md`](./code_guidelines.md) for full standards (defensive programming,
validate-at-boundaries with Zod, security defense-in-depth, coverage floors). Key points:

- **TypeScript strict mode** — no `any`, prefer `unknown`. Path alias `@/*` → `./src/*`.
- `const` over `let`, never `var`. `async/await` over promise chains. Early returns.
- Named exports preferred. DRY, single responsibility, composition over inheritance.

### Runtime split — important

- **Frontend stays on Node / Vite / Vitest.** Electron cannot run on Bun, so the desktop +
  PWA clients and their tests remain Node-based. Do **not** Bun-ify the frontend or swap
  Vitest for `bun test`.
- **Bun conventions apply to the `server/` backend only:** use Bun APIs (`Bun.serve`,
  `Bun.file`, `bun:sqlite`), `bun test`, `bun --hot`. `bun:sqlite` lives on the server
  only — never on-device.

## GitHub Project

> **Required for `/el-create-ticket` and `/el-dev-loop` commands.**

- **Owner**: `traedamatic`
- **Repository**: `schreibzeit`
- **Project Number**: `7`
- **Project URL**: https://github.com/users/traedamatic/projects/7
- **Project ID**: `PVT_kwHOAAK5Cs4BllZh`
- **Status Field ID**: `PVTSSF_lAHOAAK5Cs4BllZhzhkRr3w`
- **Status Options**:
  - Todo: `1ffd600f`
  - In Progress: `a4dd6fe2`
  - Done: `27a4e671`

> The board also has Backlog / Ready / In review columns for manual use; the engineer loop
> only touches Todo → In progress → Done.
