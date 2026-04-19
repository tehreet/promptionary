"use client";

import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function HostControls({
  roomId,
  victimId,
  victimName,
  canMakeHost = true,
  canKick = true,
  roomPhase,
}: {
  roomId: string;
  victimId: string;
  victimName: string;
  canMakeHost?: boolean;
  canKick?: boolean;
  roomPhase?: string;
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

  // Disable manual host transfer during active gameplay (phase != 'lobby')
  const canTransferHost = canMakeHost && roomPhase === "lobby";
  const transferDisabledReason =
    canMakeHost && roomPhase !== "lobby"
      ? "Host transfer is locked during gameplay"
      : "Make host";

  return (
    <div className="flex items-center gap-1 ml-auto shrink-0">
      {canMakeHost && (
        <button
          type="button"
          onClick={makeHost}
          disabled={busy || !canTransferHost}
          aria-label={`Make ${victimName} host`}
          title={transferDisabledReason}
          className="h-7 w-7 rounded-full bg-muted hover:bg-accent text-foreground inline-flex items-center justify-center text-xs disabled:opacity-50"
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
          className="h-7 w-7 rounded-full bg-muted hover:bg-destructive hover:text-white text-foreground inline-flex items-center justify-center text-sm leading-none disabled:opacity-50"
        >
          ✕
        </button>
      )}
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </div>
  );
}
