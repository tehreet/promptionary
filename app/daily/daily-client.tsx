"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { randomDisplayName, colorForPlayer } from "@/lib/player";
import {
  PromptFlipboard,
  type PromptToken,
  type TokenRole,
} from "@/components/prompt-flipboard";
import { ArtLoader } from "@/components/art-loader";

type DailyGuess = {
  id: string;
  display_name: string;
  guess: string;
  subject_score: number;
  style_score: number;
  semantic_score: number;
  total_score: number;
  submitted_at: string;
};

type LeaderRow = {
  id: string;
  player_id: string;
  display_name: string;
  guess: string;
  total_score: number;
  submitted_at: string;
};

type Token = { position: number; token: string; role: string };

function formatTimeUntilMidnightUtc(now: Date): string {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  const ms = Math.max(0, next.getTime() - now.getTime());
  const totalSeconds = Math.floor(ms / 1000);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export function DailyClient(props: {
  date: string;
  imageUrl: string | null;
  myGuess: DailyGuess | null;
  myPrompt: string | null;
  myTokens: Token[];
  leaderboard: LeaderRow[];
  currentPlayerId: string;
  defaultName?: string | null;
}) {
  const initialName = useMemo(
    () => props.defaultName ?? randomDisplayName(),
    [props.defaultName],
  );
  const router = useRouter();
  const [displayName, setDisplayName] = useState<string>(initialName);
  const [guess, setGuess] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    total_score: number;
    breakdown: {
      subject_score: number;
      style_score: number;
      semantic_score: number;
    };
    tokens: Token[];
    prompt: string;
    rank: number;
  } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>(props.leaderboard);
  const [timeLeft, setTimeLeft] = useState<string>(() =>
    formatTimeUntilMidnightUtc(new Date()),
  );

  useEffect(() => {
    // Server-provided signed-in profile name wins over localStorage.
    if (props.defaultName) return;
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem("promptionary.display-name")
        : null;
    if (stored) setDisplayName(stored);
  }, [props.defaultName]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTimeLeft(formatTimeUntilMidnightUtc(new Date()));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const alreadyDone = !!props.myGuess;

  async function submit() {
    if (!guess.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/daily/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guess: guess.trim(),
          display_name: displayName.trim() || "anon",
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `status ${res.status}`);
        setSubmitting(false);
        return;
      }
      try {
        window.localStorage.setItem(
          "promptionary.display-name",
          displayName.trim() || "anon",
        );
      } catch {}
      setResult({
        total_score: body.total_score,
        breakdown: body.breakdown,
        tokens: body.tokens,
        prompt: body.prompt,
        rank: body.rank,
      });
      // Optimistically splice my guess into the leaderboard so the user sees
      // their row immediately, then refresh from server.
      const name = displayName.trim() || "anon";
      setLeaderboard((prev) => {
        const next: LeaderRow[] = [
          ...prev,
          {
            id: "pending",
            player_id: props.currentPlayerId,
            display_name: name,
            guess: guess.trim(),
            total_score: body.total_score,
            submitted_at: new Date().toISOString(),
          },
        ];
        next.sort(
          (a, b) =>
            b.total_score - a.total_score ||
            a.submitted_at.localeCompare(b.submitted_at),
        );
        return next.slice(0, 20);
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  const resolved = result
    ? {
        total: result.total_score,
        breakdown: result.breakdown,
        tokens: result.tokens,
        prompt: result.prompt,
        rank: result.rank,
      }
    : props.myGuess && props.myPrompt
    ? {
        total: props.myGuess.total_score,
        breakdown: {
          subject_score: props.myGuess.subject_score,
          style_score: props.myGuess.style_score,
          semantic_score: props.myGuess.semantic_score,
        },
        tokens: props.myTokens,
        prompt: props.myPrompt,
        rank: computeRank(
          leaderboard,
          props.currentPlayerId,
          props.myGuess.total_score,
        ),
      }
    : null;

  const flipTokens: PromptToken[] = resolved
    ? resolved.tokens.map((t) => ({
        position: t.position,
        token: t.token,
        role: (t.role as TokenRole) ?? "filler",
      }))
    : [];

  return (
    <main
      data-daily-date={props.date}
      className="min-h-screen game-canvas flex flex-col items-center gap-6 px-6 py-10"
    >
      <header className="text-center space-y-3 max-w-2xl flex flex-col items-center">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Daily puzzle · {props.date}
        </p>
        <h1 className="game-hero text-4xl sm:text-6xl">
          <span className="game-hero-mark">Today&rsquo;s</span> prompt
        </h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          One shared prompt. One guess per person. Leaderboard resets at midnight UTC.
        </p>
        <span className="marquee-pill" aria-live="polite">
          <span className="live-dot" aria-hidden />
          resets in {timeLeft}
        </span>
      </header>

      <div className="w-full max-w-xl flex justify-center">
        {props.imageUrl ? (
          <div className="game-frame bg-[var(--game-paper)] p-2 inline-block">
            <img
              src={props.imageUrl}
              alt="Today's daily puzzle"
              className="rounded-[10px] block max-w-full h-auto"
            />
          </div>
        ) : (
          <div className="game-frame bg-[var(--game-paper)] p-2 w-full">
            <div className="aspect-square rounded-[10px] flex flex-col items-center justify-center gap-3">
              <ArtLoader size="md" />
              <p className="font-bold">Warming up today&rsquo;s image…</p>
            </div>
          </div>
        )}
      </div>

      {!alreadyDone && !result && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="w-full max-w-xl flex flex-col gap-3 game-card bg-[var(--game-paper)] p-5"
        >
          <div className="flex gap-2 items-end">
            <label className="flex-1 space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Your name
              </span>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={24}
                required
                className="h-14 text-lg"
              />
            </label>
          </div>
          <Textarea
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="What's the prompt? Subjects, style cues, mood — give it your best shot."
            maxLength={200}
            rows={3}
            className="text-lg rounded-xl min-h-[96px] resize-y leading-relaxed p-4"
          />
          <div className="flex items-center justify-between text-xs opacity-70">
            <span>{guess.length}/200</span>
            <span className="hidden sm:inline">⌘/Ctrl + Enter to submit</span>
          </div>
          {error && (
            <div className="game-card bg-destructive/20 border-destructive text-destructive-foreground p-4 text-sm">
              {error}
            </div>
          )}
          <Button
            type="submit"
            disabled={!guess.trim() || !props.imageUrl || submitting}
            className="font-bold h-14 px-8 rounded-xl text-lg"
          >
            {submitting ? "Scoring…" : "Submit guess"}
          </Button>
        </form>
      )}

      {resolved && (
        <section
          data-daily-result="1"
          className="w-full max-w-xl flex flex-col gap-4"
        >
          <div className="game-card bg-[var(--game-paper)] p-6 flex flex-col items-center gap-2">
            <p className="text-xs uppercase tracking-widest opacity-70">
              Your score
            </p>
            <p className="font-heading font-black text-5xl tabular-nums">
              {resolved.total}
            </p>
            <p className="text-sm opacity-80">
              Rank <span className="font-bold">#{resolved.rank}</span> today ·{" "}
              {resolved.breakdown.subject_score}s · {resolved.breakdown.style_score}y ·{" "}
              {resolved.breakdown.semantic_score}m
            </p>
            <ShareButton date={props.date} score={resolved.total} rank={resolved.rank} />
          </div>

          <PromptFlipboard prompt={resolved.prompt} tokens={flipTokens} />
        </section>
      )}

      {leaderboard.length > 0 && (
        <section className="w-full max-w-xl flex flex-col gap-3">
          <h2 className="text-lg font-heading font-black text-foreground/80">
            Today&rsquo;s leaderboard
          </h2>
          <ol className="flex flex-col gap-2">
            {leaderboard.map((row, i) => {
              const isMe = row.player_id === props.currentPlayerId;
              return (
                <li
                  key={row.id}
                  className="game-card bg-[var(--game-paper)] flex items-center gap-3 px-4 py-3"
                  style={
                    isMe
                      ? ({
                          background:
                            "color-mix(in oklch, var(--game-cyan) 25%, var(--game-paper))",
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span
                    className="player-chip w-10 h-10 text-sm"
                    style={
                      {
                        ["--chip-color" as string]: colorForPlayer(row.player_id),
                      } as React.CSSProperties
                    }
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-bold truncate">
                      {row.display_name}
                    </p>
                    <p className="text-xs italic text-foreground/70 truncate">
                      &ldquo;{row.guess}&rdquo;
                    </p>
                  </div>
                  <span className="font-mono text-lg text-[var(--game-ink)] tabular-nums">
                    {row.total_score}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <Link
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
      >
        ← Back to multiplayer
      </Link>
    </main>
  );
}

function ShareButton({
  date,
  score,
  rank,
}: {
  date: string;
  score: number;
  rank: number;
}) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const text = `Promptionary Daily · ${date}\n🎯 Score ${score} · rank #${rank}\nhttps://promptionary.io/daily`;
    try {
      const nav = navigator as unknown as {
        share?: (d: { text: string }) => Promise<void>;
      };
      if (nav.share) {
        await nav.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {}
    }
  }
  return (
    <Button
      onClick={share}
      data-share-button="1"
      className="mt-2 rounded-xl px-5 font-bold"
    >
      {copied ? "Copied!" : "Share result"}
    </Button>
  );
}

function computeRank(
  leaderboard: LeaderRow[],
  playerId: string,
  myScore: number,
): number {
  const better = leaderboard.filter(
    (r) => r.total_score > myScore && r.player_id !== playerId,
  ).length;
  return better + 1;
}
