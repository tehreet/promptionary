import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Promptionary";

// Site-wide unfurl card — Jackbox sticker aesthetic. Tilted wordmark, a few
// sticker chips with example emojis, URL bottom-right. Nothing else.
//
// Hex mirrors the design tokens: --game-canvas-yellow / --game-ink /
// --game-pink / --game-cyan / --game-paper / --game-orange. ImageResponse
// can't resolve CSS vars, so the hex lives here — keep in sync with
// app/globals.css.
export default function OpenGraph() {
  const ink = "#1e1b4d";
  const pink = "#ff5eb4";
  const cyan = "#3ddce0";
  const yellow = "#ffe15e";
  const cream = "#fff7d6";
  const orange = "#ff8b3d";

  const wordmark = "PROMPTIONARY";

  // Per-letter tilt pattern — the wordmark should feel hand-placed, like
  // the stickers. Repeats across the 12 letters.
  const tilts = [-5, 3, -2, 4, -3, 2, -4, 3, -2, 4, -3, 2];
  const letterColors = [cream, cream, cream, cream, cream, cream];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
          color: ink,
          backgroundColor: yellow,
        }}
      >
        {/* Off-canvas sticker blobs for depth — flat fills, ink borders. */}
        <div
          style={{
            position: "absolute",
            left: -140,
            top: -120,
            width: 360,
            height: 360,
            borderRadius: 180,
            background: pink,
            border: `7px solid ${ink}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: -110,
            top: -80,
            width: 280,
            height: 280,
            borderRadius: 140,
            background: cyan,
            border: `7px solid ${ink}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: -60,
            bottom: -120,
            width: 320,
            height: 320,
            borderRadius: 160,
            background: orange,
            border: `7px solid ${ink}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -80,
            bottom: -140,
            width: 280,
            height: 280,
            borderRadius: 140,
            background: cream,
            border: `7px solid ${ink}`,
          }}
        />

        {/* Center column: wordmark + chips. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 44,
            zIndex: 1,
          }}
        >
          {/* Tilted wordmark — each letter is its own sticker tile. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {wordmark.split("").map((ch, i) => (
              <div
                key={`${ch}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 82,
                  height: 110,
                  background: ink,
                  color: letterColors[i % letterColors.length],
                  border: `6px solid ${ink}`,
                  borderRadius: 16,
                  fontSize: 92,
                  fontWeight: 900,
                  letterSpacing: "-0.05em",
                  transform: `rotate(${tilts[i % tilts.length]}deg)`,
                  boxShadow: `6px 6px 0 ${ink}`,
                }}
              >
                {ch}
              </div>
            ))}
          </div>

          {/* Sticker chips with example emojis. Each slightly rotated. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 22,
            }}
          >
            {[
              { emoji: "🎨", bg: pink, rotate: -4 },
              { emoji: "🦑", bg: cyan, rotate: 3 },
              { emoji: "🌋", bg: orange, rotate: -2 },
              { emoji: "👽", bg: cream, rotate: 4 },
              { emoji: "🕺", bg: pink, rotate: -3 },
            ].map(({ emoji, bg, rotate }) => (
              <div
                key={emoji}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 96,
                  height: 96,
                  background: bg,
                  border: `6px solid ${ink}`,
                  borderRadius: 22,
                  fontSize: 60,
                  transform: `rotate(${rotate}deg)`,
                  boxShadow: `6px 6px 0 ${ink}`,
                }}
              >
                {emoji}
              </div>
            ))}
          </div>
        </div>

        {/* Footer URL — bottom-right sticker pill. */}
        <div
          style={{
            position: "absolute",
            bottom: 40,
            right: 48,
            display: "flex",
            padding: "12px 24px",
            background: ink,
            color: yellow,
            border: `5px solid ${ink}`,
            borderRadius: 9999,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: "0.05em",
            transform: "rotate(-2deg)",
            boxShadow: `5px 5px 0 ${ink}`,
            zIndex: 1,
          }}
        >
          promptionary.io
        </div>
      </div>
    ),
    { ...size },
  );
}
