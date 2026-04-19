// Dimension pools for random scene generation. Five independent dimensions
// sampled per round. ~100M+ combos before LLM interpretation.

export type PackId = "mixed" | "food" | "wildlife" | "history" | "absurd";

export const SUBJECTS = [
  // animals
  "a river otter", "a corgi", "a pigeon", "a sloth", "a manatee", "a peacock",
  "a chameleon", "a capybara", "a narwhal", "a raccoon", "a fox", "an owl",
  "a honeybee", "a hermit crab", "a moose", "a goldfish", "a panda", "a hedgehog",
  "a cardinal", "an octopus", "a flamingo", "a badger", "a hummingbird", "a llama",
  // people / professions
  "a grandmother", "a toddler", "a barista", "a librarian", "a mechanic",
  "a cellist", "a beekeeper", "a postal carrier", "a pastry chef", "a surgeon",
  "a lighthouse keeper", "a tailor", "a farmhand", "a cartographer", "a ballerina",
  "a chess coach", "a welder", "a taxidermist", "a locksmith", "a potter",
  "two best friends", "a book club", "a construction crew", "a wedding party",
  "a scout troop", "a high school marching band", "a knitting circle",
  // mythic / whimsical
  "a sleepy dragon", "a forgetful wizard", "a shy mermaid", "a grumpy troll",
  "a dapper skeleton", "a moonlit fox-spirit", "a teenage golem",
  // objects that become characters
  "a battered kettle", "a singing toaster", "a library card", "an abandoned typewriter",
  "a weathered compass", "a cracked teacup",
  // plant / nature
  "an ancient oak", "a field of sunflowers", "a patch of moss", "a mushroom cluster",
  "a thunderhead cloud", "a flock of starlings", "a tide pool",
  // mini-events
  "a birthday candle", "a chess endgame", "a surprise gift", "a shared umbrella",
  "a lost mitten", "a rescue mission", "a bake sale", "a campfire sing-along",
  "a parade float", "a midnight snack", "a book signing", "a town-hall debate",
];

export const SETTINGS = [
  "a cozy cabin", "a bustling farmer's market", "a bakery at opening hour",
  "an old bookstore", "a subway platform", "a rooftop at dusk", "a coral reef",
  "a snowy ridge", "a meadow at noon", "a tidepool", "a lighthouse balcony",
  "a train car", "a gondola", "an attic workshop", "a boxing gym",
  "a tea house", "a ballroom", "a potter's studio", "a planetarium",
  "a community garden", "a mountain trail", "a harvest field", "a library stacks",
  "a drive-in theater", "a laundromat at midnight", "a hedge maze",
  "a greenhouse", "a soup kitchen", "a food truck window", "a barber shop",
  "a public pool", "an ice rink", "a mossy cathedral", "a fisherman's dock",
  "a record store", "a stadium tunnel", "a hotel lobby", "a sauna",
  "a hot-air balloon basket", "a wildflower field", "a secret garden",
  "an empty highway at dawn", "a noodle shop", "a clocktower", "a desert oasis",
  "a river bend", "a birthday kitchen", "a dusty archive", "a cliffside monastery",
  "a marsh at twilight", "a bamboo grove",
];

export const ACTIONS = [
  "napping", "arguing playfully", "sharing a secret", "learning to knit",
  "waiting in line", "mid-leap", "sneezing", "blowing out candles",
  "braiding hair", "rolling dough", "reading a letter", "whispering",
  "tying a shoe", "dancing slowly", "playing cards", "feeding ducks",
  "teaching a puppy", "building a fort", "watching fireworks",
  "mid-trust-fall", "taking a group photo", "stargazing", "signing a book",
  "juggling", "unpacking groceries", "folding laundry", "crying happy tears",
  "opening a letter", "planting a seed", "winning at chess", "napping against a tree",
  "watering plants", "scoring a goal", "painting a mural", "baking a pie",
  "lost in thought", "saying goodbye", "hiding from rain", "doing the crossword",
  "chopping vegetables", "wrapping a gift", "trying on hats", "tossing confetti",
  "doing yoga", "singing loudly", "sipping tea carefully", "writing a postcard",
  "assembling a kite", "eating noodles", "listening to a record",
];

