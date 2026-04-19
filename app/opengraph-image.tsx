import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Promptionary — Pictionary in reverse";

export default function OpenGraph() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          alignItems: "stretch",
          justifyContent: "flex-start",
          fontFamily: "sans-serif",
          color: "white",
          backgroundColor: "#0b0820",
          backgroundImage: `
            radial-gradient(ellipse 70% 60% at 10% -10%, rgba(99, 102, 241, 0.95), transparent 55%),
            radial-gradient(ellipse 60% 55% at 95% 10%, rgba(217, 70, 239, 0.9), transparent 55%),
            radial-gradient(ellipse 80% 55% at 60% 110%, rgba(244, 63, 94, 0.85), transparent 55%),
            linear-gradient(135deg, #0b0820 0%, #1a0b3d 100%)
          `,
        }}
      >
        {/* Decorative color blobs on the right */}
        <div
          style={{
            position: "absolute",
            right: -80,
            top: 60,
            width: 420,
            height: 420,
            borderRadius: 210,
            background: "rgba(99, 102, 241, 0.55)",
            filter: "blur(8px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 160,
            top: 220,
            width: 320,
            height: 320,
            borderRadius: 160,
            background: "rgba(217, 70, 239, 0.55)",
            filter: "blur(8px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 40,
            top: 340,
            width: 280,
            height: 280,
            borderRadius: 140,
            background: "rgba(244, 63, 94, 0.55)",
            filter: "blur(8px)",
          }}
        />

        {/* Left column: brand */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 72px",
            gap: 20,
            flex: 1,
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 22,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              fontWeight: 700,
              opacity: 0.8,
            }}
          >
            <span
              style={{
                display: "flex",
                width: 48,
                height: 48,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                backgroundImage:
                  "linear-gradient(135deg, #6366f1, #d946ef, #f43f5e)",
                fontSize: 30,
                fontWeight: 900,
                letterSpacing: "-0.05em",
              }}
            >
              P
            </span>
            <span>AI party game</span>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 172,
              fontWeight: 900,
              letterSpacing: "-0.06em",
              lineHeight: 0.95,
            }}
          >
            Promptionary
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 48,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              opacity: 0.95,
            }}
          >
            Pictionary, in reverse.
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 30,
              fontWeight: 500,
              opacity: 0.8,
              maxWidth: 780,
              lineHeight: 1.3,
            }}
          >
            An AI paints from a secret prompt — you guess the prompt.
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 24,
              gap: 12,
            }}
          >
            {["🎨 Party", "✍️ Artist", "📅 Daily"].map((label) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  padding: "10px 22px",
                  borderRadius: 9999,
                  background: "rgba(255,255,255,0.14)",
                  border: "1px solid rgba(255,255,255,0.28)",
                  fontSize: 26,
                  fontWeight: 700,
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Footer URL */}
        <div
          style={{
            position: "absolute",
            bottom: 36,
            right: 48,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "0.05em",
            opacity: 0.85,
          }}
        >
          promptionary.io
        </div>
      </div>
    ),
    { ...size },
  );
}
