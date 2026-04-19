"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createRoomAction } from "@/app/actions/create-room";
import { randomDisplayName } from "@/lib/player";

export function CreateRoomCard({
  defaultName,
}: { defaultName?: string | null } = {}) {
  const initialName = useMemo(
    () => defaultName ?? randomDisplayName(),
    [defaultName],
  );
  return (
    <Card
      className="w-full max-w-sm game-card md:-rotate-1 p-0 border-none"
      style={
        {
          background: "var(--game-pink)",
          color: "#1e1b4d",
          // Lock internal palette to light values so dark mode doesn't
          // invert the text inside this always-pink sticker card.
          ["--game-ink" as string]: "#1e1b4d",
          ["--game-cream" as string]: "#fff7d6",
          ["--game-paper" as string]: "#ffffff",
          ["--game-canvas-yellow" as string]: "#ffe15e",
          ["--foreground" as string]: "#1e1b4d",
          ["--muted-foreground" as string]:
            "color-mix(in oklch, #1e1b4d 65%, transparent)",
        } as React.CSSProperties
      }
    >
      <CardHeader>
        <CardTitle className="text-2xl font-heading font-black">
          Open a room
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={createRoomAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="create-name">Your name</Label>
            <Input
              id="create-name"
              name="displayName"
              defaultValue={initialName}
              maxLength={24}
              required
              className="bg-white border-2 rounded-lg h-10"
              style={{ borderColor: "var(--game-ink)", color: "var(--game-ink)" }}
            />
          </div>

          <p className="text-xs leading-snug" style={{ color: "color-mix(in oklch, #1e1b4d 70%, transparent)" }}>
            Tweak mode, theme pack, and round timing from the lobby once you&rsquo;re in.
          </p>

          <Button
            type="submit"
            aria-label="Create Room"
            className="w-full h-12 rounded-xl font-heading font-black text-base border-2"
            style={{
              background: "var(--game-canvas-yellow)",
              color: "var(--game-ink)",
              borderColor: "var(--game-ink)",
              boxShadow: "3px 3px 0 var(--game-ink)",
            }}
          >
            Create Room →
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
