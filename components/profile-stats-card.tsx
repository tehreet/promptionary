type Stats = {
  games_played: number;
  games_won: number;
  rounds_played: number;
  total_score: number;
  best_round_score: number;
  daily_streak: number;
  daily_longest_streak: number;
};

const DOT_COLORS = [
  "var(--game-pink)",
  "var(--game-cyan)",
  "var(--game-orange)",
  "var(--game-canvas-yellow)",
  "var(--game-pink)",
  "var(--game-cyan)",
];

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
      className={`game-card bg-[var(--game-paper)] w-full max-w-xl p-6 ${className}`}
    >
      <h2 className="game-hero text-xl mb-4">Your stats</h2>
      <div
        className="rounded-xl p-5 grid grid-cols-2 sm:grid-cols-3 gap-4"
        style={{
          background: "var(--game-canvas-dark)",
          color: "var(--game-cream)",
        }}
      >
        {cells.map((cell, i) => (
          <div key={cell.label} className="text-center flex flex-col items-center gap-0.5">
            <span
              className="inline-block w-2 h-2 rounded-full mb-1"
              style={{ background: DOT_COLORS[i % DOT_COLORS.length] }}
              aria-hidden
            />
            <p className="font-heading font-black font-mono text-2xl leading-none">
              {cell.value}
            </p>
            <p className="text-[10px] uppercase tracking-wider opacity-80">
              {cell.label}
            </p>
            {cell.sub && (
              <p className="text-[10px] opacity-70">{cell.sub}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
