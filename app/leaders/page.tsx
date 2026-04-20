import Link from "next/link";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { chipColorsForPlayer } from "@/lib/player";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaders · Promptionary",
  description: "All-time Promptionary leaders by points, wins, and daily streak.",
};

type Row = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  handle: string | null;
  total_score: number;
  games_won: number;
  daily_longest_streak: number;
};

const LIMIT = 50;

const MEDAL_COLORS: Record<1 | 2 | 3, string> = {
  1: "var(--medal-gold)",
  2: "var(--medal-silver)",
  3: "var(--medal-bronze)",
};

function Board({
  title,
  subtitle,
  rows,
  metric,
  accent,
  format = (n: number) => String(n),
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  metric: keyof Pick<Row, "total_score" | "games_won" | "daily_longest_streak">;
  accent: string;
  format?: (n: number) => string;
}) {
  return (
    <section
      data-board={metric}
      className="game-card bg-[var(--game-paper)] p-5 flex flex-col gap-3"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="game-hero text-2xl">
          <span className="game-hero-mark" style={{ background: accent }}>
            {title}
          </span>
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {subtitle}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-6 text-center">
          Nobody's on the board yet. Be the first.
        </p>
      ) : (
        <ol className="space-y-1">
          {rows.map((p, i) => {
            const rank = i + 1;
            const chipStyle =
              rank <= 3
                ? // Medals are always light (gold/cream/bronze), so force
                  // dark ink regardless of theme.
                  ({
                    ["--chip-color"]: MEDAL_COLORS[rank as 1 | 2 | 3],
                    ["--chip-ink"]: "#1e1b4d",
                  } as CSSProperties)
                : (() => {
                    const c = chipColorsForPlayer(p.id);
                    return {
                      ["--chip-color"]: c.bg,
                      ["--chip-ink"]: c.ink,
                    } as CSSProperties;
                  })();
            const content = (
              <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[color:color-mix(in_oklch,var(--game-ink)_5%,transparent)] transition">
                <span
                  className="player-chip w-9 h-9 text-sm shrink-0"
                  style={chipStyle}
                >
                  {rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold truncate leading-tight">
                    {p.display_name}
                  </p>
                  {p.handle && (
                    <p className="text-[11px] font-mono text-muted-foreground truncate leading-tight">
                      @{p.handle}
                    </p>
                  )}
                </div>
                <span className="font-mono font-black text-lg text-[var(--game-ink)]">
                  {format(p[metric] as number)}
                </span>
              </div>
            );
            return (
              <li key={p.id}>
                {p.handle ? (
                  <Link
                    href={`/u/${p.handle}`}
                    className="block"
                    data-leader-row={rank}
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default async function LeadersPage() {
  const supabase = await createSupabaseServerClient();

  const [scoreRes, winsRes, streakRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, display_name, avatar_url, handle, total_score, games_won, daily_longest_streak",
      )
      .gt("total_score", 0)
      .order("total_score", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("profiles")
      .select(
        "id, display_name, avatar_url, handle, total_score, games_won, daily_longest_streak",
      )
      .gt("games_won", 0)
      .order("games_won", { ascending: false })
      .order("total_score", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("profiles")
      .select(
        "id, display_name, avatar_url, handle, total_score, games_won, daily_longest_streak",
      )
      .gt("daily_longest_streak", 0)
      .order("daily_longest_streak", { ascending: false })
      .limit(LIMIT),
  ]);

  const scoreRows = (scoreRes.data ?? []) as Row[];
  const winsRows = (winsRes.data ?? []) as Row[];
  const streakRows = (streakRes.data ?? []) as Row[];

  return (
    <main className="game-canvas min-h-screen flex flex-col items-center gap-8 px-4 py-12">
      <header className="text-center space-y-3 max-w-xl">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Hall of fame
        </p>
        <h1 className="game-hero text-4xl sm:text-6xl">
          Hall of <span className="game-hero-mark">fame</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          All-time totals across every room you've played. Sign in to climb.
        </p>
      </header>

      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-5">
        <Board
          title="Most points"
          subtitle="lifetime score"
          rows={scoreRows}
          metric="total_score"
          accent="var(--game-pink)"
        />
        <Board
          title="Most wins"
          subtitle="games won"
          rows={winsRows}
          metric="games_won"
          accent="var(--game-cyan)"
        />
        <Board
          title="Longest streak"
          subtitle="daily puzzle"
          rows={streakRows}
          metric="daily_longest_streak"
          accent="var(--game-orange)"
          format={(n) => `${n}🔥`}
        />
      </div>

      <Link
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
      >
        ← Promptionary
      </Link>
    </main>
  );
}
