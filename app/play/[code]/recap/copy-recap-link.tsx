"use client";

import { useCallback, useState } from "react";

// Small inline button for the recap hero — copies the current page URL to the
// clipboard so hosts can fire off the link in whatever chat they came from.
// Mirrors the /r/[round_id] CopyShareLink pattern.
export function CopyRecapLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/play/${code}/recap`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API may be blocked — silently noop.
    }
  }, [code]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Copy shareable recap link"
      data-copy-recap-link="1"
      className="inline-flex items-center gap-1 rounded-full bg-[var(--game-paper)] border-2 border-[var(--game-ink)] text-[var(--game-ink)] text-[11px] font-black uppercase tracking-widest px-4 py-1.5 shadow-md hover:-translate-y-0.5 transition-transform"
    >
      {copied ? "Link copied" : "Copy recap link"}
    </button>
  );
}
