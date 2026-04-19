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
    <Card className="w-full max-w-sm bg-white/10 backdrop-blur border-white/20 text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-2xl font-black">Join a Room</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={joinRoomAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="join-name" className="text-white/90">Your name</Label>
            <Input
              id="join-name"
              name="displayName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              required
              className="bg-white/20 border-white/30 placeholder:text-white/50 text-white"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="join-code" className="text-white/90">Room code</Label>
            <Input
              id="join-code"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="ABCD"
              required
              className="bg-white/20 border-white/30 placeholder:text-white/40 text-white font-mono text-2xl tracking-[0.4em] uppercase text-center h-14"
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-white text-rose-600 hover:bg-white/90 font-bold text-base h-11 rounded-xl"
          >
            Join Room
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
