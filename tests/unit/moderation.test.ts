import { describe, expect, it, vi } from "vitest";

// Mock `@google/genai` before importing `@/lib/gemini` so the module-load-time
// `new GoogleGenAI(...)` constructor is a no-op. Each test swaps in its own
// `generateContent` stub via the exposed reference.
const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => generateContent(...args) };
  },
  Type: { OBJECT: "OBJECT", ARRAY: "ARRAY", STRING: "STRING" },
}));
vi.mock("@/lib/env", () => ({
  serverEnv: { GOOGLE_GENAI_API_KEY: "key" },
}));

const { moderatePrompt } = await import("@/lib/gemini");

describe("moderatePrompt (#56)", () => {
  it("returns a non-empty human-readable reason when UNSAFE has no detail", async () => {
    generateContent.mockResolvedValueOnce({ text: "UNSAFE" });
    const result = await moderatePrompt("whatever");
    expect(result.safe).toBe(false);
    expect(result.reason).toBeTruthy();
    expect((result.reason ?? "").length).toBeGreaterThan(10);
  });

  it("trims whitespace-only reasons and swaps in the fallback", async () => {
    generateContent.mockResolvedValueOnce({ text: "UNSAFE:   " });
    const result = await moderatePrompt("whatever");
    expect(result.safe).toBe(false);
    expect(result.reason?.trim().length).toBeGreaterThan(0);
  });

  it("preserves a real reason when Gemini gives one", async () => {
    generateContent.mockResolvedValueOnce({ text: "UNSAFE: contains a slur" });
    const result = await moderatePrompt("whatever");
    expect(result).toEqual({ safe: false, reason: "contains a slur" });
  });
});
