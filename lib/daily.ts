import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { authorPromptWithRoles, generateImagePng } from "@/lib/gemini";

export type DailyPromptRow = {
  date: string;
  image_url: string | null;
};

export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Ensure today's daily puzzle exists. Safe to call concurrently: a unique
// primary key on the date column means only one insert wins, and everyone
// else reads the winning row. Returns the persisted image_url (may still be
// null for the split-second between insert and image upload).
export async function ensureDailyPuzzle(
  svc: SupabaseClient<Database>,
  date: string = todayUtcDate(),
): Promise<DailyPromptRow> {
  const { data: existing } = await svc
    .from("daily_prompts")
    .select("date, image_url, image_storage_path")
    .eq("date", date)
    .maybeSingle();
  if (existing && existing.image_url) {
    return { date, image_url: existing.image_url };
  }

  // Claim the date slot first so concurrent callers don't both call Gemini.
  if (!existing) {
    const { error: insErr } = await svc
      .from("daily_prompts")
      .insert({ date, prompt: "" })
      .select("date")
      .single();
    // Conflict means someone else claimed it; we'll poll for their image.
    if (insErr && insErr.code !== "23505") throw insErr;
    if (insErr && insErr.code === "23505") {
      return await pollUntilReady(svc, date);
    }
  }

  const { prompt, tokens } = await authorPromptWithRoles([], "mixed");
  const pngBuffer = await generateImagePng(prompt);
  const storagePath = `daily/${date}.png`;

  const upload = await svc.storage
    .from("round-images")
    .upload(storagePath, pngBuffer, {
      contentType: "image/png",
      upsert: true,
    });
  if (upload.error) throw new Error("upload failed: " + upload.error.message);

  const { data: publicUrl } = svc.storage
    .from("round-images")
    .getPublicUrl(storagePath);

  await svc
    .from("daily_prompts")
    .update({
      prompt,
      image_url: publicUrl.publicUrl,
      image_storage_path: storagePath,
    })
    .eq("date", date);

  if (tokens.length > 0) {
    await svc.from("daily_prompt_tokens").insert(
      tokens.map((t, i) => ({
        date,
        position: i,
        token: t.token,
        role: t.role,
      })),
    );
  }

  return { date, image_url: publicUrl.publicUrl };
}

async function pollUntilReady(
  svc: SupabaseClient<Database>,
  date: string,
  timeoutMs = 45_000,
): Promise<DailyPromptRow> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data } = await svc
      .from("daily_prompts")
      .select("date, image_url")
      .eq("date", date)
      .maybeSingle();
    if (data?.image_url) return { date, image_url: data.image_url };
    await new Promise((r) => setTimeout(r, 750));
  }
  return { date, image_url: null };
}
