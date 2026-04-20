import Link from "next/link";
import { chipColorsForPlayer } from "@/lib/player";

// Small read-only types mirrored from page.tsx — deliberately kept loose so we
// don't have to export the generated DB types from the server component.
export type HighlightRound = {
  id: string;
  round_num: number;
  prompt: string | null;
  image_url: string | null;
};

export type HighlightGuess = {
  round_id: string;
  player_id: string;
  guess: string;
  total_score: number | null;
};

export type HighlightPlayer = {
  player_id: string;
  display_name: string;
};

export type ClosestGuessPick = {
  guess: HighlightGuess;
  round: HighlightRound;
  player: HighlightPlayer | null;
};

export type BiggestSwingPick = {
  round: HighlightRound;
  player: HighlightPlayer | null;
  score: number;
  average: number;
  delta: number;
};

export type MostActivePick = {
  round: HighlightRound;
  messageCount: number;
};

type Props = {
  closest: ClosestGuessPick | null;
  swing: BiggestSwingPick | null;
  active: MostActivePick | null;
};

// Curated highlights rail — sits between the leaderboard and the flat
// per-round list on /play/<code>/recap. Three independent buckets, no
// de-duplication across them. Each card links to /r/<round_id> so the
// shareable round view is one click away.
export function HighlightsSection({ closest, swing, active }: Props) {
  // If somehow every bucket is empty (e.g. a finished game with zero guesses
  // and zero chat), skip the whole section rather than render empty shells.
  if (!closest && !swing && !active) return null;

  return (
    <section
      data-recap-highlights="1"
      className="w-full max-w-4xl flex flex-col gap-4"
    >
      <div className="flex items-baseline justify-between px-1">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Highlights
        </p>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground opacity-70">
          Auto-picked moments
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ClosestGuessCard pick={closest} />
        <BiggestSwingCard pick={swing} />
        <MostActiveCard pick={active} />
      </div>
    </section>
  );
}

function HighlightShell({
  emoji,
  title,
  subtitle,
  roundId,
  tilt,
  children,
  empty,
  testId,
}: {
  emoji: string;
  title: string;
  subtitle?: string;
  roundId?: string;
  tilt?: string;
  children?: React.ReactNode;
  empty?: boolean;
  testId: string;
}) {
  const inner = (
    <div
      data-recap-highlight={testId}
      className="game-card bg-[var(--game-paper)] text-[var(--game-ink)] p-4 h-full flex flex-col gap-3"
      style={tilt ? { transform: tilt } : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--game-pink)] text-[var(--game-cream)] px-3 py-0.5 text-[10px] font-black uppercase tracking-widest border-2 border-[var(--game-ink)]">
          <span aria-hidden>{emoji}</span>
          <span>{title}</span>
        </span>
        {subtitle && (
          <span className="text-[10px] uppercase tracking-wider opacity-70 font-bold">
            {subtitle}
          </span>
        )}
      </div>
      {empty ? (
        <p className="rounded-xl border-2 border-dashed border-[var(--game-ink)]/30 px-3 py-4 text-[12px] text-muted-foreground text-center flex-1 flex items-center justify-center">
          —
        </p>
      ) : (
        children
      )}
    </div>
  );
  if (empty || !roundId) return inner;
  return (
    <Link
      href={`/r/${roundId}`}
      className="no-underline focus:outline-none focus:ring-4 focus:ring-[color:var(--game-cyan)]/50 hover:-translate-y-0.5 transition-transform rounded-[var(--radius)]"
    >
      {inner}
    </Link>
  );
}

function PlayerChip({
  player,
  size = "sm",
}: {
  player: HighlightPlayer | null;
  size?: "sm" | "md";
}) {
  if (!player) return <span className="font-bold">—</span>;
  const dim = size === "md" ? "h-6 w-6 text-[10px]" : "h-5 w-5 text-[9px]";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`player-chip ${dim}`}
        style={(() => {
          const c = chipColorsForPlayer(player.player_id);
          return {
            ["--chip-color" as string]: c.bg,
            ["--chip-ink" as string]: c.ink,
          } as React.CSSProperties;
        })()}
      >
        {player.display_name[0]?.toUpperCase() ?? "?"}
      </span>
      <span className="font-bold">{player.display_name}</span>
    </span>
  );
}

