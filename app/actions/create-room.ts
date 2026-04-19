"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAnonSession } from "./auth";

export async function createRoomAction(formData: FormData) {
  await ensureAnonSession();
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) throw new Error("display name required");

  const intOrNull = (name: string) => {
    const raw = formData.get(name);
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_room", {
    p_display_name: displayName,
    p_max_rounds: intOrNull("maxRounds"),
    p_guess_seconds: intOrNull("guessSeconds"),
    p_reveal_seconds: intOrNull("revealSeconds"),
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("create_room returned no row");

  redirect(`/play/${row.new_code}`);
}
