import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { pickTabooWords } from "@/lib/taboo-words";

export const runtime = "nodejs";

// Seed 3 forbidden words on an artist round when the room has taboo_enabled.
// Called by the client immediately after start_round() RPC returns. Idempotent
// — if the round already has words, we leave them alone so re-calls (e.g.
// poll-triggered retries) don't rotate the chip list mid-round.
//
// Auth: caller must be a room member. Beyond that we trust DB state —
// taboo_enabled and artist_player_id are both set by host / start_round
// guards, so there's no way for a non-host to force words onto a
// non-taboo room.
export async function POST(req: Request) {
  const { round_id } = await req.json().catch(() => ({}));
  if (!round_id || typeof round_id !== "string") {
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
    .select("id, room_id, artist_player_id, taboo_words")
    .eq("id", round_id)
    .maybeSingle();
  if (!round)
    return NextResponse.json({ error: "round not found" }, { status: 404 });
  if (!round.artist_player_id) {
    // Not an artist round — nothing to seed.
    return NextResponse.json({ ok: true, skipped: "not_artist_round" });
  }
  if (round.taboo_words && round.taboo_words.length > 0) {
    // Already seeded — leave alone so the artist keeps the same chip list
    // if their tab retries on a race.
    return NextResponse.json({ ok: true, words: round.taboo_words });
  }

  // Caller must be in the room. We check via room_players so spectators or
  // host can both trigger the seed — matches the submit-artist-prompt
  // convention of "any room member can make the round progress".
  const { data: membership } = await svc
    .from("room_players")
    .select("player_id")
    .eq("room_id", round.room_id)
    .eq("player_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "not in room" }, { status: 403 });
  }

  const { data: room } = await svc
    .from("rooms")
    .select("id, mode, taboo_enabled")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room || room.mode !== "artist" || !room.taboo_enabled) {
    return NextResponse.json({ ok: true, skipped: "taboo_disabled" });
  }

  const words = pickTabooWords(3);
  const { error } = await svc
    .from("rounds")
    .update({ taboo_words: words })
    .eq("id", round.id)
    // Double-insert guard: only write if still empty.
    .is("taboo_words", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, words });
}
