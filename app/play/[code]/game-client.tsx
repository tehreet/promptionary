"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { colorForPlayer } from "@/lib/player";

type Room = {
  id: string;
  code: string;
  phase: string;
  host_id: string;
  mode: string;
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

export function GameClient({
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
  const [room, setRoom] = useState<Room>(initialRoom);
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [currentRound, setCurrentRound] = useState<Round | null>(null);
  const [myGuess, setMyGuess] = useState<string>("");
  const [guessSubmitted, setGuessSubmitted] = useState<boolean>(false);
  const [guessesFromReveal, setGuessesFromReveal] = useState<Guess[]>([]);
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
          "id, code, phase, host_id, mode, max_rounds, guess_seconds, reveal_seconds, round_num, phase_ends_at",
        )
        .eq("id", room.id)
        .maybeSingle();
      if (r) setRoom((prev) => ({ ...prev, ...(r as Room) }));

      const { data: ps } = await supabase
        .from("room_players")
        .select("player_id, display_name, is_host, is_spectator, score")
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

  // When entering reveal phase, fetch all scored guesses so everyone sees them
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
    })();
  }, [room.phase, currentRound?.id]);

  const submitGuess = useCallback(async () => {
    if (!currentRound?.id) return;
    const text = myGuess.trim();
    if (!text) return;
    setGuessSubmitted(true);
    const supabase = supabaseRef.current;
    const { error } = await supabase.rpc("submit_guess", {
      p_round_id: currentRound.id,
      p_guess: text,
    });
    if (error) {
      alert(error.message);
      setGuessSubmitted(false);
    }
  }, [currentRound?.id, myGuess]);

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

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 text-white px-6 py-10">
      <header className="w-full max-w-4xl flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest opacity-70">Round</p>
          <p className="text-2xl font-black">
            {room.round_num} / {room.max_rounds}
          </p>
        </div>
        {isSpectator && (
          <div className="rounded-full bg-white/20 border border-white/30 px-3 py-1 text-xs font-bold uppercase tracking-wider">
            Spectating
          </div>
        )}
        <div className="text-right">
          <p className="text-xs uppercase tracking-widest opacity-70">Code</p>
          <p className="text-2xl font-black font-mono tracking-[0.3em]">{room.code}</p>
        </div>
      </header>

      {/* Running scoreboard — visible every phase except game_over (which has its own) */}
      {room.phase !== "game_over" && leaderboard.length > 0 && (
        <section className="w-full max-w-4xl rounded-2xl bg-white/10 backdrop-blur border border-white/20 px-4 py-3">
          <ul className="flex flex-wrap items-center gap-3 justify-center">
            {leaderboard.map((p, i) => (
              <li
                key={p.player_id}
                className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1"
              >
                <span className="text-xs opacity-60 font-black w-4 text-right">
                  {i + 1}
                </span>
                <span
                  className="h-6 w-6 rounded-full flex items-center justify-center text-black text-xs font-black"
                  style={{ background: colorForPlayer(p.player_id) }}
                >
                  {p.display_name[0]?.toUpperCase()}
                </span>
                <span className="text-sm font-semibold truncate max-w-[8rem]">
                  {p.display_name}
                </span>
                <span className="font-black font-mono">{p.score}</span>
              </li>
            ))}
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
              <div className="h-20 w-20 rounded-full border-4 border-white/30 border-t-white animate-spin" />
              <p className="text-xl font-bold">The AI is painting…</p>
              <p className="opacity-70 text-sm">
                {isHost ? "Thanks for hosting — this takes ~10 seconds" : "Hold tight"}
              </p>
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
                className="h-6 w-6 rounded-full flex items-center justify-center text-black text-xs font-black"
                style={{
                  background: colorForPlayer(currentRound.artist_player_id),
                }}
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
            <p className="text-3xl font-black font-mono">{remaining}s</p>
          </div>
          {currentRound?.image_url && (
            <img
              src={currentRound.image_url}
              alt="Round"
              className="w-full rounded-3xl shadow-2xl border-4 border-white/30"
            />
          )}
          {isSpectator ? (
            <div className="w-full bg-white/15 backdrop-blur border border-white/20 rounded-2xl p-4 text-center">
              <p className="font-bold">Spectating — guesses are hidden until reveal.</p>
            </div>
          ) : iAmArtist ? (
            <div className="w-full bg-white/15 backdrop-blur border border-white/20 rounded-2xl p-4 text-center">
              <p className="font-bold">You wrote this one — watch the guesses come in ✨</p>
            </div>
          ) : guessSubmitted ? (
            <div className="w-full bg-white/15 backdrop-blur border border-white/20 rounded-2xl p-4 text-center">
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
                className="bg-white/20 border-white/30 placeholder:text-white/50 text-white text-lg rounded-xl min-h-[96px] resize-y leading-relaxed p-4"
              />
              <div className="flex items-center justify-between text-xs opacity-70">
                <span>{myGuess.length}/200</span>
                <span className="hidden sm:inline">⌘/Ctrl + Enter to submit</span>
              </div>
              <Button
                type="submit"
                disabled={!myGuess.trim()}
                className="bg-white text-indigo-700 hover:bg-white/90 font-bold h-14 px-8 rounded-xl text-lg"
              >
                Guess
              </Button>
            </form>
          )}
        </section>
      )}

      {room.phase === "scoring" && (
        <div className="flex flex-col items-center gap-4 py-20">
          <div className="h-20 w-20 rounded-full border-4 border-white/30 border-t-white animate-spin" />
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
          {currentRound?.image_url && (
            <img
              src={currentRound.image_url}
              alt="Round"
              className="w-full rounded-3xl shadow-2xl border-4 border-white/30"
            />
          )}
          {currentRound?.prompt && (
            <div className="w-full bg-white/15 backdrop-blur border border-white/20 rounded-2xl p-5 text-center">
              <p className="text-xs uppercase tracking-widest opacity-70 mb-1">
                The prompt was
              </p>
              <p className="text-xl font-bold">&ldquo;{currentRound.prompt}&rdquo;</p>
            </div>
          )}
          <ul className="w-full space-y-2">
            {guessesFromReveal.map((g, i) => {
              const p = playerById.get(g.player_id);
              return (
                <li
                  key={g.id}
                  className="rounded-2xl px-4 py-3 backdrop-blur bg-white/10 border border-white/20 flex items-center gap-4"
                >
                  <span className="w-6 text-center font-black opacity-70">{i + 1}</span>
                  <span
                    className="h-8 w-8 rounded-full flex items-center justify-center text-black font-black"
                    style={{ background: colorForPlayer(g.player_id) }}
                  >
                    {p?.display_name[0]?.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{p?.display_name ?? "—"}</p>
                    <p className="text-sm opacity-80 truncate italic">
                      &ldquo;{g.guess}&rdquo;
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black font-mono">+{g.total_score}</p>
                    <p className="text-xs opacity-70">
                      {g.subject_score}s · {g.style_score}y · {g.semantic_score}m · {g.speed_bonus}b
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {room.phase === "game_over" && (
            <div className="w-full bg-white/15 backdrop-blur border border-white/20 rounded-2xl p-6 mt-4">
              <p className="text-center text-xs uppercase tracking-widest opacity-70 mb-3">
                Final leaderboard
              </p>
              <ul className="space-y-2">
                {leaderboard.map((p, i) => (
                  <li
                    key={p.player_id}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 bg-white/10"
                  >
                    <span className="w-6 text-center font-black opacity-70">{i + 1}</span>
                    <span
                      className="h-8 w-8 rounded-full flex items-center justify-center text-black font-black"
                      style={{ background: colorForPlayer(p.player_id) }}
                    >
                      {p.display_name[0]?.toUpperCase()}
                    </span>
                    <span className="flex-1 font-semibold truncate">{p.display_name}</span>
                    <span className="font-black font-mono text-xl">{p.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
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
            <div className="h-14 w-14 rounded-full border-4 border-white/30 border-t-white animate-spin" />
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
              className="bg-white/20 border-white/30 placeholder:text-white/50 text-white text-lg rounded-xl min-h-[120px] resize-y leading-relaxed p-4"
            />
            <div className="flex items-center justify-between text-xs opacity-70">
              <span>{prompt.length}/240</span>
              <span>⌘/Ctrl + Enter to send</span>
            </div>
            {error && (
              <div className="text-sm bg-red-500/30 rounded-xl p-3">{error}</div>
            )}
            <Button
              type="submit"
              disabled={prompt.trim().length < 4}
              className="bg-white text-indigo-700 hover:bg-white/90 font-bold h-14 px-8 rounded-xl text-lg"
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
      <div className="h-20 w-20 rounded-full border-4 border-white/30 border-t-white animate-spin" />
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
