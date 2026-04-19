import Link from "next/link";
import { CreateRoomCard } from "@/components/create-room-card";
import { JoinRoomCard } from "@/components/join-room-card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";

const steps = [
  {
    n: "1",
    title: "The AI paints",
    body: "Every round, a secret prompt becomes a fresh image — style, mood, oddness and all.",
  },
  {
    n: "2",
    title: "You guess the words",
    body: "Type what you think was written. Nail the subjects, style cues, and vibes for bigger scores.",
  },
  {
    n: "3",
    title: "Reveal and roast",
    body: "See the true prompt, your ranked guesses, and the hilarious gap in between.",
  },
];

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const profile = await getCurrentProfile(supabase);
  const defaultName = profile?.display_name ?? null;
  return (
    <main className="min-h-screen promptionary-gradient promptionary-grain flex flex-col items-center gap-16 px-6 py-20">
      <section className="text-center space-y-5 pt-6 max-w-3xl">
        <h1 className="text-hero text-6xl md:text-8xl">Promptionary</h1>
        <p className="text-xl md:text-2xl text-foreground/80 font-medium max-w-xl mx-auto">
          Pictionary, in reverse. Guess the prompt behind the AI&rsquo;s painting.
        </p>
      </section>

      <section className="flex flex-col md:flex-row gap-5 w-full max-w-3xl items-stretch justify-center">
        <CreateRoomCard defaultName={defaultName} />
        <JoinRoomCard defaultName={defaultName} />
      </section>

      <section className="w-full max-w-3xl">
        <Link
          href="/daily"
          data-daily-cta="1"
          className="group flex items-center justify-between gap-4 rounded-3xl bg-card/90 backdrop-blur border border-border px-6 py-5 shadow-sm hover:shadow-md transition"
        >
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Solo
            </p>
            <p className="text-xl sm:text-2xl font-heading font-black">
              Play today&rsquo;s Daily puzzle
            </p>
            <p className="text-sm text-muted-foreground">
              One shared image. One guess. Global leaderboard resets at midnight UTC.
            </p>
          </div>
          <span className="text-3xl shrink-0 group-hover:translate-x-1 transition-transform">
            →
          </span>
        </Link>
      </section>

      <section className="w-full max-w-4xl grid gap-5 md:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.n}
            className="rounded-3xl bg-card/80 backdrop-blur border border-border p-6 space-y-2 shadow-sm"
          >
            <p className="text-4xl font-heading font-black text-primary opacity-80">
              {s.n}
            </p>
            <h3 className="text-lg font-heading font-black">{s.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {s.body}
            </p>
          </div>
        ))}
      </section>

      <footer className="text-xs text-muted-foreground pt-4">
        Made for friends. Powered by Gemini.
      </footer>
    </main>
  );
}
