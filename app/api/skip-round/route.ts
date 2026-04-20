import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import {
  authorPromptWithRoles,
  generateImagePng,
} from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cap skips per round_num so a salty lobby can't reroll forever. Incremented
// after a successful reroll; naturally resets when round_num advances — we
// only ever compare against the counter on the current round's row.
const MAX_SKIPS_PER_ROUND = 2;

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
    .select("id, room_id, round_num, artist_player_id")
    .eq("id", round_id)
    .maybeSingle();
  if (!round)
    return NextResponse.json({ error: "round not found" }, { status: 404 });

  const { data: room } = await svc
    .from("rooms")
    .select(
      "id, host_id, mode, phase, round_num, guess_seconds, pack, skip_count",
    )
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room)
    return NextResponse.json({ error: "room not found" }, { status: 404 });

  // Any room member can trigger this endpoint — we just need the caller to
  // be authenticated and in the room. The vote threshold + atomic phase
  // flip below are what actually gate the reroll.
  const { data: membership } = await svc
    .from("room_players")
    .select("player_id, is_spectator")
    .eq("room_id", room.id)
    .eq("player_id", user.id)
    .maybeSingle();
  if (!membership)
    return NextResponse.json({ error: "not a room member" }, { status: 403 });

  if (room.phase !== "guessing") {
    return NextResponse.json(
      { error: `wrong phase: ${room.phase}` },
      { status: 409 },
    );
  }
  if (room.round_num !== round.round_num) {
    return NextResponse.json(
      { error: "round number mismatch" },
      { status: 409 },
    );
  }

  // Skip cap — after we already rerolled MAX times for this round_num,
  // further skip requests are rejected. Clients shouldn't even offer the
  // button in that case but we double-check server-side.
  if ((room.skip_count ?? 0) >= MAX_SKIPS_PER_ROUND) {
    return NextResponse.json(
      { skipped: false, error: "skip cap reached", cap: MAX_SKIPS_PER_ROUND },
      { status: 409 },
    );
  }

  // Count eligible voters (non-spectators, minus the artist on artist
  // rounds). Also powers the denominator for the tally.
  const { data: playersRaw } = await svc
    .from("room_players")
    .select("player_id, is_spectator")
    .eq("room_id", room.id);
  const players = playersRaw ?? [];
  let eligible = players.filter((p) => !p.is_spectator).length;
  if (
    round.artist_player_id &&
    players.some(
      (p) => !p.is_spectator && p.player_id === round.artist_player_id,
    )
  ) {
    eligible = Math.max(0, eligible - 1);
  }
  if (eligible <= 0) {
    return NextResponse.json(
      { skipped: false, error: "no eligible voters" },
      { status: 409 },
    );
  }

  const { count: voteCount } = await svc
    .from("skip_votes")
    .select("voter_id", { count: "exact", head: true })
    .eq("round_id", round.id);
  const have = voteCount ?? 0;
  const needed = Math.ceil(eligible / 2);

  if (have < needed) {
    return NextResponse.json({ skipped: false, needed, have, eligible });
  }

  // Threshold met. Race-safe mark: flip the phase to 'generating' and bump
  // skip_count atomically. The .eq("phase","guessing") guard guarantees
  // only one concurrent caller wins the reroll; the rest see `raced: true`.
  //
  // We keep round_num where it is (reroll semantics, not a new round). The
  // old round row gets deleted below — cascade wipes skip_votes +
  // round_prompt_tokens.
  const { data: phaseFlip, error: phaseErr } = await svc
    .from("rooms")
    .update({
      phase: "generating",
      phase_ends_at: null,
      skip_count: (room.skip_count ?? 0) + 1,
    })
    .eq("id", room.id)
    .eq("phase", "guessing")
    .select("id")
    .maybeSingle();
  if (phaseErr || !phaseFlip) {
    return NextResponse.json({
      skipped: false,
      needed,
      have,
      eligible,
      raced: true,
    });
  }

  // Clear any guesses for the old round so the scoreboard doesn't include
  // stale attempts. Delete the old round last (cascade handles skip_votes +
  // round_prompt_tokens).
  await svc.from("guesses").delete().eq("round_id", round.id);
  await svc.from("rounds").delete().eq("id", round.id);

  // Artist mode: bounce back to 'prompting' so the artist can revise. In
  // default mode we inline the Gemini author + image pipeline.
  if (round.artist_player_id) {
    const { data: inserted, error: insertErr } = await svc
      .from("rounds")
      .insert({
        room_id: room.id,
        round_num: round.round_num,
        prompt: "",
        artist_player_id: round.artist_player_id,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      return NextResponse.json(
        { skipped: false, error: "failed to create round" },
        { status: 500 },
      );
    }
    await svc
      .from("rooms")
      .update({
        phase: "prompting",
        phase_ends_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("id", room.id);
    return NextResponse.json({ skipped: true, round_id: inserted.id });
  }

  const { data: inserted, error: insertErr } = await svc
    .from("rounds")
    .insert({
      room_id: room.id,
      round_num: round.round_num,
      prompt: "",
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { skipped: false, error: "failed to create round" },
      { status: 500 },
    );
  }
  const newRoundId = inserted.id;

  try {
    // Avoid the last 5 prompts so the reroll is a real shake-up, not a
    // near-duplicate of what just got skipped.
    const { data: recentRounds } = await svc
      .from("rounds")
      .select("prompt")
      .eq("room_id", room.id)
      .not("prompt", "is", null)
      .neq("prompt", "")
      .order("round_num", { ascending: false })
      .limit(5);
    const previousPrompts = (recentRounds ?? [])
      .map((r) => r.prompt)
      .filter((p): p is string => !!p);
    const { prompt, tokens } = await authorPromptWithRoles(
      previousPrompts,
      room.pack ?? "mixed",
    );
    const pngBuffer = await generateImagePng(prompt);

    const storagePath = `${room.id}/${newRoundId}.png`;
    const upload = await svc.storage
      .from("round-images")
      .upload(storagePath, pngBuffer, {
        contentType: "image/png",
        upsert: true,
      });
    if (upload.error) {
      throw new Error("upload failed: " + upload.error.message);
    }
    const { data: publicUrl } = svc.storage
      .from("round-images")
      .getPublicUrl(storagePath);

    const phaseEndsAt = new Date(
      Date.now() + room.guess_seconds * 1000,
    ).toISOString();
    await Promise.all([
      svc
        .from("rounds")
        .update({
          prompt,
          image_url: publicUrl.publicUrl,
          image_storage_path: storagePath,
        })
        .eq("id", newRoundId),
      svc
        .from("rooms")
        .update({ phase: "guessing", phase_ends_at: phaseEndsAt })
        .eq("id", room.id),
    ]);

    if (tokens.length > 0) {
      await svc.from("round_prompt_tokens").insert(
        tokens.map((t, i) => ({
          round_id: newRoundId,
          position: i,
          token: t.token,
          role: t.role,
        })),
      );
    }

    return NextResponse.json({ skipped: true, round_id: newRoundId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[skip-round] gemini failed", message);
    // Drop the room back to lobby so everyone isn't stuck staring at a
    // half-initialized reroll. Mirrors the fallback in /api/start-round.
    await svc
      .from("rooms")
      .update({
        phase: "lobby",
        round_num: round.round_num > 0 ? round.round_num - 1 : 0,
      })
      .eq("id", room.id);
    await svc.from("rounds").delete().eq("id", newRoundId);
    return NextResponse.json(
      { skipped: false, error: "gemini request failed", detail: message },
      { status: 502 },
    );
  }
}
