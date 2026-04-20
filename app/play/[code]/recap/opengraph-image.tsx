import { ImageResponse } from "next/og";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

// 1200x630 unfurl card for the full-game recap. Shows the winner + round
// count. Mirrors the sticker aesthetic from /r/[round_id]/opengraph-image.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Promptionary game recap";

type Room = { id: string; code: string; phase: string };
type Player = { display_name: string; score: number; is_spectator: boolean };
type Round = { id: string; image_url: string | null };

async function loadRecap(code: string) {
  if (!/^[A-Z]{4}$/.test(code)) return null;

  const svc = createSupabaseServiceClient();
  const { data: room } = await svc
    .from("rooms")
    .select("id, code, phase")
    .eq("code", code)
    .maybeSingle<Room>();
  if (!room || room.phase !== "game_over") return null;

  const [{ data: players }, { data: rounds }] = await Promise.all([
    svc
      .from("room_players")
      .select("display_name, score, is_spectator")
      .eq("room_id", room.id),
    svc
      .from("rounds")
      .select("id, image_url")
      .eq("room_id", room.id)
      .not("ended_at", "is", null)
      .order("round_num", { ascending: true }),
  ]);

  const guessers = ((players ?? []) as Player[]).filter(
    (p) => !p.is_spectator,
  );
  const winner = guessers.slice().sort((a, b) => b.score - a.score)[0] ?? null;
  const roundRows = (rounds ?? []) as Round[];
  const firstImage = roundRows.find((r) => r.image_url)?.image_url ?? null;

  return { room, winner, roundCount: roundRows.length, firstImage };
}

function truncate(str: string, max: number) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + "…";
}

export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const data = await loadRecap(code.toUpperCase());

  // Mirrors --game-canvas-yellow / --game-ink / --game-pink / --game-cyan.
  // ImageResponse can't resolve CSS vars — keep in sync with globals.css.
  const ink = "#1e1b4d";
  const pink = "#ff5eb4";
  const cyan = "#3ddce0";
  const yellow = "#ffe15e";
  const cream = "#fff7d6";

  if (!data) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: yellow,
            color: ink,
            fontFamily: "sans-serif",
            fontSize: 56,
            fontWeight: 900,
            letterSpacing: "-0.03em",
          }}
        >
          Promptionary — recap not found
        </div>
      ),
      { ...size },
    );
  }

  const { room, winner, roundCount, firstImage } = data;
  const winnerLine = winner
    ? `${truncate(winner.display_name, 24)} · ${winner.score}`
    : "No winner yet";

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
          color: ink,
          backgroundColor: yellow,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -90,
            top: -90,
            width: 360,
            height: 360,
            borderRadius: 180,
            background: pink,
            border: `6px solid ${ink}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 150,
            top: -60,
            width: 220,
            height: 220,
            borderRadius: 110,
            background: cyan,
            border: `6px solid ${ink}`,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "48px 60px",
            gap: 20,
            flex: 1,
            zIndex: 1,
            maxWidth: 720,
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
              fontWeight: 800,
              opacity: 0.9,
            }}
          >
            <span
              style={{
                display: "flex",
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                background: pink,
                border: `3px solid ${ink}`,
                color: cream,
                fontSize: 28,
                fontWeight: 900,
                letterSpacing: "-0.05em",
              }}
            >
              P
            </span>
            <span>Room {room.code} recap</span>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 64,
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 1.0,
            }}
          >
            {roundCount} round{roundCount === 1 ? "" : "s"}. One winner.
          </div>

          <div
            style={{
              display: "flex",
              padding: "22px 26px",
              background: cream,
              border: `5px solid ${ink}`,
              borderRadius: 18,
              fontSize: 40,
              fontWeight: 800,
              lineHeight: 1.2,
              boxShadow: `8px 8px 0 ${ink}`,
              alignItems: "center",
              gap: 16,
            }}
          >
            <span
              style={{
                display: "flex",
                padding: "6px 14px",
                borderRadius: 9999,
                background: pink,
                color: cream,
                border: `3px solid ${ink}`,
                fontSize: 22,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.15em",
              }}
            >
              Champ
            </span>
            <span style={{ display: "flex" }}>{winnerLine}</span>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: "auto",
              paddingTop: 10,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.05em",
              opacity: 0.85,
            }}
          >
            promptionary.io
          </div>
        </div>

        {firstImage ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 480,
              padding: "48px 40px 48px 0",
              zIndex: 1,
            }}
          >
            <div
              style={{
                display: "flex",
                padding: 10,
                background: cream,
                border: `6px solid ${ink}`,
                borderRadius: 22,
                boxShadow: `12px 12px 0 ${ink}`,
                transform: "rotate(2deg)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={firstImage}
                alt=""
                width={420}
                height={420}
                style={{
                  width: 420,
                  height: 420,
                  objectFit: "cover",
                  borderRadius: 14,
                  display: "flex",
                }}
              />
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              width: 440,
              alignItems: "center",
              justifyContent: "center",
              padding: "48px 40px",
              zIndex: 1,
            }}
          >
            <div
              style={{
                display: "flex",
                width: 360,
                height: 360,
                borderRadius: 180,
                background: cyan,
                border: `6px solid ${ink}`,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 200,
                fontWeight: 900,
              }}
            >
              ?
            </div>
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
