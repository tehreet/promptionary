"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAnimatedNumber } from "@/lib/animation";
import { RoomChannelProvider } from "@/lib/room-channel";
import { LiveCursorsOverlay } from "@/components/live-cursors";
import { ChatPanel } from "@/components/chat-panel";
import { ReactionsBar } from "@/components/reactions-bar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { colorForPlayer } from "@/lib/player";
import {
  playImageLand,
  playReveal,
  playSubmit,
  playWinnerCheer,
} from "@/lib/sfx";
import { PromptFlipboard, type PromptToken } from "@/components/prompt-flipboard";
import { HostControls } from "@/components/host-controls";
import { LoadingPhrases } from "@/components/loading-phrases";

type Room = {
  id: string;
  code: string;
  phase: string;
  host_id: string;
  mode: string;
  teams_enabled?: boolean;
  max_rounds: number;
  guess_seconds: number;
  reveal_seconds: number;
  round_num: number;
  phase_ends_at: string | null;
};

type Player = {
  player_id: string;
  display_name: string;
  is_host: boolean;
  is_spectator?: boolean;
  score: number;
  team?: number | null;
};

const TEAM_META: Record<1 | 2, { label: string; color: string }> = {
  1: { label: "Team 1", color: "var(--team-1)" },
  2: { label: "Team 2", color: "var(--team-2)" },
};

type Round = {
  id: string;
  round_num: number;
  prompt: string | null;
  image_url: string | null;
  artist_player_id: string | null;
  ended_at: string | null;
};

type Guess = {
  id: string;
  player_id: string;
  guess: string;
  subject_score: number;
  style_score: number;
  semantic_score: number;
  speed_bonus: number;
  total_score: number;
  submitted_at: string;
  scored_at: string | null;
};

function useCountdown(endsAt: string | null): number {
  const [remaining, setRemaining] = useState<number>(() =>
    endsAt ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000)) : 0,
  );
  useEffect(() => {
    if (!endsAt) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const r = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
      setRemaining(r);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return remaining;
}

export function GameClient(props: {
  room: Room;
  players: Player[];
  currentPlayerId: string;
  isSpectator?: boolean;
}) {
  const me = props.players.find((p) => p.player_id === props.currentPlayerId);
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
      <GameClientInner {...props} />
    </RoomChannelProvider>
  );
}

