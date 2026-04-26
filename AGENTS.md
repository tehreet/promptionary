<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working rules

These apply to every change in this repo. Read them once per session.

@rules/simple.md
@rules/task-tracking.md
@rules/commit-notes.md

# Promptionary — project brief

## What it is

Multiplayer AI party game — Pictionary in reverse. Gemini paints from a secret prompt, players guess. Live at https://promptionary.io (apex) and https://promptionary-three.vercel.app (Vercel alias).

Two core modes + a teams overlay:

- **Party** — Gemini 2.5 Flash authors the secret prompt (5-dimension random seeding + avoid-recent context). Gemini 3.1 Flash Image Preview renders it. Players guess; scored by role-weighted token match (subject / style) + semantic similarity + speed bonus. Optional theme packs (food / wildlife / history / absurd / mixed) filter the subject/setting pools.
- **Artist** — one player per round writes the prompt; everyone else guesses. Artist's score = average of the guessers' totals. Artist is picked by least-artist-count with random tiebreak (not join order).
- **Teams** — a host-only lobby toggle (`rooms.teams_enabled` boolean, orthogonal to `mode`). Works on top of either Party or Artist. Players auto-seed into Team 1 / Team 2; host can swap, auto-balance, or drag-and-drop players between teams + the spectator zone. Final leaderboard ranks by **average** of each team's individual totals.

Spectator mode (with mid-game join, drag-and-drop assignment, prompt modifiers, and tiebreaker voting), invite links, play-again, auto-submit, auto-finalize, confetti, running scoreboard, always-on chat (room + team), live cursors, persistent emoji reactions, sound effects (submit / image-land / winner cheer / clock-tick / reveal), flipboard prompt recap with role-colored tokens + top-guess callout, post-game recap page at `/play/[code]/recap` with curated highlights, shareable per-round highlights at `/r/[round_id]`, round highlights carousel on the final leaderboard, host-only kick / transfer-host controls (locked during active phases), Quick Match public matchmaking, IP-based room-creation rate limit, solo Daily puzzle at `/daily` with global leaderboard and share card, profile pages at `/u/[handle]`, global leaders page at `/leaders`, single-click Create Room with config in the lobby settings panel, sign-in (magic link + Google + Discord + Vercel + passkeys via SimpleWebAuthn) — all shipped.

## Modes & toggles (orthogonal layers on top of Party / Artist)

- **Blitz** — host toggle. Halves the guess timer and doubles the speed bonus. (`20260419185000_blitz_mode.sql`)
- **Taboo** — Artist-mode-only toggle. Each round seeds 3 forbidden words; the artist's prompt is rejected client-side via `findTabooHit` if any appears. (`20260419188000_taboo.sql`, `lib/taboo-words.ts`)
- **Vote-to-skip** — players can vote to discard an obviously broken Gemini generation. 50% threshold, capped at 2 skips per round. (`20260419191000_skip_votes.sql`, `app/api/skip-round/`)
- **Spectator-contributed prompt modifiers** — spectators submit a single-word twist that gets folded into the next prompt. (`20260419189000_spectator_modifiers.sql`, `app/api/submit-modifier/`)
- **Spectator tiebreaker** — when the top two scores are within 5 points at game-over, spectators vote on the winner. (`20260419186000_spectator_votes.sql`)
- **Turn-by-turn team prompts** — in teams + artist mode, each team takes turns writing the prompt collaboratively, one teammate per round. (`20260419210000_team_turns.sql`)
- **Quick Match** — public matchmaking. Single-click drops the player into the highest-quality open lobby (or seeds a fresh one). 5-minute live-availability horizon on the home tile. (`20260419190000_quick_match.sql`, `app/actions/quick-match.ts`)
- **Speculative round-N+1 pre-generation** — while round N is on screen, the server may pre-author and pre-render N+1 to absorb 30-90s of Gemini latency. Stored on the upcoming round row (`prefetched_prompt`, `prefetched_image_storage_path`, etc.) and consumed when N+1 actually starts. Cleared on `play_again`. (`20260421010000_round_prefetch.sql`, `app/api/prefetch-next-round/`)

## Tech stack

- Next.js 16 App Router (note: middleware was renamed to "proxy" conceptually, but `middleware.ts` still works)
- Bun, Tailwind v4, shadcn/ui (base-nova style on Base UI primitives via `@base-ui/react`)
- Supabase — Postgres, Auth (anon only), Realtime, Storage
- `@google/genai` SDK — `gemini-2.5-flash` (text), `gemini-3.1-flash-image-preview` → `gemini-2.5-flash-image` fallback (image), `gemini-embedding-001` (scoring)
- next-themes for dark/light, Unbounded for headings, Geist for body
- canvas-confetti, qrcode.react
- Vercel host, Playwright e2e (4 workers, parallel)

