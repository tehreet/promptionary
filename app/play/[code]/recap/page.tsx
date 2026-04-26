import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { PromptToken, TokenRole } from "@/components/prompt-flipboard";
import { chipColorsForPlayer } from "@/lib/player";
import { CopyRecapLink } from "./copy-recap-link";
import {
  HighlightsSection,
  type BiggestSwingPick,
  type ClosestGuessPick,
  type MostActivePick,
} from "./highlights-section";

// Full-game recap page. Public — any link-holder can see the final standings
// plus every round's prompt + image + top guesses. Service role bypasses RLS
// (room_players' scores are otherwise gated to members); the `phase ===
// 'game_over'` + `rounds.ended_at NOT NULL` guards keep in-flight games opaque.
export const revalidate = 3600;

type RoomRow = {
  id: string;
  code: string;
  mode: string;
  teams_enabled: boolean;
  round_num: number;
  max_rounds: number;
  phase: string;
};

type RoundRow = {
  id: string;
  room_id: string;
  round_num: number;
  prompt: string | null;
  image_url: string | null;
  artist_player_id: string | null;
  started_at: string;
  ended_at: string | null;
};

type GuessRow = {
  id: string;
  round_id: string;
  player_id: string;
  guess: string;
  total_score: number | null;
};

type TokenRow = {
  round_id: string;
  position: number;
  token: string;
  role: TokenRole;
};

type PlayerRow = {
  player_id: string;
  display_name: string;
  is_spectator: boolean;
  score: number;
  team: number | null;
};

// Shared loader. Returns everything the page + metadata + OG card need in one
// shot so we don't triple-roundtrip.
async function fetchRecap(code: string) {
  if (!/^[A-Z]{4}$/.test(code)) return null;

  const svc = createSupabaseServiceClient();

  const { data: room } = await svc
    .from("rooms")
    .select("id, code, mode, teams_enabled, round_num, max_rounds, phase")
    .eq("code", code)
    .maybeSingle<RoomRow>();

  if (!room) return null;

  // If the game isn't finished we still return the room so the UI can render a
  // friendly "still in progress" state without leaking prompts.
  if (room.phase !== "game_over") {
    return { room, done: false as const };
  }

  const [{ data: rounds }, { data: players }] = await Promise.all([
    svc
      .from("rounds")
      .select(
        "id, room_id, round_num, prompt, image_url, artist_player_id, started_at, ended_at",
      )
      .eq("room_id", room.id)
      .not("ended_at", "is", null)
      .order("round_num", { ascending: true }),
    svc
      .from("room_players")
      .select("player_id, display_name, is_spectator, score, team")
      .eq("room_id", room.id),
  ]);

  const roundRows = (rounds ?? []) as RoundRow[];
  const playerRows = (players ?? []) as PlayerRow[];

  const roundIds = roundRows.map((r) => r.id);

  const [{ data: guesses }, { data: tokens }, { data: messages }] =
    roundIds.length
      ? await Promise.all([
          svc
            .from("guesses")
            .select("id, round_id, player_id, guess, total_score")
            .in("round_id", roundIds)
            .order("total_score", { ascending: false, nullsFirst: false }),
          svc
            .from("round_prompt_tokens")
            .select("round_id, position, token, role")
            .in("round_id", roundIds)
            .order("position", { ascending: true }),
          // room_messages is keyed by room_id only (no round_id column), so
          // we fetch timestamps for the room and bucket them into rounds on
          // the server via each round's [started_at, ended_at] window.
          svc
            .from("room_messages")
            .select("created_at")
            .eq("room_id", room.id),
        ])
      : [
          { data: [] as GuessRow[] },
          { data: [] as TokenRow[] },
          { data: [] as { created_at: string }[] },
        ];

  const guessRows = (guesses ?? []) as GuessRow[];
  const tokenRows = (tokens ?? []) as TokenRow[];
  const messageRows = (messages ?? []) as { created_at: string }[];

  const guessesByRound = new Map<string, GuessRow[]>();
  for (const g of guessRows) {
    const arr = guessesByRound.get(g.round_id) ?? [];
    arr.push(g);
    guessesByRound.set(g.round_id, arr);
  }

  const tokensByRound = new Map<string, PromptToken[]>();
  for (const t of tokenRows) {
    const arr = tokensByRound.get(t.round_id) ?? [];
    arr.push({ position: t.position, token: t.token, role: t.role });
    tokensByRound.set(t.round_id, arr);
  }

  const playerMap = new Map<string, PlayerRow>();
  for (const p of playerRows) playerMap.set(p.player_id, p);

  const highlights = computeHighlights({
    rounds: roundRows,
    guessRows,
    messages: messageRows,
    playerMap,
  });

  return {
    room,
    done: true as const,
    rounds: roundRows,
    players: playerRows,
    playerMap,
    guessesByRound,
    tokensByRound,
    highlights,
  };
}

