# Sitewide Jackbox Redesign Implementation Plan

> ⚠️ **Historical artifact.** Written 2026-04-19; the redesign shipped on the `feat/sitewide-jackbox-redesign` branch. Token names, file paths, and component breakdowns may have drifted since. Read [`AGENTS.md`](../../../AGENTS.md) for live tokens and conventions.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the entire site from the gradient-and-glassmorphism chrome to the Jackbox × Arc sticker-card aesthetic, with full dark-mode support and all tokenization cleanup, in a single feature branch of ten independently revertable commits.

**Architecture:** Token-first CSS overhaul. Phase 1 lands a `--game-*` token layer (light + dark) and utility grammar (`.game-canvas*`, `.game-card`, `.game-hero*`, `.sticker`, `.marquee-pill`, `.live-dot`, `.game-frame`, `.player-chip`) in `app/globals.css`, re-pointing shadcn semantic tokens at the new system. Phases 2–9 migrate UI primitives, the landing, and each page surface to the new canvas/utility grammar. Phase 10 deletes the old `.promptionary-gradient` / `.promptionary-grain` / `.text-hero` utilities and `--brand-*` tokens once nothing references them.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (config inlined in `globals.css` via `@theme inline`), shadcn/ui primitives, Unbounded (heading) + Geist (body) + Geist Mono, Playwright e2e, Bun dev server.

**Design spec:** [`docs/superpowers/specs/2026-04-19-sitewide-jackbox-redesign-design.md`](../specs/2026-04-19-sitewide-jackbox-redesign-design.md) — read this before starting. It defines the canvas map, component principles, and gotchas.

---

## File structure summary

Files created by this plan:
- `tests/e2e/design-tokens.spec.ts` (Task 10)

Files modified by phase:

| Phase | Files |
|---|---|
| 1. Tokens + utilities | `app/globals.css` |
| 2. UI primitives | `components/ui/button.tsx`, `components/ui/card.tsx`, `components/ui/input.tsx`, `components/ui/textarea.tsx`, `components/ui/label.tsx` |
| 3. Landing | `app/page.tsx`, `components/create-room-card.tsx`, `components/join-room-card.tsx` |
| 4. Lobby | `app/play/[code]/lobby-client.tsx`, `app/play/[code]/join-inline.tsx`, `components/host-controls.tsx`, `components/chat-panel.tsx`, `components/reactions-bar.tsx` |
| 5. In-game dark phases | `app/play/[code]/game-client.tsx` (generating/guessing/scoring sections + team hex + error boxes + avatar chips), `components/live-cursors.tsx`, `components/loading-phrases.tsx` |
| 6. In-game reveal + game_over | `app/play/[code]/game-client.tsx` (reveal/game_over sections), `components/prompt-flipboard.tsx` |
| 7. /daily | `app/daily/daily-client.tsx` |
| 8. /leaders | `app/leaders/page.tsx` |
| 9. /sign-in + /account + /u + related | `app/sign-in/sign-in-card.tsx`, `app/account/page.tsx`, `app/u/[handle]/page.tsx`, `components/user-menu.tsx`, `components/profile-stats-card.tsx`, `components/theme-toggle.tsx`, `components/sfx-toggle.tsx` |
| 10. Cleanup + tests | `app/globals.css` (delete), `tests/e2e/design-tokens.spec.ts` (create), any straggler files found via grep |

One PR, ten commits, branch already created (`feat/sitewide-jackbox-redesign`).

---

## Task 1: Tokens + utility grammar

**Goal:** Add `--game-*` tokens (light + dark) and all `.game-*` utilities to `app/globals.css`. Re-point shadcn semantic tokens at game tokens. No component uses them yet — this commit is CSS-only and should cause zero visual regression because the semantic tokens end up with equivalent values (white card, navy-ish text, etc.). The `.promptionary-*` and `.text-hero` utilities stay in place for now.

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add a render-smoke Playwright that will catch any regression from the token re-point.**

File: `tests/e2e/design-tokens.spec.ts`

```ts
import { test, expect } from "@playwright/test";

test.describe("design tokens", () => {
  test("landing still renders with foreground + background tokens applied", async ({ page }) => {
    await page.goto("/");
    const body = page.locator("body");
    await expect(body).toBeVisible();
    const bg = await body.evaluate((el) => getComputedStyle(el).backgroundColor);
    const fg = await body.evaluate((el) => getComputedStyle(el).color);
    expect(bg).not.toBe("");
    expect(fg).not.toBe("");
  });
});
```

- [ ] **Step 2: Run the test to confirm baseline.**

Run: `bun test:e2e:local tests/e2e/design-tokens.spec.ts`
Expected: PASS (site currently renders, this is just the minimum guard).

- [ ] **Step 3: Append the game tokens to `:root` in `app/globals.css`.**

Insert the following block **after line 104** (closing `}` of `:root`) and **before** the `.dark` block at line 107. That is — add a NEW `:root { ... }` block specifically for the game layer. Tailwind v4 composes multiple `:root` blocks at the cascade level, so this is cleaner than editing the existing one inline.

```css
/* Landing / game-show palette — flat, saturated, chunky. Sitewide. */
:root {
  --game-canvas-yellow: #ffe15e;
  --game-canvas-warm: #fff7d6;
  --game-canvas-dark: #1e1b4d;
  --game-ink: #1e1b4d;
  --game-ink-soft: #3d2a7d;
  --game-cream: #fff7d6;
  --game-paper: #ffffff;
  --game-pink: #ff5eb4;
  --game-cyan: #3ddce0;
  --game-orange: #ff8b3d;
  /* Semantic aliases for non-shadcn usages */
  --medal-gold: var(--game-canvas-yellow);
  --medal-silver: var(--game-cream);
  --medal-bronze: var(--game-orange);
  --team-1: var(--game-pink);
  --team-2: var(--game-cyan);
}
```

- [ ] **Step 4: Add the dark-mode game tokens inside the existing `.dark` block.**

Edit `app/globals.css`. At the top of the `.dark { ... }` block (currently line 107), immediately after the opening brace, insert:

```css
  /* Game-layer overrides — canvas flips to deep navy; cream stays cream
     (it's the reversed-out-text token); accents brighten for dark canvas. */
  --game-canvas-yellow: #ffe15e;   /* landing locks color-scheme: light, doesn't apply */
  --game-canvas-warm: #14112e;
  --game-canvas-dark: #0b0920;
  --game-ink: #fff7d6;
  --game-ink-soft: #d4c8ff;
  --game-cream: #fff7d6;
  --game-paper: color-mix(in oklch, var(--game-ink-soft) 18%, var(--game-canvas-warm));
  --game-pink: #ff7dc4;
  --game-cyan: #6fe8eb;
  --game-orange: #ffa15e;
```

- [ ] **Step 5: Re-point shadcn semantic tokens at game tokens in `:root`.**

Edit `app/globals.css`, the original `:root` block (lines 61–104). Replace the existing color values with game-token references. After this edit, the block should look like this (do not touch the `--radius-*`, `--chart-*`, `--sidebar-*`, or `--surface-*` lines yet):

```css
:root {
  --brand-indigo: oklch(0.57 0.24 268);
  --brand-fuchsia: oklch(0.68 0.28 325);
  --brand-rose: oklch(0.69 0.24 15);

  --background: var(--game-canvas-warm);
  --foreground: var(--game-ink);
  --card: var(--game-paper);
  --card-foreground: var(--game-ink);
  --popover: var(--game-paper);
  --popover-foreground: var(--game-ink);
  --primary: var(--game-pink);
  --primary-foreground: var(--game-cream);
  --secondary: var(--game-cyan);
  --secondary-foreground: var(--game-ink);
  --muted: color-mix(in oklch, var(--game-ink) 8%, white);
  --muted-foreground: color-mix(in oklch, var(--game-ink) 65%, transparent);
  --accent: var(--game-cyan);
  --accent-foreground: var(--game-ink);
  --destructive: #e23d5e;
  --border: var(--game-ink);
  --input: var(--game-ink);
  --ring: var(--game-ink);

  --surface: var(--game-paper);
  --surface-raised: var(--game-paper);
  --surface-foreground: var(--game-ink);

  --chart-1: var(--game-pink);
  --chart-2: var(--game-cyan);
  --chart-3: var(--game-orange);
  --chart-4: var(--game-canvas-yellow);
  --chart-5: var(--game-ink-soft);
  --radius: 0.875rem;

  --sidebar: var(--game-canvas-warm);
  --sidebar-foreground: var(--game-ink);
  --sidebar-primary: var(--game-pink);
  --sidebar-primary-foreground: var(--game-cream);
  --sidebar-accent: var(--game-cyan);
  --sidebar-accent-foreground: var(--game-ink);
  --sidebar-border: var(--game-ink);
  --sidebar-ring: var(--game-ink);
}
```

