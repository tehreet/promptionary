"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { quickMatchAction } from "@/app/actions/quick-match";
import { randomDisplayName } from "@/lib/player";

// Quick Match: solo-visitor funnel. Unlike Create / Join, there's no code
// and no settings — one tap drops you into whichever public lobby has
// space, or mints a fresh one if every existing one is full / stale.
//
// Styled orange so it reads as a third, distinct option (not a Create
// variant, not a Join variant). The "Jump in now" CTA makes the zero-
// friction promise explicit.
export function QuickMatchCard({
  defaultName,
  openLobbies,
}: {
  defaultName?: string | null;
  openLobbies: number;
} = { openLobbies: 0 }) {
  const initialName = useMemo(
    () => defaultName ?? randomDisplayName(),
    [defaultName],
  );

  // Craft the status line. Keeps copy short + game-showy; the zero state
  // is honest ("be the first") rather than pretending there's a queue.
  const status =
    openLobbies > 1
      ? `${openLobbies} rooms open · jump in`
      : openLobbies === 1
        ? "Room open · jump in"
        : "Be the first · we'll open a room";

  return (
    <Card
      data-quick-match-card="1"
      className="w-full max-w-sm game-card md:rotate-0 p-0 border-none"
      style={
        {
          background: "var(--game-orange)",
          color: "#1e1b4d",
          // Lock internal palette to light values so dark mode doesn't
          // invert the text on the orange sticker.
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
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-2xl font-heading font-black">
            Quick Match
          </CardTitle>
          <span
            data-quick-match-live="1"
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider border-2"
            style={{
              background: "var(--game-canvas-yellow)",
              color: "#1e1b4d",
              borderColor: "#1e1b4d",
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "#1e1b4d" }}
            />
            Live
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <form action={quickMatchAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="quick-name">Your name</Label>
            <Input
              id="quick-name"
              name="displayName"
              defaultValue={initialName}
              maxLength={24}
              required
              className="bg-white border-2 rounded-lg h-10"
              style={{ borderColor: "var(--game-ink)", color: "var(--game-ink)" }}
            />
          </div>

          <p
            className="text-xs leading-snug font-bold"
            data-quick-match-status="1"
            style={{
              color: "color-mix(in oklch, #1e1b4d 78%, transparent)",
            }}
          >
            {status}
          </p>

          <Button
            type="submit"
            aria-label="Quick Match"
            className="w-full h-12 rounded-xl font-heading font-black text-base border-2"
            style={{
              background: "var(--game-ink)",
              color: "var(--game-canvas-yellow)",
              borderColor: "var(--game-ink)",
              boxShadow: "3px 3px 0 var(--game-ink)",
            }}
          >
            Jump in now →
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
