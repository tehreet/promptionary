import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import {
  authorPromptWithRoles,
  generateImagePng,
  tagPromptRoles,
} from "@/lib/gemini";

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
    .select("id, room_id, round_num, prompt, artist_player_id")
    .eq("id", round_id)
    .maybeSingle();
  if (!round)
    return NextResponse.json({ error: "round not found" }, { status: 404 });

  const { data: room } = await svc
    .from("rooms")
    .select("id, host_id, mode, guess_seconds, phase, pack")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room)
    return NextResponse.json({ error: "room not found" }, { status: 404 });

  // On default modes the host drives start-round. On artist mode, any room
  // member can POST here after the artist submits their prompt — the flip
  // from 'prompting' -> 'generating' is what gates it.
  if (room.mode !== "artist" && room.host_id !== user.id) {
    return NextResponse.json({ error: "not host" }, { status: 403 });
  }
  if (room.phase !== "generating") {
    return NextResponse.json(
      { error: `wrong phase: ${room.phase}` },
      { status: 409 },
    );
  }

  let prompt: string;
  let tokens: Awaited<ReturnType<typeof authorPromptWithRoles>>["tokens"];
  let pngBuffer: Buffer;
  try {
    if (round.prompt && round.prompt.length > 0) {
      // Artist-mode round: the artist already wrote the prompt. Tag it with
      // Gemini so scoring can weight words by role, then skip authoring.
      prompt = round.prompt;
      ({ tokens } = await tagPromptRoles(prompt));
    } else {
      // Collect up to 5 most recent prompts so the author avoids repeats.
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
      ({ prompt, tokens } = await authorPromptWithRoles(
        previousPrompts,
        room.pack ?? "mixed",
      ));
    }
    pngBuffer = await generateImagePng(prompt);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[start-round] gemini failed", message);
    // Kick the room back to lobby so players aren't stuck staring at a spinner.
    await svc
      .from("rooms")
      .update({ phase: "lobby", round_num: round.round_num > 0 ? round.round_num - 1 : 0 })
      .eq("id", round.room_id);
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

  await svc
    .from("rounds")
    .update({
      prompt,
      image_url: publicUrl.publicUrl,
      image_storage_path: storagePath,
    })
    .eq("id", round.id);

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

  const phaseEndsAt = new Date(
    Date.now() + room.guess_seconds * 1000,
  ).toISOString();
  await svc
    .from("rooms")
    .update({ phase: "guessing", phase_ends_at: phaseEndsAt })
    .eq("id", round.room_id);

  return NextResponse.json({ ok: true, image_url: publicUrl.publicUrl });
}
