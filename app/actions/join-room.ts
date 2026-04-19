"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAnonSession } from "./auth";

export async function joinRoomAction(formData: FormData) {
  await ensureAnonSession();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const rawCode = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!displayName) throw new Error("display name required");
  if (!/^[A-Z]{4}$/.test(rawCode)) throw new Error("code must be 4 letters");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("join_room_by_code", {
    p_code: rawCode,
    p_display_name: displayName,
  });
  if (error) throw error;

  redirect(`/play/${rawCode}`);
}
