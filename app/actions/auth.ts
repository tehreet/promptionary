"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function ensureAnonSession() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user!;
}
