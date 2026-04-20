"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreateRoomCard } from "@/components/create-room-card";
import { JoinRoomCard } from "@/components/join-room-card";
import { QuickMatchCard } from "@/components/quick-match-card";
import { randomDisplayName } from "@/lib/player";

// The home tiles used to carry three "Your name" inputs (one per card).
// Now, anon visitors see a single shared input rendered above the tiles,
// whose value is mirrored into each card's hidden displayName field.
// Signed-in users see no name input at all — the server actions read the
// authenticated profile's display_name.
export function HomeTiles({
  signedIn,
  openLobbies,
}: {
  signedIn: boolean;
  openLobbies: number;
}) {
  // Suggest a fun random name for anon visitors. Players can overwrite.
  const initialName = useMemo(() => randomDisplayName(), []);
  const [name, setName] = useState(initialName);

  // Signed-in users: don't pass a sharedName to the cards so the hidden
  // displayName input is omitted and the server action falls back to
  // profile.display_name. Anon: pass the trimmed value (empty string is
  // OK — the server action will catch it and fall back to a random name
  // as a last resort).
  const sharedName = signedIn ? undefined : name.trim();

  return (
    <>
      {!signedIn && (
        <section
          data-shared-name-block="1"
          className="w-full max-w-2xl px-1"
        >
          <Label
            htmlFor="shared-name"
            className="block text-sm font-heading font-black uppercase tracking-wider mb-2"
            style={{ color: "var(--game-ink)" }}
          >
            Your name
          </Label>
          <Input
            id="shared-name"
            name="shared-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="nickname"
            placeholder="Pick a nickname"
            className="bg-white border-2 rounded-xl h-14 text-lg font-heading font-black px-4"
            style={{
              borderColor: "var(--game-ink)",
              color: "var(--game-ink)",
              boxShadow: "3px 3px 0 var(--game-ink)",
            }}
          />
          <p
            className="text-xs mt-2 leading-snug"
            style={{ color: "color-mix(in oklch, var(--game-ink) 70%, transparent)" }}
          >
            Used across Quick Match, Create, and Join.
          </p>
        </section>
      )}

      <section
        data-home-tiles="1"
        className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 w-full max-w-5xl items-stretch justify-items-center"
      >
        <QuickMatchCard sharedName={sharedName} openLobbies={openLobbies} />
        <CreateRoomCard sharedName={sharedName} />
        <JoinRoomCard sharedName={sharedName} />
      </section>
    </>
  );
}