Leave `--brand-*` tokens in place — they're deleted in Task 10 after nothing uses them.

- [ ] **Step 6: Do the same re-pointing in `.dark`.**

Edit the `.dark` block (currently lines 107–149). After the inserted game-token overrides from Step 4, replace the semantic-token values so the block looks like:

```css
.dark {
  /* Game-layer overrides (from Step 4) */
  --game-canvas-yellow: #ffe15e;
  --game-canvas-warm: #14112e;
  --game-canvas-dark: #0b0920;
  --game-ink: #fff7d6;
  --game-ink-soft: #d4c8ff;
  --game-cream: #fff7d6;
  --game-paper: color-mix(in oklch, var(--game-ink-soft) 18%, var(--game-canvas-warm));
  --game-pink: #ff7dc4;
  --game-cyan: #6fe8eb;
  --game-orange: #ffa15e;

  /* Brand legacy — deleted in Task 10 */
  --brand-indigo: oklch(0.7 0.22 268);
  --brand-fuchsia: oklch(0.75 0.25 325);
  --brand-rose: oklch(0.76 0.2 15);

  --background: var(--game-canvas-warm);
  --foreground: var(--game-ink);
  --card: var(--game-paper);
  --card-foreground: var(--game-ink);
  --popover: var(--game-paper);
  --popover-foreground: var(--game-ink);
  --primary: var(--game-pink);
  --primary-foreground: var(--game-cream);
  --secondary: var(--game-cyan);
  --secondary-foreground: var(--game-ink);
  --muted: color-mix(in oklch, var(--game-ink) 12%, var(--game-canvas-warm));
  --muted-foreground: color-mix(in oklch, var(--game-ink) 70%, transparent);
  --accent: var(--game-cyan);
  --accent-foreground: var(--game-ink);
  --destructive: #ff6b87;
  --border: var(--game-ink);
  --input: var(--game-ink);
  --ring: var(--game-ink);

  --surface: var(--game-paper);
  --surface-raised: var(--game-paper);
  --surface-foreground: var(--game-ink);

  --chart-1: var(--game-pink);
  --chart-2: var(--game-cyan);
  --chart-3: var(--game-orange);
  --chart-4: var(--game-canvas-yellow);
  --chart-5: var(--game-ink-soft);

  --sidebar: var(--game-canvas-warm);
  --sidebar-foreground: var(--game-ink);
  --sidebar-primary: var(--game-pink);
  --sidebar-primary-foreground: var(--game-cream);
  --sidebar-accent: var(--game-cyan);
  --sidebar-accent-foreground: var(--game-ink);
  --sidebar-border: var(--game-ink);
  --sidebar-ring: var(--game-ink);
}
```

- [ ] **Step 7: Append the new utility grammar to the `@layer utilities { ... }` block.**

At the END of `@layer utilities { ... }` (inside the closing `}` at line 274 of the original file), append the following block. Do NOT remove the existing `.promptionary-gradient`, `.promptionary-grain`, `.text-hero`, `.prompt-flip`, `.loading-phrase`, or `.nailed-pop` rules — they stay until Task 10.

```css
  /* ---------------------------------------------------------------
     Jackbox sticker-card system — sitewide grammar.
     --------------------------------------------------------------- */

  /* Canvas utilities. `page` variant force-locks light mode for the
     yellow marketing canvas; the other two flip with the dark class. */
  .game-canvas-page {
    background: var(--game-canvas-yellow);
    color: var(--game-ink);
    color-scheme: light;
  }
  .game-canvas {
    background: var(--game-canvas-warm);
    color: var(--game-ink);
  }
  .game-canvas-dark {
    background: var(--game-canvas-dark);
    color: var(--game-cream);
  }

  /* Sticker card — flat fill, hard ink border, chunky offset shadow.
     4px offset is what sells "stamped on paper" — don't replace with blur. */
  .game-card {
    border: 3px solid var(--game-ink);
    border-radius: 14px;
    box-shadow: 4px 4px 0 var(--game-ink);
    transition: transform 0.12s ease-out, box-shadow 0.12s ease-out;
  }
  .game-card:hover {
    transform: translate(-2px, -2px);
    box-shadow: 6px 6px 0 var(--game-ink);
  }
  .game-card:active {
    transform: translate(2px, 2px);
    box-shadow: 0 0 0 var(--game-ink);
  }

  /* Thicker picture-frame variant for the Gemini painting in-game. */
  .game-frame {
    border: 5px solid var(--game-ink);
    border-radius: 16px;
    box-shadow: 6px 6px 0 var(--game-ink);
  }

  /* Hero headline — solid ink with a colored highlight block around a
     single word. Example:
       <h1 class="game-hero">Guess the <span class="game-hero-mark">prompt.</span></h1> */
  .game-hero {
    font-family: var(--font-display), sans-serif;
    font-weight: 900;
    font-style: italic;
    letter-spacing: -0.03em;
    line-height: 0.95;
    color: var(--game-ink);
  }
  .game-hero-mark {
    display: inline-block;
    background: var(--game-pink);
    color: var(--game-cream);
    padding: 0 0.3em;
    border: 3px solid var(--game-ink);
    border-radius: 12px;
    transform: rotate(-1.5deg);
    box-shadow: 3px 3px 0 var(--game-ink);
  }

  /* Tilted pill. Override tilt inline via style={{ "--sticker-tilt": "10deg" }} */
  .sticker {
    --sticker-tilt: -2deg;
    display: inline-block;
    padding: 5px 14px;
    border: 2px solid var(--game-ink);
    border-radius: 999px;
    background: var(--game-paper);
    color: var(--game-ink);
    font-weight: 700;
    font-size: 12px;
    transform: rotate(var(--sticker-tilt));
  }

  /* Dark pill — round / timer / live-count indicators. */
  .marquee-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 14px;
    border-radius: 999px;
    background: var(--game-ink);
    color: var(--game-canvas-yellow);
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.15em;
    border: 2px solid var(--game-ink);
  }

  /* Pulsing dot for presence callouts. */
  .live-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--game-cyan);
    animation: live-pulse 1.6s ease-in-out infinite;
  }
  @keyframes live-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.55; transform: scale(0.75); }
  }
  @media (prefers-reduced-motion: reduce) {
    .live-dot { animation: none; }
  }

  /* Avatar chip — replaces hardcoded text-white/text-black spots across
     the codebase. Override fill via style={{ "--chip-color": "#ff5eb4" }}. */
  .player-chip {
    --chip-color: var(--game-pink);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: var(--chip-color);
    color: var(--game-ink);
    border: 2px solid var(--game-ink);
    box-shadow: 2px 2px 0 var(--game-ink);
    font-family: var(--font-heading);
    font-weight: 900;
  }
```

- [ ] **Step 8: Run `bun run build` and fix any TS/CSS errors.**

Run: `bun run build`
Expected: PASS. If color-mix syntax complains, wrap the `--muted` values in `oklch()` conversions — but modern browsers support color-mix as-is.

- [ ] **Step 9: Run the design-tokens smoke test.**

