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

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";

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

const CHAT_LINES = [
  "lol",
  "ok this one is hard",
  "anyone else seeing a duck",
  "wait what",
  "lmao",
  "i blame the artist",
  "smooth move",
  "good guess!!!",
  "nice",
  "bot army assemble",
  "fr fr",
  "sus",
  "this prompt is wild",
  "🤖🤖🤖",
  "skill issue",
  "i call shenanigans",
  "round of the century",
  "cant believe that worked",
  "GG",
  "next round next round",
  "spicy",
  "hold my taco",
  "vibes are immaculate",
  "10/10 would guess again",
  "is this real life",
  "speedrun this",
  "give me a hint pls",
  "no thoughts head empty",
  "🔥",
  "🎨",
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
  cursors: boolean;
  cursorHz: number;
  chat: boolean;
  chatIntervalMs: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let code: string | null = null;
  let n = 10;
  let site = "https://promptionary.io";
  let cursors = true;
  let cursorHz = 60;
  let chat = true;
  let chatIntervalMs = 45_000;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n" || a === "-n") {
      n = parseInt(argv[++i] ?? "10", 10);
    } else if (a === "--site") {
      site = argv[++i] ?? site;
    } else if (a === "--no-cursors") {
      cursors = false;
    } else if (a === "--cursors") {
      cursors = true;
    } else if (a === "--cursor-hz") {
      cursorHz = parseInt(argv[++i] ?? "60", 10);
    } else if (a === "--no-chat") {
      chat = false;
    } else if (a === "--chat") {
      chat = true;
    } else if (a === "--chat-interval") {
      // Mean per-bot interval in ms between messages. Each bot jitters ±50%
      // around this so 10 bots don't all post on the same tick.
      chatIntervalMs = parseInt(argv[++i] ?? "45000", 10);
    } else if (!code) {
      code = a;
    }
  }
  if (!code || !/^[A-Z]{4}$/i.test(code)) {
    console.error(
      "Usage: bun scripts/bots.ts <ROOM_CODE> [--n 10] [--site https://promptionary.io] [--no-cursors] [--cursor-hz 20] [--no-chat] [--chat-interval 8000]",
    );
    process.exit(1);
  }
  return {
    code: code.toUpperCase(),
    n,
    site,
    cursors,
    cursorHz,
    chat,
    chatIntervalMs,
  };
}

// Mirrors lib/player.ts colorForPlayer so bot cursors match the real chip color.
function colorForBot(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  }
  const hue = 220 + (Math.abs(h) % 140);
  return `hsl(${hue} 80% 65%)`;
}

interface BotState {
  name: string;
  client: SupabaseClient;
  playerId: string;
  accessToken: string;
  roomId: string;
  lastRoundId: string | null;
  hasActedThisRound: boolean;
  stopRealtime?: () => Promise<void>;
}

