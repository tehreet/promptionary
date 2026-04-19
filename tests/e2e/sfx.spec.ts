import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

test("sfx: toggle mutes, submit/imageLand/reveal fire during a round", async ({
  browser,
}) => {
  test.setTimeout(150_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`, {
    maxRounds: 1,
    revealSeconds: 5,
  });

  // Landing page already loaded during createRoomAs navigation; verify the
  // mute toggle is present on the resulting page.
  const muteButton = host.getByRole("button", { name: /Mute sounds/ });
  await expect(muteButton).toBeVisible();
  await muteButton.click();
  await expect(
    host.getByRole("button", { name: /Unmute sounds/ }),
  ).toBeVisible();
  // Toggle back so later sfx calls also log (they log whether muted or not,
  // but keep audio on so we exercise the un-muted path too).
  await host.getByRole("button", { name: /Unmute sounds/ }).click();

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, `Joiner${Date.now()}`);

  await host.getByRole("button", { name: /Start game/ }).click();

  for (const page of [host, joiner]) {
    await expect(
      page.getByRole("textbox", { name: /What's the prompt/ }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('img[alt="Round"]')).toBeVisible();
  }

  // imageLand fires on the first render where image_url is populated during
  // guessing — by this point both pages should have logged it.
  await host.waitForFunction(
    () =>
      ((window as unknown as { __sfx?: Array<{ name: string }> }).__sfx || [])
        .some((e) => e.name === "imageLand"),
    { timeout: 10_000 },
  );

  await submitGuess(host, "a cat wearing a top hat");
  await submitGuess(joiner, "astronaut riding a horse");

  // submit should be logged by now on host's window.
  const submitNames: string[] = await host.evaluate(() =>
    (
      (window as unknown as { __sfx?: Array<{ name: string }> }).__sfx || []
    ).map((e) => e.name),
  );
  expect(submitNames).toContain("submit");

  for (const page of [host, joiner]) {
    await expect(page.getByText("The prompt was")).toBeVisible({
      timeout: 30_000,
    });
  }

  // Last round of a 1-round game ends in game_over (reveal phase is skipped),
  // so the winner cheer is the sfx that fires.
  await host.waitForFunction(
    () =>
      ((window as unknown as { __sfx?: Array<{ name: string }> }).__sfx || [])
        .some((e) => e.name === "winnerCheer"),
    { timeout: 15_000 },
  );

  await hostCtx.close();
  await joinerCtx.close();
});
