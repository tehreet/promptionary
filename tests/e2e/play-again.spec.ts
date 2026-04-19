import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

test("play again: host resets game to lobby with same players, scores cleared", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`, {
    maxRounds: 1,
    revealSeconds: 5,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, `Joiner${Date.now()}`);

  await host.getByRole("button", { name: /Start game/ }).click();

  await submitGuess(host, "a cat wearing a top hat");
  await submitGuess(joiner, "astronaut riding a horse");

  // Wait for final leaderboard
  for (const page of [host, joiner]) {
    await expect(page.getByText("Final leaderboard")).toBeVisible({
      timeout: 60_000,
    });
  }

  // Host sees Play Again; joiner sees waiting message
  await expect(host.getByRole("button", { name: "Play Again" })).toBeVisible();
  await expect(joiner.getByText(/Waiting for the host/)).toBeVisible();

  // Host clicks play again
  await host.getByRole("button", { name: "Play Again" }).click();

  // Both land in the lobby — "Share this code" header is the lobby marker
  for (const page of [host, joiner]) {
    await expect(page.getByText(/Share this code/)).toBeVisible({
      timeout: 30_000,
    });
  }

  // Room code heading should still be the same
  await expect(host.locator("h1", { hasText: code })).toBeVisible();

  // Start the second game — round_num is back to 0 / round 1 begins
  await host.getByRole("button", { name: /Start game/ }).click();
  await expect(
    host.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible({ timeout: 60_000 });

  // Fresh round counter visible — we're back in play
  await expect(host.getByText("1 / 1")).toBeVisible();

  await hostCtx.close();
  await joinerCtx.close();
});
