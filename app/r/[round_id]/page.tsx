import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  PromptFlipboard,
  type PromptToken,
  type TokenRole,
} from "@/components/prompt-flipboard";
import { chipColorsForPlayer } from "@/lib/player";
import { CopyShareLink } from "./copy-share-link";

// Finished rounds never change — let the route be statically cacheable per
// round_id across cold starts. Metadata is the same for every visitor.
export const revalidate = 3600;

type RoundRow = {
  id: string;
  room_id: string;
  round_num: number;
  prompt: string | null;
  image_url: string | null;
  artist_player_id: string | null;
  ended_at: string | null;
};

type GuessRow = {
  id: string;
  player_id: string;
  guess: string;
  subject_score: number;
  style_score: number;
  semantic_score: number;
  speed_bonus: number;
  total_score: number | null;
};

type TokenRow = {
  position: number;
  token: string;
  role: TokenRole;
};

type PlayerRow = {
  player_id: string;
  display_name: string;
};

type RoomRow = {
  id: string;
  code: string;
  mode: string;
};

// Single place to look up a finished round + its sidecars. Bypasses RLS via
// service client (finished rounds are public by design), then enforces the
// "ended_at NOT NULL" gate ourselves. Never exposes in-flight prompts.
async function fetchRound(roundId: string) {
  // UUID gate: cheap sanity filter that also prevents bogus 500s when someone
  // pastes a garbage segment like /r/garbage.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      roundId,
    )
  ) {
    return null;
  }

  const svc = createSupabaseServiceClient();

  const { data: round } = await svc
    .from("rounds")
    .select(
      "id, room_id, round_num, prompt, image_url, artist_player_id, ended_at",
    )
    .eq("id", roundId)
    .maybeSingle<RoundRow>();

  if (!round || !round.ended_at) return null;

  const [{ data: room }, { data: guesses }, { data: tokens }, { data: players }] =
    await Promise.all([
      svc
        .from("rooms")
        .select("id, code, mode")
        .eq("id", round.room_id)
        .maybeSingle<RoomRow>(),
      svc
        .from("guesses")
        .select(
          "id, player_id, guess, subject_score, style_score, semantic_score, speed_bonus, total_score",
        )
        .eq("round_id", round.id)
        .order("total_score", { ascending: false, nullsFirst: false })
        .limit(5),
      svc
        .from("round_prompt_tokens")
        .select("position, token, role")
        .eq("round_id", round.id)
        .order("position", { ascending: true }),
      svc
        .from("room_players")
        .select("player_id, display_name")
        .eq("room_id", round.room_id),
    ]);

  const playerMap = new Map<string, PlayerRow>();
  for (const p of (players ?? []) as PlayerRow[]) {
    playerMap.set(p.player_id, p);
  }

  const artist = round.artist_player_id
    ? (playerMap.get(round.artist_player_id) ?? null)
    : null;

  return {
    round,
    room,
    guesses: (guesses ?? []) as GuessRow[],
    tokens: (tokens ?? []) as TokenRow[],
    playerMap,
    artist,
  };
}

