# Phase 3 — Round Engine Implementation Plan

> ⚠️ **Historical artifact.** Written 2026-04-19. Phase 3 shipped, plus auto-finalize, vote-to-skip, spectator modifiers, prefetch round N+1, mock-Gemini test mode, and more — none of which are reflected here. The embedding model called out below is also stale (live model is `gemini-embedding-001`, not `text-embedding-004`). Read [`AGENTS.md`](../../../AGENTS.md) for live state.

**Goal:** End-to-end playable round. Host clicks Start → Gemini writes a secret prompt + tags word roles → Gemini image model paints it → players see the image and a timer → players submit guesses → system scores them (role-weighted + semantic + speed) → reveal shows the true prompt and ranked guesses → auto-advance to next round → game-over leaderboard after `max_rounds`.

**Architecture:**
- All Gemini calls happen in Vercel Route Handlers (`app/api/...`) using the service-role Supabase client for DB writes that bypass RLS.
- Phase transitions are **host-driven** (the host's client POSTs to the API on Start and on guess-phase expiry). No pg_cron in v1 — if the host disconnects, the game stalls (acceptable for MVP).
- `@google/genai` SDK for Gemini text, image, and embeddings — single SDK, three models.
- Scoring math runs in-memory in `finalize-round` route; embeddings are computed ad-hoc and discarded.

**Models:**
- Secret prompt authoring + role tagging: `gemini-2.5-flash` with `responseSchema` for structured output
- Image generation: `gemini-3.1-flash-image-preview` (NanoBanana 2)
- Embeddings: `text-embedding-004`

---

### File Structure

```
app/api/
├── start-round/route.ts          # POST { round_id } — authors prompt + tokens, generates image, advances to 'guessing'
└── finalize-round/route.ts       # POST { round_id } — scores all guesses, advances to 'reveal' or 'game_over'
app/play/[code]/
├── lobby-client.tsx              # MODIFY: after start_round RPC, POST to /api/start-round
├── page.tsx                      # MODIFY: in non-lobby phases, render GameClient
└── game-client.tsx               # NEW: handles generating/guessing/scoring/reveal/game_over UI
lib/
├── gemini.ts                     # Gemini client helpers (prompt authoring, image gen, embeddings)
├── scoring.ts                    # Pure scoring math (tokenize, match, cosine sim)
└── supabase/types.ts             # regenerated
supabase/migrations/
└── <ts>_phase3_rpcs.sql          # advance_to_reveal, next_round_or_game_over helpers callable from API
```

---

### Task 1: Scoring math (pure, testable)

**Files:** `lib/scoring.ts`

```ts
export type RoleToken = { token: string; role: "subject" | "style" | "modifier" | "filler" };

export function normalizeToken(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 1);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (aa === 0 || bb === 0) return 0;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

export type ScoreBreakdown = {
  subject_score: number;
  style_score: number;
  semantic_score: number;
  speed_bonus: number;
};

export function scoreGuess({
  guessText,
  guessEmbedding,
  promptEmbedding,
  promptTokens,
  submittedAt,
  phaseStartedAt,
  guessSeconds,
}: {
  guessText: string;
  guessEmbedding: number[];
  promptEmbedding: number[];
  promptTokens: RoleToken[];
  submittedAt: Date;
  phaseStartedAt: Date;
  guessSeconds: number;
}): ScoreBreakdown {
  const guessSet = new Set(tokenize(guessText));

  const byRole = (role: RoleToken["role"]) => {
    const roleTokens = promptTokens
      .filter((t) => t.role === role)
      .map((t) => normalizeToken(t.token))
      .filter((t) => t.length > 1);
    if (roleTokens.length === 0) return 0;
    const matched = roleTokens.filter((t) => guessSet.has(t)).length;
    return matched / roleTokens.length;
  };

  const subject_score = Math.round(byRole("subject") * 30);
  const style_score = Math.round(byRole("style") * 40);
  const semantic_score = Math.round(Math.max(0, cosine(guessEmbedding, promptEmbedding)) * 20);

  const preBonus = subject_score + style_score + semantic_score;
  let speed_bonus = 0;
  if (preBonus > 40) {
    const elapsedMs = submittedAt.getTime() - phaseStartedAt.getTime();
    const fraction = Math.max(0, 1 - elapsedMs / (guessSeconds * 1000));
    speed_bonus = Math.round(fraction * 10);
  }

  return { subject_score, style_score, semantic_score, speed_bonus };
}
```

### Task 2: Gemini helpers

**Files:** `lib/gemini.ts`

```ts
import { GoogleGenAI, Type } from "@google/genai";
import { serverEnv } from "@/lib/env";

const ai = new GoogleGenAI({ apiKey: serverEnv!.GOOGLE_GENAI_API_KEY! });

const PROMPT_AUTHOR_INSTRUCTION = `You author secret prompts for an AI-image guessing party game called Promptionary.
Write a vivid, guessable image prompt between 12 and 20 words. Rules:
- ONE or TWO clear subjects (nouns a player could guess): "cat", "astronaut", "castle"
- ONE or TWO distinctive style cues: "watercolor", "cinematic", "8-bit pixel art", "Studio Ghibli"
- ONE or TWO mood/lighting adjectives: "moody", "neon-drenched", "golden hour"
- OPTIONAL: one unexpected modifier: "wearing a monocle", "in zero gravity"
Do not use proper names of real people. Keep it PG.

After writing, tag every word of your prompt with its role:
- subject: the main noun(s) a player needs to guess (cat, castle, astronaut)
- style: explicit style/medium cues (watercolor, cinematic, pixel-art)
- modifier: descriptive adjectives or unusual attributes (moody, wearing-a-hat)
- filler: articles, prepositions, connectors (a, the, of, in)
Tokenize the way a reader would read word-by-word. Hyphenated terms stay as one token.`;

export async function authorPromptWithRoles(): Promise<{
  prompt: string;
  tokens: Array<{ token: string; role: "subject" | "style" | "modifier" | "filler" }>;
}> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: PROMPT_AUTHOR_INSTRUCTION,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          prompt: { type: Type.STRING },
          tokens: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                token: { type: Type.STRING },
                role: { type: Type.STRING, enum: ["subject", "style", "modifier", "filler"] },
              },
              required: ["token", "role"],
              propertyOrdering: ["token", "role"],
            },
          },
        },
        required: ["prompt", "tokens"],
        propertyOrdering: ["prompt", "tokens"],
      },
    },
  });
  const parsed = JSON.parse(response.text ?? "{}");
  return parsed;
}

export async function generateImagePng(prompt: string): Promise<Buffer> {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: prompt,
  });
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }
  throw new Error("gemini image response had no inlineData");
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) {
    const res = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: text,
    });
    out.push(res.embeddings?.[0]?.values ?? []);
  }
  return out;
}
```

### Task 3: start-round route

**Files:** `app/api/start-round/route.ts`

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { authorPromptWithRoles, generateImagePng } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { round_id } = await req.json();
  if (!round_id) return NextResponse.json({ error: "round_id required" }, { status: 400 });

  // Verify caller is the host of the room this round belongs to.
  const userSupabase = await createSupabaseServerClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthed" }, { status: 401 });

  const svc = createSupabaseServiceClient();
  const { data: round } = await svc
    .from("rounds")
    .select("id, room_id, round_num, rooms!inner(host_id, guess_seconds, phase)")
    .eq("id", round_id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "round not found" }, { status: 404 });

  // @ts-expect-error - nested select typing
  if (round.rooms.host_id !== user.id) {
    return NextResponse.json({ error: "not host" }, { status: 403 });
  }
  // @ts-expect-error
  if (round.rooms.phase !== "generating") {
    return NextResponse.json({ error: "wrong phase" }, { status: 409 });
  }

  // 1. Author prompt + tokens
  const { prompt, tokens } = await authorPromptWithRoles();

  // 2. Generate image
  const pngBuffer = await generateImagePng(prompt);

  // 3. Upload to storage
  const storagePath = `${round.room_id}/${round.id}.png`;
  const upload = await svc.storage.from("round-images").upload(storagePath, pngBuffer, {
    contentType: "image/png",
    upsert: true,
  });
  if (upload.error) {
    return NextResponse.json({ error: "upload failed: " + upload.error.message }, { status: 500 });
  }
  const { data: publicUrl } = svc.storage.from("round-images").getPublicUrl(storagePath);

  // 4. Update round with prompt + image
  await svc.from("rounds")
    .update({
      prompt,
      image_url: publicUrl.publicUrl,
      image_storage_path: storagePath,
    })
    .eq("id", round.id);

  // 5. Insert role tokens
  if (tokens.length > 0) {
    await svc.from("round_prompt_tokens").insert(
      tokens.map((t, i) => ({
        round_id: round.id,
        position: i,
        token: t.token,
        role: t.role,
      })),
    );
  }

  // 6. Advance room to 'guessing' with timer
  // @ts-expect-error
  const guessSeconds = round.rooms.guess_seconds as number;
  const phaseEndsAt = new Date(Date.now() + guessSeconds * 1000).toISOString();
  await svc.from("rooms")
    .update({ phase: "guessing", phase_ends_at: phaseEndsAt })
    .eq("id", round.room_id);

  return NextResponse.json({ ok: true, image_url: publicUrl.publicUrl });
}
```

### Task 4: finalize-round route

**Files:** `app/api/finalize-round/route.ts`

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { embedTexts } from "@/lib/gemini";
import { scoreGuess, type RoleToken } from "@/lib/scoring";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { round_id } = await req.json();
  if (!round_id) return NextResponse.json({ error: "round_id required" }, { status: 400 });

  const userSupabase = await createSupabaseServerClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthed" }, { status: 401 });

  const svc = createSupabaseServiceClient();

  const { data: round } = await svc
    .from("rounds")
    .select("id, room_id, prompt, started_at, ended_at, round_num")
    .eq("id", round_id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "round not found" }, { status: 404 });
  if (round.ended_at) return NextResponse.json({ ok: true, already: true });

  const { data: room } = await svc
    .from("rooms")
    .select("id, host_id, phase, round_num, max_rounds, reveal_seconds, guess_seconds, phase_ends_at")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "room not found" }, { status: 404 });
  if (room.host_id !== user.id) return NextResponse.json({ error: "not host" }, { status: 403 });
  if (!["guessing", "scoring"].includes(room.phase)) {
    return NextResponse.json({ error: "wrong phase" }, { status: 409 });
  }

  // Flip to scoring to block further guesses
  await svc.from("rooms").update({ phase: "scoring", phase_ends_at: null }).eq("id", room.id);

  const { data: guesses } = await svc
    .from("guesses")
    .select("id, player_id, guess, submitted_at")
    .eq("round_id", round.id);

  const { data: tokens } = await svc
    .from("round_prompt_tokens")
    .select("token, role")
    .eq("round_id", round.id);

  const roleTokens: RoleToken[] = (tokens ?? []).map((t) => ({
    token: t.token,
    role: t.role as RoleToken["role"],
  }));

  // Embed prompt + all guesses in one pass
  const texts = [round.prompt, ...(guesses ?? []).map((g) => g.guess)];
  const embeddings = texts.length > 0 ? await embedTexts(texts) : [];
  const promptEmbedding = embeddings[0] ?? [];

  // Score each guess
  const phaseStartedAt = new Date(
    new Date(room.phase_ends_at ?? new Date().toISOString()).getTime() - room.guess_seconds * 1000,
  );

  const playerScoreDelta: Record<string, number> = {};

  for (let i = 0; i < (guesses ?? []).length; i++) {
    const g = guesses![i];
    const embedding = embeddings[i + 1] ?? [];
    const breakdown = scoreGuess({
      guessText: g.guess,
      guessEmbedding: embedding,
      promptEmbedding,
      promptTokens: roleTokens,
      submittedAt: new Date(g.submitted_at),
      phaseStartedAt,
      guessSeconds: room.guess_seconds,
    });
    const total =
      breakdown.subject_score + breakdown.style_score + breakdown.semantic_score + breakdown.speed_bonus;
    playerScoreDelta[g.player_id] = (playerScoreDelta[g.player_id] ?? 0) + total;

    await svc
      .from("guesses")
      .update({
        subject_score: breakdown.subject_score,
        style_score: breakdown.style_score,
        semantic_score: breakdown.semantic_score,
        speed_bonus: breakdown.speed_bonus,
        scored_at: new Date().toISOString(),
      })
      .eq("id", g.id);
  }

  // Bump player aggregate scores
  for (const [playerId, delta] of Object.entries(playerScoreDelta)) {
    // use rpc-less update by re-reading + writing
    const { data: row } = await svc
      .from("room_players")
      .select("score")
      .eq("room_id", room.id)
      .eq("player_id", playerId)
      .maybeSingle();
    const current = row?.score ?? 0;
    await svc
      .from("room_players")
      .update({ score: current + delta })
      .eq("room_id", room.id)
      .eq("player_id", playerId);
  }

  // Mark round ended
  await svc.from("rounds").update({ ended_at: new Date().toISOString() }).eq("id", round.id);

  // Advance room phase
  if (room.round_num >= room.max_rounds) {
    await svc
      .from("rooms")
      .update({ phase: "game_over", phase_ends_at: null })
      .eq("id", room.id);
  } else {
    const revealEndsAt = new Date(Date.now() + room.reveal_seconds * 1000).toISOString();
    await svc
      .from("rooms")
      .update({ phase: "reveal", phase_ends_at: revealEndsAt })
      .eq("id", room.id);
  }

  return NextResponse.json({ ok: true });
}
```

### Task 5: game-client.tsx

**Files:** `app/play/[code]/game-client.tsx`

Handles rendering for phases: `generating`, `guessing`, `scoring`, `reveal`, `game_over`.

Subscribes to `rooms` (phase/phase_ends_at), `rounds` (image_url when set, prompt after reveal), and `guesses` (submissions + scores). Host client watches phase timers and POSTs to the appropriate API when they expire.

(Full implementation in the execution.)

### Task 6: wire page.tsx

Page renders `LobbyClient` when phase=`lobby`, otherwise `GameClient`.

### Task 7: kick off start-round after RPC

In `lobby-client.tsx`, after `start_round` RPC succeeds, the host client POSTs to `/api/start-round` with the returned round id.

### Task 8: deploy + smoke test
