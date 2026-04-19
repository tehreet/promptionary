import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { embedTexts } from "@/lib/gemini";
import { scoreGuess, type RoleToken } from "@/lib/scoring";
import { todayUtcDate } from "@/lib/daily";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const guess = String(body.guess ?? "").trim();
  const displayName = String(body.display_name ?? "").trim();
  if (guess.length < 1 || guess.length > 200) {
    return NextResponse.json({ error: "guess length invalid" }, { status: 400 });
  }
  if (displayName.length < 1 || displayName.length > 24) {
    return NextResponse.json(
      { error: "display name length invalid" },
      { status: 400 },
    );
  }

  const userSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthed" }, { status: 401 });

  const svc = createSupabaseServiceClient();
  const date = todayUtcDate();

  const { data: puzzle } = await svc
    .from("daily_prompts")
    .select("date, prompt")
    .eq("date", date)
    .maybeSingle();
  if (!puzzle || !puzzle.prompt) {
    return NextResponse.json(
      { error: "today's puzzle isn't ready yet" },
      { status: 409 },
    );
  }

  const { data: existing } = await svc
    .from("daily_guesses")
    .select("id")
    .eq("date", date)
    .eq("player_id", user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "already guessed today" },
      { status: 409 },
    );
  }

  const { data: tokens } = await svc
    .from("daily_prompt_tokens")
    .select("position, token, role")
    .eq("date", date)
    .order("position", { ascending: true });
  const roleTokens: RoleToken[] = (tokens ?? []).map((t) => ({
    token: t.token,
    role: t.role as RoleToken["role"],
  }));

  const [promptEmbedding, guessEmbedding] = await embedTexts([
    puzzle.prompt,
    guess,
  ]);

  const now = new Date();
  const breakdown = scoreGuess({
    guessText: guess,
    guessEmbedding: guessEmbedding ?? [],
    promptEmbedding: promptEmbedding ?? [],
    promptTokens: roleTokens,
    submittedAt: now,
    // Daily puzzle has no speed bonus — pass a large window so the bonus
    // term cancels out to 0 via scoreGuess's downstream rounding.
    phaseStartedAt: now,
    guessSeconds: 1,
  });

  const insert = await svc
    .from("daily_guesses")
    .insert({
      date,
      player_id: user.id,
      display_name: displayName,
      guess,
      subject_score: breakdown.subject_score,
      style_score: breakdown.style_score,
      semantic_score: breakdown.semantic_score,
    })
    .select("id, total_score")
    .single();
  if (insert.error) {
    return NextResponse.json(
      { error: insert.error.message },
      { status: 500 },
    );
  }

  // Rank = how many distinct total_scores strictly above mine, +1.
  const { count: betterCount } = await svc
    .from("daily_guesses")
    .select("id", { count: "exact", head: true })
    .eq("date", date)
    .gt("total_score", insert.data.total_score);
  const rank = (betterCount ?? 0) + 1;

  // Streak bump for signed-in users; no-op for anon (no profiles row).
  if (!user.is_anonymous) {
    await svc.rpc("bump_daily_streak", {
      p_player_id: user.id,
      p_today: date,
    });
  }

  return NextResponse.json({
    ok: true,
    total_score: insert.data.total_score,
    breakdown,
    tokens: tokens ?? [],
    prompt: puzzle.prompt,
    rank,
  });
}
