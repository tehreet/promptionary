import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Hex mirrors the game-canvas yellow + pink sticker palette;
          // ImageResponse can't read CSS vars.
          color: "#1e1b4d",
          fontSize: 128,
          fontWeight: 900,
          letterSpacing: "-0.05em",
          fontFamily: "sans-serif",
          backgroundImage:
            "linear-gradient(135deg, #ffe15e 0%, #ff5eb4 100%)",
        }}
      >
        P
      </div>
    ),
    { ...size },
  );
}
