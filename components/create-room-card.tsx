"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createRoomAction } from "@/app/actions/create-room";
import { randomDisplayName } from "@/lib/player";
import { PACK_IDS, PACK_LABELS, type PackId } from "@/lib/prompt-dimensions";

export function CreateRoomCard({
  defaultName,
}: { defaultName?: string | null } = {}) {
  const initialName = useMemo(
    () => defaultName ?? randomDisplayName(),
    [defaultName],
  );
  const [advanced, setAdvanced] = useState(false);
  const [mode, setMode] = useState<"party" | "artist">("artist");
  const [pack, setPack] = useState<PackId>("mixed");
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
          <div className="space-y-1.5">
            <Label htmlFor="create-name">Your name</Label>
            <Input
              id="create-name"
              name="displayName"
              defaultValue={initialName}
              maxLength={24}
              required
              className="bg-white border-2 rounded-lg h-10"
              style={{ borderColor: "var(--game-ink)", color: "var(--game-ink)" }}
            />
          </div>

          <input type="hidden" name="mode" value={mode} />
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <div className="grid grid-cols-2 gap-2">
              <ModeButton
                active={mode === "artist"}
                onClick={() => setMode("artist")}
                title="Artist"
                subtitle="One writes · others guess"
              />
              <ModeButton
                active={mode === "party"}
                onClick={() => setMode("party")}
                title="Party"
                subtitle="AI writes · all guess"
              />
            </div>
          </div>

          <input type="hidden" name="pack" value={pack} />
          {mode === "party" && (
            <div className="space-y-1.5">
              <Label>Theme pack</Label>
              <div
                role="radiogroup"
                aria-label="Theme pack"
                className="flex flex-wrap gap-1.5"
              >
                {PACK_IDS.map((p) => {
                  const meta = PACK_LABELS[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={pack === p}
                      data-pack={p}
                      onClick={() => setPack(p)}
                      title={meta.blurb}
                      className={`rounded-full px-3 py-1.5 text-xs font-black border-2 transition ${
                        pack === p ? "" : "hover:opacity-80"
                      }`}
                      style={
                        pack === p
                          ? { background: "var(--game-ink)", color: "var(--game-canvas-yellow)", borderColor: "var(--game-ink)" }
                          : { background: "var(--game-paper)", color: "var(--game-ink)", borderColor: "var(--game-ink)" }
                      }
                    >
                      <span className="mr-1">{meta.emoji}</span>
                      {meta.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
            aria-label="Create Room"
            className="w-full h-12 rounded-xl font-heading font-black text-base border-2"
            style={{
              background: "var(--game-canvas-yellow)",
              color: "var(--game-ink)",
              borderColor: "var(--game-ink)",
              boxShadow: "3px 3px 0 var(--game-ink)",
            }}
          >
            Start →
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
      className={`rounded-xl px-3 py-2 border-2 text-left transition ${
        active ? "font-black" : "hover:opacity-80"
      }`}
      style={
        active
          ? { background: "var(--game-ink)", color: "var(--game-canvas-yellow)", borderColor: "var(--game-ink)" }
          : { background: "var(--game-paper)", color: "var(--game-ink)", borderColor: "var(--game-ink)" }
      }
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
        className="bg-white border-2 rounded-lg h-10"
        style={{ borderColor: "var(--game-ink)", color: "var(--game-ink)" }}
      />
    </div>
  );
}
