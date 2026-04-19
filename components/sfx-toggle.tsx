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
      className={`sticker ${className}`}
      style={
        {
          ["--sticker-tilt"]: "0deg",
          ...(displayMuted
            ? {
                background: "var(--game-canvas-dark)",
                color: "var(--game-canvas-yellow)",
              }
            : {}),
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      <span aria-hidden className="text-base leading-none">
        {displayMuted ? "🔇" : "🔊"}
      </span>
    </button>
  );
}
