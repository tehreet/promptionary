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