async function joinAsBot(code: string, name: string): Promise<BotState> {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Retry signInAnonymously on Supabase's "Request rate limit reached".
  // Free-tier anon auth caps requests/sec; the staggered launch in main()
  // helps but a single 429 burst can still happen if a previous batch is
  // still cooling down.
  let auth: Awaited<ReturnType<typeof client.auth.signInAnonymously>>["data"] | null = null;
  let lastErr: { message?: string } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await client.auth.signInAnonymously();
    if (res.data?.session && res.data?.user) {
      auth = res.data;
      lastErr = null;
      break;
    }
    lastErr = res.error;
    if (!res.error?.message?.toLowerCase().includes("rate limit")) break;
    // Exponential backoff with jitter: 1.5s, 3.5s, 7s
    const wait = 1500 * Math.pow(2, attempt) + Math.random() * 1000;
    await sleep(wait);
  }
  if (!auth?.session || !auth?.user) {
    throw new Error(`[${name}] sign-in failed: ${lastErr?.message}`);
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

async function postChatMessage(
  bot: BotState,
  channel: RealtimeChannel,
): Promise<void> {
  const content = pick(CHAT_LINES);
  const { error } = await bot.client.rpc("post_message", {
    p_room_id: bot.roomId,
    p_content: content,
  });
  if (error) {
    console.warn(`[${bot.name}] chat send failed: ${error.message}`);
    return;
  }
  // Mirror chat-panel.tsx: fetch the just-inserted row and broadcast it on
  // the live channel so other clients see it immediately instead of waiting
  // for their 2s poll.
  const { data: latest } = await bot.client
    .from("room_messages")
    .select("*")
    .eq("room_id", bot.roomId)
    .is("team", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest) {
    void channel.send({
      type: "broadcast",
      event: "chat",
      payload: latest,
    });
  }
  console.log(`[${bot.name}] 💬 ${content}`);
}

// Open a single live-channel per bot and run the cursor + chat loops on it,
// matching what real clients do (cursors at ~20Hz on `cursor`, chat via
// post_message RPC + `chat` broadcast). Returns one stop fn that tears
// down both timers and the channel.
async function startBotRealtime(
  bot: BotState,
  opts: { cursors: boolean; cursorHz: number; chat: boolean; chatIntervalMs: number },
): Promise<() => Promise<void>> {
  bot.client.realtime.setAuth(bot.accessToken);
  const channel: RealtimeChannel = bot.client.channel(
    `room-${bot.roomId}-live`,
    { config: { broadcast: { self: false } } },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("realtime channel subscribe timeout")),
      10_000,
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  let cursorInterval: ReturnType<typeof setInterval> | null = null;
  if (opts.cursors) {
    const color = colorForBot(bot.playerId);
    // Cover roughly a 1600x900 viewport — wider than typical 1280x720 so
    // cursors hit the edges, headers, sidebars, not just the center.
    const VW = 1600;
    const VH = 900;
    const randX = () => Math.random() * VW;
    const randY = () => Math.random() * VH;
    let curX = randX();
    let curY = randY();
    let tgtX = randX();
    let tgtY = randY();
    let nextRetargetAt = Date.now() + 600 + Math.random() * 1400;
    // Per-tick easing — fraction of remaining distance to close each frame.
    // 0.06 at 60Hz converges in ~30 frames (~500ms), which feels lively but
    // not jerky. Lower this for more momentum, higher for snappier motion.
    const easing = 0.06;
    const intervalMs = Math.max(16, Math.floor(1000 / Math.max(1, opts.cursorHz)));
    cursorInterval = setInterval(() => {
      // Re-pick a random target periodically so the cursor wanders across
      // the whole page instead of orbiting one spot.
      if (Date.now() >= nextRetargetAt) {
        tgtX = randX();
        tgtY = randY();
        nextRetargetAt = Date.now() + 600 + Math.random() * 1400;
      }
      curX += (tgtX - curX) * easing;
      curY += (tgtY - curY) * easing;
      void channel.send({
        type: "broadcast",
        event: "cursor",
        payload: {
          id: bot.playerId,
          name: bot.name,
          color,
          x: Math.round(curX),
          y: Math.round(curY),
        },
      });
    }, intervalMs);
  }

  let chatTimer: ReturnType<typeof setTimeout> | null = null;
  if (opts.chat) {
    const scheduleNext = () => {
      // Jitter ±50% so 10 bots don't all post on the exact same tick.
      const wait = opts.chatIntervalMs * (0.5 + Math.random());
      chatTimer = setTimeout(async () => {
        try {
          await postChatMessage(bot, channel);
        } catch (e) {
          console.warn(
            `[${bot.name}] chat threw: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        scheduleNext();
      }, wait);
    };
    scheduleNext();
  }

  return async () => {
    if (cursorInterval) clearInterval(cursorInterval);
    if (chatTimer) clearTimeout(chatTimer);
    try {
      await channel.send({
        type: "broadcast",
        event: "cursor:leave",
        payload: { id: bot.playerId },
      });
    } catch {
      // best-effort
    }
    await bot.client.removeChannel(channel);
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

async function runBot(
  code: string,
  name: string,
  site: string,
  realtimeOpts: {
    cursors: boolean;
    cursorHz: number;
    chat: boolean;
    chatIntervalMs: number;
  },
  stopFns: Array<() => Promise<void>>,
): Promise<void> {
  let bot: BotState;
  try {
    bot = await joinAsBot(code, name);
    console.log(`[${name}] joined room ${code}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return;
  }

  if (realtimeOpts.cursors || realtimeOpts.chat) {
    try {
      bot.stopRealtime = await startBotRealtime(bot, realtimeOpts);
      stopFns.push(bot.stopRealtime);
      const tags: string[] = [];
      if (realtimeOpts.cursors) tags.push(`🖱️ ${realtimeOpts.cursorHz}Hz`);
      if (realtimeOpts.chat)
        tags.push(`💬 every ~${realtimeOpts.chatIntervalMs}ms`);
      console.log(`[${name}] realtime: ${tags.join(", ")}`);
    } catch (e) {
      console.warn(
        `[${name}] realtime setup failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  while (true) {
    await sleep(2000);
    try {
      const { data: room, error: roomErr } = await bot.client
        .from("rooms")
        .select("id, phase, phase_ends_at, round_num")
        .eq("id", bot.roomId)
        .maybeSingle();
      if (roomErr || !room) continue;

      const phase = room.phase as string;
      const roundNum = (room.round_num as number) ?? 0;
      if (roundNum < 1) continue; // still in lobby

      // Pull round directly (not rounds_public) so artist_player_id is always
      // present regardless of phase. Matches the fallback in game-client.tsx.
      const { data: round } = await bot.client
        .from("rounds")
        .select("id, artist_player_id, image_url")
        .eq("room_id", bot.roomId)
        .eq("round_num", roundNum)
        .maybeSingle();
      if (!round) continue;

      const roundId = round.id as string;
      if (roundId !== bot.lastRoundId) {
        bot.lastRoundId = roundId;
        bot.hasActedThisRound = false;
      }

      if (
        phase === "prompting" &&
        round.artist_player_id === bot.playerId &&
        !bot.hasActedThisRound
      ) {
        bot.hasActedThisRound = true;
        // Tiny delay so the human artist-prompt UI doesn't feel robotic.
        await sleep(1500 + Math.random() * 2500);
        await submitArtistPrompt(bot, roundId, site);
      }

      if (phase === "guessing" && round.image_url && !bot.hasActedThisRound) {
        bot.hasActedThisRound = true;
        const msLeft = room.phase_ends_at
          ? new Date(room.phase_ends_at as string).getTime() - Date.now()
          : 30_000;
        // Wait 3–15s, but never within the last 2s of the timer.
        const maxWait = Math.max(0, Math.min(15_000, msLeft - 2000));
        const wait = Math.min(maxWait, 3000 + Math.random() * 12_000);
        await sleep(wait);
        await submitGuess(bot, roundId);
      }
    } catch (e) {
      console.warn(
        `[${bot.name}] loop error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

async function main() {
  const { code, n, site, cursors, cursorHz, chat, chatIntervalMs } = parseArgs();
  const names = shuffle(BOT_NAMES)
    .slice(0, n)
    .map((base, i) =>
      i < BOT_NAMES.length
        ? `🤖 ${base}`
        : `🤖 Bot ${Math.random().toString(36).slice(2, 6)}`,
    );
  console.log(
    `Spawning ${n} bots into ${code} (site=${site}, cursors=${cursors ? `on @ ${cursorHz}Hz` : "off"}, chat=${chat ? `on @ ~${chatIntervalMs}ms` : "off"})`,
  );
  const stopFns: Array<() => Promise<void>> = [];
  let shutdown = false;
  process.on("SIGINT", () => {
    if (shutdown) process.exit(0);
    shutdown = true;
    console.log("\nShutting down...");
    void Promise.allSettled(stopFns.map((s) => s())).finally(() => {
      setTimeout(() => process.exit(0), 200);
    });
    setTimeout(() => process.exit(0), 1500);
  });
  // Stagger sign-ins by 400ms each. Supabase's free-tier anon-auth limit
  // trips when 10 parallel signInAnonymously calls land in the same second
  // (AGENTS.md flags this for >3 parallel workers). Spreading them over
  // ~4s keeps everyone under the threshold; bots run concurrently after.
  await Promise.all(
    names.map(async (name, i) => {
      await sleep(i * 400);
      return runBot(
        code,
        name,
        site,
        { cursors, cursorHz, chat, chatIntervalMs },
        stopFns,
      );
    }),
  );
}

main();
