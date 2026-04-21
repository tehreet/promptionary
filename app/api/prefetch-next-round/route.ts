import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { authorPromptWithRoles, generateImagePng } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// Speculative pre-generation of round N+1 during round N's guessing phase.
// Called from any room member's tab ~5s into guessing; the endpoint is
// idempotent and advisory-locked so parallel tabs don't duplicate work.
//
// Trade-off worth calling out: spectator modifiers are picked at consume
// time inside /api/start-round, but when we consume a prefetch we do NOT
// regenerate the image to apply the modifier. The modifier is still
// recorded on the round (for the reveal badge) — but the image itself is
// the pre-baked one. We eat a small fidelity hit in exchange for turning
// a 20-40s wait into a <1s phase flip.
export async function POST(req: Request) {
  const { room_id } = await req.json();
  if (!room_id) {
    return NextResponse.json({ error: "room_id required" }, { status: 400 });
  }

  const userSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthed" }, { status: 401 });

  const svc = createSupabaseServiceClient();

  const { data: membership } = await svc
    .from("room_players")
    .select("player_id")
    .eq("room_id", room_id)
    .eq("player_id", user.id)
    .maybeSingle();
  if (!membership)
    return NextResponse.json({ error: "not a room member" }, { status: 403 });

  const { data: room } = await svc
    .from("rooms")
    .select(
      "id, mode, phase, round_num, max_rounds, pack, prefetched_prompt, prefetch_started_at",
    )
    .eq("id", room_id)
    .maybeSingle();
  if (!room)
    return NextResponse.json({ error: "room not found" }, { status: 404 });

  // Gate: party-only, non-final round, mid-guessing-or-scoring, not already
  // prefetched, not already in-flight within the last 120s. Every failure
  // returns 200 skipped because this endpoint is best-effort.
  if (room.mode !== "party") {
    return NextResponse.json({ ok: true, skipped: true, reason: "not-party" });
  }
  if (!["guessing", "scoring"].includes(room.phase)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "wrong-phase" });
  }
  if (room.round_num >= room.max_rounds) {
    return NextResponse.json({ ok: true, skipped: true, reason: "last-round" });
  }
  if (room.prefetched_prompt) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "already-prefetched",
    });
  }
  const lockExpiresAt = Date.now() - 120_000;
  if (
    room.prefetch_started_at &&
    new Date(room.prefetch_started_at).getTime() > lockExpiresAt
  ) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "already-in-flight",
    });
  }

  // Claim the advisory lock atomically. We rely on the NULL/stale check
  // above + the update-by-id to race only loosely — a second tab may win
  // the update race, but `prefetched_prompt IS NULL` gate on the read is
  // a cheap filter and the real dedup is the `prefetched_prompt` check
  // at the top. Worst case two tabs each author + render one prompt;
  // the second's write clobbers the first, which is fine.
  const now = new Date().toISOString();
  const { error: lockErr } = await svc
    .from("rooms")
    .update({ prefetch_started_at: now })
    .eq("id", room.id);
  if (lockErr) {
    console.error("[prefetch-next-round] lock update failed", lockErr.message);
    return NextResponse.json({ ok: true, skipped: true, reason: "lock-failed" });
  }

  // Wrap the author + image + upload + write in a try/finally so any
  // failure clears the lock — otherwise a single crash strands the row
  // for 120s and blocks retries.
  try {
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

    const storagePath = `${room.id}/prefetch-${Date.now()}.png`;
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

    // Write the cached bundle. Leave prefetch_started_at in place — the
    // lock stays held until the consumer (start-round) clears everything
    // on next round.
    const { error: writeErr } = await svc
      .from("rooms")
      .update({
        prefetched_prompt: prompt,
        prefetched_image_storage_path: storagePath,
        prefetched_image_url: publicUrl.publicUrl,
        prefetched_tokens: tokens,
      })
      .eq("id", room.id);
    if (writeErr) throw new Error("write failed: " + writeErr.message);

    console.info(
      `[prefetch-next-round] prefetched for room ${room.id} round ${room.round_num + 1}`,
    );
    return NextResponse.json({ ok: true, prefetched: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[prefetch-next-round] failed", message);
    // Release the lock so another tab / next poll can retry.
    await svc
      .from("rooms")
      .update({ prefetch_started_at: null })
      .eq("id", room.id);
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "failed",
      detail: message,
    });
  }
}
