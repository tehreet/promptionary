import { test, expect, request as pwRequest } from "@playwright/test";

// Hits the Supabase Management SQL API to seed a finished round + its sidecar
// rows, then verifies /r/<round_id> renders a full share card. Pattern mirrors
// profile-stats.spec.ts — tests run against prod, so we cleanup aggressively.
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

// Unique per run so parallel workers don't collide on the 4-char room code.
function stamp() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Room.code is checked against `^[A-Z]{4}$` — generate a fresh one per run so
// we don't collide with existing prod rooms. Random is fine; the test cleans
// up its own row.
function randomRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTVWXYZ"; // no I/O/U for readability
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += letters[Math.floor(Math.random() * letters.length)];
  }
  return out;
}

// The /r page is cacheable (revalidate=3600). Round UUIDs are one-off per run
// so there's no stale-cache risk in practice.
function baseUrl() {
  return (
    process.env.PROMPTIONARY_TEST_URL ??
    "https://promptionary-three.vercel.app"
  );
}

test("share round: /r/<round_id> renders a finished round with prompt + top guess + image", async () => {
  test.setTimeout(60_000);

  // All inserts bypass RLS via the service role that the Supabase Management
  // API implicitly uses. Keep the seed totally hermetic: a fresh room, an
  // ended round, a single guess, and enough prompt tokens for the flipboard.
  const s = stamp();
  const code = randomRoomCode();
  const hostEmail = `share-host-${s}@example.invalid`;
  const guesserEmail = `share-guesser-${s}@example.invalid`;
  const hostName = `Host${s}`.slice(0, 24);
  const guesserName = `Guesser${s}`.slice(0, 24);
  const prompt = "a cat wearing a top hat painted in watercolor";
  const topGuess = `${s} guess hat cat watercolor`;

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

  // Room in game_over so the rounds_public view would also show the prompt
  // (not strictly required — /r/ bypasses the view — but keeps the fixture
  // internally consistent).
  const rooms = (await sql(`
    insert into rooms (code, host_id, phase, max_rounds, round_num)
      values ('${code}', '${host.id}', 'game_over', 1, 1)
      returning id;
  `)) as Array<{ id: string }>;
  const roomId = rooms[0].id;

  // Seed both players into the room so display_name lookups work for the top
  // guess leaderboard row.
  await sql(`
    insert into room_players (room_id, player_id, display_name, is_host, score)
      values
        ('${roomId}', '${host.id}', '${hostName}', true, 0),
        ('${roomId}', '${guesser.id}', '${guesserName}', false, 72);
  `);

  const rounds = (await sql(`
    insert into rounds (room_id, round_num, prompt, image_url, started_at, ended_at)
      values (
        '${roomId}', 1, '${prompt}',
        'https://placehold.co/512x512/png?text=Test',
        now() - interval '2 minutes', now() - interval '30 seconds'
      )
      returning id;
  `)) as Array<{ id: string }>;
  const roundId = rounds[0].id;

  // Role tokens — pick subject + style + filler so the flipboard legend
  // renders and the share page shows the role underlines.
  await sql(`
    insert into round_prompt_tokens (round_id, position, token, role) values
      ('${roundId}', 0, 'a', 'filler'),
      ('${roundId}', 1, 'cat', 'subject'),
      ('${roundId}', 2, 'wearing', 'filler'),
      ('${roundId}', 3, 'a', 'filler'),
      ('${roundId}', 4, 'top', 'modifier'),
      ('${roundId}', 5, 'hat', 'subject'),
      ('${roundId}', 6, 'painted', 'filler'),
      ('${roundId}', 7, 'in', 'filler'),
      ('${roundId}', 8, 'watercolor', 'style');
  `);

  // total_score is a generated column (subject + style + semantic + speed);
  // 30 + 20 + 15 + 7 = 72 so the share page shows "+72".
  await sql(`
    insert into guesses (round_id, player_id, guess, subject_score, style_score, semantic_score, speed_bonus)
      values (
        '${roundId}', '${guesser.id}', '${topGuess}',
        30, 20, 15, 7
      );
  `);

  try {
    const http = await pwRequest.newContext({ baseURL: baseUrl() });

    // 1. Finished round renders the share card.
    const res = await http.get(`/r/${roundId}`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // React SSR splits text across adjacent children, so the literal
    // substring "Round 1 recap" wouldn't appear — match around the HTML
    // comment markers Next inserts between dynamic + static fragments.
    expect(html).toMatch(/Round\s*(<!--[^>]*-->)?\s*1\s*(<!--[^>]*-->)?\s*recap/);
    expect(html).toContain("The prompt was");
    // Prompt tokens render as individual spans — check a couple to be sure.
    expect(html).toContain("watercolor");
    expect(html).toContain("cat");
    // Top guess + guesser name + score badge. React SSR splits "+72" into
    // sibling text nodes; match tolerantly.
    expect(html).toContain(topGuess);
    expect(html).toContain(guesserName);
    expect(html).toMatch(/\+\s*(<!--[^>]*-->)?\s*72/);
    // Role underlines present (confirms the flipboard actually used tokens).
    expect(html).toContain("role-subject-underline");
    // Round image URL is rendered.
    expect(html).toContain("placehold.co/512x512/png");
    // CTA + room code context.
    expect(html).toContain("Play Promptionary");
    expect(html).toContain(code);

    // 2. Unfinished round (ended_at null) returns 404.
    const openRounds = (await sql(`
      insert into rounds (room_id, round_num, prompt, image_url, started_at, ended_at)
        values ('${roomId}', 2, 'mid-flight prompt', null, now(), null)
        returning id;
    `)) as Array<{ id: string }>;
    const openId = openRounds[0].id;

    const openRes = await http.get(`/r/${openId}`);
    expect(openRes.status()).toBe(404);

    // Bogus UUIDs should also 404 (and never leak a 500).
    const bogus = await http.get(`/r/not-a-real-round-id`);
    expect(bogus.status()).toBe(404);
  } finally {
    // Guesses / rounds / round_prompt_tokens / room_players cascade from
    // the rooms FK; auth.users cascades to any ancillary rows it owns.
    await sql(`delete from rooms where id = '${roomId}';`);
    await sql(
      `delete from auth.users where id in ('${host.id}', '${guesser.id}');`,
    );
  }
});
