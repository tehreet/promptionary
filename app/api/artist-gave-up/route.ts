import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { authorPromptWithRoles, generateImagePng } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// Artist-mode fallback. Fired by the host's tab when the prompting timer
// expires AND no artist prompt ever landed (phase is still 'prompting' and
// rounds.prompt is empty). We hand the round off to the party-mode author
// so the game keeps moving instead of stalling on a ghost.
//
// Idempotent: phase-guarded ('prompting' only) and prompt-guarded (only
// acts when rounds.prompt is empty). A second caller racing the first
// will get a 409 back.
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
    .select("id, room_id, round_num, prompt, artist_player_id")
    .eq("id", round_id)
    .maybeSingle();
  if (!round)
    return NextResponse.json({ error: "round not found" }, { status: 404 });

  const { data: room } = await svc
    .from("rooms")
    .select("id, host_id, mode, guess_seconds, phase, phase_ends_at, pack")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room)
    return NextResponse.json({ error: "room not found" }, { status: 404 });

  // Only the host should trigger this — otherwise every competitor's tab
  // races to fire it on timer expiry and we spam Gemini.
  if (room.host_id !== user.id) {
    return NextResponse.json({ error: "not host" }, { status: 403 });
  }
  if (room.mode !== "artist") {
    return NextResponse.json(
      { error: "not artist mode" },
      { status: 409 },
    );
  }
  if (room.phase !== "prompting") {
    return NextResponse.json(
      { error: `wrong phase: ${room.phase}` },
      { status: 409 },
    );
  }
  // Don't take over if the artist actually wrote something.
  if (round.prompt && round.prompt.length > 0) {
    return NextResponse.json(
      { error: "artist already submitted" },
      { status: 409 },
    );
  }
  // Timer must actually be up. Saves us from a client with a fast clock
  // triggering this early.
  const now = Date.now();
  const endsAt = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : 0;
  if (endsAt > now) {
    return NextResponse.json(
      { error: "prompting timer still running" },
      { status: 409 },
    );
  }

  // Flip to 'generating' up front. Any concurrent call will hit the phase
  // guard above and 409 out — crude but effective idempotency.
  await svc
    .from("rooms")
    .update({ phase: "generating", phase_ends_at: null })
    .eq("id", room.id);

  // Party-mode author path, same as /api/start-round. Recent-prompt context
  // keeps variety across rounds even when the AI takes over mid-game.
  let authored: string;
  let tokens: Awaited<ReturnType<typeof authorPromptWithRoles>>["tokens"];
  let pngBuffer: Buffer;
  try {
    const { data: recentRounds } = await svc
      .from("rounds")
      .select("prompt")
      .eq("room_id", round.room_id)
      .not("prompt", "is", null)
      .neq("prompt", "")
      .order("round_num", { ascending: false })
      .limit(5);
    const previousPrompts = (recentRounds ?? [])
      .map((r) => r.prompt)
      .filter((p): p is string => !!p);
    const result = await authorPromptWithRoles(
      previousPrompts,
      room.pack ?? "mixed",
    );
    authored = result.prompt;
    tokens = result.tokens;
    pngBuffer = await generateImagePng(authored);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[artist-gave-up] gemini failed", message);
    // Bail back to lobby like start-round does on catastrophic failure —
    // the round itself is abandoned because the artist ghosted AND the AI
    // tripped. Rare.
    await svc
      .from("rooms")
      .update({
        phase: "lobby",
        round_num: round.round_num > 0 ? round.round_num - 1 : 0,
      })
      .eq("id", room.id);
    await svc.from("rounds").delete().eq("id", round.id);
    return NextResponse.json(
      { error: "gemini request failed", detail: message },
      { status: 502 },
    );
  }

  const storagePath = `${round.room_id}/${round.id}.png`;
  const upload = await svc.storage
    .from("round-images")
    .upload(storagePath, pngBuffer, {
      contentType: "image/png",
      upsert: true,
    });
  if (upload.error) {
    return NextResponse.json(
      { error: "upload failed: " + upload.error.message },
      { status: 500 },
    );
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
        prompt: authored,
        image_url: publicUrl.publicUrl,
        image_storage_path: storagePath,
        ai_took_over: true,
      })
      .eq("id", round.id),
    svc
      .from("rooms")
      .update({ phase: "guessing", phase_ends_at: phaseEndsAt })
      .eq("id", room.id),
  ]);

  if (tokens.length > 0) {
    await svc.from("round_prompt_tokens").insert(
      tokens.map((t, i) => ({
        round_id: round.id,
        position: i,
        token: t.token,
        role: t.role,
      })),
    );
  }

  return NextResponse.json({ ok: true, image_url: publicUrl.publicUrl });
}
