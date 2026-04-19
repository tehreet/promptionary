import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const userClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: "unauthed" }, { status: 401 });
  }
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("passkeys")
    .select(
      "id, label, device_type, backed_up, created_at, last_used_at, transports",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  return NextResponse.json({ passkeys: data ?? [] });
}

export async function DELETE(req: Request) {
  const userClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: "unauthed" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const svc = createSupabaseServiceClient();
  const { error } = await svc
    .from("passkeys")
    .delete()
    .eq("id", body.id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
