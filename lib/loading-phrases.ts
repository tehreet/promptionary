// Fun, game-themed phrases that cycle on every client during the generating
// phase. Keep them short — one line, under ~40 chars — so they fit on mobile.

export const LOADING_PHRASES = [
  "Mixing pigments…",
  "Consulting the muses…",
  "Squinting at the subject…",
  "Brushing on highlights…",
  "Debating the mood…",
  "Second-guessing the style…",
  "Deciding if this needs more birds…",
  "Sharpening a charcoal stick…",
  "Stretching a tiny canvas…",
  "Arguing with the pigments…",
  "Fixing the horizon line…",
  "Adding dramatic lighting…",
  "Blurring the background just right…",
  "Googling 'how to draw hands'…",
  "Re-centering the vibe…",
  "Whispering to the raccoons…",
  "Finding the perfect beige…",
  "Summoning golden hour…",
  "Negotiating with the goose…",
  "Thinning the varnish…",
  "Trying a bolder palette…",
  "Dusting off an old brush…",
  "Deciding how much fog…",
  "Teaching the sun to behave…",
  "Composing by the rule of thirds…",
  "Letting the shadows breathe…",
  "Chasing that one missing detail…",
  "Re-doing the eyes…",
  "Asking the cat for feedback…",
  "Warming up the reds…",
  "Double-checking the moon phase…",
  "Rendering one more raincloud…",
];

export function pickPhraseIndex(seed: string | number, n: number = LOADING_PHRASES.length): number {
  // Lightweight hash so all clients seeded with the same round id start on
  // the same phrase, then drift independently. Prevents everyone looking at
  // the exact same word in sync (boring) while still starting together.
  let h = typeof seed === "number" ? seed : 0;
  if (typeof seed === "string") {
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % n;
}
