"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { joinRoomAction } from "@/app/actions/join-room";
import { randomDisplayName } from "@/lib/player";

export function JoinInline({
  code,
  asSpectator = false,
}: {
  code: string;
  asSpectator?: boolean;
}) {
  const initialName = useMemo(() => randomDisplayName(), []);
  return (
    <main className="game-canvas min-h-screen flex flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="text-center space-y-3">
        <p className="text-sm uppercase tracking-widest text-[var(--game-ink)]/70">
          {asSpectator ? "Game in progress — watch along" : "You\u2019re invited to"}
        </p>
        <h1 className="game-hero text-5xl sm:text-6xl md:text-7xl font-mono tracking-[0.25em] sm:tracking-[0.3em]">
          <span className="game-hero-mark">{code}</span>
        </h1>
        <p className="text-[var(--game-ink)]/70">
          {asSpectator
            ? "The game already started. You can watch — you\u2019ll play in the next one."
            : "Pick a name to jump in."}
        </p>
      </div>
      <div className="game-card bg-[var(--game-paper)] p-6 w-full max-w-sm">
        <h2 className="text-2xl font-heading font-black mb-4">
          {asSpectator ? "Watch room" : "Join room"}
        </h2>
        <form action={joinRoomAction} className="space-y-3">
          <input type="hidden" name="code" value={code} />
          {asSpectator && <input type="hidden" name="spectator" value="1" />}
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Your name</Label>
            <Input
              id="invite-name"
              name="displayName"
              defaultValue={initialName}
              maxLength={24}
              required
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full font-bold text-base h-12">
            {asSpectator ? "Watch room" : "Join Room"}
          </Button>
        </form>
      </div>
    </main>
  );
}
