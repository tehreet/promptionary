"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createRoomAction } from "@/app/actions/create-room";

// The visible "Your name" input used to live here, but the home page now
// renders a single shared-name input above all three tiles (or none at all
// when the visitor is signed in). This card just carries the form action
// plus a hidden displayName passthrough — when `sharedName` is undefined
// (signed-in case) we omit the field entirely and let the server action
// fall back to `profile.display_name`.
export function CreateRoomCard({
  sharedName,
}: {
  sharedName?: string;
} = {}) {
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
          {sharedName !== undefined && (
            <input type="hidden" name="displayName" value={sharedName} />
          )}

          <p
            className="text-sm leading-snug font-medium"
            style={{ color: "color-mix(in oklch, #1e1b4d 78%, transparent)" }}
          >
            Host a lobby for your crew. Tweak mode, theme pack, and round
            timing once you&rsquo;re in.
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
