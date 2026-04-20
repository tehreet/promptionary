"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAnonSession } from "./auth";
import { randomDisplayName } from "@/lib/player";

// Quick Match: single-click drop into a public lobby. Slots the caller into
// an existing open public lobby if one has room; otherwise mints a fresh
// public lobby and makes them host. No code, no settings — the form just
// collects a display name (and even that's optional; we fall back to a
// randomly generated one so the zero-input path works).
export async function quickMatchAction(formData: FormData) {
  await ensureAnonSession();

  const raw = String(formData.get("displayName") ?? "").trim();
  const displayName = raw.length > 0 ? raw : randomDisplayName();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("find_or_create_quick_match", {
    p_display_name: displayName,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("find_or_create_quick_match returned no row");

  redirect(`/play/${row.new_code}`);
}
