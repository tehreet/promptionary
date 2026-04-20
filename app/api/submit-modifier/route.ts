import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { moderatePrompt } from "@/lib/gemini";

export const runtime = "nodejs";
// Moderation calls Gemini; keep the ceiling generous but not image-gen long.
export const maxDuration = 30;

// Unified error shape — mirrors the artist-prompt route so the client can
// show `detail` verbatim.
type ErrorBody = { error: string; detail: string };
function errJson(body: ErrorBody, status: number) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { room_id?: unknown; round_num?: unknown; modifier?: unknown }
    | null;
  if (!body) {
    return errJson(
      { error: "bad_request", detail: "invalid JSON body" },
      400,
    );
  }
  const { room_id, round_num, modifier } = body;
  if (
    typeof room_id !== "string" ||
    typeof round_num !== "number" ||
    typeof modifier !== "string"
  ) {
    return errJson(
      { error: "bad_request", detail: "room_id, round_num, modifier required" },
      400,
    );
  }

  const trimmed = modifier.trim();
  if (trimmed.length < 1 || trimmed.length > 60) {
    return errJson(
      { error: "bad_request", detail: "modifier must be 1–60 characters" },
      400,
    );
  }

  const userSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();
  if (!user) {
    return errJson(
      { error: "unauthed", detail: "you're not signed in to this room" },
      401,
    );
  }

  // Moderation pass — spectator modifiers are user-authored and end up in
  // the Gemini image prompt, so we run the same classifier we use on
  // artist prompts. Fail open on classifier errors (network blip, rate
  // limit) so a flaky moderator can't silently block spectators.
  try {
    const verdict = await moderatePrompt(trimmed);
    if (!verdict.safe) {
      return errJson(
        {
          error: "modifier_rejected",
          detail: verdict.reason ?? "Let's try a different modifier",
        },
        400,
      );
    }
  } catch (e) {
    console.warn(
      "[submit-modifier] moderation check failed, proceeding as safe",
      e instanceof Error ? e.message : String(e),
    );
  }

  // RPC enforces spectator + phase + rate-limit under auth.uid().
  const { data: id, error: rpcError } = await userSupabase.rpc(
    "submit_modifier",
    {
      p_room_id: room_id,
      p_round_num: round_num,
      p_modifier: trimmed,
    },
  );
  if (rpcError) {
    return errJson(
      { error: "submit_failed", detail: rpcError.message },
      400,
    );
  }
  return NextResponse.json({ ok: true, id });
}
