import { GoogleGenAI, Type } from "@google/genai";
import { serverEnv } from "@/lib/env";
import { sampleDimensions, type PackId } from "@/lib/prompt-dimensions";

// Test-mode bypass. When `PROMPTIONARY_MOCK_GEMINI=1` is set on the server,
// every exported Gemini helper returns a deterministic fake instead of
// calling the real `@google/genai` SDK. This lets e2e specs exercise the
// full round flow (author -> image -> tokenize -> embed -> score) in
// <15s without burning API quota or waiting on 30-90s of real Gemini work.
//
// The flag is a server-only read (typeof window === "undefined") so a
// compromised client can't force fakes. If it's accidentally enabled on
// Vercel prod we log a loud ERROR at boot — but don't throw, because a
// thrown module-init error nukes the whole app and a mock that paints a
// 4x4 PNG is less bad than an outage.
const MOCK_GEMINI =
  typeof window === "undefined" && process.env.PROMPTIONARY_MOCK_GEMINI === "1";

if (MOCK_GEMINI) {
  console.info(
    "[gemini] PROMPTIONARY_MOCK_GEMINI=1 — using deterministic fakes for author/tag/image/embed/moderate",
  );
}

if (MOCK_GEMINI && process.env.VERCEL_ENV === "production") {
  console.error(
    "ERROR: PROMPTIONARY_MOCK_GEMINI=1 is set in a Vercel production env. " +
      "Gemini calls are being stubbed with deterministic fakes — disable this flag " +
      "before shipping, or real players will see canned images and canned prompts.",
  );
}

const ai = MOCK_GEMINI
  ? (null as unknown as GoogleGenAI)
  : new GoogleGenAI({ apiKey: serverEnv!.GOOGLE_GENAI_API_KEY! });

function buildAuthorInstruction(
  previousPrompts: string[] = [],
  pack: PackId = "mixed",
) {
  const { subject, setting, action, time, style } = sampleDimensions({ pack });
  const avoid =
    previousPrompts.length > 0
      ? `\n\nAlready used this game (pick different specifics):\n${previousPrompts
          .map((p) => `- "${p}"`)
          .join("\n")}`
      : "";
  return `You author secret prompts for an AI-image guessing party game called Promptionary.

Fixed ingredients for this round — every one must appear in the final prompt:
- Subject: ${subject}
- Setting: ${setting}
- Action/state: ${action}
- Time/weather: ${time}
- Style/medium: ${style}

Rewrite these five ingredients into ONE coherent, paintable image prompt, 14-22 words. Stay concrete and sensory. Keep it PG and don't reference real living people by name. Do not render any text, letters, words, captions, labels, watermarks, or signs within the image. Pure imagery only.${avoid}

After writing the prompt, tag every word with its role:
- subject: the noun(s) a player needs to guess (the main thing in the scene)
- style: explicit style or medium cues (watercolor, impressionist, linocut)
- modifier: descriptive adjectives, moods, or unusual attributes (mossy, glistening, sleepy)
- filler: articles, prepositions, connectors (a, the, of, in)

Tokenize the prompt word-by-word in reading order. Every word of your prompt must appear in the tokens array exactly once, in order. Hyphenated terms stay as a single token.`;
}

type PromptToken = {
  token: string;
  role: "subject" | "style" | "modifier" | "filler";
};

// Deterministic tokenizer for mock mode. Reproduces the real Gemini
// contract: every word of the prompt appears in tokens once, in order.
// Role assignment is a tiny static heuristic — good enough for scoring
// math to be non-trivial and reproducible.
const MOCK_SUBJECT_WORDS = new Set([
  "cat",
  "dog",
  "astronaut",
  "robot",
  "baker",
  "kitchen",
  "castle",
  "forest",
  "self-portrait",
]);
const MOCK_STYLE_WORDS = new Set([
  "painting",
  "watercolor",
  "cinematic",
  "linocut",
  "impressionist",
  "cartoon",
]);
const MOCK_FILLER_WORDS = new Set([
  "a",
  "an",
  "the",
  "in",
  "on",
  "of",
  "at",
  "and",
  "or",
  "with",
  "by",
]);
function mockTokenize(prompt: string): PromptToken[] {
  const words = prompt.split(/\s+/).filter((w) => w.length > 0);
  return words.map((raw) => {
    const clean = raw.replace(/[^A-Za-z0-9-]/g, "").toLowerCase();
    if (MOCK_FILLER_WORDS.has(clean)) return { token: raw, role: "filler" };
    if (MOCK_STYLE_WORDS.has(clean)) return { token: raw, role: "style" };
    if (MOCK_SUBJECT_WORDS.has(clean)) return { token: raw, role: "subject" };
    return { token: raw, role: "modifier" };
  });
}