Run: `bun test:e2e:local tests/e2e/design-tokens.spec.ts`
Expected: PASS. The landing still renders; semantic tokens now derive from game tokens but the visual effect is near-identical (white cards, dark text, cream-ish bg).

- [ ] **Step 10: Run full e2e suite to catch any regression.**

Run: `bun test:e2e:local`
Expected: PASS. No page currently uses `.game-*` utilities; nothing visible should have changed beyond subtle hue shifts on cards/buttons (semantic tokens now pink-primary-ish, but existing inline classes still win where used).

- [ ] **Step 11: Commit.**

```bash
git add app/globals.css tests/e2e/design-tokens.spec.ts
git commit -m "feat(design): add game-* tokens and sticker-card utility grammar

Introduces --game-* token layer (light + dark) and the Jackbox
sticker-card utility grammar (.game-canvas*, .game-card, .game-hero*,
.sticker, .marquee-pill, .live-dot, .game-frame, .player-chip).

Re-points shadcn semantic tokens at the game layer. Old brand tokens
and .promptionary-* utilities stay until Task 10 so downstream pages
can migrate one at a time without regressing."
```

---

## Task 2: UI primitives

**Goal:** Retune the shadcn base components so any page consuming `<Button>`, `<Card>`, `<Input>`, `<Textarea>`, `<Label>` inherits the sticker grammar without further work.

**Files:**
- Modify: `components/ui/button.tsx`
- Modify: `components/ui/card.tsx`
- Modify: `components/ui/input.tsx`
- Modify: `components/ui/textarea.tsx`
- Modify: `components/ui/label.tsx`

- [ ] **Step 1: Read the current `components/ui/button.tsx`** to know its CVA shape. Note every variant name (default, outline, secondary, ghost, destructive, link, etc.) and size name before editing.

- [ ] **Step 2: Update the Button CVA variants.** Replace the `variants` object of the `buttonVariants` `cva(...)` call. The default variant becomes a sticker button (pink fill, ink border, offset shadow); other variants follow:

```ts
variants: {
  variant: {
    default:
      "bg-primary text-primary-foreground border-2 border-[var(--game-ink)] shadow-[3px_3px_0_var(--game-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--game-ink)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[0_0_0_var(--game-ink)] font-heading font-black",
    outline:
      "bg-transparent text-[var(--game-ink)] border-2 border-[var(--game-ink)] hover:bg-[var(--muted)]",
    secondary:
      "bg-secondary text-secondary-foreground border-2 border-[var(--game-ink)] shadow-[3px_3px_0_var(--game-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--game-ink)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[0_0_0_var(--game-ink)] font-heading font-black",
    ghost:
      "bg-transparent hover:bg-[var(--muted)] text-[var(--game-ink)]",
    destructive:
      "bg-destructive text-destructive-foreground border-2 border-[var(--game-ink)] shadow-[3px_3px_0_var(--game-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--game-ink)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[0_0_0_var(--game-ink)] font-heading font-black",
    link: "text-primary underline-offset-4 hover:underline",
  },
  size: {
    // keep existing size tokens verbatim
  },
},
```

In the `base` string of `cva(...)`, change `rounded-md` → `rounded-lg` so buttons read chunkier. Keep the existing focus-visible ring and disabled-state classes.

- [ ] **Step 3: Update `components/ui/card.tsx`.** Find the Card root className. It currently has something like `"rounded-xl border bg-card text-card-foreground shadow"`. Replace with:

```ts
"bg-card text-card-foreground game-card rounded-[14px] border-none"
```

`border-none` is required because `.game-card` owns the border (3px). If the Card sets its own border, you get a doubled border.

- [ ] **Step 4: Update `components/ui/input.tsx`.** Find the base className on the `<input>` element. Replace with:

```ts
"flex h-10 w-full rounded-lg border-2 border-[var(--game-ink)] bg-[var(--game-paper)] px-3 py-2 text-sm text-[var(--game-ink)] placeholder:text-[color:color-mix(in_oklch,var(--game-ink)_50%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--game-paper)] disabled:cursor-not-allowed disabled:opacity-50"
```

- [ ] **Step 5: Update `components/ui/textarea.tsx`** with the same base class pattern as Input but add `min-h-[80px]`.

- [ ] **Step 6: Update `components/ui/label.tsx`.** Change font classes to `font-heading text-[var(--game-ink)] text-sm font-bold`.

- [ ] **Step 7: Run `bun run build`.**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 8: Run the full e2e suite.** Some tests may assert on button text — unchanged. Visual changes are large but test assertions target labels/roles, not colors.

Run: `bun test:e2e:local`
Expected: PASS across the board.

- [ ] **Step 9: Commit.**

```bash
git add components/ui/button.tsx components/ui/card.tsx components/ui/input.tsx components/ui/textarea.tsx components/ui/label.tsx
git commit -m "feat(ui): retune shadcn primitives for sticker-card grammar

Buttons become sticker buttons (pink fill, ink border, 3px offset shadow,
italic-heavy Unbounded). Cards inherit .game-card so they get the
flat-fill + chunky-border + offset-shadow treatment. Inputs and textareas
get white fills + ink borders on any canvas. Label gets ink-heavy typography."
```

---

## Task 3: Landing page

**Goal:** Execute the user's original landing-redesign plan verbatim: Artist as default mode, new landing hero on yellow canvas, CreateRoomCard and JoinRoomCard retuned as pink/cyan sticker cards at opposing tilts.

**Files:**
- Modify: `components/create-room-card.tsx`
- Modify: `components/join-room-card.tsx`
- Modify: `app/page.tsx`

This task is effectively the original landing plan's phases 2–5. The design spec references the full code block for `app/page.tsx`; use that code verbatim.

- [ ] **Step 1: Flip Artist to default in `components/create-room-card.tsx`.**

Find the line:

```ts
const [mode, setMode] = useState<"party" | "artist">("party");
```

Change to:

```ts
const [mode, setMode] = useState<"party" | "artist">("artist");
```

- [ ] **Step 2: Reorder ModeButton siblings** so Artist renders first in the `grid grid-cols-2 gap-2` block. Swap the two `<ModeButton>` invocations.

- [ ] **Step 3: Retighten subtitles.** Set:
- Artist → `subtitle="One writes · others guess"`
- Party → `subtitle="AI writes · all guess"`

- [ ] **Step 4: Rename card title** from "Create a Room" to "Open a room" in the `<CardTitle>` text.

- [ ] **Step 5: Retreatment the outer Card.** Replace the opening `<Card className="...">` with:

```tsx
<Card
  className="w-full max-w-sm game-card md:-rotate-1 p-0 border-none"
  style={{ background: "var(--game-pink)", color: "var(--game-ink)" }}
>
```

- [ ] **Step 6: Retreatment all `<Input>` elements inside CreateRoomCard.** For each input (name input, any `#cfg-*` inputs inside `ConfigField`), override the `className` to:

```ts
className="bg-white border-2 rounded-lg h-10"
```

and add `style={{ borderColor: "var(--game-ink)", color: "var(--game-ink)" }}`.

- [ ] **Step 7: Retreatment the submit button.** Replace the existing `<Button type="submit" ...>`:

```tsx
<Button
  type="submit"
  className="w-full h-12 rounded-xl font-heading font-black text-base border-2"
  style={{
    background: "var(--game-canvas-yellow)",
    color: "var(--game-ink)",
    borderColor: "var(--game-ink)",
    boxShadow: "3px 3px 0 var(--game-ink)",
  }}
>
  Start →
</Button>
```

- [ ] **Step 8: Retreatment `ModeButton` active state.** Inside the internal `ModeButton` component, update its className + style per the original plan's phase 4 step 4:

```tsx
className={`rounded-xl px-3 py-2 border-2 text-left transition ${
  active ? "font-black" : "hover:opacity-80"
}`}
style={
  active
    ? { background: "var(--game-ink)", color: "var(--game-canvas-yellow)", borderColor: "var(--game-ink)" }
    : { background: "var(--game-paper)", color: "var(--game-ink)", borderColor: "var(--game-ink)" }
}
```

