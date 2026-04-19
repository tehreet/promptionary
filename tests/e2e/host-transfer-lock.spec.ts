import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

test("manual host transfer is disabled during active gameplay", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`, {
    maxRounds: 1,
    revealSeconds: 5,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  const joinerName = `Player${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  // In lobby, host should see the transfer button enabled
  await expect(host.getByText(joinerName)).toBeVisible({ timeout: 10_000 });
  const transferButton = host.getByRole("button", {
    name: new RegExp(`Make ${joinerName} host`),
  });
  await expect(transferButton).toBeVisible();
  await expect(transferButton).toBeEnabled();

  // Start the game
  await host.getByRole("button", { name: /Start game/ }).click();

  // Wait for the guessing phase to begin (active gameplay)
  await expect(
    host.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible({ timeout: 60_000 });

  // Transfer button should now be disabled
  await expect(transferButton).toBeDisabled();

  await hostCtx.close();
  await joinerCtx.close();
});

test("manual host transfer remains enabled in lobby phase", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`);

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  const joinerName = `Player${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  // In lobby, host sees the transfer button enabled
  await expect(host.getByText(joinerName)).toBeVisible({ timeout: 10_000 });
  const transferButton = host.getByRole("button", {
    name: new RegExp(`Make ${joinerName} host`),
  });
  await expect(transferButton).toBeVisible();
  await expect(transferButton).toBeEnabled();

  // Click the transfer button
  await transferButton.click();

  // After transfer, new host sees the start button
  await expect(
    joiner.getByRole("button", { name: /Start game/ }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    host.getByRole("button", { name: /Start game/ }),
  ).not.toBeVisible({ timeout: 10_000 });

  await hostCtx.close();
  await joinerCtx.close();
});

test("host auto-reassignment when host leaves during active gameplay", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const hostName = `Host${Date.now()}`;
  const code = await createRoomAs(host, hostName, {
    maxRounds: 1,
    revealSeconds: 5,
  });

  const player2Ctx = await browser.newContext();
  const player2 = await player2Ctx.newPage();
  const player2Name = `Player2${Date.now()}`;
  await joinRoomAs(player2, code, player2Name);

  // Start the game
  await host.getByRole("button", { name: /Start game/ }).click();

  // Wait for the guessing phase to begin
  await expect(
    player2.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible({ timeout: 60_000 });

  // Original host leaves during active gameplay
  await host.getByRole("button", { name: "Leave" }).click();
  await host.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });

  // Player2 should still be in the game (not kicked out)
  await expect(
    player2.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible();

  // Player2 should now be the host (can verify by submitting a guess and seeing the game continues)
  await submitGuess(player2, "test guess after host left");

  // Game should continue to reveal phase
  await expect(player2.getByText("The prompt was")).toBeVisible({
    timeout: 30_000,
  });

  await hostCtx.close();
  await player2Ctx.close();
});

test("manual host transfer is re-enabled after returning to lobby via play again", async ({
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
  const joinerName = `Player${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  // Start the game
  await host.getByRole("button", { name: /Start game/ }).click();

  // Submit guesses to reach game_over
  await submitGuess(host, "a cat wearing a top hat");
  await submitGuess(joiner, "astronaut riding a horse");

  // Wait for final leaderboard
  await expect(host.getByText("Final leaderboard")).toBeVisible({
    timeout: 60_000,
  });

  // Host clicks play again to return to lobby
  await host.getByRole("button", { name: "Play Again" }).click();

  // Both land in the lobby
  for (const page of [host, joiner]) {
    await expect(page.getByText(/Share this code/)).toBeVisible({
      timeout: 30_000,
    });
  }

  // Transfer button should be enabled again in lobby
  const transferButton = host.getByRole("button", {
    name: new RegExp(`Make ${joinerName} host`),
  });
  await expect(transferButton).toBeVisible();
  await expect(transferButton).toBeEnabled();

  // Verify transfer works again
  await transferButton.click();
  await expect(
    joiner.getByRole("button", { name: /Start game/ }),
  ).toBeVisible({ timeout: 10_000 });

  await hostCtx.close();
  await joinerCtx.close();
});
