import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY! });

async function main() {
  console.log("1) text (simple)...");
  try {
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Say 'ok' and nothing else.",
    });
    console.log("text OK:", r.text?.slice(0, 80));
  } catch (e) {
    console.error("text FAILED:", (e as Error).message?.slice(0, 300));
  }

  console.log("\n2) image gen with 2.5-flash-image (NanoBanana 1)...");
  try {
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: "a whimsical cat wearing a top hat, watercolor style",
    });
    const parts = r.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find((p) => p.inlineData?.data);
    console.log("has image:", !!imgPart, "parts keys:", parts.map((p) => Object.keys(p)));
  } catch (e) {
    console.error("image FAILED:", (e as Error).message?.slice(0, 300));
  }

  console.log("\n3) embedding with gemini-embedding-001...");
  try {
    const r = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: "a cat wearing a top hat",
    });
    console.log("embedding dim:", r.embeddings?.[0]?.values?.length);
  } catch (e) {
    console.error("embed FAILED:", (e as Error).message?.slice(0, 300));
  }
}

main();
