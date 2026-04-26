"use client";

import { useRef, useState, useCallback } from "react";
import Link from "next/link";
import { chipColorsForPlayer } from "@/lib/player";
import type { PromptToken, TokenRole } from "@/components/prompt-flipboard";

export type HighlightPlayer = {
  player_id: string;
  display_name: string;
};

export type HighlightGuess = {
  id: string;
  player_id: string;
  guess: string;
  total_score: number;
};

export type RoundHighlight = {
  round_id: string;
  round_num: number;
  prompt: string | null;
  image_url: string | null;
  artist_player_id: string | null;
  taboo_words: string[] | null;
  tokens: PromptToken[];
  top_guess: HighlightGuess | null;
};

const ROLE_UNDERLINE: Record<TokenRole, string> = {
  subject: "role-subject-underline",
  style: "role-style-underline",
  modifier: "role-modifier-underline",
  filler: "role-filler-underline",
};

// 320px card + 16px gap-4
const CARD_STEP = 336;

export function RoundHighlightsCarousel({
  highlights,
  players,
}: {
  highlights: RoundHighlight[];
  players: HighlightPlayer[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; scrollLeft: number } | null>(null);
  const wasDragging = useRef(false);
  const [grabbing, setGrabbing] = useState(false);

  const playerById = new Map(players.map((p) => [p.player_id, p]));

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Let touch events fall through to native scroll
      if (e.pointerType === "touch") return;
      if (!scrollRef.current) return;
      dragRef.current = {
        x: e.clientX,
        scrollLeft: scrollRef.current.scrollLeft,
      };
      wasDragging.current = false;
      setGrabbing(true);
      scrollRef.current.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current || !scrollRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      if (Math.abs(dx) > 5) wasDragging.current = true;
      scrollRef.current.scrollLeft = dragRef.current.scrollLeft - dx;
    },
    [],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    setGrabbing(false);
  }, []);

  // Intercept click before it reaches child <Link> elements when the user dragged
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (wasDragging.current) {
      e.stopPropagation();
      e.preventDefault();
      wasDragging.current = false;
    }
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      scrollRef.current?.scrollBy({ left: -CARD_STEP, behavior: "smooth" });
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      scrollRef.current?.scrollBy({ left: CARD_STEP, behavior: "smooth" });
    }
  }, []);

  const scrollByCard = useCallback((dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * CARD_STEP, behavior: "smooth" });
  }, []);

  if (highlights.length === 0) return null;

  return (
    <section
      data-highlights-carousel="1"
      className="w-full max-w-5xl flex flex-col gap-3"
    >
      <div className="flex items-center justify-between px-1">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Round highlights
        </p>
        <div className="flex items-center gap-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground opacity-70 hidden sm:block">
            Swipe or drag to browse
          </p>
          {highlights.length > 1 && (
            <div className="hidden sm:flex items-center gap-1">
              <button
                onClick={() => scrollByCard(-1)}
                aria-label="Previous round"
                className="w-7 h-7 rounded-full border-2 border-[var(--game-ink)] bg-[var(--game-paper)] text-[var(--game-ink)] flex items-center justify-center text-lg leading-none hover:bg-[var(--game-ink)] hover:text-[var(--game-cream)] transition-colors"
              >
                ‹
              </button>
              <button
                onClick={() => scrollByCard(1)}
                aria-label="Next round"
                className="w-7 h-7 rounded-full border-2 border-[var(--game-ink)] bg-[var(--game-paper)] text-[var(--game-ink)] flex items-center justify-center text-lg leading-none hover:bg-[var(--game-ink)] hover:text-[var(--game-cream)] transition-colors"
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        aria-label="Round highlights carousel"
        data-carousel-scroll="1"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        onKeyDown={onKeyDown}
        className={`flex gap-4 overflow-x-auto sm:snap-x sm:snap-mandatory flex-col sm:flex-row sm:pb-3 pb-0 -mx-6 sm:mx-0 sm:px-6 px-0 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--game-pink)]/60 focus-visible:rounded-lg ${grabbing ? "sm:cursor-grabbing" : "sm:cursor-grab"}`}
      >
        {highlights.map((h) => (
          <HighlightCard
            key={h.round_id}
            highlight={h}
            playerById={playerById}
          />
        ))}
      </div>
    </section>
  );
}

function HighlightCard({
  highlight,
  playerById,
}: {
  highlight: RoundHighlight;
  playerById: Map<string, HighlightPlayer>;
}) {
  const topGuesser = highlight.top_guess
    ? playerById.get(highlight.top_guess.player_id)
    : null;
  const artist = highlight.artist_player_id
    ? playerById.get(highlight.artist_player_id)
    : null;
  const tokens = [...highlight.tokens].sort(
    (a, b) => a.position - b.position,
  );

  return (
    <Link
      href={`/r/${highlight.round_id}`}
      data-highlight-card={highlight.round_num}
      className="game-card bg-[var(--game-paper)] text-[var(--game-ink)] shrink-0 sm:w-[320px] w-full sm:snap-start p-4 flex flex-col gap-3 no-underline focus:outline-none focus:ring-4 focus:ring-[color:var(--game-cyan)]/50"
    >
      <div className="flex items-center justify-between">
        <span
          className="inline-flex items-center gap-2 rounded-full bg-[var(--game-pink)] text-[var(--game-cream)] px-3 py-0.5 text-[10px] font-black uppercase tracking-widest border-2 border-[var(--game-ink)]"
        >
          Round {highlight.round_num}
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

      {highlight.image_url ? (
        <div className="game-frame bg-[var(--game-paper)] p-1 overflow-hidden">
          <img
            src={highlight.image_url}
            alt={`Round ${highlight.round_num} painting`}
            className="rounded-[10px] block w-full aspect-square object-cover"
          />
        </div>
      ) : (
        <div className="rounded-[10px] bg-muted aspect-square flex items-center justify-center text-xs text-muted-foreground">
          no image
        </div>
      )}

      {highlight.prompt && (
        // Always-cream paper card. Token text must stay dark in both themes —
        // var(--game-ink) flips to cream in dark mode and vanishes on the
        // locked-cream background (see #70). --game-canvas-dark stays dark
        // in both themes.
        <div
          data-highlight-prompt="1"
          className="rounded-xl bg-[var(--game-cream)] px-4 py-3 text-sm leading-snug font-medium"
          style={{
            color: "var(--game-canvas-dark)",
            borderWidth: 2,
            borderStyle: "solid",
            borderColor: "var(--game-canvas-dark)",
          }}
        >
          {tokens.length > 0 ? (
            <span className="flex flex-wrap gap-x-1 gap-y-0.5">
              {tokens.map((t, i) => (
                <span
                  key={`${t.position}-${i}`}
                  data-role={t.role}
                  className="inline-block"
                >
                  <span className={ROLE_UNDERLINE[t.role]}>{t.token}</span>
                </span>
              ))}
            </span>
          ) : (
            <span>{highlight.prompt}</span>
          )}
        </div>
      )}

      {highlight.taboo_words && highlight.taboo_words.length > 0 && (
        <div
          data-highlight-taboo="1"
          className="rounded-xl border-2 border-[var(--game-ink)]/40 bg-[var(--game-paper)] px-3 py-2 flex flex-wrap items-center gap-1.5"
        >
          <span className="text-[10px] font-black uppercase tracking-wider opacity-70">
            🚫 Couldn&rsquo;t say
          </span>
          {highlight.taboo_words.map((w) => (
            <span
              key={w}
              className="inline-flex items-center rounded-full border-2 border-red-500/60 bg-red-500/10 px-2 py-0.5 text-[11px] font-black text-red-600 line-through"
            >
              {w}
            </span>
          ))}
        </div>
      )}

      {highlight.top_guess && highlight.top_guess.total_score > 0 ? (
        <div className="rounded-xl bg-accent text-accent-foreground border-2 border-[var(--game-ink)] px-3 py-2.5 flex items-start gap-2.5">
          <span
            className="player-chip h-8 w-8 shrink-0 text-[11px]"
            style={(() => {
              const c = chipColorsForPlayer(highlight.top_guess.player_id);
              return {
                ["--chip-color" as string]: c.bg,
                ["--chip-ink" as string]: c.ink,
              } as React.CSSProperties;
            })()}
          >
            {topGuesser?.display_name[0]?.toUpperCase() ?? "?"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider font-bold opacity-80">
                Top guess
              </span>
              <span className="font-mono font-black tabular-nums text-sm">
                +{highlight.top_guess.total_score}
              </span>
            </div>
            <p className="text-[12px] italic leading-snug truncate mt-0.5">
              &ldquo;{highlight.top_guess.guess}&rdquo;
            </p>
            <p className="text-[10px] font-bold truncate opacity-80 mt-0.5">
              {topGuesser?.display_name ?? "—"}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-[var(--game-ink)]/30 px-3 py-2 text-[11px] text-muted-foreground text-center">
          No guesses landed this round
        </div>
      )}
    </Link>
  );
}
