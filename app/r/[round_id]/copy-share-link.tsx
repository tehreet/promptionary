"use client";

import { useCallback, useState } from "react";

// Small icon button stamped on the top-right of the round image on the share
// page itself — tapping it copies a link back to this recap. Gives viewers a
// natural next step without adding navigation chrome.
export function CopyShareLink({ roundId }: { roundId: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/r/${roundId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // noop — clipboard API can be blocked; the URL is in the address bar
      // already.
    }
  }, [roundId]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Copy link to this round"
      className="inline-flex items-center gap-1 rounded-full bg-[var(--game-paper)]/90 border-2 border-[var(--game-ink)] text-[var(--game-ink)] text-[11px] font-black uppercase tracking-wider px-3 py-1 shadow-md hover:-translate-y-0.5 transition-transform"
    >
      {copied ? "Copied" : "Share"}
    </button>
  );
}
