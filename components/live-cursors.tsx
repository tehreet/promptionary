"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRoomChannel } from "@/lib/room-channel";

type Cursor = {
  id: string;
  name: string;
  color: string;
  x: number; // 0..1 relative to container
  y: number;
  updatedAt: number;
};

// Throttle outgoing cursor broadcasts to ~20Hz; drop stale cursors that
// haven't updated in 2.5s.
const SEND_INTERVAL_MS = 50;
const STALE_MS = 2500;

export function LiveCursorsOverlay({ children }: { children: ReactNode }) {
  const { channel, player } = useRoomChannel();
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const lastSentRef = useRef(0);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);

  // Receive
  useEffect(() => {
    if (!channel) return;
    const handler = (event: { payload?: unknown }) => {
      const p = event.payload as Partial<Cursor> | undefined;
      const id = p?.id;
      if (!id || id === player.id) return;
      setCursors((prev) => ({
        ...prev,
        [id]: {
          id,
          name: p?.name ?? "",
          color: p?.color ?? "#fff",
          x: p?.x ?? 0,
          y: p?.y ?? 0,
          updatedAt: Date.now(),
        },
      }));
    };
    const leaveHandler = (event: { payload?: unknown }) => {
      const p = event.payload as { id?: string } | undefined;
      const id = p?.id;
      if (!id) return;
      setCursors((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    };
    channel.on("broadcast", { event: "cursor" }, handler);
    channel.on("broadcast", { event: "cursor:leave" }, leaveHandler);
  }, [channel, player.id]);

  // Sweep stale cursors
  useEffect(() => {
    const id = setInterval(() => {
      setCursors((prev) => {
        const now = Date.now();
        const next: typeof prev = {};
        let changed = false;
        for (const [k, c] of Object.entries(prev)) {
          if (now - c.updatedAt < STALE_MS) next[k] = c;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Pointer tracking + throttled broadcast
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !channel) return;

    const send = (x: number, y: number) => {
      channel.send({
        type: "broadcast",
        event: "cursor",
        payload: { id: player.id, name: player.name, color: player.color, x, y },
      });
    };

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      pendingRef.current = { x, y };
      const now = Date.now();
      if (now - lastSentRef.current > SEND_INTERVAL_MS) {
        lastSentRef.current = now;
        send(x, y);
        pendingRef.current = null;
      }
    };
    const onLeave = () => {
      channel.send({
        type: "broadcast",
        event: "cursor:leave",
        payload: { id: player.id },
      });
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);

    // Flush any pending throttled update
    const flush = setInterval(() => {
      if (!pendingRef.current) return;
      const { x, y } = pendingRef.current;
      send(x, y);
      pendingRef.current = null;
    }, SEND_INTERVAL_MS);

    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      clearInterval(flush);
      channel.send({
        type: "broadcast",
        event: "cursor:leave",
        payload: { id: player.id },
      });
    };
  }, [channel, player.id, player.name, player.color]);

  return (
    <div ref={containerRef} className="relative">
      {children}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Object.values(cursors).map((c) => (
          <RemoteCursor key={c.id} cursor={c} />
        ))}
      </div>
    </div>
  );
}

function RemoteCursor({ cursor }: { cursor: Cursor }) {
  return (
    <div
      className="absolute transition-[left,top] duration-[50ms] ease-linear"
      style={{
        left: `${cursor.x * 100}%`,
        top: `${cursor.y * 100}%`,
        transform: "translate(-4px, -2px)",
      }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill={cursor.color}
        stroke="black"
        strokeWidth="1"
        style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))" }}
      >
        <path d="M2 2 L2 16 L6 12 L9 19 L12 17.5 L9 11 L14 11 Z" />
      </svg>
      <span
        className="sticker text-xs"
        style={
          {
            ["--sticker-tilt" as string]: "0deg",
            marginTop: -2,
          } as React.CSSProperties
        }
      >
        {cursor.name}
      </span>
    </div>
  );
}