function ClosestGuessCard({ pick }: { pick: ClosestGuessPick | null }) {
  if (!pick) {
    return (
      <HighlightShell
        emoji="🎯"
        title="Closest guess"
        empty
        testId="closest"
      />
    );
  }
  const score = pick.guess.total_score ?? 0;
  return (
    <HighlightShell
      emoji="🎯"
      title="Closest guess"
      subtitle={`R${pick.round.round_num}`}
      roundId={pick.round.id}
      tilt="rotate(-1.2deg)"
      testId="closest"
    >
      <p className="text-[14px] italic leading-snug">
        &ldquo;{pick.guess.guess}&rdquo;
      </p>
      <div className="flex items-center justify-between gap-2">
        <PlayerChip player={pick.player} size="md" />
        <span className="font-mono font-black text-lg tabular-nums">
          +{score}
        </span>
      </div>
      {pick.round.prompt && (
        <p className="rounded-xl bg-[var(--game-cream)] border-2 border-[var(--game-ink)] px-3 py-1.5 text-[11px] leading-snug">
          <span className="font-black uppercase tracking-wider opacity-60 text-[9px] mr-1">
            prompt
          </span>
          {pick.round.prompt}
        </p>
      )}
    </HighlightShell>
  );
}

function BiggestSwingCard({ pick }: { pick: BiggestSwingPick | null }) {
  if (!pick) {
    return (
      <HighlightShell
        emoji="📈"
        title="Biggest swing"
        empty
        testId="swing"
      />
    );
  }
  return (
    <HighlightShell
      emoji="📈"
      title="Biggest swing"
      subtitle={`R${pick.round.round_num}`}
      roundId={pick.round.id}
      tilt="rotate(1.4deg)"
      testId="swing"
    >
      <div className="flex items-center justify-between gap-2">
        <PlayerChip player={pick.player} size="md" />
        <span className="font-mono font-black text-2xl tabular-nums">
          {pick.score}
        </span>
      </div>
      <p className="text-[11px] uppercase tracking-wider opacity-70">
        {pick.delta > 0 ? "+" : ""}
        {pick.delta} vs round avg ({pick.average})
      </p>
      {pick.round.prompt && (
        <p className="rounded-xl bg-[var(--game-cream)] border-2 border-[var(--game-ink)] px-3 py-1.5 text-[11px] leading-snug">
          <span className="font-black uppercase tracking-wider opacity-60 text-[9px] mr-1">
            prompt
          </span>
          {pick.round.prompt}
        </p>
      )}
    </HighlightShell>
  );
}

function MostActiveCard({ pick }: { pick: MostActivePick | null }) {
  if (!pick) {
    return (
      <HighlightShell
        emoji="💬"
        title="Most active"
        empty
        testId="active"
      />
    );
  }
  return (
    <HighlightShell
      emoji="💬"
      title="Most active"
      subtitle={`R${pick.round.round_num}`}
      roundId={pick.round.id}
      tilt="rotate(-0.8deg)"
      testId="active"
    >
      <div className="flex items-center gap-3">
        {pick.round.image_url ? (
          <div className="game-frame bg-[var(--game-paper)] p-1 overflow-hidden shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pick.round.image_url}
              alt={`Round ${pick.round.round_num} painting`}
              className="rounded-[8px] block w-20 h-20 object-cover"
            />
          </div>
        ) : (
          <div className="rounded-[8px] bg-muted w-20 h-20 flex items-center justify-center text-[10px] text-muted-foreground shrink-0">
            no image
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-mono font-black text-3xl tabular-nums leading-none">
            {pick.messageCount}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
            chat message{pick.messageCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </HighlightShell>
  );
}
