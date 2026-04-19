<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Promptionary — project brief

## What it is

Multiplayer AI party game — Pictionary in reverse. Gemini paints from a secret prompt, players guess. Live at https://promptionary.io (apex) and https://promptionary-three.vercel.app (Vercel alias).

Two modes:

- **Party** — Gemini 2.5 Flash authors the secret prompt (5-dimension random seeding + avoid-recent context). Gemini 3.1 Flash Image Preview renders it. Players guess; scored by role-weighted token match (subject / style) + semantic similarity + speed bonus. Optional theme packs (food / wildlife / history / absurd / mixed) filter the subject/setting pools.
- **Artist** — one player per round writes the prompt; everyone else guesses. Artist's score = average of the guessers' totals. Rotation by join order.

Spectator mode, invite links, play-again, auto-submit, auto-finalize, confetti, running scoreboard, inter-round chat (DB-level phase blackout), live cursors, emoji reactions, sound effects (submit / image-land / winner cheer), flipboard prompt recap with role-colored tokens + top-guess callout, host-only kick / transfer-host controls, solo Daily puzzle at `/daily` with global leaderboard and share card — all shipped.

## Tech stack

- Next.js 16 App Router (note: middleware was renamed to "proxy" conceptually, but `middleware.ts` still works)
- Bun, Tailwind v4, shadcn/ui
- Supabase — Postgres, Auth (anon only), Realtime, Storage
- `@google/genai` SDK — `gemini-2.5-flash` (text), `gemini-3.1-flash-image-preview` → `gemini-2.5-flash-image` fallback (image), `gemini-embedding-001` (scoring)
- next-themes for dark/light, Unbounded for headings, Geist for body
- canvas-confetti, qrcode.react
- Vercel host, Playwright e2e (4 workers, parallel)

## Architectural notes

- **All AI calls live in Vercel route handlers**, never the client. Keys via env.
- **Anonymous auth is created in `middleware.ts`** on first visit. Server components can't set cookies; middleware can. Without this, invite-link visitors get stuck.
- **Realtime plumbing uses public channels + 2s polling fallback.** Attempted private-channel + realtime.messages RLS for proper postgres_changes delivery — got `CHANNEL_ERROR` with no message even on permissive setups. Rabbit hole; deferred.
- **Broadcast on public channels works fine.** Cursors, chat live-delivery, and reactions ride the `room-<id>-live` channel via `RoomChannelProvider`.
- **Phase transitions are host-driven from the client.** No pg_cron. The host's tab POSTs to `/api/start-round` and `/api/finalize-round`. Auto-finalize fires when everyone submits (not just on timer expiry). Reveal-advance trigger guards on `phase_ends_at < now()` — not `remaining == 0` which is ambiguous.
- **Replica identity FULL** on all gameplay tables for Realtime streaming. `supabase_realtime` publication includes rooms / room_players / rounds / guesses / room_messages.
- **Chat has DB-level blackout:** `post_message` RPC + `room_messages` INSERT policy both reject non-spectator writes during `generating / guessing / scoring`.
- **rounds_public view** hides the prompt until the round has `ended_at` or the room is in `reveal / game_over`. Clients read via the view; service-role writes to `rounds` directly.

## Key files

