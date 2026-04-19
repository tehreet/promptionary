import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    serverEnv!.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv!.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookies) => {
          try {
            cookies.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a server component — ignore
          }
        },
      },
    },
  );
}

export function createSupabaseServiceClient() {
  return createServerClient(
    serverEnv!.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv!.SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: { getAll: () => [], setAll: () => {} },
    },
  );
}
