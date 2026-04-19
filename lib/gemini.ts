import { GoogleGenAI, Type } from "@google/genai";
import { serverEnv } from "@/lib/env";

const ai = new GoogleGenAI({ apiKey: serverEnv!.GOOGLE_GENAI_API_KEY! });

const PROMPT_AUTHOR_INSTRUCTION = `You author secret prompts for an AI-image guessing party game called Promptionary.

Write a vivid, guessable image prompt between 12 and 20 words. Rules:
- ONE or TWO clear subjects (nouns a player could guess): "cat", "astronaut", "castle"
- ONE or TWO distinctive style cues: "watercolor", "cinematic", "8-bit pixel art", "Studio Ghibli"
- ONE or TWO mood/lighting adjectives: "moody", "neon-drenched", "golden hour"
- OPTIONAL: one unexpected modifier: "wearing a monocle", "in zero gravity"
- No real people by name. Keep it PG.

After writing, tag every word of your prompt with its role:
- subject: the main noun(s) a player needs to guess (cat, castle, astronaut)
- style: explicit style/medium cues (watercolor, cinematic, pixel art)
- modifier: descriptive adjectives or unusual attributes (moody, monocle)
- filler: articles, prepositions, connectors (a, the, of, in)

Tokenize word-by-word in order. Do NOT repeat the whole prompt in a single "token". Hyphenated terms stay as one token.`;

export async function authorPromptWithRoles(): Promise<{
  prompt: string;
  tokens: Array<{
    token: string;
    role: "subject" | "style" | "modifier" | "filler";
  }>;
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

export async function generateImagePng(prompt: string): Promise<Buffer> {
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

export async function embedTexts(texts: string[]): Promise<number[][]> {
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