- [ ] **Step 9: Retreatment theme-pack chips.** For each pack chip, apply:

```tsx
className={`rounded-full px-3 py-1.5 text-xs font-black border-2 transition ${
  pack === p ? "" : "hover:opacity-80"
}`}
style={
  pack === p
    ? { background: "var(--game-ink)", color: "var(--game-canvas-yellow)", borderColor: "var(--game-ink)" }
    : { background: "var(--game-paper)", color: "var(--game-ink)", borderColor: "var(--game-ink)" }
}
```

- [ ] **Step 10: Retreatment `components/join-room-card.tsx`.** Replace the outer `<Card>`:

```tsx
<Card
  className="w-full max-w-sm game-card md:rotate-1 p-0 border-none"
  style={{ background: "var(--game-cyan)", color: "var(--game-ink)" }}
>
```

- [ ] **Step 11: Retreatment the 4-letter code input.** Find the `id="join-code"` input. Replace its className + style with:

```tsx
className="bg-white border-2 rounded-lg font-mono text-2xl h-14 text-center tracking-[0.45em] uppercase"
style={{ borderColor: "var(--game-ink)", color: "var(--game-ink)" }}
```

- [ ] **Step 12: Retreatment the name input** in the same file with the same bg-white + ink-border pattern as CreateRoomCard (Step 6).

- [ ] **Step 13: Retreatment the submit button** in JoinRoomCard:

```tsx
<Button
  type="submit"
  className="w-full h-12 rounded-xl font-heading font-black text-base border-2"
  style={{
    background: "var(--game-pink)",
    color: "var(--game-cream)",
    borderColor: "var(--game-ink)",
    boxShadow: "3px 3px 0 var(--game-ink)",
  }}
>
  Enter →
</Button>
```

- [ ] **Step 14: Replace `app/page.tsx` entirely** with the block from the original landing plan, phase 3, step 1. Use that code verbatim. Confirm the file imports `CreateRoomCard`, `JoinRoomCard`, `createSupabaseServerClient`, `getCurrentProfile` and ships the 3-step "How it goes down" dark-navy band.

- [ ] **Step 15: Run `bun run build`.**

Run: `bun run build`
Expected: PASS. If TS complains about `["--sticker-tilt" as string]`, change to `as React.CSSProperties` on the whole object.

- [ ] **Step 16: Add a landing render-smoke test** to `tests/e2e/design-tokens.spec.ts`:

```ts
test("landing uses game-canvas-page (yellow, light-locked)", async ({ page }) => {
  await page.goto("/");
  const main = page.locator("main").first();
  await expect(main).toHaveClass(/game-canvas-page/);
  const hero = page.locator(".game-hero").first();
  await expect(hero).toBeVisible();
  const mark = page.locator(".game-hero-mark").first();
  await expect(mark).toHaveText(/prompt/);
});
```