function GameClientInner({
  room: initialRoom,
  players: initialPlayers,
  currentPlayerId,
  isSpectator = false,
}: {
  room: Room;
  players: Player[];
  currentPlayerId: string;
  isSpectator?: boolean;
}) {
  const router = useRouter();
  const [room, setRoom] = useState<Room>(initialRoom);
  const [players, setPlayers] = useState<Player[]>(initialPlayers);

  // When the room flips back to lobby (after a Play Again), hand control to
  // the lobby server component via a refresh.
  useEffect(() => {
    if (room.phase === "lobby") router.refresh();
  }, [room.phase, router]);

  // If I get kicked mid-game, bounce me home. RLS hides the room from kicked
  // players so the poll returns []; rely on the server component having
  // already confirmed membership on page load rather than guarding on length.
  useEffect(() => {
    const stillHere = players.some((p) => p.player_id === currentPlayerId);
    if (!stillHere) router.replace("/");
  }, [players, currentPlayerId, router]);
  const [currentRound, setCurrentRound] = useState<Round | null>(null);
  const [myGuess, setMyGuess] = useState<string>("");
  const [guessSubmitted, setGuessSubmitted] = useState<boolean>(false);
  const [guessesFromReveal, setGuessesFromReveal] = useState<Guess[]>([]);
  const [promptTokens, setPromptTokens] = useState<PromptToken[]>([]);
  const [submissionCount, setSubmissionCount] = useState<number>(0);
  const isHost = room.host_id === currentPlayerId;

  const competitorCount = useMemo(
    () => players.filter((p) => !p.is_spectator).length,
    [players],
  );
  // Artist-mode guessers = non-spectators excluding the round's artist.
  const guesserCount = competitorCount;
  const submissionTotal = (() => {
    if (currentRound?.artist_player_id) {
      return Math.max(0, guesserCount - 1);
    }
    return guesserCount || players.length;
  })();
  const generatingCalledRef = useRef<string | null>(null);
  const finalizeCalledRef = useRef<string | null>(null);
  const revealAdvanceRef = useRef<string | null>(null);
  const autoSubmittedRef = useRef<string | null>(null);
  const roundNumRef = useRef<number>(room.round_num);
  roundNumRef.current = room.round_num;

  const remaining = useCountdown(room.phase_ends_at);

  const supabaseRef = useRef(createSupabaseBrowserClient());

  // Subscribe to room updates
  useEffect(() => {
    const supabase = supabaseRef.current;
    const ch = supabase
      .channel(`room-${room.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          setRoom((prev) => ({ ...prev, ...(payload.new as Room) }));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${room.id}` },
        (payload) => {
          setPlayers((prev) => {
            if (payload.eventType === "UPDATE") {
              const next = payload.new as Player;
              return prev.map((p) => (p.player_id === next.player_id ? { ...p, ...next } : p));
            }
            if (payload.eventType === "INSERT") {
              const next = payload.new as Player;
              if (prev.some((p) => p.player_id === next.player_id)) return prev;
              return [...prev, next];
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
        { event: "*", schema: "public", table: "rounds", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const row = payload.new as Round;
          setCurrentRound((prev) => (prev?.id === row.id || row.round_num === room.round_num ? { ...prev, ...row } : prev));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "guesses" },
        (payload) => {
          const g = payload.new as { round_id: string };
          if (currentRound && g.round_id === currentRound.id) {
            setSubmissionCount((c) => c + 1);
          }
        },
      )
      .subscribe();
    // Poll as fallback in case the postgres_changes stream drops events.
    const poll = setInterval(async () => {
      const { data: r } = await supabase
        .from("rooms")
        .select(
          "id, code, phase, host_id, mode, teams_enabled, max_rounds, guess_seconds, reveal_seconds, round_num, phase_ends_at",
        )
        .eq("id", room.id)
        .maybeSingle();
      if (r) setRoom((prev) => ({ ...prev, ...(r as Room) }));

      const { data: ps } = await supabase
        .from("room_players")
        .select("player_id, display_name, is_host, is_spectator, score, team")
        .eq("room_id", room.id);
      if (ps) setPlayers(ps as Player[]);

      // Always fetch the round matching the CURRENT room.round_num, not the
      // captured currentRound.id. Otherwise a previous round's reveal data
      // can overwrite the new round's state during the transition.
      const targetRoundNum = r?.round_num ?? roundNumRef.current;
      if (targetRoundNum > 0) {
        const { data: rd } = await supabase
          .from("rounds_public")
          .select("id, round_num, prompt, image_url, artist_player_id, ended_at")
          .eq("room_id", room.id)
          .eq("round_num", targetRoundNum)
          .maybeSingle();
        if (rd) {
          setCurrentRound((prev) => {
            if (prev && prev.id !== rd.id) {
              // New round — reset per-round UI state.
              setGuessSubmitted(false);
              setMyGuess("");
              setSubmissionCount(0);
              setGuessesFromReveal([]);
            }
            return rd as Round;
          });

          const { data: count } = await supabase.rpc("count_round_guesses", {
            p_round_id: rd.id,
          });
          if (typeof count === "number") setSubmissionCount(count);
        }
      }
    }, 2000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [room.id, room.round_num, currentRound]);

  // Fetch current round whenever round_num changes. Per-round UI state reset
  // happens in the poller (where we detect id transitions) — duplicating it
  // here would double-fire during phase=reveal→guessing transitions.
  useEffect(() => {
    if (room.round_num <= 0) return;
    let cancel = false;
    (async () => {
      const supabase = supabaseRef.current;
      const { data } = await supabase
        .from("rounds_public")
        .select("id, round_num, prompt, image_url, ended_at")
        .eq("room_id", room.id)
        .eq("round_num", room.round_num)
        .maybeSingle();
      if (!cancel && data) {
        setCurrentRound((prev) => {
          if (prev && prev.id !== data.id) {
            setGuessSubmitted(false);
            setMyGuess("");
            setSubmissionCount(0);
            setGuessesFromReveal([]);
          }
          return data as Round;
        });
      } else if (!cancel) {
        // Fallback for artist mode: rounds_public may not reveal the artist
        // field if RLS is stricter. Fetch directly.
        const { data: raw } = await supabase
          .from("rounds")
          .select("id, round_num, image_url, artist_player_id, ended_at")
          .eq("room_id", room.id)
          .eq("round_num", room.round_num)
          .maybeSingle();
        if (raw) setCurrentRound({ ...raw, prompt: null } as Round);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [room.id, room.round_num]);

  const [startError, setStartError] = useState<string | null>(null);

  // Host (or the artist on artist-mode) triggers /api/start-round when
  // phase=generating. On artist mode the artist already submitted their
  // prompt via /api/submit-artist-prompt which calls start-round internally,
  // so this effect becomes a safety net rather than the primary driver.
  const isArtistRound = !!currentRound?.artist_player_id;
  const iAmArtist =
    isArtistRound && currentRound?.artist_player_id === currentPlayerId;
  useEffect(() => {
    if (room.phase !== "generating") return;
    if (!currentRound?.id) return;
    if (generatingCalledRef.current === currentRound.id) return;
    // Default mode: host drives. Artist mode: the artist already triggered
    // start-round via submit-artist-prompt; skip here.
    if (room.mode === "artist") return;
    if (!isHost) return;
    generatingCalledRef.current = currentRound.id;
    setStartError(null);
    (async () => {
      try {
        const res = await fetch("/api/start-round", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ round_id: currentRound.id }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setStartError(body.detail || body.error || `status ${res.status}`);
        }
      } catch (e) {
        setStartError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [isHost, room.phase, room.mode, currentRound?.id]);

  // Any member triggers /api/finalize-round when the guessing timer expires
  // OR when every competitor has submitted (via submissionCount, which the
  // poller keeps fresh via count_round_guesses RPC). Keyed off
  // phase_ends_at < now() rather than remaining==0 since useCountdown
  // returns 0 for both "null" and "past".
  useEffect(() => {
    if (room.phase !== "guessing") return;
    if (!currentRound?.id) return;
    if (finalizeCalledRef.current === currentRound.id) return;

    const timerExpired =
      !!room.phase_ends_at &&
      new Date(room.phase_ends_at).getTime() <= Date.now();
    const everyoneIn =
      submissionCount > 0 &&
      submissionCount >= submissionTotal &&
      submissionTotal > 0;

    if (!timerExpired && !everyoneIn) return;

    finalizeCalledRef.current = currentRound.id;
    (async () => {
      try {
        await fetch("/api/finalize-round", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ round_id: currentRound.id }),
        });
      } catch (e) {
        console.error(e);
      }
    })();
  }, [
    room.phase,
    room.phase_ends_at,
    remaining,
    submissionCount,
    submissionTotal,
    currentRound?.id,
  ]);

  // Host advances to next round when the reveal timer genuinely expires.
  // Reading phase_ends_at directly avoids a render race: when phase flips
  // from scoring → reveal, useCountdown's `remaining` stays at 0 for one
  // render before catching up to the new phase_ends_at. If we keyed off
  // `remaining`, we'd fire start_round instantly and the reveal phase
  // would last ~1 second instead of reveal_seconds.
  useEffect(() => {
    if (!isHost) return;
    if (room.phase !== "reveal") return;
    if (!room.phase_ends_at) return;
    if (new Date(room.phase_ends_at).getTime() > Date.now()) return;
    const key = `${room.id}-${room.round_num}`;
    if (revealAdvanceRef.current === key) return;
    revealAdvanceRef.current = key;
    (async () => {
      try {
        const supabase = supabaseRef.current;
        await supabase.rpc("start_round", { p_room_id: room.id });
      } catch (e) {
        console.error(e);
      }
    })();
  }, [isHost, room.phase, room.phase_ends_at, remaining, room.id, room.round_num]);

  // When entering reveal phase, fetch all scored guesses + role tokens so
  // everyone sees the recap.
  useEffect(() => {
    if (room.phase !== "reveal" && room.phase !== "game_over") return;
    if (!currentRound?.id) return;
    (async () => {
      const supabase = supabaseRef.current;
      const { data } = await supabase
        .from("guesses")
        .select("*")
        .eq("round_id", currentRound.id)
        .order("total_score", { ascending: false });
      if (data) setGuessesFromReveal(data as Guess[]);
      const { data: tokens } = await supabase
        .from("round_prompt_tokens")
        .select("position, token, role")
        .eq("round_id", currentRound.id)
        .order("position", { ascending: true });
      if (tokens) setPromptTokens(tokens as PromptToken[]);
    })();
  }, [room.phase, currentRound?.id]);

  // Confetti + sfx on reveal (modest) + game_over (big winner blast)
  const revealFiredRef = useRef<string | null>(null);
  const gameOverFiredRef = useRef(false);
  useEffect(() => {
    if (room.phase === "reveal" && currentRound?.id) {
      if (revealFiredRef.current === currentRound.id) return;
      revealFiredRef.current = currentRound.id;
      playReveal();
      confetti({
        particleCount: 80,
        spread: 55,
        startVelocity: 35,
        origin: { y: 0.35 },
        colors: ["#6366f1", "#d946ef", "#f43f5e", "#fde68a"],
        disableForReducedMotion: true,
      });
    }
    if (room.phase === "game_over" && !gameOverFiredRef.current) {
      gameOverFiredRef.current = true;
      playWinnerCheer();
      const fire = (delay: number, opts: confetti.Options) =>
        setTimeout(() => confetti({ disableForReducedMotion: true, ...opts }), delay);
      fire(0, {
        particleCount: 150,
        spread: 70,
        origin: { y: 0.4 },
        colors: ["#6366f1", "#d946ef", "#f43f5e", "#fde68a", "#a78bfa"],
      });
      fire(250, {
        particleCount: 90,
        spread: 100,
        angle: 60,
        origin: { x: 0, y: 0.6 },
      });
      fire(500, {
        particleCount: 90,
        spread: 100,
        angle: 120,
        origin: { x: 1, y: 0.6 },
      });
    }
    if (room.phase === "lobby") {
      gameOverFiredRef.current = false;
      revealFiredRef.current = null;
    }
  }, [room.phase, currentRound?.id]);

  // Whoosh when the image first lands for a round.
  const imageLandedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentRound?.id || !currentRound?.image_url) return;
    if (room.phase !== "guessing") return;
    if (imageLandedForRef.current === currentRound.id) return;
    imageLandedForRef.current = currentRound.id;
    playImageLand();
  }, [currentRound?.id, currentRound?.image_url, room.phase]);

  const submitGuess = useCallback(async () => {
    if (!currentRound?.id) return;
    const text = myGuess.trim();
    if (!text) return;
    setGuessSubmitted(true);
    playSubmit();
    const supabase = supabaseRef.current;
    const { error } = await supabase.rpc("submit_guess", {
      p_round_id: currentRound.id,
      p_guess: text,
    });
    if (error) {
      // Don't alert on auto-submit failures (phase already ended, etc.) — the
      // user didn't ask us to do this, just shelve silently.
      if (!autoSubmittedRef.current) {
        alert(error.message);
      }
      setGuessSubmitted(false);
    }
  }, [currentRound?.id, myGuess]);

  // Auto-submit whatever's in the textarea when the guess timer is almost out.
  // Fires at ~2s left so we beat the server's "phase_ends_at > now()" check
  // with comfortable headroom.
  useEffect(() => {
    if (room.phase !== "guessing") return;
    if (guessSubmitted) return;
    if (isSpectator) return;
    if (!currentRound?.id) return;
    if (autoSubmittedRef.current === currentRound.id) return;
    if (!myGuess.trim()) return;
    if (!room.phase_ends_at) return;
    const msLeft = new Date(room.phase_ends_at).getTime() - Date.now();
    if (msLeft > 2000) return;
    autoSubmittedRef.current = currentRound.id;
    submitGuess();
  }, [
    room.phase,
    room.phase_ends_at,
    remaining,
    guessSubmitted,
    isSpectator,
    myGuess,
    currentRound?.id,
    submitGuess,
  ]);

  const playerById = useMemo(
    () => new Map(players.map((p) => [p.player_id, p])),
    [players],
  );
  const competitors = useMemo(
    () => players.filter((p) => !p.is_spectator),
    [players],
  );
  const spectators = useMemo(
    () => players.filter((p) => p.is_spectator),
    [players],
  );
  const leaderboard = useMemo(
    () => [...competitors].sort((a, b) => b.score - a.score),
    [competitors],
  );
  const isTeams = !!room.teams_enabled;
  const teamLeaderboard = useMemo(() => {
    if (!isTeams) return [] as Array<{
      team: 1 | 2;
      avg: number;
      total: number;
      members: Player[];
    }>;
    return ([1, 2] as const)
      .map((t) => {
        const members = competitors.filter((p) => p.team === t);
        const total = members.reduce((acc, p) => acc + p.score, 0);
        const avg = members.length > 0 ? Math.round(total / members.length) : 0;
        return { team: t, total, avg, members };
      })
      .sort((a, b) => b.avg - a.avg);
  }, [competitors, isTeams]);

  return (
    <main
      className={`min-h-screen flex flex-col items-center gap-6 px-6 py-10 ${
        room.phase === "reveal" || room.phase === "game_over"
          ? "game-canvas-page"
          : "game-canvas-dark"
      }`}
    >
      <header className="w-full max-w-4xl flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground">
            Round
          </p>
          <p className="text-xl sm:text-2xl font-heading font-black">
            {room.round_num} / {room.max_rounds}
          </p>
        </div>
        {isSpectator && (
          <div className="rounded-full bg-accent text-accent-foreground border border-border px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider">
            Spectating
          </div>
        )}
        <div className="text-right">
          <p className="text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground">
            Code
          </p>
          <p className="text-xl sm:text-2xl font-heading font-black font-mono tracking-[0.2em] sm:tracking-[0.3em]">
            {room.code}
          </p>
        </div>
      </header>

      {/* Running scoreboard — visible every phase except game_over (which has its own) */}
      {room.phase !== "game_over" && leaderboard.length > 0 && (
        <section className="w-full max-w-4xl">
          {isTeams && (
            <div
              data-team-scoreboard="1"
              className="flex justify-center gap-3 mb-3"
            >
              {teamLeaderboard.map((t) => (
                <div
                  key={t.team}
                  data-team-chip={t.team}
                  className="rounded-full border-2 px-4 py-1 text-sm font-black flex items-center gap-2 bg-[var(--game-paper)]"
                  style={{
                    borderColor: TEAM_META[t.team].color,
                    color: TEAM_META[t.team].color,
                  }}
                >
                  {TEAM_META[t.team].label}
                  <span className="font-mono text-base">{t.avg}</span>
                </div>
              ))}
            </div>
          )}
          <ul className="flex gap-3 overflow-x-auto pb-2 justify-start sm:justify-center">
            {leaderboard.map((p, i) => {
              const teamColor =
                isTeams && (p.team === 1 || p.team === 2)
                  ? TEAM_META[p.team as 1 | 2].color
                  : null;
              return (
                <li
                  key={p.player_id}
                  data-team={p.team ?? undefined}
                  className="game-card bg-[var(--game-paper)] flex items-center gap-2 px-3 py-2 shrink-0"
                  style={
                    teamColor
                      ? ({ ["--team-accent" as string]: teamColor, outline: `2px solid ${teamColor}` } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span className="text-xs opacity-60 font-black w-4 text-right text-[var(--game-ink)]">
                    {i + 1}
                  </span>
                  <span
                    className="player-chip w-8 h-8 text-xs"
                    style={{ ["--chip-color" as string]: colorForPlayer(p.player_id) } as React.CSSProperties}
                  >
                    {p.display_name[0]?.toUpperCase()}
                  </span>
                  <span className="font-heading font-bold text-sm text-[var(--game-ink)] truncate max-w-[8rem]">
                    {p.display_name}
                  </span>
                  <span className="font-mono font-black text-sm text-[var(--game-ink)]">
                    {p.score}
                  </span>
                  {isHost && p.player_id !== currentPlayerId && (
                    <HostControls
                      roomId={room.id}
                      victimId={p.player_id}
                      victimName={p.display_name}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {spectators.length > 0 && (
            <p className="text-xs opacity-70 text-center mt-2">
              {spectators.length} watching
            </p>
          )}
        </section>
      )}

      {room.phase === "prompting" && (
        <ArtistPromptingView
          room={room}
          currentRound={currentRound}
          iAmArtist={iAmArtist}
          artist={
            currentRound?.artist_player_id
              ? playerById.get(currentRound.artist_player_id)
              : undefined
          }
          remaining={remaining}
        />
      )}

      {room.phase === "generating" && (
        <div className="flex flex-col items-center gap-4 py-20 max-w-xl text-center">
          {startError ? (
            <>
              <p className="text-2xl font-black">Image generation failed</p>
              <pre className="text-xs bg-black/30 rounded-xl p-3 whitespace-pre-wrap break-all max-w-full">
                {startError}
              </pre>
              <p className="opacity-80 text-sm">
                {isHost
                  ? "You'll be dropped back to the lobby shortly."
                  : "The host is trying again."}
              </p>
            </>
          ) : (
            <>
              <div className="h-20 w-20 rounded-full border-4 border-muted border-t-foreground animate-spin" />
              <p className="text-xl font-bold">The AI is painting…</p>
              <LoadingPhrases seed={currentRound?.id ?? `r-${room.round_num}`} />
            </>
          )}
        </div>
      )}

      {room.phase === "guessing" && (
        <section className="w-full max-w-2xl flex flex-col items-center gap-5">
          {isArtistRound && currentRound?.artist_player_id && (
            <div className="flex items-center gap-2 text-sm opacity-90">
              <span>Prompt by</span>
              <span
                className="player-chip h-6 w-6 text-xs"
                style={{
                  ["--chip-color" as string]: colorForPlayer(
                    currentRound.artist_player_id,
                  ),
                } as React.CSSProperties}
              >
                {playerById
                  .get(currentRound.artist_player_id)
                  ?.display_name[0]?.toUpperCase()}
              </span>
              <span className="font-semibold">
                {playerById.get(currentRound.artist_player_id)?.display_name ??
                  "the artist"}
              </span>
            </div>
          )}
          <div className="w-full flex items-center justify-between">
            <p className="text-lg font-semibold opacity-90">
              Submissions: {submissionCount}/{submissionTotal}
            </p>
            <span className="marquee-pill">
              <span className="live-dot" aria-hidden />
              {remaining}s
            </span>
          </div>
          {currentRound?.image_url && (
            <LiveCursorsOverlay>
              <div className="game-frame bg-[var(--game-paper)] p-2 inline-block">
                <img
                  src={currentRound.image_url}
                  alt="Round painting"
                  className="rounded-[10px] block max-w-full h-auto"
                />
              </div>
            </LiveCursorsOverlay>
          )}
          {isSpectator ? (
            <div className="w-full bg-card border border-border shadow-sm rounded-2xl p-4 text-center">
              <p className="font-bold">Spectating — guesses are hidden until reveal.</p>
            </div>
          ) : iAmArtist ? (
            <div className="w-full bg-card border border-border shadow-sm rounded-2xl p-4 text-center">
              <p className="font-bold">You wrote this one — watch the guesses come in ✨</p>
            </div>
          ) : guessSubmitted ? (
            <div className="w-full bg-card border border-border shadow-sm rounded-2xl p-4 text-center">
              <p className="font-bold">Guess in! Waiting on the rest…</p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitGuess();
              }}
              className="w-full flex flex-col gap-3"
            >
              <Textarea
                value={myGuess}
                onChange={(e) => setMyGuess(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    submitGuess();
                  }
                }}
                placeholder="What's the prompt? Subjects, style cues, mood — give it your best shot."
                maxLength={200}
                autoFocus
                rows={3}
                className="text-lg rounded-xl min-h-[96px] resize-y leading-relaxed p-4"
              />
              <div className="flex items-center justify-between text-xs opacity-70">
                <span>{myGuess.length}/200</span>
                <span className="hidden sm:inline">⌘/Ctrl + Enter to submit</span>
              </div>
              <Button
                type="submit"
                disabled={!myGuess.trim()}
                className="font-bold h-14 px-8 rounded-xl text-lg"
              >
                Guess
              </Button>
            </form>
          )}
        </section>
      )}

      {room.phase === "scoring" && (
        <div className="flex flex-col items-center gap-4 py-20">
          <div className="h-20 w-20 rounded-full border-4 border-muted border-t-foreground animate-spin" />
          <p className="text-xl font-bold">Scoring guesses…</p>
        </div>
      )}

      {(room.phase === "reveal" || room.phase === "game_over") && (
        <section className="w-full max-w-2xl flex flex-col items-center gap-5">
          {room.phase === "reveal" && (
            <p className="text-sm opacity-80">
              Next round in <span className="font-mono font-black">{remaining}s</span>
            </p>
          )}
          <ReactionsBarWrapper />

          {currentRound?.image_url && (
            <LiveCursorsOverlay>
              <img
                src={currentRound.image_url}
                alt="Round"
                className="w-full rounded-3xl shadow-xl border-4 border-border"
              />
            </LiveCursorsOverlay>
          )}
          {currentRound?.prompt && (
            <PromptFlipboard
              prompt={currentRound.prompt}
              tokens={promptTokens}
            />
          )}
          <ul className="w-full space-y-2">
            {guessesFromReveal.map((g, i) => (
              <GuessRow
                key={g.id}
                rank={i + 1}
                guess={g}
                player={playerById.get(g.player_id)}
                topScore={guessesFromReveal[0]?.total_score ?? 0}
              />
            ))}
          </ul>

          {room.phase === "game_over" && (
            <>
              {isTeams ? (
                <div
                  data-team-final="1"
                  className="w-full bg-card border border-border shadow-sm rounded-2xl p-6 mt-4 space-y-4"
                >
                  <p className="text-center text-xs uppercase tracking-widest opacity-70">
                    Final team leaderboard
                  </p>
                  <ul className="space-y-3">
                    {teamLeaderboard.map((t, i) => (
                      <li
                        key={t.team}
                        data-team-rank={i + 1}
                        className="rounded-2xl border-2 p-4"
                        style={{
                          borderColor: TEAM_META[t.team].color,
                          background: `color-mix(in oklab, ${TEAM_META[t.team].color} 12%, transparent)`,
                        }}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-black opacity-60">
                              #{i + 1}
                            </span>
                            <span
                              className="font-heading font-black text-xl"
                              style={{ color: TEAM_META[t.team].color }}
                            >
                              {TEAM_META[t.team].label}
                            </span>
                          </div>
                          <div className="text-right">
                            <p className="font-mono font-black text-3xl">
                              {t.avg}
                            </p>
                            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              avg / member
                            </p>
                          </div>
                        </div>
                        <ul className="mt-3 flex flex-wrap gap-2">
                          {t.members
                            .slice()
                            .sort((a, b) => b.score - a.score)
                            .map((m) => (
                              <li
                                key={m.player_id}
                                className="rounded-full bg-card border border-border px-3 py-1 text-xs flex items-center gap-2"
                              >
                                <span
                                  className="player-chip h-5 w-5 text-[10px]"
                                  style={{
                                    ["--chip-color" as string]: colorForPlayer(
                                      m.player_id,
                                    ),
                                  } as React.CSSProperties}
                                >
                                  {m.display_name[0]?.toUpperCase()}
                                </span>
                                <span className="font-semibold">
                                  {m.display_name}
                                </span>
                                <span className="font-mono font-black">
                                  {m.score}
                                </span>
                              </li>
                            ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="w-full bg-card border border-border shadow-sm rounded-2xl p-6 mt-4">
                  <p className="text-center text-xs uppercase tracking-widest opacity-70 mb-3">
                    Final leaderboard
                  </p>
                  <ul className="space-y-2">
                    {leaderboard.map((p, i) => (
                      <LeaderboardRow
                        key={p.player_id}
                        rank={i + 1}
                        player={p}
                      />
                    ))}
                  </ul>
                </div>
              )}
              <PlayAgainControls room={room} isHost={isHost} />
            </>
          )}
        </section>
      )}
      <ChatPanel
        roomPhase={room.phase}
        isSpectator={isSpectator}
        variant="floating"
      />
    </main>
  );
}

function ReactionsBarWrapper() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="w-full flex justify-center">
      <ReactionsBar targetRef={ref} />
    </div>
  );
}

function GuessRow({
  rank,
  guess,
  player,
  topScore,
}: {
  rank: number;
  guess: Guess;
  player: Player | undefined;
  topScore: number;
}) {
  const score = useAnimatedNumber(guess.total_score, 900);
  const isTop = rank === 1 && guess.total_score > 0;
  const nailedIt = isTop && guess.total_score >= 80;
  return (
    <li
      data-top-guess={isTop ? "1" : undefined}
      className={`rounded-2xl px-3 sm:px-4 py-3 border flex items-start gap-3 sm:gap-4 shadow-sm ${
        isTop
          ? "bg-accent border-[color:var(--brand-fuchsia)]/40 ring-2 ring-[color:var(--brand-fuchsia)]/40"
          : "bg-card border-border"
      }`}
    >
      <span className="w-5 sm:w-6 text-center font-black text-muted-foreground pt-0.5 text-sm sm:text-base">
        {rank}
      </span>
      <span
        className="player-chip h-8 w-8 shrink-0 text-sm"
        style={{
          ["--chip-color" as string]: colorForPlayer(guess.player_id),
        } as React.CSSProperties}
      >
        {player?.display_name[0]?.toUpperCase()}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold truncate text-sm sm:text-base">
            {player?.display_name ?? "—"}
          </p>
          {isTop && (
            <span
              className="nailed-pop inline-flex items-center gap-1 rounded-full bg-[color:var(--brand-fuchsia)] text-white text-[10px] sm:text-xs font-black uppercase tracking-wider px-2 py-0.5 shadow-sm"
              style={{ animationDelay: "0.4s" }}
              data-nailed-it={nailedIt ? "1" : "0"}
            >
              🎯 {nailedIt ? "nailed it" : "top guess"}
            </span>
          )}
        </div>
        <p className="text-sm text-foreground/80 italic whitespace-pre-wrap break-words leading-relaxed">
          &ldquo;{guess.guess}&rdquo;
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xl sm:text-2xl font-heading font-black font-mono tabular-nums">
          +{score}
        </p>
        <p className="text-[10px] sm:text-xs text-muted-foreground">
          {guess.subject_score}s · {guess.style_score}y · {guess.semantic_score}m · {guess.speed_bonus}b
        </p>
      </div>
    </li>
  );
}

function LeaderboardRow({
  rank,
  player,
}: {
  rank: number;
  player: Player;
}) {
  const score = useAnimatedNumber(player.score, 1200);
  return (
    <li className="flex items-center gap-3 rounded-xl px-3 py-2 bg-muted text-foreground">
      <span className="w-6 text-center font-black opacity-70">{rank}</span>
      <span
        className="player-chip h-8 w-8 shrink-0 text-sm"
        style={{
          ["--chip-color" as string]: colorForPlayer(player.player_id),
        } as React.CSSProperties}
      >
        {player.display_name[0]?.toUpperCase()}
      </span>
      <span className="flex-1 font-semibold truncate">{player.display_name}</span>
      <span className="font-heading font-black font-mono text-xl tabular-nums">
        {score}
      </span>
    </li>
  );
}

function PlayAgainControls({ room, isHost }: { room: Room; isHost: boolean }) {
  const [advanced, setAdvanced] = useState(false);
  const [maxRounds, setMaxRounds] = useState(room.max_rounds);
  const [guessSeconds, setGuessSeconds] = useState(room.guess_seconds);
  const [revealSeconds, setRevealSeconds] = useState(room.reveal_seconds);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef(createSupabaseBrowserClient());

  async function playAgain() {
    setLoading(true);
    setError(null);
    const supabase = supabaseRef.current;
    const { error: err } = await supabase.rpc("play_again", {
      p_room_id: room.id,
      p_max_rounds: maxRounds,
      p_guess_seconds: guessSeconds,
      p_reveal_seconds: revealSeconds,
    });
    if (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (!isHost) {
    return (
      <p className="text-sm opacity-80 mt-4 text-center">
        Waiting for the host to start another game…
      </p>
    );
  }

  return (
    <div className="w-full flex flex-col gap-3 mt-4">
      {advanced && (
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted p-3">
          <NumField
            label="Rounds"
            value={maxRounds}
            min={1}
            max={20}
            onChange={setMaxRounds}
          />
          <NumField
            label="Guess (s)"
            value={guessSeconds}
            min={15}
            max={120}
            onChange={setGuessSeconds}
          />
          <NumField
            label="Reveal (s)"
            value={revealSeconds}
            min={5}
            max={30}
            onChange={setRevealSeconds}
          />
        </div>
      )}
      <div className="flex items-center gap-3 justify-center">
        <Button
          onClick={playAgain}
          disabled={loading}
          className="font-bold text-lg px-8 py-6 rounded-2xl"
        >
          {loading ? "Resetting…" : "Play Again"}
        </Button>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="text-xs opacity-80 hover:opacity-100 underline-offset-4 hover:underline"
        >
          {advanced ? "hide settings" : "adjust settings"}
        </button>
      </div>
      {error && (
        <div className="game-card bg-destructive/20 border-destructive text-destructive-foreground p-4 text-sm text-center">
          {error}
        </div>
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="space-y-1 block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.trunc(n))));
        }}
        className="w-full bg-background border border-input rounded-lg text-foreground text-center font-mono h-9 px-2"
      />
    </label>
  );
}

function ArtistPromptingView({
  room,
  currentRound,
  iAmArtist,
  artist,
  remaining,
}: {
  room: Room;
  currentRound: Round | null;
  iAmArtist: boolean;
  artist: Player | undefined;
  remaining: number;
}) {
  const [prompt, setPrompt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!currentRound?.id) return;
    const text = prompt.trim();
    if (text.length < 4) {
      setError("at least 4 characters");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/submit-artist-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round_id: currentRound.id, prompt: text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || body.error || `status ${res.status}`);
        setSubmitting(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  if (iAmArtist) {
    return (
      <section className="w-full max-w-2xl flex flex-col items-center gap-4">
        <div className="flex items-center justify-between w-full">
          <p className="text-lg font-semibold opacity-90">
            You&rsquo;re the artist this round ✨
          </p>
          <p className="text-3xl font-black font-mono">{remaining}s</p>
        </div>
        <p className="text-sm opacity-80 text-center">
          Write a secret prompt. Keep it guessable but not too easy — you score
          the average of everyone&rsquo;s guesses.
        </p>
        {submitting ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="h-14 w-14 rounded-full border-4 border-muted border-t-foreground animate-spin" />
            <p className="font-bold">Sending to the AI…</p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="w-full flex flex-col gap-3"
          >
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="A raccoon delivering mail by bicycle in a watercolor cityscape at dusk..."
              maxLength={240}
              rows={4}
              autoFocus
              className="text-lg rounded-xl min-h-[120px] resize-y leading-relaxed p-4"
            />
            <div className="flex items-center justify-between text-xs opacity-70">
              <span>{prompt.length}/240</span>
              <span>⌘/Ctrl + Enter to send</span>
            </div>
            {error && (
              <div className="game-card bg-destructive/20 border-destructive text-destructive-foreground p-4 text-sm">
                {error}
              </div>
            )}
            <Button
              type="submit"
              disabled={prompt.trim().length < 4}
              className="font-bold h-14 px-8 rounded-xl text-lg"
            >
              Send to the AI
            </Button>
          </form>
        )}
      </section>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-16 max-w-md text-center">
      <div className="h-20 w-20 rounded-full border-4 border-muted border-t-foreground animate-spin" />
      <p className="text-xl font-bold">
        {artist?.display_name ?? "The artist"} is cooking something up…
      </p>
      <p className="opacity-70 text-sm">
        When they&rsquo;re done, we&rsquo;ll see the AI&rsquo;s take.
      </p>
      {room.phase_ends_at && (
        <p className="text-2xl font-black font-mono opacity-90">{remaining}s</p>
      )}
    </div>
  );
}
