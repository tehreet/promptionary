import { authorPromptWithRoles } from "../lib/gemini";
const results = await Promise.all([...Array(6)].map(() => authorPromptWithRoles()));
for (const r of results) console.log("-", r.prompt);