export const TIMES = [
  "at golden hour", "in a thunderstorm", "on a snow day",
  "on the first warm morning of spring", "under a full moon",
  "at 3 a.m.", "during a power outage", "in the middle of a blizzard",
  "just after sunset", "during autumn leaves falling", "in a fog bank",
  "under string lights", "in early morning mist", "after the last bus home",
  "on new year's eve", "during the first snowfall", "on a rainy sunday",
  "during an eclipse", "at the height of summer", "on a bright windy day",
  "in the blue hour", "during a meteor shower", "on a thawing afternoon",
  "while the kettle sings", "as a storm breaks",
];

export const STYLES = [
  "soft watercolor", "oil-on-canvas impressionist", "ink wash",
  "Studio Ghibli anime", "Wes Anderson film still", "Renaissance fresco",
  "charcoal sketch", "linocut print", "stained-glass", "tilt-shift miniature photo",
  "1970s vintage postcard", "claymation still", "pastel crayon",
  "golden-hour photograph", "mosaic", "children's storybook illustration",
  "Norman Rockwell painting", "Dutch Golden Age still life", "gouache illustration",
  "pencil line drawing", "risograph poster", "screen print",
  "Moebius comic panel", "Saul Bass cut-paper poster", "block print",
  "sumi-e brushwork", "pointillist dots", "Art Deco travel poster",
  "1920s newspaper illustration", "fabric cross-stitch",
];

// Curated per-pack subject/setting pools. Action/time/style pools stay shared
// so packs stay expressive without reinventing the authoring surface.

const FOOD_SUBJECTS = [
  "a pastry chef", "a barista", "a line cook", "a tea sommelier",
  "a grandmother at the stove", "a sushi master", "a bread baker",
  "a dumpling auntie", "a pizza apprentice", "a lemonade kid",
  "a farmer at a market stall", "a hot-dog vendor", "a brunch crew",
  "a cracked teacup", "a battered kettle", "a singing toaster",
  "a basket of peaches", "a stack of pancakes", "a wheel of parmesan",
  "a birthday cake", "a bowl of ramen", "a jar of honey",
];

const FOOD_SETTINGS = [
  "a bakery at opening hour", "a noodle shop", "a tea house",
  "a bustling farmer's market", "a food truck window", "a birthday kitchen",
  "a soup kitchen", "a dim sum cart", "a harvest field",
  "a tiny trattoria", "a pizzeria back kitchen", "a sushi counter at closing",
  "a roadside jam stand", "a greenhouse brimming with herbs",
  "a community garden", "a rooftop at dusk",
];

const WILDLIFE_SUBJECTS = [
  "a river otter", "a sloth", "a manatee", "a peacock", "a chameleon",
  "a capybara", "a narwhal", "a raccoon", "a fox", "an owl",
  "a honeybee", "a hermit crab", "a moose", "a panda", "a hedgehog",
  "a cardinal", "an octopus", "a flamingo", "a badger", "a hummingbird",
  "a llama", "a mongoose", "a pangolin", "a red panda", "a barn swallow",
  "a pod of dolphins", "a flock of starlings", "a herd of bison",
];

const WILDLIFE_SETTINGS = [
  "a coral reef", "a tidepool", "a mountain trail", "a wildflower field",
  "a bamboo grove", "a marsh at twilight", "a misty forest floor",
  "a river bend", "an alpine meadow", "a prairie at dawn",
  "a mangrove inlet", "a canyon rim", "a kelp forest",
  "a sunlit savanna", "a frozen tundra", "a cloud forest",
];

