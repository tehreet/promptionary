"use client";

import { useMemo, useRef } from "react";
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
  const codeRef = useRef<HTMLInputElement>(null);
  return (
    <Card className="w-full max-w-sm bg-card/90 backdrop-blur border-border shadow-xl rounded-3xl">
      <CardHeader>
        <CardTitle className="text-2xl font-heading font-black">
          Join a Room
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
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="join-code">Room code</Label>
            <Input
              id="join-code"
              name="code"
              ref={codeRef}
              onChange={(e) => {
                e.currentTarget.value = e.currentTarget.value.toUpperCase();
              }}
              maxLength={4}
              placeholder="ABCD"
              required
              className="font-mono text-2xl tracking-[0.4em] uppercase text-center h-14"
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            className="w-full h-12 rounded-xl font-bold text-base bg-foreground text-background hover:bg-foreground/90"
          >
            Join Room
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
