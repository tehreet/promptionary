"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";
import { ensureAnonSession } from "./auth";

// Resolve the display name: shared-name field first, then the signed-in
// profile's display_name, then a Player### last-resort.
async function resolveDisplayName(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  raw: string,
): Promise<string> {
  const trimmed = raw.trim();
  if (trimmed) return trimmed;
  const profile = await getCurrentProfile(supabase);
  if (profile?.display_name) return profile.display_name;
  return `Player${Math.floor(Math.random() * 900) + 100}`;
}

export async function joinRoomAction(formData: FormData) {
  await ensureAnonSession();
  const rawCode = String(formData.get("code") ?? "").trim().toUpperCase();
  const asSpectator = formData.get("spectator") === "1";
  if (!/^[A-Z]{4}$/.test(rawCode)) throw new Error("code must be 4 letters");

  const supabase = await createSupabaseServerClient();
  const displayName = await resolveDisplayName(
    supabase,
    String(formData.get("displayName") ?? ""),
  );

  const { error } = await supabase.rpc("join_room_by_code", {
    p_code: rawCode,
    p_display_name: displayName,
    p_as_spectator: asSpectator,
  });
  if (error) throw error;

  redirect(`/play/${rawCode}`);
}
