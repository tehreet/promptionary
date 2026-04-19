import { authorPromptWithRoles } from "../lib/gemini";

const previous: string[] = [];
for (let i = 0; i < 8; i++) {
  const r = await authorPromptWithRoles(previous);
  console.log(`${i + 1}. ${r.prompt}`);
  previous.push(r.prompt);
  if (previous.length > 5) previous.shift();
}
