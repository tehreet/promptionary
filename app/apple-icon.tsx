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
          color: "white",
          fontSize: 128,
          fontWeight: 900,
          letterSpacing: "-0.05em",
          fontFamily: "sans-serif",
          backgroundImage:
            "linear-gradient(135deg, #6366f1 0%, #d946ef 55%, #f43f5e 100%)",
        }}
      >
        P
      </div>
    ),
    { ...size },
  );
}
