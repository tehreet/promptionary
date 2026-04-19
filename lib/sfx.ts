"use client";

type SfxName =
  | "submit"
  | "imageLand"
  | "winnerCheer"
  | "roundStart"
  | "reveal";

const STORAGE_KEY = "promptionary.sfx-muted";

let ctx: AudioContext | null = null;
let muted = false;
type Listener = (m: boolean) => void;
const listeners = new Set<Listener>();

if (typeof window !== "undefined") {
  try {
    muted = window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    muted = false;
  }
  // Prime the audio context on first pointer / key interaction so later
  // programmatic sounds (winner cheer, etc.) actually play.
  const prime = () => {
    getCtx();
    window.removeEventListener("pointerdown", prime);
    window.removeEventListener("keydown", prime);
  };
  window.addEventListener("pointerdown", prime);
  window.addEventListener("keydown", prime);
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function logCall(name: SfxName) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __sfx?: Array<{ name: string; t: number }> };
  if (!w.__sfx) w.__sfx = [];
  w.__sfx.push({ name, t: Date.now() });
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  try {
    window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l(v));
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

export function subscribeMuted(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function tone(
  c: AudioContext,
  freq: number,
  startT: number,
  durS: number,
  opts: {
    type?: OscillatorType;
    gain?: number;
    attack?: number;
    release?: number;
    freqTo?: number;
  } = {},
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, startT);
  if (opts.freqTo) {
    osc.frequency.exponentialRampToValueAtTime(opts.freqTo, startT + durS);
  }
  const peak = opts.gain ?? 0.15;
  const attack = opts.attack ?? 0.005;
  const release = opts.release ?? 0.06;
  gain.gain.setValueAtTime(0, startT);
  gain.gain.linearRampToValueAtTime(peak, startT + attack);
  gain.gain.setValueAtTime(peak, Math.max(startT + attack, startT + durS - release));
  gain.gain.linearRampToValueAtTime(0, startT + durS);
  osc.connect(gain).connect(c.destination);
  osc.start(startT);
  osc.stop(startT + durS + 0.02);
}

export function playSubmit(): void {
  logCall("submit");
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  tone(c, 660, now, 0.08, { type: "triangle", gain: 0.18 });
  tone(c, 988, now + 0.07, 0.1, { type: "triangle", gain: 0.18 });
}

export function playImageLand(): void {
  logCall("imageLand");
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  tone(c, 220, now, 0.38, {
    type: "sine",
    gain: 0.2,
    freqTo: 740,
    attack: 0.04,
    release: 0.1,
  });
}

export function playWinnerCheer(): void {
  logCall("winnerCheer");
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    tone(c, f, now + i * 0.09, 0.22, { type: "triangle", gain: 0.14 });
  });
  // Sparkle layer
  [1567.98, 1975.53].forEach((f, i) => {
    tone(c, f, now + 0.3 + i * 0.07, 0.18, { type: "sine", gain: 0.08 });
  });
}

export function playReveal(): void {
  logCall("reveal");
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  tone(c, 392, now, 0.12, { type: "triangle", gain: 0.14 });
  tone(c, 523.25, now + 0.09, 0.16, { type: "triangle", gain: 0.14 });
}