## Architectural notes

- **All AI calls live in Vercel route handlers**, never the client. Keys via env.
- **Anonymous auth is created in `middleware.ts`** on first visit. Server components can't set cookies; middleware can. Without this, invite-link visitors get stuck.
- **Realtime plumbing uses public channels + 2s polling fallback.** Attempted private-channel + realtime.messages RLS for proper postgres_changes delivery — got `CHANNEL_ERROR` with no message even on permissive setups. A reference migration for the private-channel path exists at `20260419052512_realtime_private_channels.sql` but is explicitly marked `DO NOT APPLY` in its first line and was never run in prod; all live updates ride public broadcast + poll backstop.
- **Browser Supabase client bypasses `@supabase/ssr` for data.** `createSupabaseBrowserClient` uses vanilla `@supabase/supabase-js` with the session JWT bridged in from middleware-set cookies; `@supabase/ssr`'s browser `getSession()` hangs silently and stalls every data call. Auth flows (sign-in card, user menu) still use `createSupabaseAuthBrowserClient` for PKCE cookie writes.
- **Broadcast on public channels works fine.** Cursors, chat live-delivery, and reactions ride the `room-<id>-live` channel via `RoomChannelProvider`.
- **Phase transitions are host-driven from the client.** No pg_cron. The host's tab POSTs to `/api/start-round` and `/api/finalize-round`. Auto-finalize fires when everyone submits (not just on timer expiry). Reveal-advance trigger guards on `phase_ends_at < now()` — not `remaining == 0` which is ambiguous.
- **Replica identity FULL** on all gameplay tables for Realtime streaming. `supabase_realtime` publication includes rooms / room_players / rounds / guesses / room_messages.
- **Chat is always open.** We tried a DB-level phase blackout during `generating / guessing / scoring` but it locked up inconsistently due to 2s poll jitter between phases. `post_message` RPC + `room_messages` INSERT policy were rewritten in `20260421000000_chat_always_open.sql` to accept room-wide writes from any room member at any phase. Team chat is teammates-only, phase-agnostic.
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
- `lib/prompt-dimensions.ts` — subject / setting / action / time / style pools, pack-scoped
- `lib/scoring.ts` — pure scoring math, no DB
- `lib/room-channel.tsx` — broadcast channel React context
- `lib/animation.ts` — `useAnimatedNumber` (easeOutCubic count-up)
- `lib/env.ts` — Zod-validated env vars
- `lib/sfx.ts` — Web Audio synth for submit / image-land / winner-cheer / reveal, with `window.__sfx` test hook
- `lib/loading-phrases.ts` — rotating spinner phrases during `generating` phase
- `lib/daily.ts` — daily puzzle seeding + global leaderboard helpers (`ensureDailyPuzzle`, `todayUtcDate`)
- `lib/passkey.ts` — SimpleWebAuthn RP ID + challenge-cookie constants
- `lib/profile.ts` — `getCurrentProfile` used by the async root layout for first-paint auth state
- `lib/player.ts` — `colorForPlayer` + player chip helpers
- `lib/supabase/{client,server,types}.ts` — vanilla supabase-js for data, `@supabase/ssr` only for auth. Types are generated, don't hand-edit
- `components/live-cursors.tsx` — pointer overlay
- `components/chat-panel.tsx` — inline + floating variants
- `components/reactions-bar.tsx` — emoji bar + floating overlay
- `components/theme-{provider,toggle}.tsx` — next-themes wiring
- `supabase/migrations/*.sql` — ordered; edit via `supabase migration new <name>`

## Commands

