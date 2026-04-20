"use client";

import { useMemo } from "react";

type Size = "sm" | "md" | "lg";

const SIZE_PX: Record<Size, number> = {
  sm: 48,
  md: 96,
  lg: 160,
};

type VariantKey = "robot" | "palette" | "brush" | "easel" | "pencil";

const VARIANTS: VariantKey[] = [
  "robot",
  "palette",
  "brush",
  "easel",
  "pencil",
];

export function ArtLoader({
  size = "lg",
  variant,
  className = "",
}: {
  size?: Size;
  variant?: VariantKey;
  className?: string;
}) {
  // Randomly pick a variant on mount (unless one is forced). useMemo with
  // empty deps ensures we don't re-pick on re-render.
  const picked = useMemo<VariantKey>(() => {
    if (variant) return variant;
    return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
  }, [variant]);

  const px = SIZE_PX[size];

  return (
    <div
      className={`art-loader art-loader--${picked} inline-flex items-center justify-center ${className}`}
      style={{ width: px, height: px }}
      role="img"
      aria-label="Loading"
    >
      {picked === "robot" && <RobotPainting />}
      {picked === "palette" && <PaletteSpin />}
      {picked === "brush" && <BrushStroke />}
      {picked === "easel" && <EaselCanvas />}
      {picked === "pencil" && <PencilSketch />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Variant 1 — RobotPainting                                           */
/* ------------------------------------------------------------------ */

function RobotPainting() {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <style>{`
          .al-robot-body { transform-origin: 50px 60px; animation: al-robot-sway 2.6s ease-in-out infinite; }
          .al-robot-arm { transform-origin: 64px 54px; animation: al-robot-arm 1.4s ease-in-out infinite; }
          .al-robot-eye { animation: al-robot-blink 3.2s steps(1, end) infinite; transform-origin: center; }
          @keyframes al-robot-sway {
            0%, 100% { transform: rotate(-4deg); }
            50% { transform: rotate(4deg); }
          }
          @keyframes al-robot-arm {
            0%, 100% { transform: rotate(-12deg); }
            50% { transform: rotate(22deg); }
          }
          @keyframes al-robot-blink {
            0%, 92%, 100% { transform: scaleY(1); }
            94%, 98% { transform: scaleY(0.1); }
          }
          @media (prefers-reduced-motion: reduce) {
            .al-robot-body { animation-duration: 6s; }
            .al-robot-arm { animation: al-robot-arm 4s ease-in-out infinite; }
            .al-robot-eye { animation: none; }
          }
        `}</style>
      </defs>

      {/* floor shadow */}
      <ellipse cx="50" cy="92" rx="24" ry="3" fill="var(--game-ink)" opacity="0.15" />

      <g className="al-robot-body">
        {/* legs */}
        <rect x="38" y="72" width="7" height="14" rx="2" fill="var(--game-ink)" />
        <rect x="55" y="72" width="7" height="14" rx="2" fill="var(--game-ink)" />

        {/* body */}
        <rect
          x="32"
          y="40"
          width="36"
          height="36"
          rx="8"
          fill="var(--game-cyan)"
          stroke="var(--game-ink)"
          strokeWidth="3"
        />
        {/* chest panel */}
        <rect x="42" y="52" width="16" height="10" rx="2" fill="var(--game-paper)" stroke="var(--game-ink)" strokeWidth="2" />
        <circle cx="46" cy="57" r="1.3" fill="var(--game-pink)" />
        <circle cx="50" cy="57" r="1.3" fill="var(--game-canvas-yellow)" />
        <circle cx="54" cy="57" r="1.3" fill="var(--game-cyan)" />

        {/* head */}
        <rect
          x="36"
          y="18"
          width="28"
          height="22"
          rx="6"
          fill="var(--game-paper)"
          stroke="var(--game-ink)"
          strokeWidth="3"
        />
        {/* antenna */}
        <line x1="50" y1="18" x2="50" y2="10" stroke="var(--game-ink)" strokeWidth="2" />
        <circle cx="50" cy="9" r="2.5" fill="var(--game-pink)" stroke="var(--game-ink)" strokeWidth="1.5" />
        {/* eyes */}
        <g className="al-robot-eye">
          <circle cx="44" cy="29" r="2.5" fill="var(--game-ink)" />
          <circle cx="56" cy="29" r="2.5" fill="var(--game-ink)" />
        </g>
        {/* smile */}
        <path d="M 44 35 Q 50 38 56 35" stroke="var(--game-ink)" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* left arm (static) */}
        <rect x="26" y="46" width="8" height="20" rx="3" fill="var(--game-cyan)" stroke="var(--game-ink)" strokeWidth="2" />

        {/* right arm (swings — holds brush) */}
        <g className="al-robot-arm">
          <rect x="64" y="46" width="8" height="18" rx="3" fill="var(--game-cyan)" stroke="var(--game-ink)" strokeWidth="2" />
          {/* brush handle */}
          <rect x="70" y="58" width="16" height="4" rx="1.5" fill="var(--game-orange)" stroke="var(--game-ink)" strokeWidth="1.5" transform="rotate(20 72 60)" />
          {/* brush bristles */}
          <path d="M 84 54 L 90 50 L 92 55 L 88 58 Z" fill="var(--game-pink)" stroke="var(--game-ink)" strokeWidth="1.5" transform="rotate(20 72 60)" />
        </g>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Variant 2 — PaletteSpin                                             */
/* ------------------------------------------------------------------ */

function PaletteSpin() {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <style>{`
          .al-palette-group { transform-origin: 50px 50px; animation: al-palette-tilt 4s ease-in-out infinite; }
          .al-blob { transform-origin: center; transform-box: fill-box; animation: al-blob-pulse 1.8s ease-in-out infinite; }
          .al-blob-1 { animation-delay: 0s; }
          .al-blob-2 { animation-delay: 0.25s; }
          .al-blob-3 { animation-delay: 0.5s; }
          .al-blob-4 { animation-delay: 0.75s; }
          .al-blob-5 { animation-delay: 1s; }
          @keyframes al-palette-tilt {
            0%, 100% { transform: rotate(-14deg); }
            50% { transform: rotate(14deg); }
          }
          @keyframes al-blob-pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.18); }
          }
          @media (prefers-reduced-motion: reduce) {
            .al-palette-group { animation-duration: 9s; }
            .al-blob { animation: al-blob-pulse 4s ease-in-out infinite; }
          }
        `}</style>
      </defs>

      <g className="al-palette-group">
        {/* palette body: rounded kidney shape */}
        <path
          d="
            M 20 50
            C 20 28, 42 16, 62 20
            C 82 24, 90 40, 86 54
            C 82 66, 70 72, 60 68
            C 52 65, 50 72, 54 78
            C 58 84, 52 90, 42 86
            C 26 80, 20 70, 20 50 Z"
          fill="var(--game-paper)"
          stroke="var(--game-ink)"
          strokeWidth="3"
        />
        {/* thumb hole */}
        <ellipse cx="58" cy="58" rx="5" ry="4" fill="var(--game-canvas-warm)" stroke="var(--game-ink)" strokeWidth="2" />

        {/* 5 paint blobs */}
        <circle className="al-blob al-blob-1" cx="34" cy="34" r="6" fill="var(--game-pink)" stroke="var(--game-ink)" strokeWidth="1.5" />
        <circle className="al-blob al-blob-2" cx="52" cy="28" r="6" fill="var(--game-cyan)" stroke="var(--game-ink)" strokeWidth="1.5" />
        <circle className="al-blob al-blob-3" cx="70" cy="34" r="6" fill="var(--game-canvas-yellow)" stroke="var(--game-ink)" strokeWidth="1.5" />
        <circle className="al-blob al-blob-4" cx="76" cy="50" r="6" fill="var(--game-ink)" stroke="var(--game-ink)" strokeWidth="1.5" />
        <circle className="al-blob al-blob-5" cx="40" cy="52" r="5" fill="var(--game-orange)" stroke="var(--game-ink)" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Variant 3 — BrushStroke                                             */
/* ------------------------------------------------------------------ */

function BrushStroke() {
  // A single chunky S-curve stroke that draws in, then swaps colors.
  const DASH = 260;
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <style>{`
          .al-brush-path {
            stroke-dasharray: ${DASH};
            stroke-dashoffset: ${DASH};
            animation: al-brush-draw 2.4s ease-in-out infinite, al-brush-color 7.2s linear infinite;
          }
          @keyframes al-brush-draw {
            0% { stroke-dashoffset: ${DASH}; }
            50% { stroke-dashoffset: 0; }
            100% { stroke-dashoffset: -${DASH}; }
          }
          @keyframes al-brush-color {
            0%, 100% { stroke: var(--game-pink); }
            33% { stroke: var(--game-cyan); }
            66% { stroke: var(--game-canvas-yellow); }
          }
          .al-brush-ferrule {
            animation: al-brush-ferrule-color 7.2s linear infinite;
          }
          @keyframes al-brush-ferrule-color {
            0%, 100% { fill: var(--game-pink); }
            33% { fill: var(--game-cyan); }
            66% { fill: var(--game-canvas-yellow); }
          }
          @media (prefers-reduced-motion: reduce) {
            .al-brush-path { animation-duration: 8s, 24s; }
            .al-brush-ferrule { animation-duration: 24s; }
          }
        `}</style>
      </defs>

      {/* The stroke */}
      <path
        className="al-brush-path"
        d="M 12 72 C 28 40, 50 90, 66 52 S 88 24, 92 18"
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
      />

      {/* Brush head following the end — just a static ferrule + handle in bottom-left
          to imply the painter. Keeps it readable at small sizes. */}
      <g>
        {/* handle */}
        <rect
          x="2"
          y="74"
          width="18"
          height="6"
          rx="2"
          fill="var(--game-ink-soft)"
          stroke="var(--game-ink)"
          strokeWidth="1.5"
          transform="rotate(-24 4 76)"
        />
        {/* ferrule (color-matched to stroke via animation) */}
        <rect
          className="al-brush-ferrule"
          x="16"
          y="70"
          width="8"
          height="10"
          rx="1.5"
          stroke="var(--game-ink)"
          strokeWidth="1.5"
          transform="rotate(-24 18 74)"
        />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Variant 4 — EaselCanvas                                             */
/* ------------------------------------------------------------------ */

function EaselCanvas() {
  // Paint dots fly onto a canvas one by one; the whole set fades and restarts.
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <style>{`
          .al-dot {
            opacity: 0;
            transform-origin: center;
            transform-box: fill-box;
            animation: al-dot-fly 4.8s ease-in-out infinite;
          }
          .al-dot-1 { animation-delay: 0s; }
          .al-dot-2 { animation-delay: 0.35s; }
          .al-dot-3 { animation-delay: 0.7s; }
          .al-dot-4 { animation-delay: 1.05s; }
          .al-dot-5 { animation-delay: 1.4s; }
          .al-dot-6 { animation-delay: 1.75s; }
          @keyframes al-dot-fly {
            0% { opacity: 0; transform: translate(-18px, 22px) scale(0.4); }
            12% { opacity: 1; transform: translate(0, 0) scale(1); }
            70% { opacity: 1; transform: translate(0, 0) scale(1); }
            85% { opacity: 0; transform: translate(0, 0) scale(1.15); }
            100% { opacity: 0; transform: translate(-18px, 22px) scale(0.4); }
          }
          .al-easel-body { transform-origin: 50px 70px; animation: al-easel-sway 5s ease-in-out infinite; }
          @keyframes al-easel-sway {
            0%, 100% { transform: rotate(-1.5deg); }
            50% { transform: rotate(1.5deg); }
          }
          @media (prefers-reduced-motion: reduce) {
            .al-dot { animation-duration: 12s; }
            .al-easel-body { animation-duration: 12s; }
          }
        `}</style>
      </defs>

      <g className="al-easel-body">
        {/* easel legs */}
        <line x1="28" y1="92" x2="42" y2="30" stroke="var(--game-ink)" strokeWidth="3" strokeLinecap="round" />
        <line x1="72" y1="92" x2="58" y2="30" stroke="var(--game-ink)" strokeWidth="3" strokeLinecap="round" />
        <line x1="50" y1="28" x2="50" y2="96" stroke="var(--game-ink)" strokeWidth="3" strokeLinecap="round" />
        {/* crossbar */}
        <line x1="34" y1="72" x2="66" y2="72" stroke="var(--game-ink)" strokeWidth="3" strokeLinecap="round" />

        {/* canvas */}
        <rect
          x="26"
          y="24"
          width="48"
          height="44"
          rx="2"
          fill="var(--game-paper)"
          stroke="var(--game-ink)"
          strokeWidth="3"
        />

        {/* dots painted onto canvas */}
        <circle className="al-dot al-dot-1" cx="36" cy="36" r="4" fill="var(--game-pink)" />
        <circle className="al-dot al-dot-2" cx="50" cy="34" r="4" fill="var(--game-cyan)" />
        <circle className="al-dot al-dot-3" cx="62" cy="38" r="4" fill="var(--game-canvas-yellow)" />
        <circle className="al-dot al-dot-4" cx="40" cy="52" r="4" fill="var(--game-orange)" />
        <circle className="al-dot al-dot-5" cx="56" cy="54" r="4" fill="var(--game-ink)" />
        <circle className="al-dot al-dot-6" cx="48" cy="46" r="3" fill="var(--game-pink)" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Variant 5 — PencilSketch                                            */
/* ------------------------------------------------------------------ */

function PencilSketch() {
  // 3 pencils orbiting a shared center.
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <style>{`
          .al-orbit { transform-origin: 50px 50px; animation: al-orbit-spin 4s linear infinite; }
          .al-orbit-2 { animation-delay: -1.33s; }
          .al-orbit-3 { animation-delay: -2.66s; }
          @keyframes al-orbit-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          .al-pencil { transform-origin: 50px 50px; }
          @media (prefers-reduced-motion: reduce) {
            .al-orbit { animation-duration: 16s; }
          }
        `}</style>
      </defs>

      {/* Shared axis: each group rotates around center, pencil is placed
          offset so it orbits. Each pencil uses a different game color. */}
      <g className="al-orbit">
        <Pencil color="var(--game-pink)" />
      </g>
      <g className="al-orbit al-orbit-2">
        <Pencil color="var(--game-cyan)" />
      </g>
      <g className="al-orbit al-orbit-3">
        <Pencil color="var(--game-canvas-yellow)" />
      </g>

      {/* center dot so the orbit reads even at tiny size */}
      <circle cx="50" cy="50" r="3" fill="var(--game-ink)" />
    </svg>
  );
}

function Pencil({ color }: { color: string }) {
  // Pencil drawn horizontally with tip pointing at center (50,50).
  // Tip is at x=50, body goes to the right (so it reads as "orbiting").
  return (
    <g>
      {/* tip (graphite point) */}
      <path
        d="M 50 50 L 60 44 L 60 56 Z"
        fill="var(--game-ink)"
        stroke="var(--game-ink)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* wood collar */}
      <rect x="60" y="44" width="4" height="12" fill="var(--game-paper)" stroke="var(--game-ink)" strokeWidth="1.5" />
      {/* painted body */}
      <rect x="64" y="44" width="20" height="12" fill={color} stroke="var(--game-ink)" strokeWidth="1.5" />
      {/* metal ferrule */}
      <rect x="84" y="44" width="4" height="12" fill="var(--game-ink-soft)" stroke="var(--game-ink)" strokeWidth="1.5" />
      {/* eraser */}
      <rect x="88" y="44" width="6" height="12" rx="1.5" fill="var(--game-pink)" stroke="var(--game-ink)" strokeWidth="1.5" />
    </g>
  );
}
