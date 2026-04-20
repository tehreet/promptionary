import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { generateImagePng, moderatePrompt, tagPromptRoles } from "@/lib/gemini";
import { findTabooHit } from "@/lib/taboo-words";

export const runtime = "nodejs";
export const maxDuration = 60;

// Unified error shape: { error: <short machine-ish label>, detail: <user-friendly reason> }
type ErrorBody = { error: string; detail: string };
function errJson(body: ErrorBody, status: number) {
  return NextResponse.json(body, { status });
}

// If the artist hits an error right before the prompting phase timer expires,
// they'd get punished with basically no time to fix and retry. Bump the
// deadline out to give them at least 20s of breathing room.
async function bumpPromptingDeadlineIfTight(
  svc: ReturnType<typeof createSupabaseServiceClient>,
  roomId: string,
) {
  const { data: room } = await svc
    .from("rooms")
    .select("phase, phase_ends_at")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || room.phase !== "prompting") return;
  const now = Date.now();
  const endsAt = room.phase_ends_at ? new Date(room.phase_ends_at).getTime() : 0;
  const remainingMs = endsAt - now;
  if (remainingMs < 10_000) {
    await svc
      .from("rooms")
      .update({ phase_ends_at: new Date(now + 20_000).toISOString() })
      .eq("id", roomId);
  }
}

export async function POST(req: Request) {
  const { round_id, prompt } = await req.json();
  if (!round_id || typeof prompt !== "string") {
    return errJson(
      {
        error: "bad_request",
        detail: "round id and prompt are required",
      },
      400,
    );
  }

  // Stress-test bots pass a Bearer token; browsers use cookies.
  const authHeader = req.headers.get("authorization") ?? "";
  const userSupabase = authHeader.toLowerCase().startsWith("bearer ")
    ? createClient(
        serverEnv!.NEXT_PUBLIC_SUPABASE_URL,
        serverEnv!.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { global: { headers: { Authorization: authHeader } } },
      )
    : await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();
  if (!user) {
    return errJson(
      { error: "unauthed", detail: "you're not signed in to this room" },
      401,
    );
  }

  // Taboo pre-check — must happen BEFORE the RPC that advances the phase,
  // otherwise we'd leave the room stuck in 'generating'. Fetch the round's
  // taboo_words with the user's client (RLS verifies they're a member).
  const trimmedPrompt = prompt.trim();
  {
    const { data: tabooRound } = await userSupabase
      .from("rounds")
      .select("taboo_words")
      .eq("id", round_id)
      .maybeSingle();
    const words = (tabooRound?.taboo_words as string[] | null) ?? null;
    if (words && words.length > 0) {
      const hit = findTabooHit(trimmedPrompt, words);
      if (hit) {
        return errJson(
          {
            error: "taboo hit",
            detail: `You used a banned word: "${hit}"`,
          },
          400,
        );
      }
    }
  }

  // Moderation BEFORE the RPC so a safety-rejected prompt doesn't flip the
  // phase to 'generating' and force a visible roundtrip back to 'prompting'.
  // Fail open on classifier errors so a flaky Gemini can't brick the round.
  try {
    const verdict = await moderatePrompt(trimmedPrompt);
    if (!verdict.safe) {
      return errJson(
        {
          error: "prompt rejected",
          detail: verdict.reason ?? "Let's try a different prompt",
        },
        400,
      );
    }
  } catch (e) {
    console.warn(
      "[submit-artist-prompt] moderation check failed, proceeding as safe",
      e instanceof Error ? e.message : String(e),
    );
  }

  // Validate artist + advance DB phase via RPC (auth.uid() applied).
  const { error: rpcError } = await userSupabase.rpc("submit_artist_prompt", {
    p_round_id: round_id,
    p_prompt: trimmedPrompt,
  });
  if (rpcError) {
    // RPC failed: we never left the prompting phase, so just give the artist
    // a bit more time if they were near the buzzer.
    try {
      const svc = createSupabaseServiceClient();
      const { data: round } = await svc
        .from("rounds")
        .select("room_id")
        .eq("id", round_id)
        .maybeSingle();
      if (round?.room_id) await bumpPromptingDeadlineIfTight(svc, round.room_id);
    } catch {
      // bump is best-effort — don't mask the underlying error.
    }
    return errJson(
      { error: "submit_failed", detail: rpcError.message },
      400,
    );
  }

  const svc = createSupabaseServiceClient();
  const { data: round } = await svc
    .from("rounds")
    .select("id, room_id, round_num, prompt")
    .eq("id", round_id)
    .maybeSingle();
  if (!round || !round.prompt) {
    return errJson(
      { error: "round_not_found", detail: "we couldn't find your round" },
      404,
    );
  }

  const { data: room } = await svc
    .from("rooms")
    .select("id, guess_seconds")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room) {
    return errJson(
      { error: "room_not_found", detail: "we couldn't find the room" },
      404,
    );
  }

  // Spectator modifiers from the PREVIOUS round: pick one at random and
  // tack it onto the artist's prompt before sending it to Gemini. Matches
  // the behavior in /api/start-round for party mode.
  let chosenModifier: { modifier: string; spectator_id: string } | null = null;
  if (round.round_num > 1) {
    const { data: mods } = await svc
      .from("spectator_modifiers")
      .select("modifier, spectator_id")
      .eq("room_id", round.room_id)
      .eq("round_num", round.round_num - 1);
    if (mods && mods.length > 0) {
      const pick = mods[Math.floor(Math.random() * mods.length)];
      chosenModifier = {
        modifier: pick.modifier,
        spectator_id: pick.spectator_id,
      };
    }
  }
  const finalPrompt = chosenModifier
    ? `${round.prompt} ${chosenModifier.modifier}`
    : round.prompt;

  let tokens: Awaited<ReturnType<typeof tagPromptRoles>>["tokens"];
  let pngBuffer: Buffer;
  try {
    ({ tokens } = await tagPromptRoles(finalPrompt));
    pngBuffer = await generateImagePng(finalPrompt);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[submit-artist-prompt] gemini failed", message);
    // Drop back to prompting so the artist can try again with a roomy timer.
    await svc
      .from("rooms")
      .update({
        phase: "prompting",
        phase_ends_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("id", round.room_id);
    return errJson(
      {
        error: "image_gen_failed",
        detail:
          "the AI rejected that prompt — try rephrasing or pick a different subject",
      },
      502,
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
    // Drop back to prompting so the artist can retry.
    await svc
      .from("rooms")
      .update({
        phase: "prompting",
        phase_ends_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("id", round.room_id);
    return errJson(
      {
        error: "upload_failed",
        detail: "we couldn't save the image — please try again",
      },
      500,
    );
  }
  const { data: publicUrl } = svc.storage
    .from("round-images")
    .getPublicUrl(storagePath);

  await svc
    .from("rounds")
    .update({
      // Persist the FINAL prompt so the reveal flipboard shows what
      // Gemini actually rendered. Modifier attribution lives in the
      // chosen_modifier_* columns for the "Modifier applied:" UI.
      prompt: finalPrompt,
      image_url: publicUrl.publicUrl,
      image_storage_path: storagePath,
      chosen_modifier: chosenModifier?.modifier ?? null,
      chosen_modifier_spectator_id: chosenModifier?.spectator_id ?? null,
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
