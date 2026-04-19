import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";
import { ProfileStatsCard } from "@/components/profile-stats-card";
import { AccountClient } from "./account-client";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    redirect("/sign-in?next=/account");
  }

  const profile = await getCurrentProfile(supabase);

  return (
    <main className="game-canvas min-h-screen flex flex-col items-center gap-6 px-6 py-12">
      <header className="text-center space-y-2 max-w-xl">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Account
        </p>
        <h1 className="game-hero text-4xl sm:text-5xl">
          <span className="game-hero-mark">{profile?.display_name ?? "You"}</span>
        </h1>
        <p className="text-sm text-muted-foreground">{user.email}</p>
        {profile?.handle && (
          <Link
            href={`/u/${profile.handle}`}
            data-public-profile-link="1"
            className="inline-block text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            @{profile.handle}
          </Link>
        )}
      </header>

      {profile && (
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
      )}

      <AccountClient />

      <div className="flex gap-4 text-xs text-muted-foreground">
        <Link
          href="/leaders"
          className="hover:text-foreground underline-offset-4 hover:underline"
        >
          🏆 Leaders
        </Link>
        <Link
          href="/"
          className="hover:text-foreground underline-offset-4 hover:underline"
        >
          ← Home
        </Link>
      </div>
    </main>
  );
}
