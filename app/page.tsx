import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("rooms")
    .select("*", { count: "exact", head: true });

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 text-white">
      <h1 className="text-7xl font-black tracking-tight drop-shadow-lg">
        Promptionary
      </h1>
      <p className="text-xl opacity-90 font-medium">
        Pictionary, in reverse.
      </p>
      <p className="text-sm opacity-70">
        Rooms created so far: {count ?? 0}
      </p>
    </main>
  );
}
