"use client";

import { useEffect, useRef, useState } from "react";
import { useRoomChannel } from "@/lib/room-channel";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { colorForPlayer } from "@/lib/player";

type ChatMessage = {
  id: string;
  room_id: string;
  player_id: string;
  display_name: string;
  content: string;
  created_at: string;
};

export function ChatPanel({
  roomPhase,
  isSpectator,
  variant = "inline",
}: {
  roomPhase: string;
  isSpectator: boolean;
  variant?: "inline" | "floating";
}) {
  const { channel, roomId } = useRoomChannel();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [collapsed, setCollapsed] = useState(variant === "floating");
  const [unread, setUnread] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const locked =
    !isSpectator && !["lobby", "reveal", "game_over"].includes(roomPhase);

  // Load history + poll for new messages every 2s as a backstop.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const load = async () => {
      const { data } = await supabase
        .from("room_messages")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (data) {
        setMessages((prev) => {
          const next = data as ChatMessage[];
          if (
            prev.length === next.length &&
            prev[prev.length - 1]?.id === next[next.length - 1]?.id
          ) {
            return prev;
          }
          if (
            collapsed &&
            next.length > prev.length &&
            next[next.length - 1]?.player_id !== undefined
          ) {
            setUnread((u) => u + (next.length - prev.length));
          }
          return next;
        });
      }
    };
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [roomId, collapsed]);

  // Broadcast-driven live updates (so everyone gets it instantly without
  // waiting for postgres_changes, which is the flaky path for us right now).
  useEffect(() => {
    if (!channel) return;
    channel.on(
      "broadcast",
      { event: "chat" },
      (event: { payload?: unknown }) => {
        const msg = event.payload as ChatMessage | undefined;
        if (!msg?.id) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (collapsed) setUnread((u) => u + 1);
      },
    );
  }, [channel, collapsed]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || locked) return;
    setPosting(true);
    setSendError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("post_message", {
        p_room_id: roomId,
        p_content: text,
      });
      if (error) {
        console.error("[chat] post_message error", error);
        setSendError(error.message);
        return;
      }
      setDraft("");
      const { data: latest } = await supabase
        .from("room_messages")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) {
        if (channel) {
          channel.send({
            type: "broadcast",
            event: "chat",
            payload: latest,
          });
        }
        setMessages((prev) => {
          if (prev.some((m) => m.id === (latest as ChatMessage).id)) return prev;
          return [...prev, latest as ChatMessage];
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[chat] send threw", err);
      setSendError(msg);
    } finally {
      setPosting(false);
    }
  }

  const box = (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Chat is quiet. Say hi.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="text-sm leading-snug">
              <span
                className="font-bold mr-2"
                style={{ color: colorForPlayer(m.player_id) }}
              >
                {m.display_name}
              </span>
              <span className="text-foreground/90 break-words">{m.content}</span>
            </div>
          ))
        )}
      </div>
      <form
        onSubmit={send}
        className="border-t border-border p-2 flex gap-2 bg-card/60"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            locked
              ? "Chat locked during the round — talk after reveal"
              : "Say something…"
          }
          maxLength={400}
          disabled={locked || posting}
          className="flex-1 bg-background border border-input rounded-lg px-3 py-1.5 text-sm disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button
          type="submit"
          disabled={locked || posting || !draft.trim()}
          className="h-8 px-3 text-sm"
        >
          Send
        </Button>
      </form>
      {sendError && (
        <div
          data-chat-error="1"
          className="text-[11px] bg-red-500/20 border-t border-red-500/30 px-3 py-1.5"
        >
          {sendError}
        </div>
      )}
    </div>
  );

  if (variant === "floating") {
    return (
      <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)]">
        {collapsed ? (
          <Button
            onClick={() => {
              setCollapsed(false);
              setUnread(0);
            }}
            className="h-11 px-4 rounded-full font-bold shadow-lg"
          >
            💬 Chat
            {unread > 0 && (
              <span className="ml-2 bg-primary-foreground text-primary rounded-full px-2 text-xs">
                {unread}
              </span>
            )}
          </Button>
        ) : (
          <div className="rounded-2xl bg-card border border-border shadow-xl flex flex-col h-[380px]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <p className="font-heading font-black text-sm">Chat</p>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                hide
              </button>
            </div>
            {box}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl bg-card border border-border shadow-sm flex flex-col h-[280px]">
      <div className="px-3 py-2 border-b border-border">
        <p className="font-heading font-black text-sm">Lobby chat</p>
      </div>
      {box}
    </div>
  );
}