// Curate the three highlight buckets from existing data. Pure-JS, runs on the
// server next to the fetch so the page remains a single await. Each bucket is
// independently `null` when there's not enough signal (no guesses scored, no
// chat, etc.) — the UI collapses to "—" instead of faking numbers.
function computeHighlights({
  rounds,
  guessRows,
  messages,
  playerMap,
}: {
  rounds: RoundRow[];
  guessRows: GuessRow[];
  messages: { created_at: string }[];
  playerMap: Map<string, PlayerRow>;
}): {
  closest: ClosestGuessPick | null;
  swing: BiggestSwingPick | null;
  active: MostActivePick | null;
} {
  const roundById = new Map<string, RoundRow>();
  for (const r of rounds) roundById.set(r.id, r);

  // 1. Closest guess — highest total_score across the whole game. `guessRows`
  //    is already sorted total_score DESC from the fetch, so first non-null
  //    wins. We require total_score > 0 so a game where nobody scored shows
  //    "—" rather than an arbitrary zero pick.
  let closest: ClosestGuessPick | null = null;
  for (const g of guessRows) {
    const score = g.total_score ?? 0;
    if (score <= 0) continue;
    const round = roundById.get(g.round_id);
    if (!round) continue;
    const p = playerMap.get(g.player_id) ?? null;
    closest = {
      guess: {
        round_id: g.round_id,
        player_id: g.player_id,
        guess: g.guess,
        total_score: g.total_score,
      },
      round: {
        id: round.id,
        round_num: round.round_num,
        prompt: round.prompt,
        image_url: round.image_url,
      },
      player: p
        ? { player_id: p.player_id, display_name: p.display_name }
        : null,
    };
    break;
  }

  // 2. Biggest swing — the (round, player) pair with the largest positive
  //    delta vs that round's average guesser total. Artist-mode rounds still
  //    compute fine; the artist isn't in `guesses`, so they don't distort
  //    the average or compete for the pick.
  let swing: BiggestSwingPick | null = null;
  const guessesPerRound = new Map<string, GuessRow[]>();
  for (const g of guessRows) {
    const arr = guessesPerRound.get(g.round_id) ?? [];
    arr.push(g);
    guessesPerRound.set(g.round_id, arr);
  }
  for (const [roundId, gs] of guessesPerRound) {
    if (gs.length < 2) continue; // a 1-guess round has no meaningful swing
    const totals = gs.map((g) => g.total_score ?? 0);
    const sum = totals.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / totals.length);
    let best: GuessRow | null = null;
    let bestScore = -Infinity;
    for (const g of gs) {
      const s = g.total_score ?? 0;
      if (s > bestScore) {
        bestScore = s;
        best = g;
      }
    }
    if (!best) continue;
    const delta = bestScore - avg;
    if (delta <= 0) continue;
    if (!swing || delta > swing.delta) {
      const round = roundById.get(roundId);
      if (!round) continue;
      const p = playerMap.get(best.player_id) ?? null;
      swing = {
        round: {
          id: round.id,
          round_num: round.round_num,
          prompt: round.prompt,
          image_url: round.image_url,
        },
        player: p
          ? { player_id: p.player_id, display_name: p.display_name }
          : null,
        score: bestScore,
        average: avg,
        delta,
      };
    }
  }

  // 3. Most active round — message count per round, bucketed by timestamp.
  //    `room_messages` has no `round_id`, so we walk rounds (sorted by
  //    round_num asc, as fetched) and count messages whose created_at falls
  //    inside [started_at, ended_at]. Messages that predate round 1 or post-
  //    date the final round are simply ignored — they're lobby/game-over
  //    chatter, not round-specific.
  let active: MostActivePick | null = null;
  if (messages.length && rounds.length) {
    const counts = new Map<string, number>();
    const sorted = rounds
      .slice()
      .sort(
        (a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      );
    for (const m of messages) {
      const ts = new Date(m.created_at).getTime();
      for (const r of sorted) {
        const start = new Date(r.started_at).getTime();
        const end = r.ended_at
          ? new Date(r.ended_at).getTime()
          : Number.POSITIVE_INFINITY;
        if (ts >= start && ts <= end) {
          counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
          break;
        }
      }
    }
    let bestId: string | null = null;
    let bestCount = 0;
    for (const [id, c] of counts) {
      if (c > bestCount) {
        bestCount = c;
        bestId = id;
      }
    }
    if (bestId && bestCount > 0) {
      const round = roundById.get(bestId);
      if (round) {
        active = {
          round: {
            id: round.id,
            round_num: round.round_num,
            prompt: round.prompt,
            image_url: round.image_url,
          },
          messageCount: bestCount,
        };
      }
    }
  }

  return { closest, swing, active };
}

