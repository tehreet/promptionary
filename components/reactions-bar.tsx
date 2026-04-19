"use client";

import { useEffect, useRef, useState } from "react";
import { useRoomChannel } from "@/lib/room-channel";

type Reaction = {
  id: number;
  emoji: string;
  x: number;
  y: number;
  color: string;
};

const REACTIONS = ["🔥", "💀", "🤌", "👏", "😂", "🧠"] as const;

let nextId = 1;

export function ReactionsBar({
  targetRef,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
}) {
  const { channel, player } = useRoomChannel();
  const [floats, setFloats] = useState<Reaction[]>([]);

  // Receive reactions
  useEffect(() => {
    if (!channel) return;
    channel.on(
      "broadcast",
      { event: "reaction" },
      (event: { payload?: unknown }) => {
        const p = event.payload as
          | { emoji: string; x: number; y: number; color: string; id?: string }
          | undefined;
        if (!p) return;
        spawn(p.emoji, p.x, p.y, p.color);
      },
    );
  }, [channel]);

  function spawn(emoji: string, x: number, y: number, color: string) {
    const id = nextId++;
    setFloats((prev) => [...prev, { id, emoji, x, y, color }]);
    setTimeout(() => {
      setFloats((prev) => prev.filter((r) => r.id !== id));
    }, 1800);
  }

  function fire(emoji: string) {
    const x = 0.15 + Math.random() * 0.7;
    const y = 0.85;
    // Always render locally so the clicker sees instant feedback even if the
    // realtime channel hasn't finished subscribing yet.
    spawn(emoji, x, y, player.color);
    if (!channel) return;
    channel.send({
      type: "broadcast",
      event: "reaction",
      payload: { emoji, x, y, color: player.color },
    });
  }

  return (
    <>
      <div className="flex flex-wrap justify-center gap-1.5">
        {REACTIONS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => fire(e)}
            className="h-10 w-10 rounded-full bg-card border border-border hover:bg-muted transition text-xl leading-none shadow-sm active:scale-95"
            aria-label={`react with ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
      <FloatingReactions floats={floats} />
    </>
  );
}

function FloatingReactions({ floats }: { floats: Reaction[] }) {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-30">
      {floats.map((r) => (
        <FloatingReaction key={r.id} reaction={r} />
      ))}
    </div>
  );
}

function FloatingReaction({ reaction }: { reaction: Reaction }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // next tick so the CSS transition fires from start → end position
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className="absolute text-4xl transition-all duration-[1800ms] ease-out"
      style={{
        left: `${reaction.x * 100}%`,
        top: mounted ? "10%" : `${reaction.y * 100}%`,
        opacity: mounted ? 0 : 1,
        transform: mounted ? "scale(1.8) translateX(-50%)" : "translateX(-50%)",
      }}
    >
      {reaction.emoji}
    </div>
  );
}
