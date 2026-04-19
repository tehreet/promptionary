import { ImageResponse } from "next/og";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

// 1200x630 unfurl card. Vibrant, anti-slop — same sticker palette as the
// landing card but flipped so the round image is the hero. Discord / iMessage
// / Twitter all happily consume this.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Promptionary round recap";

type Round = {
  id: string;
  prompt: string | null;
  image_url: string | null;
  ended_at: string | null;
};

type Guess = {
  guess: string;
  total_score: number | null;
  player_id: string;
  room_players?: unknown;
};

async function loadRound(roundId: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      roundId,
    )
  ) {
    return null;
  }
  const svc = createSupabaseServiceClient();
  const { data: round } = await svc
    .from("rounds")
    .select("id, prompt, image_url, ended_at, room_id")
    .eq("id", roundId)
    .maybeSingle<Round & { room_id: string }>();
  if (!round || !round.ended_at) return null;

  const { data: topGuess } = await svc
    .from("guesses")
    .select("guess, total_score, player_id")
    .eq("round_id", round.id)
    .order("total_score", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<Guess>();

  let topPlayer: string | null = null;
  if (topGuess) {
    const { data: p } = await svc
      .from("room_players")
      .select("display_name")
      .eq("room_id", round.room_id)
      .eq("player_id", topGuess.player_id)
      .maybeSingle<{ display_name: string }>();
    topPlayer = p?.display_name ?? null;
  }

  return { round, topGuess: topGuess ?? null, topPlayer };
}

function truncate(str: string, max: number) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + "…";
}

export default async function Image({
  params,
}: {
  params: Promise<{ round_id: string }>;
}) {
  const { round_id } = await params;
  const data = await loadRound(round_id);

  // Mirrors --game-canvas-yellow / --game-ink / --game-pink / --game-cyan.
  // Update here if the tokens in globals.css ever change — ImageResponse
  // cannot resolve CSS vars.
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
          Promptionary — round not found
        </div>
      ),
      { ...size },
    );
  }

  const { round, topGuess, topPlayer } = data;
  const prompt = round.prompt ? truncate(round.prompt, 140) : "Guess the prompt";
  const topText = topGuess
    ? `"${truncate(topGuess.guess, 60)}" — ${topPlayer ?? "Player"} · +${topGuess.total_score ?? 0}`
    : null;

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
        {/* Sticker blobs in the top-left so they don't fight the image. */}
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

        {/* Left column: brand + prompt */}
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
            <span>Round recap</span>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 44,
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 1.0,
              opacity: 0.9,
            }}
          >
            Guess the prompt.
          </div>

          <div
            style={{
              display: "flex",
              padding: "22px 26px",
              background: cream,
              border: `5px solid ${ink}`,
              borderRadius: 18,
              fontSize: 38,
              fontWeight: 800,
              lineHeight: 1.25,
              boxShadow: `8px 8px 0 ${ink}`,
            }}
          >
            {prompt}
          </div>

          {topText && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 24,
                fontWeight: 700,
                color: ink,
                opacity: 0.95,
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
                  fontSize: 20,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                }}
              >
                Top guess
              </span>
              <span style={{ display: "flex" }}>{topText}</span>
            </div>
          )}

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

        {/* Right column: round image if present, styled as a sticker */}
        {round.image_url ? (
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
                src={round.image_url}
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
