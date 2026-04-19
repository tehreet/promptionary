"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createRoomAction } from "@/app/actions/create-room";
import { randomDisplayName } from "@/lib/player";

export function CreateRoomCard() {
  const initialName = useMemo(() => randomDisplayName(), []);
  return (
    <Card className="w-full max-w-sm bg-white/10 backdrop-blur border-white/20 text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-2xl font-black">Create a Room</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={createRoomAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="create-name" className="text-white/90">Your name</Label>
            <Input
              id="create-name"
              name="displayName"
              defaultValue={initialName}
              maxLength={24}
              required
              className="bg-white/20 border-white/30 placeholder:text-white/50 text-white"
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-white text-indigo-700 hover:bg-white/90 font-bold text-base h-11 rounded-xl"
          >
            Create Room
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