const MOCK_PROMPT = "a cat painting a self-portrait in a sunlit kitchen";

export async function authorPromptWithRoles(
  previousPrompts: string[] = [],
  pack: PackId = "mixed",
): Promise<{
  prompt: string;
  tokens: PromptToken[];
}> {
  if (MOCK_GEMINI) {
    // Cheap uniqueness so two back-to-back rounds don't collide with the
    // avoid-recent path. If we've used MOCK_PROMPT, tack on a salt.
    const salt = previousPrompts.includes(MOCK_PROMPT)
      ? ` round ${previousPrompts.length + 1}`
      : "";
    const prompt = `${MOCK_PROMPT}${salt}`;
    return { prompt, tokens: mockTokenize(prompt) };
  }
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: buildAuthorInstruction(previousPrompts, pack),
    config: {
      temperature: 1.2,
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
                role: {
                  type: Type.STRING,
                  enum: ["subject", "style", "modifier", "filler"],
                },
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

// NanoBanana 2 (`gemini-3.1-flash-image-preview`) is preferred but requires a
// paid Gemini tier. Fall back to NanoBanana 1 (`gemini-2.5-flash-image`) so
// dev keys on the free plan can still exercise the full flow.
const IMAGE_MODELS = [
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
];

// Artist-mode rounds: the artist already wrote the prompt, we just need role
// tags so scoring can weight subject/style words differently from filler.
export async function tagPromptRoles(prompt: string): Promise<{
  tokens: PromptToken[];
}> {
  if (MOCK_GEMINI) {
    return { tokens: mockTokenize(prompt) };
  }
  const instruction = `Tag every word of this image prompt with its role.
- subject: nouns a player would guess (cat, castle, baker)
- style: explicit style/medium cues (watercolor, cinematic, linocut)
- modifier: descriptive adjectives, moods, unusual attributes (moody, mossy, glistening)
- filler: articles, prepositions, connectors (a, the, of, in)

Tokenize word-by-word in reading order. Hyphenated terms stay as a single token. Every word of the prompt must appear in tokens exactly once, in order.

Prompt: "${prompt}"`;
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: instruction,
    config: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          tokens: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                token: { type: Type.STRING },
                role: {
                  type: Type.STRING,
                  enum: ["subject", "style", "modifier", "filler"],
                },
              },
              required: ["token", "role"],
              propertyOrdering: ["token", "role"],
            },
          },
        },
        required: ["tokens"],
      },
    },
  });
  const parsed = JSON.parse(response.text ?? "{}");
  return { tokens: parsed.tokens ?? [] };
}

// Generic fallback when the classifier says UNSAFE but gives us nothing usable.
// Shown verbatim in the artist-mode rejection UI — keep it friendly and
// actionable, not scolding. Issue #56: without this, players hit a dead
// "rejected" wall with zero feedback and no idea how to recover.
const MODERATION_FALLBACK_REASON =
  "This prompt looks unsafe to us. Try something less edgy — avoid violence, NSFW, or real-person likenesses.";

// Best-effort category → tailored reason. We only swap in a tailored message
// when the classifier's first line contains exactly one of these tokens after
// "UNSAFE" — anything messier falls back to the generic string above. Keeps
// the parsing cheap and predictable.
const MODERATION_CATEGORY_REASONS: Record<string, string> = {
  VIOLENCE:
    "This prompt reads as graphic violence. Try something less gory — cartoon slapstick is fine.",
  SEXUAL:
    "This prompt reads as NSFW. Keep it PG — party-game players of any age may be watching.",
  NSFW:
    "This prompt reads as NSFW. Keep it PG — party-game players of any age may be watching.",
  HATE:
    "This prompt reads as hateful. Drop slurs and attacks on groups — aim for playful and silly instead.",
  HARASSMENT:
    "This prompt targets a real person. Swap them for a fictional or fantastical character.",
  SELF_HARM:
    "This prompt touches self-harm. Please pick a different subject — something playful works best.",
};

