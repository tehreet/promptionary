import { GoogleGenAI, Type } from "@google/genai";
import { serverEnv } from "@/lib/env";

const ai = new GoogleGenAI({ apiKey: serverEnv!.GOOGLE_GENAI_API_KEY! });

const SUBJECT_SEEDS = [
  "a raccoon running a bakery",
  "ballerinas in a library",
  "a grandmother knitting",
  "a scuba diver at a coral reef",
  "a farmer harvesting pumpkins",
  "a hiker on a snowy ridge",
  "a group of kids on a playground",
  "a busy ramen shop",
  "a lighthouse in a storm",
  "a cat sleeping on a quilt",
  "a hot-air balloon festival",
  "a market with fresh produce",
  "a dog surfing",
  "a potter at a wheel",
  "a postman on a bike",
  "a hedgehog drinking tea",
  "an orchard at dawn",
  "a ballroom dance",
  "a marching band",
  "children blowing bubbles",
  "a bee on a sunflower",
  "a wedding under fairy lights",
  "a campfire singalong",
  "a tea ceremony",
  "a pair of otters holding hands",
  "a chef plating sushi",
  "a blacksmith forging a sword",
  "two friends playing chess",
  "a toddler painting with fingers",
  "a gondola ride in Venice",
  "a fox in a snowy forest",
  "a subway platform at rush hour",
  "a librarian with a stack of books",
  "a jazz trio in a lounge",
  "a family picnic in a meadow",
];

const STYLE_SEEDS = [
  "soft watercolor",
  "oil-on-canvas impressionist",
  "ink wash",
  "Studio Ghibli anime",
  "Wes Anderson film still",
  "Renaissance fresco",
  "charcoal sketch",
  "linocut print",
  "stained-glass",
  "tilt-shift miniature photo",
  "1970s vintage postcard",
  "claymation still",
  "pastel crayon",
  "golden-hour photograph",
  "mosaic",
  "children's storybook illustration",
  "Norman Rockwell painting",
  "Dutch Golden Age still life",
  "gouache illustration",
  "pencil line drawing",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildAuthorInstruction() {
  const subject = pickRandom(SUBJECT_SEEDS);
  const style = pickRandom(STYLE_SEEDS);
  return `You author secret prompts for an AI-image guessing party game called Promptionary.

Use THIS scene seed: "${subject}"
Use THIS style seed: "${style}"

Rewrite the scene + style into ONE vivid image prompt of 12-20 words. Add 1-2 sensory details or a light mood cue so it's atmospheric, not a generic caption. The prompt must stay PG, never reference real people by name, and NEVER use the words "cyberpunk", "neon", "robot", "futuristic", "sci-fi", or "dystopian" unless the subject seed explicitly is cyberpunk-themed (it isn't here).

After writing, tag every word of your prompt with its role:
- subject: the main noun(s) a player needs to guess (cat, castle, baker)
- style: explicit style/medium cues (watercolor, cinematic, impressionist)
- modifier: descriptive adjectives or unusual attributes (moody, wrinkled, glistening)
- filler: articles, prepositions, connectors (a, the, of, in)

Tokenize the prompt word-by-word in reading order. Do NOT pack the whole prompt into a single "token". Hyphenated terms stay as one token. Every word of the prompt must appear exactly once in tokens.`;
}

export async function authorPromptWithRoles(): Promise<{
  prompt: string;
  tokens: Array<{
    token: string;
    role: "subject" | "style" | "modifier" | "filler";
  }>;
}> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: buildAuthorInstruction(),
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
