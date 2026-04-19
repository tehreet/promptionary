"use client";

import { useEffect, useState } from "react";
import { isMuted, subscribeMuted, toggleMuted } from "@/lib/sfx";

export function SfxToggle({ className = "" }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [m, setM] = useState(false);

  useEffect(() => {
    setMounted(true);
    setM(isMuted());
    return subscribeMuted(setM);
  }, []);

  const displayMuted = mounted ? m : false;

  return (
    <button
      type="button"
      onClick={() => toggleMuted()}
      aria-label={displayMuted ? "Unmute sounds" : "Mute sounds"}
      aria-pressed={displayMuted}
      data-sfx-muted={displayMuted ? "1" : "0"}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/70 backdrop-blur text-foreground shadow-sm hover:bg-card transition ${className}`}
      suppressHydrationWarning
    >
      <span aria-hidden className="text-lg leading-none">
        {displayMuted ? "🔇" : "🔊"}
      </span>
    </button>
  );
}
