"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { ensureAnonSession } from "./auth";

// Extract a plausible client IP from proxy headers. Vercel sets
// x-forwarded-for with the originating client at position 0. Fallbacks cover
// other deployments / local dev. Returns null if we can't figure it out —
// the RPC treats null as "allow" so we never hard-fail on missing headers.
async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") ?? h.get("cf-connecting-ip") ?? null;
}

// One-click create. The home-page form only collects the display name —
// mode / pack / timing all move to the host-only lobby settings panel.
export async function createRoomAction(formData: FormData) {
  await ensureAnonSession();
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) throw new Error("display name required");

  // Rate limit by IP: 5 rooms / hour. The RPC logs the attempt atomically
  // and returns false when the caller is over the limit. Service-role only,
  // so we skip the types.ts typing (regen will happen after db push).
  const ip = await getClientIp();
  const service = createSupabaseServiceClient();
  const { data: allowed, error: limitError } = await (
    service.rpc as unknown as (
      fn: string,
      args: { p_ip: string | null },
    ) => Promise<{ data: boolean | null; error: unknown }>
  )("check_and_log_room_creation", { p_ip: ip });
  if (limitError) throw limitError;
  if (allowed === false) {
    throw new Error(
      "Slow down — you're creating rooms too fast. Try again in an hour.",
    );
  }

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
