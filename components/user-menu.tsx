"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createSupabaseAuthBrowserClient } from "@/lib/supabase/client";
import { signOutAction } from "@/app/actions/sign-out";

type Profile = {
  display_name: string;
  avatar_url: string | null;
  handle?: string | null;
};

export function UserMenu({
  className = "",
  initialIsAnon = true,
  initialProfile = null,
}: {
  className?: string;
  initialIsAnon?: boolean;
  initialProfile?: Profile | null;
}) {
  // Server passes the auth state down so first paint is correct after a
  // magic-link / OAuth redirect. Client useEffect still runs so sign-ins
  // and sign-outs in-session stay reactive.
  const [loaded, setLoaded] = useState(!initialIsAnon);
  const [isAnon, setIsAnon] = useState(initialIsAnon);
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseAuthBrowserClient();

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user || user.is_anonymous) {
        setIsAnon(true);
        setProfile(null);
        setLoaded(true);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url, handle")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setIsAnon(false);
      setProfile(
        data
          ? {
              display_name: data.display_name,
              avatar_url: data.avatar_url,
              handle: data.handle,
            }
          : {
              display_name: user.email?.split("@")[0] ?? "player",
              avatar_url: null,
              handle: null,
            },
      );
      setLoaded(true);
    }

    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  // Render the Sign-in CTA optimistically so the header isn't empty on first
  // paint. If we later discover the user is signed in, the component swaps
  // to the avatar pill below.
  if (!loaded || isAnon) {
    return (
      <Link
        href="/sign-in"
        data-user-menu-signin="1"
        className={`inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card/70 backdrop-blur px-3 text-sm font-semibold text-foreground shadow-sm hover:bg-card transition ${className}`}
      >
        <span aria-hidden>👤</span>
        <span>Sign in</span>
      </Link>
    );
  }

  const initial = profile?.display_name[0]?.toUpperCase() ?? "?";

  return (
    <div ref={popoverRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-user-menu="1"
        className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card/70 backdrop-blur pl-1 pr-3 text-sm font-semibold text-foreground shadow-sm hover:bg-card transition"
      >
        {profile?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span className="player-chip w-8 h-8 text-xs">{initial}</span>
        )}
        <span className="hidden sm:inline max-w-[8rem] truncate">
          {profile?.display_name}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="game-card bg-[var(--game-paper)] absolute right-0 top-12 z-50 min-w-[12rem] text-popover-foreground p-1"
        >
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Signed in as
            <div className="font-semibold text-foreground truncate">
              {profile?.display_name}
            </div>
            {profile?.handle && (
              <div className="font-mono text-[11px] truncate">
                @{profile.handle}
              </div>
            )}
          </div>
          {profile?.handle && (
            <Link
              href={`/u/${profile.handle}`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm hover:bg-muted transition"
            >
              Public profile
            </Link>
          )}
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm hover:bg-muted transition"
          >
            Account + passkeys
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              data-user-menu-signout="1"
              className="w-full text-left rounded-lg px-3 py-2 text-sm hover:bg-muted transition"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
