"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRoomChannel } from "@/lib/room-channel";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { colorForPlayer } from "@/lib/player";

type ChatMessage = {
  id: string;
  room_id: string;
  player_id: string;
  display_name: string;
  content: string;
  created_at: string;
  team: number | null;
};

type Tab = "team" | "room";

export function ChatPanel({
  roomPhase,
  isSpectator,
  variant = "inline",
  teamOnly = false,
  team = null,
}: {
  roomPhase: string;
  isSpectator: boolean;
  variant?: "inline" | "floating";
  /** When true, the Team tab is enabled and defaults to active. */
  teamOnly?: boolean;
  /** The current player's team (1 or 2). Required when teamOnly is true. */
  team?: number | null;
}) {
  const { channel, roomId } = useRoomChannel();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [collapsed, setCollapsed] = useState(variant === "floating");
  const [unread, setUnread] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);

  // Only show the Team tab when we're in team-chat mode and the current
  // player has an actual team assignment to post into.
  const teamTabAvailable = teamOnly && typeof team === "number";
  const [tab, setTab] = useState<Tab>(teamTabAvailable ? "team" : "room");

  // If we lose our team mid-render (shouldn't happen often), fall back to room.
  useEffect(() => {
    if (tab === "team" && !teamTabAvailable) setTab("room");
  }, [teamTabAvailable, tab]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Room-wide chat is gated during active rounds for competing players.
  // Team chat is open through every phase — it's the whole point.
  const roomChatLocked =
    !isSpectator && !["lobby", "reveal", "game_over"].includes(roomPhase);
  const locked = tab === "room" && roomChatLocked;

  // Load history + poll for new messages every 2s as a backstop.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const load = async () => {
      // Pull both streams up-front. RLS hides any team-scoped messages that
      // aren't for us, so this is effectively room-wide + my-team.
      const { data } = await supabase
        .from("room_messages")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(200);
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

  // Broadcast-driven live updates. Team-scoped payloads are filtered on
  // receive so we don't leak them into the wrong viewer's state (broadcasts
  // go to every subscriber regardless of RLS).
  useEffect(() => {
    if (!channel) return;
    channel.on(
      "broadcast",
      { event: "chat" },
      (event: { payload?: unknown }) => {
        const msg = event.payload as ChatMessage | undefined;
        if (!msg?.id) return;
        // Enforce the team-chat boundary on the client side too. RLS would
        // already hide it from the poll, but broadcast bypasses RLS.
        if (msg.team != null && msg.team !== team) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (collapsed) setUnread((u) => u + 1);
      },
    );
  }, [channel, collapsed, team]);

  // Messages visible on the currently selected tab.
  const visibleMessages = useMemo(() => {
    if (tab === "team") return messages.filter((m) => m.team != null);
    return messages.filter((m) => m.team == null);
  }, [messages, tab]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleMessages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || locked) return;
    const postingTeam = tab === "team" && teamTabAvailable ? team : null;
    setPosting(true);
    setSendError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("post_message", {
        p_room_id: roomId,
        p_content: text,
        // Only pass p_team on team-scoped sends; omitted args use the DB
        // default (null → room-wide).
        ...(postingTeam != null ? { p_team: postingTeam } : {}),
      });
      if (error) {
        console.error("[chat] post_message error", error);
        setSendError(error.message);
        return;
      }
      setDraft("");
      // Fetch the row we just inserted, filtered to our stream so a parallel
      // send on the other stream can't race us.
      let query = supabase
        .from("room_messages")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (postingTeam != null) {
        query = query.eq("team", postingTeam);
      } else {
        query = query.is("team", null);
      }
      const { data: latest } = await query.maybeSingle();
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

  const emptyHint =
    tab === "team"
      ? "Team chat is quiet. Coordinate with your teammates."
      : "Chat is quiet. Say hi.";

  const placeholder =
    tab === "team"
      ? `Message Team ${team ?? ""}…`
      : "Say something…";

  const lockBanner = locked ? (
    <div
      className="sticker w-full text-center mt-2"
      style={{ background: "var(--game-orange)" }}
    >
      Room chat locked — guessing in progress
    </div>
  ) : null;

  const tabs = teamTabAvailable ? (
    <div
      role="tablist"
      aria-label="Chat channels"
      className="flex gap-1 p-1 rounded-full bg-[var(--game-ink)]/10 text-xs font-black uppercase tracking-wider"
    >
      {(["team", "room"] as const).map((t) => {
        const active = tab === t;
        return (
          <button
            key={t}
            type="button"
            role="tab"
            data-testid={`chat-tab-${t}`}
            aria-selected={active}
            onClick={() => setTab(t)}
            className="flex-1 rounded-full px-3 py-1 transition"
            style={
              active
                ? {
                    background: "var(--game-ink)",
                    color: "var(--game-canvas-yellow)",
                  }
                : {
                    background: "transparent",
                    color: "var(--game-ink)",
                  }
            }
          >
            {t === "team" ? `Team ${team}` : "Room"}
          </button>
        );
      })}
    </div>
  ) : null;

  const box = (
    <div
      className="flex flex-col h-full"
      data-chat-panel="1"
      data-chat-tab={tab}
    >
      {tabs}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-1 py-2 space-y-2"
      >
        {visibleMessages.length === 0 ? (
          <p className="text-xs text-[var(--game-ink)]/60 italic">
            {emptyHint}
          </p>
        ) : (
          visibleMessages.map((m) => (
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
      {lockBanner}
      {!locked && (
        <form onSubmit={send} className="mt-2 flex gap-2">
          <Input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            maxLength={400}
            disabled={posting}
            data-chat-input={tab}
            className="flex-1"
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
            data-chat-launcher="1"
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