- `bun dev` — local Next dev server on `:3000`
- `bun run build` — full prod build + typecheck (do this before claiming a change works)
- `bun lint` — ESLint over the workspace
- `bun test:unit` — Vitest unit tests in `tests/unit/`. Fast, no DB
- `bun test:e2e` — Playwright against production (default `https://promptionary-three.vercel.app`)
- `bun test:e2e:local` — against `http://localhost:3000` (requires `bun dev` running)
- `PROMPTIONARY_TEST_URL=<url> bunx playwright test` — override target
- `PROMPTIONARY_MOCK_GEMINI=1 bun dev` — run the dev server with Gemini stubbed (see Testing discipline)
- `supabase migration new <name>` → edit → `supabase db push`
- `supabase gen types typescript --linked --schema public 2>/dev/null > lib/supabase/types.ts` — regen types after schema change
- `vercel deploy --prod --yes` — ship to prod (already linked)
- `bunx shadcn@latest add <component>` — pull a UI primitive
- `bun run notes:fetch` / `bun run notes:push` — sync git notes from/to origin (notes don't fetch by default)
- Runtime logs: use the Vercel MCP tool `mcp__plugin_vercel_vercel__get_runtime_logs` with project `prj_bbIji7EWthbnG135XzhFl2CNr6K7`, team `team_9PBy4biwS1zFp6lsUZBEwjMh`

## Testing discipline

- **Every user-visible feature gets an e2e test.** Don't claim "it works" on a UI change without running Playwright.
- **Unit tests for pure logic.** `bun test:unit` (Vitest, see `vitest.config.ts`) runs `tests/unit/*.test.ts`. Current coverage: `scoring.test.ts`, `daily.test.ts`, `prompt-dimensions.test.ts`, `moderation.test.ts`. Add a unit test for any pure function in `lib/` you touch — e2e is for user-visible behavior, unit is for math and helpers.
- **Mock-Gemini mode.** `PROMPTIONARY_MOCK_GEMINI=1` is a **server-side env var** read by `lib/gemini.ts:5-31` at module load. When set, `authorPromptWithRoles`, `generateImagePng`, `tagPromptRoles`, `moderatePrompt`, and `embedTexts` return deterministic fakes — no real Gemini calls, no quota burn, full rounds finish in <15s. Specs that depend on this gate themselves and self-skip when the flag isn't set: `full-round-mocked.spec.ts`, `taboo.spec.ts`, `vote-to-skip.spec.ts`. To run them: `PROMPTIONARY_MOCK_GEMINI=1 bun dev` in one terminal, then `bun test:e2e:local --grep <name>` in another. The flag is **only read at server boot**, so a Vercel preview deploy will not honor it unless `PROMPTIONARY_MOCK_GEMINI=1` is set in Vercel's Preview environment.
- Tests live in `tests/e2e/`. Helpers in `tests/e2e/helpers.ts` (`createRoomAs`, `joinRoomAs`, `submitGuess`).
- Current coverage (all green against prod unless noted; mock-Gemini specs skip without the flag):
  - `artist-mode.spec.ts` — artist writes prompt, others guess, score award
  - `artist-rejection-ui.spec.ts` — pinned UI for artist-prompt rejection inline error (mocked 400)
  - `artist-teams.spec.ts` — artist mode + teams toggle coexist; team leaderboard at game over
  - `auth.spec.ts` — Google / Discord / magic-link sign-in UI + redirect flow
  - `auto-submit.spec.ts` — typed-but-not-clicked guess fires on timer expiry
  - `chat.spec.ts` — two-player lobby chat roundtrip
  - `create-and-join.spec.ts` — baseline lobby flow
  - `cursors.spec.ts` — live cursors render across the viewport in every game phase
  - `daily.spec.ts` — /daily puzzle visit, guess, share, leaderboard
  - `design-tokens.spec.ts` — semantic tokens render correctly in dark/light modes
  - `emoji-reactions.spec.ts` — reactions persist for late joiners + reconnects
  - `full-round.spec.ts` — 2-player single round with real Gemini
  - `full-round-mocked.spec.ts` — fast 2-player single round under `PROMPTIONARY_MOCK_GEMINI=1`
  - `game-recap.spec.ts` — `/play/[code]/recap` renders for finished games
  - `highlights-carousel.spec.ts` — round highlights carousel on the final leaderboard
  - `host-controls.spec.ts` — host kicks a player + transfers host
  - `invite-link.spec.ts` — opening `/play/<code>` as a fresh visitor
  - `leaders.spec.ts` — global leaders page
  - `loading-phrases.spec.ts` — rotating spinner phrases during `generating`
  - `moderation.spec.ts` — artist-prompt moderation rejects unsafe inputs with a human-readable reason
  - `multi-round.spec.ts` — 3 players, 2 rounds, everyone-submitted finalize, scoreboard rollover
  - `og-cards.spec.ts` — sitewide OG / Twitter cards render
  - `passkey.spec.ts` — SimpleWebAuthn sign-in using a Chromium virtual authenticator
  - `play-again.spec.ts` — game-over → reset → second game
  - `prefetch-next-round.spec.ts` — round N+1 speculatively pre-generated while N is on screen
  - `profile-stats.spec.ts` — profile stats card
  - `quick-match.spec.ts` — public matchmaking drops a fresh visitor into an open lobby
  - `rate-limit.spec.ts` — IP-based 5/hour room-creation cap
  - `realtime-auth-refresh.spec.ts` — realtime socket reauths past 1h JWT TTL
  - `realtime-lobby.spec.ts` — host sees joiner within a few seconds
  - `recap.spec.ts` — flipboard tokens render with role classes, top-guess callout visible
  - `recap-highlights.spec.ts` — curated highlights on the recap page
  - `sfx.spec.ts` — mute toggle works, submit/imageLand/winnerCheer sfx fire
  - `share-round.spec.ts` — `/r/[round_id]` standalone round highlight + OG card
  - `spectator.spec.ts` — mid-game visitor joins as watch-only
  - `spectator-tiebreaker.spec.ts` — spectator tiebreaker vote when top two are within 5 pts
  - `taboo.spec.ts` — taboo artist mode rejects forbidden words (mock-Gemini)
  - `team-chat.spec.ts` — team-scoped chat during team rounds
  - `team-turns.spec.ts` — turn-by-turn collaborative team prompt writing
  - `teams.spec.ts` — host flips teams toggle; 4 players split into teams; team leaderboard
  - `teams-dnd.spec.ts` — drag-and-drop team + spectator assignment
  - `theme-packs.spec.ts` — pack selector propagates to lobby pill; artist mode hides it
  - `vote-to-skip.spec.ts` — 50% vote skips a bad generation; cap of 2 skips per round (mock-Gemini)
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
- **SECURITY DEFINER return tables**: don't name the returned columns the same as underlying table columns. Shadowing triggers 42702 "ambiguous column" errors. Rename columns in the `returns table (...)` clause (the `create_room` RPC's fix in `20260419021009_fix_create_room_ambiguous.sql` is the canonical example).
- **Playwright + controlled inputs**: React controlled `<input value>` fights Playwright's `fill()`. Use `defaultValue` for initial values and let the browser own the input state.
- **Always run `bun run build` before claiming a change works.** TS errors will bite you later.
- **Never disable RLS on `realtime.messages`** arbitrarily — breaks public channels for reasons I didn't fully diagnose.
- **No hardcoded `text-white` / `bg-white/X` / color-500 utilities in theme-aware code.** Use semantic tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted`, `bg-accent`, `text-primary`) so dark/light both work.
- **Supabase JWT cookies can be chunked.** Long auth tokens are split into `sb-<ref>-auth-token.0` / `.1` / etc. with a `base64-` prefix. The manual cookie bridge in `lib/supabase/client.ts` concatenates and base64-decodes — don't replace it with a naive single-cookie read or you'll break sessions for big JWTs.
- **Realtime socket reauths past 1h JWT TTL.** Without a `realtime.setAuth` push on session refresh, broadcasts (cursors, reactions, live chat) silently stop after ~1h. The browser client wires this in `lib/supabase/client.ts`; pinned by `tests/e2e/realtime-auth-refresh.spec.ts`. Don't strip the auth-bridge logic.
- **Whitespace in env values is radioactive.** A trailing `\n` on `NEXT_PUBLIC_SUPABASE_ANON_KEY` URL-encoded to `%0A` in the realtime WebSocket query string and silently killed every broadcast. `lib/env.ts` `.trim()`s every secret. Don't undo that.
- **Supabase browser clients are singletons.** Both `createSupabaseBrowserClient` and `createSupabaseAuthBrowserClient` in `lib/supabase/client.ts` cache at module scope — `useRef(createSupabaseBrowserClient())` would otherwise spin up a fresh GoTrueClient on every render and pile up thousands of auth listeners against the same storage key.

## Style / UX rules

- **Anti-slop.** No generic "AI gradient orbs," no glassmorphism for its own sake, no slate-900 default. Bright, intentional, Jackbox × Arc × Figma.
- **Vibrant palette**: indigo / fuchsia / rose, via `--brand-indigo / --brand-fuchsia / --brand-rose` tokens that flip in dark mode.
- **`.promptionary-gradient`** utility for signature hero/game backgrounds. Layered with `.promptionary-grain` SVG overlay to kill the AI-gradient smell.
- **Fonts**: `font-heading` (Unbounded) for display, Geist for body, Geist Mono for codes/scores.
- **Mobile first** where invite flow lands — phones see the full `/play/<code>` experience.
- **Respect `prefers-reduced-motion`** for confetti / animations (`disableForReducedMotion: true` on canvas-confetti).

## Deferred / known backlog

- Proper Realtime via private channels + `realtime.messages` RLS — investigation hit a CHANNEL_ERROR rabbit hole and was abandoned. The reference migration `20260419052512_realtime_private_channels.sql` is explicitly marked `DO NOT APPLY` in its first line; do not include it in `supabase db push`. Public broadcast + 2s poll is the production path.
- pg_cron safety net for **all** phase transitions — partial: `20260419182000_infra_cleanup.sql` ships a 30s tick that rescues final-round `reveal → game_over` (when the host disconnects after the last reveal) and deletes rooms abandoned >2h past `phase_ends_at`. Inter-round phase advancement (`lobby → generating`, `generating → guessing`, `guessing → scoring`, intermediate `reveal → generating`) is still host-driven.

**All features ship with e2e tests.** Write the test alongside the feature; don't treat it as a follow-up.
