export type RoleToken = {
  token: string;
  role: "subject" | "style" | "modifier" | "filler";
};

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
  let dot = 0,
    aa = 0,
    bb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
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
  blitz = false,
}: {
  guessText: string;
  guessEmbedding: number[];
  promptEmbedding: number[];
  promptTokens: RoleToken[];
  submittedAt: Date;
  phaseStartedAt: Date;
  guessSeconds: number;
  // Blitz variant doubles the speed-bonus scale. Default false so non-blitz
  // rooms keep their existing feel.
  blitz?: boolean;
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
  const semantic_score = Math.round(
    Math.max(0, cosine(guessEmbedding, promptEmbedding)) * 20,
  );

  // Speed bonus scales with both the quality of the guess and how early it
  // was submitted. No threshold — even small guesses get a tiny nudge for
  // moving fast, but the multiplier caps the reward for a blank-ish guess.
  const preBonus = subject_score + style_score + semantic_score;
  let speed_bonus = 0;
  if (preBonus > 0) {
    const elapsedMs = submittedAt.getTime() - phaseStartedAt.getTime();
    const timeFrac = Math.max(0, 1 - elapsedMs / (guessSeconds * 1000));
    // Scale peaks at 10 when preBonus >= 60 (a great guess), down to 2
    // when preBonus is marginal. Keeps early-submit always worth a bit.
    // Blitz rooms double both the floor and the peak so the speed bonus is
    // the star of the show when the clock is short.
    const qualityFrac = Math.min(1, preBonus / 60);
    const base = blitz ? 4 : 2;
    const peak = blitz ? 16 : 8;
    speed_bonus = Math.round(timeFrac * (base + qualityFrac * peak));
  }

  return { subject_score, style_score, semantic_score, speed_bonus };
}
