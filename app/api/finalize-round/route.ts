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
    .select("id, room_id, prompt, ended_at, round_num, artist_player_id")
    .eq("id", round_id)
    .maybeSingle();
  if (!round)
    return NextResponse.json({ error: "round not found" }, { status: 404 });
  if (round.ended_at) return NextResponse.json({ ok: true, already: true });

  const { data: room } = await svc
    .from("rooms")
    .select(
      "id, host_id, phase, round_num, max_rounds, reveal_seconds, guess_seconds, phase_ends_at, blitz",
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

  // On artist rounds, exclude the artist from guessing even if somehow
  // submitted — their score comes from the guessers' average.
  const { data: guesses } = await svc
    .from("guesses")
    .select("id, player_id, guess, submitted_at")
    .eq("round_id", round.id)
    .neq("player_id", round.artist_player_id ?? "00000000-0000-0000-0000-000000000000");

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
      blitz: room.blitz ?? false,
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

  // Artist-mode: reward the artist with the average guesser score for the
  // round so they're incentivized to write "guessable but not trivial" prompts.
  if (round.artist_player_id) {
    const deltas = Object.values(playerScoreDelta);
    const artistDelta =
      deltas.length > 0
        ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length)
        : 0;
    playerScoreDelta[round.artist_player_id] =
      (playerScoreDelta[round.artist_player_id] ?? 0) + artistDelta;
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

    // Lifetime stats bump for signed-in players. The RPC is a no-op for
    // anon users (no profiles row matches) so we don't need to pre-filter.
    await svc.rpc("bump_round_stats", {
      p_player_id: playerId,
      p_round_total: delta,
    });
  }

  await svc
    .from("rounds")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", round.id);

  const isGameOver = room.round_num >= room.max_rounds;

  // Always advance to reveal (even on the final round). This lets the last
  // round pace the same as the middle ones — confetti, recap flipboard, top
  // guesses — before the reveal-advance effect in game-client.tsx flips the
  // room to game_over. Stats bumps still fire here so the logic stays
  // colocated; they land a reveal_seconds before the UI shows game_over,
  // which is fine.
  const revealEndsAt = new Date(
    Date.now() + room.reveal_seconds * 1000,
  ).toISOString();
  await svc
    .from("rooms")
    .update({ phase: "reveal", phase_ends_at: revealEndsAt })
    .eq("id", room.id);

  if (isGameOver) {
    // Lifetime games/wins bump. Compute winners from the final scoreboard:
    //   - Teams mode: every member of the team with the highest average wins.
    //   - Non-teams:  every player tied for the top score wins (usually one).
    const { data: finalPlayers } = await svc
      .from("room_players")
      .select("player_id, score, team, is_spectator")
      .eq("room_id", room.id);

    const { data: roomCfg } = await svc
      .from("rooms")
      .select("teams_enabled")
      .eq("id", room.id)
      .maybeSingle();

    const competitors = (finalPlayers ?? []).filter((p) => !p.is_spectator);
    const winners = new Set<string>();
    if (roomCfg?.teams_enabled) {
      const byTeam = new Map<number, { total: number; count: number; members: string[] }>();
      for (const p of competitors) {
        if (p.team !== 1 && p.team !== 2) continue;
        const bucket = byTeam.get(p.team) ?? { total: 0, count: 0, members: [] };
        bucket.total += p.score;
        bucket.count += 1;
        bucket.members.push(p.player_id);
        byTeam.set(p.team, bucket);
      }
      let bestAvg = -Infinity;
      for (const { total, count } of byTeam.values()) {
        const avg = count > 0 ? total / count : 0;
        if (avg > bestAvg) bestAvg = avg;
      }
      for (const { total, count, members } of byTeam.values()) {
        const avg = count > 0 ? total / count : 0;
        if (avg === bestAvg) members.forEach((id) => winners.add(id));
      }
    } else {
      const top = competitors.reduce((m, p) => Math.max(m, p.score), 0);
      if (top > 0) {
        for (const p of competitors) {
          if (p.score === top) winners.add(p.player_id);
        }
      }
    }

    for (const p of competitors) {
      await svc.rpc("bump_game_stats", {
        p_player_id: p.player_id,
        p_did_win: winners.has(p.player_id),
      });
    }
  }

  return NextResponse.json({ ok: true });
}
