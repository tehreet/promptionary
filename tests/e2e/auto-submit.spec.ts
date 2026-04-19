import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

test("auto-submit: unsubmitted text in the textarea is sent when timer runs out", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  // Short guess timer so the test doesn't have to wait forever.
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`, {
    maxRounds: 1,
    guessSeconds: 15,
    revealSeconds: 5,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  const joinerName = `Joiner${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  await host.getByRole("button", { name: /Start game/ }).click();

  // Wait for the guess textarea
  const hostBox = host.getByRole("textbox", { name: /What's the prompt/ });
  const joinerBox = joiner.getByRole("textbox", { name: /What's the prompt/ });
  await hostBox.waitFor({ state: "visible", timeout: 60_000 });
  await joinerBox.waitFor({ state: "visible", timeout: 60_000 });

  // Type something on both but DON'T click submit. Let the timer auto-fire.
  await hostBox.fill("a corgi wearing a beret");
  await joinerBox.fill("a cat painting in watercolor");

  // After ~15s + a few seconds for scoring, reveal should show both guesses.
  for (const page of [host, joiner]) {
    await expect(page.getByText("The prompt was")).toBeVisible({
      timeout: 60_000,
    });
  }

  // Both guesses should be listed on the reveal page (typed text, not empty).
  await expect(host.getByText(/a corgi wearing a beret/)).toBeVisible();
  await expect(host.getByText(/a cat painting in watercolor/)).toBeVisible();

  await hostCtx.close();
  await joinerCtx.close();
});
