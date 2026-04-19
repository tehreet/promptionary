import { test, expect, request as pwRequest } from "@playwright/test";

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

test("/leaders renders three boards + a seeded profile shows up", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const stamp = Date.now().toString(36);
  const email = `probe-leaders-${stamp}@example.invalid`;
  const displayName = `Champ${stamp}`.slice(0, 24);

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

  const [{ id }] = (await sql(
    `select id from profiles where display_name = '${displayName}' order by created_at desc limit 1;`,
  )) as Array<{ id: string }>;

  // Inflate scores past any plausible real player so the seeded row lands
  // in the top of every board without flakiness around concurrent players.
  await sql(`
    update profiles
      set total_score = 99999999,
          games_won = 99999,
          daily_longest_streak = 9999
      where id = '${id}';
  `);

  try {
    await page.goto("/leaders");
    await expect(page.getByRole("heading", { name: "Leaders" })).toBeVisible();

    const boards = page.locator('[data-board]');
    await expect(boards).toHaveCount(3);

    await expect(page.locator('[data-board="total_score"]')).toContainText(
      displayName,
    );
    await expect(page.locator('[data-board="games_won"]')).toContainText(
      displayName,
    );
    await expect(
      page.locator('[data-board="daily_longest_streak"]'),
    ).toContainText(displayName);

    // The seeded row should be rank #1 somewhere (its score outranks real users).
    await expect(page.locator('[data-leader-row="1"]').first()).toBeVisible();
  } finally {
    await sql(`delete from auth.users where id = '${id}';`);
  }
});

test("home page links to /leaders", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/");
  const cta = page.locator('[data-leaders-cta="1"]');
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/\/leaders$/);
});
