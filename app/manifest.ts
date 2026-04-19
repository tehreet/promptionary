import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Promptionary",
    short_name: "Promptionary",
    description:
      "Multiplayer AI party game — Pictionary in reverse. Gemini paints, you guess.",
    start_url: "/",
    display: "standalone",
    theme_color: "#f43f5e",
    background_color: "#ffffff",
    icons: [
      {
        src: "/icon",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
