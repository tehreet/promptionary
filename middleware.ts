import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { serverEnv } from "@/lib/env";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    serverEnv!.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv!.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  // First-time visitors (no session cookie) get signed in here. Doing this
  // in middleware — not a server component — is what lets the cookie
  // actually make it to the browser. Server components can't set cookies.
  if (!user) {
    await supabase.auth.signInAnonymously();
  }

  return response;
}

export const config = {
  matcher: [
    // Skip static assets + the auth callback route. Middleware auto-creates
    // an anon session when no user is present, which would race with the
    // OAuth / magic-link code exchange happening in /auth/callback.
    "/((?!auth/callback|_next/static|_next/image|favicon.ico|opengraph-image|twitter-image|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
