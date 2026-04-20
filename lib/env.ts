import { z } from "zod";

// Trim surrounding whitespace/newlines from secrets. A trailing "\n" on the
// anon key silently broke prod realtime — Supabase URL-encoded it as "%0A"
// in the WebSocket apikey query param and returned "HTTP Authentication
// failed; no valid credentials available", killing cursor/reaction
// broadcasts. See #81.
const secret = () => z.string().trim().min(1);

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: secret(),
  SUPABASE_SERVICE_ROLE_KEY: secret(),
  GOOGLE_GENAI_API_KEY: secret(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: secret(),
});

export const serverEnv =
  typeof window === "undefined" ? serverSchema.parse(process.env) : null;

export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
