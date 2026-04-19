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
  const [mode, setMode] = useState<"party" | "artist">("party");
  return (
    <Card className="w-full max-w-sm bg-card/90 backdrop-blur border-border shadow-xl rounded-3xl">
      <CardHeader>
        <CardTitle className="text-2xl font-heading font-black">
          Create a Room
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
            />
          </div>

          <input type="hidden" name="mode" value={mode} />
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <div className="grid grid-cols-2 gap-2">
              <ModeButton
                active={mode === "party"}
                onClick={() => setMode("party")}
                title="Party"
                subtitle="AI picks the prompt"
              />
              <ModeButton
                active={mode === "artist"}
                onClick={() => setMode("artist")}
                title="Artist"
                subtitle="You write the prompts"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            {advanced ? "Hide settings" : "Customize rounds & timing"}
          </button>

          {advanced && (
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-muted/60 p-3">
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
            className="w-full h-12 rounded-xl font-bold text-base"
          >
            Create Room
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-2 border text-left transition ${
        active
          ? "bg-primary text-primary-foreground border-primary font-bold shadow-sm"
          : "bg-card border-border hover:bg-muted"
      }`}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-[11px] opacity-80">{subtitle}</p>
    </button>
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
      <Label
        htmlFor={`cfg-${name}`}
        className="text-[10px] uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </Label>
      <Input
        id={`cfg-${name}`}
        name={name}
        type="number"
        defaultValue={def}
        min={min}
        max={max}
        className="text-center font-mono h-9"
      />
    </div>
  );
}
