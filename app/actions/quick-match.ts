"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";
import { ensureAnonSession } from "./auth";
import { randomDisplayName } from "@/lib/player";

// Quick Match: single-click drop into a public lobby. Slots the caller into
// an existing open public lobby if one has room; otherwise mints a fresh
// public lobby and makes them host. No code, no settings — the form just
// collects a display name (and even that's optional; we fall back to the
// signed-in profile name or a randomly generated one so the zero-input
// path works).
export async function quickMatchAction(formData: FormData) {
  await ensureAnonSession();

  const supabase = await createSupabaseServerClient();

  // Resolution order: shared-name field → signed-in profile → random.
  // The home page omits the hidden displayName entirely when the visitor
  // is signed in, so we fall through to the profile lookup in that case.
  const raw = String(formData.get("displayName") ?? "").trim();
  let displayName: string;
  if (raw.length > 0) {
    displayName = raw;
  } else {
    const profile = await getCurrentProfile(supabase);
    displayName = profile?.display_name?.trim() || randomDisplayName();
  }

  const { data, error } = await supabase.rpc("find_or_create_quick_match", {
    p_display_name: displayName,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("find_or_create_quick_match returned no row");

  redirect(`/play/${row.new_code}`);
}
