# Sitewide Jackbox Redesign — Design Spec

**Date:** 2026-04-19
**Branch:** `feat/sitewide-jackbox-redesign`
**Predecessor:** [Landing redesign plan](../plans/landing-redesign-jackbox.md) (the landing-only plan the user drafted inline — incorporated and extended here)

## Goal

Replace the remaining gradient-and-glassmorphism chrome across the entire site with the **Jackbox × Arc sticker-card aesthetic** introduced by the landing redesign: flat saturated colors, chunky ink borders, offset shadows, italic-heavy Unbounded, marquee pills, sticker pills, slight card tilts. Congruent ≠ identical — the sticker-card grammar unifies; the paint color flexes per surface.

Dark mode stays alive sitewide (design variant D2). The landing keeps its yellow-paper light-lock because it's a marketing splash; everywhere else gets a proper dark variant.

## Scope

### In

- All pages: `/`, `/play/[code]` (lobby, generating, guessing, scoring, reveal, game_over phases), `/daily`, `/leaders`, `/sign-in`, `/account`, `/u/[handle]`
- All shared components: `ui/button`, `ui/card`, `ui/input`, `ui/textarea`, `ui/label`, `create-room-card`, `join-room-card`, `chat-panel`, `reactions-bar`, `host-controls`, `live-cursors`, `prompt-flipboard`, `profile-stats-card`, `user-menu`, `theme-toggle`, `sfx-toggle`, `sign-in-card`, `loading-phrases`
- Token system in `app/globals.css` — add `--game-*` layer with light and dark variants; re-point shadcn semantic tokens at game tokens
- Hotspot cleanups across the tree:
  - Replace `text-white` / `text-black` on player avatars and labels with `text-[var(--game-ink)]` or `text-[var(--game-cream)]` as appropriate (via a new `.player-chip` helper)
  - Replace `bg-red-500/30` error boxes with `bg-destructive/20`
  - Replace hardcoded medal hex (`#facc15 / #a3a3a3 / #d97706`) in `/leaders` with `--medal-gold/silver/bronze` tokens
  - Replace hardcoded team hex (`#6366f1`, `#f43f5e`) in `game-client.tsx` with `--team-1` / `--team-2` tokens
  - Replace `user-menu` inline gradient avatar with solid `--game-pink` fill + ink border
- Final removal of `.promptionary-gradient`, `.promptionary-grain`, `.text-hero` utilities (and the SVG fractal-noise data URI) from `globals.css`
- Final removal of `--brand-indigo / --brand-fuchsia / --brand-rose` tokens
- Playwright coverage: render-smoke test per migrated page + a new `design-tokens.spec.ts` for dark-mode and leak detection

### Out

- Logo, favicon, and OG image (polish pass after this PR lands)
- Motion beyond the existing `.game-card` hover/press transitions and flipboard animation
- Functional changes of any kind (gameplay, scoring, realtime plumbing, RPCs)
- SFX changes
- pg_cron and other v2 backlog items
- Dark variant of the landing canvas — landing stays yellow in all modes by design

## Token architecture

Three canvases, one ink system, one accent layer. Values:

| Token | Light | Dark |
|---|---|---|
| `--game-canvas-yellow` | `#ffe15e` | `#ffe15e` (landing locks `color-scheme: light`) |
| `--game-canvas-warm` | `#fff7d6` | `#14112e` |
| `--game-canvas-dark` | `#1e1b4d` | `#0b0920` |
| `--game-ink` | `#1e1b4d` | `#fff7d6` |
| `--game-ink-soft` | `#3d2a7d` | `#d4c8ff` |
| `--game-cream` | `#fff7d6` | `#fff7d6` (stays cream — always the reversed-out-text color) |
| `--game-paper` | `#ffffff` | `color-mix(in oklch, var(--game-ink-soft) 18%, var(--game-canvas-warm))` (lifted-navy surface) |
| `--game-pink` | `#ff5eb4` | `#ff7dc4` |
| `--game-cyan` | `#3ddce0` | `#6fe8eb` |
| `--game-orange` | `#ff8b3d` | `#ffa15e` |
| `--medal-gold` | alias → `--game-canvas-yellow` | same |
| `--medal-silver` | alias → `--game-cream` | same |
| `--medal-bronze` | alias → `--game-orange` | same |
| `--team-1` | alias → `--game-pink` | same |
| `--team-2` | alias → `--game-cyan` | same |

