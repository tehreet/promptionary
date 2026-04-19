import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";
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
    <main className="min-h-screen promptionary-gradient promptionary-grain flex flex-col items-center gap-6 px-6 py-12">
      <header className="text-center space-y-2 max-w-xl">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Account
        </p>
        <h1 className="text-hero text-4xl sm:text-5xl">
          {profile?.display_name ?? "You"}
        </h1>
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </header>

      <AccountClient />

      <Link
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
      >
        ← Home
      </Link>
    </main>
  );
}
