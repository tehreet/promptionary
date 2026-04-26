# Phase 2 — Lobby Implementation Plan

> ⚠️ **Historical artifact.** Written 2026-04-19. Phase 2 shipped, plus many features not reflected here (drag-and-drop teams, Quick Match, host kick/transfer-host gating, etc.). Read [`AGENTS.md`](../../../AGENTS.md) for live state.

> **For agentic workers:** this plan is executed inline via superpowers:executing-plans in the same session as Phase 1. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anonymous users can land on `/`, click "Create Room" or type a 4-letter code, join a lobby, see other players in real time, and (if host) kick off the first round.

**Architecture:**
- Anonymous sign-in happens automatically on first visit via a server action; a cookie holds the session across reloads.
- Room creation and joining are two SQL functions (`create_room`, `join_room_by_code`) so all validation (room code gen, phase check, duplicate-join prevention) is server-side. Clients call them via `supabase.rpc()`.
- The lobby page `/play/[code]` is a server component that verifies membership, then mounts a client component that subscribes to Postgres Changes on `room_players` for the current room.
- "Start Game" button on the host calls `start_round` (already exists from Phase 1) — that stub rounds is filled in by Phase 3.

**Tech:** existing stack; adds shadcn `input`, `card` components.

---

### File Structure

```
app/
├── page.tsx                          # Home — create/join form (rewritten)
├── layout.tsx                        # Keep as-is
├── play/
│   └── [code]/
│       ├── page.tsx                  # Server component: verify membership, hydrate lobby
│       └── lobby-client.tsx          # Client: realtime player list, host controls
└── actions/
    ├── auth.ts                       # ensureAnonSession() server action
    ├── create-room.ts                # Server action wrapping create_room RPC
    ├── join-room.ts                  # Server action wrapping join_room_by_code RPC
    └── leave-room.ts                 # Server action — removes player from room
components/
├── ui/                               # Existing shadcn
├── create-room-card.tsx              # Client form — display name + create button
├── join-room-card.tsx                # Client form — display name + code input
└── player-chip.tsx                   # Avatar/name display
lib/
└── player.ts                         # Helpers: random display name fallback, color from uuid
supabase/migrations/
└── 20260419XXXXXX_lobby_rpcs.sql     # create_room + join_room_by_code functions
```

---

### Task 1: Add SQL RPCs for create/join

**Files:**
- Create: `supabase/migrations/<ts>_lobby_rpcs.sql`

- [ ] **Step 1: Generate migration**

```
supabase migration new lobby_rpcs
```

- [ ] **Step 2: Populate with RPCs**

```sql
-- create_room: host creates a new room, seeds generate_room_code, returns room + code
create or replace function create_room(p_display_name text, p_mode room_mode default 'party')
returns table (room_id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_room_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(p_display_name) < 1 or char_length(p_display_name) > 24 then
    raise exception 'display_name length invalid';
  end if;

  v_code := generate_room_code();

  insert into rooms (code, host_id, mode)
    values (v_code, auth.uid(), p_mode)
    returning id into v_room_id;

  insert into room_players (room_id, player_id, display_name, is_host)
    values (v_room_id, auth.uid(), p_display_name, true);

  return query select v_room_id, v_code;
end;
$$;
revoke all on function create_room(text, room_mode) from public;
grant execute on function create_room(text, room_mode) to authenticated;

-- join_room_by_code: player joins a lobby room by 4-letter code
create or replace function join_room_by_code(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(p_display_name) < 1 or char_length(p_display_name) > 24 then
    raise exception 'display_name length invalid';
  end if;

  select * into v_room from rooms where code = upper(p_code);
  if not found then raise exception 'room not found'; end if;
  if v_room.phase <> 'lobby' then raise exception 'room already started'; end if;

  insert into room_players (room_id, player_id, display_name)
    values (v_room.id, auth.uid(), p_display_name)
    on conflict (room_id, player_id) do update set display_name = excluded.display_name;

  return v_room.id;
end;
$$;
revoke all on function join_room_by_code(text, text) from public;
grant execute on function join_room_by_code(text, text) to authenticated;

-- leave_room: player removes self; if host, room is cascaded (host leaves → room dies for now).
-- We'll improve host-migration in a later phase.
create or replace function leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from rooms where id = p_room_id;
  if not found then return; end if;

  if v_room.host_id = auth.uid() then
    delete from rooms where id = p_room_id;
  else
    delete from room_players where room_id = p_room_id and player_id = auth.uid();
  end if;
end;
$$;
revoke all on function leave_room(uuid) from public;
grant execute on function leave_room(uuid) to authenticated;
```

