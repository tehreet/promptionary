"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createRoomAction } from "@/app/actions/create-room";
import { randomDisplayName } from "@/lib/player";

export function CreateRoomCard() {
  const initialName = useMemo(() => randomDisplayName(), []);
  const [advanced, setAdvanced] = useState(false);
  return (
    <Card className="w-full max-w-sm bg-white/10 backdrop-blur border-white/20 text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-2xl font-black">Create a Room</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={createRoomAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="create-name" className="text-white/90">
              Your name
            </Label>
            <Input
              id="create-name"
              name="displayName"
              defaultValue={initialName}
              maxLength={24}
              required
              className="bg-white/20 border-white/30 placeholder:text-white/50 text-white"
            />
          </div>

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs opacity-80 hover:opacity-100 underline-offset-4 hover:underline"
          >
            {advanced ? "Hide settings" : "Customize rounds & timing"}
          </button>

          {advanced && (
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-white/10 p-3">
              <ConfigField name="maxRounds" label="Rounds" def={5} min={1} max={20} />
              <ConfigField
                name="guessSeconds"
                label="Guess (s)"
                def={45}
                min={15}
                max={120}
              />
              <ConfigField
                name="revealSeconds"
                label="Reveal (s)"
                def={20}
                min={5}
                max={30}
              />
            </div>
          )}

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

function ConfigField({
  name,
  label,
  def,
  min,
  max,
}: {
  name: string;
  label: string;
  def: number;
  min: number;
  max: number;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`cfg-${name}`} className="text-[10px] uppercase tracking-wider text-white/70">
        {label}
      </Label>
      <Input
        id={`cfg-${name}`}
        name={name}
        type="number"
        defaultValue={def}
        min={min}
        max={max}
        className="bg-white/20 border-white/30 text-white text-center font-mono h-9"
      />
    </div>
  );
}
