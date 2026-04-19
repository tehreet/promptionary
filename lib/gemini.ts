import { GoogleGenAI, Type } from "@google/genai";
import { serverEnv } from "@/lib/env";
import { sampleDimensions, type PackId } from "@/lib/prompt-dimensions";

const ai = new GoogleGenAI({ apiKey: serverEnv!.GOOGLE_GENAI_API_KEY! });

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

Rewrite these five ingredients into ONE coherent, paintable image prompt, 14-22 words. Stay concrete and sensory. Keep it PG and don't reference real living people by name.${avoid}

After writing the prompt, tag every word with its role:
- subject: the noun(s) a player needs to guess (the main thing in the scene)
- style: explicit style or medium cues (watercolor, impressionist, linocut)
- modifier: descriptive adjectives, moods, or unusual attributes (mossy, glistening, sleepy)
- filler: articles, prepositions, connectors (a, the, of, in)

Tokenize the prompt word-by-word in reading order. Every word of your prompt must appear in the tokens array exactly once, in order. Hyphenated terms stay as a single token.`;
}

export async function authorPromptWithRoles(
  previousPrompts: string[] = [],
  pack: PackId = "mixed",
): Promise<{
  prompt: string;
  tokens: Array<{
    token: string;
    role: "subject" | "style" | "modifier" | "filler";
  }>;
}> {
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
  tokens: Array<{
    token: string;
    role: "subject" | "style" | "modifier" | "filler";
  }>;
}> {
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
