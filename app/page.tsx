import { CreateRoomCard } from "@/components/create-room-card";
import { JoinRoomCard } from "@/components/join-room-card";

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

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center gap-16 bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 text-white px-6 py-16">
      <section className="text-center space-y-4 pt-8">
        <h1 className="text-7xl md:text-8xl font-black tracking-tight drop-shadow-lg">
          Promptionary
        </h1>
        <p className="text-xl md:text-2xl opacity-95 font-medium max-w-xl mx-auto">
          Pictionary, in reverse. Guess the prompt behind the AI&rsquo;s painting.
        </p>
      </section>

      <section className="flex flex-col md:flex-row gap-6 w-full max-w-3xl items-stretch justify-center">
        <CreateRoomCard />
        <JoinRoomCard />
      </section>

      <section className="w-full max-w-4xl grid gap-6 md:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.n}
            className="rounded-3xl bg-white/10 backdrop-blur border border-white/20 p-6 space-y-2"
          >
            <p className="text-4xl font-black font-mono opacity-80">{s.n}</p>
            <h3 className="text-lg font-black">{s.title}</h3>
            <p className="text-sm opacity-90 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </section>

      <footer className="text-xs opacity-70 pt-4">
        Made for friends. Powered by Gemini.
      </footer>
    </main>
  );
}
