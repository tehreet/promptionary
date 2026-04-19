import Link from "next/link";
import { CreateRoomCard } from "@/components/create-room-card";
import { JoinRoomCard } from "@/components/join-room-card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";

const steps = [
  {
    n: "1",
    title: "One of you writes",
    body: "Each round picks an artist. They type a secret prompt nobody else sees.",
    dotColor: "var(--game-pink)",
    tilt: -4,
  },
  {
    n: "2",
    title: "The AI paints it",
    body: "Gemini renders whatever the artist wrote. Style, mood, weirdness and all.",
    dotColor: "var(--game-cyan)",
    tilt: 3,
  },
  {
    n: "3",
    title: "The rest guess",
    body: "Type what you think was written. The artist's score is the average of everyone's guesses — so no cheating with 'a dog'.",
    dotColor: "var(--game-orange)",
    tilt: -3,
  },
];

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const profile = await getCurrentProfile(supabase);
  const defaultName = profile?.display_name ?? null;

  return (
    <main className="min-h-screen game-canvas-page flex flex-col items-center gap-14 px-5 py-12 sm:py-16">
      {/* Hero */}
      <section className="text-center max-w-3xl pt-2">
        <span
          className="sticker mb-5"
          style={{ ["--sticker-tilt" as string]: "-2deg" } as React.CSSProperties}
        >
          a ridiculous party game
        </span>
        <h1 className="game-hero text-5xl sm:text-7xl md:text-8xl mb-5">
          Guess the <span className="game-hero-mark">prompt.</span>
        </h1>
        <p
          className="text-lg sm:text-xl font-medium max-w-xl mx-auto leading-snug"
          style={{ color: "color-mix(in oklch, var(--game-ink) 85%, transparent)" }}
        >
          One of you writes a secret prompt. The AI paints it. The rest have to
          figure out what was written — and the worse the guess, the better the night.
        </p>
      </section>

      {/* Create / Join */}
      <section className="flex flex-col md:flex-row gap-8 w-full max-w-3xl items-stretch justify-center">
        <CreateRoomCard defaultName={defaultName} />
        <JoinRoomCard defaultName={defaultName} />
      </section>

      {/* Daily CTA */}
      <section className="w-full max-w-3xl">
        <Link
          href="/daily"
          data-daily-cta="1"
          className="game-card group flex items-center justify-between gap-4 px-6 py-5"
          style={{
            background: "var(--game-ink)",
            color: "var(--game-cream)",
          }}
        >
          <div className="min-w-0">
            <p
              className="text-[10px] uppercase tracking-widest font-black"
              style={{ color: "var(--game-orange)" }}
            >
              Solo · today only
            </p>
            <p className="text-xl sm:text-2xl font-heading font-black">
              Play today&rsquo;s Daily puzzle
            </p>
            <p className="text-sm opacity-85">
              One shared image. One guess. Global leaderboard resets at midnight UTC.
            </p>
          </div>
          <span className="text-3xl shrink-0 group-hover:translate-x-1 transition-transform">
            →
          </span>
        </Link>
      </section>

      {/* How it plays */}
      <section
        className="w-full max-w-3xl rounded-[22px] px-6 py-9 sm:px-10 sm:py-11 game-card"
        style={{
          background: "var(--game-ink)",
          color: "var(--game-cream)",
        }}
      >
        <h2 className="text-center font-heading font-black italic text-2xl sm:text-3xl mb-7">
          How it goes down
        </h2>
        <div className="grid gap-7 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="text-center space-y-2">
              <div
                className="mx-auto w-12 h-12 rounded-full flex items-center justify-center font-heading font-black italic text-xl"
                style={{
                  background: s.dotColor,
                  color: "var(--game-ink)",
                  border: "3px solid var(--game-cream)",
                  transform: `rotate(${s.tilt}deg)`,
                }}
              >
                {s.n}
              </div>
              <h3 className="font-heading font-black text-base">{s.title}</h3>
              <p className="text-sm opacity-80 leading-snug">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer
        className="text-xs pt-2"
        style={{ color: "color-mix(in oklch, var(--game-ink) 70%, transparent)" }}
      >
        Made for friends. Powered by Gemini.
      </footer>
    </main>
  );
}
