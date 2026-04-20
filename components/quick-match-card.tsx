"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { quickMatchAction } from "@/app/actions/quick-match";

// Quick Match: solo-visitor funnel. Unlike Create / Join, there's no code
// and no settings — one tap drops you into whichever public lobby has
// space, or mints a fresh one if every existing one is full / stale.
//
// Styled orange so it reads as a third, distinct option (not a Create
// variant, not a Join variant). The "Jump in now" CTA makes the zero-
// friction promise explicit.
//
// The name input lives on the home page as a single shared field; this
// card just threads it through via a hidden input when present. Signed-in
// visitors get no hidden field at all and the server action pulls their
// display_name from the authed profile.
export function QuickMatchCard({
  sharedName,
  openLobbies,
}: {
  sharedName?: string;
  openLobbies: number;
} = { openLobbies: 0 }) {
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
          {sharedName !== undefined && (
            <input type="hidden" name="displayName" value={sharedName} />
          )}

          <p
            className="text-sm leading-snug font-medium"
            style={{
              color: "color-mix(in oklch, #1e1b4d 78%, transparent)",
            }}
          >
            One tap drops you into whichever public lobby has space. No
            code, no setup.
          </p>

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
