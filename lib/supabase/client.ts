"use client";
import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