function truncate(str: string, max: number) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + "…";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ round_id: string }>;
}): Promise<Metadata> {
  const { round_id } = await params;
  const data = await fetchRound(round_id);

  if (!data) {
    return {
      title: "Round not found · Promptionary",
      description: "That Promptionary round isn't available.",
    };
  }

  const promptSummary = data.round.prompt
    ? truncate(data.round.prompt, 140)
    : "Can you guess it?";

  const title = "Round recap · Promptionary";
  const description = `Guess the prompt → ${promptSummary}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `/r/${round_id}`,
      siteName: "Promptionary",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function RoundHighlightsPage({
  params,
}: {
  params: Promise<{ round_id: string }>;
}) {
  const { round_id } = await params;
  const data = await fetchRound(round_id);

  if (!data) notFound();

  const { round, room, guesses, tokens, playerMap, artist } = data;
  const promptTokens: PromptToken[] = tokens.map((t) => ({
    position: t.position,
    token: t.token,
    role: t.role,
  }));

  const topGuess = guesses[0];
  const topPlayer = topGuess ? playerMap.get(topGuess.player_id) : null;

  return (
    <main className="game-canvas min-h-screen flex flex-col items-center gap-6 px-5 py-10 sm:py-14">
      {room?.code && (
        <nav className="w-full max-w-2xl flex items-center justify-between gap-3">
          <Link
            href={`/play/${room.code}/recap`}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--game-paper)] text-[var(--game-ink)] font-black uppercase tracking-widest text-xs sm:text-sm px-4 py-2 shadow-md border-2 border-[var(--game-ink)] hover:-translate-y-0.5 hover:shadow-lg transition-transform"
          >
            <span aria-hidden="true">←</span>
            <span>Back to highlights</span>
          </Link>
          <span className="inline-flex items-center rounded-full bg-[color:var(--game-pink)] text-[var(--game-cream)] font-black uppercase tracking-widest text-[10px] sm:text-xs px-3 py-1.5 shadow-md border-2 border-[var(--game-ink)]">
            Round {round.round_num}
          </span>
        </nav>
      )}

      <header className="flex flex-col items-center gap-2 text-center">
        <p className="text-[11px] uppercase tracking-[0.35em] opacity-70 font-black">
          Round {round.round_num} recap
        </p>
        <h1 className="game-hero text-3xl sm:text-5xl leading-none">
          <span className="game-hero-mark">Promptionary</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Pictionary, in reverse. The AI painted this — see the prompt, the top
          guesses, and how close everyone got.
        </p>
      </header>

      <section className="w-full max-w-2xl flex flex-col items-center gap-5">
        {round.image_url && (
          <div className="game-frame bg-[var(--game-paper)] p-2 inline-block relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={round.image_url}
              alt={`Round ${round.round_num} painting`}
              className="rounded-[10px] block max-w-full h-auto"
            />
            <div className="absolute top-3 right-3">
              <CopyShareLink roundId={round.id} />
            </div>
          </div>
        )}

        {round.prompt && (
          <PromptFlipboard prompt={round.prompt} tokens={promptTokens} />
        )}

        {artist && (
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Artist-mode · written by{" "}
            <span className="font-black text-foreground">
              {artist.display_name}
            </span>
          </p>
        )}

        {guesses.length > 0 && (
          <div className="w-full space-y-2">
            <p className="text-center text-[11px] uppercase tracking-[0.3em] opacity-70 font-black">
              Top guesses
            </p>
            <ul className="space-y-2">
              {guesses.map((g, i) => {
                const p = playerMap.get(g.player_id);
                const total = g.total_score ?? 0;
                const isTop = i === 0 && total > 0;
                const nailedIt = isTop && total >= 80;
                return (
                  <li
                    key={g.id}
                    data-top-guess={isTop ? "1" : undefined}
                    className={`rounded-2xl px-3 sm:px-4 py-3 border flex items-start gap-3 sm:gap-4 shadow-sm ${
                      isTop
                        ? "bg-accent text-accent-foreground border-[color:var(--game-pink)]/60 ring-2 ring-[color:var(--game-pink)]/40"
                        : "bg-card text-card-foreground border-border"
                    }`}
                  >
                    <span className="w-5 sm:w-6 text-center font-black text-muted-foreground pt-0.5 text-sm sm:text-base">
                      {i + 1}
                    </span>
                    <span
                      className="player-chip h-8 w-8 shrink-0 text-sm"
                      style={(() => {
                        const c = chipColorsForPlayer(g.player_id);
                        return {
                          ["--chip-color"]: c.bg,
                          ["--chip-ink"]: c.ink,
                        } as React.CSSProperties;
                      })()}
                    >
                      {p?.display_name?.[0]?.toUpperCase() ?? "?"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold truncate text-sm sm:text-base">
                          {p?.display_name ?? "Someone"}
                        </p>
                        {isTop && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--game-pink)] text-[var(--game-cream)] text-[10px] sm:text-xs font-black uppercase tracking-wider px-2 py-0.5 shadow-sm">
                            🎯 {nailedIt ? "nailed it" : "top guess"}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground/80 italic whitespace-pre-wrap break-words leading-relaxed">
                        &ldquo;{g.guess}&rdquo;
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xl sm:text-2xl font-heading font-black font-mono tabular-nums">
                        +{total}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {topGuess && topPlayer && (
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground text-center">
            Top guess by{" "}
            <span className="font-black text-foreground">
              {topPlayer.display_name}
            </span>
          </p>
        )}
      </section>

      <section className="flex flex-col items-center gap-3 pt-4">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-full bg-[color:var(--game-pink)] text-[var(--game-cream)] font-black uppercase tracking-widest text-sm px-8 py-3 shadow-lg border-2 border-[var(--game-ink)] hover:-translate-y-0.5 hover:shadow-xl transition-transform"
        >
          Play Promptionary
        </Link>
        {room?.code && (
          <p className="text-[11px] text-muted-foreground">
            from room <span className="font-mono font-black">{room.code}</span>
          </p>
        )}
      </section>
    </main>
  );
}
