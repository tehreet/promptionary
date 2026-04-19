import { Suspense } from "react";
import Link from "next/link";
import { SignInCard } from "./sign-in-card";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <main className="min-h-screen promptionary-gradient promptionary-grain flex flex-col items-center justify-center gap-6 px-6 py-16">
      <header className="text-center space-y-2 max-w-md">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Sign in
        </p>
        <h1 className="text-hero text-4xl sm:text-5xl">Save your score</h1>
        <p className="text-sm text-muted-foreground">
          Keep your Daily streak and top guesses across devices. Or keep playing
          as a guest — invite links work either way.
        </p>
      </header>

      <Suspense>
        <SignInCard nextPath={next ?? "/"} initialError={error ?? null} />
      </Suspense>

      <Link
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
      >
        ← Back
      </Link>
    </main>
  );
}
