const ADJECTIVES = [
  "Vivid", "Chonky", "Glitchy", "Neon", "Cosmic", "Loud", "Spicy", "Witty",
  "Frosty", "Plush", "Zesty", "Moody", "Prismatic", "Feral", "Gentle",
];
const ANIMALS = [
  "Otter", "Axolotl", "Capybara", "Narwhal", "Gecko", "Raven", "Manatee",
  "Lynx", "Puffin", "Shrew", "Quokka", "Tapir", "Ibex", "Okapi",
];

export function randomDisplayName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a}${b}`;
}

export function colorForPlayer(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  const hue = 220 + (Math.abs(h) % 140);
  return `hsl(${hue} 80% 65%)`;
}

// HSL(h, s, l) in 0..1 → sRGB 0..1
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hueToRgb(h + 1 / 3), hueToRgb(h), hueToRgb(h - 1 / 3)];
}

// WCAG relative luminance from sRGB 0..1
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Returns both the chip background and a contrasting ink color for the
 * player. `ink` is picked to stay legible regardless of theme, since the
 * random-hue background doesn't know about light/dark mode.
 */
export function chipColorsForPlayer(id: string): { bg: string; ink: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  const hue = 220 + (Math.abs(h) % 140);
  const bg = `hsl(${hue} 80% 65%)`;
  const lum = relativeLuminance(hslToRgb(hue / 360, 0.8, 0.65));
  // WCAG-ish: luminance > ~0.45 needs dark text, else cream. The hue band is
  // all fairly light (L=65%), so most chips fall on the dark-text side.
  const ink = lum > 0.45 ? "#1e1b4d" : "#fff7d6";
  return { bg, ink };
}
