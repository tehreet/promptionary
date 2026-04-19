import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ensureDailyPuzzle, todayUtcDate } from "@/lib/daily";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel cron sets `Authorization: Bearer ${CRON_SECRET}` on scheduled calls.
// Accept either CRON_SECRET (Vercel platform convention) or manual trigger
// from an authorized operator via the same header.
export async function GET(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  if (header !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createSupabaseServiceClient();
  try {
    const row = await ensureDailyPuzzle(svc, todayUtcDate());
    return NextResponse.json({ ok: true, date: row.date });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
