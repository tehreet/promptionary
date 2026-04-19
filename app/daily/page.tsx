import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ensureAnonSession } from "@/app/actions/auth";
import { ensureDailyPuzzle, todayUtcDate } from "@/lib/daily";
import { DailyClient } from "./daily-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DailyPage() {
  const user = await ensureAnonSession();
  const svc = createSupabaseServiceClient();
  const date = todayUtcDate();

  const puzzle = await ensureDailyPuzzle(svc, date);

  const { data: existing } = await svc
    .from("daily_guesses")
    .select(
      "id, display_name, guess, subject_score, style_score, semantic_score, total_score, submitted_at",
    )
    .eq("date", date)
    .eq("player_id", user.id)
    .maybeSingle();

  const { data: leaderboard } = await svc
    .from("daily_guesses")
    .select("id, player_id, display_name, guess, total_score, submitted_at")
    .eq("date", date)
    .order("total_score", { ascending: false })
    .order("submitted_at", { ascending: true })
    .limit(20);

  let existingTokens: Array<{ position: number; token: string; role: string }> = [];
  let existingPrompt: string | null = null;
  if (existing) {
    const { data: puzzleRow } = await svc
      .from("daily_prompts")
      .select("prompt")
      .eq("date", date)
      .maybeSingle();
    existingPrompt = puzzleRow?.prompt ?? null;
    const { data: tokens } = await svc
      .from("daily_prompt_tokens")
      .select("position, token, role")
      .eq("date", date)
      .order("position", { ascending: true });
    existingTokens = tokens ?? [];
  }

  return (
    <DailyClient
      date={date}
      imageUrl={puzzle.image_url}
      myGuess={existing}
      myPrompt={existingPrompt}
      myTokens={existingTokens}
      leaderboard={leaderboard ?? []}
      currentPlayerId={user.id}
    />
  );
}
