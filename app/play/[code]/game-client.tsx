"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { colorForPlayer } from "@/lib/player";

type Room = {
  id: string;
  code: string;
  phase: string;
  host_id: string;
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
  score: number;
};

type Round = {
  id: string;
  round_num: number;
  prompt: string | null;
  image_url: string | null;
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
}: {
  room: Room;
  players: Player[];
  currentPlayerId: string;
}) {
  const [room, setRoom] = useState<Room>(initialRoom);
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [currentRound, setCurrentRound] = useState<Round | null>(null);
  const [myGuess, setMyGuess] = useState<string>("");
  const [guessSubmitted, setGuessSubmitted] = useState<boolean>(false);
  const [guessesFromReveal, setGuessesFromReveal] = useState<Guess[]>([]);
  const [submissionCount, setSubmissionCount] = useState<number>(0);
  const isHost = room.host_id === currentPlayerId;
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
          "id, code, phase, host_id, max_rounds, guess_seconds, reveal_seconds, round_num, phase_ends_at",
        )
        .eq("id", room.id)
        .maybeSingle();
      if (r) setRoom((prev) => ({ ...prev, ...(r as Room) }));

      const { data: ps } = await supabase
        .from("room_players")
        .select("player_id, display_name, is_host, score")
        .eq("room_id", room.id);
      if (ps) setPlayers(ps as Player[]);

      // Always fetch the round matching the CURRENT room.round_num, not the
      // captured currentRound.id. Otherwise a previous round's reveal data
      // can overwrite the new round's state during the transition.
      const targetRoundNum = r?.round_num ?? roundNumRef.current;
      if (targetRoundNum > 0) {
        const { data: rd } = await supabase
          .from("rounds_public")
          .select("id, round_num, prompt, image_url, ended_at")
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
      }
    })();
    return () => {
      cancel = true;
    };
  }, [room.id, room.round_num]);

  const [startError, setStartError] = useState<string | null>(null);

  // Host triggers /api/start-round when phase=generating (and we have a round id)
  useEffect(() => {
    if (!isHost) return;
    if (room.phase !== "generating") return;
    if (!currentRound?.id) return;
    if (generatingCalledRef.current === currentRound.id) return;
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
  }, [isHost, room.phase, currentRound?.id]);

  // Any member triggers /api/finalize-round when the guessing timer genuinely
  // expires. Only fires when phase_ends_at is known and in the past —
  // `remaining === 0` alone is ambiguous because useCountdown returns 0 when
  // phase_ends_at is null (e.g. during generating/scoring).
  useEffect(() => {
    if (room.phase !== "guessing") return;
    if (!room.phase_ends_at) return;
    if (new Date(room.phase_ends_at).getTime() > Date.now()) return;
    if (!currentRound?.id) return;
    if (finalizeCalledRef.current === currentRound.id) return;
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
  }, [room.phase, room.phase_ends_at, remaining, currentRound?.id]);

  // Host advances to next round when reveal timer hits 0
  useEffect(() => {
    if (!isHost) return;
    if (room.phase !== "reveal") return;
    if (remaining > 0) return;
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
  }, [isHost, room.phase, remaining, room.id, room.round_num]);

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

  const playerById = new Map(players.map((p) => [p.player_id, p]));
  const leaderboard = [...players].sort((a, b) => b.score - a.score);

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 text-white px-6 py-10">
      <header className="w-full max-w-4xl flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest opacity-70">Round</p>
          <p className="text-2xl font-black">
            {room.round_num} / {room.max_rounds}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-widest opacity-70">Code</p>
          <p className="text-2xl font-black font-mono tracking-[0.3em]">{room.code}</p>
        </div>
      </header>

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
          <div className="w-full flex items-center justify-between">
            <p className="text-lg font-semibold opacity-90">
              Submissions: {submissionCount}/{players.length}
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
          {guessSubmitted ? (
            <div className="w-full bg-white/15 backdrop-blur border border-white/20 rounded-2xl p-4 text-center">
              <p className="font-bold">Guess in! Waiting on the rest…</p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitGuess();
              }}
              className="w-full flex gap-2"
            >
              <Input
                value={myGuess}
                onChange={(e) => setMyGuess(e.target.value)}
                placeholder="What's the prompt?"
                maxLength={200}
                autoFocus
                className="bg-white/20 border-white/30 placeholder:text-white/50 text-white text-lg h-14 rounded-xl"
              />
              <Button
                type="submit"
                disabled={!myGuess.trim()}
                className="bg-white text-indigo-700 hover:bg-white/90 font-bold h-14 px-8 rounded-xl"
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
