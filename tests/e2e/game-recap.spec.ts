import { test, expect, request as pwRequest } from "@playwright/test";

// Seeds a finished game (room in game_over with two ended rounds + guesses +
// prompt tokens + players), then fetches /play/<code>/recap and asserts every
// round's prompt text + the winner are rendered. Mirrors share-round.spec.ts
// (same Management-API SQL bridge pattern). Tests run against prod.
async function sql(query: string) {
  const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
  const PROJECT_REF =
    process.env.SUPABASE_PROJECT_REF ?? "cuevgbducxnbdslbhlxe";
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

function stamp() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function randomRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTVWXYZ";
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += letters[Math.floor(Math.random() * letters.length)];
  }
  return out;
}

function baseUrl() {
  return (
    process.env.PROMPTIONARY_TEST_URL ??
    "https://promptionary-three.vercel.app"
  );
}

test("game recap: /play/<code>/recap renders finished game with every round + winner", async () => {
  test.setTimeout(60_000);

  const s = stamp();
  const code = randomRoomCode();
  const hostEmail = `recap-host-${s}@example.invalid`;
  const guesserEmail = `recap-guesser-${s}@example.invalid`;
  const hostName = `RecapHost${s}`.slice(0, 24);
  const guesserName = `RecapWinner${s}`.slice(0, 24);
  const prompt1 = "a cat wearing a top hat painted in watercolor";
  const prompt2 = "a dog surfing a wave at sunset in oil pastel";
  const guess1 = `${s}_first hat cat watercolor`;
  const guess2 = `${s}_second dog wave pastel`;

  await sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, is_anonymous, created_at, updated_at)
    values
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${hostEmail}', '', now(), '{}'::jsonb, '{}'::jsonb, true, now(), now()),
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${guesserEmail}', '', now(), '{}'::jsonb, '{}'::jsonb, true, now(), now());
  `);

  const users = (await sql(
    `select id, email from auth.users where email in ('${hostEmail}', '${guesserEmail}');`,
  )) as Array<{ id: string; email: string }>;
  const host = users.find((u) => u.email === hostEmail)!;
  const guesser = users.find((u) => u.email === guesserEmail)!;

  // Seed a room stuck in game_over — the recap page gates prompts on this.
  const rooms = (await sql(`
    insert into rooms (code, host_id, phase, max_rounds, round_num)
      values ('${code}', '${host.id}', 'game_over', 2, 2)
      returning id;
  `)) as Array<{ id: string }>;
  const roomId = rooms[0].id;

  // Host at 40 total; guesser at 88 (wins 48 + 40). Winner chip should display
  // the guesser's display_name.
  await sql(`
    insert into room_players (room_id, player_id, display_name, is_host, score)
      values
        ('${roomId}', '${host.id}', '${hostName}', true, 40),
        ('${roomId}', '${guesser.id}', '${guesserName}', false, 88);
  `);

  // Two finished rounds, both with ended_at set so the page includes them.
  const rounds = (await sql(`
    insert into rounds (room_id, round_num, prompt, image_url, started_at, ended_at)
      values
        ('${roomId}', 1, '${prompt1}',
         'https://placehold.co/512x512/png?text=R1',
         now() - interval '4 minutes', now() - interval '3 minutes'),
        ('${roomId}', 2, '${prompt2}',
         'https://placehold.co/512x512/png?text=R2',
         now() - interval '2 minutes', now() - interval '1 minute')
      returning id, round_num;
  `)) as Array<{ id: string; round_num: number }>;
  const round1 = rounds.find((r) => r.round_num === 1)!;
  const round2 = rounds.find((r) => r.round_num === 2)!;

  // Role tokens for round 1 — keeps the flipboard underline path in play.
  await sql(`
    insert into round_prompt_tokens (round_id, position, token, role) values
      ('${round1.id}', 0, 'a', 'filler'),
      ('${round1.id}', 1, 'cat', 'subject'),
      ('${round1.id}', 2, 'wearing', 'filler'),
      ('${round1.id}', 3, 'a', 'filler'),
      ('${round1.id}', 4, 'top', 'modifier'),
      ('${round1.id}', 5, 'hat', 'subject'),
      ('${round1.id}', 6, 'painted', 'filler'),
      ('${round1.id}', 7, 'in', 'filler'),
      ('${round1.id}', 8, 'watercolor', 'style'),
      ('${round2.id}', 0, 'a', 'filler'),
      ('${round2.id}', 1, 'dog', 'subject'),
      ('${round2.id}', 2, 'surfing', 'filler'),
      ('${round2.id}', 3, 'a', 'filler'),
      ('${round2.id}', 4, 'wave', 'subject'),
      ('${round2.id}', 5, 'at', 'filler'),
      ('${round2.id}', 6, 'sunset', 'modifier'),
      ('${round2.id}', 7, 'in', 'filler'),
      ('${round2.id}', 8, 'oil', 'style'),
      ('${round2.id}', 9, 'pastel', 'style');
  `);

  // Guesses — one per round from the guesser. total_score is a generated
  // column (30 + 20 + 15 + 7 = 72 and 30 + 22 + 19 + 7 = 78 after the sum).
  await sql(`
    insert into guesses (round_id, player_id, guess, subject_score, style_score, semantic_score, speed_bonus)
      values
        ('${round1.id}', '${guesser.id}', '${guess1}', 30, 20, 15, 7),
        ('${round2.id}', '${guesser.id}', '${guess2}', 30, 22, 19, 7);
  `);

  try {
    const http = await pwRequest.newContext({ baseURL: baseUrl() });

    // 1. Finished game renders a full recap.
    const res = await http.get(`/play/${code}/recap`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // Room header + winner appear on the page.
    expect(html).toContain(`Recap · room ${code}`);
    expect(html).toContain(guesserName);
    // The winner's score 88 must appear (animated count-up is client-only —
    // SSR renders the final value directly).
    expect(html).toContain("88");
    // Both prompts' tokens render.
    expect(html).toContain("watercolor");
    expect(html).toContain("pastel");
    expect(html).toContain("cat");
    expect(html).toContain("dog");
    // Round cards both rendered (per-round data attribute).
    expect(html).toContain('data-recap-round="1"');
    expect(html).toContain('data-recap-round="2"');
    // Role underline class applied from the flipboard-style token rendering.
    expect(html).toContain("role-subject-underline");
    // Round image URLs rendered.
    expect(html).toContain("placehold.co/512x512/png?text=R1");
    expect(html).toContain("placehold.co/512x512/png?text=R2");
    // CTA back to the home page.
    expect(html).toContain("Start a new game");

    // 2. Flip the room out of game_over — the recap page should refuse to
    //    leak any prompts and show a "still in progress" placeholder instead.
    //    (revalidate=3600 but each URL is fresh in prod runs.)
    await sql(`
      update rooms set phase = 'guessing' where id = '${roomId}';
    `);

    // Bust the route cache by hitting a bogus query string. Next ignores it
    // for routing but produces a fresh SSR render.
    const inflight = await http.get(`/play/${code}/recap?t=${stamp()}`);
    expect(inflight.status()).toBe(200);
    const inflightHtml = await inflight.text();
    expect(inflightHtml).toContain("Still in progress");
    // Prompts must NOT appear on the in-progress page.
    expect(inflightHtml).not.toContain("watercolor");
    expect(inflightHtml).not.toContain("pastel");

    // 3. Bogus 4-letter code should 404 (never 500).
    const bogus = await http.get(`/play/ZZZZ/recap`);
    expect(bogus.status()).toBe(404);
  } finally {
    await sql(`delete from rooms where id = '${roomId}';`);
    await sql(
      `delete from auth.users where id in ('${host.id}', '${guesser.id}');`,
    );
  }
});
