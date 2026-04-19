type Stats = {
  games_played: number;
  games_won: number;
  rounds_played: number;
  total_score: number;
  best_round_score: number;
  daily_streak: number;
  daily_longest_streak: number;
};

export function ProfileStatsCard({
  stats,
  className = "",
}: {
  stats: Stats;
  className?: string;
}) {
  const winRate =
    stats.games_played > 0
      ? Math.round((stats.games_won / stats.games_played) * 100)
      : 0;
  const avgPerRound =
    stats.rounds_played > 0
      ? Math.round(stats.total_score / stats.rounds_played)
      : 0;

  const cells: Array<{ label: string; value: string; sub?: string }> = [
    {
      label: "Games",
      value: String(stats.games_played),
      sub: stats.games_played > 0 ? `${stats.games_won} won` : undefined,
    },
    {
      label: "Win rate",
      value: stats.games_played > 0 ? `${winRate}%` : "—",
    },
    {
      label: "Rounds",
      value: String(stats.rounds_played),
      sub: avgPerRound > 0 ? `avg ${avgPerRound}` : undefined,
    },
    {
      label: "Best round",
      value: String(stats.best_round_score),
    },
    {
      label: "Total score",
      value: String(stats.total_score),
    },
    {
      label: "Daily streak",
      value: `${stats.daily_streak}🔥`,
      sub:
        stats.daily_longest_streak > 0
          ? `best ${stats.daily_longest_streak}`
          : undefined,
    },
  ];

  return (
    <div
      data-profile-stats="1"
      className={`w-full max-w-xl rounded-3xl bg-card border border-border shadow-lg p-6 space-y-4 ${className}`}
    >
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Lifetime stats
      </p>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {cells.map((c) => (
          <li
            key={c.label}
            className="rounded-2xl bg-muted/50 border border-border px-3 py-3 flex flex-col gap-0.5"
          >
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {c.label}
            </span>
            <span className="font-heading font-black text-2xl font-mono">
              {c.value}
            </span>
            {c.sub && (
              <span className="text-[11px] text-muted-foreground">{c.sub}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