- [ ] **Step 17: Run the artist-mode e2e** (the Artist button click is now idempotent since it's preselected):

Run: `bun test:e2e:local tests/e2e/artist-mode.spec.ts`
Expected: PASS.

- [ ] **Step 18: Run the full e2e suite** to catch regressions:

Run: `bun test:e2e:local`
Expected: PASS.

- [ ] **Step 19: Commit.**

```bash
git add app/page.tsx components/create-room-card.tsx components/join-room-card.tsx tests/e2e/design-tokens.spec.ts
git commit -m "feat(landing): sticker-card aesthetic + Artist-first default

Drops .promptionary-gradient/.text-hero from the landing in favor of
.game-canvas-page with italic Unbounded hero and a pink .game-hero-mark.
Create and Join cards become hot-pink and cyan sticker cards at opposing
tilts. Flips CreateRoomCard default to Artist mode with Artist-first copy."
```

---

## Task 4: Lobby migration

**Goal:** Migrate `/play/[code]` lobby to cream canvas with sticker-card player rows, sticker-pill theme-pack selector, retuned host-controls/chat/reactions.

**Files:**
- Modify: `app/play/[code]/lobby-client.tsx`
- Modify: `app/play/[code]/join-inline.tsx`
- Modify: `components/host-controls.tsx`
- Modify: `components/chat-panel.tsx`
- Modify: `components/reactions-bar.tsx`

- [ ] **Step 1: Replace the root `<main>` or top-level div class** in `app/play/[code]/lobby-client.tsx`. Find where `.promptionary-gradient promptionary-grain` is applied and swap to `game-canvas`. Remove `.text-hero` from the room-code heading; swap for `.game-hero` with an optional `.game-hero-mark` around the code.

- [ ] **Step 2: Retreat the player list rows.** Find the players map. Each row becomes a mini `.game-card` with a small rotation variance:

```tsx
{players.map((p, i) => (
  <li
    key={p.id}
    className="game-card flex items-center gap-3 px-4 py-3 bg-[var(--game-paper)]"
    style={{
      transform: `rotate(${i % 2 === 0 ? -0.8 : 0.8}deg)`,
    }}
  >
    <span
      className="player-chip w-10 h-10 text-sm"
      style={{ ["--chip-color" as string]: colorForPlayer(p.id) } as React.CSSProperties}
    >
      {initials(p.display_name)}
    </span>
    <span className="font-heading font-bold flex-1 truncate">{p.display_name}</span>
    {isHost && p.id !== myPlayerId && <HostControls playerId={p.id} />}
  </li>
))}
```

(`initials` helper may already exist — if not, inline `p.display_name.slice(0, 2).toUpperCase()`.)

- [ ] **Step 3: Retreat the theme-pack selector** in lobby-client. If packs render as a row of buttons, swap each to a `.sticker` with an inline `--sticker-tilt` alternating:

```tsx
<button
  className={`sticker ${active ? "" : "opacity-70 hover:opacity-100"}`}
  style={{
    ["--sticker-tilt" as string]: `${i % 2 === 0 ? -3 : 3}deg`,
    ...(active
      ? { background: "var(--game-pink)", color: "var(--game-cream)" }
      : {}),
  } as React.CSSProperties}
>
  {pack}
</button>
```

- [ ] **Step 4: Retreat the "Start game" host button** to use default Button variant (which is now the pink sticker button — no extra work) with an arrow: `<Button className="w-full h-12">Start →</Button>`.

- [ ] **Step 5: Retreat `components/host-controls.tsx`.** Replace both buttons' classNames with sticker-mini treatment:

```tsx
// Kick button
<button
  title="Kick"
  onClick={onKick}
  className="game-card w-8 h-8 flex items-center justify-center rounded-full text-sm"
  style={{
    background: "var(--destructive)",
    color: "var(--destructive-foreground)",
  }}
>
  ✕
</button>

// Crown (transfer host)
<button
  title="Make host"
  onClick={onTransfer}
  className="game-card w-8 h-8 flex items-center justify-center rounded-full text-sm"
  style={{
    background: "var(--game-canvas-yellow)",
    color: "var(--game-ink)",
  }}
>
  👑
</button>
```

- [ ] **Step 6: Retreat `components/chat-panel.tsx`.** Container:

```tsx
<div className="game-card bg-[var(--game-paper)] text-[var(--game-ink)] p-4 flex flex-col gap-2">
```

Messages:

```tsx
<div className="flex gap-3 items-start">
  <div
    className="w-1 self-stretch rounded-full"
    style={{ background: colorForPlayer(msg.player_id) }}
  />
  <div className="min-w-0 flex-1">
    <span
      className="font-heading font-black text-sm"
      style={{ color: colorForPlayer(msg.player_id) }}
    >
      {msg.display_name}
    </span>
    <p className="text-sm text-[var(--game-ink)]">{msg.body}</p>
  </div>
</div>
```

Input row: pink-submit default button + `<Input>` (which now picks up the game-paper/ink styling from Task 2).

Blackout banner (replaces input during guessing):

```tsx
<div className="sticker w-full text-center" style={{ background: "var(--game-orange)" }}>
  Chat locked — guessing in progress
</div>
```

Floating variant position (`fixed bottom-4 right-4`) is unchanged.

- [ ] **Step 7: Retreat `components/reactions-bar.tsx`.** Each emoji button becomes a sticker pill:

```tsx
<button
  className="sticker text-base"
  onClick={() => onReact(emoji)}
>
  {emoji}
</button>
```

Floating-reaction CSS animation stays — it's pure emoji floating up, no chrome.

- [ ] **Step 8: Retreat `app/play/[code]/join-inline.tsx`** (the name-picker). Wrap its `<form>` in `<div className="game-card bg-[var(--game-paper)] p-6">` and apply `.game-canvas` to the top-level wrapper. Its button picks up the default pink sticker style.

- [ ] **Step 9: Run `bun run build`.**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 10: Add a lobby render-smoke test** to `tests/e2e/design-tokens.spec.ts`:

```ts
test("lobby uses game-canvas", async ({ page }) => {
  const { code } = await (await import("./helpers.ts")).createRoomAs(page, "Spec");
  await page.goto(`/play/${code}`);
  await expect(page.locator("main").first()).toHaveClass(/game-canvas/);
});
```

(Adjust import if helpers live elsewhere; reuse the existing `createRoomAs` signature.)

- [ ] **Step 11: Run lobby + chat + realtime-lobby e2e.**

Run: `bun test:e2e:local tests/e2e/create-and-join.spec.ts tests/e2e/chat.spec.ts tests/e2e/realtime-lobby.spec.ts`
Expected: PASS.

- [ ] **Step 12: Commit.**

```bash
git add app/play/[code]/lobby-client.tsx app/play/[code]/join-inline.tsx components/host-controls.tsx components/chat-panel.tsx components/reactions-bar.tsx tests/e2e/design-tokens.spec.ts
git commit -m "feat(lobby): sticker-card player rows and retuned chrome

Lobby moves to .game-canvas (cream), player list renders as mini
sticker cards with alternating tilt, theme-pack chips become .sticker
pills, host-controls become mini sticker-card buttons, chat drops
bubble fills in favor of colored left-stripe rows."
```

---

## Task 5: In-game dark phases (generating / guessing / scoring)

**Goal:** Migrate the in-game screen's active phases to `.game-canvas-dark`, frame the Gemini image with `.game-frame`, retune the scoreboard as a sticker-card rail, swap the timer to `.marquee-pill`, and clean up all in-game hotspots (team hex, bg-red-500, text-black/text-white on avatars).

**Files:**
- Modify: `app/play/[code]/game-client.tsx` — only the generating / guessing / scoring phase branches + shared chrome (scoreboard, timer, input)
- Modify: `components/live-cursors.tsx`
- Modify: `components/loading-phrases.tsx`

`game-client.tsx` is large (~1100+ lines). Don't try to rewrite it wholesale. Make each subedit targeted.

- [ ] **Step 1: Locate the root phase branching.** Find the return block that switches on `phase` (generating / guessing / scoring / reveal / game_over). Wrap the generating/guessing/scoring branches in a `.game-canvas-dark` wrapper and leave reveal/game_over for Task 6.

Change the root wrapper from something like:

```tsx
<main className="min-h-screen promptionary-gradient promptionary-grain">
```

to:

```tsx
<main
  className={
    phase === "reveal" || phase === "game_over"
      ? "min-h-screen game-canvas-page"
      : "min-h-screen game-canvas-dark"
  }
>
```

(Lobby is handled by a separate wrapper file, so this branching only covers in-game.)

- [ ] **Step 2: Replace the hardcoded team colors.** Find the `TEAM_META` constant (near line 48 in game-client.tsx per the prior audit). Replace its hex values with CSS vars:

```ts
const TEAM_META = {
  1: { label: "Team 1", color: "var(--team-1)" },
  2: { label: "Team 2", color: "var(--team-2)" },
} as const;
```

- [ ] **Step 3: Wrap the Gemini image in `.game-frame`.** Locate the `<Image>` or `<img>` tag that renders the round's painting (it pulls from Supabase Storage). Wrap it:

```tsx
<div className="game-frame bg-[var(--game-paper)] p-2 inline-block">
  <img src={imageUrl} alt="Round painting" className="rounded-[10px] block max-w-full h-auto" />
</div>
```

- [ ] **Step 4: Replace the timer with `.marquee-pill`.** Find the timer display (uses `useAnimatedNumber` on `remainingSeconds` and renders something like `<span>{remaining}s</span>`). Replace its chrome:

```tsx
<span className="marquee-pill">
  <span className="live-dot" aria-hidden />
  {remaining}s
</span>
```

- [ ] **Step 5: Retreatment the scoreboard rail.** Find the scoreboard that renders during guessing (a list of players with running scores). Change the row template from its current chrome to mini sticker cards:

```tsx
<div className="flex gap-3 overflow-x-auto pb-2">
  {players.map((p) => (
    <div
      key={p.id}
      className="game-card bg-[var(--game-paper)] flex items-center gap-2 px-3 py-2 shrink-0"
    >
      <span
        className="player-chip w-8 h-8 text-xs"
        style={{ ["--chip-color" as string]: colorForPlayer(p.id) } as React.CSSProperties}
      >
        {initials(p.display_name)}
      </span>
      <span className="font-heading font-bold text-sm text-[var(--game-ink)]">
        {p.display_name}
      </span>
      <span className="font-mono text-sm text-[var(--game-ink)]">{p.score}</span>
    </div>
  ))}
</div>
```

Remove the five places where `text-black` or `text-white` appear on avatar spans — they're replaced by `.player-chip`.

- [ ] **Step 6: Retreatment the guess input row.** Locate the controlled guess `<Input>`. Its base styling now comes from the retuned `ui/input.tsx` (Task 2). Override the height for emphasis:

```tsx
<Input
  className="h-14 text-lg"
  ...existing props
/>
```

The submit button picks up the default sticker treatment.

- [ ] **Step 7: Replace all `bg-red-500/30` error boxes.** There are two instances (around lines 1131 and 1261 per the prior audit). Change each to:

```tsx
<div className="game-card bg-destructive/20 border-destructive text-destructive-foreground p-4">
  {errorMessage}
</div>
```

- [ ] **Step 8: Replace every `text-white` / `text-black` / inline `linear-gradient(...)` on avatar circles** inside game-client.tsx with a `.player-chip` span. Prior audit flagged these at lines 659, 731, 907, 993, 1041. Apply the same `.player-chip` template as in Step 5. If any avatar had a border or shadow override, drop it — `.player-chip` owns those.

- [ ] **Step 9: Retreatment `components/live-cursors.tsx`.** Find the label span (the cursor's "name pill"). Replace:

```tsx
// Before
<span className="bg-white text-black px-2 py-0.5 rounded text-xs">{name}</span>

// After
<span
  className="sticker text-xs"
  style={{ ["--sticker-tilt" as string]: "0deg" } as React.CSSProperties}
>
  {name}
</span>
```

No changes to the SVG cursor itself — `colorForPlayer()` still drives its fill.

- [ ] **Step 10: Retreatment `components/loading-phrases.tsx`.** Replace the rotating-text span's className with:

```tsx
<span className="loading-phrase font-heading italic text-[var(--game-cream)]">
  {phrase}
</span>
```

The `.loading-phrase` animation keyframe stays untouched.

- [ ] **Step 11: Run `bun run build`.**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 12: Add in-game render-smoke test** to `tests/e2e/design-tokens.spec.ts`:

```ts
test("in-game (guessing) uses game-canvas-dark", async ({ page, browser }) => {
  const helpers = await import("./helpers.ts");
  const { code } = await helpers.createRoomAs(page, "Host");
  const joiner = await (await browser.newContext()).newPage();
  await helpers.joinRoomAs(joiner, code, "Guesser");

  await page.getByRole("button", { name: /start/i }).click();
  await page.waitForSelector(".game-canvas-dark", { timeout: 20_000 });
  await expect(page.locator("main").first()).toHaveClass(/game-canvas-dark/);
  await expect(page.locator(".game-frame").first()).toBeVisible();
  await expect(page.locator(".marquee-pill").first()).toBeVisible();
});
```

- [ ] **Step 13: Run game-related e2e.**

Run: `bun test:e2e:local tests/e2e/full-round.spec.ts tests/e2e/multi-round.spec.ts tests/e2e/artist-mode.spec.ts tests/e2e/auto-submit.spec.ts`
Expected: PASS.

- [ ] **Step 14: Commit.**

```bash
git add app/play/[code]/game-client.tsx components/live-cursors.tsx components/loading-phrases.tsx tests/e2e/design-tokens.spec.ts
git commit -m "feat(game): dark stage canvas + framed painting + sticker scoreboard

Generating/guessing/scoring phases run on .game-canvas-dark. Gemini
painting sits in .game-frame. Scoreboard becomes a sticker-card rail.
Timer swaps to .marquee-pill. Replaces hardcoded team hex, bg-red-500
error boxes, and text-white/text-black on avatar circles with game
tokens and .player-chip."
```

---

## Task 6: In-game reveal and game_over

**Goal:** Migrate the reveal + game_over phases to `.game-canvas-page` (yellow, victory lap) and retune the PromptFlipboard for the new token system.

**Files:**
- Modify: `app/play/[code]/game-client.tsx` — only the reveal + game_over phase branches
- Modify: `components/prompt-flipboard.tsx`

- [ ] **Step 1: Verify the canvas branching from Task 5 Step 1 switches to `.game-canvas-page` on reveal/game_over.** If the condition is already in place, confirm visually by running `bun dev` and advancing to reveal in a test room.

- [ ] **Step 2: Retreatment `components/prompt-flipboard.tsx`.** Each word tile's container:

```tsx
<span
  className="prompt-flip inline-block px-2 py-1 mx-0.5 rounded-md border-2 bg-[var(--game-paper)] text-[var(--game-ink)]"
  style={{ borderColor: "var(--game-ink)", animationDelay: `${i * 80}ms` }}
>
  <span className={`role-${role}-underline`}>{word}</span>
</span>
```

Add these role-underline rules to `app/globals.css` inside `@layer utilities { ... }`, appended after the existing `.prompt-flip` / `.loading-phrase` / `.nailed-pop` rules:

```css
.role-subject-underline { box-shadow: inset 0 -6px 0 var(--game-pink); }
.role-style-underline { box-shadow: inset 0 -6px 0 var(--game-cyan); }
.role-modifier-underline { box-shadow: inset 0 -6px 0 var(--game-orange); }
.role-filler-underline { box-shadow: inset 0 -6px 0 color-mix(in oklch, var(--game-ink) 20%, transparent); }
```

The `.prompt-flip` animation is untouched.

- [ ] **Step 3: Retreatment the top-guess callout.** Find the "Top guess" or "Nailed it" chip in the reveal section. Wrap in `.game-card` with a pink fill and the `.nailed-pop` animation (already defined):

```tsx
<div
  className="game-card nailed-pop inline-flex items-center gap-2 px-4 py-2 bg-[var(--game-pink)]"
>
  <span className="font-heading italic text-[var(--game-cream)]">Top guess</span>
  <span className="font-mono text-[var(--game-cream)]">{topGuess}</span>
</div>
```

- [ ] **Step 4: Retreatment the final scoreboard on game_over.** Same sticker-card rail pattern as in-game (Task 5 Step 5), but vertical stacking on game_over with the winning row rotated 2° and featuring a yellow `.game-hero-mark` around the score. If teams are enabled, show team cards at the top using `--team-1` / `--team-2` fills.

- [ ] **Step 5: Confirm the confetti trigger still fires on game_over.** The canvas switch doesn't change the confetti library; just verify it visually.

- [ ] **Step 6: Run `bun run build`.**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 7: Run reveal + recap + teams e2e.**

Run: `bun test:e2e:local tests/e2e/recap.spec.ts tests/e2e/teams.spec.ts tests/e2e/artist-teams.spec.ts tests/e2e/play-again.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add app/play/[code]/game-client.tsx components/prompt-flipboard.tsx
git commit -m "feat(game): yellow-canvas reveal + retuned flipboard

Reveal and game_over run on .game-canvas-page (yellow) for the victory
lap. Flipboard tiles are paper-filled with role-colored inset underlines
(pink/cyan/orange/muted). Top-guess callout uses pink .game-card with
nailed-pop animation."
```

---

## Task 7: /daily

**Goal:** Migrate `/daily` to yellow canvas with sticker-card guess input, marquee-pill time-remaining, and flipboard-style recap.

**Files:**
- Modify: `app/daily/daily-client.tsx`

- [ ] **Step 1: Swap the top-level wrapper** from `.promptionary-gradient promptionary-grain` to `.game-canvas-page`. Drop `.text-hero` from the heading; use `.game-hero` with optional `.game-hero-mark` on "today".

- [ ] **Step 2: Wrap the puzzle image in `.game-frame`** (same pattern as game-client Task 5 Step 3).

- [ ] **Step 3: Replace the time-remaining display** with `.marquee-pill`:

```tsx
<span className="marquee-pill">
  <span className="live-dot" aria-hidden />
  resets in {timeLeft}
</span>
```

- [ ] **Step 4: Replace the guess input + submit** — defaults from Task 2 take over. Override the input height:

```tsx
<Input className="h-14 text-lg" ... />
```

- [ ] **Step 5: Retreatment the global leaderboard rows.** Each row becomes a mini sticker-card with `.player-chip` avatar + mono score:

```tsx
<li className="game-card bg-[var(--game-paper)] flex items-center gap-3 px-4 py-3">
  <span className="player-chip w-10 h-10 text-sm"
        style={{ ["--chip-color" as string]: colorForPlayer(p.id) } as React.CSSProperties}>
    {rank}
  </span>
  <span className="flex-1 font-heading font-bold">{p.display_name}</span>
  <span className="font-mono text-lg text-[var(--game-ink)]">{p.score}</span>
</li>
```

- [ ] **Step 6: Replace the `bg-red-500/30` error box** (prior audit line 247) with the same `.game-card bg-destructive/20 border-destructive` pattern as in Task 5.

- [ ] **Step 7: Retreatment the share card.** Wrap QR + share links in `.game-card bg-[var(--game-paper)]`.

- [ ] **Step 8: Run `bun run build`.**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 9: Run the daily e2e.**

Run: `bun test:e2e:local tests/e2e/daily.spec.ts`
Expected: PASS.

- [ ] **Step 10: Add /daily smoke** to `tests/e2e/design-tokens.spec.ts`:

```ts
test("/daily uses game-canvas-page", async ({ page }) => {
  await page.goto("/daily");
  await expect(page.locator("main").first()).toHaveClass(/game-canvas-page/);
});
```

- [ ] **Step 11: Commit.**

```bash
git add app/daily/daily-client.tsx tests/e2e/design-tokens.spec.ts
git commit -m "feat(daily): yellow-canvas solo puzzle with sticker leaderboard

/daily moves to .game-canvas-page matching the landing. Puzzle image
sits in .game-frame. Time-remaining is a .marquee-pill. Leaderboard
rows become mini sticker cards with .player-chip avatars."
```

---

## Task 8: /leaders

**Goal:** Migrate `/leaders` to cream canvas with three sticker-card columns, mapping hardcoded medal hex to `--medal-*` tokens.

**Files:**
- Modify: `app/leaders/page.tsx`

- [ ] **Step 1: Swap the top-level wrapper** to `.game-canvas`. Drop `.text-hero` from the heading; use `.game-hero` with a `.game-hero-mark` on "fame".

- [ ] **Step 2: Locate the hardcoded medal hex** (prior audit lines 25–29):

```ts
const MEDAL_COLORS = {
  1: "#facc15",
  2: "#a3a3a3",
  3: "#d97706",
};
```

Replace with:

```ts
const MEDAL_COLORS = {
  1: "var(--medal-gold)",
  2: "var(--medal-silver)",
  3: "var(--medal-bronze)",
};
```

- [ ] **Step 3: Retreatment each leaderboard column** (points / wins / streak). Each becomes a `.game-card`:

```tsx
<div className="game-card bg-[var(--game-paper)] p-4 flex-1">
  <h2 className="game-hero text-2xl mb-4">
    <span className="game-hero-mark" style={{ background: "var(--game-cyan)" }}>
      {column.label}
    </span>
  </h2>
  <ol className="space-y-2">
    {column.rows.map((row, i) => <LeaderRow key={row.id} row={row} rank={i + 1} />)}
  </ol>
</div>
```

- [ ] **Step 4: Retreatment `LeaderRow`** (inline component or extract):

```tsx
function LeaderRow({ row, rank }) {
  return (
    <li className="flex items-center gap-3 hover:bg-[color:color-mix(in_oklch,var(--game-ink)_5%,transparent)] rounded-lg px-2 py-2">
      <span
        className="player-chip w-9 h-9 text-sm"
        style={
          rank <= 3
            ? ({ ["--chip-color" as string]: MEDAL_COLORS[rank] } as React.CSSProperties)
            : ({ ["--chip-color" as string]: colorForPlayer(row.id) } as React.CSSProperties)
        }
      >
        {rank}
      </span>
      <span className="flex-1 truncate font-heading font-bold">{row.display_name}</span>
      <span className="font-mono text-[var(--game-ink)]">{row.value}</span>
    </li>
  );
}
```

Replace `text-white` on the avatar (prior audit line 92) — `.player-chip` owns the text color now.

- [ ] **Step 5: Run `bun run build`.**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 6: Add /leaders smoke** to `tests/e2e/design-tokens.spec.ts`:

```ts
test("/leaders uses game-canvas with medal tokens", async ({ page }) => {
  await page.goto("/leaders");
  await expect(page.locator("main").first()).toHaveClass(/game-canvas/);
  await expect(page.locator(".game-card").first()).toBeVisible();
});
```

- [ ] **Step 7: Run the leaders page manually** via `bun dev` to confirm hex medals are visually identical (yellow / cream / orange) and that no hardcoded hex leaks into rendered HTML (`view-source` grep).

- [ ] **Step 8: Commit.**

```bash
git add app/leaders/page.tsx tests/e2e/design-tokens.spec.ts
git commit -m "feat(leaders): sticker-card columns with token-mapped medals

Hall of fame moves to .game-canvas. Three columns (points/wins/streak)
render as .game-card panels with .game-hero-mark headings. Medal colors
now pull from --medal-gold/silver/bronze tokens instead of hardcoded hex."
```

---

## Task 9: /sign-in + /account + /u/[handle] + related components

**Goal:** Migrate auth and profile pages to cream canvas. Retreatment user-menu, profile-stats-card, theme-toggle, sfx-toggle.

**Files:**
- Modify: `app/sign-in/sign-in-card.tsx`
- Modify: `app/account/page.tsx`
- Modify: `app/u/[handle]/page.tsx`
- Modify: `components/user-menu.tsx`
- Modify: `components/profile-stats-card.tsx`
- Modify: `components/theme-toggle.tsx`
- Modify: `components/sfx-toggle.tsx`

- [ ] **Step 1: Retreatment `components/user-menu.tsx`.** Find the hardcoded avatar gradient (prior audit line 132):

```tsx
// Before
style={{ background: "linear-gradient(135deg, #6366f1 0%, #d946ef 55%, #f43f5e 100%)" }}
```

Replace with:

```tsx
className="player-chip w-9 h-9 text-sm"
// drop the inline style
```

The avatar now renders as a pink `.player-chip` with ink initials. Dropdown container gets `.game-card bg-[var(--game-paper)]`.

- [ ] **Step 2: Retreatment `components/theme-toggle.tsx` and `components/sfx-toggle.tsx`** as sticker-style pills. Each becomes:

```tsx
<button
  className="sticker"
  onClick={onClick}
  style={{
    ["--sticker-tilt" as string]: "0deg",
    ...(active
      ? { background: "var(--game-ink)", color: "var(--game-canvas-yellow)" }
      : {}),
  } as React.CSSProperties}
>
  {icon} {label}
</button>
```

- [ ] **Step 3: Retreatment `app/sign-in/sign-in-card.tsx`.** Outer container: `.game-card bg-[var(--game-paper)]`. For each provider button, override the variant:

```tsx
// Google — cream
<Button variant="outline" className="w-full h-12">Continue with Google</Button>

// Discord — cyan
<Button className="w-full h-12" style={{ background: "var(--game-cyan)", color: "var(--game-ink)" }}>
  Continue with Discord
</Button>

// Passkey — pink (default variant)
<Button className="w-full h-12">Use a passkey</Button>

// Magic link — orange
<Button className="w-full h-12" style={{ background: "var(--game-orange)", color: "var(--game-ink)" }}>
  Send magic link
</Button>
```

Replace the `bg-red-500/20 border-red-500/30` error state (prior audit line 147) with `bg-destructive/20 border-destructive` and drop any `text-white` on the inner button.

Swap the page-level `.promptionary-gradient promptionary-grain` in `app/sign-in/page.tsx` to `.game-canvas`.

- [ ] **Step 4: Retreatment `components/profile-stats-card.tsx`.** Outer frame: `.game-card bg-[var(--game-paper)]`. Inner 6-cell grid moves into a navy inset band:

```tsx
<div className="game-card bg-[var(--game-paper)] p-6">
  <h2 className="game-hero text-xl mb-4">Your stats</h2>
  <div className="rounded-xl p-5 grid grid-cols-2 gap-4"
       style={{ background: "var(--game-canvas-dark)", color: "var(--game-cream)" }}>
    {cells.map((cell, i) => (
      <div key={cell.label} className="text-center">
        <span
          className="inline-block w-2 h-2 rounded-full mb-1"
          style={{ background: DOT_COLORS[i % DOT_COLORS.length] }}
          aria-hidden
        />
        <p className="font-mono text-2xl">{cell.value}</p>
        <p className="text-xs uppercase tracking-wider opacity-80">{cell.label}</p>
      </div>
    ))}
  </div>
</div>
```

Where `DOT_COLORS = ["var(--game-pink)", "var(--game-cyan)", "var(--game-orange)", "var(--game-canvas-yellow)", "var(--game-pink)", "var(--game-cyan)"]`.

- [ ] **Step 5: Retreatment `app/account/page.tsx` and `app/u/[handle]/page.tsx`.** Swap the page wrapper from `.promptionary-gradient promptionary-grain` to `.game-canvas`. Replace `.text-hero` heading with `.game-hero` (with an optional `.game-hero-mark` around the handle). Drop the `text-white` on the avatar span (prior audit app/u/[handle]/page.tsx line 56 and app/leaders/page.tsx line 92 — covered in Task 8) by switching to `.player-chip`.

- [ ] **Step 6: Run `bun run build`.**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 7: Add auth + account smoke to `tests/e2e/design-tokens.spec.ts`.**

```ts
test("/sign-in uses game-canvas", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator("main").first()).toHaveClass(/game-canvas/);
});

test("/account uses game-canvas when signed in", async ({ page }) => {
  // helper to sign in as an anonymous user then visit account
  await page.goto("/");
  // relies on anonymous auth from middleware
  await page.goto("/account");
  await expect(page.locator("main").first()).toHaveClass(/game-canvas/);
});
```

- [ ] **Step 8: Run auth + passkey e2e.**

Run: `bun test:e2e:local tests/e2e/auth.spec.ts tests/e2e/passkey.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add app/sign-in/sign-in-card.tsx app/sign-in/page.tsx app/account/page.tsx app/u/[handle]/page.tsx components/user-menu.tsx components/profile-stats-card.tsx components/theme-toggle.tsx components/sfx-toggle.tsx tests/e2e/design-tokens.spec.ts
git commit -m "feat(auth/profile): sticker chrome across sign-in and profile surfaces

Sign-in card becomes a palette showcase — each provider button gets
a distinct accent. Account, public profile, and user-menu drop hardcoded
avatar gradients for .player-chip. ProfileStatsCard wraps its 6-cell
grid in a navy inset band. Theme and sfx toggles become sticker pills."
```

---

## Task 10: Cleanup + design-tokens spec finalization

**Goal:** Delete all legacy utilities and tokens. Grep-verify nothing references them. Finalize `design-tokens.spec.ts` to include leak-detection and dark-mode coverage.

**Files:**
- Modify: `app/globals.css`
- Modify: `tests/e2e/design-tokens.spec.ts`

- [ ] **Step 1: Grep for any remaining references** to the legacy system. Exclude `app/globals.css` itself since that's the deletion target:

```bash
grep -rn 'promptionary-gradient\|promptionary-grain\|text-hero\|brand-indigo\|brand-fuchsia\|brand-rose' app components lib \
  --exclude=globals.css
```

Expected: ZERO matches. If any file still references these, go fix that file before continuing — this is the gate. Do NOT delete the utilities from `globals.css` until every consuming file is clean.

- [ ] **Step 2: Grep for hotspot stragglers:**

```bash
grep -rn 'text-white\|text-black\|bg-red-500\|#6366f1\|#f43f5e\|#facc15\|#a3a3a3\|#d97706' app components lib
```

Expected: ZERO matches. Fix any stragglers before continuing.

- [ ] **Step 3: Delete the legacy CSS from `app/globals.css`.** Remove:
- The `.promptionary-gradient` rule
- The `.promptionary-grain` rule + its `::before` pseudo-element (includes the SVG fractal-noise data URI)
- The `.text-hero` rule
- The `--brand-indigo`, `--brand-fuchsia`, `--brand-rose` declarations in both `:root` and `.dark`
- The `--color-brand-*` and `--color-surface-*` entries in the `@theme inline` block (lines 44–49 of the original file) — surface tokens stay but aren't aliased to unused names

- [ ] **Step 4: Run `bun run build`.**

Run: `bun run build`
Expected: PASS. Catches any hidden reference to a deleted utility.

- [ ] **Step 5: Finalize `tests/e2e/design-tokens.spec.ts`.** Add leak detection + dark-mode sweep:

```ts
test("legacy utilities and brand tokens no longer appear in rendered HTML", async ({ page }) => {
  for (const route of ["/", "/daily", "/leaders", "/sign-in"]) {
    await page.goto(route);
    const html = await page.content();
    expect(html).not.toContain("promptionary-gradient");
    expect(html).not.toContain("promptionary-grain");
    expect(html).not.toContain("text-hero");
    expect(html).not.toContain("--brand-indigo");
    expect(html).not.toContain("--brand-fuchsia");
    expect(html).not.toContain("--brand-rose");
  }
});

test("landing light-locks even when user prefers dark", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto("/");
  const scheme = await page
    .locator("main")
    .first()
    .evaluate((el) => getComputedStyle(el).colorScheme);
  expect(scheme).toBe("light");
  await ctx.close();
});

test("non-landing pages flip canvas in dark mode", async ({ browser }) => {
  for (const route of ["/leaders", "/sign-in"]) {
    const light = await browser.newContext({ colorScheme: "light" });
    const dark = await browser.newContext({ colorScheme: "dark" });
    const [lp, dp] = [await light.newPage(), await dark.newPage()];
    await lp.goto(route);
    await dp.goto(route);
    const lightBg = await lp.locator("main").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const darkBg = await dp.locator("main").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(lightBg).not.toBe(darkBg);
    await light.close();
    await dark.close();
  }
});
```

Note: the dark-mode tests rely on the page respecting the user's prefers-color-scheme. If the site has a ThemeToggle that overrides via a `class="dark"` on `<html>`, you may need to click the toggle first. Check the current behavior and adjust the test to match.

- [ ] **Step 6: Run the full e2e suite.**

Run: `bun test:e2e:local`
Expected: PASS end-to-end across all existing tests plus the new `design-tokens.spec.ts` coverage.

- [ ] **Step 7: Run `bun run build` one last time.**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add app/globals.css tests/e2e/design-tokens.spec.ts
git commit -m "chore(design): delete .promptionary-* utilities and --brand-* tokens

All pages now consume --game-* tokens and .game-* utilities. The legacy
gradient/grain/text-hero utilities and brand tokens are deleted.
design-tokens.spec.ts now asserts no rendered HTML leaks the old
utility names and that the landing's color-scheme light-lock holds
under a dark user preference."
```

- [ ] **Step 9: Push the branch + open a PR.**

```bash
git push -u origin feat/sitewide-jackbox-redesign
gh pr create --title "feat: sitewide Jackbox redesign" --body "$(cat <<'EOF'
## Summary

Migrates the entire site to the sticker-card aesthetic introduced by the
landing redesign. Three canvases (yellow / cream / navy), one visual
grammar (flat fills, chunky ink borders, offset shadows, italic-heavy
Unbounded, sticker pills, marquee pills), full dark-mode support. Old
.promptionary-* utilities and --brand-* tokens are deleted.

Design spec: [docs/superpowers/specs/2026-04-19-sitewide-jackbox-redesign-design.md](docs/superpowers/specs/2026-04-19-sitewide-jackbox-redesign-design.md)
Plan: [docs/superpowers/plans/2026-04-19-sitewide-jackbox-redesign.md](docs/superpowers/plans/2026-04-19-sitewide-jackbox-redesign.md)

## Surfaces migrated

- `/` landing (yellow, light-locked)
- `/daily` (yellow)
- `/play/[code]` lobby (cream)
- in-game generating/guessing/scoring (navy)
- in-game reveal/game_over (yellow)
- `/leaders`, `/account`, `/u/[handle]`, `/sign-in` (cream)

## Hotspot cleanups

- All text-white/text-black on avatars replaced by .player-chip
- All bg-red-500/* error boxes replaced by bg-destructive
- Hardcoded medal hex → --medal-gold/silver/bronze
- Hardcoded team hex → --team-1/--team-2
- Hardcoded user-menu avatar gradient → solid --game-pink + ink

## Test plan

- [x] bun run build
- [x] bun test:e2e:local (full suite)
- [x] Manual: /, /daily, lobby, in-game, reveal, /leaders, /sign-in, /account, /u/[handle] in light mode
- [x] Manual: same pages in dark mode — landing stays yellow, others flip to deep-navy canvas
EOF
)"
```

---

## Gotchas to watch across all tasks

- **Custom CSS properties in React `style`** need a cast. Either `style={{ ["--foo" as string]: "value" } as React.CSSProperties}` or define a typed helper. The first pattern is what the landing plan uses.
- **Tailwind v4 opacity on token-backed colors** works for `@theme inline` registered tokens (e.g. `bg-destructive/20` is fine) but NOT for arbitrary `text-[var(--foo)]/85`. For arbitrary vars with opacity, use `color-mix(in oklch, var(--foo) 85%, transparent)` via inline style.
- **`.game-card` + shadcn Card**: Card's own border must be dropped (`border-none`), otherwise you double up with `.game-card`'s 3px ink border.
- **`md:-rotate-1` on cards at awkward widths** can clip the offset shadow at the parent boundary. `overflow-visible` on the direct parent section fixes it.
- **Canvas switching inside game-client.tsx** will cause a repaint between scoring → reveal. That's intended (mood shift). Just confirm no layout shift.
- **Don't forget the SVG fractal-noise data URI** lives inside `.promptionary-grain::before` — it's deleted as part of removing that rule in Task 10 Step 3.
- **`colorForPlayer()` is untouched.** It's a deterministic per-player identity function; don't replace it with game tokens. Player chips get their fill from `colorForPlayer()` via the `--chip-color` custom prop.
- **Artist-mode e2e** still clicks the Artist button by name after Task 3 — the button is now preselected but the click is idempotent; the test passes unchanged.
