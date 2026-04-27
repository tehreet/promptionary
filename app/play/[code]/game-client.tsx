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
import { chipColorsForPlayer, colorForPlayer } from "@/lib/player";
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
import { ArtLoader } from "@/components/art-loader";
import {
  RoundHighlightsCarousel,
  type RoundHighlight,
} from "@/components/round-highlights-carousel";
import { CopyRecapLink } from "./recap/copy-recap-link";
import { findTabooHit } from "@/lib/taboo-words";

type Room = {
  id: string;
  code: string;
  phase: string;
  host_id: string;
  mode: string;
  teams_enabled?: boolean;
  taboo_enabled?: boolean;
  max_rounds: number;
  guess_seconds: number;
  reveal_seconds: number;
  round_num: number;
  phase_ends_at: string | null;
  skip_count?: number;
  team_turn_passes?: number;
  team_turn_seconds?: number;
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
  // Server's team_prompting_roster() orders by joined_at (then player_id) —
  // we need the same ordering on the client so the "active teammate"
  // highlight matches the RPC's view of whose turn it is. (#58)
  joined_at?: string | null;
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
  taboo_words: string[] | null;
  ended_at: string | null;
  chosen_modifier?: string | null;
  chosen_modifier_spectator_id?: string | null;
  ai_took_over?: boolean | null;
  // Team-prompting fields. Null / 0 on non-team rounds.
  writing_team?: number | null;
  turn_idx?: number | null;
  turn_ends_at?: string | null;
};

