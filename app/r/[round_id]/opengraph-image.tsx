import { ImageResponse } from "next/og";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// 1200x630 unfurl card for a single round recap. Jackbox sticker aesthetic —
// the round image is the hero (tilted sticker on the right), with the prompt
// in a chunky paper card on the left and an optional top-guess callout.
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
          Promptionary — round not found
        </div>
      ),
      { ...size },
    );
  }

  const { round, topGuess, topPlayer } = data;
  const prompt = round.prompt ? truncate(round.prompt, 140) : "Guess the prompt";
  const topText = topGuess
    ? `"${truncate(topGuess.guess, 48)}" — ${topPlayer ?? "Player"} · +${topGuess.total_score ?? 0}`
    : null;

  // "GUESS" as individual sticker tiles — the hero line.
  const guessLetters = "GUESS".split("");
  const guessTilts = [-4, 3, -3, 4, -2];
  const guessBgs = [pink, cyan, orange, pink, cyan];

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
        {/* Decorative sticker blobs, tucked out of the way of the image. */}
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
            bottom: -100,
            width: 240,
            height: 240,
            borderRadius: 120,
            background: cyan,
            border: `6px solid ${ink}`,
          }}
        />

        {/* Left column: GUESS header + prompt + top guess. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "44px 56px",
            gap: 22,
            flex: 1,
            zIndex: 1,
            maxWidth: 720,
          }}
        >
          {/* Tilted GUESS wordmark. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            {guessLetters.map((ch, i) => (
              <div
                key={`${ch}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 76,
                  height: 94,
                  background: guessBgs[i % guessBgs.length],
                  color: ink,
                  border: `5px solid ${ink}`,
                  borderRadius: 14,
                  fontSize: 72,
                  fontWeight: 900,
                  letterSpacing: "-0.05em",
                  transform: `rotate(${guessTilts[i % guessTilts.length]}deg)`,
                  boxShadow: `5px 5px 0 ${ink}`,
                }}
              >
                {ch}
              </div>
            ))}
          </div>

          {/* "THE PROMPT" label. */}
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 900,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: ink,
              opacity: 0.75,
            }}
          >
            The prompt was
          </div>

          {/* Prompt paper card. */}
          <div
            style={{
              display: "flex",
              padding: "22px 26px",
              background: cream,
              border: `5px solid ${ink}`,
              borderRadius: 18,
              fontSize: 38,
              fontWeight: 800,
              lineHeight: 1.2,
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
                gap: 12,
                fontSize: 22,
                fontWeight: 800,
                color: ink,
              }}
            >
              <span
                style={{
                  display: "flex",
                  padding: "7px 16px",
                  borderRadius: 9999,
                  background: pink,
                  color: cream,
                  border: `3px solid ${ink}`,
                  fontSize: 20,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                  transform: "rotate(-2deg)",
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
              paddingTop: 8,
              fontSize: 22,
              fontWeight: 900,
              letterSpacing: "0.05em",
              color: ink,
            }}
          >
            promptionary.io
          </div>
        </div>

        {/* Right column: round image as tilted sticker. */}
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
                transform: "rotate(3deg)",
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
              ?
            </div>
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
