/**
 * Stress-test bots. Spawn N anonymous players into a room and have them
 * dawdle + guess nonsense. When picked as the artist, they submit a random
 * drawable prompt from SILLY_PROMPTS.
 *
 * Usage:
 *   bun scripts/bots.ts <ROOM_CODE> [--n 10] [--site https://promptionary.io]
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  );
  process.exit(1);
}

const BOT_NAMES = [
  "TurboMuffin",
  "PixelGoblin",
  "QuantumYeti",
  "SirByteAlot",
  "NoodleBaron",
  "CaptainSparkles",
  "PrinceFuzzbutt",
  "DoctorGlimmer",
  "MajorKazoo",
  "LadyWobbles",
  "BaronVonPickle",
  "DukeDumpling",
  "CommanderTaco",
  "AgentCupcake",
  "ProfessorYolk",
  "DameCrouton",
  "JudgeBiscuit",
  "WizardBoop",
  "MarquisDoodle",
  "ChairmanBrunch",
  "SenatorWaffle",
  "MayorSnorkel",
  "ColonelGouda",
  "AmbassadorSprinkle",
  "ReverendZest",
  "LieutenantFig",
  "SheriffBumble",
  "CorporalKiwi",
  "BrigadierPlum",
  "InspectorDimple",
];

const SILLY_PROMPTS = [
  "a cat wearing sunglasses riding a skateboard",
  "a corgi in a tiny business suit at a board meeting",
  "a penguin surfing a massive wave at sunset",
  "a giant squid reading a newspaper in a bathtub",
  "a robot chef flipping pancakes in space",
  "a dinosaur pouring coffee at a cafe counter",
  "a hedgehog knight riding a snail into battle",
  "a flamingo doing yoga on a beach at dawn",
  "an astronaut walking a golden retriever on the moon",
  "a raccoon in a detective trench coat solving a mystery",
  "a pug piloting a hot air balloon over Paris",
  "a polar bear ice skating at an outdoor rink",
  "a sloth dj-ing at a forest rave",
  "a capybara soaking in a hot spring with oranges",
  "a frog riding a unicycle through a city street",
  "a cow jumping rope on a rainbow",
  "a goose delivering mail on a bicycle",
  "a panda painting a self-portrait in watercolor",
  "a kangaroo playing basketball in a suit",
  "a walrus performing ballet on a stage",
  "a shark selling hot dogs at a pool party",
  "a squirrel doing a magic trick with an acorn",
  "a dragon baking a birthday cake",
  "a mermaid teaching a swimming class to fish",
  "a unicorn working at a drive-thru window",
  "a hamster running a lemonade stand",
  "a turtle breakdancing at a disco",
  "a llama getting a manicure at a spa",
  "a cactus wearing a cowboy hat playing guitar",
  "a narwhal sailing a pirate ship across the arctic",
];

const GIBBERISH = [
  "banana phone",
  "ghost sandwich",
  "purple triangle",
  "i have no idea",
  "maybe a house?",
  "space cow",
  "elvis presley",
  "angry broccoli",
  "is that a dog",
  "hmm",
  "cheese castle",
  "flying noodle",
  "dancing orange",
  "nope nope nope",
  "wizard cereal",
  "lava llama",
  "pirate tacos",
  "whales on fire",
  "robot jellyfish",
  "cactus juice",
  "shrimp parade",
  "cosmic burrito",
  "vibes only",
  "literally nothing",
  "potato king",
  "glitter storm",
  "angry toast",
  "neon badger",
  "disco goose",
  "just a guess lol",
];

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface Args {
  code: string;
  n: number;
  site: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let code: string | null = null;
  let n = 10;
  let site = "https://promptionary.io";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n" || a === "-n") {
      n = parseInt(argv[++i] ?? "10", 10);
    } else if (a === "--site") {
      site = argv[++i] ?? site;
    } else if (!code) {
      code = a;
    }
  }
  if (!code || !/^[A-Z]{4}$/i.test(code)) {
    console.error("Usage: bun scripts/bots.ts <ROOM_CODE> [--n 10] [--site https://promptionary.io]");
    process.exit(1);
  }
  return { code: code.toUpperCase(), n, site };
}

interface BotState {
  name: string;
  client: SupabaseClient;
  playerId: string;
  accessToken: string;
  roomId: string;
  lastRoundId: string | null;
  hasActedThisRound: boolean;
}

async function joinAsBot(code: string, name: string): Promise<BotState> {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authErr } = await client.auth.signInAnonymously();
  if (authErr || !auth.session || !auth.user) {
    throw new Error(`[${name}] sign-in failed: ${authErr?.message}`);
  }
  const { data: roomId, error: joinErr } = await client.rpc(
    "join_room_by_code",
    { p_code: code, p_display_name: name, p_as_spectator: false },
  );
  if (joinErr || !roomId) {
    throw new Error(`[${name}] join failed: ${joinErr?.message}`);
  }
  return {
    name,
    client,
    playerId: auth.user.id,
    accessToken: auth.session.access_token,
    roomId: roomId as string,
    lastRoundId: null,
    hasActedThisRound: false,
  };
}

async function submitArtistPrompt(
  bot: BotState,
  roundId: string,
  site: string,
): Promise<void> {
  const prompt = pick(SILLY_PROMPTS);
  const res = await fetch(`${site}/api/submit-artist-prompt`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bot.accessToken}`,
    },
    body: JSON.stringify({ round_id: roundId, prompt }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(
      `[${bot.name}] artist submit failed ${res.status}: ${text.slice(0, 200)}`,
    );
    return;
  }
  console.log(`[${bot.name}] ✏️ artist prompt: ${prompt}`);
}

async function submitGuess(bot: BotState, roundId: string): Promise<void> {
  const guess = pick(GIBBERISH);
  const { error } = await bot.client.rpc("submit_guess", {
    p_round_id: roundId,
    p_guess: guess,
  });
  if (error) {
    console.warn(`[${bot.name}] guess failed: ${error.message}`);
    return;
  }
  console.log(`[${bot.name}] 💬 guessed: ${guess}`);
}

async function runBot(code: string, name: string, site: string): Promise<void> {
  let bot: BotState;
  try {
    bot = await joinAsBot(code, name);
    console.log(`[${name}] joined room ${code}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return;
  }

  while (true) {
    await sleep(2000);
    try {
      const { data: room, error: roomErr } = await bot.client
        .from("rooms")
        .select("id, phase, phase_ends_at, current_round_id")
        .eq("id", bot.roomId)
        .maybeSingle();
      if (roomErr || !room) continue;

      const currentRoundId = room.current_round_id as string | null;
      if (currentRoundId && currentRoundId !== bot.lastRoundId) {
        bot.lastRoundId = currentRoundId;
        bot.hasActedThisRound = false;
      }

      const phase = room.phase as string;

      if (phase === "prompting" && currentRoundId && !bot.hasActedThisRound) {
        const { data: round } = await bot.client
          .from("rounds_public")
          .select("id, artist_player_id")
          .eq("id", currentRoundId)
          .maybeSingle();
        if (round && round.artist_player_id === bot.playerId) {
          bot.hasActedThisRound = true;
          // Tiny delay so the human artist-prompt UI doesn't feel robotic.
          await sleep(1500 + Math.random() * 2500);
          await submitArtistPrompt(bot, currentRoundId, site);
        }
      }

      if (phase === "guessing" && currentRoundId && !bot.hasActedThisRound) {
        const { data: round } = await bot.client
          .from("rounds_public")
          .select("id, image_url")
          .eq("id", currentRoundId)
          .maybeSingle();
        if (round && round.image_url) {
          bot.hasActedThisRound = true;
          const msLeft = room.phase_ends_at
            ? new Date(room.phase_ends_at as string).getTime() - Date.now()
            : 30_000;
          // Wait 3–15s, but never within the last 2s of the timer.
          const maxWait = Math.max(0, Math.min(15_000, msLeft - 2000));
          const wait = Math.min(maxWait, 3000 + Math.random() * 12_000);
          await sleep(wait);
          await submitGuess(bot, currentRoundId);
        }
      }
    } catch (e) {
      console.warn(
        `[${bot.name}] loop error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

async function main() {
  const { code, n, site } = parseArgs();
  const names = shuffle(BOT_NAMES)
    .slice(0, n)
    .map((base, i) =>
      i < BOT_NAMES.length
        ? `🤖 ${base}`
        : `🤖 Bot ${Math.random().toString(36).slice(2, 6)}`,
    );
  console.log(`Spawning ${n} bots into ${code} (site=${site})`);
  let shutdown = false;
  process.on("SIGINT", () => {
    if (shutdown) process.exit(0);
    shutdown = true;
    console.log("\nShutting down...");
    setTimeout(() => process.exit(0), 500);
  });
  await Promise.all(names.map((name) => runBot(code, name, site)));
}

main();
