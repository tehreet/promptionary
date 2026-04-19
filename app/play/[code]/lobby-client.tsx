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
  teams_enabled?: boolean;
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
  team?: number | null;
};

const TEAM_META: Record<1 | 2, { label: string; color: string; bg: string }> = {
  1: {
    label: "Team 1",
    color: "var(--game-pink)",
    bg: "color-mix(in oklab, var(--game-pink) 22%, var(--game-paper))",
  },
  2: {
    label: "Team 2",
    color: "var(--game-cyan)",
    bg: "color-mix(in oklab, var(--game-cyan) 22%, var(--game-paper))",
  },
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
  const [teamsOn, setTeamsOn] = useState(!!room.teams_enabled);
  const [teamsBusy, setTeamsBusy] = useState(false);
  const isHost = hostId === currentPlayerId;

  useEffect(() => {
    if (phase !== "lobby") router.refresh();
  }, [phase, router]);

  // If I get kicked, bounce me back to the home page. After a kick, RLS hides
  // the whole room from us so the poll returns [] — the empty-guard we used
  // to have here would swallow exactly that signal. The server component
  // already verified we were a member, so `initialPlayers` always contains
  // us; any state where it doesn't means we were removed.
  useEffect(() => {
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
          const next = payload.new as {
            phase: string;
            host_id: string;
            teams_enabled?: boolean;
          };
          setPhase(next.phase);
          if (next.host_id) setHostId(next.host_id);
          if (typeof next.teams_enabled === "boolean") setTeamsOn(next.teams_enabled);
        },
      )
      .subscribe();

    // Poll fallback — realtime events aren't always delivered promptly on
    // Supabase's current Postgres Changes path for RLS-gated tables, so we
    // backstop with a 2s poll.
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from("room_players")
        .select("player_id, display_name, is_host, score, team")
        .eq("room_id", room.id);
      if (data) setPlayers(data as Player[]);
      const { data: r } = await supabase
        .from("rooms")
        .select("phase, host_id, teams_enabled")
        .eq("id", room.id)
        .maybeSingle();
      if (r?.phase) setPhase(r.phase);
      if (r?.host_id) setHostId(r.host_id);
      if (typeof r?.teams_enabled === "boolean") setTeamsOn(r.teams_enabled);
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

  async function handleToggleTeams(nextOn: boolean) {
    setTeamsBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("set_teams_enabled", {
        p_room_id: room.id,
        p_enabled: nextOn,
      });
      if (error) throw error;
      setTeamsOn(nextOn);
    } catch (e) {
      alert(e instanceof Error ? e.message : "failed to toggle teams");
    } finally {
      setTeamsBusy(false);
    }
  }

  async function handleAutoBalance() {
    setTeamsBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("auto_balance_teams", {
        p_room_id: room.id,
      });
      if (error) throw error;
    } catch (e) {
      alert(e instanceof Error ? e.message : "failed to auto-balance");
    } finally {
      setTeamsBusy(false);
    }
  }

  async function handleSwapTeam(playerId: string, currentTeam: number | null) {
    const nextTeam = currentTeam === 1 ? 2 : 1;
    const supabase = createSupabaseBrowserClient();
    const prev = players;
    setPlayers((list) =>
      list.map((p) =>
        p.player_id === playerId ? { ...p, team: nextTeam } : p,
      ),
    );
    const { error } = await supabase.rpc("set_player_team", {
      p_room_id: room.id,
      p_player_id: playerId,
      p_team: nextTeam,
    });
    if (error) {
      setPlayers(prev);
      alert(error.message);
    }
  }

  const teamPlayers = (t: 1 | 2) => players.filter((p) => p.team === t);
  const unassignedPlayers = players.filter((p) => p.team == null);

  return (
    <main className="game-canvas min-h-screen flex flex-col items-center gap-8 px-6 py-12">
      <header className="text-center space-y-3">
        <p className="text-sm uppercase tracking-widest text-[var(--game-ink)]/70">
          Room code
        </p>
        <h1 className="game-hero text-5xl sm:text-7xl font-mono tracking-[0.25em] sm:tracking-[0.3em]">
          <span className="game-hero-mark">{room.code}</span>
        </h1>
        <p className="text-[var(--game-ink)]/70 text-sm">
          Share this code or the link below to let friends in.
        </p>
      </header>

      <InviteCard code={room.code} />

      {room.mode !== "artist" && room.pack && (
        <div
          data-pack={room.pack}
          className="sticker inline-flex items-center gap-2"
          style={
            {
              ["--sticker-tilt" as string]: "-2deg",
              background: "var(--game-cyan)",
            } as React.CSSProperties
          }
        >
          <span className="text-base leading-none">
            {PACK_LABELS[room.pack].emoji}
          </span>
          <span className="text-[10px] uppercase tracking-widest opacity-70">
            Pack
          </span>
          <span className="font-bold">{PACK_LABELS[room.pack].title}</span>
        </div>
      )}

      {isHost && phase === "lobby" && (
        <div
          data-teams-controls="1"
          className="game-card bg-[var(--game-paper)] w-full max-w-2xl flex flex-wrap items-center justify-center gap-3 px-4 py-3"
        >
          <label className="inline-flex items-center gap-2 text-sm font-semibold cursor-pointer select-none">
            <input
              type="checkbox"
              data-teams-toggle="1"
              checked={teamsOn}
              disabled={teamsBusy}
              onChange={(e) => handleToggleTeams(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Teams mode
          </label>
          <span className="text-xs text-[var(--game-ink)]/70">
            2 teams, score = average of teammates' guess totals.
          </span>
          {teamsOn && (
            <Button
              type="button"
              variant="outline"
              disabled={teamsBusy}
              onClick={handleAutoBalance}
              data-auto-balance="1"
              className="rounded-full h-8 px-4 text-xs font-bold"
            >
              Auto-balance
            </Button>
          )}
        </div>
      )}

      {teamsOn ? (
        <section className="w-full max-w-3xl space-y-4">
          <h2 className="text-lg font-heading font-black text-[var(--game-ink)]/80 text-center">
            Teams ({players.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {([1, 2] as const).map((t) => (
              <div
                key={t}
                data-team={t}
                className="game-card p-4 space-y-2"
                style={{
                  background: TEAM_META[t].bg,
                }}
              >
                <p
                  className="text-xs font-black uppercase tracking-widest"
                  style={{ color: TEAM_META[t].color }}
                >
                  {TEAM_META[t].label} · {teamPlayers(t).length}
                </p>
                {teamPlayers(t).length === 0 && (
                  <p className="text-xs text-[var(--game-ink)]/60 italic">
                    No players yet.
                  </p>
                )}
                <ul className="space-y-3">
                  {teamPlayers(t).map((p, i) => (
                    <li
                      key={p.player_id}
                      className="game-card flex items-center gap-3 px-3 py-2 bg-[var(--game-paper)]"
                      style={{
                        transform: `rotate(${i % 2 === 0 ? -0.8 : 0.8}deg)`,
                      }}
                    >
                      <span
                        className="player-chip w-8 h-8 text-xs"
                        style={
                          {
                            ["--chip-color" as string]: colorForPlayer(
                              p.player_id,
                            ),
                          } as React.CSSProperties
                        }
                      >
                        {p.display_name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="font-heading font-bold truncate flex-1">
                        {p.display_name}
                      </span>
                      {p.is_host && (
                        <span
                          className="sticker text-[10px]"
                          style={
                            {
                              ["--sticker-tilt" as string]: "2deg",
                              background: "var(--game-canvas-yellow)",
                            } as React.CSSProperties
                          }
                        >
                          host
                        </span>
                      )}
                      {isHost && (
                        <button
                          type="button"
                          data-swap-team="1"
                          onClick={() =>
                            handleSwapTeam(p.player_id, p.team ?? null)
                          }
                          aria-label="Swap team"
                          className="game-card w-7 h-7 flex items-center justify-center rounded-full text-xs bg-[var(--game-cyan)]"
                        >
                          ⇄
                        </button>
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
              </div>
            ))}
          </div>
          {unassignedPlayers.length > 0 && (
            <div className="game-card p-4 space-y-2 bg-[var(--game-paper)]">
              <p className="text-xs font-black uppercase tracking-widest text-[var(--game-ink)]/70">
                Unassigned · {unassignedPlayers.length}
              </p>
              <ul className="flex flex-wrap gap-2">
                {unassignedPlayers.map((p, i) => (
                  <li
                    key={p.player_id}
                    className="sticker flex items-center gap-2"
                    style={
                      {
                        ["--sticker-tilt" as string]: `${
                          i % 2 === 0 ? -2 : 2
                        }deg`,
                      } as React.CSSProperties
                    }
                  >
                    <span className="font-semibold">{p.display_name}</span>
                    {isHost && (
                      <button
                        type="button"
                        onClick={() => handleSwapTeam(p.player_id, null)}
                        className="text-[10px] font-bold rounded-full px-2 py-0.5 border-2 border-[var(--game-ink)] bg-[var(--game-canvas-yellow)]"
                      >
                        Assign
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <section className="w-full max-w-2xl space-y-3">
          <h2 className="text-lg font-heading font-black text-[var(--game-ink)]/80">
            Players ({players.length})
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {players.map((p, i) => (
              <li
                key={p.player_id}
                className="game-card flex items-center gap-3 px-4 py-3 bg-[var(--game-paper)]"
                style={{
                  transform: `rotate(${i % 2 === 0 ? -0.8 : 0.8}deg)`,
                }}
              >
                <span
                  className="player-chip w-10 h-10 text-sm"
                  style={
                    {
                      ["--chip-color" as string]: colorForPlayer(p.player_id),
                    } as React.CSSProperties
                  }
                >
                  {p.display_name.slice(0, 2).toUpperCase()}
                </span>
                <span className="font-heading font-bold flex-1 truncate">
                  {p.display_name}
                </span>
                {p.is_host && (
                  <span
                    className="sticker text-[10px]"
                    style={
                      {
                        ["--sticker-tilt" as string]: "2deg",
                        background: "var(--game-canvas-yellow)",
                      } as React.CSSProperties
                    }
                  >
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
      )}

      {phase === "lobby" && (
        <div className="flex gap-3 flex-wrap justify-center w-full max-w-md">
          {isHost && (() => {
            const teamsIncomplete =
              teamsOn &&
              (teamPlayers(1).length === 0 ||
                teamPlayers(2).length === 0 ||
                unassignedPlayers.length > 0);
            const disabled = players.length < 2 || starting || teamsIncomplete;
            const ariaLabel = starting
              ? "Starting"
              : teamsIncomplete
                ? "Assign every player to a team"
                : `Start game (${players.length}/2+)`;
            const visibleLabel = starting
              ? "Starting…"
              : teamsIncomplete
                ? "Assign every player to a team"
                : `Start →`;
            return (
              <Button
                onClick={handleStart}
                disabled={disabled}
                aria-label={ariaLabel}
                className="flex-1 h-12 font-bold text-lg"
              >
                {visibleLabel}
              </Button>
            );
          })()}
          <Button
            onClick={() =>
              startTransition(() => {
                leaveRoomAction(room.id);
              })
            }
            disabled={isPending}
            variant="outline"
            className="h-12 px-6"
          >
            Leave
          </Button>
        </div>
      )}

      {phase !== "lobby" && (
        <div className="text-center text-2xl font-heading font-black text-[var(--game-ink)]">
          Game in progress — phase: {phase}
        </div>
      )}

      <div className="w-full max-w-md">
        <ChatPanel roomPhase={phase} isSpectator={false} variant="inline" />
      </div>
    </main>
  );
}
