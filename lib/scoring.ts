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
  const semantic_score = Math.round(
    Math.max(0, cosine(guessEmbedding, promptEmbedding)) * 20,
  );

  const preBonus = subject_score + style_score + semantic_score;
  let speed_bonus = 0;
  if (preBonus > 40) {
    const elapsedMs = submittedAt.getTime() - phaseStartedAt.getTime();
    const fraction = Math.max(0, 1 - elapsedMs / (guessSeconds * 1000));
    speed_bonus = Math.round(fraction * 10);
  }

  return { subject_score, style_score, semantic_score, speed_bonus };
}
