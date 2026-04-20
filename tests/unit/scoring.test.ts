import { describe, expect, it } from "vitest";
import { cosine, scoreGuess, tokenize, type RoleToken } from "@/lib/scoring";

const promptTokens: RoleToken[] = [
  { token: "otter", role: "subject" },
  { token: "river", role: "subject" },
  { token: "watercolor", role: "style" },
  { token: "soft", role: "style" },
  { token: "the", role: "filler" },
];

const embed = [1, 0, 0];
const phaseStart = new Date("2025-01-01T00:00:00Z");

describe("tokenize / cosine", () => {
  it("tokenize strips punctuation and short tokens", () => {
    expect(tokenize("A river, otter!")).toEqual(["river", "otter"]);
  });
  it("cosine returns 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("scoreGuess", () => {
  it("exact match of all subject+style tokens yields max token scores", () => {
    const s = scoreGuess({
      guessText: "a river otter painted in soft watercolor",
      guessEmbedding: embed,
      promptEmbedding: embed,
      promptTokens,
      submittedAt: phaseStart,
      phaseStartedAt: phaseStart,
      guessSeconds: 60,
    });
    expect(s.subject_score).toBe(30);
    expect(s.style_score).toBe(40);
    expect(s.semantic_score).toBe(20);
    expect(s.speed_bonus).toBe(10);
  });

  it("missing every subject token zeros subject axis", () => {
    const s = scoreGuess({
      guessText: "nothing relevant here banana",
      guessEmbedding: [0, 1, 0],
      promptEmbedding: embed,
      promptTokens,
      submittedAt: phaseStart,
      phaseStartedAt: phaseStart,
      guessSeconds: 60,
    });
    expect(s.subject_score).toBe(0);
  });

  it("speed_bonus decays as submission approaches deadline", () => {
    const late = new Date(phaseStart.getTime() + 55_000);
    const s = scoreGuess({
      guessText: "river otter in soft watercolor",
      guessEmbedding: embed,
      promptEmbedding: embed,
      promptTokens,
      submittedAt: late,
      phaseStartedAt: phaseStart,
      guessSeconds: 60,
      blitz: false,
    });
    expect(s.speed_bonus).toBeLessThan(2);
    expect(s.speed_bonus).toBeGreaterThanOrEqual(0);
  });

  it("no quality guess => no speed bonus", () => {
    const s = scoreGuess({
      guessText: "xx yy zz",
      guessEmbedding: [0, 1, 0],
      promptEmbedding: embed,
      promptTokens,
      submittedAt: phaseStart,
      phaseStartedAt: phaseStart,
      guessSeconds: 60,
    });
    expect(s.speed_bonus).toBe(0);
  });

  it("blitz mode roughly doubles speed bonus peak", () => {
    const nonBlitz = scoreGuess({
      guessText: "river otter in soft watercolor",
      guessEmbedding: embed,
      promptEmbedding: embed,
      promptTokens,
      submittedAt: phaseStart,
      phaseStartedAt: phaseStart,
      guessSeconds: 60,
    });
    const blitz = scoreGuess({
      guessText: "river otter in soft watercolor",
      guessEmbedding: embed,
      promptEmbedding: embed,
      promptTokens,
      submittedAt: phaseStart,
      phaseStartedAt: phaseStart,
      guessSeconds: 60,
      blitz: true,
    });
    expect(blitz.speed_bonus).toBe(20);
    expect(nonBlitz.speed_bonus).toBe(10);
  });

  it("all axes are bounded by their individual maxes", () => {
    const s = scoreGuess({
      guessText: "river otter soft watercolor",
      guessEmbedding: embed,
      promptEmbedding: embed,
      promptTokens,
      submittedAt: phaseStart,
      phaseStartedAt: phaseStart,
      guessSeconds: 60,
    });
    expect(s.subject_score).toBeLessThanOrEqual(30);
    expect(s.style_score).toBeLessThanOrEqual(40);
    expect(s.semantic_score).toBeLessThanOrEqual(20);
    expect(s.speed_bonus).toBeLessThanOrEqual(10);
  });
});
