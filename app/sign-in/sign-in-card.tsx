"use client";

import { useState } from "react";
import type { Provider } from "@supabase/supabase-js";
import { createSupabaseAuthBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasskeyContinueButton } from "@/components/passkey-buttons";

type OAuthProvider = "google" | "discord" | "vercel";

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: "Google",
  discord: "Discord",
  vercel: "Vercel",
};

export function SignInCard({
  nextPath,
  initialError,
}: {
  nextPath: string;
  initialError: string | null;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<null | OAuthProvider | "email">(null);
  const [error, setError] = useState<string | null>(initialError);
  const [sent, setSent] = useState(false);

  const redirectTo = () => {
    if (typeof window === "undefined") return "/auth/callback";
    const url = new URL("/auth/callback", window.location.origin);
    url.searchParams.set("next", nextPath);
    return url.toString();
  };

  async function oauth(provider: OAuthProvider) {
    setBusy(provider);
    setError(null);
    const supabase = createSupabaseAuthBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // If the user is already anonymous, link the new identity so their
    // user_id (and any in-flight rooms / Daily guesses) survives the
    // upgrade. Otherwise do a fresh OAuth sign-in.
    const linking = !!user?.is_anonymous;
    // "vercel" isn't in @supabase/auth-js's `Provider` union yet, but the
    // REST API accepts any configured provider string at runtime.
    const providerArg = provider as Provider;
    const { error: err } = linking
      ? await supabase.auth.linkIdentity({
          provider: providerArg,
          options: { redirectTo: redirectTo() },
        })
      : await supabase.auth.signInWithOAuth({
          provider: providerArg,
          options: { redirectTo: redirectTo() },
        });
    if (err) {
      setError(
        err.message.includes("provider is not enabled")
          ? `${PROVIDER_LABEL[provider]} sign-in isn't enabled yet. Ask the host to flip it on in the Supabase dashboard.`
          : err.message,
      );
      setBusy(null);
    }
    // On success the browser redirects to the provider, so no state reset.
  }

  async function magicLink(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy("email");
    setError(null);
    const supabase = createSupabaseAuthBrowserClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: redirectTo() },
    });
    if (err) {
      setError(err.message);
    } else {
      setSent(true);
    }
    setBusy(null);
  }

  if (sent) {
    return (
      <div className="game-card bg-[var(--game-paper)] w-full max-w-sm p-6 text-center space-y-2">
        <p className="text-2xl font-heading font-black">Check your inbox</p>
        <p className="text-sm text-muted-foreground">
          We sent a sign-in link to <span className="font-semibold">{email}</span>.
          Open it in this browser to finish signing in.
        </p>
      </div>
    );
  }

  return (
    <div className="game-card bg-[var(--game-paper)] w-full max-w-sm p-6 space-y-5">
      <div className="space-y-2">
        <Button
          onClick={() => oauth("google")}
          disabled={busy !== null}
          variant="outline"
          className="w-full h-12"
          data-provider="google"
        >
          {busy === "google" ? "Redirecting…" : "Continue with Google"}
        </Button>
        <Button
          onClick={() => oauth("discord")}
          disabled={busy !== null}
          className="w-full h-12"
          style={{
            background: "var(--game-cyan)",
            color: "var(--game-ink)",
          }}
          data-provider="discord"
        >
          {busy === "discord" ? "Redirecting…" : "Continue with Discord"}
        </Button>
        <Button
          onClick={() => oauth("vercel")}
          disabled={busy !== null}
          className="w-full h-12 bg-black text-white hover:bg-black/90"
          data-provider="vercel"
        >
          {busy === "vercel" ? (
            "Redirecting…"
          ) : (
            <span className="inline-flex items-center gap-2">
              <svg
                aria-hidden="true"
                viewBox="0 0 76 65"
                className="h-4 w-auto"
                fill="currentColor"
              >
                <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
              </svg>
              Continue with Vercel
            </span>
          )}
        </Button>
        <PasskeyContinueButton />
      </div>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          or
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={magicLink} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="signin-email">Email</Label>
          <Input
            id="signin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            disabled={busy !== null}
          />
        </div>
        <Button
          type="submit"
          disabled={busy !== null || !email.trim()}
          className="w-full h-12"
          style={{
            background: "var(--game-orange)",
            color: "var(--game-ink)",
          }}
        >
          {busy === "email" ? "Sending link…" : "Send magic link"}
        </Button>
      </form>

      {error && (
        <div className="text-sm bg-destructive/20 border border-destructive rounded-xl p-3">
          {error}
        </div>
      )}
    </div>
  );
}
