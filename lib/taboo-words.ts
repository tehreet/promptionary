// Taboo word pool — the 3-word forbidden list is sampled from here when
// an artist-mode round starts and rooms.taboo_enabled is on. Kept SFW and
// party-friendly: everyday nouns, colors, animals, actions, adjectives —
// stuff that naturally shows up in short prompts, so players have to
// reach for a synonym or describe around it.
//
// Matching is case-insensitive substring via simple regex in
// /api/submit-artist-prompt; words are deliberately short so the
// substring match stays intuitive (e.g. 'cat' catches 'catty' too —
// that's desired, it forces a rewrite).
//
// Sample via pickTabooWords(3) in the start-round flow.

export const TABOO_POOL: string[] = [
  // colors
  "red", "orange", "yellow", "green", "blue", "purple", "pink", "black",
  "white", "gray", "brown", "gold", "silver", "neon", "rainbow", "pastel",
  // animals
  "cat", "dog", "bird", "fish", "horse", "cow", "pig", "sheep", "goat",
  "bear", "fox", "wolf", "lion", "tiger", "elephant", "monkey", "rabbit",
  "deer", "owl", "eagle", "shark", "whale", "dolphin", "octopus", "snake",
  "frog", "turtle", "bee", "butterfly", "dragon", "unicorn", "dinosaur",
  // people / professions
  "child", "baby", "kid", "mom", "dad", "chef", "wizard", "knight",
  "pirate", "robot", "ghost", "alien", "witch", "king", "queen", "doctor",
  // places / structures
  "house", "castle", "city", "forest", "ocean", "beach", "mountain",
  "desert", "river", "lake", "island", "cave", "temple", "bridge",
  "tower", "garden", "park", "kitchen", "bedroom", "library", "school",
  "farm", "church", "shop", "museum",
  // vehicles
  "car", "truck", "bike", "boat", "ship", "plane", "train", "rocket",
  "spaceship", "submarine", "balloon",
  // nature / weather
  "tree", "flower", "grass", "cloud", "rain", "snow", "sun", "moon",
  "star", "fire", "water", "lightning", "rainbow", "fog",
  // food
  "pizza", "cake", "bread", "cheese", "apple", "banana", "coffee",
  "tea", "cookie", "donut", "burger", "soup", "ice", "cream", "honey",
  // objects
  "book", "hat", "shoe", "umbrella", "clock", "lamp", "phone", "camera",
  "sword", "shield", "crown", "key", "mirror", "window", "door", "chair",
  "guitar", "piano", "drum", "ball", "box",
  // actions / verbs
  "run", "walk", "jump", "fly", "swim", "dance", "sing", "sleep",
  "eat", "drink", "laugh", "cry", "fight", "hug", "kiss", "throw",
  "ride", "climb", "fall", "read", "write", "paint", "cook", "play",
  // adjectives
  "big", "small", "tall", "tiny", "giant", "huge", "old", "young",
  "happy", "sad", "angry", "sleepy", "hungry", "cute", "scary", "pretty",
  "bright", "dark", "shiny", "fluffy", "wet", "dry", "hot", "cold",
  "fast", "slow", "loud", "quiet", "sharp", "soft",
  // styles / media
  "watercolor", "cartoon", "photo", "sketch", "pixel", "anime",
  // time
  "morning", "noon", "evening", "night", "sunset", "sunrise", "midnight",
];

/**
 * Pick N distinct words from the TABOO_POOL. If N > pool size (shouldn't
 * happen but defensive), returns the full pool. Uses Math.random which is
 * fine here — we don't need cryptographic fairness.
 */
export function pickTabooWords(n: number = 3): string[] {
  const count = Math.min(n, TABOO_POOL.length);
  const used = new Set<number>();
  const picks: string[] = [];
  while (picks.length < count) {
    const i = Math.floor(Math.random() * TABOO_POOL.length);
    if (used.has(i)) continue;
    used.add(i);
    picks.push(TABOO_POOL[i]!);
  }
  return picks;
}

/**
 * Returns the first banned word found in `prompt` (case-insensitive
 * substring match), or null if the prompt is clean.
 *
 * Matching is substring rather than word-boundary on purpose: if the
 * banned word is "cat" we want "category" to also fail. Forces the
 * artist to reach further for synonyms and keeps the client-side live
 * validation trivial (no regex escaping needed on the hot path).
 */
export function findTabooHit(
  prompt: string,
  words: readonly string[],
): string | null {
  const hay = prompt.toLowerCase();
  for (const w of words) {
    if (!w) continue;
    if (hay.includes(w.toLowerCase())) return w;
  }
  return null;
}