const HISTORY_SUBJECTS = [
  "a medieval cartographer", "a Renaissance painter at her easel",
  "a Roman centurion on leave", "a Victorian botanist", "a Tang dynasty poet",
  "a WWI field nurse", "a 1920s jazz trumpeter", "a Greek chorus",
  "a pharaoh's scribe", "a Byzantine mosaicist", "a medieval monk",
  "a 1960s astronaut in training", "a Shakespearean fool",
  "a Silk Road merchant", "a Prohibition-era speakeasy bartender",
  "a frontier photographer", "a samurai between battles",
  "a court alchemist", "an Edwardian librarian",
];

const HISTORY_SETTINGS = [
  "a mossy cathedral", "a cliffside monastery", "a dusty archive",
  "an Art Deco ballroom", "a candlelit scriptorium", "a Roman bathhouse",
  "a gas-lit pub", "a colonial mapmaker's studio", "an Edwardian parlor",
  "a medieval marketplace", "a Tang dynasty teahouse", "a Prohibition speakeasy",
  "a 1920s newsroom", "a temple at dusk", "a harbor of tall ships",
  "a pyramid antechamber", "a Silk Road caravanserai",
];

const ABSURD_SUBJECTS = [
  "a sleepy dragon", "a forgetful wizard", "a shy mermaid",
  "a grumpy troll", "a dapper skeleton", "a moonlit fox-spirit",
  "a teenage golem", "a singing toaster", "an abandoned typewriter",
  "a library card with ambitions", "a philosophical mop",
  "a committee of crows", "a retired carousel horse",
  "a ghost still paying rent", "a nervous tooth fairy",
  "a Bigfoot on laundry day", "a yeti at a DMV", "a kraken learning piano",
  "a time-traveling pigeon", "a moon in therapy",
];

const ABSURD_SETTINGS = [
  "an upside-down diner", "a cloud-city bus stop", "a kraken-sized swimming pool",
  "a living hedge maze", "a library that rearranges itself",
  "a thrift shop between dimensions", "a midnight post office for ghosts",
  "a spaceship laundromat", "a floating island market",
  "a greenhouse on the moon", "a bureaucracy for weather",
  "a pocket-universe arcade", "a DMV for mythological creatures",
  "a talking revolving door", "a bathtub adrift at sea",
];

type Pool = { subjects: readonly string[]; settings: readonly string[] };

const POOLS: Record<PackId, Pool> = {
  mixed: { subjects: SUBJECTS, settings: SETTINGS },
  food: { subjects: FOOD_SUBJECTS, settings: FOOD_SETTINGS },
  wildlife: { subjects: WILDLIFE_SUBJECTS, settings: WILDLIFE_SETTINGS },
  history: { subjects: HISTORY_SUBJECTS, settings: HISTORY_SETTINGS },
  absurd: { subjects: ABSURD_SUBJECTS, settings: ABSURD_SETTINGS },
};

export const PACK_LABELS: Record<PackId, { title: string; blurb: string; emoji: string }> = {
  mixed: { title: "Mixed", blurb: "A bit of everything", emoji: "🎲" },
  food: { title: "Food", blurb: "Kitchens, feasts, cravings", emoji: "🍜" },
  wildlife: { title: "Wildlife", blurb: "Critters in their element", emoji: "🦦" },
  history: { title: "History", blurb: "Figures and places through time", emoji: "📜" },
  absurd: { title: "Absurd", blurb: "Surreal and silly", emoji: "🎩" },
};

export const PACK_IDS: PackId[] = ["mixed", "food", "wildlife", "history", "absurd"];

export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function sampleDimensions(opts: { pack?: PackId } = {}) {
  const pack = opts.pack && POOLS[opts.pack] ? opts.pack : "mixed";
  const pool = POOLS[pack];
  return {
    subject: pickRandom(pool.subjects),
    setting: pickRandom(pool.settings),
    action: pickRandom(ACTIONS),
    time: pickRandom(TIMES),
    style: pickRandom(STYLES),
  };
}