type RoundPhrase = {
  round_id: string;
  position: number;
  player_id: string;
  team: number;
  phrase: string;
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
  // Team-prompting round_phrases tally. Position-ordered. Visible to writing
  // team live; to everyone at reveal. RLS enforces the same on the server.
  const [roundPhrases, setRoundPhrases] = useState<RoundPhrase[]>([]);
  // Skip-vote tally. Stored as voter_ids so we can dedupe optimistic updates
  // against broadcast echoes + postgres_changes fetches.
  const [skipVoters, setSkipVoters] = useState<string[]>([]);
  const [skipSubmitting, setSkipSubmitting] = useState<boolean>(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const skipTriggeredRef = useRef<string | null>(null);
  // Persist artist prompt draft across phase bounces (image-gen failure rolls
  // phase back to 'prompting', unmounting ArtistPromptingView and resetting
  // local state before the 502 response reaches the client).
  const artistDraftRef = useRef<{ roundId: string; text: string } | null>(null);
  const isHost = room.host_id === currentPlayerId;

  const competitorCount = useMemo(
    () => players.filter((p) => !p.is_spectator).length,
    [players],
  );
  // Artist-mode guessers = non-spectators excluding the round's artist.
  // Team-prompting (teams_enabled + writing_team): only the OPPOSING team
  // guesses — the writing team is waiting for scoring.
  const guesserCount = competitorCount;
  const submissionTotal = (() => {
    if (currentRound?.writing_team) {
      return players.filter(
        (p) => !p.is_spectator && p.team && p.team !== currentRound.writing_team,
      ).length;
    }
    if (currentRound?.artist_player_id) {
      return Math.max(0, guesserCount - 1);
    }
    return guesserCount || players.length;
  })();
  const generatingCalledRef = useRef<string | null>(null);
  const finalizeCalledRef = useRef<string | null>(null);
  const prefetchCalledRef = useRef<string | null>(null);
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
          "id, code, phase, host_id, mode, teams_enabled, taboo_enabled, max_rounds, guess_seconds, reveal_seconds, round_num, phase_ends_at, skip_count, team_turn_passes, team_turn_seconds",
        )
        .eq("id", room.id)
        .maybeSingle();
      if (r) setRoom((prev) => ({ ...prev, ...(r as Room) }));

      const { data: ps } = await supabase
        .from("room_players")
        .select("player_id, display_name, is_host, is_spectator, score, team, joined_at")
        .eq("room_id", room.id);
      if (ps) setPlayers(ps as Player[]);

      // Always fetch the round matching the CURRENT room.round_num, not the
      // captured currentRound.id. Otherwise a previous round's reveal data
      // can overwrite the new round's state during the transition.
      const targetRoundNum = r?.round_num ?? roundNumRef.current;
      if (targetRoundNum > 0) {
        const { data: rd } = await supabase
          .from("rounds_public")
          .select("id, round_num, prompt, image_url, artist_player_id, taboo_words, ended_at, ai_took_over")
          .eq("room_id", room.id)
          .eq("round_num", targetRoundNum)
          .maybeSingle();
        // Team-prompting columns live on `rounds` (not the public view) so
        // the writing team can see their turn state in real time. Querying
        // both in parallel keeps the poll tick cheap.
        const { data: raw } = await supabase
          .from("rounds")
          .select("id, writing_team, turn_idx, turn_ends_at")
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
            return {
              ...(rd as Round),
              writing_team: raw?.writing_team ?? null,
              turn_idx: raw?.turn_idx ?? 0,
              turn_ends_at: raw?.turn_ends_at ?? null,
            };
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
        .select("id, round_num, prompt, image_url, artist_player_id, taboo_words, ended_at")
        .eq("room_id", room.id)
        .eq("round_num", room.round_num)
        .maybeSingle();
      // Team-prompting columns (writing_team / turn_idx / turn_ends_at) live
      // on the base `rounds` table — fetch them alongside so the watcher
      // view doesn't flicker through an empty-roster state while the 2s poll
      // backfills. (#58)
      const { data: raw } = await supabase
        .from("rounds")
        .select("id, writing_team, turn_idx, turn_ends_at")
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
          return {
            ...(data as Round),
            writing_team: raw?.writing_team ?? null,
            turn_idx: raw?.turn_idx ?? 0,
            turn_ends_at: raw?.turn_ends_at ?? null,
          };
        });
      } else if (!cancel) {
        // Fallback for artist mode: rounds_public may not reveal the artist
        // field if RLS is stricter. Fetch directly.
        const { data: rawFull } = await supabase
          .from("rounds")
          .select("id, round_num, image_url, artist_player_id, taboo_words, ended_at, ai_took_over, writing_team, turn_idx, turn_ends_at")
          .eq("room_id", room.id)
          .eq("round_num", room.round_num)
          .maybeSingle();
        if (rawFull) setCurrentRound({ ...rawFull, prompt: null } as Round);
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
    // Default (party) mode: host drives start-round here.
    // Solo artist mode: the artist already triggered start-round via
    // submit-artist-prompt; skip here.
    // Team-prompting (teams_enabled + artist): the submit_team_phrase RPC
    // flips the room to 'generating' after the last phrase lands, but no
    // client has hit start-round yet — the host's tab drives it here.
    if (room.mode === "artist" && !room.teams_enabled) return;
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
  }, [isHost, room.phase, room.mode, room.teams_enabled, currentRound?.id]);

  // Artist-mode fallback: if the prompting timer expires AND the artist
  // never submitted (currentRound.prompt is still empty), any room member's
  // tab hands the round off to Gemini's party-mode author via
  // /api/artist-gave-up. The server flips phase to 'generating' before
  // the Gemini call, so concurrent callers race harmlessly (second
  // caller 409s at the phase guard). Not gated on isHost — a sleeping
  // host tab used to stall the whole room.
  const artistGaveUpCalledRef = useRef<string | null>(null);
  useEffect(() => {
    if (room.phase !== "prompting") return;
    if (room.mode !== "artist") return;
    if (!currentRound?.id) return;
    if (artistGaveUpCalledRef.current === currentRound.id) return;
    if (!room.phase_ends_at) return;
    // Only fire once the prompting timer is genuinely up. Small skew
    // buffer (mirrors the finalize-round trigger) so client clocks that
    // are a hair ahead don't fire early.
    if (new Date(room.phase_ends_at).getTime() > Date.now()) return;
    // If the artist's prompt already landed, the phase would have advanced
    // to 'generating' — but in case there's a render lag, guard on prompt
    // too. currentRound.prompt is exposed via rounds_public only after
    // reveal, so during prompting it's always null for non-artists; the
    // server endpoint has the authoritative check.
    artistGaveUpCalledRef.current = currentRound.id;
    (async () => {
      try {
        await fetch("/api/artist-gave-up", {
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
    room.mode,
    room.phase_ends_at,
    remaining,
    currentRound?.id,
  ]);

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

  // Speculative pre-generation of round N+1. While players are typing
  // guesses in round N, the server sits idle on the Gemini side. Use that
  // window to author + render the next prompt so /api/start-round for
  // round N+1 becomes a ~1s phase flip instead of a 20-40s wait. Fires
  // ~5s into guessing (past any 2s realtime-poll jitter), once per round,
  // from any room member's tab. The endpoint is advisory-locked at the DB
  // so parallel tabs don't duplicate work. Party mode only; skipped on the
  // last round. Fire-and-forget — errors are logged but never surfaced.
  //
  // We also accept `scoring` as a late-trigger fallback: in fast games
  // (mocked tests, hyper-active players) guessing can flip to scoring
  // before the 5s delay elapses, so a guessing-only gate would miss the
  // window. The endpoint itself gates on phase in ('guessing','scoring')
  // so a late trigger still lands.
  useEffect(() => {
    if (room.phase !== "guessing" && room.phase !== "scoring") return;
    if (room.mode !== "party") return;
    if (room.round_num >= room.max_rounds) return;
    if (!currentRound?.id) return;
    if (prefetchCalledRef.current === currentRound.id) return;
    // Short delay in guessing to let phase_ends_at propagate, fire
    // immediately if we're already in scoring.
    const delay = room.phase === "guessing" ? 3000 : 0;
    const roundIdAtSchedule = currentRound.id;
    const t = setTimeout(() => {
      // Don't set the dedup ref until we actually fire — otherwise a
      // phase flip mid-timer clears this timeout, the effect re-runs with
      // the new phase, and the new run skips because the ref is already
      // marked.
      if (prefetchCalledRef.current === roundIdAtSchedule) return;
      prefetchCalledRef.current = roundIdAtSchedule;
      fetch("/api/prefetch-next-round", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: room.id }),
      }).catch((e) => console.error("[prefetch] trigger failed", e));
    }, delay);
    return () => clearTimeout(t);
  }, [
    room.phase,
    room.mode,
    room.round_num,
    room.max_rounds,
    room.id,
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
          const { data: newRoundId } = await supabase.rpc("start_round", {
            p_room_id: room.id,
          });
          // Seed taboo words for the new artist round if enabled. Non-fatal
          // on failure — round just runs without taboo.
          if (
            room.mode === "artist" &&
            room.taboo_enabled &&
            typeof newRoundId === "string"
          ) {
            fetch("/api/seed-taboo-words", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ round_id: newRoundId }),
            }).catch(() => {});
          }
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
        .select("id, round_num, prompt, image_url, artist_player_id, taboo_words, ai_took_over")
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
          taboo_words: r.taboo_words ?? null,
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

  // round_phrases tally for the team-prompting phase. Polls + realtime.
  // RLS on the table already gates visibility by team, so we can trust
  // whatever rows come back without client-side filtering.
  useEffect(() => {
    if (room.phase !== "prompting") {
      setRoundPhrases([]);
      return;
    }
    if (!currentRound?.id) return;
    if (!room.teams_enabled) return;
    const supabase = supabaseRef.current;
    let cancel = false;
    const fetchPhrases = async () => {
      const { data } = await supabase
        .from("round_phrases")
        .select("round_id, position, player_id, team, phrase")
        .eq("round_id", currentRound.id)
        .order("position", { ascending: true });
      if (!cancel && data) setRoundPhrases(data as RoundPhrase[]);
    };
    fetchPhrases();
    const poll = setInterval(fetchPhrases, 1500);
    const ch = supabase
      .channel(`round-${currentRound.id}-phrases`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "round_phrases",
          filter: `round_id=eq.${currentRound.id}`,
        },
        (payload) => {
          const row = payload.new as RoundPhrase;
          setRoundPhrases((prev) => {
            if (prev.some((p) => p.position === row.position)) return prev;
            return [...prev, row].sort((a, b) => a.position - b.position);
          });
        },
      )
      .subscribe();
    return () => {
      cancel = true;
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [room.phase, room.teams_enabled, currentRound?.id]);

  // Auto-skip expired team turns. Host's tab drives this client-side (no
  // pg_cron). Poll once per second while the turn is overdue — the server's
  // guard only accepts calls where turn_ends_at <= now() server-side, so
  // clock skew between client and server can require a retry or two. (#58)
  useEffect(() => {
    if (room.phase !== "prompting") return;
    if (!room.teams_enabled) return;
    if (!isHost) return;
    if (!currentRound?.id) return;
    if (!currentRound.turn_ends_at) return;
    const roundId = currentRound.id;
    const endsAt = new Date(currentRound.turn_ends_at).getTime();
    const supabase = supabaseRef.current;
    let cancelled = false;
    let inflight = false;
    const maybeSkip = async () => {
      if (cancelled) return;
      if (Date.now() < endsAt) return;
      if (inflight) return;
      inflight = true;
      try {
        await supabase.rpc("skip_team_turn", { p_round_id: roundId });
      } catch {
        // swallow — the next tick will retry if still expired.
      } finally {
        inflight = false;
      }
    };
    // Try once immediately (may be already-expired on mount) then retry every
    // 1s until the effect is torn down by turn_ends_at advancing or the phase
    // flipping to 'generating'.
    maybeSkip();
    const id = setInterval(maybeSkip, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    room.phase,
    room.teams_enabled,
    isHost,
    currentRound?.id,
    currentRound?.turn_ends_at,
  ]);

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
          <ul className="flex gap-2.5 overflow-x-auto overflow-y-hidden pb-3 px-0.5 justify-start sm:justify-center">
            {leaderboard.map((p, i) => {
              const teamColor =
                isTeams && (p.team === 1 || p.team === 2)
                  ? TEAM_META[p.team as 1 | 2].color
                  : null;
              return (
                <li
                  key={p.player_id}
                  data-team={p.team ?? undefined}
                  className="game-card bg-[var(--game-paper)] flex items-center gap-2.5 px-3.5 py-2.5 shrink-0"
                  style={
                    teamColor
                      ? ({ ["--team-accent" as string]: teamColor, outline: `2px solid ${teamColor}` } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span className="text-[11px] opacity-70 font-black w-5 text-right tabular-nums text-[var(--game-ink)]">
                    {i + 1}
                  </span>
                  <span
                    className="player-chip w-8 h-8 text-[11px]"
                    style={(() => {
                      const c = chipColorsForPlayer(p.player_id);
                      return {
                        ["--chip-color" as string]: c.bg,
                        ["--chip-ink" as string]: c.ink,
                      } as React.CSSProperties;
                    })()}
                  >
                    {p.display_name[0]?.toUpperCase()}
                  </span>
                  <span className="font-heading font-bold text-sm text-[var(--game-ink)] truncate max-w-[7rem]">
                    {p.display_name}
                  </span>
                  <span className="font-mono font-black text-sm tabular-nums text-[var(--game-ink)]">
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

      {room.phase === "prompting" && room.teams_enabled && (
        <TeamPromptingView
          room={room}
          currentRound={currentRound}
          players={players}
          currentPlayerId={currentPlayerId}
          myTeam={myTeam}
          phrases={roundPhrases}
          isSpectator={isSpectator}
        />
      )}
      {room.phase === "prompting" && !room.teams_enabled && (
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
          savedDraft={artistDraftRef.current}
          onDraftChange={(roundId, text) => {
            artistDraftRef.current = { roundId, text };
          }}
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
              <ArtLoader size="lg" />
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
                style={(() => {
                  const c = chipColorsForPlayer(currentRound.artist_player_id);
                  return {
                    ["--chip-color" as string]: c.bg,
                    ["--chip-ink" as string]: c.ink,
                  } as React.CSSProperties;
                })()}
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
          ) : currentRound?.writing_team &&
            myTeam === currentRound.writing_team ? (
            <div
              data-team-writer-waiting="1"
              className="w-full bg-card text-card-foreground border border-border shadow-sm rounded-2xl p-4 text-center"
            >
              <p className="font-bold">
                Your team wrote this one — watch the other side guess ✨
              </p>
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
          <ArtLoader size="lg" />
          <p className="text-xl font-bold">Scoring guesses…</p>
        </div>
      )}

      {room.phase === "reveal" && (
        <section className="w-full max-w-2xl flex flex-col items-center gap-5">
          <p className="text-sm opacity-80">
            {room.round_num >= room.max_rounds ? (
              <>Loading leaderboard…</>
            ) : (
              <>
                Next round in{" "}
                <span className="font-mono font-black">{remaining}s</span>
              </>
            )}
          </p>
          <ReactionsBarWrapper />

          {currentRound?.ai_took_over && (
            <div
              data-ai-took-over="1"
              className="inline-flex items-center gap-2 rounded-full border-2 border-[var(--game-ink)] bg-[var(--game-paper)] px-3 py-1 text-xs font-black uppercase tracking-widest text-[var(--game-ink)]"
            >
              <span aria-hidden>🤖</span>
              <span>The AI took over</span>
            </div>
          )}

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
          {currentRound?.taboo_words && currentRound.taboo_words.length > 0 && (
            <div
              data-reveal-taboo="1"
              className="w-full max-w-xl rounded-2xl border-2 border-[var(--game-ink)] bg-[var(--game-paper)] px-4 py-3 flex flex-wrap items-center justify-center gap-2"
            >
              <span className="text-[11px] font-black uppercase tracking-widest text-[var(--game-ink)]/80">
                🚫 They couldn&rsquo;t say
              </span>
              {currentRound.taboo_words.map((w) => (
                <span
                  key={w}
                  className="inline-flex items-center rounded-full border-2 border-red-500/60 bg-red-500/10 px-3 py-0.5 text-[12px] font-black text-red-600 line-through"
                >
                  {w}
                </span>
              ))}
            </div>
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
                                style={(() => {
                                  const c = chipColorsForPlayer(m.player_id);
                                  return {
                                    ["--chip-color" as string]: c.bg,
                                    ["--chip-ink" as string]: c.ink,
                                  } as React.CSSProperties;
                                })()}
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
          ? "bg-accent text-accent-foreground border-[color:var(--game-pink)]/60 ring-2 ring-[color:var(--game-pink)]/40"
          : "bg-card text-card-foreground border-border"
      }`}
    >
      <span className="w-5 sm:w-6 text-center font-black text-muted-foreground pt-0.5 text-sm sm:text-base">
        {rank}
      </span>
      <span
        className="player-chip h-8 w-8 shrink-0 text-sm"
        style={(() => {
          const c = chipColorsForPlayer(guess.player_id);
          return {
            ["--chip-color" as string]: c.bg,
            ["--chip-ink" as string]: c.ink,
          } as React.CSSProperties;
        })()}
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
      className="game-card bg-[var(--game-paper)] flex items-center gap-3 px-4 py-3.5 text-[var(--game-ink)]"
      style={isWinner ? { transform: "rotate(2deg)" } : undefined}
    >
      <span className="w-6 text-center font-black text-sm tabular-nums opacity-70">
        {rank}
      </span>
      <span
        className="player-chip w-10 h-10 shrink-0 text-sm"
        style={(() => {
          const c = chipColorsForPlayer(player.player_id);
          return {
            ["--chip-color" as string]: c.bg,
            ["--chip-ink" as string]: c.ink,
          } as React.CSSProperties;
        })()}
      >
        {player.display_name.slice(0, 2).toUpperCase()}
      </span>
      <span className="flex-1 font-heading font-bold truncate text-sm sm:text-base text-[var(--game-ink)]">
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

// Decide what text to seed the artist textarea with on (re)mount. Pure so
// it can be unit-tested without React. The mount can fire mid-round when
// image-gen failure rolls phase back to 'prompting' (see artistDraftRef in
// GameClientInner).
export function restoreArtistDraft(
  saved: { roundId: string; text: string } | null,
  roundId: string | undefined,
): string {
  if (!saved || !roundId) return "";
  return saved.roundId === roundId ? saved.text : "";
}

function ArtistPromptingView({
  room,
  currentRound,
  iAmArtist,
  artist,
  remaining,
  savedDraft,
  onDraftChange,
}: {
  room: Room;
  currentRound: Round | null;
  iAmArtist: boolean;
  artist: Player | undefined;
  remaining: number;
  savedDraft: { roundId: string; text: string } | null;
  onDraftChange: (roundId: string, text: string) => void;
}) {
  const [prompt, setPrompt] = useState<string>(() =>
    restoreArtistDraft(savedDraft, currentRound?.id),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectCount, setRejectCount] = useState(0);
  const [autoSubmitFired, setAutoSubmitFired] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Keyed on round id so a per-round auto-submit only fires once. Keying on
  // id (not a boolean) also guards against stale state if the artist lingers
  // across rounds (shouldn't happen given rotation, but belt-and-braces).
  const autoSubmittedArtistRef = useRef<string | null>(null);

  // Taboo words for this round, if enabled. Live-checked as the artist
  // types so we can highlight the offending chip and block submit.
  const tabooWords = currentRound?.taboo_words ?? null;
  const tabooHit = useMemo(
    () => (tabooWords ? findTabooHit(prompt, tabooWords) : null),
    [prompt, tabooWords],
  );
  const hitWords = useMemo(() => {
    if (!tabooWords) return new Set<string>();
    const hay = prompt.toLowerCase();
    return new Set(tabooWords.filter((w) => hay.includes(w.toLowerCase())));
  }, [prompt, tabooWords]);

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

  // Auto-submit the typed prompt when the prompting timer is almost out.
  // Mirrors the guess-phase auto-submit: fires at ~800ms left, once per
  // round, only if something's typed and the artist hasn't clicked Send
  // themselves. We don't lock in empty drafts — if nothing was typed,
  // /api/artist-gave-up fires from the host's tab and the AI takes over.
  useEffect(() => {
    if (!iAmArtist) return;
    if (room.phase !== "prompting") return;
    if (!currentRound?.id) return;
    if (submitting) return;
    if (autoSubmittedArtistRef.current === currentRound.id) return;
    if (!prompt.trim()) return;
    if (!room.phase_ends_at) return;
    // Skip when a taboo word is still in the draft — we'd just bounce off
    // the server check. Better to leave the draft and let the fallback
    // hand the round to Gemini if they really ghost.
    if (tabooHit) return;
    const msLeft = new Date(room.phase_ends_at).getTime() - Date.now();
    if (msLeft > 800) return;
    autoSubmittedArtistRef.current = currentRound.id;
    setAutoSubmitFired(true);
    submit();
  }, [
    iAmArtist,
    room.phase,
    room.phase_ends_at,
    remaining,
    submitting,
    prompt,
    tabooHit,
    currentRound?.id,
  ]);

  async function submit() {
    if (!currentRound?.id) return;
    const text = prompt.trim();
    if (text.length < 4) {
      setError("Write at least 4 characters.");
      return;
    }
    // Client-side taboo guard — server double-checks but we may as well
    // save the roundtrip and keep the error copy identical.
    if (tabooWords) {
      const hit = findTabooHit(text, tabooWords);
      if (hit) {
        setError(`You can't use a banned word: "${hit}"`);
        return;
      }
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
        setRejectCount((n) => n + 1);
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
        {tabooWords && tabooWords.length > 0 && (
          <div
            data-artist-taboo="1"
            className="w-full rounded-xl border-2 border-red-500/40 bg-red-500/10 px-3 py-2 flex flex-wrap items-center gap-2"
          >
            <span className="text-[11px] font-black uppercase tracking-wider text-red-600">
              🚫 You can&rsquo;t use:
            </span>
            {tabooWords.map((w) => {
              const hit = hitWords.has(w);
              return (
                <span
                  key={w}
                  data-taboo-word={w}
                  data-taboo-hit={hit ? "1" : undefined}
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-black border-2 transition ${
                    hit
                      ? "bg-red-600 border-red-700 text-white animate-pulse"
                      : "bg-[var(--game-paper)] border-red-500/50 text-red-700"
                  }`}
                >
                  {w}
                </span>
              );
            })}
          </div>
        )}
        {submitting ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <ArtLoader size="md" />
            {autoSubmitFired ? (
              <p
                data-artist-auto-submit="1"
                className="font-bold inline-flex items-center gap-2 justify-center text-primary"
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse"
                />
                <span>Locking in your prompt…</span>
              </p>
            ) : (
              <p className="font-bold">Sending to the AI…</p>
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="w-full flex flex-col gap-3"
          >
            {error && (
              <div
                id="artist-prompt-error"
                role="alert"
                data-artist-error="1"
                className="bg-red-500/20 border-2 border-red-500 rounded-xl px-4 py-4 shadow-sm"
              >
                <div className="text-red-600 dark:text-red-400 font-black uppercase tracking-wider text-xs mb-2 flex items-center gap-1.5">
                  <span aria-hidden="true">❌</span>
                  <span>Prompt rejected — your draft is saved, tweak and resend</span>
                </div>
                <div className="text-base font-semibold">{error}</div>
                {rejectCount >= 3 && (
                  <div className="mt-2 text-sm font-normal opacity-90">
                    Stuck? Try a simpler subject — avoid celebrities, real
                    people, or named characters.
                  </div>
                )}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                const val = e.target.value;
                setPrompt(val);
                if (currentRound?.id) onDraftChange(currentRound.id, val);
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
            <Button
              type="submit"
              disabled={prompt.trim().length < 4 || !!tabooHit}
              className="font-bold h-14 px-8 rounded-xl text-lg"
            >
              {tabooHit ? `Remove "${tabooHit}" first` : "Send to the AI"}
            </Button>
          </form>
        )}
      </section>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-16 max-w-md text-center">
      <ArtLoader size="lg" />
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

// Turn-by-turn collaborative team prompt writing. Rendered when
// teams_enabled + mode=artist + phase=prompting. Writing team members see
// each other's phrases land live + a highlighted "your turn" chip; the
// opposing team + spectators see a blocked view until reveal.
function TeamPromptingView({
  room,
  currentRound,
  players,
  currentPlayerId,
  myTeam,
  phrases,
  isSpectator,
}: {
  room: Room;
  currentRound: Round | null;
  players: Player[];
  currentPlayerId: string;
  myTeam: number | null;
  phrases: RoundPhrase[];
  isSpectator: boolean;
}) {
  const [draft, setDraft] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef(createSupabaseBrowserClient());

  // Writing-team roster in join order. MUST match the server's
  // team_prompting_roster() ordering (joined_at asc, player_id asc) so the
  // client-side "active teammate" highlight agrees with submit_team_phrase's
  // view of whose turn it is — otherwise turn_idx=0 highlights the wrong
  // teammate and submits get rejected as "wait your turn". (#58)
  const writingTeam = currentRound?.writing_team ?? null;
  const roster = useMemo(() => {
    if (!writingTeam) return [] as Player[];
    return players
      .filter((p) => !p.is_spectator && p.team === writingTeam)
      .sort((a, b) => {
        // Primary: joined_at. Tiebreak: player_id (matches server's row_number
        // ordering). Players without a joined_at fall to the end — this only
        // happens on stale reads before the players-fetch completes.
        const aJoined = a.joined_at ?? null;
        const bJoined = b.joined_at ?? null;
        if (aJoined && bJoined) {
          if (aJoined !== bJoined) return aJoined < bJoined ? -1 : 1;
        } else if (aJoined) {
          return -1;
        } else if (bJoined) {
          return 1;
        }
        return a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0;
      });
  }, [players, writingTeam]);

  const passes = room.team_turn_passes ?? 1;
  const turnIdx = currentRound?.turn_idx ?? 0;
  const totalTurns = Math.max(0, roster.length * passes);
  const activePos = roster.length > 0 ? turnIdx % roster.length : 0;
  const currentPass = roster.length > 0 ? Math.floor(turnIdx / roster.length) + 1 : 1;

  // Determine whose turn it SHOULD be client-side. The RPC guards against
  // stale clients; this only drives the UI highlight + textarea gating.
  const activePlayerId = roster[activePos]?.player_id ?? null;
  const iAmOnWritingTeam = writingTeam !== null && myTeam === writingTeam && !isSpectator;
  const isMyTurn = iAmOnWritingTeam && activePlayerId === currentPlayerId;

  // Turn countdown uses rounds.turn_ends_at (per-turn, short) rather than
  // room.phase_ends_at (which mirrors the same value but survives between
  // turns on the room clock). Called before the early-return below to keep
  // the hook order stable across renders.
  const turnRemaining = useCountdown(currentRound?.turn_ends_at ?? null);

  // Reset the draft as the turn advances so a stale teammate's text doesn't
  // sit in the box for the next player. Also parked above the early-return.
  useEffect(() => {
    setDraft("");
    setError(null);
  }, [turnIdx]);

  // Hold the render until writing_team has been resolved. Without this, the
  // first paint shows `data-team-prompting="watcher"` for all four players
  // (writing_team=null ⇒ iAmOnWritingTeam=false), and if a test locator
  // (or a real user's quick glance) reads the role before the 2s poll
  // backfills, the writing team never gets their form. (#58)
  if (writingTeam === null) {
    return (
      <section
        data-team-prompting="loading"
        className="w-full max-w-xl flex flex-col items-center gap-4 py-12 text-center"
      >
        <p className="text-sm uppercase tracking-widest opacity-60">
          Round {room.round_num}
        </p>
        <p className="opacity-80 text-sm">Picking the writing team…</p>
      </section>
    );
  }

  async function submit() {
    if (!currentRound?.id) return;
    const text = draft.trim();
    if (text.length < 1) {
      setError("Write a phrase (or a word) to continue.");
      return;
    }
    if (text.length > 60) {
      setError("Keep it to 60 characters or fewer.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = supabaseRef.current;
    const { error: rpcErr } = await supabase.rpc("submit_team_phrase", {
      p_round_id: currentRound.id,
      p_phrase: text,
    });
    if (rpcErr) {
      setError(rpcErr.message);
      setSubmitting(false);
      return;
    }
    setDraft("");
    setSubmitting(false);
  }

  // Non-writing view: opposing team + spectators wait. Don't leak phrases —
  // RLS already blocks the fetch, but hide the ghost list explicitly too.
  if (!iAmOnWritingTeam) {
    const meta = writingTeam ? TEAM_META[writingTeam as 1 | 2] : null;
    const otherTeamLabel = meta?.label ?? "The other team";
    return (
      <section
        data-team-prompting="watcher"
        data-writing-team={writingTeam ?? undefined}
        className="w-full max-w-xl flex flex-col items-center gap-4 py-12 text-center"
      >
        <p className="text-sm uppercase tracking-widest opacity-60">
          Round {room.round_num}
        </p>
        <p
          className="text-2xl sm:text-3xl font-heading font-black"
          style={meta ? { color: meta.color } : undefined}
        >
          {otherTeamLabel} is writing your challenge <span aria-hidden>💭</span>
        </p>
        <p className="opacity-80 text-sm max-w-md">
          They&rsquo;re each adding a phrase, one at a time. You&rsquo;ll see the
          full prompt at reveal — until then it&rsquo;s a surprise.
        </p>
        <div className="flex items-center gap-3 text-xs opacity-80 font-mono">
          <span>
            Turn {Math.min(turnIdx + 1, Math.max(1, totalTurns))} of {totalTurns}
          </span>
          {currentRound?.turn_ends_at && (
            <span
              className={`marquee-pill${
                turnRemaining > 0 && turnRemaining <= 3
                  ? " marquee-pill--urgent"
                  : ""
              }`}
            >
              {turnRemaining}s
            </span>
          )}
        </div>
      </section>
    );
  }

  // Writing-team view. Chips show the whole roster with the active teammate
  // highlighted. If we already submitted a phrase this round, it appears in
  // the phrases-so-far strip; otherwise it's hidden from teammates (RLS
  // enforces the same).
  return (
    <section
      data-team-prompting="writer"
      className="w-full max-w-2xl flex flex-col items-center gap-5"
    >
      <div className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <span className="uppercase tracking-widest opacity-70">Your turn comes</span>
          <span className="font-bold">
            Pass {currentPass}/{passes}
          </span>
        </div>
        {currentRound?.turn_ends_at && (
          <span
            className={`marquee-pill${
              turnRemaining > 0 && turnRemaining <= 3 ? " marquee-pill--urgent" : ""
            }`}
            data-urgent={turnRemaining > 0 && turnRemaining <= 3 ? "1" : undefined}
          >
            <span className="live-dot" aria-hidden />
            {turnRemaining}s
          </span>
        )}
      </div>

      <ul
        data-team-roster="1"
        className="flex flex-wrap items-center justify-center gap-2 w-full"
      >
        {roster.map((p, i) => {
          const active = i === activePos;
          const done = phrases.some((ph) => ph.player_id === p.player_id);
          return (
            <li
              key={p.player_id}
              data-active={active ? "1" : undefined}
              data-done={done ? "1" : undefined}
              className={`rounded-full px-3 py-1.5 border-2 text-sm font-bold flex items-center gap-2 transition ${
                active
                  ? "bg-primary text-primary-foreground border-primary scale-110 shadow-lg"
                  : done
                    ? "bg-muted text-muted-foreground border-border opacity-80"
                    : "bg-card text-card-foreground border-border"
              }`}
            >
              <span
                className="player-chip h-6 w-6 text-xs"
                style={(() => {
                  const c = chipColorsForPlayer(p.player_id);
                  return {
                    ["--chip-color" as string]: c.bg,
                    ["--chip-ink" as string]: c.ink,
                  } as React.CSSProperties;
                })()}
              >
                {p.display_name[0]?.toUpperCase()}
              </span>
              <span className="truncate max-w-[10rem]">{p.display_name}</span>
              {active && <span aria-hidden>✍️</span>}
              {done && !active && <span aria-hidden>✓</span>}
            </li>
          );
        })}
      </ul>

      {phrases.length > 0 && (
        <div
          data-team-phrases="1"
          className="w-full rounded-2xl border-2 border-border bg-card p-3 text-left"
        >
          <p className="text-[10px] uppercase tracking-widest opacity-70 mb-2">
            So far
          </p>
          <p className="font-mono text-base leading-relaxed break-words">
            {phrases.map((ph, i) => {
              const who = players.find((p) => p.player_id === ph.player_id);
              return (
                <span
                  key={ph.position}
                  data-phrase-position={ph.position}
                  className="inline-flex items-baseline gap-1 mr-2"
                >
                  <span
                    className="font-bold"
                    style={{ color: colorForPlayer(ph.player_id) }}
                    title={who?.display_name}
                  >
                    {ph.phrase}
                  </span>
                  {i < phrases.length - 1 && <span aria-hidden>·</span>}
                </span>
              );
            })}
          </p>
        </div>
      )}

      {isMyTurn ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="w-full flex flex-col gap-3"
          data-team-active-form="1"
        >
          <Textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim().length >= 1) submit();
              }
            }}
            placeholder="Add your phrase (1–60 chars). Think subject, style, vibe…"
            maxLength={60}
            rows={2}
            autoFocus
            disabled={submitting}
            className="text-lg rounded-xl min-h-[72px] resize-none leading-relaxed p-4"
          />
          <div className="flex items-center justify-between text-xs opacity-70">
            <span>{draft.length}/60</span>
            <span>Enter to send · Shift+Enter for newline</span>
          </div>
          {error && (
            <div
              role="alert"
              data-team-prompt-error="1"
              className="bg-red-500/15 border border-red-500/30 rounded-xl px-3 py-2 text-sm"
            >
              {error}
            </div>
          )}
          <Button
            type="submit"
            disabled={draft.trim().length < 1 || submitting}
            className="font-bold h-14 px-8 rounded-xl text-lg"
          >
            {submitting ? "Sending…" : "Add phrase"}
          </Button>
        </form>
      ) : (
        <div
          data-team-waiting="1"
          className="w-full rounded-2xl bg-card border-2 border-border p-5 text-center"
        >
          <p className="font-bold text-lg">
            {roster[activePos]?.display_name ?? "Your teammate"} is writing…
          </p>
          <p className="opacity-70 text-sm mt-1">
            You&rsquo;ll get your turn in a sec. Hang tight.
          </p>
        </div>
      )}
    </section>
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
                  style={(() => {
                    const c = chipColorsForPlayer(guess.player_id);
                    return {
                      ["--chip-color" as string]: c.bg,
                      ["--chip-ink" as string]: c.ink,
                    } as React.CSSProperties;
                  })()}
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
