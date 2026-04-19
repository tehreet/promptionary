# Promptionary MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a playable vertical slice of Promptionary — anonymous users create a room with a 4-letter code, join, see an AI-generated image, submit guesses in a timed round, get role-weighted scores against the secret prompt, and advance through rounds. Party mode only. Vibrant bright UI (blues/pinks/purples). Deployed to promptionary.io.

**Architecture:** Next.js 15 App Router on Vercel. Supabase for Postgres, Auth (anonymous), Storage (images), Realtime (presence + broadcasts). Gemini 2.5 Flash authors the secret prompt *and* tags each word as subject/style/modifier/filler in one call. NanoBanana 2 (Gemini 3.1 Flash Image Preview) generates the image. `text-embedding-004` for semantic-similarity scoring (computed in-memory in a Vercel server action, not stored in DB — trim from Claude App's brief).

**Tech Stack:**
- Next.js 15 (App Router, Server Actions, React 19), TypeScript, Turbopack
- Tailwind v4 + shadcn/ui
- Supabase: Postgres 15, Auth (anonymous), Realtime, Storage
- `@supabase/ssr` for Next.js cookie-based auth
- `@google/genai` SDK for Gemini (text, image, embeddings)
- Vercel deployment, promptionary.io domain via Namecheap → Vercel

**What's deferred vs. Claude App's brief** (trimmed for MVP, see `chat.txt` context):
- No pg_cron tick / pg_net webhooks — Vercel server actions drive phase transitions for v1. Add cron as a disconnection safety net in v2.
- No Vault secrets — env vars on Vercel are fine until webhooks exist.
- No `teams` table, no `pooled_tokens_mode` boolean — but the `room_mode` enum ships with `'party' | 'teams' | 'headsup'` so adding later is non-breaking.
- No stored `guess_embedding` / `prompt_embedding` columns, no pgvector HNSW indexes — scoring happens in-memory in the Vercel scoring server action. Keep the `vector` extension enabled so we can add columns later without a migration.
- No realtime-broadcast triggers — use Supabase Realtime Postgres Changes on `rooms` / `rounds` / `guesses` for v1; switch to broadcast channels if scale demands it.

**Phasing:**
- **Phase 1: Foundation + Schema** *(this plan)* — scaffold Next.js + shadcn, provision Supabase schema, deploy hello-world to Vercel preview, wire env vars.
- **Phase 2: Lobby** *(separate plan)* — anonymous auth, create/join room UI, presence, host controls.
- **Phase 3: Round Engine** *(separate plan)* — `start_round` → Gemini prompt + image gen → guess submission → `finalize_round` scoring → reveal → next round.
- **Phase 4: Landing + Domain** *(separate plan)* — vibrant landing page, promptionary.io DNS, production deploy.

**Playable after Phase 3.** Phase 4 is polish + go-live.

---

## Phase 1 — Foundation + Schema

All tasks in this phase land in a single PR titled `feat: phase 1 foundation + schema`.

### File Structure (end state after Phase 1)

```
promptionary/
├── app/
│   ├── layout.tsx                # Root layout, font + tailwind
│   ├── page.tsx                  # Placeholder "hello world" landing
│   └── globals.css               # Tailwind + CSS variables for design tokens
├── components/
│   └── ui/                       # shadcn components (button only for now)
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser Supabase client
│   │   ├── server.ts             # Server Supabase client (cookies)
│   │   └── types.ts              # Generated DB types (from `supabase gen types`)
│   └── env.ts                    # Zod-validated env vars
├── supabase/
│   ├── config.toml               # CLI config (already exists)
│   └── migrations/
│       └── 20260419000000_init.sql   # Phase 1 schema
├── .env.local.example            # Documented env vars
├── .gitignore
├── components.json               # shadcn config
├── next.config.ts
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── README.md                     # Updated with setup instructions
```

---

### Task 1: Prep repo for Next.js scaffold

**Files:**
- Move: `README.md` → out of the way temporarily (create-next-app conflicts)

- [ ] **Step 1: Stash the existing README**

Run:
```
mv README.md README.stash.md
```

- [ ] **Step 2: Confirm only `supabase/` remains to coexist with Next scaffold**

Run:
```
ls -la
```
Expected: `supabase/`, `.git/`, `README.stash.md` — no other project files.

---

### Task 2: Scaffold Next.js 15 + Tailwind v4

**Files:**
- Create: entire Next.js app structure

- [ ] **Step 1: Run create-next-app into the current directory**

Run:
```
bunx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --turbopack --use-bun --yes
```
Expected: creates `app/`, `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts` (or CSS-based config for v4), `postcss.config.mjs`, `.gitignore`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `public/`, `node_modules/`.

- [ ] **Step 2: Restore the project README**

Run:
```
mv README.stash.md README.md
```

- [ ] **Step 3: Verify dev server boots**

Run:
```
bun dev
```
Expected: starts on :3000, open http://localhost:3000, see default Next.js welcome. Ctrl+C to stop.

- [ ] **Step 4: Commit the scaffold**

Run:
```
git add -A
git commit -m "chore: scaffold next.js 15 app"
```

---

### Task 3: Install shadcn/ui with a button (proof of install)

**Files:**
- Create: `components.json`, `components/ui/button.tsx`, `lib/utils.ts`

- [ ] **Step 1: Init shadcn**

Run:
```
bunx shadcn@latest init -d
```
Expected: prompts for style/color; accept defaults (New York, Neutral base). Creates `components.json`, `lib/utils.ts`, updates `app/globals.css` with CSS variable theme.

- [ ] **Step 2: Add Button component**

Run:
```
bunx shadcn@latest add button
```
Expected: creates `components/ui/button.tsx`.

- [ ] **Step 3: Commit**

Run:
```
git add -A
git commit -m "chore: add shadcn/ui with button primitive"
```

---

### Task 4: Env var validation with zod

**Files:**
- Create: `lib/env.ts`, `.env.local.example`

- [ ] **Step 1: Install zod**

Run:
```
bun add zod
```

- [ ] **Step 2: Create `lib/env.ts`**

```ts
import { z } from "zod";

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GOOGLE_GENAI_API_KEY: z.string().min(1),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export const serverEnv =
  typeof window === "undefined" ? serverSchema.parse(process.env) : null;

export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
```

- [ ] **Step 3: Create `.env.local.example`**

```
# Supabase — get from https://supabase.com/dashboard/project/cuevgbducxnbdslbhlxe/settings/api
NEXT_PUBLIC_SUPABASE_URL=https://cuevgbducxnbdslbhlxe.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google GenAI (Gemini text + image + embeddings)
# https://aistudio.google.com/apikey
GOOGLE_GENAI_API_KEY=
```

- [ ] **Step 4: Commit**

Run:
```
git add -A
git commit -m "feat: add env var validation"
```

---

### Task 5: Supabase client helpers

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`

- [ ] **Step 1: Install Supabase packages**

Run:
```
bun add @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Create `lib/supabase/client.ts`**

```ts
"use client";
import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
```

- [ ] **Step 3: Create `lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    serverEnv!.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv!.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookies) => {
          try {
            cookies.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // server component — ignore
          }
        },
      },
    },
  );
}

export function createSupabaseServiceClient() {
  return createServerClient(
    serverEnv!.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv!.SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: { getAll: () => [], setAll: () => {} },
    },
  );
}
```

- [ ] **Step 4: Commit**

Run:
```
git add -A
git commit -m "feat: add supabase client helpers"
```

---

### Task 6: Write Phase 1 schema migration

**Files:**
- Create: `supabase/migrations/20260419000000_init.sql`

- [ ] **Step 1: Generate the migration file with the CLI**

Run:
```
supabase migration new init
```
Expected: creates `supabase/migrations/<timestamp>_init.sql` (actual timestamp will be current UTC).

- [ ] **Step 2: Populate the migration**

Write the following to the generated file (replace filename accordingly):

```sql
-- Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- Enums
do $$ begin
  create type room_mode as enum ('party', 'teams', 'headsup');
exception when duplicate_object then null; end $$;

do $$ begin
  create type room_phase as enum ('lobby', 'generating', 'guessing', 'scoring', 'reveal', 'game_over');
exception when duplicate_object then null; end $$;

do $$ begin
  create type token_role as enum ('subject', 'style', 'modifier', 'filler');
exception when duplicate_object then null; end $$;

-- Tables
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code ~ '^[A-Z]{4}$'),
  host_id uuid not null,
  mode room_mode not null default 'party',
  phase room_phase not null default 'lobby',
  round_num int not null default 0,
  max_rounds int not null default 5 check (max_rounds between 1 and 20),
  guess_seconds int not null default 45 check (guess_seconds between 15 and 120),
  reveal_seconds int not null default 10 check (reveal_seconds between 5 and 30),
  phase_ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists rooms_code_idx on rooms (code);
create index if not exists rooms_phase_ends_at_idx on rooms (phase_ends_at) where phase_ends_at is not null;

create table if not exists room_players (
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 24),
  score int not null default 0,
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, player_id)
);
create index if not exists room_players_player_idx on room_players (player_id);

create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_num int not null,
  prompt text not null default '',
  image_url text,
  image_storage_path text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (room_id, round_num)
);

create table if not exists round_prompt_tokens (
  round_id uuid not null references rounds(id) on delete cascade,
  position int not null,
  token text not null,
  role token_role not null,
  primary key (round_id, position)
);

create table if not exists guesses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  player_id uuid not null,
  guess text not null check (char_length(guess) between 1 and 200),
  subject_score int not null default 0,
  style_score int not null default 0,
  semantic_score int not null default 0,
  speed_bonus int not null default 0,
  total_score int generated always as (subject_score + style_score + semantic_score + speed_bonus) stored,
  submitted_at timestamptz not null default now(),
  scored_at timestamptz,
  unique (round_id, player_id)
);
create index if not exists guesses_round_idx on guesses (round_id);

-- rounds_public view: hides prompt unless room is in reveal/game_over
create or replace view rounds_public
with (security_invoker = true)
as
select
  r.id,
  r.room_id,
  r.round_num,
  case
    when rm.phase in ('reveal', 'game_over') or r.ended_at is not null
      then r.prompt
    else null
  end as prompt,
  r.image_url,
  r.image_storage_path,
  r.started_at,
  r.ended_at
from rounds r
join rooms rm on rm.id = r.room_id;

-- Enable RLS
alter table rooms enable row level security;
alter table room_players enable row level security;
alter table rounds enable row level security;
alter table round_prompt_tokens enable row level security;
alter table guesses enable row level security;

-- RLS: rooms
create policy rooms_select on rooms for select using (
  -- anyone authed can read a room by code (so joiners can preview)
  auth.uid() is not null
);
create policy rooms_insert on rooms for insert with check (host_id = auth.uid());
create policy rooms_update on rooms for update using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy rooms_delete on rooms for delete using (host_id = auth.uid());

-- RLS: room_players
create policy room_players_select on room_players for select using (
  exists (select 1 from room_players rp where rp.room_id = room_players.room_id and rp.player_id = auth.uid())
);
create policy room_players_insert on room_players for insert with check (
  player_id = auth.uid()
  and exists (select 1 from rooms r where r.id = room_id and r.phase = 'lobby')
);
create policy room_players_update_self on room_players for update using (player_id = auth.uid()) with check (player_id = auth.uid());
create policy room_players_update_host on room_players for update using (
  exists (select 1 from rooms r where r.id = room_id and r.host_id = auth.uid())
);
create policy room_players_delete_self on room_players for delete using (player_id = auth.uid());
create policy room_players_delete_host on room_players for delete using (
  exists (select 1 from rooms r where r.id = room_id and r.host_id = auth.uid())
);

-- RLS: rounds — clients read via rounds_public view. Direct table reads blocked.
-- (security_invoker view inherits caller's RLS, so we still need a select policy
-- on rounds restricted to members, but the view itself masks the prompt.)
create policy rounds_select on rounds for select using (
  exists (select 1 from room_players rp where rp.room_id = rounds.room_id and rp.player_id = auth.uid())
);
-- No INSERT/UPDATE/DELETE policies — writes are only via SECURITY DEFINER functions.

-- RLS: round_prompt_tokens — only visible in reveal/game_over
create policy round_prompt_tokens_select on round_prompt_tokens for select using (
  exists (
    select 1 from rounds r
    join rooms rm on rm.id = r.room_id
    where r.id = round_prompt_tokens.round_id
      and rm.phase in ('reveal', 'game_over')
      and exists (select 1 from room_players rp where rp.room_id = rm.id and rp.player_id = auth.uid())
  )
);
-- Writes: SECURITY DEFINER only.

-- RLS: guesses
create policy guesses_select_own on guesses for select using (player_id = auth.uid());
create policy guesses_select_reveal on guesses for select using (
  exists (
    select 1 from rounds r
    join rooms rm on rm.id = r.room_id
    where r.id = guesses.round_id
      and rm.phase in ('reveal', 'game_over')
      and exists (select 1 from room_players rp where rp.room_id = rm.id and rp.player_id = auth.uid())
  )
);
create policy guesses_insert on guesses for insert with check (
  player_id = auth.uid()
  and exists (
    select 1 from rounds r
    join rooms rm on rm.id = r.room_id
    where r.id = round_id
      and rm.phase = 'guessing'
      and rm.phase_ends_at > now()
      and exists (select 1 from room_players rp where rp.room_id = rm.id and rp.player_id = auth.uid())
  )
);
-- No UPDATE/DELETE policies.

-- Helper function: generate_room_code
create or replace function generate_room_code()
returns text
language plpgsql
volatile
as $$
declare
  chars constant text := 'BCDFGHJKLMNPRSTVWXYZAEIO';  -- consonants + A/E/I/O
  code text;
  attempt int := 0;
begin
  loop
    code := '';
    for i in 1..4 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    if not exists (select 1 from rooms where rooms.code = code) then
      return code;
    end if;
    attempt := attempt + 1;
    if attempt >= 10 then
      raise exception 'could not generate unique room code after 10 attempts';
    end if;
  end loop;
end;
$$;

-- Helper function: start_round (host-only, advances phase to 'generating')
create or replace function start_round(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_round_id uuid;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'only host can start'; end if;
  if v_room.phase not in ('lobby', 'reveal') then
    raise exception 'cannot start round from phase %', v_room.phase;
  end if;

  update rooms
    set phase = 'generating',
        round_num = round_num + 1,
        phase_ends_at = null
    where id = p_room_id;

  insert into rounds (room_id, round_num, prompt)
    values (p_room_id, v_room.round_num + 1, '')
    returning id into v_round_id;

  return v_round_id;
end;
$$;
revoke all on function start_round(uuid) from public;
grant execute on function start_round(uuid) to authenticated;

-- Helper function: submit_guess
create or replace function submit_guess(p_round_id uuid, p_guess text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_guess_id uuid;
begin
  if char_length(p_guess) < 1 or char_length(p_guess) > 200 then
    raise exception 'guess length invalid';
  end if;

  select rm.* into v_room
  from rounds r join rooms rm on rm.id = r.room_id
  where r.id = p_round_id;
  if not found then raise exception 'round not found'; end if;

  if v_room.phase <> 'guessing' or v_room.phase_ends_at <= now() then
    raise exception 'guessing closed';
  end if;

  if not exists (select 1 from room_players rp where rp.room_id = v_room.id and rp.player_id = auth.uid()) then
    raise exception 'not in room';
  end if;

  insert into guesses (round_id, player_id, guess)
    values (p_round_id, auth.uid(), p_guess)
    on conflict (round_id, player_id) do nothing
    returning id into v_guess_id;

  if v_guess_id is null then
    raise exception 'already guessed this round';
  end if;

  return v_guess_id;
end;
$$;
revoke all on function submit_guess(uuid, text) from public;
grant execute on function submit_guess(uuid, text) to authenticated;

-- Storage bucket: round-images (public read, service-role write)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'round-images',
  'round-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Storage policies: anyone authed can read, only service_role writes (default, no policy needed for service_role).
create policy round_images_public_read on storage.objects for select using (bucket_id = 'round-images');
```

- [ ] **Step 3: Reset local DB to verify migration applies cleanly**

Run:
```
supabase db reset
```
Expected: migration runs without errors. If you don't have a local dev DB running, skip this and apply remotely in the next step — verification is via `db push --dry-run`.

- [ ] **Step 4: Dry-run the push to remote**

Run:
```
supabase db push --dry-run
```
Expected: shows diff to be applied, no errors.

- [ ] **Step 5: Push to remote Supabase (Promptionary project)**

Run:
```
supabase db push
```
Expected: migration applied successfully.

- [ ] **Step 6: Generate TypeScript types from live schema**

Run:
```
supabase gen types typescript --linked --schema public > lib/supabase/types.ts
```
Expected: `lib/supabase/types.ts` populated with Database type.

- [ ] **Step 7: Commit**

Run:
```
git add -A
git commit -m "feat: phase 1 schema (rooms, players, rounds, guesses, rls, functions)"
```

---

### Task 7: Enable anonymous auth + Realtime on tables in Supabase Dashboard

**Files:** none (manual dashboard step, captured for handoff)

- [ ] **Step 1: Enable anonymous sign-ins**

Go to https://supabase.com/dashboard/project/cuevgbducxnbdslbhlxe/auth/providers → toggle **Anonymous Sign-ins** to ON.

- [ ] **Step 2: Enable Realtime on tables**

Go to https://supabase.com/dashboard/project/cuevgbducxnbdslbhlxe/database/replication → enable replication on `rooms`, `room_players`, `rounds`, `guesses`.

- [ ] **Step 3: Record the completion in a scratch note**

Add a line to `README.md` under a "## Setup" section:
```markdown
## Setup
1. `bun install`
2. Copy `.env.local.example` → `.env.local` and fill in keys.
3. `bun dev`

### One-time Supabase dashboard config
- Enable Anonymous Sign-ins (Auth → Providers)
- Enable Realtime replication on: `rooms`, `room_players`, `rounds`, `guesses`
```

- [ ] **Step 4: Commit**

Run:
```
git add README.md
git commit -m "docs: add setup + supabase dashboard steps"
```

---

### Task 8: Write the minimal hello-world landing page (proof of wire-up)

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace `app/page.tsx` with a placeholder that reads from Supabase**

```tsx
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("rooms")
    .select("*", { count: "exact", head: true });

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 text-white">
      <h1 className="text-6xl font-black tracking-tight">Promptionary</h1>
      <p className="text-xl opacity-90">
        Pictionary, in reverse. Rooms created so far: {count ?? 0}
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Verify locally**

Run `bun dev`, open http://localhost:3000. Expected: gradient hero, "Rooms created so far: 0". If env vars missing, the zod validator throws a clear error in the terminal — that's your TODO to fill `.env.local`.

- [ ] **Step 3: Commit**

Run:
```
git add app/page.tsx
git commit -m "feat: hello-world landing wired to supabase"
```

---

### Task 9: Push to GitHub + connect to existing blank Vercel project

**Files:** none (Vercel CLI + GitHub)

- [ ] **Step 1: Create GitHub repo and push**

Ask the user to run (interactive, needs their auth):
```
gh repo create promptionary --private --source=. --remote=origin --push
```
Or if the repo already exists on GitHub: `git remote add origin git@github.com:<you>/promptionary.git && git push -u origin main`.

- [ ] **Step 2: Link the local repo to the existing Vercel project**

Run (use the existing blank project from your Vercel dashboard):
```
vercel link
```
Expected: prompts to pick the existing Promptionary project.

- [ ] **Step 3: Configure Vercel env vars from `.env.local`**

Use the `vercel:env` skill or run:
```
vercel env pull .env.local    # pulls any existing env
# then, for each of NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, GOOGLE_GENAI_API_KEY, run:
vercel env add <NAME> production
vercel env add <NAME> preview
vercel env add <NAME> development
```

- [ ] **Step 4: Trigger preview deploy**

Run:
```
vercel
```
Expected: uploads, builds, returns a `.vercel.app` preview URL. Open it, confirm gradient renders and Supabase count reads 0.

- [ ] **Step 5: Commit any `.vercel/` changes (should be gitignored) and push**

Run:
```
git push
```
Expected: GitHub integration auto-triggers a Vercel deploy; preview URL updates.

---

### Task 10: Phase 1 close-out

- [ ] **Step 1: Verify checklist**

Manually confirm:
- ✅ `bun dev` boots, landing renders, Supabase count reads
- ✅ `supabase db push --dry-run` reports "no changes" (schema is in sync)
- ✅ `bun run build` succeeds locally
- ✅ Vercel preview URL loads the landing
- ✅ Anonymous sign-ins enabled in Supabase dashboard
- ✅ Realtime replication enabled on the 4 tables

- [ ] **Step 2: Tag the commit for reference**

Run:
```
git tag phase-1-foundation
git push --tags
```

- [ ] **Step 3: Open PR (or merge directly, since there's no prior main)**

Since the repo is brand new and `main` is the only branch, the commits go straight to `main`. If you prefer PR workflow for phases 2+, create a `dev` branch now:
```
git checkout -b dev
git push -u origin dev
```
Future phases branch off `dev`, PR into `dev`, and `dev` → `main` ships to production.

---

## Phase 2 — Lobby (outline, separate plan)

- Anonymous sign-in on first visit (one-tap, persistent via cookie)
- Home page: "Create Room" + "Join with code" inputs
- `/room/[code]` page: shows player list via Realtime Postgres Changes on `room_players`
- Presence via Realtime Presence (online/offline indicator)
- Host sees "Start Game" button (disabled if < 2 players)
- Room settings UI (max_rounds, guess_seconds) — host-only
- Leaving room deletes your `room_players` row
- Design pass: vibrant gradient backdrop, player cards with Jackbox-style avatars

**Detailed plan to be written after Phase 1 ships.**

---

## Phase 3 — Round Engine (outline, separate plan)

- `start_round` server action: host-triggered → calls Gemini 2.5 Flash with a structured-output schema to return `{ prompt: string, tokens: [{ token, role }] }` → calls NanoBanana 2 with prompt → uploads image to `round-images` bucket → updates `rounds` row (prompt, image_url) and writes `round_prompt_tokens` via service-role client → sets room phase to `'guessing'` with `phase_ends_at = now() + guess_seconds`
- Guess submission via `submit_guess` RPC; UI shows live "X players submitted" via Postgres Changes
- Timer expiry: client that holds the "host" role POSTs to a `/api/finalize-round` route on Vercel. That route, using service role:
  - Fetches all guesses for the round
  - Calls `text-embedding-004` in one batch for all guesses + the prompt
  - Computes per-guess subject/style/semantic/speed scores in-memory
  - Writes results back to `guesses` + increments `room_players.score`
  - Sets room phase to `'reveal'` with `reveal_seconds` timer
- Reveal UI: image + true prompt + ranked guesses with score breakdown
- Auto-advance: after reveal timer, either next `start_round` or `'game_over'` if `round_num >= max_rounds`

**Detailed plan to be written after Phase 2 ships.**

---

## Phase 4 — Landing + Domain (outline, separate plan)

- Replace the gradient placeholder with a real landing: hero, how-it-works, sample-round illustration, CTA
- Font stack: Clash Display (or Fraunces) for display, Geist/Inter Tight for body
- Connect promptionary.io from Namecheap → Vercel (NS records or CNAME)
- Enable production deploy from `main` branch
- Add OG image + favicon
- Lighthouse pass

**Detailed plan to be written after Phase 3 ships.**

---

## Self-Review

**Spec coverage (against trimmed-v1 scope):**
- Schema: rooms, room_players, rounds, round_prompt_tokens, guesses — Task 6 ✓
- Enums including unused teams/headsup modes for forward compat — Task 6 ✓
- rounds_public view for prompt-leak protection — Task 6 ✓
- RLS on all tables — Task 6 ✓
- SECURITY DEFINER functions: generate_room_code, start_round, submit_guess — Task 6 ✓ (finalize_round deferred to Phase 3 where it's needed)
- Storage bucket round-images — Task 6 ✓
- Anonymous auth enabled — Task 7 ✓
- Realtime replication enabled — Task 7 ✓
- Next.js + shadcn scaffold — Tasks 2-3 ✓
- Supabase client helpers — Task 5 ✓
- Env validation — Task 4 ✓
- Vercel deploy — Task 9 ✓

**Gaps (intentional deferrals, not bugs):**
- `finalize_round_scores` function — deferred to Phase 3 since it's coupled to the scoring webhook flow.
- `teams` table + team RLS — deferred to post-MVP.
- pg_cron tick — deferred (Vercel drives phase transitions).
- Realtime broadcast triggers + realtime.messages RLS for chat blackout — deferred to when chat is built.

**Placeholder scan:** none.

**Type consistency:** `p_room_id uuid`, `p_guess text`, `p_round_id uuid` — consistent across `start_round` and `submit_guess`. Round table `prompt` column defaults to `''` so the NOT NULL constraint doesn't break the stub row created in `start_round`.

**Assumptions flagged for user confirmation:**
1. `host_id` and `player_id` are plain `uuid` (no FK to `auth.users`) — this makes anonymous-to-permanent account migration easier later.
2. Using `bun` as package manager (matches cutting-edge vibe). Swap to `pnpm` if preferred.
3. Single `dev` branch for Phase 2+ PRs, `main` is production — this is set up in Task 10 Step 3.
4. Landing in Phase 1 is placeholder-only. The real bright/vibrant landing lands in Phase 4 (after gameplay works end-to-end).
5. Tailwind v4 + shadcn CSS-variable theme — the design token overhaul (vibrant blues/pinks/purples system) happens in Phase 4.
