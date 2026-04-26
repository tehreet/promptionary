# Promptionary

Pictionary, in reverse. An AI generates an image from a secret prompt; players guess the prompt.

Live at [promptionary.io](https://promptionary.io).

## Setup

1. `bun install`
2. Copy `.env.local.example` to `.env.local` and fill in keys (see comments in the example)
3. `bun dev`

## Stack

- Next.js 16 + App Router
- Tailwind v4 + shadcn/ui (base-nova style on Base UI primitives)
- Supabase (Postgres, Auth, Realtime, Storage)
- Gemini 2.5 Flash (prompt authoring) + Gemini 3.1 Flash Image Preview (image gen, with `gemini-2.5-flash-image` fallback) + `gemini-embedding-001` (scoring)
- Bun runtime, Playwright e2e, Vitest unit tests
- Hosted on Vercel

## Supabase

Linked to the `promptionary` project (ref `cuevgbducxnbdslbhlxe`). Migrations in `supabase/migrations/` are the source of truth.

- `supabase db push` — apply local migrations to the linked project
- `supabase gen types typescript --linked --schema public > lib/supabase/types.ts` — regenerate TS types
- Anonymous sign-ins and Realtime replication (replica identity FULL on the gameplay tables, `supabase_realtime` publication on `rooms`, `room_players`, `rounds`, `guesses`, `room_messages`) are already enabled

## Tests

- `bun test:unit` — Vitest unit suite (`tests/unit/`); fast, no DB
- `bun test:e2e` — Playwright against the production deployment (default `https://promptionary-three.vercel.app`)
- `bun test:e2e:local` — Playwright against `http://localhost:3000` (run `bun dev` in another terminal first)
- See `playwright.config.ts` for `PROMPTIONARY_TEST_URL` and `PROMPTIONARY_MOCK_GEMINI` knobs

## Architecture

See [`AGENTS.md`](./AGENTS.md) for the live architecture, conventions, gotchas, and the full feature/test list. It's the load-bearing doc — keep it ahead of this README.

## Plans

Implementation plans live in `docs/superpowers/plans/` as historical context — Phases 1–4 (foundation, lobby, round engine, landing) all shipped in April 2026 and the docs there have not been updated since. For the live state of the codebase, read `AGENTS.md`.
