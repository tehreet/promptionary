"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  createSupabaseBrowserClient,
  readAuthAccessToken,
} from "@/lib/supabase/client";

type RoomChannelValue = {
  channel: RealtimeChannel | null;
  roomId: string;
  player: { id: string; name: string; color: string };
};

const Ctx = createContext<RoomChannelValue | null>(null);

// Safe wrapper around channel.send(). Silently drops the message if the
// channel is null (not yet subscribed) or is not in the 'joined' state
// (e.g. mid-reconnect after a socket blip or the 25-min setAuth rejoin).
// Using channel.send() directly in those windows falls back to REST and logs
// a deprecation warning; in high-frequency callers (cursor broadcasts at 20Hz)
// that floods the console and can spiral into a React render-loop crash.
export function broadcast(
  channel: RealtimeChannel | null,
  args: { event: string; payload: unknown },
): void {
  if (!channel) return;
  if (channel.state !== "joined") return;
  channel.send({ type: "broadcast", event: args.event, payload: args.payload });
}

// Re-auth the realtime socket before the 1h Supabase JWT expires. The browser
// client bridges the cookie token via realtime.setAuth() exactly once at
// construction; without this loop the socket silently loses auth and
// broadcasts (cursors / reactions / chat) stop crossing tabs. See #81.
const REFRESH_INTERVAL_MS = 25 * 60 * 1000;

export function RoomChannelProvider({
  roomId,
  player,
  children,
}: {
  roomId: string;
  player: { id: string; name: string; color: string };
  children: ReactNode;
}) {
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(
    null,
  );

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabaseRef.current = supabase;
    const ch = supabase.channel(`room-${roomId}-live`, {
      config: { broadcast: { self: false } },
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") setChannel(ch);
    });

    let lastToken = readAuthAccessToken();
    const refresh = async () => {
      try {
        // Ping through middleware so the SSR helper rotates the cookie when
        // the access token is near expiry. Then re-read the cookie and push
        // the fresh token to the open socket.
        await fetch("/api/keepalive", {
          credentials: "include",
          cache: "no-store",
        });
      } catch {
        // Network blips are non-fatal; fall through to setAuth with whatever
        // the cookie currently holds.
      }
      const token = readAuthAccessToken();
      if (token && token !== lastToken) {
        supabase.realtime.setAuth(token);
        lastToken = token;
      }
      if (typeof window !== "undefined") {
        (window as unknown as { __realtimeLastAuthToken?: string | null })
          .__realtimeLastAuthToken = token;
      }
    };

    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refresh();
      }
    };
    const onFocus = () => {
      void refresh();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
      (window as unknown as { __realtimeRefresh?: () => Promise<void> })
        .__realtimeRefresh = refresh;
    }

    return () => {
      setChannel(null);
      clearInterval(interval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
        delete (window as unknown as { __realtimeRefresh?: () => Promise<void> })
          .__realtimeRefresh;
      }
      supabase.removeChannel(ch);
    };
  }, [roomId]);

  const value = useMemo(
    () => ({ channel, roomId, player }),
    [channel, roomId, player],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRoomChannel(): RoomChannelValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRoomChannel outside RoomChannelProvider");
  return v;
}
