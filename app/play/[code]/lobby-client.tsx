"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { chipColorsForPlayer, colorForPlayer } from "@/lib/player";
import { leaveRoomAction } from "@/app/actions/leave-room";
import { InviteCard } from "./invite-card";
import { RoomChannelProvider } from "@/lib/room-channel";
import { ChatPanel } from "@/components/chat-panel";
import { HostControls } from "@/components/host-controls";
import { PACK_IDS, PACK_LABELS, type PackId } from "@/lib/prompt-dimensions";

type RoomMode = "party" | "artist";

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
  reveal_seconds: number;
  round_num: number;
  blitz?: boolean;
  is_public?: boolean;
  taboo_enabled?: boolean;
};

type Player = {
  player_id: string;
  display_name: string;
  is_host: boolean;
  is_spectator?: boolean;
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

// Drop-zone targets for drag-and-drop team / spectator assignment.
type DropZone = "team-1" | "team-2" | "spectators" | "unassigned";

// Native HTML5 DnD mime type we stuff the player_id into.
const DND_PLAYER_MIME = "application/x-promptionary-player";

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
  const [mode, setMode] = useState<RoomMode>(
    room.mode === "artist" ? "artist" : "party",
  );
  const [pack, setPack] = useState<PackId>(room.pack ?? "mixed");
  const [maxRounds, setMaxRounds] = useState<number>(room.max_rounds);
  const [guessSeconds, setGuessSeconds] = useState<number>(room.guess_seconds);
  const [revealSeconds, setRevealSeconds] = useState<number>(
    room.reveal_seconds,
  );
  const [blitzOn, setBlitzOn] = useState<boolean>(!!room.blitz);
  const [tabooOn, setTabooOn] = useState<boolean>(!!room.taboo_enabled);
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
            mode?: string;
            pack?: PackId;
            max_rounds?: number;
            guess_seconds?: number;
            reveal_seconds?: number;
            blitz?: boolean;
            taboo_enabled?: boolean;
          };
          setPhase(next.phase);
          if (next.host_id) setHostId(next.host_id);
          if (typeof next.teams_enabled === "boolean") setTeamsOn(next.teams_enabled);
          if (next.mode === "artist" || next.mode === "party") setMode(next.mode);
          if (next.pack) setPack(next.pack);
          if (typeof next.max_rounds === "number") setMaxRounds(next.max_rounds);
          if (typeof next.guess_seconds === "number") setGuessSeconds(next.guess_seconds);
          if (typeof next.reveal_seconds === "number") setRevealSeconds(next.reveal_seconds);
          if (typeof next.blitz === "boolean") setBlitzOn(next.blitz);
          if (typeof next.taboo_enabled === "boolean") setTabooOn(next.taboo_enabled);
        },
      )
      .subscribe();

    // Poll fallback — realtime events aren't always delivered promptly on
    // Supabase's current Postgres Changes path for RLS-gated tables, so we
    // backstop with a 2s poll.
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from("room_players")
        .select("player_id, display_name, is_host, is_spectator, score, team")
        .eq("room_id", room.id);
      if (data) setPlayers(data as Player[]);
      const { data: r } = await supabase
        .from("rooms")
        .select(
          "phase, host_id, teams_enabled, mode, pack, max_rounds, guess_seconds, reveal_seconds, blitz, taboo_enabled",
        )
        .eq("id", room.id)
        .maybeSingle();
      if (r?.phase) setPhase(r.phase);
      if (r?.host_id) setHostId(r.host_id);
      if (typeof r?.teams_enabled === "boolean") setTeamsOn(r.teams_enabled);
      if (r?.mode === "artist" || r?.mode === "party") setMode(r.mode);
      if (r?.pack) setPack(r.pack as PackId);
      if (typeof r?.max_rounds === "number") setMaxRounds(r.max_rounds);
      if (typeof r?.guess_seconds === "number") setGuessSeconds(r.guess_seconds);
      if (typeof r?.reveal_seconds === "number") setRevealSeconds(r.reveal_seconds);
      if (typeof r?.blitz === "boolean") setBlitzOn(r.blitz);
      if (typeof r?.taboo_enabled === "boolean") setTabooOn(r.taboo_enabled);
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
      const { data: newRoundId, error } = await supabase.rpc("start_round", {
        p_room_id: room.id,
      });
      if (error) throw error;
      // Seed taboo words if this is an artist round with taboo_enabled. Fire-
      // and-forget — the artist UI will fetch the round a moment later and
      // pick up the words via the poll / rounds_public. Any failure here is
      // non-fatal; the round just runs without taboo.
      if (
        tabooOn &&
        mode === "artist" &&
        typeof newRoundId === "string"
      ) {
        fetch("/api/seed-taboo-words", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ round_id: newRoundId }),
        }).catch(() => {});
      }
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

  async function applySettings(
    patch: Partial<{
      p_mode: RoomMode;
      p_pack: PackId;
      p_max_rounds: number;
      p_guess_seconds: number;
      p_reveal_seconds: number;
      p_blitz: boolean;
      p_taboo_enabled: boolean;
    }>,
  ) {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc("update_room_settings", {
      p_room_id: room.id,
      ...patch,
    });
    if (error) throw error;
  }

  async function handleSetMode(next: RoomMode) {
    const prev = mode;
    setMode(next);
    try {
      await applySettings({ p_mode: next });
    } catch (e) {
      setMode(prev);
      alert(e instanceof Error ? e.message : "failed to change mode");
    }
  }

  async function handleSetPack(next: PackId) {
    const prev = pack;
    setPack(next);
    try {
      await applySettings({ p_pack: next });
    } catch (e) {
      setPack(prev);
      alert(e instanceof Error ? e.message : "failed to change pack");
    }
  }

  // Blitz toggle. When enabling and the guess timer is still at the default
  // 45s, nudge it down to 22 so the variant actually feels like blitz. We
  // don't stomp custom values — if the host already picked something else
  // they keep it. Both settings go in a single RPC call.
  async function handleSetBlitz(next: boolean) {
    const prev = blitzOn;
    const prevGuess = guessSeconds;
    const shouldNudge = next && guessSeconds === 45;
    const nextGuess = shouldNudge ? 22 : guessSeconds;
    setBlitzOn(next);
    if (shouldNudge) setGuessSeconds(nextGuess);
    try {
      await applySettings(
        shouldNudge
          ? { p_blitz: next, p_guess_seconds: nextGuess }
          : { p_blitz: next },
      );
    } catch (e) {
      setBlitzOn(prev);
      if (shouldNudge) setGuessSeconds(prevGuess);
      alert(e instanceof Error ? e.message : "failed to toggle blitz");
    }
  }

  async function handleSetTaboo(next: boolean) {
    const prev = tabooOn;
    setTabooOn(next);
    try {
      await applySettings({ p_taboo_enabled: next });
    } catch (e) {
      setTabooOn(prev);
      alert(e instanceof Error ? e.message : "failed to toggle taboo");
    }
  }

  function clampAndSave(
    field: "max_rounds" | "guess_seconds" | "reveal_seconds",
    raw: string,
  ) {
    const bounds = {
      max_rounds: { min: 1, max: 20, setter: setMaxRounds, prev: maxRounds, arg: "p_max_rounds" as const },
      guess_seconds: { min: 15, max: 120, setter: setGuessSeconds, prev: guessSeconds, arg: "p_guess_seconds" as const },
      reveal_seconds: { min: 5, max: 30, setter: setRevealSeconds, prev: revealSeconds, arg: "p_reveal_seconds" as const },
    }[field];
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      bounds.setter(bounds.prev);
      return;
    }
    const next = Math.min(bounds.max, Math.max(bounds.min, Math.trunc(parsed)));
    bounds.setter(next);
    if (next === bounds.prev) return;
    applySettings({ [bounds.arg]: next } as Partial<Parameters<typeof applySettings>[0]>).catch(
      (e) => {
        bounds.setter(bounds.prev);
        alert(e instanceof Error ? e.message : "failed to update setting");
      },
    );
  }

  async function handleSwapTeam(playerId: string, currentTeam: number | null) {
    const nextTeam = currentTeam === 1 ? 2 : 1;
    await movePlayer(playerId, nextTeam === 1 ? "team-1" : "team-2");
  }

  // Drop-target state for visual highlight while dragging.
  const [dragOver, setDragOver] = useState<DropZone | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Single source of truth for "where did this player get dropped." Applies
  // an optimistic update, fires the matching RPC, rolls back on error.
  async function movePlayer(playerId: string, zone: DropZone) {
    if (!isHost) return;
    const victim = players.find((p) => p.player_id === playerId);
    if (!victim) return;

    // Self-demote guard matches the server — no point in a round-trip that's
    // guaranteed to fail.
    if (zone === "spectators" && playerId === hostId) {
      alert("Host can't become a spectator. Transfer host first.");
      return;
    }

    // No-op if the drop target matches current state.
    const currentZone: DropZone = victim.is_spectator
      ? "spectators"
      : victim.team === 1
        ? "team-1"
        : victim.team === 2
          ? "team-2"
          : "unassigned";
    if (currentZone === zone) return;

    const prev = players;
    setPlayers((list) =>
      list.map((p) => {
        if (p.player_id !== playerId) return p;
        switch (zone) {
          case "team-1":
            return { ...p, team: 1, is_spectator: false };
          case "team-2":
            return { ...p, team: 2, is_spectator: false };
          case "spectators":
            return { ...p, team: null, is_spectator: true };
          case "unassigned":
            return { ...p, team: null, is_spectator: false };
        }
      }),
    );

    const supabase = createSupabaseBrowserClient();
    try {
      // If crossing the spectator boundary we always need set_player_spectator
      // first (it also clears team on promote), then optionally set_player_team
      // for the team-1 / team-2 cases.
      const wasSpectator = victim.is_spectator === true;
      if (zone === "spectators") {
        const { error } = await supabase.rpc("set_player_spectator", {
          p_room_id: room.id,
          p_player_id: playerId,
          p_is_spectator: true,
        });
        if (error) throw error;
        return;
      }

      if (wasSpectator) {
        const { error } = await supabase.rpc("set_player_spectator", {
          p_room_id: room.id,
          p_player_id: playerId,
          p_is_spectator: false,
        });
        if (error) throw error;
      }

      // Teams need teams_enabled. If it's off, the team-1 / team-2 zones
      // shouldn't be visible — but guard anyway.
      if (zone === "team-1" || zone === "team-2") {
        if (!teamsOn) return;
        const { error } = await supabase.rpc("set_player_team", {
          p_room_id: room.id,
          p_player_id: playerId,
          p_team: zone === "team-1" ? 1 : 2,
        });
        if (error) throw error;
      } else if (zone === "unassigned") {
        if (!teamsOn) return;
        // null → clear team; relies on updated set_player_team migration.
        const { error } = await supabase.rpc("set_player_team", {
          p_room_id: room.id,
          p_player_id: playerId,
          // set_player_team accepts null to clear in the updated migration;
          // the generated types insist on number so cast past them.
          p_team: null as unknown as number,
        });
        if (error) throw error;
      }
    } catch (e) {
      setPlayers(prev);
      alert(e instanceof Error ? e.message : "failed to move player");
    }
  }

  // Native DnD helpers. We stash the player_id twice — the custom mime type
  // takes precedence but we fall back to text/plain for browsers that strip
  // unknown types (older Safari).
  function onChipDragStart(e: React.DragEvent, playerId: string) {
    if (!isHost) return;
    e.dataTransfer.setData(DND_PLAYER_MIME, playerId);
    e.dataTransfer.setData("text/plain", playerId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(playerId);
  }
  function onChipDragEnd() {
    setDraggingId(null);
    setDragOver(null);
  }
  function onZoneDragOver(e: React.DragEvent, zone: DropZone) {
    if (!isHost) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver((cur) => (cur === zone ? cur : zone));
  }
  function onZoneDragLeave(zone: DropZone) {
    setDragOver((cur) => (cur === zone ? null : cur));
  }
  async function onZoneDrop(e: React.DragEvent, zone: DropZone) {
    e.preventDefault();
    setDragOver(null);
    setDraggingId(null);
    const playerId =
      e.dataTransfer.getData(DND_PLAYER_MIME) ||
      e.dataTransfer.getData("text/plain");
    if (!playerId) return;
    await movePlayer(playerId, zone);
  }

  const teamPlayers = (t: 1 | 2) =>
    players.filter((p) => p.team === t && !p.is_spectator);
  const unassignedPlayers = players.filter(
    (p) => p.team == null && !p.is_spectator,
  );
  const spectatorPlayers = players.filter((p) => p.is_spectator);

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

      {(mode !== "artist" && pack) || blitzOn || room.is_public ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {room.is_public && (
            // Tells drop-in joiners this is a matchmade (Quick Match) room,
            // not someone's private invite. Orange to match the Quick Match
            // tile on the landing page.
            <div
              data-public-lobby-badge="1"
              className="sticker inline-flex items-center gap-2"
              style={
                {
                  ["--sticker-tilt" as string]: "-3deg",
                  background: "var(--game-orange)",
                } as React.CSSProperties
              }
            >
              <span className="text-base leading-none">⚡</span>
              <span className="text-[10px] uppercase tracking-widest opacity-70">
                Matchmaking
              </span>
              <span className="font-bold">Public lobby</span>
            </div>
          )}
          {mode !== "artist" && pack && (
            <div
              data-pack={pack}
              className="sticker inline-flex items-center gap-2"
              style={
                {
                  ["--sticker-tilt" as string]: "-2deg",
                  background: "var(--game-cyan)",
                } as React.CSSProperties
              }
            >
              <span className="text-base leading-none">
                {PACK_LABELS[pack].emoji}
              </span>
              <span className="text-[10px] uppercase tracking-widest opacity-70">
                Pack
              </span>
              <span className="font-bold">{PACK_LABELS[pack].title}</span>
            </div>
          )}
          {blitzOn && (
            <div
              data-blitz-badge="1"
              className="sticker inline-flex items-center gap-2"
              style={
                {
                  ["--sticker-tilt" as string]: "2deg",
                  background: "var(--game-canvas-yellow)",
                } as React.CSSProperties
              }
            >
              <span className="text-base leading-none">⚡</span>
              <span className="text-[10px] uppercase tracking-widest opacity-70">
                Variant
              </span>
              <span className="font-bold">Blitz</span>
            </div>
          )}
        </div>
      ) : null}

      {isHost && phase === "lobby" && (
        <section
          data-room-settings="1"
          className="game-card bg-[var(--game-paper)] w-full max-w-2xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-heading font-black uppercase tracking-widest text-[var(--game-ink)]/80">
              Room settings
            </h2>
            <span className="text-[10px] uppercase tracking-widest text-[var(--game-ink)]/50">
              Host only
            </span>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--game-ink)]/70">
              Mode
            </p>
            <div role="radiogroup" aria-label="Mode" className="grid grid-cols-2 gap-2">
              {(["party", "artist"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  data-mode={m}
                  onClick={() => handleSetMode(m)}
                  className="rounded-xl px-3 py-2 border-2 text-left transition"
                  style={
                    // Pin both states to theme-locked colors so the tile stays
                    // readable in both light and dark. var(--game-ink) flips to
                    // cream in dark mode (see #64); use --game-canvas-dark (dark
                    // in both themes) for the dark surface and --game-canvas-yellow
                    // for the light ink on that surface. Unselected = cream
                    // paper card with dark ink text (also theme-locked).
                    mode === m
                      ? {
                          background: "var(--game-canvas-dark)",
                          color: "var(--game-canvas-yellow)",
                          borderColor: "var(--game-canvas-dark)",
                        }
                      : {
                          background: "var(--game-cream)",
                          color: "var(--game-canvas-dark)",
                          borderColor: "var(--game-canvas-dark)",
                        }
                  }
                >
                  <p className="text-sm font-black">
                    {m === "party" ? "Party" : "Artist"}
                  </p>
                  <p className="text-[11px] opacity-80">
                    {m === "party" ? "AI writes · all guess" : "One writes · others guess"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {mode !== "artist" && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--game-ink)]/70">
                Theme pack
              </p>
              <div
                role="radiogroup"
                aria-label="Theme pack"
                className="flex flex-wrap gap-1.5"
              >
                {PACK_IDS.map((p) => {
                  const meta = PACK_LABELS[p];
                  const active = pack === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-pack={p}
                      onClick={() => handleSetPack(p)}
                      title={meta.blurb}
                      className="rounded-full px-3 py-1.5 text-xs font-black border-2 transition"
                      style={
                        // Same theme-lock as the Mode tiles — var(--game-ink)
                        // flips to cream in dark mode and the pill becomes
                        // cream-on-cream (#64). Use --game-canvas-dark / yellow
                        // for the active pill; cream paper + dark ink for idle.
                        active
                          ? {
                              background: "var(--game-canvas-dark)",
                              color: "var(--game-canvas-yellow)",
                              borderColor: "var(--game-canvas-dark)",
                            }
                          : {
                              background: "var(--game-cream)",
                              color: "var(--game-canvas-dark)",
                              borderColor: "var(--game-canvas-dark)",
                            }
                      }
                    >
                      <span className="mr-1">{meta.emoji}</span>
                      {meta.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <SettingField
              id="cfg-maxRounds"
              label="Rounds"
              value={maxRounds}
              min={1}
              max={20}
              onCommit={(v) => clampAndSave("max_rounds", v)}
            />
            <SettingField
              id="cfg-guessSeconds"
              label="Guess (s)"
              value={guessSeconds}
              min={15}
              max={120}
              onCommit={(v) => clampAndSave("guess_seconds", v)}
            />
            <SettingField
              id="cfg-revealSeconds"
              label="Reveal (s)"
              value={revealSeconds}
              min={5}
              max={30}
              onCommit={(v) => clampAndSave("reveal_seconds", v)}
            />
          </div>

          {/* Blitz toggle — halves the default timer, doubles the speed bonus. */}
          <label
            data-blitz-toggle="1"
            className="flex items-center gap-3 rounded-xl border-2 px-3 py-2 cursor-pointer select-none transition"
            style={{
              borderColor: "var(--game-ink)",
              background: blitzOn
                ? "var(--game-canvas-yellow)"
                : "var(--game-paper)",
            }}
          >
            <input
              type="checkbox"
              checked={blitzOn}
              onChange={(e) => handleSetBlitz(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-base leading-none">⚡</span>
            <span className="flex-1">
              <span className="text-sm font-black block">Blitz mode</span>
              <span className="text-[11px] opacity-80">
                Half the timer, double the speed bonus.
              </span>
            </span>
          </label>

          {/* Taboo toggle — artist mode only. 3 random words the artist can't
              use in their prompt, revealed to guessers in the recap. */}
          {mode === "artist" && (
            <label
              data-taboo-toggle="1"
              className="flex items-center gap-3 rounded-xl border-2 px-3 py-2 cursor-pointer select-none transition"
              style={{
                borderColor: "var(--game-ink)",
                background: tabooOn
                  ? "var(--game-canvas-yellow)"
                  : "var(--game-paper)",
              }}
            >
              <input
                type="checkbox"
                checked={tabooOn}
                onChange={(e) => handleSetTaboo(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-base leading-none">🚫</span>
              <span className="flex-1">
                <span className="text-sm font-black block">Taboo</span>
                <span className="text-[11px] opacity-80">
                  Artist can&rsquo;t use 3 random forbidden words per round.
                </span>
              </span>
            </label>
          )}
        </section>
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
        <section className="w-full max-w-4xl space-y-4">
          <h2 className="text-lg font-heading font-black text-[var(--game-ink)]/80 text-center">
            Teams ({players.length})
          </h2>
          {isHost && (
            <p className="text-center text-xs text-[var(--game-ink)]/60">
              Drag players between columns — or tap the{" "}
              <span className="font-bold">⇄</span> button.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([1, 2] as const).map((t) => {
              const zone: DropZone = t === 1 ? "team-1" : "team-2";
              const isOver = dragOver === zone;
              return (
              <div
                key={t}
                data-team={t}
                data-drop-zone={zone}
                onDragOver={(e) => onZoneDragOver(e, zone)}
                onDragLeave={() => onZoneDragLeave(zone)}
                onDrop={(e) => onZoneDrop(e, zone)}
                className={`game-card p-4 space-y-2 transition ${
                  isOver ? "ring-4 ring-primary ring-offset-2" : ""
                }`}
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
                    {isHost ? "Drop a player here." : "No players yet."}
                  </p>
                )}
                <ul className="space-y-3">
                  {teamPlayers(t).map((p, i) => {
                    const isMe = p.player_id === currentPlayerId;
                    const highlight = isMe
                      ? "var(--game-pink)"
                      : p.is_host
                      ? "var(--game-canvas-yellow)"
                      : null;
                    const isDragging = draggingId === p.player_id;
                    return (
                    <li
                      key={p.player_id}
                      data-player-chip={p.player_id}
                      draggable={isHost}
                      onDragStart={(e) => onChipDragStart(e, p.player_id)}
                      onDragEnd={onChipDragEnd}
                      className="game-card flex items-center gap-3 px-3 py-2 bg-[var(--game-paper)]"
                      style={{
                        transform: `rotate(${i % 2 === 0 ? -0.8 : 0.8}deg)`,
                        outline: highlight ? `4px solid ${highlight}` : undefined,
                        outlineOffset: highlight ? "2px" : undefined,
                        opacity: isDragging ? 0.5 : undefined,
                        cursor: isHost ? "grab" : undefined,
                      }}
                    >
                      <span
                        className="player-chip w-8 h-8 text-xs"
                        style={(() => {
                          const c = chipColorsForPlayer(p.player_id);
                          return {
                            ["--chip-color" as string]: c.bg,
                            ["--chip-ink" as string]: c.ink,
                          } as React.CSSProperties;
                        })()}
                      >
                        {p.display_name.slice(0, 2).toUpperCase()}
                      </span>
                      <span
                        className="font-heading font-bold flex-1 truncate min-w-0"
                        title={p.display_name}
                      >
                        {p.display_name}
                      </span>
                      {p.is_host && (
                        <span
                          className="sticker text-[11px] font-black uppercase tracking-wider"
                          style={
                            {
                              ["--sticker-tilt" as string]: "3deg",
                              background: "var(--game-canvas-yellow)",
                            } as React.CSSProperties
                          }
                        >
                          👑 host
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
                          phase={phase}
                        />
                      )}
                    </li>
                    );
                  })}
                </ul>
              </div>
              );
            })}

            {/* Spectators column — always visible when teams are on. */}
            <div
              data-drop-zone="spectators"
              onDragOver={(e) => onZoneDragOver(e, "spectators")}
              onDragLeave={() => onZoneDragLeave("spectators")}
              onDrop={(e) => onZoneDrop(e, "spectators")}
              className={`game-card p-4 space-y-2 bg-muted/50 transition ${
                dragOver === "spectators" ? "ring-4 ring-primary ring-offset-2" : ""
              }`}
            >
              <p className="text-xs font-black uppercase tracking-widest text-[var(--game-ink)]/70">
                Spectators · {spectatorPlayers.length}
              </p>
              {spectatorPlayers.length === 0 && (
                <p className="text-xs text-[var(--game-ink)]/60 italic">
                  {isHost ? "Drop here to sit someone out." : "No spectators."}
                </p>
              )}
              <ul className="space-y-3">
                {spectatorPlayers.map((p, i) => {
                  const isMe = p.player_id === currentPlayerId;
                  const isDragging = draggingId === p.player_id;
                  return (
                    <li
                      key={p.player_id}
                      data-player-chip={p.player_id}
                      draggable={isHost && p.player_id !== hostId}
                      onDragStart={(e) => onChipDragStart(e, p.player_id)}
                      onDragEnd={onChipDragEnd}
                      className="game-card flex items-center gap-3 px-3 py-2 bg-[var(--game-paper)]"
                      style={{
                        transform: `rotate(${i % 2 === 0 ? -0.8 : 0.8}deg)`,
                        outline: isMe
                          ? "4px solid var(--game-pink)"
                          : undefined,
                        outlineOffset: isMe ? "2px" : undefined,
                        opacity: isDragging ? 0.5 : undefined,
                        cursor:
                          isHost && p.player_id !== hostId
                            ? "grab"
                            : undefined,
                      }}
                    >
                      <span
                        className="player-chip w-8 h-8 text-xs"
                        style={(() => {
                          const c = chipColorsForPlayer(p.player_id);
                          return {
                            ["--chip-color" as string]: c.bg,
                            ["--chip-ink" as string]: c.ink,
                          } as React.CSSProperties;
                        })()}
                      >
                        {p.display_name.slice(0, 2).toUpperCase()}
                      </span>
                      <span
                        className="font-heading font-bold flex-1 truncate min-w-0"
                        title={p.display_name}
                      >
                        {p.display_name}
                      </span>
                      <span className="text-[11px] uppercase tracking-wider opacity-60">
                        watching
                      </span>
                      {isHost && p.player_id !== currentPlayerId && (
                        <HostControls
                          roomId={room.id}
                          victimId={p.player_id}
                          victimName={p.display_name}
                          phase={phase}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {(unassignedPlayers.length > 0 || (isHost && dragOver === "unassigned")) && (
            <div
              data-drop-zone="unassigned"
              onDragOver={(e) => onZoneDragOver(e, "unassigned")}
              onDragLeave={() => onZoneDragLeave("unassigned")}
              onDrop={(e) => onZoneDrop(e, "unassigned")}
              className={`game-card p-4 space-y-2 bg-[var(--game-paper)] transition ${
                dragOver === "unassigned" ? "ring-4 ring-primary ring-offset-2" : ""
              }`}
            >
              <p className="text-xs font-black uppercase tracking-widest text-[var(--game-ink)]/70">
                Unassigned · {unassignedPlayers.length}
              </p>
              <ul className="flex flex-wrap gap-2">
                {unassignedPlayers.map((p, i) => {
                  const isDragging = draggingId === p.player_id;
                  return (
                    <li
                      key={p.player_id}
                      data-player-chip={p.player_id}
                      draggable={isHost}
                      onDragStart={(e) => onChipDragStart(e, p.player_id)}
                      onDragEnd={onChipDragEnd}
                      className="sticker flex items-center gap-2"
                      style={
                        {
                          ["--sticker-tilt" as string]: `${
                            i % 2 === 0 ? -2 : 2
                          }deg`,
                          opacity: isDragging ? 0.5 : undefined,
                          cursor: isHost ? "grab" : undefined,
                        } as React.CSSProperties
                      }
                    >
                      <span className="font-semibold">{p.display_name}</span>
                      {isHost && (
                        <button
                          type="button"
                          onClick={() => handleSwapTeam(p.player_id, null)}
                          className="sticker text-[10px]"
                          style={
                            {
                              ["--sticker-tilt" as string]: "0deg",
                              background: "var(--game-canvas-yellow)",
                            } as React.CSSProperties
                          }
                        >
                          Assign
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <section className="w-full max-w-2xl space-y-3">
          <h2 className="text-lg font-heading font-black text-[var(--game-ink)]/80">
            Players ({players.length})
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {players.map((p, i) => {
              const isMe = p.player_id === currentPlayerId;
              const highlight = isMe
                ? "var(--game-pink)"
                : p.is_host
                ? "var(--game-canvas-yellow)"
                : null;
              return (
              <li
                key={p.player_id}
                className="game-card flex items-center gap-3 px-4 py-3 bg-[var(--game-paper)]"
                style={{
                  transform: `rotate(${i % 2 === 0 ? -0.8 : 0.8}deg)`,
                  outline: highlight ? `4px solid ${highlight}` : undefined,
                  outlineOffset: highlight ? "2px" : undefined,
                }}
              >
                <span
                  className="player-chip w-10 h-10 text-sm shrink-0"
                  style={(() => {
                    const c = chipColorsForPlayer(p.player_id);
                    return {
                      ["--chip-color" as string]: c.bg,
                      ["--chip-ink" as string]: c.ink,
                    } as React.CSSProperties;
                  })()}
                >
                  {p.display_name.slice(0, 2).toUpperCase()}
                </span>
                <span
                  className="font-heading font-bold flex-1 truncate min-w-0"
                  title={p.display_name}
                >
                  {p.display_name}
                </span>
                {p.is_host && (
                  <span
                    className="sticker text-[11px] font-black uppercase tracking-wider shrink-0"
                    style={
                      {
                        ["--sticker-tilt" as string]: "3deg",
                        background: "var(--game-canvas-yellow)",
                      } as React.CSSProperties
                    }
                  >
                    👑 host
                  </span>
                )}
                {isHost && p.player_id !== currentPlayerId && (
                  <HostControls
                    roomId={room.id}
                    victimId={p.player_id}
                    victimName={p.display_name}
                    phase={phase}
                  />
                )}
              </li>
              );
            })}
          </ul>
        </section>
      )}

      {phase === "lobby" && (
        <div className="flex gap-3 flex-wrap justify-center w-full max-w-md">
          {isHost && (() => {
            const activePlayers = players.filter((p) => !p.is_spectator);
            const teamsIncomplete =
              teamsOn &&
              (teamPlayers(1).length === 0 ||
                teamPlayers(2).length === 0 ||
                unassignedPlayers.length > 0);
            const disabled =
              activePlayers.length < 2 || starting || teamsIncomplete;
            const ariaLabel = starting
              ? "Starting"
              : teamsIncomplete
                ? "Assign every player to a team"
                : `Start game (${activePlayers.length}/2+)`;
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
            variant="destructive"
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

function SettingField({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  // Keep local draft in sync if another surface updates the value (realtime).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="text-[10px] uppercase tracking-wider font-bold text-[var(--game-ink)]/70"
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-full bg-white border-2 rounded-lg h-10 px-2 text-sm"
        style={{
          // Input bg is hardcoded white (a fixed-light surface). Text + border
          // must stay dark in both themes — var(--game-ink) flips to cream in
          // dark mode and vanishes on white (#64). --game-canvas-dark stays
          // dark in both themes.
          borderColor: "var(--game-canvas-dark)",
          color: "var(--game-canvas-dark)",
        }}
      />
    </div>
  );
}