- [ ] **Step 3: Push + regen types**

```
supabase db push
supabase gen types typescript --linked --schema public 2>/dev/null > lib/supabase/types.ts
```

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "feat(db): create_room + join_room_by_code + leave_room RPCs"
```

---

### Task 2: Anonymous session server action

**Files:**
- Create: `app/actions/auth.ts`

- [ ] **Step 1: Write the action**

```ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function ensureAnonSession() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user!;
}
```

- [ ] **Step 2: Commit** (will ship with subsequent tasks; no standalone commit needed)

---

### Task 3: Player utilities

**Files:**
- Create: `lib/player.ts`

- [ ] **Step 1: Write helpers**

```ts
const ADJECTIVES = ["Vivid", "Chonky", "Glitchy", "Neon", "Cosmic", "Loud", "Spicy", "Witty", "Frosty", "Plush"];
const ANIMALS = ["Otter", "Axolotl", "Capybara", "Narwhal", "Gecko", "Raven", "Manatee", "Lynx", "Puffin", "Shrew"];

export function randomDisplayName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a}${b}`;
}

// deterministic vibrant hue from uuid (blues/pinks/purples band)
export function colorForPlayer(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  const hue = 220 + (Math.abs(h) % 140); // 220-360 covers blue→purple→pink
  return `hsl(${hue} 80% 65%)`;
}
```

---

### Task 4: Create/Join room server actions

**Files:**
- Create: `app/actions/create-room.ts`, `app/actions/join-room.ts`, `app/actions/leave-room.ts`

- [ ] **Step 1: create-room.ts**

```ts
"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAnonSession } from "./auth";

export async function createRoomAction(formData: FormData) {
  await ensureAnonSession();
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) throw new Error("display name required");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_room", {
    p_display_name: displayName,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("create_room returned no row");

  redirect(`/play/${row.code}`);
}
```

- [ ] **Step 2: join-room.ts**

```ts
"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAnonSession } from "./auth";

export async function joinRoomAction(formData: FormData) {
  await ensureAnonSession();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const rawCode = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!displayName) throw new Error("display name required");
  if (!/^[A-Z]{4}$/.test(rawCode)) throw new Error("code must be 4 letters");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("join_room_by_code", {
    p_code: rawCode,
    p_display_name: displayName,
  });
  if (error) throw error;

  redirect(`/play/${rawCode}`);
}
```

- [ ] **Step 3: leave-room.ts**

```ts
"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function leaveRoomAction(roomId: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("leave_room", { p_room_id: roomId });
  redirect("/");
}
```

---

### Task 5: Add shadcn input + card components

- [ ] **Step 1: Install components**

```
bunx shadcn@latest add input card label
```

---

### Task 6: Create/Join UI cards

**Files:**
- Create: `components/create-room-card.tsx`, `components/join-room-card.tsx`

- [ ] **Step 1: create-room-card.tsx**

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createRoomAction } from "@/app/actions/create-room";
import { randomDisplayName } from "@/lib/player";

