"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasskeySignInButton } from "@/components/passkey-buttons";

export function SignInCard({
  nextPath,
  initialError,
}: {
  nextPath: string;
  initialError: string | null;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<null | "google" | "discord" | "email">(null);
  const [error, setError] = useState<string | null>(initialError);
  const [sent, setSent] = useState(false);

  const redirectTo = () => {
    if (typeof window === "undefined") return "/auth/callback";
    const url = new URL("/auth/callback", window.location.origin);
    url.searchParams.set("next", nextPath);
    return url.toString();
  };

  async function oauth(provider: "google" | "discord") {
    setBusy(provider);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // If the user is already anonymous, link the new identity so their
    // user_id (and any in-flight rooms / Daily guesses) survives the
    // upgrade. Otherwise do a fresh OAuth sign-in.
    const linking = !!user?.is_anonymous;
    const { error: err } = linking
      ? await supabase.auth.linkIdentity({
          provider,
          options: { redirectTo: redirectTo() },
        })
      : await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: redirectTo() },
        });
    if (err) {
      setError(
        err.message.includes("provider is not enabled")
          ? `${provider === "google" ? "Google" : "Discord"} sign-in isn't enabled yet. Ask the host to flip it on in the Supabase dashboard.`
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
    const supabase = createSupabaseBrowserClient();
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
      <div className="w-full max-w-sm rounded-3xl bg-card border border-border shadow-xl p-6 text-center space-y-2">
        <p className="text-2xl font-heading font-black">Check your inbox</p>
        <p className="text-sm text-muted-foreground">
          We sent a sign-in link to <span className="font-semibold">{email}</span>.
          Open it in this browser to finish signing in.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-3xl bg-card/90 backdrop-blur border border-border shadow-xl p-6 space-y-5">
      <div className="space-y-2">
        <PasskeySignInButton />
        <Button
          onClick={() => oauth("google")}
          disabled={busy !== null}
          className="w-full h-11 rounded-xl font-semibold"
          variant="outline"
          data-provider="google"
        >
          {busy === "google" ? "Redirecting…" : "Continue with Google"}
        </Button>
        <Button
          onClick={() => oauth("discord")}
          disabled={busy !== null}
          className="w-full h-11 rounded-xl font-semibold text-white"
          style={{ background: "#5865F2", borderColor: "#5865F2" }}
          data-provider="discord"
        >
          {busy === "discord" ? "Redirecting…" : "Continue with Discord"}
        </Button>
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
          className="w-full h-11 rounded-xl font-bold"
        >
          {busy === "email" ? "Sending link…" : "Email me a sign-in link"}
        </Button>
      </form>

      {error && (
        <div className="text-sm bg-red-500/20 border border-red-500/30 rounded-xl p-3">
          {error}
        </div>
      )}
    </div>
  );
}
