import { ImageResponse } from "next/og";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// 1200x630 unfurl card for the full-game recap. Tilted "RECAP" sticker
// header, winner name + medal, round count. Shares the Jackbox sticker
// aesthetic with /r/[round_id]/opengraph-image and the landing card.
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

  // Hex mirrors the design tokens in app/globals.css. ImageResponse can't
  // resolve CSS vars — keep these in sync when tokens change.
  const ink = "#1e1b4d";
  const pink = "#ff5eb4";
  const cyan = "#3ddce0";
  const yellow = "#ffe15e";
  const cream = "#fff7d6";
  const orange = "#ff8b3d";

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
  const winnerName = winner ? truncate(winner.display_name, 22) : "No winner";
  const winnerScore = winner ? winner.score : 0;

  // "RECAP" as individual sticker tiles.
  const recapLetters = "RECAP".split("");
  const recapTilts = [-5, 3, -2, 4, -3];
  const recapBgs = [pink, cyan, orange, cream, pink];

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
        {/* Off-canvas decorative sticker blobs. */}
        <div
          style={{
            position: "absolute",
            left: -90,
            top: -90,
            width: 300,
            height: 300,
            borderRadius: 150,
            background: pink,
            border: `6px solid ${ink}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -60,
            bottom: -110,
            width: 260,
            height: 260,
            borderRadius: 130,
            background: cyan,
            border: `6px solid ${ink}`,
          }}
        />

        {/* Left column: RECAP header, winner sticker, round count. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "52px 60px",
            gap: 28,
            flex: 1,
            zIndex: 1,
            maxWidth: 760,
          }}
        >
          {/* Tilted RECAP wordmark. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {recapLetters.map((ch, i) => (
              <div
                key={`${ch}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 88,
                  height: 110,
                  background: recapBgs[i % recapBgs.length],
                  color: ink,
                  border: `6px solid ${ink}`,
                  borderRadius: 16,
                  fontSize: 82,
                  fontWeight: 900,
                  letterSpacing: "-0.05em",
                  transform: `rotate(${recapTilts[i % recapTilts.length]}deg)`,
                  boxShadow: `5px 5px 0 ${ink}`,
                }}
              >
                {ch}
              </div>
            ))}
          </div>

          {/* Winner card — medal + name + score. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "18px 22px 18px 18px",
              background: cream,
              border: `5px solid ${ink}`,
              borderRadius: 20,
              boxShadow: `8px 8px 0 ${ink}`,
              gap: 20,
            }}
          >
            {/* Medal */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 92,
                height: 92,
                borderRadius: 46,
                background: yellow,
                border: `5px solid ${ink}`,
                fontSize: 62,
                flexShrink: 0,
              }}
            >
              🥇
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: 20,
                  fontWeight: 900,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: ink,
                  opacity: 0.75,
                }}
              >
                Champ
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 54,
                  fontWeight: 900,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.0,
                }}
              >
                {winnerName}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 30,
                  fontWeight: 800,
                  color: ink,
                  opacity: 0.85,
                  marginTop: 4,
                }}
              >
                {winnerScore} pts
              </div>
            </div>
          </div>

          {/* Round count sticker chip + room code. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                padding: "10px 20px",
                borderRadius: 9999,
                background: pink,
                color: cream,
                border: `4px solid ${ink}`,
                fontSize: 26,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                transform: "rotate(-2deg)",
              }}
            >
              {roundCount} round{roundCount === 1 ? "" : "s"}
            </div>
            <div
              style={{
                display: "flex",
                padding: "10px 20px",
                borderRadius: 9999,
                background: cyan,
                color: ink,
                border: `4px solid ${ink}`,
                fontSize: 26,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                transform: "rotate(2deg)",
              }}
            >
              Room {room.code}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: "auto",
              paddingTop: 10,
              fontSize: 24,
              fontWeight: 900,
              letterSpacing: "0.05em",
              color: ink,
            }}
          >
            promptionary.io
          </div>
        </div>

        {/* Right column: first round image as tilted sticker, or cyan fallback. */}
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
                transform: "rotate(3deg)",
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
              width: 480,
              alignItems: "center",
              justifyContent: "center",
              padding: "48px 40px 48px 0",
              zIndex: 1,
            }}
          >
            <div
              style={{
                display: "flex",
                width: 360,
                height: 360,
                borderRadius: 32,
                background: cyan,
                border: `6px solid ${ink}`,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 200,
                fontWeight: 900,
                transform: "rotate(3deg)",
                boxShadow: `10px 10px 0 ${ink}`,
              }}
            >
              🏆
            </div>
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