Shadcn semantic tokens re-point at game tokens:

```
--background       → var(--game-canvas-warm)   (default page bg; per-page utilities override)
--foreground       → var(--game-ink)
--card             → var(--game-paper)          (elevated surface; flips cleanly across all canvases)
--card-foreground  → var(--game-ink)
--border           → var(--game-ink)
--input            → var(--game-ink)
--ring             → var(--game-ink)
--primary          → var(--game-pink)
--primary-foreground → var(--game-cream)
--secondary        → var(--game-cyan)
--secondary-foreground → var(--game-ink)
--accent           → var(--game-cyan)
--accent-foreground → var(--game-ink)
--destructive      → warm red that matches the palette (target ~`#e23d5e`)
--destructive-foreground → var(--game-cream)
--muted            → color-mix(in oklch, var(--game-ink) 8%, white)
--muted-foreground → color-mix(in oklch, var(--game-ink) 65%, transparent)
```

Chart tokens (`--chart-1..5`) re-point at the accent layer: pink, cyan, orange, yellow, ink-soft. This keeps any future chart component on-palette without rework.

The existing `--brand-indigo / --brand-fuchsia / --brand-rose` tokens are removed in the final cleanup commit once no file references them. `colorForPlayer()` in `lib/player.ts` is unaffected — it uses direct hue math (220–360), not brand tokens.

## Utility grammar

Extends the landing plan's utilities with three additions and dark-mode awareness. All utilities live in `app/globals.css` under `@layer utilities`.

**From the landing plan (unchanged):**

- `.game-canvas-page` — yellow bg, `color-scheme: light` locked. Landing + `/daily` + in-game reveal/game_over use this.
- `.game-card` — 3px ink border, 14px radius, 4px offset shadow, hover nudges to 6px offset, active compresses to 0.
- `.game-hero` — italic 900 Unbounded, tight letter-spacing, ink color.
- `.game-hero-mark` — tilted highlight block around a headline word, pink fill + cream text + ink border + offset shadow.
- `.sticker` — tilted pill, **paper fill** (`--game-paper`, not `--game-cream`), ink border, ink text, mono/bold small caps. The landing plan's original `.sticker` rule is amended from `background: var(--game-cream)` to `background: var(--game-paper)` so the pill reads as "stuck onto the page" across yellow, cream, and navy canvases in both light and dark modes.
- `.marquee-pill` — ink bg, canvas text, mono, wide tracking. Timers, counters.
- `.live-dot` — pulsing cyan dot for presence indicators.

**New utilities this spec adds:**

- `.game-canvas` — warm-cream bg and ink foreground in light mode; flips to deep navy (`#14112e`) with cream foreground in dark mode. Default canvas for most pages.
- `.game-canvas-dark` — navy bg and cream foreground in light mode; near-black (`#0b0920`) in dark mode. Used for in-game generating/guessing/scoring phases.
- `.game-frame` — thicker 5px ink border, 16px radius, 6px offset shadow. Specifically for wrapping the Gemini painting in-game so it reads as a framed picture on a stage.
- `.player-chip` — avatar circle helper. Accepts `--chip-color` custom prop (defaults to a colorForPlayer value). Applies: 2px ink border, ink text (not hardcoded black/white), 2px offset shadow. Replaces the 8+ hardcoded `text-black` / `text-white` spots.

All utilities work in both light and dark via token flipping — none hardcode `#ffffff` or `#000000`.

## Surface → canvas map

| Surface | Canvas utility | Rationale |
|---|---|---|
| `/` landing | `.game-canvas-page` (yellow, light-lock) | Marketing splash; party energy; short dwell |
| `/daily` | `.game-canvas-page` (yellow, light-lock) | Short dwell, same party mood as landing |
| `/play/[code]` lobby | `.game-canvas` (cream / dark-navy) | Warm waiting room, easy on eyes |
| In-game: generating | `.game-canvas-dark` (navy / near-black) | Stage lights, image generation anticipation |
| In-game: guessing | `.game-canvas-dark` | Painting pops against dark canvas |
| In-game: scoring | `.game-canvas-dark` | Continuous with guessing phase |
| In-game: reveal | `.game-canvas-page` (yellow, light-lock) | Victory lap — flipboard and top-guess callout feel celebratory on yellow |
| In-game: game_over | `.game-canvas-page` | Confetti + final scoreboard land on bright |
| `/leaders` | `.game-canvas` | Long-dwell browsing |
| `/account` | `.game-canvas` | Long-dwell |
| `/u/[handle]` | `.game-canvas` | Long-dwell |
| `/sign-in` | `.game-canvas` | Simple form, warm welcome |
| `/auth/*` callback handlers | inherit `.game-canvas` from layout fallback | Transient; no special treatment |

