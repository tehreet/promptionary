"use client";
import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env";

// @supabase/ssr's browser client has a getSession hang that blocks every
// database call (no HTTP request, just stuck in the storage layer). Use
// the vanilla @supabase/supabase-js client for data/realtime reads +
// writes and bridge the session from middleware-set cookies by hand.
const AUTH_COOKIE = `sb-${getProjectRef()}-auth-token`;

function getProjectRef(): string {
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  return url.replace(/^https?:\/\//, "").split(".")[0];
}

export function readAuthAccessToken(): string | null {
  return readAuthCookie()?.access_token ?? null;
}

function readAuthCookie(): { access_token?: string; refresh_token?: string } | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";");
  // Supabase may split long JWT cookies into .0 / .1 / etc. in base64-prefix
  // form. Concatenate all chunks matching the base cookie name.
  const matches = parts
    .map((c) => c.trim())
    .filter((c) => c.startsWith(`${AUTH_COOKIE}`))
    .sort();
  if (matches.length === 0) return null;
  let raw = matches
    .map((entry) => decodeURIComponent(entry.split("=").slice(1).join("=")))
    .join("");
  if (raw.startsWith("base64-")) {
    try {
      raw = atob(raw.slice("base64-".length));
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Singleton per browser context. Constructing a new SupabaseClient also
// constructs a new GoTrueClient that listens on the shared auth-token
// storage key — multiple instances trigger Supabase's "Multiple
// GoTrueClient instances detected" warning and pile up listeners. The
// factory name is preserved so existing call sites work unchanged, but it
// now returns the cached singleton.
let cachedDataClient: SupabaseClient | null = null;
let cachedAuthClient: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient(): SupabaseClient {
  if (cachedDataClient) return cachedDataClient;
  const client = createClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const session = readAuthCookie();
  if (session?.access_token) {
    // setSession is async; the realtime transport won't know about the JWT
    // until it resolves. Pushing the token directly to realtime.setAuth
    // synchronously avoids a race where channel.subscribe() connects
    // anonymously and then silently fails on anything that needs auth.
    client.realtime.setAuth(session.access_token);
    client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token ?? "",
    });
  }
  cachedDataClient = client;
  return client;
}

// Separate export for auth-specific flows (sign-in, sign-out, callback)
// that really do need the SSR cookie-writer. Those flows go through
// server actions / route handlers where this hang hasn't reproduced.
export function createSupabaseAuthBrowserClient() {
  if (cachedAuthClient) return cachedAuthClient;
  cachedAuthClient = createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return cachedAuthClient;
}
