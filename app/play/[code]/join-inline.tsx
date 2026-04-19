"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 text-white px-6 py-16">
      <div className="text-center space-y-3">
        <p className="text-sm uppercase tracking-widest opacity-80">
          {asSpectator ? "Game in progress — watch along" : "You\u2019re invited to"}
        </p>
        <h1 className="text-6xl md:text-7xl font-black font-mono tracking-[0.3em] drop-shadow-lg">
          {code}
        </h1>
        <p className="opacity-90">
          {asSpectator
            ? "The game already started. You can watch — you\u2019ll play in the next one."
            : "Pick a name to jump in."}
        </p>
      </div>
      <Card className="w-full max-w-sm bg-white/10 backdrop-blur border-white/20 text-white shadow-2xl">
        <CardHeader>
          <CardTitle className="text-2xl font-black">
            {asSpectator ? "Watch room" : "Join room"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={joinRoomAction} className="space-y-3">
            <input type="hidden" name="code" value={code} />
            {asSpectator && <input type="hidden" name="spectator" value="1" />}
            <div className="space-y-1.5">
              <Label htmlFor="invite-name" className="text-white/90">
                Your name
              </Label>
              <Input
                id="invite-name"
                name="displayName"
                defaultValue={initialName}
                maxLength={24}
                required
                autoFocus
                className="bg-white/20 border-white/30 placeholder:text-white/50 text-white"
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-white text-rose-600 hover:bg-white/90 font-bold text-base h-11 rounded-xl"
            >
              {asSpectator ? "Watch room" : "Join Room"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
