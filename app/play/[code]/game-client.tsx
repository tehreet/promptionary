"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAnimatedNumber } from "@/lib/animation";
import { RoomChannelProvider, useRoomChannel } from "@/lib/room-channel";
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
  playTick,
  playWinnerCheer,
} from "@/lib/sfx";
import { PromptFlipboard, type PromptToken } from "@/components/prompt-flipboard";
import { pickExamplePrompt } from "@/lib/example-prompts";
import { HostControls } from "@/components/host-controls";
import { LoadingPhrases } from "@/components/loading-phrases";
import {
  RoundHighlightsCarousel,
  type RoundHighlight,
} from "@/components/round-highlights-carousel";
import { CopyRecapLink } from "./recap/copy-recap-link";

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
  skip_count?: number;
};

// Matches MAX_SKIPS_PER_ROUND in /api/skip-round — kept in sync by hand.
const MAX_SKIPS_PER_ROUND = 2;

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
  chosen_modifier?: string | null;
  chosen_modifier_spectator_id?: string | null;
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
  const [autoSubmitFired, setAutoSubmitFired] = useState<boolean>(false);
  const [guessesFromReveal, setGuessesFromReveal] = useState<Guess[]>([]);
  const [promptTokens, setPromptTokens] = useState<PromptToken[]>([]);
  const [highlights, setHighlights] = useState<RoundHighlight[]>([]);
  const [submissionCount, setSubmissionCount] = useState<number>(0);
  const [spectatorVotes, setSpectatorVotes] = useState<
    Array<{ spectator_id: string; voted_player_id: string }>
  >([]);
  const [myVoteSubmitting, setMyVoteSubmitting] = useState<boolean>(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  // Spectator modifier pool for the CURRENT round. One of these will get
  // randomly picked and appended to next round's prompt. Resets when
  // round_num changes.
  const [modifiers, setModifiers] = useState<
    Array<{ id: string; spectator_id: string; modifier: string }>
  >([]);
  // Skip-vote tally. Stored as voter_ids so we can dedupe optimistic updates
  // against broadcast echoes + postgres_changes fetches.
  const [skipVoters, setSkipVoters] = useState<string[]>([]);
  const [skipSubmitting, setSkipSubmitting] = useState<boolean>(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const skipTriggeredRef = useRef<string | null>(null);
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
          "id, code, phase, host_id, mode, teams_enabled, max_rounds, guess_seconds, reveal_seconds, round_num, phase_ends_at, skip_count",
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
              setAutoSubmitFired(false);
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
            setAutoSubmitFired(false);
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

  // Host advances when the reveal timer genuinely expires. Reading
  // phase_ends_at directly avoids a render race: when phase flips from
  // scoring → reveal, useCountdown's `remaining` stays at 0 for one render
  // before catching up to the new phase_ends_at. If we keyed off
  // `remaining`, we'd fire instantly and reveal would last ~1 second.
  //
  // On the final round, the room has already accrued all its scores; we
  // just flip phase to game_over (the finalize-round route already did the
  // lifetime stats bump). Otherwise we start the next round.
  useEffect(() => {
    if (!isHost) return;
    if (room.phase !== "reveal") return;
    if (!room.phase_ends_at) return;
    if (new Date(room.phase_ends_at).getTime() > Date.now()) return;
    const key = `${room.id}-${room.round_num}`;
    if (revealAdvanceRef.current === key) return;
    revealAdvanceRef.current = key;
    const isFinalRound = room.round_num >= room.max_rounds;
    const roundIdForResolve = currentRound?.id;
    (async () => {
      try {
        const supabase = supabaseRef.current;
        // Resolve spectator votes before advancing so the +5 bonus lands on
        // this round's scores. Idempotent via sentinel guard in the RPC — safe
        // to call even when there were no spectators or no tie.
        if (roundIdForResolve) {
          await supabase.rpc("resolve_spectator_votes", {
            p_round_id: roundIdForResolve,
          });
        }
        if (isFinalRound) {
          await supabase
            .from("rooms")
            .update({ phase: "game_over", phase_ends_at: null })
            .eq("id", room.id);
        } else {
          await supabase.rpc("start_round", { p_room_id: room.id });
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [
    isHost,
    room.phase,
    room.phase_ends_at,
    remaining,
    room.id,
    room.round_num,
    room.max_rounds,
    currentRound?.id,
  ]);

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

  // Fetch every round's prompt, image, tokens, and top guess when the game
  // ends, for the highlights carousel above the final leaderboard.
  useEffect(() => {
    if (room.phase !== "game_over") return;
    let cancel = false;
    (async () => {
      const supabase = supabaseRef.current;
      const { data: rounds } = await supabase
        .from("rounds_public")
        .select("id, round_num, prompt, image_url, artist_player_id")
        .eq("room_id", room.id)
        .order("round_num", { ascending: true });
      if (cancel || !rounds || rounds.length === 0) return;

      const roundIds = rounds.map((r) => r.id).filter((x): x is string => !!x);
      if (roundIds.length === 0) return;

      const [{ data: tokens }, { data: guesses }] = await Promise.all([
        supabase
          .from("round_prompt_tokens")
          .select("round_id, position, token, role")
          .in("round_id", roundIds),
        supabase
          .from("guesses")
          .select("id, round_id, player_id, guess, total_score")
          .in("round_id", roundIds)
          .order("total_score", { ascending: false }),
      ]);
      if (cancel) return;

      const tokensByRound = new Map<string, PromptToken[]>();
      for (const t of (tokens ?? []) as Array<{
        round_id: string;
        position: number;
        token: string;
        role: PromptToken["role"];
      }>) {
        const arr = tokensByRound.get(t.round_id) ?? [];
        arr.push({ position: t.position, token: t.token, role: t.role });
        tokensByRound.set(t.round_id, arr);
      }

      const topByRound = new Map<
        string,
        { id: string; player_id: string; guess: string; total_score: number }
      >();
      for (const g of (guesses ?? []) as Array<{
        id: string;
        round_id: string;
        player_id: string;
        guess: string;
        total_score: number;
      }>) {
        // guesses are pre-sorted desc by total_score; first write per round
        // is the top guess.
        if (!topByRound.has(g.round_id)) {
          topByRound.set(g.round_id, {
            id: g.id,
            player_id: g.player_id,
            guess: g.guess,
            total_score: g.total_score,
          });
        }
      }

      const built: RoundHighlight[] = rounds
        .filter((r) => r.id)
        .map((r) => ({
          round_id: r.id!,
          round_num: r.round_num ?? 0,
          prompt: r.prompt ?? null,
          image_url: r.image_url ?? null,
          artist_player_id: r.artist_player_id ?? null,
          tokens: tokensByRound.get(r.id!) ?? [],
          top_guess: topByRound.get(r.id!) ?? null,
        }));
      setHighlights(built);
    })();
    return () => {
      cancel = true;
    };
  }, [room.phase, room.id]);

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
        // Hex resolved from the new brand palette: pink (--game-pink),
        // cyan (--game-cyan), canvas yellow (--game-canvas-yellow), cream.
        // canvas-confetti doesn't pick up CSS vars at runtime — these must
        // stay literal and kept in sync with app/globals.css by hand.
        colors: ["#ff5eb4", "#3ddce0", "#ffe15e", "#fff7d6"],
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
        // Same palette as the reveal burst plus the ink-soft purple.
        // canvas-confetti can't read CSS vars — hex must be updated by
        // hand if the game tokens ever move.
        colors: ["#ff5eb4", "#3ddce0", "#ffe15e", "#fff7d6", "#3d2a7d"],
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

  // Clock tick sfx in the last 5 seconds of guessing. Fires once per whole
  // second so re-renders inside the same second don't double-play. Ref keyed
  // off the round id so a new round starts from a clean slate.
  const lastTickSecondRef = useRef<{ roundId: string; second: number } | null>(
    null,
  );
  useEffect(() => {
    if (room.phase !== "guessing") return;
    if (!currentRound?.id) return;
    if (remaining <= 0 || remaining > 5) return;
    const ref = lastTickSecondRef.current;
    if (ref && ref.roundId === currentRound.id && ref.second === remaining) {
      return;
    }
    lastTickSecondRef.current = { roundId: currentRound.id, second: remaining };
    playTick();
  }, [room.phase, remaining, currentRound?.id]);

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
      setAutoSubmitFired(false);
    }
  }, [currentRound?.id, myGuess]);

  // Auto-submit whatever's in the textarea when the guess timer is almost out.
  // Fires at ~800ms left — just enough server-skew headroom to beat the
  // server's "phase_ends_at > now()" check while letting the player keep
  // typing as long as possible.
  useEffect(() => {
    if (room.phase !== "guessing") return;
    if (guessSubmitted) return;
    if (isSpectator) return;
    if (!currentRound?.id) return;
    if (autoSubmittedRef.current === currentRound.id) return;
    if (!myGuess.trim()) return;
    if (!room.phase_ends_at) return;
    const msLeft = new Date(room.phase_ends_at).getTime() - Date.now();
    if (msLeft > 800) return;
    autoSubmittedRef.current = currentRound.id;
    setAutoSubmitFired(true);
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
  const myTeam = useMemo(() => {
    const me = players.find((p) => p.player_id === currentPlayerId);
    return me?.team ?? null;
  }, [players, currentPlayerId]);
  // Team chat is the right default during active rounds — teammates need a
  // private channel to coordinate while the round is live. On reveal /
  // game_over we fall back to room-wide so everyone can debrief together.
  const teamChatActive =
    isTeams &&
    !isSpectator &&
    typeof myTeam === "number" &&
    ["generating", "guessing", "prompting", "scoring"].includes(room.phase);
  // Tiebreaker: top two guesses within 5 pts AND both > 0. Spectators get a
  // vote UI; players see a "spectators are voting" badge. Vote window = the
  // existing reveal_seconds, no extension.
  const tiebreaker = useMemo(() => {
    if (room.phase !== "reveal") return null;
    if (guessesFromReveal.length < 2) return null;
    const top1 = guessesFromReveal[0];
    const top2 = guessesFromReveal[1];
    if (top1.total_score <= 0 || top2.total_score <= 0) return null;
    if (top1.total_score - top2.total_score > 5) return null;
    return { top1, top2 };
  }, [room.phase, guessesFromReveal]);
  const hasSpectators = spectators.length > 0;
  const tiebreakerActive = !!tiebreaker && hasSpectators;
  const myVote = useMemo(
    () =>
      spectatorVotes.find((v) => v.spectator_id === currentPlayerId)?.voted_player_id ?? null,
    [spectatorVotes, currentPlayerId],
  );
  const voteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of spectatorVotes) {
      counts.set(v.voted_player_id, (counts.get(v.voted_player_id) ?? 0) + 1);
    }
    return counts;
  }, [spectatorVotes]);

  // Subscribe to spectator_modifiers for the current round so the pill-
  // chip pool updates live for everyone (spectators watching their own
  // contributions land, competitors peeking at what's incoming). Poll as
  // a fallback when postgres_changes misses an event.
  useEffect(() => {
    if (room.round_num <= 0) {
      setModifiers([]);
      return;
    }
    // Modifiers contributed DURING this round land on the next round's
    // prompt — the pool display follows round_num, not phase.
    const supabase = supabaseRef.current;
    let cancel = false;
    const fetchMods = async () => {
      const { data } = await supabase
        .from("spectator_modifiers")
        .select("id, spectator_id, modifier")
        .eq("room_id", room.id)
        .eq("round_num", room.round_num)
        .order("created_at", { ascending: true });
      if (!cancel && data) {
        setModifiers(
          data as Array<{ id: string; spectator_id: string; modifier: string }>,
        );
      }
    };
    fetchMods();
    const poll = setInterval(fetchMods, 2000);
    const ch = supabase
      .channel(`room-${room.id}-modifiers-${room.round_num}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "spectator_modifiers",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            round_num: number;
            spectator_id: string;
            modifier: string;
          };
          if (row.round_num !== room.round_num) return;
          setModifiers((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [
              ...prev,
              {
                id: row.id,
                spectator_id: row.spectator_id,
                modifier: row.modifier,
              },
            ];
          });
        },
      )
      .subscribe();
    return () => {
      cancel = true;
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [room.id, room.round_num]);

  // Subscribe to spectator_votes for this round so the tally updates live.
  useEffect(() => {
    if (room.phase !== "reveal") {
      setSpectatorVotes([]);
      setVoteError(null);
      return;
    }
    if (!currentRound?.id) return;
    const supabase = supabaseRef.current;
    let cancel = false;
    const fetchVotes = async () => {
      const { data } = await supabase
        .from("spectator_votes")
        .select("spectator_id, voted_player_id")
        .eq("round_id", currentRound.id);
      if (!cancel && data) {
        // Filter out the sentinel resolution marker (all-zero UUIDs).
        const ZERO = "00000000-0000-0000-0000-000000000000";
        setSpectatorVotes(
          (data as Array<{ spectator_id: string; voted_player_id: string }>)
            .filter((v) => v.spectator_id !== ZERO),
        );
      }
    };
    fetchVotes();
    const poll = setInterval(fetchVotes, 1500);
    return () => {
      cancel = true;
      clearInterval(poll);
    };
  }, [room.phase, currentRound?.id]);

  // Skip-vote tally lives only during the guessing phase. Fetch on mount +
  // poll every 2s as the postgres_changes backstop; the broadcast echo
  // handles the fast path for live tabs.
  useEffect(() => {
    if (room.phase !== "guessing") {
      setSkipVoters([]);
      setSkipError(null);
      setSkipSubmitting(false);
      return;
    }
    if (!currentRound?.id) return;
    const supabase = supabaseRef.current;
    let cancel = false;
    const fetchVotes = async () => {
      const { data } = await supabase
        .from("skip_votes")
        .select("voter_id")
        .eq("round_id", currentRound.id);
      if (!cancel && data) {
        setSkipVoters(
          (data as Array<{ voter_id: string }>).map((v) => v.voter_id),
        );
      }
    };
    fetchVotes();
    const poll = setInterval(fetchVotes, 2000);
    return () => {
      cancel = true;
      clearInterval(poll);
    };
  }, [room.phase, currentRound?.id]);

  // Eligible voters = non-spectators, minus the artist on artist rounds.
  // Same denominator used by the skip-round endpoint server-side.
  const skipEligibleCount = useMemo(() => {
    let n = players.filter((p) => !p.is_spectator).length;
    if (
      currentRound?.artist_player_id &&
      players.some(
        (p) =>
          !p.is_spectator &&
          p.player_id === currentRound.artist_player_id,
      )
    ) {
      n = Math.max(0, n - 1);
    }
    return n;
  }, [players, currentRound?.artist_player_id]);
  const skipNeeded = Math.max(1, Math.ceil(skipEligibleCount / 2));
  const skipCountUsed = room.skip_count ?? 0;
  const canVoteToSkip =
    room.phase === "guessing" &&
    !isSpectator &&
    !iAmArtist &&
    !!currentRound?.id &&
    skipCountUsed < MAX_SKIPS_PER_ROUND;
  const alreadyVotedSkip = skipVoters.includes(currentPlayerId);

  const castSkipVote = useCallback(async () => {
    if (!currentRound?.id) return;
    if (alreadyVotedSkip) return;
    setSkipSubmitting(true);
    setSkipError(null);
    const supabase = supabaseRef.current;
    // Optimistic bump so the tally lands instantly on the voter's tab.
    setSkipVoters((prev) =>
      prev.includes(currentPlayerId) ? prev : [...prev, currentPlayerId],
    );
    const { error } = await supabase.rpc("cast_skip_vote", {
      p_round_id: currentRound.id,
    });
    if (error) {
      setSkipError(error.message);
      // Roll back the optimistic add on failure.
      setSkipVoters((prev) => prev.filter((id) => id !== currentPlayerId));
    }
    setSkipSubmitting(false);
  }, [currentRound?.id, alreadyVotedSkip, currentPlayerId]);

  // Broadcast + receive skip-vote pings on the shared live channel so every
  // tab's tally lands sub-second without waiting on the 2s poll. The DB is
  // still the source of truth — broadcast is just a speed boost.
  const { channel: liveChannel } = useRoomChannel();
  useEffect(() => {
    if (!liveChannel) return;
    const handler = (payload: {
      payload?: { round_id?: string; voter_id?: string };
    }) => {
      const p = payload?.payload ?? {};
      if (!p.round_id || !p.voter_id) return;
      if (!currentRound?.id || p.round_id !== currentRound.id) return;
      const id = p.voter_id;
      setSkipVoters((prev) => (prev.includes(id) ? prev : [...prev, id]));
    };
    liveChannel.on("broadcast", { event: "skip-vote" }, handler);
    // Supabase JS doesn't expose per-handler removal on a shared channel;
    // the channel itself is torn down when RoomChannelProvider unmounts.
    // The handler early-returns on stale rounds so a leftover listener is
    // harmless.
  }, [liveChannel, currentRound?.id]);

  // Fires exactly one broadcast per successful cast on this tab.
  const lastBroadcastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!liveChannel) return;
    if (!currentRound?.id) return;
    if (!alreadyVotedSkip) return;
    const key = `${currentRound.id}:${currentPlayerId}`;
    if (lastBroadcastRef.current === key) return;
    lastBroadcastRef.current = key;
    liveChannel.send({
      type: "broadcast",
      event: "skip-vote",
      payload: { round_id: currentRound.id, voter_id: currentPlayerId },
    });
  }, [liveChannel, currentRound?.id, alreadyVotedSkip, currentPlayerId]);

  // When the skip threshold is reached, any tab POSTs /api/skip-round. The
  // endpoint is idempotent (atomic phase flip from guessing → generating
  // gates a single winner; losers get `raced: true`).
  useEffect(() => {
    if (room.phase !== "guessing") return;
    if (!currentRound?.id) return;
    if (skipTriggeredRef.current === currentRound.id) return;
    if (skipCountUsed >= MAX_SKIPS_PER_ROUND) return;
    if (skipEligibleCount <= 0) return;
    if (skipVoters.length < skipNeeded) return;
    skipTriggeredRef.current = currentRound.id;
    (async () => {
      try {
        await fetch("/api/skip-round", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ round_id: currentRound.id }),
        });
      } catch (e) {
        console.error("[skip-round]", e);
      }
    })();
  }, [
    room.phase,
    currentRound?.id,
    skipVoters.length,
    skipNeeded,
    skipEligibleCount,
    skipCountUsed,
  ]);

  const castVote = useCallback(
    async (playerId: string) => {
      if (!currentRound?.id) return;
      if (myVote) return;
      setMyVoteSubmitting(true);
      setVoteError(null);
      const supabase = supabaseRef.current;
      const { error } = await supabase.rpc("cast_spectator_vote", {
        p_round_id: currentRound.id,
        p_voted_player_id: playerId,
      });
      if (error) {
        setVoteError(error.message);
      } else {
        // Optimistic local update — the poll will confirm it shortly.
        setSpectatorVotes((prev) => {
          if (prev.some((v) => v.spectator_id === currentPlayerId)) return prev;
          return [
            ...prev,
            { spectator_id: currentPlayerId, voted_player_id: playerId },
          ];
        });
      }
      setMyVoteSubmitting(false);
    },
    [currentRound?.id, myVote, currentPlayerId],
  );

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
    <LiveCursorsOverlay>
      <main className="min-h-screen flex flex-col items-center gap-6 px-6 py-10 game-canvas">
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
                      phase={room.phase}
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
              {isSpectator && (
                <SpectatorModifierInput
                  roomId={room.id}
                  roundNum={room.round_num}
                  modifiers={modifiers}
                  currentPlayerId={currentPlayerId}
                />
              )}
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
            <span
              className={`marquee-pill${
                remaining > 0 && remaining <= 5 ? " marquee-pill--urgent" : ""
              }`}
              data-urgent={remaining > 0 && remaining <= 5 ? "1" : undefined}
            >
              <span className="live-dot" aria-hidden />
              {remaining}s
            </span>
          </div>
          {currentRound?.image_url && (
            <div className="game-frame bg-[var(--game-paper)] p-2 inline-block">
              <img
                src={currentRound.image_url}
                alt="Round painting"
                className="rounded-[10px] block max-w-full h-auto"
              />
            </div>
          )}
          {currentRound?.image_url && canVoteToSkip && (
            <div
              data-skip-vote="1"
              className="w-full flex flex-col items-center gap-1"
            >
              <button
                type="button"
                onClick={castSkipVote}
                disabled={alreadyVotedSkip || skipSubmitting}
                className="text-xs font-bold uppercase tracking-wider rounded-full border-2 border-[color:var(--game-ink)]/40 bg-[var(--game-paper)] text-[var(--game-ink)] px-3 py-1 hover:-translate-y-0.5 transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {alreadyVotedSkip
                  ? `Voted to skip · ${skipVoters.length}/${skipNeeded}`
                  : `Skip this one · ${skipVoters.length}/${skipNeeded}`}
              </button>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Skips used {skipCountUsed}/{MAX_SKIPS_PER_ROUND}
              </p>
              {skipError && (
                <p role="alert" className="text-[11px] text-red-600">
                  {skipError}
                </p>
              )}
            </div>
          )}
          {currentRound?.image_url &&
            !canVoteToSkip &&
            (isSpectator || iAmArtist) &&
            skipVoters.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {skipVoters.length}/{skipNeeded} voted to skip
              </div>
            )}
          {currentRound?.image_url &&
            skipCountUsed >= MAX_SKIPS_PER_ROUND &&
            !isSpectator &&
            !iAmArtist && (
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Skip cap reached ({MAX_SKIPS_PER_ROUND}/{MAX_SKIPS_PER_ROUND})
              </div>
            )}
          {isSpectator ? (
            <>
              <div className="w-full bg-card text-card-foreground border border-border shadow-sm rounded-2xl p-4 text-center">
                <p className="font-bold">Spectating — guesses are hidden until reveal.</p>
              </div>
              <SpectatorModifierInput
                roomId={room.id}
                roundNum={room.round_num}
                modifiers={modifiers}
                currentPlayerId={currentPlayerId}
              />
            </>
          ) : iAmArtist ? (
            <div className="w-full bg-card text-card-foreground border border-border shadow-sm rounded-2xl p-4 text-center">
              <p className="font-bold">You wrote this one — watch the guesses come in ✨</p>
            </div>
          ) : guessSubmitted ? (
            <div className="w-full bg-card text-card-foreground border border-border shadow-sm rounded-2xl p-4 text-center">
              {autoSubmitFired ? (
                <p className="font-bold inline-flex items-center gap-2 justify-center text-primary">
                  <span
                    aria-hidden="true"
                    className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse"
                  />
                  <span>Locking in your guess…</span>
                </p>
              ) : (
                <p className="font-bold">Guess in! Waiting on the rest…</p>
              )}
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
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (myGuess.trim()) submitGuess();
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
                <span className="hidden sm:inline">Enter to submit · Shift+Enter for newline</span>
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

      {room.phase === "reveal" && (
        <section className="w-full max-w-2xl flex flex-col items-center gap-5">
          <p className="text-sm opacity-80">
            Next round in <span className="font-mono font-black">{remaining}s</span>
          </p>
          <ReactionsBarWrapper />

          {currentRound?.chosen_modifier && (
            <ChosenModifierBadge
              modifier={currentRound.chosen_modifier}
              spectator={
                currentRound.chosen_modifier_spectator_id
                  ? playerById.get(currentRound.chosen_modifier_spectator_id)
                  : undefined
              }
            />
          )}
          {currentRound?.image_url && (
            <div className="game-frame bg-[var(--game-paper)] p-2 inline-block relative">
              <img
                src={currentRound.image_url}
                alt="Round"
                className="rounded-[10px] block max-w-full h-auto"
              />
              {currentRound.id && (
                <div className="absolute top-3 right-3">
                  <ShareRoundButton roundId={currentRound.id} />
                </div>
              )}
            </div>
          )}
          {currentRound?.prompt && (
            <PromptFlipboard
              prompt={currentRound.prompt}
              tokens={promptTokens}
            />
          )}
          {modifiers.length > 0 && (
            <ModifierPoolStrip modifiers={modifiers} />
          )}
          {tiebreakerActive && tiebreaker && (
            <SpectatorTiebreaker
              top1={tiebreaker.top1}
              top2={tiebreaker.top2}
              top1Player={playerById.get(tiebreaker.top1.player_id)}
              top2Player={playerById.get(tiebreaker.top2.player_id)}
              isSpectator={isSpectator}
              myVote={myVote}
              voteCounts={voteCounts}
              totalVotes={spectatorVotes.length}
              onVote={castVote}
              submitting={myVoteSubmitting}
              error={voteError}
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
        </section>
      )}

      {room.phase === "game_over" && (
        <section className="w-full max-w-5xl flex flex-col items-center gap-6">
          <ReactionsBarWrapper />

          <RoundHighlightsCarousel
            highlights={highlights}
            players={players.map((p) => ({
              player_id: p.player_id,
              display_name: p.display_name,
            }))}
          />

          <div className="w-full max-w-2xl flex flex-col items-center gap-5">
            {isTeams ? (
              <div
                data-team-final="1"
                className="w-full space-y-4 mt-4"
              >
                <p className="text-center text-xs uppercase tracking-widest opacity-70">
                  Final team leaderboard
                </p>
                <ul className="space-y-3">
                  {teamLeaderboard.map((t, i) => (
                    <li
                      key={t.team}
                      data-team-rank={i + 1}
                      className="game-card bg-[var(--game-paper)] p-4 relative overflow-hidden"
                      style={{
                        transform: i === 0 ? "rotate(2deg)" : undefined,
                      }}
                    >
                      <span
                        aria-hidden
                        className="absolute left-0 top-0 bottom-0 w-1"
                        style={{ background: TEAM_META[t.team].color }}
                      />
                      <div className="flex items-baseline justify-between gap-3 pl-2">
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
                          <p className="font-mono font-black text-3xl text-[var(--game-ink)]">
                            {t.avg}
                          </p>
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            avg / member
                          </p>
                        </div>
                      </div>
                      <ul className="mt-3 flex flex-wrap gap-2 pl-2">
                        {t.members
                          .slice()
                          .sort((a, b) => b.score - a.score)
                          .map((m) => (
                            <li
                              key={m.player_id}
                              className="rounded-full bg-[var(--game-paper)] border-2 border-[var(--game-ink)] px-3 py-1 text-xs flex items-center gap-2 text-[var(--game-ink)]"
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
              <div className="w-full mt-4 space-y-3">
                <p className="text-center text-xs uppercase tracking-widest opacity-70">
                  Final leaderboard
                </p>
                <ul className="space-y-3">
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
            <div className="flex items-center justify-center pt-1">
              <CopyRecapLink code={room.code} />
            </div>
          </div>
        </section>
      )}
      <ChatPanel
        roomPhase={room.phase}
        isSpectator={isSpectator}
        variant="floating"
        teamOnly={teamChatActive}
        team={teamChatActive ? myTeam : null}
      />
      </main>
    </LiveCursorsOverlay>
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
          ? "bg-accent border-[color:var(--game-pink)]/60 ring-2 ring-[color:var(--game-pink)]/40"
          : "bg-card text-card-foreground border-border"
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
              className="nailed-pop inline-flex items-center gap-1 rounded-full bg-[color:var(--game-pink)] text-[var(--game-cream)] text-[10px] sm:text-xs font-black uppercase tracking-wider px-2 py-0.5 shadow-sm"
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
  const isWinner = rank === 1;
  return (
    <li
      className="game-card bg-[var(--game-paper)] flex items-center gap-3 px-4 py-3 text-[var(--game-ink)]"
      style={isWinner ? { transform: "rotate(2deg)" } : undefined}
    >
      <span className="w-6 text-center font-black opacity-70">{rank}</span>
      <span
        className="player-chip w-10 h-10 shrink-0 text-sm"
        style={{
          ["--chip-color" as string]: colorForPlayer(player.player_id),
        } as React.CSSProperties}
      >
        {player.display_name.slice(0, 2).toUpperCase()}
      </span>
      <span className="flex-1 font-heading font-bold truncate text-[var(--game-ink)]">
        {player.display_name}
      </span>
      {isWinner ? (
        <span className="game-hero-mark font-mono font-black text-lg tabular-nums">
          {score}
        </span>
      ) : (
        <span className="font-heading font-black font-mono text-xl tabular-nums text-[var(--game-ink)]">
          {score}
        </span>
      )}
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // After an error lands, refocus the textarea so the artist can immediately
  // keep typing / fixing. The form is re-rendered (submitting flipped back to
  // false) so autoFocus on mount doesn't help here.
  useEffect(() => {
    if (error && !submitting) {
      // next tick so the textarea is definitely back in the DOM
      const id = requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          // Move caret to end so typing continues from where they left off.
          const len = ta.value.length;
          try {
            ta.setSelectionRange(len, len);
          } catch {
            // some browsers throw for non-text inputs; textarea is fine but be safe
          }
        }
      });
      return () => cancelAnimationFrame(id);
    }
  }, [error, submitting]);

  async function submit() {
    if (!currentRound?.id) return;
    const text = prompt.trim();
    if (text.length < 4) {
      setError("Write at least 4 characters.");
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
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
        };
        setError(body.detail || body.error || `Something went wrong (${res.status}).`);
        // Keep draft intact — user can tweak and retry.
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
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                // Clear the error on the first keystroke so it doesn't nag.
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (prompt.trim().length >= 4) submit();
                }
              }}
              placeholder={pickExamplePrompt(currentRound?.id ?? "")}
              maxLength={240}
              rows={4}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "artist-prompt-error" : undefined}
              className="text-lg rounded-xl min-h-[120px] resize-y leading-relaxed p-4"
            />
            <div className="flex items-center justify-between text-xs opacity-70">
              <span>{prompt.length}/240</span>
              <span>Enter to send · Shift+Enter for newline</span>
            </div>
            {error && (
              <div
                id="artist-prompt-error"
                role="alert"
                data-artist-error="1"
                className="bg-red-500/15 border border-red-500/30 rounded-xl px-3 py-2 text-sm"
              >
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

function SpectatorTiebreaker({
  top1,
  top2,
  top1Player,
  top2Player,
  isSpectator,
  myVote,
  voteCounts,
  totalVotes,
  onVote,
  submitting,
  error,
}: {
  top1: Guess;
  top2: Guess;
  top1Player: Player | undefined;
  top2Player: Player | undefined;
  isSpectator: boolean;
  myVote: string | null;
  voteCounts: Map<string, number>;
  totalVotes: number;
  onVote: (playerId: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  if (!isSpectator) {
    return (
      <div
        data-tiebreaker-badge="1"
        className="w-full rounded-2xl border-2 border-[color:var(--game-pink)]/60 bg-[color:var(--game-pink)]/10 px-4 py-2 text-center text-sm font-bold text-[color:var(--game-pink)]"
      >
        Spectators are voting! Top two within 5 pts.
        {totalVotes > 0 && (
          <span className="ml-2 font-mono opacity-80">
            {totalVotes} vote{totalVotes === 1 ? "" : "s"} in
          </span>
        )}
      </div>
    );
  }
  const c1 = voteCounts.get(top1.player_id) ?? 0;
  const c2 = voteCounts.get(top2.player_id) ?? 0;
  const voted = !!myVote;
  return (
    <div
      data-tiebreaker-vote="1"
      className="w-full rounded-2xl border-2 border-[color:var(--game-pink)] bg-[color:var(--game-paper)] p-4 flex flex-col gap-3 text-[var(--game-ink)]"
    >
      <p className="text-center text-sm font-black uppercase tracking-widest">
        Who nailed it?
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { guess: top1, player: top1Player, count: c1 },
          { guess: top2, player: top2Player, count: c2 },
        ].map(({ guess, player, count }) => {
          const mine = myVote === guess.player_id;
          return (
            <button
              key={guess.id}
              type="button"
              data-tiebreaker-option={guess.player_id}
              disabled={voted || submitting}
              onClick={() => onVote(guess.player_id)}
              className={`rounded-xl border-2 px-3 py-3 text-left flex flex-col gap-1 transition-transform hover:-translate-y-0.5 disabled:hover:translate-y-0 disabled:opacity-80 disabled:cursor-not-allowed ${
                mine
                  ? "border-[color:var(--game-pink)] bg-[color:var(--game-pink)]/15"
                  : "border-[var(--game-ink)] bg-[var(--game-paper)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="player-chip h-7 w-7 text-xs"
                  style={{
                    ["--chip-color" as string]: colorForPlayer(guess.player_id),
                  } as React.CSSProperties}
                >
                  {player?.display_name[0]?.toUpperCase()}
                </span>
                <span className="font-heading font-black text-sm truncate">
                  {player?.display_name ?? "—"}
                </span>
                <span className="ml-auto font-mono font-black text-sm">
                  {guess.total_score}
                </span>
              </div>
              <p className="text-xs italic opacity-80 line-clamp-2">
                &ldquo;{guess.guess}&rdquo;
              </p>
              <p className="text-[10px] uppercase tracking-widest opacity-70">
                {count} vote{count === 1 ? "" : "s"}
                {mine ? " · your vote" : ""}
              </p>
            </button>
          );
        })}
      </div>
      {voted ? (
        <p className="text-center text-xs opacity-80">
          Thanks — waiting for other spectators.
        </p>
      ) : (
        <p className="text-center text-xs opacity-70">
          Majority wins the winning guess a +5 bonus.
        </p>
      )}
      {error && (
        <p role="alert" className="text-center text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

// Tiny overlay badge pinned to the round image during reveal/game_over that
// copies a link to /r/<round_id>. Kept non-invasive on purpose — the share
// page itself is where viewers land.
// Spectator-only input card. Spectators can throw up to 3 short prompt
// modifiers per round; one is randomly picked and appended to the NEXT
// round's prompt (party or artist). Shows the caller's own contributions
// under the input so they can see their submissions landed.
function SpectatorModifierInput({
  roomId,
  roundNum,
  modifiers,
  currentPlayerId,
}: {
  roomId: string;
  roundNum: number;
  modifiers: Array<{ id: string; spectator_id: string; modifier: string }>;
  currentPlayerId: string;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const myMods = useMemo(
    () => modifiers.filter((m) => m.spectator_id === currentPlayerId),
    [modifiers, currentPlayerId],
  );
  const atLimit = myMods.length >= 3;
  const canSubmit = !submitting && !atLimit && value.trim().length > 0;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/submit-modifier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          round_num: roundNum,
          modifier: value.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(body.detail || body.error || `status ${res.status}`);
      } else {
        setValue("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, roomId, roundNum, value]);

  return (
    <div
      data-spectator-modifier-input="1"
      className="w-full bg-card text-card-foreground border-2 border-[color:var(--game-pink)]/60 shadow-sm rounded-2xl p-4 flex flex-col gap-3 text-left"
    >
      <div className="flex items-center gap-2">
        <span className="text-lg" aria-hidden>
          🌀
        </span>
        <p className="font-heading font-black text-sm uppercase tracking-wider">
          Throw a curveball
        </p>
        <span className="ml-auto text-[10px] uppercase tracking-widest opacity-70 font-mono">
          {myMods.length}/3
        </span>
      </div>
      <p className="text-xs opacity-80">
        Your modifier may get appended to the next round&rsquo;s prompt.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={60}
          disabled={atLimit || submitting}
          placeholder="e.g., in neon colors, underwater, at 3am"
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
          aria-label="Suggest a modifier for the next round"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] opacity-60 font-mono">
            {value.length}/60
          </span>
          <Button
            type="submit"
            disabled={!canSubmit}
            className="h-9 px-4 rounded-xl text-sm font-bold"
          >
            {submitting ? "Sending…" : atLimit ? "Limit reached" : "Send"}
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {myMods.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {myMods.map((m) => (
            <span
              key={m.id}
              data-my-modifier="1"
              className="inline-flex items-center rounded-full bg-[color:var(--game-pink)]/15 border border-[color:var(--game-pink)]/40 px-2.5 py-1 text-[11px] font-semibold text-[color:var(--game-pink)] max-w-full"
            >
              <span className="truncate">{m.modifier}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact strip of chips shown above the round image during reveal so
// everyone can see what shape the next round will take. Capped at last
// 10 by the display; pool itself may be larger.
function ModifierPoolStrip({
  modifiers,
}: {
  modifiers: Array<{ id: string; spectator_id: string; modifier: string }>;
}) {
  const display = modifiers.slice(-10);
  return (
    <div
      data-modifier-pool="1"
      className="w-full rounded-2xl border border-border bg-muted/40 px-4 py-3 flex flex-col gap-2"
    >
      <p className="text-[11px] uppercase tracking-widest font-black opacity-80">
        🌀 Spectator modifiers this round
      </p>
      <div className="flex flex-wrap gap-1.5">
        {display.map((m) => (
          <span
            key={m.id}
            data-modifier-chip="1"
            className="inline-flex items-center rounded-full bg-accent text-accent-foreground px-2.5 py-1 text-[11px] font-semibold max-w-full"
          >
            <span className="truncate">{m.modifier}</span>
          </span>
        ))}
      </div>
      <p className="text-[10px] opacity-60">
        One gets appended to next round&rsquo;s prompt at random.
      </p>
    </div>
  );
}

// Shown on the reveal if a modifier was actually baked into this round's
// prompt (i.e. someone submitted last round). Calls out the spectator
// so their contribution lands visibly.
function ChosenModifierBadge({
  modifier,
  spectator,
}: {
  modifier: string;
  spectator: Player | undefined;
}) {
  return (
    <div
      data-chosen-modifier="1"
      className="w-full rounded-2xl border-2 border-[color:var(--game-pink)]/60 bg-[color:var(--game-pink)]/10 px-4 py-3 flex items-center gap-3 text-[color:var(--game-pink)]"
    >
      <span className="text-lg" aria-hidden>
        🎭
      </span>
      <p className="text-sm font-bold flex-1 flex flex-wrap items-center gap-x-2">
        <span className="uppercase tracking-widest text-[11px] font-black">
          Modifier applied
        </span>
        <span className="italic font-semibold text-foreground">
          &ldquo;{modifier}&rdquo;
        </span>
        {spectator && (
          <span className="text-xs opacity-80">
            from {spectator.display_name}
          </span>
        )}
      </p>
    </div>
  );
}

function ShareRoundButton({ roundId }: { roundId: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/r/${roundId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API may be blocked — silently noop.
    }
  }, [roundId]);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Copy shareable link to this round"
      data-share-round="1"
      className="inline-flex items-center gap-1 rounded-full bg-[var(--game-paper)]/90 border-2 border-[var(--game-ink)] text-[var(--game-ink)] text-[11px] font-black uppercase tracking-wider px-3 py-1 shadow-md hover:-translate-y-0.5 transition-transform"
    >
      {copied ? "Copied" : "Share"}
    </button>
  );
}
