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
        className="flex-1 overflow-y-auto px-1 py-2 space-y-2"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-[var(--game-ink)]/60 italic">
            Chat is quiet. Say hi.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex gap-3 items-start">
              <div
                className="w-1 self-stretch rounded-full shrink-0"
                style={{ background: colorForPlayer(m.player_id) }}
              />
              <div className="min-w-0 flex-1">
                <span
                  className="font-heading font-black text-sm"
                  style={{ color: colorForPlayer(m.player_id) }}
                >
                  {m.display_name}
                </span>
                <p className="text-sm text-[var(--game-ink)] break-words">
                  {m.content}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      {locked ? (
        <div
          className="sticker w-full text-center mt-2"
          style={{ background: "var(--game-orange)" }}
        >
          Chat locked — guessing in progress
        </div>
      ) : (
        <form onSubmit={send} className="mt-2 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Say something…"
            maxLength={400}
            disabled={posting}
            className="flex-1 bg-[var(--game-paper)] text-[var(--game-ink)] border-2 border-[var(--game-ink)] rounded-xl px-3 py-1.5 text-sm disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--game-ink)]"
          />
          <Button
            type="submit"
            disabled={posting || !draft.trim()}
            className="h-9 px-3 text-sm"
          >
            Send
          </Button>
        </form>
      )}
      {sendError && (
        <div
          data-chat-error="1"
          className="text-[11px] mt-2 rounded-md bg-[var(--destructive)]/20 border-2 border-[var(--destructive)] px-2 py-1 text-[var(--game-ink)]"
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
            className="h-11 px-4 rounded-full font-bold"
          >
            💬 Chat
            {unread > 0 && (
              <span className="ml-2 bg-primary-foreground text-primary rounded-full px-2 text-xs">
                {unread}
              </span>
            )}
          </Button>
        ) : (
          <div className="game-card bg-[var(--game-paper)] text-[var(--game-ink)] p-4 flex flex-col gap-2 h-[380px]">
            <div className="flex items-center justify-between">
              <p className="font-heading font-black text-sm">Chat</p>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="text-xs text-[var(--game-ink)]/60 hover:text-[var(--game-ink)]"
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
    <div className="game-card bg-[var(--game-paper)] text-[var(--game-ink)] p-4 flex flex-col gap-2 h-[280px]">
      <p className="font-heading font-black text-sm">Lobby chat</p>
      {box}
    </div>
  );
}
