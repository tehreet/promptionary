"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { colorForPlayer } from "@/lib/player";
import { leaveRoomAction } from "@/app/actions/leave-room";
import { InviteCard } from "./invite-card";
import { RoomChannelProvider } from "@/lib/room-channel";
import { ChatPanel } from "@/components/chat-panel";
import { HostControls } from "@/components/host-controls";
import { PACK_LABELS, type PackId } from "@/lib/prompt-dimensions";

type Room = {
  id: string;
  code: string;
  phase: string;
  host_id: string;
  mode?: string;
  pack?: PackId;
  max_rounds: number;
  guess_seconds: number;
  round_num: number;
};

type Player = {
  player_id: string;
  display_name: string;
  is_host: boolean;
  score: number;
};

export function LobbyClient(props: {
  room: Room;
  initialPlayers: Player[];
  currentPlayerId: string;
}) {
  const me = props.initialPlayers.find(
    (p) => p.player_id === props.currentPlayerId,
  );
  const playerCtx = useMemo(
    () => ({
      id: props.currentPlayerId,
      name: me?.display_name ?? "You",
      color: colorForPlayer(props.currentPlayerId),
    }),
    [props.currentPlayerId, me?.display_name],
  );
  return (
    <RoomChannelProvider roomId={props.room.id} player={playerCtx}>
      <LobbyClientInner {...props} />
    </RoomChannelProvider>
  );
}

function LobbyClientInner({
  room,
  initialPlayers,
  currentPlayerId,
}: {
  room: Room;
  initialPlayers: Player[];
  currentPlayerId: string;
}) {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [phase, setPhase] = useState(room.phase);
  const [hostId, setHostId] = useState(room.host_id);
  const [isPending, startTransition] = useTransition();
  const [starting, setStarting] = useState(false);
  const isHost = hostId === currentPlayerId;

  useEffect(() => {
    if (phase !== "lobby") router.refresh();
  }, [phase, router]);

  // If I get kicked, bounce me back to the home page.
  useEffect(() => {
    if (players.length === 0) return;
    const stillHere = players.some((p) => p.player_id === currentPlayerId);
    if (!stillHere) router.replace("/");
  }, [players, currentPlayerId, router]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel(`room-${room.id}-players`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_players",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          setPlayers((prev) => {
            if (payload.eventType === "INSERT") {
              const next = payload.new as Player;
              if (prev.some((p) => p.player_id === next.player_id)) return prev;
              return [...prev, next];
            }
            if (payload.eventType === "UPDATE") {
              const next = payload.new as Player;
              return prev.map((p) =>
                p.player_id === next.player_id ? { ...p, ...next } : p,
              );
            }
            if (payload.eventType === "DELETE") {
              const gone = payload.old as Partial<Player>;
              return prev.filter((p) => p.player_id !== gone.player_id);
            }
            return prev;
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          const next = payload.new as { phase: string; host_id: string };
          setPhase(next.phase);
          if (next.host_id) setHostId(next.host_id);
        },
      )
      .subscribe();

    // Poll fallback — realtime events aren't always delivered promptly on
    // Supabase's current Postgres Changes path for RLS-gated tables, so we
    // backstop with a 2s poll.
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from("room_players")
        .select("player_id, display_name, is_host, score")
        .eq("room_id", room.id);
      if (data) setPlayers(data as Player[]);
      const { data: r } = await supabase
        .from("rooms")
        .select("phase, host_id")
        .eq("id", room.id)
        .maybeSingle();
      if (r?.phase) setPhase(r.phase);
      if (r?.host_id) setHostId(r.host_id);
    }, 2000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [room.id]);

  async function handleStart() {
    setStarting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("start_round", { p_room_id: room.id });
      if (error) throw error;
    } catch (e) {
      alert(e instanceof Error ? e.message : "failed to start");
      setStarting(false);
    }
  }

  return (
    <main className="min-h-screen promptionary-gradient promptionary-grain flex flex-col items-center gap-8 px-6 py-12">
      <header className="text-center space-y-2">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">
          Room code
        </p>
        <h1 className="text-hero text-5xl sm:text-7xl font-mono tracking-[0.25em] sm:tracking-[0.3em]">
          {room.code}
        </h1>
        <p className="text-muted-foreground text-sm">
          Share this code or the link below to let friends in.
        </p>
      </header>

      <InviteCard code={room.code} />

      {room.mode !== "artist" && room.pack && (
        <div
          data-pack={room.pack}
          className="inline-flex items-center gap-2 rounded-full bg-card border border-border px-4 py-1.5 shadow-sm text-sm"
        >
          <span className="text-base leading-none">
            {PACK_LABELS[room.pack].emoji}
          </span>
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Pack
          </span>
          <span className="font-bold">{PACK_LABELS[room.pack].title}</span>
        </div>
      )}

      <section className="w-full max-w-2xl space-y-3">
        <h2 className="text-lg font-heading font-black text-foreground/80">
          Players ({players.length})
        </h2>
        <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {players.map((p) => (
            <li
              key={p.player_id}
              className="rounded-2xl px-4 py-3 bg-card border border-border flex items-center gap-3 shadow-sm"
            >
              <span
                className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-black font-black"
                style={{ background: colorForPlayer(p.player_id) }}
              >
                {p.display_name[0]?.toUpperCase()}
              </span>
              <span className="font-semibold truncate">{p.display_name}</span>
              {p.is_host && (
                <span className="ml-auto text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                  host
                </span>
              )}
              {isHost && p.player_id !== currentPlayerId && (
                <HostControls
                  roomId={room.id}
                  victimId={p.player_id}
                  victimName={p.display_name}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      {phase === "lobby" && (
        <div className="flex gap-3 flex-wrap justify-center">
          {isHost && (
            <Button
              onClick={handleStart}
              disabled={players.length < 2 || starting}
              className="font-bold text-lg px-8 py-6 rounded-2xl"
            >
              {starting ? "Starting…" : `Start game (${players.length}/2+)`}
            </Button>
          )}
          <Button
            onClick={() =>
              startTransition(() => {
                leaveRoomAction(room.id);
              })
            }
            disabled={isPending}
            variant="outline"
            className="rounded-2xl px-6"
          >
            Leave
          </Button>
        </div>
      )}

      {phase !== "lobby" && (
        <div className="text-center text-2xl font-heading font-black opacity-90">
          Game in progress — phase: {phase}
        </div>
      )}

      <div className="w-full max-w-md">
        <ChatPanel roomPhase={phase} isSpectator={false} variant="inline" />
      </div>
    </main>
  );
}
