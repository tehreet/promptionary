import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileStatsCard } from "@/components/profile-stats-card";
import { colorForPlayer } from "@/lib/player";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  return {
    title: `@${handle} · Promptionary`,
    description: `Lifetime Promptionary stats for @${handle}.`,
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const normalized = handle.toLowerCase();

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, display_name, avatar_url, handle, games_played, games_won, rounds_played, total_score, best_round_score, daily_streak, daily_longest_streak",
    )
    .ilike("handle", normalized)
    .maybeSingle();

  if (!profile) notFound();

  const initial = profile.display_name[0]?.toUpperCase() ?? "?";

  return (
    <main className="min-h-screen promptionary-gradient promptionary-grain flex flex-col items-center gap-6 px-6 py-12">
      <header className="flex flex-col items-center gap-3 text-center">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            className="h-24 w-24 rounded-full object-cover shadow-lg border-4 border-card"
          />
        ) : (
          <span
            aria-hidden
            className="h-24 w-24 rounded-full flex items-center justify-center text-white font-black text-4xl shadow-lg border-4 border-card"
            style={{ background: colorForPlayer(profile.id) }}
          >
            {initial}
          </span>
        )}
        <h1 className="text-hero text-4xl sm:text-5xl">
          {profile.display_name}
        </h1>
        <p className="text-sm text-muted-foreground font-mono">
          @{profile.handle}
        </p>
      </header>

      <ProfileStatsCard
        stats={{
          games_played: profile.games_played ?? 0,
          games_won: profile.games_won ?? 0,
          rounds_played: profile.rounds_played ?? 0,
          total_score: profile.total_score ?? 0,
          best_round_score: profile.best_round_score ?? 0,
          daily_streak: profile.daily_streak ?? 0,
          daily_longest_streak: profile.daily_longest_streak ?? 0,
        }}
      />

      <Link
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
      >
        ← Promptionary
      </Link>
    </main>
  );
}
