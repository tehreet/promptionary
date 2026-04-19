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
    <main className="min-h-screen promptionary-gradient promptionary-grain flex flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="text-center space-y-3">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">
          {asSpectator ? "Game in progress — watch along" : "You\u2019re invited to"}
        </p>
        <h1 className="text-hero text-5xl sm:text-6xl md:text-7xl font-mono tracking-[0.25em] sm:tracking-[0.3em]">
          {code}
        </h1>
        <p className="text-muted-foreground">
          {asSpectator
            ? "The game already started. You can watch — you\u2019ll play in the next one."
            : "Pick a name to jump in."}
        </p>
      </div>
      <Card className="w-full max-w-sm bg-card border-border shadow-xl rounded-3xl">
        <CardHeader>
          <CardTitle className="text-2xl font-heading font-black">
            {asSpectator ? "Watch room" : "Join room"}
          </CardTitle>
        </CardHeader>
        <CardContent>
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
            <Button
              type="submit"
              className="w-full font-bold text-base h-11 rounded-xl"
            >
              {asSpectator ? "Watch room" : "Join Room"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
