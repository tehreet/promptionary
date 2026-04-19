import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { generateImagePng, tagPromptRoles } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { round_id, prompt } = await req.json();
  if (!round_id || typeof prompt !== "string") {
    return NextResponse.json(
      { error: "round_id and prompt required" },
      { status: 400 },
    );
  }

  const userSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthed" }, { status: 401 });

  // Validate artist + advance DB phase via RPC (auth.uid() applied).
  const { error: rpcError } = await userSupabase.rpc("submit_artist_prompt", {
    p_round_id: round_id,
    p_prompt: prompt.trim(),
  });
  if (rpcError) {
    return NextResponse.json(
      { error: "submit failed", detail: rpcError.message },
      { status: 400 },
    );
  }

  const svc = createSupabaseServiceClient();
  const { data: round } = await svc
    .from("rounds")
    .select("id, room_id, round_num, prompt")
    .eq("id", round_id)
    .maybeSingle();
  if (!round || !round.prompt) {
    return NextResponse.json({ error: "round not found" }, { status: 404 });
  }

  const { data: room } = await svc
    .from("rooms")
    .select("id, guess_seconds")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room)
    return NextResponse.json({ error: "room not found" }, { status: 404 });

  let tokens: Awaited<ReturnType<typeof tagPromptRoles>>["tokens"];
  let pngBuffer: Buffer;
  try {
    ({ tokens } = await tagPromptRoles(round.prompt));
    pngBuffer = await generateImagePng(round.prompt);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[submit-artist-prompt] gemini failed", message);
    // Drop back to prompting so the artist can try again.
    await svc
      .from("rooms")
      .update({
        phase: "prompting",
        phase_ends_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("id", round.room_id);
    return NextResponse.json(
      { error: "image gen failed", detail: message },
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
      image_url: publicUrl.publicUrl,
      image_storage_path: storagePath,
    })
    .eq("id", round.id);

  if (tokens.length > 0) {
    // Clear any prior tokens (shouldn't happen in normal flow, but defensive)
    await svc.from("round_prompt_tokens").delete().eq("round_id", round.id);
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

  return NextResponse.json({ ok: true });
}