// Lightweight safety classifier for user-written artist prompts. Uses the
// same cheap `gemini-2.5-flash` model as the authoring pipeline. We default
// to SAFE on any unrecognized output or parse weirdness — blocking gameplay
// on flaky moderation is worse than waving through an edge case.
export async function moderatePrompt(
  text: string,
): Promise<{ safe: boolean; reason?: string }> {
  if (MOCK_GEMINI) {
    // Always safe in mock mode — specs that want rejection should use the
    // route-level `page.route` override pattern (see artist-rejection-ui.spec.ts).
    return { safe: true };
  }
  const instruction = `You are a moderator for a party game called Promptionary. The user below is about to send the following text to an AI image generator that all players in the room will see. Decide if the prompt is safe for a mixed audience — no hateful content, no sexual content, no graphic violence, no personal attacks, no slurs, no targeting of real private individuals. Standard playful edge (cartoon goofiness, mild crude humor, fantasy violence like dragons fighting knights) is fine.

Reply with exactly one line in one of these two forms, nothing else:
SAFE
UNSAFE: <short, player-friendly reason>

Prompt:
"""${text}"""`;
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: instruction,
    config: { temperature: 0 },
  });
  const raw = (response.text ?? "").trim();
  if (!raw) return { safe: true };
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? "";
  if (/^safe\b/i.test(firstLine)) return { safe: true };
  const unsafeMatch = firstLine.match(/^unsafe\s*[:\-–—]?\s*(.*)$/i);
  if (unsafeMatch) {
    const reason = unsafeMatch[1]?.trim();
    if (reason && reason.length > 0) {
      return { safe: false, reason };
    }
    // No reason given. If the raw response mentions a known category word
    // anywhere (some models say "UNSAFE\nCATEGORY: VIOLENCE"), surface a
    // tailored message. Otherwise fall back to the generic string — never
    // return an empty reason, which is what issue #56 was about.
    const upper = raw.toUpperCase();
    for (const key of Object.keys(MODERATION_CATEGORY_REASONS)) {
      if (upper.includes(key)) {
        return { safe: false, reason: MODERATION_CATEGORY_REASONS[key] };
      }
    }
    return { safe: false, reason: MODERATION_FALLBACK_REASON };
  }
  // Unrecognized shape — fail open so Gemini hiccups don't block real players.
  return { safe: true };
}

// Smallest valid opaque PNG: 4x4, solid color, zlib-compressed.
// Prebaked as base64 so we don't pull in a PNG encoder for tests.
const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FADnYAwE9T8B6AAAAAElFTkSuQmCC";
const MOCK_PNG_BUFFER = Buffer.from(MOCK_PNG_BASE64, "base64");

export async function generateImagePng(prompt: string): Promise<Buffer> {
  if (MOCK_GEMINI) {
    // `prompt` is intentionally unused — the fake PNG is identical every
    // round. Tests only care that the upload/storage pipeline gets a valid
    // image buffer to hand off to Supabase.
    void prompt;
    return MOCK_PNG_BUFFER;
  }
  let lastErr: unknown;
  for (const model of IMAGE_MODELS) {
    try {
      const response = await ai.models.generateContent({ model, contents: prompt });
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
      }
      throw new Error(`gemini ${model} returned no inlineData`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("no image model available");
}

// Deterministic 768-dim embedding for mock mode. Uses a cheap per-character
// sine-based transform so cosine similarity between similar strings is
// non-zero and reproducible. The real Gemini embedding is 768-dim too, so
// the downstream scoring vector math stays the same shape.
const MOCK_EMBED_DIM = 768;
function mockEmbed(text: string): number[] {
  const lower = text.toLowerCase();
  const len = Math.max(1, lower.length);
  const vec = new Array<number>(MOCK_EMBED_DIM);
  for (let i = 0; i < MOCK_EMBED_DIM; i++) {
    const code = lower.charCodeAt(i % len);
    // sin(code * (i+1)) spreads the signal across dimensions, and adding a
    // length term keeps identical prefixes from collapsing to identical
    // vectors. Non-zero on any non-empty input — required for cosine.
    vec[i] = Math.sin(code * (i + 1) * 0.0137) + Math.cos((i + 1) * 0.0911);
  }
  return vec;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (MOCK_GEMINI) {
    return texts.map(mockEmbed);
  }
  const out: number[][] = [];
  for (const text of texts) {
    const res = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: text,
    });
    out.push(res.embeddings?.[0]?.values ?? []);
  }
  return out;
}
