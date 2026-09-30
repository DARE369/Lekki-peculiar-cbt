# Lekki Peculiar CBT

Computer-based testing for Lekki Peculiar School: an exam terminal for the computer lab, a teacher console and an admin console.

- **Plan & scope:** [docs/PLAN.md](docs/PLAN.md)
- **Deploying (Supabase + Vercel) and exam-day checklist:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## What's in it

| Area | Highlights |
|---|---|
| **Exam terminal** (`/exam`) | Registered lab PCs only · login by admission number (typos tolerated) or class → name → photo · “Is this you?” · waits for the admin's Start · timer keeps running · answers saved on the PC and synced in the background · survives outages, reloads and offline submission · flags, palette, keyboard answers · score/corrections per teacher setting |
| **Teachers** | Request classes/subjects · shared question bank · upload Excel, CSV, plain text (Aiken) or JSON with preview · tests (20 q) / exams (40 q) / mocks / practice with settings (shuffle, must-answer-all, flagging, back navigation, what students see) · submit for approval |
| **Heads of Section** | Approve & schedule per class · live monitor: Start/Pause/Close, extra time, unlock another PC, void, make-ups · students with bulk CSV + photo zip · teaching assignments · classes & subjects · lab computers · audit log |
| **Super admin** | Staff, roles, section scopes and granular permissions (e.g. who may grant make-ups) · sessions & terms |
| **Reports** | Per test: positions, stats, distribution, hardest questions, most-chosen wrong option, fix-answer-key + regrade, integrity signals · class broadsheet (students × subjects, drill into a subject) · student record with every missed question · CSV/print |

Security: row-level security on every table, section-scoped admins, frozen question papers after approval, answers immutable after submission, answer keys never sent to the browser, append-only audit log.

## Stack

Next.js 16 (App Router, TypeScript) on Vercel · Supabase (Postgres + RLS, Auth, Storage) · Tailwind CSS 4 · Zod · IndexedDB + service worker for offline exams · Vitest + Playwright.

## Development

```bash
pnpm install
cp .env.example .env.local   # fill in a Supabase project (or the local stack below)
pnpm dev
```

Checks:

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit tests
pnpm test:db                                # migrations + RLS + full exam flow on a local Postgres (needs psql, PGHOST/PGPORT)
```

### Local Supabase without Docker

`scripts/local-supabase/start.sh` runs Postgres 16 + PostgREST + GoTrue behind a small gateway (storage/photos not emulated) and prints the `.env.local` values. The Playwright suite in `e2e/` drives the whole school workflow against it:

```bash
PGHOST=/path/to/pg/socket PGPORT=5432 scripts/local-supabase/start.sh
pnpm build && pnpm start &
e2e/run.sh
```

## Layout

```
src/app/(staff)/     teacher, admin and report pages (server components + server actions)
src/app/exam/        student exam terminal (client app)
src/app/api/exam/    exam API for lab computers
src/components/exam/ exam runner, offline store and sync engine
src/lib/             auth, data access, importers, report calculations
supabase/migrations/ schema, RLS policies, workflow & exam SQL functions
supabase/tests/      database tests
e2e/                 Playwright end-to-end tests
```
