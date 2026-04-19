"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { colorForPlayer } from "@/lib/player";
import { leaveRoomAction } from "@/app/actions/leave-room";
import { InviteCard } from "./invite-card";

type Room = {
  id: string;
  code: string;
  phase: string;
  host_id: string;
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

export function LobbyClient({
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
  const [isPending, startTransition] = useTransition();
  const [starting, setStarting] = useState(false);
  const isHost = room.host_id === currentPlayerId;

  useEffect(() => {
    if (phase !== "lobby") router.refresh();
  }, [phase, router]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const playersChannel = supabase
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
      .subscribe();

    const roomChannel = supabase
      .channel(`room-${room.id}-state`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          const next = payload.new as { phase: string };
          setPhase(next.phase);
        },
      )
      .subscribe();

    // Poll every 2s as a fallback in case the Postgres Changes stream lags or
    // drops events. Cheap and bounded (one small query).
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from("room_players")
        .select("player_id, display_name, is_host, score")
        .eq("room_id", room.id);
      if (data) setPlayers(data as Player[]);
      const { data: r } = await supabase
        .from("rooms")
        .select("phase")
        .eq("id", room.id)
        .maybeSingle();
      if (r?.phase) setPhase(r.phase);
    }, 2000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(playersChannel);
      supabase.removeChannel(roomChannel);
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
    </main>
  );
}
