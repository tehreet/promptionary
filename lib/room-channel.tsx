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
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type RoomChannelValue = {
  channel: RealtimeChannel | null;
  roomId: string;
  player: { id: string; name: string; color: string };
};

const Ctx = createContext<RoomChannelValue | null>(null);

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
    return () => {
      setChannel(null);
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
