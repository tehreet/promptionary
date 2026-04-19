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
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/70 backdrop-blur text-foreground shadow-sm hover:bg-card transition ${className}`}
      suppressHydrationWarning
    >
      <span aria-hidden className="text-lg leading-none">
        {dark ? "☀︎" : "☾"}
      </span>
    </button>
  );
}