The root `app/layout.tsx` sets `.game-canvas` as the default on `<body>`. Pages that need a different canvas override via their own top-level `<main>` class.

## Component principles

### UI primitives (`components/ui/*`)

- **Button** — Four variants retuned:
  - `default` → pink fill, ink border (2px), ink text, 3px offset shadow, font-heading font-black. Hover nudges -2px/-2px with 5px shadow; active compresses to 0 shadow.
  - `outline` → transparent fill, ink border, ink text. Hover fills with `--muted`.
  - `destructive` → warm-red fill, cream text, ink border, offset shadow.
  - `ghost` → no border, ink text, hover adds `--muted` bg.
  - `secondary` → cyan fill, ink border, ink text. Used for counter-CTAs.
  - Sizes unchanged.
- **Card** — Applies `.game-card` by default via class composition. `border-none` on the base shadcn template so `.game-card` owns the border. Existing `data-slot` system preserved.
- **Input** — White fill on light canvases, `color-mix` muted cream on dark, 2px ink border always, ink focus ring with 2px offset. `rounded-lg` (not `rounded-md` — chunkier matches the aesthetic).
- **Textarea** — Same treatment as Input.
- **Label** — font-heading, uppercase tracking optional per caller, ink color.

### Game-specific components

- **`create-room-card`** — Per landing plan phase 4: hot-pink fill, left tilt (`md:-rotate-1`), white-fill inputs with ink borders, yellow-on-ink submit button, `ModeButton` active-state = ink fill + canvas text, Artist mode first, default `useState<"party"|"artist">` flipped to `"artist"`. Theme-pack chips retuned to ink/cream sticker style.
- **`join-room-card`** — Per landing plan phase 5: cyan fill, right tilt (`md:rotate-1`), 4-letter code input as centerpiece (h-14, tracking-[0.45em], center-aligned, white fill + ink border), pink-on-ink submit button (crosses colors with Create's yellow).
- **`chat-panel`** — Both inline and floating variants retuned:
  - Container: `.game-card` with `--game-paper` fill (both variants). Reads as an elevated surface over any canvas.
  - Messages: no bubble fill — flat rows on the paper container. Each row has a 4px colored left stripe in the sender's `colorForPlayer()` hue, display name in that same hue, ink message text. Solves contrast: paper-on-paper bubble problem avoided by having no bubble.
  - Input row: paper fill, ink border, ink-on-pink send button.
  - Blackout (during guessing) replaces the input with a sticker pill: "Chat locked — guessing in progress".
  - Floating variant position unchanged (`fixed bottom-4 right-4`), chrome now `.game-card`.
- **`reactions-bar`** — 6 emoji buttons become sticker pills: cream fill, ink border, hover nudges -1px offset. Floating emoji animations (the 1.8s fade/scale float-up) unchanged — they're pure emoji, no chrome to restyle.
- **`host-controls`** — Kick button: `.game-card` mini, warm-red fill, cream text. Crown button: `.game-card` mini, yellow fill, ink text. Both with 2px offset shadow.
- **`live-cursors`** — Cursor SVG retains `colorForPlayer()` fill. Label pill replaces hardcoded `text-black` with `text-[var(--game-ink)]` and `bg-white` with `bg-[var(--game-cream)]`. Border adds 1px ink.
- **`prompt-flipboard`** — Each word tile: cream fill, ink text, ink border. Role tokens get a colored underline-block beneath the word, not text color: subject → pink, style → cyan, modifier → orange, filler → muted. The `.prompt-flip` 3D-flip animation is unchanged.
- **`profile-stats-card`** — Outer frame: `.game-card` with `--game-paper` fill. Inside: a navy inset band (`--game-canvas-dark` bg, mimics landing's "How it goes down" section) containing the 6-cell grid. Each stat cell: cream text (`--game-cream` — reads clearly on the navy band in both modes), small colored dot above the number (pink/cyan/orange/yellow/pink/cyan rotating), mono numbers.
- **`user-menu`** — Avatar chip: solid `--game-pink` fill, ink border, ink initials (drops the hardcoded `linear-gradient(135deg, #6366f1, #d946ef, #f43f5e)` inline style). Dropdown menu: `.game-card`, cream fill, ink dividers between items.
- **`theme-toggle`** — Sticker-pill style, visible in the nav. Active state reversed-out (ink fill, canvas text).
- **`sfx-toggle`** — Same sticker-pill treatment.
- **`sign-in-card`** — Frame: `.game-card` with `--game-paper` fill. Provider buttons each get a distinct accent so the card reads as a palette showcase:
  - Google → cream fill, ink text, ink border (neutral)
  - Discord → cyan fill, ink text
  - Passkey → pink fill, cream text
  - Magic link → orange fill, ink text
  - Error state: `bg-destructive/20 border-destructive` (no more `bg-red-500/30`).
- **`loading-phrases`** — Text-only; inherits canvas foreground. The `.loading-phrase` fade-in keyframe unchanged. When on `.game-canvas-dark` (generating phase), text is `--game-cream`.

## Page treatments

- **`app/page.tsx`** — Per landing plan phase 3 (already specced there; included here for completeness).
- **`app/daily/daily-client.tsx`** — Yellow canvas, sticker-card guess input, marquee-pill for time-remaining until midnight UTC, flipboard recap post-guess, share card styled as `.game-card` with QR inline.
- **`app/play/[code]/lobby-client.tsx`** — Cream canvas; player list = column of mini sticker-card rows, each with rotational variance (±1.5°) for handmade feel; host controls inline next to each player; theme-pack selector = row of sticker pills; invite-card modal = `.game-card` with QR.
- **`app/play/[code]/game-client.tsx`** — Phase-aware canvas. Generating/guessing/scoring render on `.game-canvas-dark`; reveal/game_over flip to `.game-canvas-page`. In-game:
  - Gemini painting wrapped in `.game-frame` (the thicker 5px border + 6px offset variant of `.game-card`).
  - Timer: `.marquee-pill` floating top-right of the frame, mono, wide-tracked.
  - Scoreboard: horizontal rail of mini sticker cards below the input, each card = avatar (`.player-chip`) + display name + running score in mono. Scrollable on mobile.
  - Guess input: fat (h-14) cream-fill input with ink border, sitting directly under the frame. Submit button = pink fill, ink border, offset shadow.
  - Chat panel: floating `.game-card` bottom-right.
  - Reactions bar: sticker-row bottom-center.
  - Team chrome: team indicators use `--team-1` / `--team-2` (no more hardcoded hex). Team badges on scoreboard rows = left-edge 4px color stripe.
  - Error boxes (network, generation failure): `bg-destructive/20 border-destructive` — no more `bg-red-500/30`.
- **`app/play/[code]/join-inline.tsx`** — Matches lobby cream canvas; name picker = `.game-card` with sticker-pill submit.
- **`app/leaders/page.tsx`** — Cream canvas. Three columns as sticker cards (points / wins / streak), each column with an italic heading. Top 3 rows of each column get a medal chip using `--medal-gold / --medal-silver / --medal-bronze` tokens (no more hardcoded hex). Rank numbers use the new `.player-chip`.
- **`app/account/page.tsx`** — Cream canvas, italic hero title with optional `.game-hero-mark` on the user's handle, ProfileStatsCard below. Sign-out button = ghost variant.
- **`app/u/[handle]/page.tsx`** — Same layout as `/account` but public.
- **`app/sign-in/page.tsx`** — Cream canvas, centered sign-in-card.

## Testing

### Rendering smoke

Each migrated page gets a Playwright test that:
1. Opens the page (seeded as needed — rooms via `createRoomAs` helper).
2. Asserts the expected canvas class is present (`document.body.classList` or the page's root element).
3. Asserts no TypeScript/runtime errors in the console.

Not pixel-diff testing — that's too fragile for a redesign PR and would fight the natural `md:rotate-*` variance.

### Design-tokens.spec.ts (new)

One dedicated spec:
- Toggles between light and dark modes on three representative routes (`/`, `/play/[code]` lobby, in-game).
- Asserts the expected canvas class is present in each mode.
- Asserts `.promptionary-gradient`, `.promptionary-grain`, `.text-hero` never appear in rendered HTML anywhere.
- Asserts `--brand-indigo`, `--brand-fuchsia`, `--brand-rose` don't appear in computed styles anywhere (catches stragglers).

### Existing e2e updates

Check every spec in `tests/e2e/` for selectors that assert on old chrome class names or inline styles. Expected low touch:
- `artist-mode.spec.ts` — Artist button still named "Artist"; test passes unchanged.
- `teams.spec.ts` — Team indicator selectors may change if they asserted on hex colors. Likely they assert on data attributes or text; confirm and update only if needed.
- `recap.spec.ts` — Asserts flipboard role classes. Role class names (`role-subject` etc.) are unchanged; only their CSS flips. Should pass.
- All others — change only if a selector references a deleted class.

### Gates

- `bun run build` passes.
- `bun test:e2e:local` full suite green.
- `grep -rn 'promptionary-gradient\|promptionary-grain\|text-hero\|brand-indigo\|brand-fuchsia\|brand-rose\|text-white\|text-black\|bg-red-500\|#6366f1\|#f43f5e\|#facc15\|#a3a3a3\|#d97706' app components lib` returns zero matches at end of PR.

## PR shape

One branch (`feat/sitewide-jackbox-redesign`, already created), one PR, ten sequenced commits so each is independently reviewable and revertable:

1. **Tokens + utilities** — `globals.css` changes only. Adds `--game-*` layer (light + dark), adds all `.game-*` utilities including new additions. Nothing uses them yet.
2. **UI primitives** — Retune `ui/button`, `ui/card`, `ui/input`, `ui/textarea`, `ui/label`. Other components auto-inherit.
3. **Landing** — Execute the existing landing-redesign plan phases 2–5 verbatim: `app/page.tsx`, `create-room-card`, `join-room-card`, Artist default flip.
4. **Lobby** — `lobby-client.tsx` + `join-inline.tsx` on cream canvas with sticker-card player rows and host-controls/theme-pack retreatment.
5. **In-game (dark phases)** — `game-client.tsx` for generating/guessing/scoring. `.game-canvas-dark`, `.game-frame` around painting, scoreboard rail, marquee timer.
6. **In-game (reveal + game_over)** — Canvas flip to yellow, flipboard retreatment, confetti integration check.
7. **/daily** — `daily-client.tsx` + share-card component.
8. **/leaders** — Three-column sticker-card layout, medal tokens wired.
9. **/sign-in + /account + /u/[handle]** — Cream canvas, provider button accents, ProfileStatsCard navy band.
10. **Cleanup** — Delete `.promptionary-gradient`, `.promptionary-grain`, `.text-hero`, SVG fractal-noise data URI, `--brand-*` tokens. Remove any now-unused imports. Grep verification. Add `design-tokens.spec.ts`.

## Gotchas

- **Tailwind v4 `text-[var(--token)]/85` opacity syntax is unreliable.** Use `color-mix(in oklch, var(--token) 85%, transparent)` via inline `style` for opacity-modified colors. Already true for the landing plan; applies sitewide.
- **`.game-card` on shadcn `<Card>` requires `border-none`** on the base template, otherwise shadcn's default border fights the utility's border. Encoded in the `ui/card` retune.
- **Custom CSS properties in React `style`** need `as React.CSSProperties` or the `["--foo" as string]` cast. Used for `.sticker` tilt overrides and `.player-chip` color overrides.
- **Canvas switch inside `game-client.tsx`** based on phase will cause a repaint between scoring and reveal. That's fine — it matches the mood shift from "tense stage" to "victory lap." Confirm no layout shift on the transition.
- **Dark mode on yellow canvases.** The `color-scheme: light` lock on `.game-canvas-page` is critical — without it, some browsers force-invert the page. Do not remove.
- **`ProfileStatsCard` navy inset band** creates a nested canvas-dark inside a canvas-warm card. Make sure focus rings and hover states still render correctly across the boundary.
- **Don't regress `colorForPlayer()`.** It's the deterministic per-player identity (hue band 220–360). Untouched.

## Follow-up ideas (not this PR)

- Custom OG image matching the new aesthetic
- Favicon redesign (current is placeholder)
- PWA manifest
- Dark variant of the landing canvas (would require removing the `color-scheme: light` lock and designing a navy-canvas landing — worth its own design conversation)
- Animated card wobble behind `prefers-reduced-motion` gate
- Live-player counter in the nav (wires into Supabase presence)
