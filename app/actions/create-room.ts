"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAnonSession } from "./auth";

// One-click create. The home-page form only collects the display name —
// mode / pack / timing all move to the host-only lobby settings panel.
export async function createRoomAction(formData: FormData) {
  await ensureAnonSession();
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) throw new Error("display name required");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_room", {
    p_display_name: displayName,
    p_mode: "party",
    p_pack: "mixed",
    p_max_rounds: 5,
    p_guess_seconds: 45,
    p_reveal_seconds: 20,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("create_room returned no row");

  redirect(`/play/${row.new_code}`);
}
