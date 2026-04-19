import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAnonSession } from "@/app/actions/auth";
import { LobbyClient } from "./lobby-client";

export default async function LobbyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) notFound();

  const user = await ensureAnonSession();

  const supabase = await createSupabaseServerClient();
  const { data: room, error } = await supabase
    .from("rooms")
    .select("id, code, phase, host_id, max_rounds, guess_seconds, round_num")
    .eq("code", code)
    .maybeSingle();

  if (error || !room) notFound();

  const { data: members } = await supabase
    .from("room_players")
    .select("player_id, display_name, is_host, score")
    .eq("room_id", room.id);

  const isMember = members?.some((m) => m.player_id === user.id);
  if (!isMember) {
    redirect(`/?join=${code}`);
  }

  return (
    <LobbyClient
      room={room}
      initialPlayers={members ?? []}
      currentPlayerId={user.id}
    />
  );
}
