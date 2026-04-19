import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { embedTexts } from "@/lib/gemini";
import { scoreGuess, type RoleToken } from "@/lib/scoring";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { round_id } = await req.json();
  if (!round_id) {
    return NextResponse.json({ error: "round_id required" }, { status: 400 });
  }

  const userSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthed" }, { status: 401 });

  const svc = createSupabaseServiceClient();

  const { data: round } = await svc
    .from("rounds")
    .select("id, room_id, prompt, ended_at, round_num")
    .eq("id", round_id)
    .maybeSingle();
  if (!round)
    return NextResponse.json({ error: "round not found" }, { status: 404 });
  if (round.ended_at) return NextResponse.json({ ok: true, already: true });

  const { data: room } = await svc
    .from("rooms")
    .select(
      "id, host_id, phase, round_num, max_rounds, reveal_seconds, guess_seconds, phase_ends_at",
    )
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room)
    return NextResponse.json({ error: "room not found" }, { status: 404 });
  // Any room member can trigger finalize — the route is idempotent and
  // relying only on the host's browser tab makes the game stall when
  // they background the window.
  const { data: membership } = await svc
    .from("room_players")
    .select("player_id")
    .eq("room_id", room.id)
    .eq("player_id", user.id)
    .maybeSingle();
  if (!membership)
    return NextResponse.json({ error: "not a room member" }, { status: 403 });
  if (!["guessing", "scoring"].includes(room.phase)) {
    return NextResponse.json(
      { error: `wrong phase: ${room.phase}` },
      { status: 409 },
    );
  }

  await svc
    .from("rooms")
    .update({ phase: "scoring", phase_ends_at: null })
    .eq("id", room.id);

  const { data: guesses } = await svc
    .from("guesses")
    .select("id, player_id, guess, submitted_at")
    .eq("round_id", round.id);

  const { data: tokens } = await svc
    .from("round_prompt_tokens")
    .select("token, role")
    .eq("round_id", round.id);

  const roleTokens: RoleToken[] = (tokens ?? []).map((t) => ({
    token: t.token,
    role: t.role as RoleToken["role"],
  }));

  const texts = [round.prompt, ...(guesses ?? []).map((g) => g.guess)];
  const embeddings = texts.length > 0 ? await embedTexts(texts) : [];
  const promptEmbedding = embeddings[0] ?? [];

  const phaseStartedAt = new Date(
    new Date(room.phase_ends_at ?? new Date().toISOString()).getTime() -
      room.guess_seconds * 1000,
  );

  const playerScoreDelta: Record<string, number> = {};

  for (let i = 0; i < (guesses ?? []).length; i++) {
    const g = guesses![i];
    const embedding = embeddings[i + 1] ?? [];
    const breakdown = scoreGuess({
      guessText: g.guess,
      guessEmbedding: embedding,
      promptEmbedding,
      promptTokens: roleTokens,
      submittedAt: new Date(g.submitted_at),
      phaseStartedAt,
      guessSeconds: room.guess_seconds,
    });
    const total =
      breakdown.subject_score +
      breakdown.style_score +
      breakdown.semantic_score +
      breakdown.speed_bonus;
    playerScoreDelta[g.player_id] =
      (playerScoreDelta[g.player_id] ?? 0) + total;

    await svc
      .from("guesses")
      .update({
        subject_score: breakdown.subject_score,
        style_score: breakdown.style_score,
        semantic_score: breakdown.semantic_score,
        speed_bonus: breakdown.speed_bonus,
        scored_at: new Date().toISOString(),
      })
      .eq("id", g.id);
  }

  for (const [playerId, delta] of Object.entries(playerScoreDelta)) {
    const { data: row } = await svc
      .from("room_players")
      .select("score")
      .eq("room_id", room.id)
      .eq("player_id", playerId)
      .maybeSingle();
    const current = row?.score ?? 0;
    await svc
      .from("room_players")
      .update({ score: current + delta })
      .eq("room_id", room.id)
      .eq("player_id", playerId);
  }

  await svc
    .from("rounds")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", round.id);

  if (room.round_num >= room.max_rounds) {
    await svc
      .from("rooms")
      .update({ phase: "game_over", phase_ends_at: null })
      .eq("id", room.id);
  } else {
    const revealEndsAt = new Date(
      Date.now() + room.reveal_seconds * 1000,
    ).toISOString();
    await svc
      .from("rooms")
      .update({ phase: "reveal", phase_ends_at: revealEndsAt })
      .eq("id", room.id);
  }

  return NextResponse.json({ ok: true });
}