- `app/play/[code]/page.tsx` — server component, routes to Lobby / Game / JoinInline / spectator variant based on phase + membership
- `app/play/[code]/lobby-client.tsx` — pre-game (wrapped in `RoomChannelProvider` for chat)
- `app/play/[code]/game-client.tsx` — all non-lobby phases; big file; central to everything. Also wrapped in provider
- `app/play/[code]/join-inline.tsx` — name-picker for invite links; doubles as spectator join when phase ≠ lobby
- `app/play/[code]/invite-card.tsx` — copy-link + QR modal
- `app/actions/*` — server actions (auth, create-room, join-room, leave-room)
- `app/api/start-round/route.ts` — Gemini author + image + upload, or artist-mode shortcut (skips authoring, tags submitted prompt)
- `app/api/finalize-round/route.ts` — batched embeddings + per-guess scoring + aggregate score bump + phase advance. Artist gets `avg(guessers)` added to their total
- `app/api/submit-artist-prompt/route.ts` — validates the artist, writes their prompt, runs the image pipeline
- `lib/gemini.ts` — 5-dimension prompt author (`buildAuthorInstruction`), `tagPromptRoles` (for artist mode), `generateImagePng` (fallback chain), `embedTexts`
- `lib/prompt-dimensions.ts` — subject / setting / action / time / style pools
- `lib/scoring.ts` — pure scoring math, no DB
- `lib/room-channel.tsx` — broadcast channel React context
- `lib/animation.ts` — `useAnimatedNumber` (easeOutCubic count-up)
- `lib/env.ts` — Zod-validated env vars
- `lib/supabase/{client,server,types}.ts` — SSR-aware Supabase clients. Types are generated, don't hand-edit
- `components/live-cursors.tsx` — pointer overlay
- `components/chat-panel.tsx` — inline + floating variants
- `components/reactions-bar.tsx` — emoji bar + floating overlay
- `components/theme-{provider,toggle}.tsx` — next-themes wiring
- `supabase/migrations/*.sql` — ordered; edit via `supabase migration new <name>`

## Commands

- `bun dev` — local Next dev server on `:3000`
- `bun run build` — full prod build + typecheck (do this before claiming a change works)
- `bun test:e2e` — Playwright against production (default `https://promptionary-three.vercel.app`)
- `bun test:e2e:local` — against `http://localhost:3000` (requires `bun dev` running)
- `PROMPTIONARY_TEST_URL=<url> bunx playwright test` — override target
- `supabase migration new <name>` → edit → `supabase db push`
- `supabase gen types typescript --linked --schema public 2>/dev/null > lib/supabase/types.ts` — regen types after schema change
- `vercel deploy --prod --yes` — ship to prod (already linked)
- `bunx shadcn@latest add <component>` — pull a UI primitive
- Runtime logs: use the Vercel MCP tool `mcp__plugin_vercel_vercel__get_runtime_logs` with project `prj_bbIji7EWthbnG135XzhFl2CNr6K7`, team `team_9PBy4biwS1zFp6lsUZBEwjMh`

## Testing discipline

- **Every user-visible feature gets an e2e test.** Don't claim "it works" on a UI change without running Playwright.
- Tests live in `tests/e2e/`. Helpers in `tests/e2e/helpers.ts` (`createRoomAs`, `joinRoomAs`, `submitGuess`).
- Current coverage (all green, 17 tests against prod):
  - `artist-mode.spec.ts` — artist writes prompt, others guess, score award
  - `auto-submit.spec.ts` — typed-but-not-clicked guess fires on timer expiry
  - `chat.spec.ts` — two-player lobby chat roundtrip
  - `create-and-join.spec.ts` — baseline lobby flow
  - `daily.spec.ts` — /daily puzzle visit, guess, share, leaderboard
  - `full-round.spec.ts` — 2-player single round with Gemini
  - `host-controls.spec.ts` — host kicks a player + transfers host
  - `invite-link.spec.ts` — opening `/play/<code>` as a fresh visitor
  - `multi-round.spec.ts` — 3 players, 2 rounds, everyone-submitted finalize, scoreboard rollover
  - `play-again.spec.ts` — game-over → reset → second game
  - `realtime-lobby.spec.ts` — host sees joiner within a few seconds
  - `recap.spec.ts` — flipboard tokens render with role classes, top-guess callout visible
  - `sfx.spec.ts` — mute toggle works, submit/imageLand/winnerCheer sfx fire
  - `spectator.spec.ts` — mid-game visitor joins as watch-only
  - `theme-packs.spec.ts` — pack selector propagates to lobby pill; artist mode hides it
