// Dimension pools for random scene generation. Five independent dimensions
// sampled per round. ~100M+ combos before LLM interpretation.

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

export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function sampleDimensions() {
  return {
    subject: pickRandom(SUBJECTS),
    setting: pickRandom(SETTINGS),
    action: pickRandom(ACTIONS),
    time: pickRandom(TIMES),
    style: pickRandom(STYLES),
  };
}