export function CreateRoomCard() {
  const [name, setName] = useState(() => randomDisplayName());
  return (
    <Card className="w-full max-w-sm bg-white/10 backdrop-blur border-white/20 text-white">
      <CardHeader>
        <CardTitle className="text-2xl font-black">Create a Room</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={createRoomAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="create-name">Your name</Label>
            <Input
              id="create-name"
              name="displayName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              required
              className="bg-white/20 border-white/30 placeholder:text-white/50"
            />
          </div>
          <Button type="submit" className="w-full bg-white text-indigo-700 hover:bg-white/90 font-semibold">
            Create Room
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: join-room-card.tsx**

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { joinRoomAction } from "@/app/actions/join-room";
import { randomDisplayName } from "@/lib/player";

export function JoinRoomCard() {
  const [name, setName] = useState(() => randomDisplayName());
  const [code, setCode] = useState("");
  return (
    <Card className="w-full max-w-sm bg-white/10 backdrop-blur border-white/20 text-white">
      <CardHeader>
        <CardTitle className="text-2xl font-black">Join a Room</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={joinRoomAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="join-name">Your name</Label>
            <Input
              id="join-name"
              name="displayName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              required
              className="bg-white/20 border-white/30 placeholder:text-white/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="join-code">Room code</Label>
            <Input
              id="join-code"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="ABCD"
              required
              className="bg-white/20 border-white/30 placeholder:text-white/50 font-mono text-2xl tracking-[0.5em] uppercase"
            />
          </div>
          <Button type="submit" className="w-full bg-white text-rose-600 hover:bg-white/90 font-semibold">
            Join Room
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

---

### Task 7: Home page → create/join UI

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Rewrite**

```tsx
import { CreateRoomCard } from "@/components/create-room-card";
import { JoinRoomCard } from "@/components/join-room-card";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 text-white px-6 py-16">
      <div className="text-center space-y-4">
        <h1 className="text-7xl md:text-8xl font-black tracking-tight drop-shadow-lg">
          Promptionary
        </h1>
        <p className="text-xl md:text-2xl opacity-95 font-medium max-w-xl mx-auto">
          Pictionary, in reverse. Guess the prompt behind the AI&#39;s painting.
        </p>
      </div>
      <div className="flex flex-col md:flex-row gap-6 w-full max-w-3xl items-stretch justify-center">
        <CreateRoomCard />
        <JoinRoomCard />
      </div>
    </main>
  );
}
```

---

### Task 8: Lobby page (server component)

**Files:**
- Create: `app/play/[code]/page.tsx`

- [ ] **Step 1: Server component that resolves room + ensures membership**

```tsx
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAnonSession } from "@/app/actions/auth";
import { LobbyClient } from "./lobby-client";

export default async function LobbyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) notFound();

  const user = await ensureAnonSession();

  const supabase = await createSupabaseServerClient();
  const { data: room, error } = await supabase
    .from("rooms")
    .select("id, code, phase, host_id, max_rounds, guess_seconds, round_num")
    .eq("code", code)
    .maybeSingle();

  if (error || !room) notFound();

  const { data: members } = await supabase
    .from("room_players")
    .select("player_id, display_name, is_host, score")
    .eq("room_id", room.id);

  const isMember = members?.some((m) => m.player_id === user.id);
  if (!isMember) {
    redirect(`/?join=${code}`);
  }

  return (
    <LobbyClient
      room={room}
      initialPlayers={members ?? []}
      currentPlayerId={user.id}
    />
  );
}
```

---

### Task 9: Lobby client — realtime player list + host start button

**Files:**
- Create: `app/play/[code]/lobby-client.tsx`

- [ ] **Step 1: Write it**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { colorForPlayer } from "@/lib/player";
import { leaveRoomAction } from "@/app/actions/leave-room";

type Room = {
  id: string;
  code: string;
  phase: string;
  host_id: string;
  max_rounds: number;
  guess_seconds: number;
  round_num: number;
};

type Player = {
  player_id: string;
  display_name: string;
  is_host: boolean;
  score: number;
};

export function LobbyClient({
  room,
  initialPlayers,
  currentPlayerId,
}: {
  room: Room;
  initialPlayers: Player[];
  currentPlayerId: string;
}) {
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [phase, setPhase] = useState(room.phase);
  const [isPending, startTransition] = useTransition();
  const [starting, setStarting] = useState(false);
  const isHost = room.host_id === currentPlayerId;

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const playersChannel = supabase
      .channel(`room-${room.id}-players`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_players",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          setPlayers((prev) => {
            if (payload.eventType === "INSERT") {
              const next = payload.new as Player;
              if (prev.some((p) => p.player_id === next.player_id)) return prev;
              return [...prev, next];
            }
            if (payload.eventType === "UPDATE") {
              const next = payload.new as Player;
              return prev.map((p) =>
                p.player_id === next.player_id ? { ...p, ...next } : p,
              );
            }
            if (payload.eventType === "DELETE") {
              const gone = payload.old as Partial<Player>;
              return prev.filter((p) => p.player_id !== gone.player_id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    const roomChannel = supabase
      .channel(`room-${room.id}-state`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          const next = payload.new as { phase: string };
          setPhase(next.phase);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(playersChannel);
      supabase.removeChannel(roomChannel);
    };
  }, [room.id]);

  async function handleStart() {
    setStarting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("start_round", { p_room_id: room.id });
      if (error) throw error;
      // Phase 3 will handle the generating→guessing transition; for now we just
      // land on phase=generating and the UI below reflects it.
    } catch (e) {
      alert(e instanceof Error ? e.message : "failed to start");
      setStarting(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-8 bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 text-white px-6 py-12">
      <header className="text-center space-y-2">
        <p className="text-sm uppercase tracking-widest opacity-80">Room code</p>
        <h1 className="text-7xl font-black font-mono tracking-[0.3em] drop-shadow-lg">
          {room.code}
        </h1>
        <p className="opacity-80 text-sm">Share this code with friends to join.</p>
      </header>

      <section className="w-full max-w-2xl space-y-3">
        <h2 className="text-lg font-semibold opacity-80">
          Players ({players.length})
        </h2>
        <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {players.map((p) => (
            <li
              key={p.player_id}
              className="rounded-2xl px-4 py-3 backdrop-blur bg-white/15 border border-white/20 flex items-center gap-3"
            >
              <span
                className="h-8 w-8 rounded-full flex items-center justify-center text-black font-black"
                style={{ background: colorForPlayer(p.player_id) }}
              >
                {p.display_name[0]?.toUpperCase()}
              </span>
              <span className="font-semibold truncate">{p.display_name}</span>
              {p.is_host && (
                <span className="ml-auto text-xs bg-white/20 rounded-full px-2 py-0.5">
                  host
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {phase === "lobby" && (
        <div className="flex gap-3">
          {isHost && (
            <Button
              onClick={handleStart}
              disabled={players.length < 2 || starting}
              className="bg-white text-indigo-700 hover:bg-white/90 font-bold text-lg px-8 py-6 rounded-2xl disabled:opacity-50"
            >
              {starting ? "Starting…" : `Start game (${players.length}/2+)`}
            </Button>
          )}
          <Button
            onClick={() =>
              startTransition(() => {
                leaveRoomAction(room.id);
              })
            }
            disabled={isPending}
            variant="outline"
            className="bg-white/10 border-white/30 hover:bg-white/20 text-white rounded-2xl px-6"
          >
            Leave
          </Button>
        </div>
      )}

      {phase !== "lobby" && (
        <div className="text-center text-2xl font-bold opacity-90">
          Game in progress — phase: {phase}
        </div>
      )}
    </main>
  );
}
```

---

### Task 10: Deploy + verify

- [ ] **Step 1: Build locally**

```
bun run build
```
Expected: clean build.

- [ ] **Step 2: Commit + push (auto-deploys via Vercel GH integration) OR direct deploy**

```
git add -A
git commit -m "feat: phase 2 lobby (create/join, realtime players, host start)"
git push
# OR: vercel deploy --prod --yes
```

- [ ] **Step 3: Smoke test**

Open production URL in two tabs / two browsers:
- Tab A: create room → note 4-letter code
- Tab B: join with that code
- Verify both see each other in the player list
- Host clicks "Start game" → both tabs see phase flip to "generating"
