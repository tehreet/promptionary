import { CreateRoomCard } from "@/components/create-room-card";
import { JoinRoomCard } from "@/components/join-room-card";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 text-white px-6 py-16">
      <div className="text-center space-y-4">
        <h1 className="text-7xl md:text-8xl font-black tracking-tight drop-shadow-lg">
          Promptionary
        </h1>
        <p className="text-xl md:text-2xl opacity-95 font-medium max-w-xl mx-auto">
          Pictionary, in reverse. Guess the prompt behind the AI&rsquo;s painting.
        </p>
      </div>
      <div className="flex flex-col md:flex-row gap-6 w-full max-w-3xl items-stretch justify-center">
        <CreateRoomCard />
        <JoinRoomCard />
      </div>
    </main>
  );
}
