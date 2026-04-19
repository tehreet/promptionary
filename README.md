# Promptionary

Pictionary, in reverse. An AI generates an image from a secret prompt; players guess the prompt.

## Setup

1. `bun install`
2. Copy `.env.local.example` to `.env.local` and fill in keys (see comments in the example)
3. `bun dev`

## Stack

- Next.js 16 + App Router + Turbopack
- Tailwind v4 + shadcn/ui
- Supabase (Postgres, Auth, Realtime, Storage)
- Gemini 2.5 Flash (prompt authoring) + Gemini 3.1 Flash Image Preview (image gen) + `text-embedding-004` (scoring)

## Supabase

Linked to the `promptionary` project (ref `cuevgbducxnbdslbhlxe`). Migrations in `supabase/migrations/` are the source of truth.

- `supabase db push` — apply local migrations to the linked project
- `supabase gen types typescript --linked --schema public > lib/supabase/types.ts` — regenerate TS types
- Anonymous sign-ins and Realtime replication on `rooms`, `room_players`, `rounds`, `guesses` are already enabled

## Plans

Implementation plans live in `docs/superpowers/plans/`. Phase 1 (foundation + schema) is complete; Phases 2-4 are outlined at the bottom of the Phase 1 plan.
