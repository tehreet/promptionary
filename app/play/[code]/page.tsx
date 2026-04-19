import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAnonSession } from "@/app/actions/auth";
import { LobbyClient } from "./lobby-client";
import { GameClient } from "./game-client";
import { JoinInline } from "./join-inline";

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
    .select(
      "id, code, phase, host_id, mode, teams_enabled, pack, max_rounds, guess_seconds, reveal_seconds, round_num, phase_ends_at, blitz",
    )
    .eq("code", code)
    .maybeSingle();

  if (error || !room) notFound();

  const { data: members } = await supabase
    .from("room_players")
    .select("player_id, display_name, is_host, is_spectator, score, team")
    .eq("room_id", room.id);

  const me = members?.find((m) => m.player_id === user.id);
  if (!me) {
    return <JoinInline code={code} asSpectator={room.phase !== "lobby"} />;
  }

  if (room.phase === "lobby") {
    return (
      <LobbyClient
        room={room}
        initialPlayers={members ?? []}
        currentPlayerId={user.id}
      />
    );
  }

  return (
    <GameClient
      room={room}
      players={members ?? []}
      currentPlayerId={user.id}
      isSpectator={me.is_spectator}
    />
  );
}