- Tests create throwaway rooms each run. No cleanup step is needed.
- Supabase's free-tier anon-auth rate limit bites when running >3 workers. Prefer `--workers=2` locally; prod is fine at default parallelism because tests run less often.

## Services

- **Supabase project**: `cuevgbducxnbdslbhlxe`. Linked via CLI. Management API token at `~/.supabase/access-token`. Direct SQL via `curl https://api.supabase.com/v1/projects/$PROJECT/database/query -H "Authorization: Bearer $ACCESS_TOKEN" -d '{"query":"…"}'`.
- **Vercel project**: `prj_bbIji7EWthbnG135XzhFl2CNr6K7` on team `team_9PBy4biwS1zFp6lsUZBEwjMh` (tehreets-projects). CLI authed as user `tehreet`.
- **GitHub**: `tehreet/promptionary`, default branch `main`. `gh` CLI is authed.
- **Domain**: `promptionary.io` on Namecheap, DNS live and verified on Vercel. Records: A `@ → 216.150.1.1 / 216.150.16.1`, CNAME `www → cname.vercel-dns.com.`, plus two `_vercel` TXT verification records. `www` 308-redirects to apex.

## Gotchas / hard-learned rules

- **Next.js 16**: `middleware` is being renamed to `proxy`. File still works as `middleware.ts`. Read `node_modules/next/dist/docs/` for anything you're unsure about.
- **CLI PATH**: `supabase` is at `/home/linuxbrew/.linuxbrew/bin/supabase`, `bun` + `vercel` at `$HOME/.bun/bin/`. Scripts that shell out should `export PATH="/home/linuxbrew/.linuxbrew/bin:$HOME/.bun/bin:$PATH"` explicitly.
- **Regen types after every migration** or TS will break on new columns/functions.
- **Enum extensions need two migrations**: one to `ADD VALUE`, a separate one to use it. Postgres won't let you use a new enum value in the same transaction it was added.
- **SECURITY DEFINER return tables**: don't name the returned columns the same as underlying table columns. Shadowing triggers 42702 "ambiguous column" errors. Prefix with `new_` or `out_` (see `create_room` → `new_room_id`, `new_code`).
- **Playwright + controlled inputs**: React controlled `<input value>` fights Playwright's `fill()`. Use `defaultValue` for initial values and let the browser own the input state.
- **Always run `bun run build` before claiming a change works.** TS errors will bite you later.
- **Never disable RLS on `realtime.messages`** arbitrarily — breaks public channels for reasons I didn't fully diagnose.
- **No hardcoded `text-white` / `bg-white/X` / color-500 utilities in theme-aware code.** Use semantic tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted`, `bg-accent`, `text-primary`) so dark/light both work.

## Style / UX rules

- **Anti-slop.** No generic "AI gradient orbs," no glassmorphism for its own sake, no slate-900 default. Bright, intentional, Jackbox × Arc × Figma.
- **Vibrant palette**: indigo / fuchsia / rose, via `--brand-indigo / --brand-fuchsia / --brand-rose` tokens that flip in dark mode.
- **`.promptionary-gradient`** utility for signature hero/game backgrounds. Layered with `.promptionary-grain` SVG overlay to kill the AI-gradient smell.
- **Fonts**: `font-heading` (Unbounded) for display, Geist for body, Geist Mono for codes/scores.
- **Mobile first** where invite flow lands — phones see the full `/play/<code>` experience.
- **Respect `prefers-reduced-motion`** for confetti / animations (`disableForReducedMotion: true` on canvas-confetti).

## Deferred / known backlog

- Proper Realtime via private channels + `realtime.messages` RLS (CHANNEL_ERROR rabbit hole)
- Teams mode (enum slot `'teams'` exists; no gameplay)
- Sign-in accounts (Google / Discord / Sign in with Vercel)
- pg_cron tick as a disconnection safety net for phase transitions
- Rate limits on room creation
- Moderation pass on artist-mode prompts
- PWA manifest

**All features ship with e2e tests.** Write the test alongside the feature; don't treat it as a follow-up.
