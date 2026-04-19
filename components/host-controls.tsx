"use client";

import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function HostControls({
  roomId,
  victimId,
  victimName,
  canMakeHost = true,
  canKick = true,
}: {
  roomId: string;
  victimId: string;
  victimName: string;
  canMakeHost?: boolean;
  canKick?: boolean;
}) {
  const supabaseRef = useRef(createSupabaseBrowserClient());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function makeHost() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseRef.current.rpc("transfer_host", {
      p_room_id: roomId,
      p_new_host_id: victimId,
    });
    if (err) setError(err.message);
    setBusy(false);
  }

  async function kick() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseRef.current.rpc("kick_player", {
      p_room_id: roomId,
      p_victim_id: victimId,
    });
    if (err) setError(err.message);
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-1.5 ml-auto shrink-0">
      {canMakeHost && (
        <button
          type="button"
          onClick={makeHost}
          disabled={busy}
          aria-label={`Make ${victimName} host`}
          title="Make host"
          className="game-card w-8 h-8 flex items-center justify-center rounded-full text-sm disabled:opacity-50"
          style={{
            background: "var(--game-canvas-yellow)",
            color: "var(--game-ink)",
          }}
        >
          👑
        </button>
      )}
      {canKick && (
        <button
          type="button"
          onClick={kick}
          disabled={busy}
          aria-label={`Kick ${victimName}`}
          title="Kick player"
          className="game-card w-8 h-8 flex items-center justify-center rounded-full text-sm disabled:opacity-50"
          style={{
            background: "var(--destructive)",
            color: "var(--destructive-foreground, var(--game-cream))",
          }}
        >
          ✕
        </button>
      )}
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </div>
  );
}
