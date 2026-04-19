"use client";

import { useEffect, useRef, useState } from "react";
import { useRoomChannel } from "@/lib/room-channel";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Reaction = {
  // Stable key across broadcast / DB fetch / local spawn. Server rows reuse
  // their DB uuid; locally-spawned (pre-persist) ones use `local:<n>`.
  id: string;
  emoji: string;
  x: number;
  y: number;
  color: string;
};

const REACTIONS = ["🔥", "💀", "🤌", "👏", "😂", "🧠"] as const;

// How far back to pull persisted reactions when a tab mounts. The animation
// itself runs ~1800ms, so 10s is plenty of runway for late joiners /
// refreshes / reconnects to see whatever just happened.
const CATCHUP_WINDOW_SECONDS = 10;

let nextLocalId = 1;

export function ReactionsBar({
  targetRef: _targetRef,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
}) {
  const { channel, player, roomId } = useRoomChannel();
  const [floats, setFloats] = useState<Reaction[]>([]);
  // Track which IDs we've already rendered so broadcast + catch-up fetch +
  // local spawn don't duplicate the same reaction on screen.
  const seenRef = useRef<Set<string>>(new Set());

  // Live broadcast — fast path, arrives within a frame or two.
  useEffect(() => {
    if (!channel) return;
    channel.on(
      "broadcast",
      { event: "reaction" },
      (event: { payload?: unknown }) => {
        const p = event.payload as
          | { id?: string; emoji: string; x: number; y: number; color: string }
          | undefined;
        if (!p) return;
        spawn(p.id ?? `remote:${nextLocalId++}`, p.emoji, p.x, p.y, p.color);
      },
    );
  }, [channel]);

  // Catch-up fetch on mount — covers late joiners, tab refresh, reconnects.
  // The broadcast channel only delivers events that happen after subscribe;
  // without this, someone who joins 3s after a reaction just missed it.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    (async () => {
      const sinceIso = new Date(
        Date.now() - CATCHUP_WINDOW_SECONDS * 1000,
      ).toISOString();
      const { data } = await supabase
        .from("room_reactions")
        .select("id, emoji, color, x, y, created_at")
        .eq("room_id", roomId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: true })
        .limit(50);
      if (cancelled || !data) return;
      for (const r of data) {
        spawn(r.id, r.emoji, r.x, r.y, r.color);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  function spawn(id: string, emoji: string, x: number, y: number, color: string) {
    if (seenRef.current.has(id)) return;
    seenRef.current.add(id);
    setFloats((prev) => [...prev, { id, emoji, x, y, color }]);
    setTimeout(() => {
      setFloats((prev) => prev.filter((r) => r.id !== id));
      // Leave the id in seenRef — we never want to re-render the same
      // reaction, even if a stale broadcast arrives after the animation
      // finishes. The set is per-session so it can't grow unbounded.
    }, 1800);
  }

  async function fire(emoji: string) {
    const x = 0.15 + Math.random() * 0.7;
    const y = 0.85;
    // Instant local feedback — even if the channel is still connecting or
    // the RPC round-trips slowly, the clicker sees their own emoji fly.
    const localId = `local:${nextLocalId++}`;
    spawn(localId, emoji, x, y, player.color);

    // Broadcast for the fast path to other tabs in the same room.
    if (channel) {
      channel.send({
        type: "broadcast",
        event: "reaction",
        payload: { id: localId, emoji, x, y, color: player.color },
      });
    }

    // Persist so the next tab that mounts within CATCHUP_WINDOW_SECONDS
    // still sees the activity. Rate-limited server-side; silently swallow
    // errors (it's fire-and-forget and the local+broadcast paths already
    // delivered the UX).
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.rpc("post_reaction", {
        p_room_id: roomId,
        p_emoji: emoji,
        p_color: player.color,
        p_x: x,
        p_y: y,
      });
    } catch {
      // ignore — reaction UX already happened locally + via broadcast
    }
  }

  return (
    <>
      <div className="flex flex-wrap justify-center gap-2">
        {REACTIONS.map((e, i) => (
          <button
            key={e}
            type="button"
            onClick={() => fire(e)}
            className="sticker text-base active:scale-95"
            style={
              {
                ["--sticker-tilt" as string]: `${i % 2 === 0 ? -3 : 3}deg`,
              } as React.CSSProperties
            }
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
