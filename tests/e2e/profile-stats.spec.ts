import { test, expect, request as pwRequest } from "@playwright/test";

// Hits the Supabase Management SQL API so we can seed a real auth.users row
// (triggers handle_new_user → profile row with a handle) and then bump its
// stats. Tests run against prod, so we fully clean up after.
async function sql(query: string) {
  const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
  const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "cuevgbducxnbdslbhlxe";
  if (!ACCESS_TOKEN) {
    test.skip(true, "SUPABASE_ACCESS_TOKEN not set — skipping seeded tests");
  }
  const api = await pwRequest.newContext();
  const res = await api.post(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: { query },
    },
  );
  if (!res.ok()) {
    throw new Error(`sql failed ${res.status()}: ${await res.text()}`);
  }
  return res.json();
}

test("public profile: /u/nonexistent returns 404", async ({ page }) => {
  test.setTimeout(30_000);
  const res = await page.goto("/u/definitely-not-a-real-handle-xyzzy-42");
  expect(res?.status()).toBe(404);
});

test("public profile: seeded handle renders stats card", async () => {
  test.setTimeout(60_000);
  const stamp = Date.now().toString(36);
  const email = `probe-stats-${stamp}@example.invalid`;
  const displayName = `Probe${stamp}`.slice(0, 24);

  // 1. Create a real auth user (Supabase trigger creates the profile row
  //    via handle_new_user, which also runs ensure_profile_handle).
  await sql(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_user_meta_data, raw_app_meta_data,
      is_anonymous, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      '${email}',
      '',
      now(),
      jsonb_build_object('full_name', '${displayName}'),
      '{}'::jsonb,
      false,
      now(),
      now()
    );
  `);

  // 2. Look up the profile that trigger created and bump its stats.
  const [{ id, handle }] = (
    await sql(`select id, handle from profiles where display_name = '${displayName}' order by created_at desc limit 1;`)
  ) as Array<{ id: string; handle: string }>;

  await sql(`
    update profiles
      set games_played = 7,
          games_won = 3,
          rounds_played = 21,
          total_score = 842,
          best_round_score = 96,
          daily_streak = 4,
          daily_longest_streak = 9
      where id = '${id}';
  `);

  try {
    const api = await pwRequest.newContext();
    const page = await api.newContext();
    void page;
    // Easier: use a fresh Playwright page.
    const browserApi = await pwRequest.newContext({
      baseURL: process.env.PROMPTIONARY_TEST_URL ?? "https://promptionary-three.vercel.app",
    });
    const res = await browserApi.get(`/u/${handle}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain(displayName);
    expect(html).toContain(`@${handle}`);
    expect(html).toContain("Lifetime stats");
    // Spot-check a couple of stat values we seeded.
    expect(html).toContain("842"); // total_score
    expect(html).toContain("96"); // best_round_score
    expect(html).toContain("4🔥"); // daily_streak
  } finally {
    // Cascade-deletes the profile row via FK on profiles.id.
    await sql(`delete from auth.users where id = '${id}';`);
  }
});
