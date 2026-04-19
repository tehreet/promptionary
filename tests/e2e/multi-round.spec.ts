import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

test("3 players, 2 rounds: scoreboard + clean rollover + everyone-submitted finalize", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`, {
    maxRounds: 2,
    revealSeconds: 5,
  });

  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  await joinRoomAs(alice, code, `Alice${Date.now()}`);

  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await joinRoomAs(bob, code, `Bob${Date.now()}`);

  await expect(host.getByRole("button", { name: /Start game \(3/ })).toBeVisible({
    timeout: 15_000,
  });
  await host.getByRole("button", { name: /Start game/ }).click();

  // Round 1
  await submitGuess(host, "a cat wearing a top hat in the rain");
  await submitGuess(alice, "majestic stag in a pixel art forest");
  await expect(alice.getByText(/Submissions: 2\/3/)).toBeVisible({ timeout: 15_000 });
  await submitGuess(bob, "an astronaut riding a horse on mars");

  for (const page of [host, alice, bob]) {
    await expect(page.getByText("The prompt was")).toBeVisible({ timeout: 30_000 });
  }

  // Round 2 — textbox should show, not flash away
  for (const page of [host, alice, bob]) {
    await expect(
      page.getByRole("textbox", { name: /What's the prompt/ }),
    ).toBeVisible({ timeout: 60_000 });
  }
  await host.waitForTimeout(1000);
  await expect(
    host.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible();

  await submitGuess(host, "round 2 guess");
  await submitGuess(alice, "something random");
  await submitGuess(bob, "more words");

  // Round 2 finishes — game_over leaderboard appears
  for (const page of [host, alice, bob]) {
    await expect(page.getByText("Final leaderboard")).toBeVisible({
      timeout: 30_000,
    });
  }

  await hostCtx.close();
  await aliceCtx.close();
  await bobCtx.close();
});
