import Link from "next/link";
import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { colorForPlayer } from "@/lib/player";

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

const MEDAL: Record<number, string> = {
  1: "#facc15",
  2: "#a3a3a3",
  3: "#d97706",
};

function Board({
  title,
  subtitle,
  rows,
  metric,
  format = (n: number) => String(n),
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  metric: keyof Pick<Row, "total_score" | "games_won" | "daily_longest_streak">;
  format?: (n: number) => string;
}) {
  return (
    <section
      data-board={metric}
      className="w-full rounded-3xl bg-card border border-border shadow-lg p-5 flex flex-col gap-3"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="font-heading font-black text-lg">{title}</h2>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {subtitle}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-6 text-center">
          Nobody's on the board yet. Be the first.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((p, i) => {
            const rank = i + 1;
            const medal = MEDAL[rank];
            const initial = p.display_name[0]?.toUpperCase() ?? "?";
            const content = (
              <div
                className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-muted/60 transition"
                style={
                  medal
                    ? {
                        boxShadow: `inset 0 0 0 1px ${medal}40`,
                      }
                    : undefined
                }
              >
                <span
                  className="w-6 text-right font-mono font-black text-sm"
                  style={medal ? { color: medal } : { opacity: 0.5 }}
                >
                  {rank}
                </span>
                {p.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.avatar_url}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="h-8 w-8 rounded-full flex items-center justify-center text-white font-black text-xs"
                    style={{ background: colorForPlayer(p.id) }}
                  >
                    {initial}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate leading-tight">
                    {p.display_name}
                  </p>
                  {p.handle && (
                    <p className="text-[11px] font-mono text-muted-foreground truncate leading-tight">
                      @{p.handle}
                    </p>
                  )}
                </div>
                <span className="font-heading font-black text-lg font-mono">
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
    <main className="min-h-screen promptionary-gradient promptionary-grain flex flex-col items-center gap-6 px-4 py-12">
      <header className="text-center space-y-2 max-w-xl">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Hall of fame
        </p>
        <h1 className="text-hero text-4xl sm:text-6xl">Leaders</h1>
        <p className="text-sm text-muted-foreground">
          All-time totals across every room you've played. Sign in to climb.
        </p>
      </header>

      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-4">
        <Board
          title="Most points"
          subtitle="lifetime score"
          rows={scoreRows}
          metric="total_score"
        />
        <Board
          title="Most wins"
          subtitle="games won"
          rows={winsRows}
          metric="games_won"
        />
        <Board
          title="Longest streak"
          subtitle="daily puzzle"
          rows={streakRows}
          metric="daily_longest_streak"
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
