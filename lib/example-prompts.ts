// Whimsical example prompts used as rotating placeholder text in the artist
// textarea. Seeded by round id so every client in a room sees the same one —
// feels intentional, not per-user random.

export const EXAMPLE_PROMPTS: string[] = [
  "a corgi astronaut on Mars",
  "a ramen shop under the sea",
  "a cyberpunk frog lawyer in court",
  "a Roman emperor at a skate park",
  "a raccoon delivering mail by bicycle at dusk",
  "a tiny dragon brewing espresso",
  "a wizard DJing a mountain rave",
  "a pirate cat captaining a paper boat",
  "a robot gardener tending neon tulips",
  "a medieval knight ordering boba",
  "a disco-ball moon over a 70s diner",
  "a squirrel tax accountant at crunch time",
  "an opera-singing octopus in a top hat",
  "a samurai bunny in a bamboo forest at dawn",
  "a haunted ice cream truck on a foggy pier",
  "a librarian owl with way too many scrolls",
  "a T-rex attempting a yoga pose",
  "a sleepy volcano wearing a scarf",
  "a ghost barista pulling a latte shot",
  "a retro sci-fi diner on a floating asteroid",
  "a steampunk hedgehog inventor in her workshop",
  "a penguin mailroom hustling through a blizzard",
  "a neon koi fish glitching through a puddle",
  "a cottagecore fox baking sourdough",
  "an art deco tiger riding a gondola in Venice",
  "a synthwave sunset behind a drive-thru taco stand",
  "a bear detective solving a picnic mystery",
  "a sentient lamp performing stand-up comedy",
  "a Viking longship crewed entirely by geese",
  "a 90s mall food court during a zombie outbreak",
  "a magical mailbox spitting out glowing letters",
  "a hot-air balloon race over rainbow canyons",
];

// Deterministic 32-bit FNV-1a hash so seeding on the round id yields the same
// placeholder on every client. Anything cheap and stable works here — the
// round id is already a uuid, but we don't want to rely on its shape.
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    // 32-bit FNV prime multiply, kept within Math.imul's range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned.
  return hash >>> 0;
}

export function pickExamplePrompt(seed: string): string {
  if (EXAMPLE_PROMPTS.length === 0) return "";
  if (!seed) return EXAMPLE_PROMPTS[0];
  const idx = hashSeed(seed) % EXAMPLE_PROMPTS.length;
  return EXAMPLE_PROMPTS[idx];
}
