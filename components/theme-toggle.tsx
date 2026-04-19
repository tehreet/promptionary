"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted ? resolvedTheme === "dark" : false;

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
      className={`sticker ${className}`}
      style={
        {
          ["--sticker-tilt"]: "0deg",
          ...(dark
            ? {
                background: "var(--game-ink)",
                color: "var(--game-canvas-yellow)",
              }
            : {}),
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      <span aria-hidden className="text-base leading-none">
        {dark ? "☀︎" : "☾"}
      </span>
    </button>
  );
}
