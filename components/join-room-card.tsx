"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { joinRoomAction } from "@/app/actions/join-room";
import { randomDisplayName } from "@/lib/player";

export function JoinRoomCard({
  defaultName,
}: { defaultName?: string | null } = {}) {
  const initialName = useMemo(
    () => defaultName ?? randomDisplayName(),
    [defaultName],
  );
  return (
    <Card
      className="w-full max-w-sm game-card md:rotate-1 p-0 border-none"
      style={{ background: "var(--game-cyan)", color: "var(--game-ink)" }}
    >
      <CardHeader>
        <CardTitle className="text-2xl font-heading font-black">
          Join a room
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={joinRoomAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="join-name">Your name</Label>
            <Input
              id="join-name"
              name="displayName"
              defaultValue={initialName}
              maxLength={24}
              required
              className="bg-white border-2 rounded-lg h-10"
              style={{ borderColor: "var(--game-ink)", color: "var(--game-ink)" }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="join-code">Room code</Label>
            <Input
              id="join-code"
              name="code"
              onChange={(e) => {
                e.currentTarget.value = e.currentTarget.value.toUpperCase();
              }}
              maxLength={4}
              placeholder="ABCD"
              required
              className="bg-white border-2 rounded-lg font-mono text-2xl h-14 text-center tracking-[0.45em] uppercase"
              style={{ borderColor: "var(--game-ink)", color: "var(--game-ink)" }}
            />
          </div>
          <Button
            type="submit"
            aria-label="Join Room"
            className="w-full h-12 rounded-xl font-heading font-black text-base border-2"
            style={{
              background: "var(--game-pink)",
              color: "var(--game-cream)",
              borderColor: "var(--game-ink)",
              boxShadow: "3px 3px 0 var(--game-ink)",
            }}
          >
            Join →
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
