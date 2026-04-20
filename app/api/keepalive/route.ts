import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Lightweight endpoint whose only job is to pass through middleware. Middleware
// calls supabase.auth.getUser(), which the SSR helper uses to rotate the session
// cookie when the JWT is near expiry. The client pings this on a timer so a long-
// idle tab keeps its realtime socket auth fresh before the 1h JWT TTL lapses.
export async function GET() {
  return NextResponse.json({ ok: true });
}
