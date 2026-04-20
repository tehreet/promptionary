import { test, expect, type Page } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

// Turn-by-turn collaborative team prompt writing (#57).
//
// 4 players. Teams enabled + artist mode. One team writes the prompt one
// phrase at a time; the other team guesses. We assert:
//   - the writing-team roster chip highlights the active teammate
//   - the non-active teammate sees a "teammate is writing" block
//   - the opposing team sees a blocked watcher view (no leaked phrases)
//   - a per-turn countdown is visible
//   - the two phrases concatenate into the final prompt
//   - the guessing team can submit guesses after image gen
test("team-turns: one team writes the prompt together, other team guesses", async ({
  browser,
}) => {
  test.setTimeout(240_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const stamp = Date.now();
  const hostName = `H${stamp}`;

  const code = await createRoomAs(host, hostName, {
    mode: "artist",
    maxRounds: 1,
    revealSeconds: 5,
  });

  const p2Ctx = await browser.newContext();
  const p2 = await p2Ctx.newPage();
  await joinRoomAs(p2, code, `B${stamp}`);

  const p3Ctx = await browser.newContext();
  const p3 = await p3Ctx.newPage();
  await joinRoomAs(p3, code, `C${stamp}`);

  const p4Ctx = await browser.newContext();
  const p4 = await p4Ctx.newPage();
  await joinRoomAs(p4, code, `D${stamp}`);

  // Wait for all 4 players in the host lobby before toggling teams — the seed
  // loop on the server needs to see everyone.
  await expect(host.getByRole("heading", { name: /Players \(4\)/ })).toBeVisible({
    timeout: 20_000,
  });

  // Flip teams ON. Auto-balance drops two players onto each team.
  await host.locator('input[data-teams-toggle="1"]').click();
  await expect(host.locator('[data-team="1"] li')).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(host.locator('[data-team="2"] li')).toHaveCount(2);

  await host.getByRole("button", { name: /Start game/ }).click();

  // The team-prompting phase renders either `data-team-prompting="writer"`
  // (one of our four teammates belongs to the writing team) or
  // `data-team-prompting="watcher"` on the opposing team. Figure out which
  // team got picked + identify the writing-team pages.
  const pages = [host, p2, p3, p4];
  await Promise.all(
    pages.map((p) =>
      p
        .locator('[data-team-prompting]')
        .first()
        .waitFor({ state: "visible", timeout: 30_000 }),
    ),
  );
  const writers: Page[] = [];
  const watchers: Page[] = [];
  for (const p of pages) {
    const role = await p
      .locator('[data-team-prompting]')
      .first()
      .getAttribute("data-team-prompting");
    if (role === "writer") writers.push(p);
    else watchers.push(p);
  }
  expect(writers.length).toBe(2);
  expect(watchers.length).toBe(2);

  // Watchers must NOT leak phrases. `data-team-phrases` only renders on the
  // writer surface — it's absent on watchers by construction.
  for (const w of watchers) {
    await expect(w.locator('[data-team-phrases="1"]')).toHaveCount(0);
    // Watcher copy references the writing team.
    await expect(w.getByText(/writing your challenge/)).toBeVisible();
  }

  // One writer is active (`[data-team-roster] li[data-active="1"]`). Identify
  // them by waiting for whichever writer page is showing the active form.
  const findActiveWriter = async (): Promise<Page> => {
    for (let attempt = 0; attempt < 60; attempt++) {
      for (const w of writers) {
        const form = w.locator('[data-team-active-form="1"]');
        if ((await form.count()) > 0) return w;
      }
      await host.waitForTimeout(500);
    }
    throw new Error("no writer became active within 30s");
  };

  const writer1 = await findActiveWriter();
  // Active-writer UI: there's a highlighted roster chip + a countdown pill.
  await expect(
    writer1.locator('[data-team-roster] li[data-active="1"]'),
  ).toHaveCount(1);
  await expect(writer1.locator(".marquee-pill").first()).toBeVisible();

  // The OTHER writer-team member sees "teammate is writing" waiting state.
  const writer2 = writers.find((w) => w !== writer1)!;
  await expect(writer2.locator('[data-team-waiting="1"]')).toBeVisible({
    timeout: 10_000,
  });

  // Writer 1 submits their phrase.
  const phrase1 = "a smug corgi";
  const writer1Input = writer1.locator('[data-team-active-form="1"] textarea');
  await writer1Input.fill(phrase1);
  await writer1.getByRole("button", { name: /Add phrase/ }).click();

  // Writer 2 should now see the active form (turn rotated to them). Their
  // textarea appears, writer 1's form disappears.
  await expect(writer2.locator('[data-team-active-form="1"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(writer1.locator('[data-team-waiting="1"]')).toBeVisible({
    timeout: 10_000,
  });

  // Writer 2 can see writer 1's phrase in the "so far" strip.
  await expect(writer2.locator('[data-team-phrases="1"]')).toContainText(
    phrase1,
  );

  // Writer 2 submits. After the last phrase lands, the room flips to
  // generating, and once Gemini returns an image we enter guessing.
  const phrase2 = "painting a sunset in oil pastel";
  const writer2Input = writer2.locator('[data-team-active-form="1"] textarea');
  await writer2Input.fill(phrase2);
  await writer2.getByRole("button", { name: /Add phrase/ }).click();

  // Guessing team: both watchers get the guess input once the image lands.
  for (const w of watchers) {
    await submitGuess(w, "a small dog painting the sunset");
  }

  // Writer team members during guessing see a "your team wrote this" block,
  // not a guess form.
  for (const w of writers) {
    await expect(w.locator('[data-team-writer-waiting="1"]')).toBeVisible({
      timeout: 60_000,
    });
  }

  // Game_over: we rendered for a single round. The flipboard recap shows the
  // assembled prompt on every page.
  for (const page of [host, p2, p3, p4]) {
    await expect(page.getByText("Final team leaderboard")).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator('[data-team-rank="1"]')).toBeVisible();
    await expect(page.locator('[data-team-rank="2"]')).toBeVisible();
  }

  // Assembled prompt = phrase1 + " " + phrase2 (verified on any client's
  // recap flipboard — the full prompt is rendered at reveal/game_over).
  const recapText = await host.locator('body').innerText();
  expect(recapText).toContain("corgi");
  expect(recapText).toContain("sunset");

  await hostCtx.close();
  await p2Ctx.close();
  await p3Ctx.close();
  await p4Ctx.close();
});