function truncate(str: string, max: number) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + "…";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const data = await fetchRecap(code.toUpperCase());

  if (!data) {
    return {
      title: "Recap not found · Promptionary",
      description: "That Promptionary game isn't available.",
    };
  }

  if (!data.done) {
    return {
      title: `Room ${data.room.code} · Promptionary`,
      description: "This game is still in progress — check back when it wraps.",
    };
  }

  const guessers = data.players.filter((p) => !p.is_spectator);
  const winner = guessers
    .slice()
    .sort((a, b) => b.score - a.score)[0];

  const title = `Recap · ${data.room.code} · Promptionary`;
  const description = winner
    ? `${winner.display_name} took the crown with ${winner.score} across ${data.rounds.length} rounds.`
    : `Every round from room ${data.room.code}.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `/play/${data.room.code}/recap`,
      siteName: "Promptionary",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

const ROLE_UNDERLINE: Record<TokenRole, string> = {
  subject: "role-subject-underline",
  style: "role-style-underline",
  modifier: "role-modifier-underline",
  filler: "role-filler-underline",
};

// Small presentational component for the per-round card — mirrors the
// highlights carousel card but always visible (no scroll container) and shows
// up to the top 3 guesses instead of just one.
function RoundCard({
  round,
  tokens,
  guesses,
  playerMap,
}: {
  round: RoundRow;
  tokens: PromptToken[];
  guesses: GuessRow[];
  playerMap: Map<string, PlayerRow>;
}) {
  const artist = round.artist_player_id
    ? playerMap.get(round.artist_player_id)
    : null;
  const topGuesses = guesses.slice(0, 3);

  return (
    <Link
      href={`/r/${round.id}`}
      data-recap-round={round.round_num}
      className="game-card bg-[var(--game-paper)] text-[var(--game-ink)] p-4 flex flex-col sm:flex-row gap-4 no-underline focus:outline-none focus:ring-4 focus:ring-[color:var(--game-cyan)]/50 hover:-translate-y-0.5 transition-transform"
    >
      <div className="shrink-0 sm:w-[260px] w-full flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--game-pink)] text-[var(--game-cream)] px-3 py-0.5 text-[10px] font-black uppercase tracking-widest border-2 border-[var(--game-ink)]">
            Round {round.round_num}
          </span>
          {artist && (
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80">
              <span>by</span>
              <span
                className="player-chip h-5 w-5 text-[9px]"
                style={(() => {
                  const c = chipColorsForPlayer(artist.player_id);
                  return {
                    ["--chip-color" as string]: c.bg,
                    ["--chip-ink" as string]: c.ink,
                  } as React.CSSProperties;
                })()}
              >
                {artist.display_name[0]?.toUpperCase()}
              </span>
              <span className="font-bold normal-case tracking-normal">
                {artist.display_name}
              </span>
            </span>
          )}
        </div>
        {round.image_url ? (
          <div className="game-frame bg-[var(--game-paper)] p-1 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={round.image_url}
              alt={`Round ${round.round_num} painting`}
              className="rounded-[10px] block w-full aspect-square object-cover"
            />
          </div>
        ) : (
          <div className="rounded-[10px] bg-muted aspect-square flex items-center justify-center text-xs text-muted-foreground">
            no image
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {round.prompt && (
          <div
            data-recap-prompt="1"
            className="rounded-xl bg-[var(--game-cream)] border-2 border-[var(--game-ink)] px-3 py-2 text-[13px] leading-snug"
          >
            {tokens.length > 0 ? (
              <span>
                {tokens.map((t, i) => (
                  <span
                    key={`${t.position}-${i}`}
                    data-role={t.role}
                    className="inline-block mx-0.5"
                  >
                    <span className={ROLE_UNDERLINE[t.role]}>{t.token}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span>{round.prompt}</span>
            )}
          </div>
        )}
        {topGuesses.length > 0 ? (
          <ul className="space-y-1.5">
            {topGuesses.map((g, i) => {
              const player = playerMap.get(g.player_id);
              const total = g.total_score ?? 0;
              const isTop = i === 0 && total > 0;
              return (
                <li
                  key={g.id}
                  data-recap-guess={isTop ? "top" : undefined}
                  className={`rounded-xl px-3 py-2 border-2 flex items-center gap-2 ${
                    isTop
                      ? "bg-accent text-accent-foreground border-[color:var(--game-pink)]"
                      : "bg-[var(--game-paper)] border-[var(--game-ink)]/30"
                  }`}
                >
                  <span className="w-4 text-center font-black opacity-60 text-xs">
                    {i + 1}
                  </span>
                  <span
                    className="player-chip h-6 w-6 shrink-0 text-[10px]"
                    style={(() => {
                      const c = chipColorsForPlayer(g.player_id);
                      return {
                        ["--chip-color" as string]: c.bg,
                        ["--chip-ink" as string]: c.ink,
                      } as React.CSSProperties;
                    })()}
                  >
                    {player?.display_name[0]?.toUpperCase() ?? "?"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] italic leading-snug truncate">
                      &ldquo;{g.guess}&rdquo;
                    </p>
                    <p className="text-[10px] font-bold opacity-80 truncate">
                      {player?.display_name ?? "—"}
                    </p>
                  </div>
                  <span className="font-mono font-black tabular-nums text-sm">
                    +{total}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border-2 border-dashed border-[var(--game-ink)]/30 px-3 py-2 text-[11px] text-muted-foreground text-center">
            No guesses landed this round
          </p>
        )}
      </div>
    </Link>
  );
}

export default async function RecapPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const data = await fetchRecap(code);

  if (!data) notFound();

  // Not finished yet — show a friendly placeholder and send folks back to the
  // live room. Never expose prompts for in-flight games.
  if (!data.done) {
    return (
      <main className="game-canvas min-h-screen flex flex-col items-center justify-center gap-6 px-5 py-14 text-center">
        <p className="text-[11px] uppercase tracking-[0.35em] opacity-70 font-black">
          Room {data.room.code}
        </p>
        <h1 className="game-hero text-3xl sm:text-5xl leading-none">
          <span className="game-hero-mark">Still in progress</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-md">
          This game hasn&apos;t wrapped yet. The recap will appear here once the
          final round is done.
        </p>
        <Link
          href={`/play/${data.room.code}`}
          className="inline-flex items-center justify-center rounded-full bg-[color:var(--game-pink)] text-[var(--game-cream)] font-black uppercase tracking-widest text-sm px-8 py-3 shadow-lg border-2 border-[var(--game-ink)] hover:-translate-y-0.5 hover:shadow-xl transition-transform"
        >
          Jump into room {data.room.code}
        </Link>
      </main>
    );
  }

  const {
    room,
    rounds,
    players,
    playerMap,
    guessesByRound,
    tokensByRound,
    highlights,
  } = data;

  // Split guessers from spectators for the leaderboard (spectators sit at 0
  // and would otherwise muddy the ranks).
  const guessers = players.filter((p) => !p.is_spectator);
  const leaderboard = guessers.slice().sort((a, b) => b.score - a.score);

  // Team view if teams were enabled — average score per team matches the
  // in-game leaderboard exactly (see PlayAgainControls upstream).
  const teamView = room.teams_enabled
    ? (() => {
        const byTeam = new Map<number, PlayerRow[]>();
        for (const p of guessers) {
          if (p.team == null) continue;
          const arr = byTeam.get(p.team) ?? [];
          arr.push(p);
          byTeam.set(p.team, arr);
        }
        const teams = Array.from(byTeam.entries()).map(([team, members]) => ({
          team,
          members,
          avg: members.length
            ? Math.round(
                members.reduce((acc, m) => acc + m.score, 0) / members.length,
              )
            : 0,
        }));
        teams.sort((a, b) => b.avg - a.avg);
        return teams;
      })()
    : null;

  const winner = leaderboard[0];
  const totalGuesses = Array.from(guessesByRound.values()).reduce(
    (acc, arr) => acc + arr.length,
    0,
  );

  return (
    <main className="game-canvas min-h-screen flex flex-col items-center gap-8 px-5 py-10 sm:py-14">
      <header className="flex flex-col items-center gap-3 text-center">
        <p className="text-[11px] uppercase tracking-[0.35em] opacity-70 font-black">
          Recap · room {room.code}
        </p>
        <h1 className="game-hero text-3xl sm:text-5xl leading-none">
          <span className="game-hero-mark">Promptionary</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-md">
          {rounds.length} round{rounds.length === 1 ? "" : "s"} ·{" "}
          {totalGuesses} guess{totalGuesses === 1 ? "" : "es"} ·{" "}
          {guessers.length} player{guessers.length === 1 ? "" : "s"}
        </p>
        <CopyRecapLink code={room.code} />
      </header>

      <section className="w-full max-w-2xl flex flex-col items-center gap-4">
        {teamView ? (
          <div
            data-recap-team-leaderboard="1"
            className="w-full space-y-3"
          >
            <p className="text-center text-xs uppercase tracking-widest opacity-70">
              Final team leaderboard
            </p>
            <ul className="space-y-3">
              {teamView.map((t, i) => (
                <li
                  key={t.team}
                  data-recap-team-rank={i + 1}
                  className="game-card bg-[var(--game-paper)] p-4 text-[var(--game-ink)]"
                  style={i === 0 ? { transform: "rotate(2deg)" } : undefined}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-black opacity-60">
                        #{i + 1}
                      </span>
                      <span className="font-heading font-black text-xl">
                        Team {t.team}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-black text-3xl">{t.avg}</p>
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
                          className="rounded-full bg-[var(--game-paper)] border-2 border-[var(--game-ink)] px-3 py-1 text-xs flex items-center gap-2"
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
          <div data-recap-leaderboard="1" className="w-full space-y-3">
            <p className="text-center text-xs uppercase tracking-widest opacity-70">
              Final leaderboard
            </p>
            <ul className="space-y-3">
              {leaderboard.map((p, i) => {
                const isWinner = i === 0;
                return (
                  <li
                    key={p.player_id}
                    data-recap-rank={i + 1}
                    className="game-card bg-[var(--game-paper)] flex items-center gap-3 px-4 py-3 text-[var(--game-ink)]"
                    style={isWinner ? { transform: "rotate(2deg)" } : undefined}
                  >
                    <span className="w-6 text-center font-black opacity-70">
                      {i + 1}
                    </span>
                    <span
                      className="player-chip w-10 h-10 shrink-0 text-sm"
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
                    <span className="flex-1 font-heading font-bold truncate">
                      {p.display_name}
                    </span>
                    {isWinner ? (
                      <span className="game-hero-mark font-mono font-black text-lg tabular-nums">
                        {p.score}
                      </span>
                    ) : (
                      <span className="font-heading font-black font-mono text-xl tabular-nums">
                        {p.score}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {winner && !teamView && (
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground text-center">
            Crowned ·{" "}
            <span className="font-black text-foreground">
              {winner.display_name}
            </span>{" "}
            with {winner.score}
          </p>
        )}
      </section>

      <HighlightsSection
        closest={highlights.closest}
        swing={highlights.swing}
        active={highlights.active}
      />

      <section className="w-full max-w-3xl flex flex-col gap-4">
        <div className="flex items-baseline justify-between px-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Every round
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground opacity-70">
            Tap for a shareable card
          </p>
        </div>
        {rounds.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-[var(--game-ink)]/30 px-4 py-6 text-sm text-muted-foreground text-center">
            No finished rounds — this game ended before the first painting landed.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {rounds.map((r) => (
              <li key={r.id}>
                <RoundCard
                  round={r}
                  tokens={tokensByRound.get(r.id) ?? []}
                  guesses={guessesByRound.get(r.id) ?? []}
                  playerMap={playerMap}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col items-center gap-3 pt-2">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-full bg-[color:var(--game-pink)] text-[var(--game-cream)] font-black uppercase tracking-widest text-sm px-8 py-3 shadow-lg border-2 border-[var(--game-ink)] hover:-translate-y-0.5 hover:shadow-xl transition-transform"
        >
          Start a new game
        </Link>
        <p className="text-[11px] text-muted-foreground">
          from room <span className="font-mono font-black">{room.code}</span>
        </p>
      </section>
    </main>
  );
}
