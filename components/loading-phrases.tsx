"use client";

import { useEffect, useState } from "react";
import { LOADING_PHRASES, pickPhraseIndex } from "@/lib/loading-phrases";

export function LoadingPhrases({
  seed,
  intervalMs = 2200,
  className = "",
}: {
  seed?: string;
  intervalMs?: number;
  className?: string;
}) {
  const [i, setI] = useState(() =>
    seed ? pickPhraseIndex(seed) : Math.floor(Math.random() * LOADING_PHRASES.length),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setI((prev) => (prev + 1) % LOADING_PHRASES.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const phrase = LOADING_PHRASES[i];

  return (
    <p
      key={i}
      data-loading-phrase="1"
      className={`loading-phrase font-heading italic text-base text-[var(--game-cream)] ${className}`}
      aria-live="polite"
    >
      {phrase}
    </p>
  );
}
